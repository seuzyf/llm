// server.ts
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { parseFile } from './src/fileParser.js';

// ─────────────────────────────────────────
// 目录初始化
// ─────────────────────────────────────────
['logs', 'uploads'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─────────────────────────────────────────
// Multer 存储配置
// ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => {
    // multer 在 latin1 环境下接收文件名，需转回 utf-8
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // 保留中文、英文、数字、点、横线、下划线；其余替换为 _
    const safeName = originalName.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
    const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${uniquePrefix}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

// ─────────────────────────────────────────
// 服务启动
// ─────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // ───────────────────────────────────────
  // 文件上传 & 解析
  // ───────────────────────────────────────
  app.post(
    '/api/upload',
    (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: '上传失败', details: err.message });
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: '未上传文件' });
      }

      const { path: filePath, filename } = req.file;
      // 还原真实文件名
      const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

      let text = '';
      let parseError: string | undefined;

      try {
        const result = await parseFile(filePath, originalName);
        text = result.text;
        parseError = result.error;
      } catch (unexpected: any) {
        // 兜底：任何未预期异常都不应让接口崩溃
        console.error('parseFile 意外异常:', unexpected);
        parseError = `系统异常: ${unexpected?.message ?? String(unexpected)}`;
      }

      // 如果有错误但没有文本内容，返回友好提示
      if (parseError && !text) {
        text = `【解析提示】${parseError}`;
      }

      return res.json({
        url: `/uploads/${filename}`,
        name: originalName,
        text,
        ...(parseError ? { warning: parseError } : {}),
      });
    }
  );

  // ───────────────────────────────────────
  // 日志读写
  // ───────────────────────────────────────
  app.get('/api/logs/:username', (req, res) => {
    const filePath = path.join('logs', `${req.params.username}.json`);
    try {
      if (!fs.existsSync(filePath)) return res.json([]);
      const raw = fs.readFileSync(filePath, 'utf-8');
      return res.json(JSON.parse(raw));
    } catch (e: any) {
      console.error('读取日志失败:', e);
      return res.status(500).json({ error: '日志读取失败' });
    }
  });

  app.post('/api/logs/:username', (req, res) => {
    try {
      fs.writeFileSync(
        path.join('logs', `${req.params.username}.json`),
        JSON.stringify(req.body, null, 2)
      );
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ error: '日志写入失败', details: e.message });
    }
  });

  // ───────────────────────────────────────
  // LM Studio 代理：流式 & 非流式
  // ───────────────────────────────────────
  const LM_BASE_URL = (
    process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions'
  ).replace('/chat/completions', '');

  app.post('/api/chat', async (req, res) => {
    try {
      const upstream = await fetch(`${LM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (!upstream.ok && !req.body.stream) {
        const errText = await upstream.text();
        return res.status(upstream.status).json({ error: errText });
      }

      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');

        if (!upstream.body) {
          return res.end();
        }

        // Node 18+ ReadableStream → pipe to response
        const reader = (upstream.body as unknown as ReadableStream<Uint8Array>).getReader();

        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // 如果客户端已断开则停止
            if (res.writableEnded) break;
            res.write(Buffer.from(value));
          }
          res.end();
        };

        pump().catch((e) => {
          console.error('流式传输异常:', e);
          if (!res.writableEnded) res.end();
        });

        // 客户端主动断开时释放 reader
        req.on('close', () => reader.cancel().catch(() => {}));
      } else {
        return res.json(await upstream.json());
      }
    } catch (error: any) {
      console.error('/api/chat 错误:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/models', async (_req, res) => {
    try {
      const response = await fetch(`${LM_BASE_URL}/models`);
      return res.json(await response.json());
    } catch (error: any) {
      return res.status(503).json({
        error: 'LM Studio 未连接',
        isConnectionRefused: true,
        details: error.message,
      });
    }
  });

  // ───────────────────────────────────────
  // 前端静态 / Vite 中间件
  // ───────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) =>
      res.sendFile(path.join(distPath, 'index.html'))
    );
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
