// src/fileParser.ts
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export interface ParseResult {
  text: string;
  error?: string;
}

// 探测网页或文本的编码格式
function detectEncoding(buffer: Buffer): string {
  const head = buffer.slice(0, 4096).toString('latin1');
  const metaMatch = head.match(/charset=["']?([a-zA-Z0-9\-_]+)/i) || head.match(/<meta[^>]+charset["'\s]*=["'\s]*([a-zA-Z0-9\-_]+)/i);
  if (metaMatch) return metaMatch[1].toLowerCase();
  
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8';
  return 'utf-8';
}

export async function parseFile(filePath: string, originalName: string): Promise<ParseResult> {
  console.log(`\n========== [FileParser 解析流水线开始] ==========`);
  console.log(`[FileParser] 文件原名: ${originalName}`);
  console.log(`[FileParser] 存储路径: ${filePath}`);

  const absPath = path.resolve(filePath);
  const ext = path.extname(originalName).toLowerCase();
  console.log(`[FileParser] 解析扩展名: ${ext}`);

  // ==========================================
  // 1. Node.js 原生极速解析通道
  // ==========================================
  const nativeSupported = ['.html', '.htm', '.xml', '.txt', '.csv', '.json', '.md'];
  
  if (nativeSupported.includes(ext)) {
    console.log(`[FileParser] -> 命中 Node.js 原生解析通道`);
    try {
      const buffer = fs.readFileSync(absPath);
      let encoding = 'utf-8';
      
      if (['.html', '.htm', '.xml'].includes(ext)) {
        encoding = detectEncoding(buffer);
      }
      
      let content = '';
      try {
        content = iconv.decode(buffer, encoding);
      } catch (decodeErr: any) {
        content = buffer.toString('utf-8');
      }

      if (['.html', '.htm', '.xml'].includes(ext)) {
        const $ = cheerio.load(content);
        $('script, style, noscript, iframe, svg, canvas, nav, footer, header, aside').remove();
        let text = $('body').text() || $.text();
        text = text.replace(/\t/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        console.log(`========== [FileParser 解析流水线结束] ==========\n`);
        return { text };
      } else {
        console.log(`========== [FileParser 解析流水线结束] ==========\n`);
        return { text: content.trim() };
      }
    } catch (err: any) {
      console.error(`[FileParser] ❌ Node 原生解析抛出异常，回退到 Python:`, err.message);
    }
  }

  // ==========================================
  // 2. Python 复杂文档解析通道
  // ==========================================
  console.log(`[FileParser] -> 进入 Python 解析通道...`);
  return new Promise((resolve) => {
    const scriptPath = path.resolve('parser.py');
    const py = spawn('python', [scriptPath, absPath]);

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => { stdout += data.toString(); });
    py.stderr.on('data', (data) => { stderr += data.toString(); });

    py.on('close', (code) => {
      const outText = stdout.trim();
      const errText = stderr.trim();

      if (code !== 0 || (!outText && errText)) {
        console.log(`[FileParser] ❌ Python 解析器失败`);
        console.log(`========== [FileParser 解析流水线结束] ==========\n`);
        return resolve({ text: '', error: errText || 'Python 解析器异常崩溃' });
      }
      
      console.log(`[FileParser] ✅ Python 解析成功`);
      console.log(`========== [FileParser 解析流水线结束] ==========\n`);
      resolve({ text: outText });
    });
    
    py.on('error', (err) => {
      console.log(`========== [FileParser 解析流水线结束] ==========\n`);
      resolve({ text: '', error: `环境错误: ${err.message}` });
    });
  });
}
