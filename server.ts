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
import crypto from 'crypto'; // 新增：用于计算文件 MD5

const execPromise = util.promisify(exec);
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 1. 初始化目录结构
const DIRS = ['logs', 'logs/users', 'uploads', 'uploads/users', 'uploads/public', 'uploads/templates'];
DIRS.forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========= RAG 与向量存储实现 (基于 LM Studio Embedding) =========
const LM_BASE_URL = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions').replace('/chat/completions', '');
const VECTOR_DB_PATH = path.join(process.cwd(), 'logs', 'vectorDB.json');

interface VectorRecord {
  id: string;
  sourceId?: string; 
  namespace: string;
  type: 'file' | 'chat';
  name: string;
  content: string;
  vector: number[];
  url?: string;
  fileHash?: string; // 新增：用于文件秒传和去重
}

let vectorDB: VectorRecord[] = [];

function loadVectorDB() {
  if (fs.existsSync(VECTOR_DB_PATH)) {
    try {
      vectorDB = JSON.parse(fs.readFileSync(VECTOR_DB_PATH, 'utf-8'));
      console.log(`[VectorDB] 已加载本地向量库，当前记录数: ${vectorDB.length}`);
    } catch (e) {
      console.error('[VectorDB] 读取本地向量库失败，已重置', e);
      vectorDB = [];
    }
  }
}

function saveVectorDB() {
  fs.writeFileSync(VECTOR_DB_PATH, JSON.stringify(vectorDB));
}

loadVectorDB();

// 计算文件的 MD5 值
function getFileHash(filePath: string): string {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (e) {
    return '';
  }
}

function chunkText(text: string, chunkSize = 2500, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const embeddingQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (embeddingQueue.length > 0) {
    const task = embeddingQueue.shift();
    if (task) {
      try { await task(); } catch (e) { console.error("[Queue] 任务执行失败:", e); }
    }
  }
  isProcessingQueue = false;
}

function enqueueEmbeddingTask(task: () => Promise<void>) {
  embeddingQueue.push(task);
  processQueue();
}

async function getEmbeddings(inputs: string[]): Promise<number[][]> {
  if (!inputs.length) return [];
  try {
    const response = await fetch(`${LM_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: inputs, model: 'qwen3-embedding' })
    });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return data.data.map((d: any) => d.embedding);
  } catch (e) {
    console.error("[Embedding] 请求失败:", e);
    return [];
  }
}
// 在 server.ts 顶部引入区下方，新增一个极轻量的同步缓存
const SYNC_CACHE_PATH = path.join(process.cwd(), 'logs', 'syncCache.json');
let syncCache: Record<string, number> = {}; // 记录格式: { "文件名": 最后修改时间戳 }

if (fs.existsSync(SYNC_CACHE_PATH)) {
  try {
    syncCache = JSON.parse(fs.readFileSync(SYNC_CACHE_PATH, 'utf-8'));
  } catch (e) {
    console.error('[Sync] 读取同步缓存失败，已重置');
  }
}

async function syncPublicFolder() {
  console.log(`\n[Sync] 正在启动公共文件夹自动同步扫描...`);
  const publicDir = path.join('uploads', 'public');
  if (!fs.existsSync(publicDir)) return;

  const files = fs.readdirSync(publicDir);
  let newlyIndexedCount = 0;
  let cacheUpdated = false;

  for (const filename of files) {
    const filePath = path.join(publicDir, filename);
    if (filename.startsWith('.') || !fs.statSync(filePath).isFile()) continue;

    // 核心性能优化：瞬间获取文件的最后修改时间
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;

    // 如果文件修改时间与缓存一致，说明文件毫无变化，直接跳过！(连 MD5 都不用算)
    if (syncCache[filename] === mtime) continue;

    const fileUrl = `/uploads/public/${filename}`;
    const fileHash = getFileHash(filePath); // 只有确认文件变动了，才去读内存算 MD5

    if (vectorDB.some(v => v.namespace === 'public' && v.fileHash === fileHash)) {
      // 内容没变（比如只是重命名或者单纯 touch 了一下），更新缓存后跳过
      syncCache[filename] = mtime;
      cacheUpdated = true;
      continue;
    }

    // 清理可能存在的同名旧版向量
    vectorDB = vectorDB.filter(v => !(v.namespace === 'public' && v.name === filename && v.type === 'file'));

    console.log(`[Sync] 发现新加入或已修改的公共文件: ${filename}，准备处理...`);
    try {
      const result = await parseFile(filePath, filename);
      const text = result.text || '';
      if (text && !text.startsWith('[⚠️')) {
        const chunks = chunkText(text);
        enqueueEmbeddingTask(async () => {
          let embedSuccess = true;
          for (let i = 0; i < chunks.length; i += 10) {
            const batch = chunks.slice(i, i + 10);
            const embs = await getEmbeddings(batch);
            if (!embs.length) { embedSuccess = false; break; }
            embs.forEach((vec, idx) => {
              vectorDB.push({
                id: `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                sourceId: fileUrl,
                namespace: 'public',
                type: 'file',
                name: filename,
                content: batch[idx],
                vector: vec,
                url: fileUrl,
                fileHash: fileHash
              });
            });
          }
          if (embedSuccess) {
            console.log(`[Sync] 公共文件索引完成: ${filename}`);
            saveVectorDB();
            
            // 向量建立成功后，安全写入缓存
            syncCache[filename] = mtime;
            fs.writeFileSync(SYNC_CACHE_PATH, JSON.stringify(syncCache));
          }
        });
        newlyIndexedCount++;
      }
    } catch (e) { 
      console.error(`[Sync] 解析失败: ${filename}`, e); 
    }
  }
  
  if (cacheUpdated) {
    fs.writeFileSync(SYNC_CACHE_PATH, JSON.stringify(syncCache));
  }
  
  console.log(`[Sync] 同步任务调度完成，共发现 ${newlyIndexedCount} 个待处理的变动文件。\n`);
}

// ===================================================================

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const username = decodeURIComponent(req.headers['x-user-name'] as string || 'anonymous');
    let targetDir = path.join('uploads', 'users', username);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeName = originalName.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
    const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${uniquePrefix}-${safeName}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const axiosClient = axios.create({
  timeout: 1500,
  maxRedirects: 5,
  responseType: 'arraybuffer',
  httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true, timeout: 1500 }),
  httpAgent: new http.Agent({ keepAlive: true }),
  decompress: true,
  validateStatus: () => true,
});

function detectEncoding(buffer: Buffer, contentType: string): string {
  const ctMatch = contentType.match(/charset=([^\s;]+)/i);
  if (ctMatch) return ctMatch[1].toLowerCase().replace(/['"]/g, '');
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8';
  return 'utf-8';
}

async function fetchAndParse(url: string, retries = 2): Promise<any> {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axiosClient.get(url, {
        headers: {
          'User-Agent': randomUA(),
          'Accept': '*/*',
          'Connection': 'keep-alive',
          'Referer': new URL(url).origin,
        },
      });

      const status = response.status;
      const contentType: string = response.headers['content-type'] || '';

      if (status >= 400) continue;

      if (contentType && !contentType.includes('text/') && !contentType.includes('application/xhtml') && !contentType.includes('application/xml') && !contentType.includes('application/json')) {
        return { title: '非文本内容', text: `[⚠️ 系统日志：无法提取非文本内容 (${contentType})]`, url, hasError: true };
      }

      const buffer = Buffer.from(response.data);
      const encoding = detectEncoding(buffer, contentType);
      let html: string;
      try { html = iconv.decode(buffer, encoding); } catch { html = buffer.toString('utf-8'); }

      const $ = cheerio.load(html);
      $('script, style, noscript, iframe, svg, canvas, nav, footer, header, aside').remove();

      const title = $('title').text().trim() || url;
      let text = $('body').text();
      text = text.replace(/\t/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      return { title: title.trim(), text, url, hasError: false };

    } catch (err: any) {
      lastError = err?.message || String(err);
      if (attempt === retries) return { title: '网页抓取失败', text: `[⚠️ 系统日志：尝试均失败。原因：${lastError}]`, url, hasError: true };
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return { title: '网页抓取失败', text: `[⚠️ 系统日志：未知错误]`, url, hasError: true };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3005;

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  app.post('/api/upload', upload.array('files', 10), async (req, res) => {
    const files = req.files as Express.Multer.File[];
    const isPublic = req.headers['x-is-public'] === 'true';
    const username = decodeURIComponent(req.headers['x-user-name'] as string || 'anonymous');
    const results = [];
    
    for (const file of files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const fileUrlPrivate = `/uploads/users/${username}/${file.filename}`;
      const fileUrlPublic = `/uploads/public/${file.filename}`;

      if (isPublic) {
        try { fs.copyFileSync(file.path, path.join('uploads', 'public', file.filename)); } catch(e) {}
      }

      // 获取当前上传文件的 MD5 值
      const currentFileHash = getFileHash(file.path);
      
      // 判断专属库和公共库中是否已经存在完全相同的文件
      const isPrivateDuplicate = vectorDB.some(v => v.namespace === username && v.fileHash === currentFileHash);
      const isPublicDuplicate = isPublic && vectorDB.some(v => v.namespace === 'public' && v.fileHash === currentFileHash);

      let text = '';
      let parseError: string | undefined;

      try {
        const result = await parseFile(file.path, originalName);
        text = result.text || '';
        parseError = result.error;
      } catch (unexpected: any) {
        parseError = `解析进程崩溃: ${unexpected?.message ?? String(unexpected)}`;
      }
      
      if (parseError && !text) {
        text = `[⚠️ 系统日志：文件解析失败。详情：${parseError}]`;
      }
      
      if (text && !text.startsWith('[⚠️')) {
        const chunks = chunkText(text);
        if (chunks.length > 0) {
          
          if (isPrivateDuplicate && (!isPublic || isPublicDuplicate)) {
             console.log(`[Upload API] ⚡ 文件 ${originalName} (MD5匹配) 已存在，跳过知识库重复构建。`);
          } else {
             // 核心逻辑：如果名字相同但是 MD5 不同，说明用户更新了文件，删除同名的旧版向量
             const hasOldPrivateVersion = vectorDB.some(v => v.namespace === username && v.name === originalName && v.type === 'file');
             if (hasOldPrivateVersion) {
               console.log(`[Upload API] ♻️ 文件 ${originalName} 已更新，正在清理旧版知识库向量...`);
               vectorDB = vectorDB.filter(v => !(v.namespace === username && v.name === originalName && v.type === 'file'));
             }

             if (isPublic) {
               const hasOldPublicVersion = vectorDB.some(v => v.namespace === 'public' && v.name === originalName && v.type === 'file');
               if (hasOldPublicVersion) {
                 vectorDB = vectorDB.filter(v => !(v.namespace === 'public' && v.name === originalName && v.type === 'file'));
               }
             }

             enqueueEmbeddingTask(async () => {
              let embedSuccess = true;
              for (let i = 0; i < chunks.length; i += 10) {
                const batch = chunks.slice(i, i + 10);
                const embeddings = await getEmbeddings(batch);
                
                if (!embeddings || embeddings.length === 0) {
                  embedSuccess = false;
                  break;
                }

                embeddings.forEach((vec, idx) => {
                  if (!isPrivateDuplicate) {
                    vectorDB.push({
                      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2),
                      sourceId: fileUrlPrivate,
                      namespace: username,
                      type: 'file',
                      name: originalName,
                      content: batch[idx],
                      vector: vec,
                      url: fileUrlPrivate,
                      fileHash: currentFileHash
                    });
                  }

                  if (isPublic && !isPublicDuplicate) {
                    vectorDB.push({
                      id: Date.now().toString() + '-pub-' + Math.random().toString(36).substring(2),
                      sourceId: fileUrlPublic,
                      namespace: 'public',
                      type: 'file',
                      name: originalName,
                      content: batch[idx],
                      vector: vec,
                      url: fileUrlPublic,
                      fileHash: currentFileHash
                    });
                  }
                });
              }
              if (embedSuccess) saveVectorDB();
            });
          }
        }
      }
      results.push({ url: fileUrlPrivate, name: originalName, text, ...(parseError ? { warning: parseError } : {}) });
    }
    return res.json({ files: results });
  });

  app.post('/api/rag/search', async (req, res) => {
    const { query, username } = req.body;
    if (!query || !username) return res.status(400).json({ error: '缺少参数' });
    
    const queryEmbs = await getEmbeddings([query]);
    if (!queryEmbs || queryEmbs.length === 0) return res.json({ citations: [] });
    
    const queryVec = queryEmbs[0];
    const targetNamespaces = [username, `${username}_chat`, 'public'];
    const candidates = vectorDB.filter(v => targetNamespaces.includes(v.namespace));
    
    const results = candidates.map(c => ({
      ...c,
      score: cosineSimilarity(queryVec, c.vector)
    }));

    results.sort((a, b) => b.score - a.score);

    const citations = [];
    const seen = new Set();
    
    for (const r of results) {
      if (r.score > 0.4 && !seen.has(r.content)) {
        seen.add(r.content);
        citations.push({ id: r.id, type: r.type, name: r.name, content: r.content, score: r.score, url: r.url });
        if (citations.length >= 5) break;
      }
    }
    
    return res.json({ citations });
  });

  app.get('/api/logs/:username', (req, res) => {
    const filePath = path.join('logs', 'users', `${req.params.username}.json`);
    if (!fs.existsSync(filePath)) return res.json([]);
    return res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  });

  let logSaveTimers: Record<string, NodeJS.Timeout> = {};

  app.post('/api/logs/:username', (req, res) => {
    const username = req.params.username;
    const userDir = path.join('logs', 'users');
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    
    const logs = req.body;
    fs.writeFileSync(path.join(userDir, `${username}.json`), JSON.stringify(logs, null, 2));
    
    if (logSaveTimers[username]) clearTimeout(logSaveTimers[username]);

    logSaveTimers[username] = setTimeout(() => {
      enqueueEmbeddingTask(async () => {
        const ns = `${username}_chat`;
        let tasks: { msgId: string, name: string, content: string }[] = [];
        
        logs.forEach((session: any) => {
          session.messages.forEach((msg: any) => {
            if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
              const currentContent = msg.content.substring(0, 1000);
              const chunksForMsg = vectorDB.filter(v => v.sourceId === msg.id);
              const existingLen = chunksForMsg.reduce((acc, curr) => acc + curr.content.length, 0);

              if (Math.abs(existingLen - currentContent.length) > 10 || chunksForMsg.length === 0) {
                vectorDB = vectorDB.filter(v => v.sourceId !== msg.id);
                tasks.push({ msgId: msg.id, name: session.title || '对话', content: currentContent });
              }
            }
          });
        });

        if (tasks.length === 0) return;

        for (let i = 0; i < tasks.length; i += 10) {
          const batch = tasks.slice(i, i + 10);
          const embs = await getEmbeddings(batch.map(t => t.content));
          
          if (!embs || embs.length === 0) continue;

          embs.forEach((vec, idx) => {
            vectorDB.push({
              id: Date.now().toString() + '-' + Math.random().toString(36).substring(2),
              sourceId: batch[idx].msgId,
              namespace: ns,
              type: 'chat',
              name: batch[idx].name,
              content: batch[idx].content,
              vector: vec
            });
          });
        }
        saveVectorDB();
      });
    }, 3005);
    
    return res.json({ success: true });
  });

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

  app.post('/api/parse-url', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '缺少 URL' });
    const result = await fetchAndParse(url);
    return res.json(result);
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
        const scriptPath = path.join(process.cwd(), 'parser.py');
        const promptPath = path.join(process.cwd(), 'src', 'audit_supplier', 'prompt.txt');

        if (!fs.existsSync(scriptPath) || !fs.existsSync(promptPath)) {
          return res.status(500).json({ error: '服务端未找到 parser.py 或 prompt.txt' });
        }

        const { stdout } = await execPromise(`python "${scriptPath}" "${batchDir}"`);
        const promptTemplate = fs.readFileSync(promptPath, 'utf-8');
        const finalPrompt = promptTemplate.replace('{excel_content}', stdout);

        res.json({ prompt: finalPrompt });
      } catch (error: any) {
        res.status(500).json({ error: '模板解析失败', details: error.message });
      }
    });
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
    syncPublicFolder();
  });
}

startServer().catch((e) => {
  console.error('服务启动失败:', e);
  process.exit(1);
});
