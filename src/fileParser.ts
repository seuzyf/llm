// src/fileParser.ts
import { spawn } from 'child_process';
import path from 'path';

export interface ParseResult {
  text: string;
  error?: string;
}

export async function parseFile(filePath: string, originalName: string): Promise<ParseResult> {
  return new Promise((resolve) => {
    const absPath = path.resolve(filePath);
    const scriptPath = path.resolve('parser.py');
    
    // Windows 环境下通常使用 'python'
    const py = spawn('python', [scriptPath, absPath]);

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => { stdout += data.toString(); });
    py.stderr.on('data', (data) => { stderr += data.toString(); });

    py.on('close', (code) => {
      if (code !== 0) {
        return resolve({ text: '', error: stderr.trim() || '解析失败' });
      }
      resolve({ text: stdout.trim() });
    });
    
    py.on('error', (err) => {
      resolve({ text: '', error: `环境错误: ${err.message}` });
    });
  });
}
