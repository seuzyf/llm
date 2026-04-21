import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import https from 'https';
import http from 'http';
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { parseFile } from './src/fileParser.js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

['logs', 'uploads'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeName = originalName.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
    const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${uniquePrefix}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  timeout: 1500,
});

const httpAgent = new http.Agent({
  keepAlive: true,
});

const axiosClient = axios.create({
  timeout: 1500,
  maxRedirects: 5,
  responseType: 'arraybuffer',
  httpsAgent,
  httpAgent,
  decompress: true,
  validateStatus: () => true,
});

function detectEncoding(buffer: Buffer, contentType: string): string {
  const ctMatch = contentType.match(/charset=([^\s;]+)/i);
  if (ctMatch) return ctMatch[1].toLowerCase().replace(/['"]/g, '');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8';
  const head = buffer.slice(0, 4096).toString('latin1');
  const metaMatch =
    head.match(/charset=["']?([a-zA-Z0-9\-_]+)/i) ||
    head.match(/<meta[^>]+charset["'\s]*=["'\s]*([a-zA-Z0-9\-_]+)/i);
  if (metaMatch) return metaMatch[1].toLowerCase();
  return 'utf-8';
}

interface FetchResult {
  title: string;
  text: string;
  url: string;
  hasError: boolean;
  errorMsg?: string;
}

async function fetchAndParse(url: string, retries = 2): Promise<FetchResult> {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axiosClient.get(url, {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'no-cache',
          'Referer': new URL(url).origin,
        },
      });

      const status = response.status;
      const contentType: string = response.headers['content-type'] || '';

      if (status >= 400) {
        lastError = `HTTP ${status}`;
        if (status >= 400 && status < 500) {
          return {
            title: '网页访问被拒',
            text: `[⚠️ 系统日志：目标服务器返回 HTTP ${status}]`,
            url,
            hasError: true,
            errorMsg: `HTTP ${status}`,
          };
        }
        continue;
      }

      if (
        contentType &&
        !contentType.includes('text/') &&
        !contentType.includes('application/xhtml') &&
        !contentType.includes('application/xml') &&
        !contentType.includes('application/json')
      ) {
        return {
          title: '非文本内容',
          text: `[⚠️ 系统日志：无法提取非文本内容 (${contentType})]`,
          url,
          hasError: true,
          errorMsg: `非文本内容: ${contentType}`,
        };
      }

      const buffer = Buffer.from(response.data);
      const encoding = detectEncoding(buffer, contentType);
      let html: string;
      try {
        html = iconv.decode(buffer, encoding);
      } catch {
        html = buffer.toString('utf-8');
      }

      const $ = cheerio.load(html);
      $('script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, .ad, .ads, .advertisement, [class*="banner"], [id*="banner"]').remove();

      const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || url;
      let text = '';
      const contentSelectors = ['article', 'main', '[role="main"]', '.article-content', '.post-content', '.entry-content', '#content', '.content'];

      for (const selector of contentSelectors) {
        const el = $(selector);
        if (el.length && el.text().trim().length > 200) {
          text = el.text();
          break;
        }
      }

      if (!text || text.trim().length < 100) text = $('body').text();

      text = text.replace(/\t/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      if (text.length < 200 && (html.includes('id="root"') || html.includes('id="app"'))) {
        text += '\n\n[系统检测提示：该网页为前端动态渲染(SPA)，静态抓取受限。]';
      }

      return { title: title.trim(), text, url, hasError: false };

    } catch (err: any) {
      const code = err?.code || err?.cause?.code || '';
      const msg = err?.message || String(err);
      lastError = `${code ? `[${code}] ` : ''}${msg}`;
      if (attempt === retries) {
        return {
          title: '网页抓取失败',
          text: `[⚠️ 系统日志：尝试均失败。原因：${lastError}]`,
          url,
          hasError: true,
          errorMsg: lastError,
        };
      }
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return { title: '网页抓取失败', text: `[⚠️ 系统日志：未知错误]`, url, hasError: true };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  app.post('/api/upload', (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) return res.status(400).json({ error: '上传失败', details: err.message });
      next();
    });
  }, async (req, res) => {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) return res.status(400).json({ error: '未上传文件' });
    const files = req.files as Express.Multer.File[];
    const results = [];
    for (const file of files) {
      const { path: filePath, filename } = file;
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      let text = '';
      let parseError: string | undefined;
      try {
        const result = await parseFile(filePath, originalName);
        text = result.text;
        parseError = result.error;
      } catch (unexpected: any) {
        parseError = `系统异常: ${unexpected?.message ?? String(unexpected)}`;
      }
      if (parseError && !text) text = `【解析提示】${parseError}`;
      results.push({ url: `/uploads/${filename}`, name: originalName, text, ...(parseError ? { warning: parseError } : {}) });
    }
    return res.json({ files: results });
  });

  app.post('/api/template/audit', async (req, res) => {
    const batchId = Date.now().toString();
    const batchDir = path.join(process.cwd(), 'uploads', 'templates', batchId);
    fs.mkdirSync(batchDir, { recursive: true });

    const templateStorage = multer.diskStorage({
      destination: batchDir,
      filename: (_req, file, cb) => {
        const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
        cb(null, safeName);
      }
    });

    const templateUpload = multer({ storage: templateStorage }).array('files', 20);

    templateUpload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: '上传失败' });
      if (!req.files || (req.files as Express.Multer.File[]).length === 0) return res.status(400).json({ error: '未上传文件' });

      try {
        // 核心：统一调用根目录的 parser.py
        const scriptPath = path.join(process.cwd(), 'parser.py');
        const promptPath = path.join(process.cwd(), 'src', 'audit_supplier', 'prompt.txt');

        if (!fs.existsSync(scriptPath) || !fs.existsSync(promptPath)) {
          return res.status(500).json({ error: '服务端未找到 parser.py 或 prompt.txt' });
        }

        // parser.py 现在支持直接处理目录
        const { stdout } = await execPromise(`python "${scriptPath}" "${batchDir}"`);
        const promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        const finalPrompt = promptTemplate.replace('{excel_content}', stdout);

        res.json({ prompt: finalPrompt });
      } catch (error: any) {
        res.status(500).json({ error: '模板解析失败', details: error.message });
      }
    });
  });

  app.post('/api/parse-url', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '缺少 URL' });
    const result = await fetchAndParse(url);
    return res.json(result);
  });

  app.get('/api/logs/:username', (req, res) => {
    const filePath = path.join('logs', `${req.params.username}.json`);
    if (!fs.existsSync(filePath)) return res.json([]);
    return res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  });

  app.post('/api/logs/:username', (req, res) => {
    fs.writeFileSync(path.join('logs', `${req.params.username}.json`), JSON.stringify(req.body, null, 2));
    return res.json({ success: true });
  });

  const LM_BASE_URL = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions').replace('/chat/completions', '');

  app.post('/api/chat', async (req, res) => {
    try {
      try {
        const modelsRes = await fetch(`${LM_BASE_URL}/models`);
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          if (modelsData?.data && modelsData.data.length > 0) req.body.model = modelsData.data[0].id;
        }
      } catch (e) {}

      const upstream = await fetch(`${LM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (!upstream.ok && !req.body.stream) return res.status(upstream.status).json({ error: await upstream.text() });

      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');
        if (!upstream.body) return res.end();
        const reader = (upstream.body as unknown as ReadableStream<Uint8Array>).getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done || res.writableEnded) break;
            res.write(Buffer.from(value));
          }
          res.end();
        };
        pump().catch(() => { if (!res.writableEnded) res.end(); });
        req.on('close', () => reader.cancel().catch(() => {}));
      } else {
        return res.json(await upstream.json());
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/models', async (_req, res) => {
    try {
      const response = await fetch(`${LM_BASE_URL}/models`);
      return res.json(await response.json());
    } catch (error: any) {
      return res.status(503).json({ error: '未连接', isConnectionRefused: true });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ 服务启动: http://localhost:${PORT}`);
  });
}

startServer().catch((e) => {
  console.error('服务启动失败:', e);
  process.exit(1);
});
