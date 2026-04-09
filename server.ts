// server.ts
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { parseFile } from './src/fileParser.js';

// 目录初始化
['logs', 'uploads'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer 存储配置
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
  limits: { fileSize: 100 * 1024 * 1024 }, // 每个文件限制 100 MB
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // ───────────────────────────────────────
  // 多文件上传 & 解析接口修改
  // ───────────────────────────────────────
  app.post(
    '/api/upload',
    (req, res, next) => {
      // 允许一次最多上传 10 个文件，字段名改为 'files'
      upload.array('files', 10)(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: '上传失败', details: err.message });
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        return res.status(400).json({ error: '未上传文件' });
      }

      const files = req.files as Express.Multer.File[];
      const results = [];

      // 遍历解析每一个上传的文件
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
          console.error(`文件 ${originalName} 解析异常:`, unexpected);
          parseError = `系统异常: ${unexpected?.message ?? String(unexpected)}`;
        }

        if (parseError && !text) {
          text = `【解析提示】${parseError}`;
        }

        results.push({
          url: `/uploads/${filename}`,
          name: originalName,
          text,
          ...(parseError ? { warning: parseError } : {}),
        });
      }

      // 返回包含所有文件解析结果的数组
      return res.json({ files: results });
    }
  );

  // ───────────────────────────────────────
  // 以下保持原有逻辑不变 (日志读写、AI代理、静态服务等)
  // ───────────────────────────────────────
  app.get('/api/logs/:username', (req, res) => {
    const filePath = path.join('logs', `${req.params.username}.json`);
    try {
      if (!fs.existsSync(filePath)) return res.json([]);
      return res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch (e: any) {
      return res.status(500).json({ error: '日志读取失败' });
    }
  });

  app.post('/api/logs/:username', (req, res) => {
    try {
      fs.writeFileSync(path.join('logs', `${req.params.username}.json`), JSON.stringify(req.body, null, 2));
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: '写入失败' });
    }
  });

  const LM_BASE_URL = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions').replace('/chat/completions', '');

  app.post('/api/chat', async (req, res) => {
    try {
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
    console.log(`   LM Studio: ${LM_BASE_URL}`);
  });
}

startServer().catch((e) => {
  console.error('服务启动失败:', e);
  process.exit(1);
});
