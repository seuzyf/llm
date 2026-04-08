import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const officeParser = require('officeparser'); // 引入

if (!fs.existsSync('logs')) fs.mkdirSync('logs');
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // 修复中文文件名乱码：Buffer.from(..., 'latin1').toString('utf8')
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + originalName);
  }
});
const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  app.post('/api/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: '上传失败', details: err.message });
      next();
    });
  }, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });

    const filePath = req.file.path;
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    let extractedText = '';

    try {
      const ext = path.extname(originalName).toLowerCase();
      
      if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        extractedText = pdfData.text;
      } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
        const workbook = xlsx.readFile(filePath);
        workbook.SheetNames.forEach(sheetName => {
          extractedText += `\n--- 表格: ${sheetName} ---\n${xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName])}`;
        });
      } else if (['.pptx', '.ppt', '.docx', '.doc'].includes(ext)) {
        try {
          // 修复：officeparser 在某些版本下直接暴露为函数，或在内部包含 parseOffice
          const parser = officeParser.parseOffice || officeParser;
          extractedText = await new Promise((resolve, reject) => {
            parser(filePath, (data: any, err: any) => {
              if (err) reject(err);
              else resolve(data);
            });
          });
        } catch (officeErr) {
          extractedText = `【解析失败】：无法读取该 Office 文件内容。`;
        }
      } else if (['.txt', '.md', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.c', '.cpp'].includes(ext)) {
        extractedText = fs.readFileSync(filePath, 'utf-8');
      }
    } catch (err) {
      console.error('文件解析错误:', err);
    }

    res.json({ url: `/uploads/${req.file.filename}`, name: originalName, text: extractedText });
  });

  // ... 其余 API (logs, chat, models) 保持不变 ...
  app.get('/api/logs/:username', (req, res) => {
    const filePath = path.join('logs', `${req.params.username}.json`);
    res.json(fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : []);
  });

  app.post('/api/logs/:username', (req, res) => {
    fs.writeFileSync(path.join('logs', `${req.params.username}.json`), JSON.stringify(req.body));
    res.json({ success: true });
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const response = await fetch(process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        if (response.body) {
          const reader = (response.body as any).getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } else {
        res.json(await response.json());
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/models', async (req, res) => {
    try {
      const baseUrl = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions').replace('/chat/completions', '');
      const response = await fetch(`${baseUrl}/models`);
      res.json(await response.json());
    } catch (error: any) {
      res.status(503).json({ error: 'LM Studio 未连接', isConnectionRefused: true });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务启动: http://localhost:${PORT}`);
  });
}

startServer();
