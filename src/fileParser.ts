// src/fileParser.ts
import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────
export interface ParseResult {
  text: string;
  error?: string;
}

// ─────────────────────────────────────────
// PDF 解析（规避 ESM default 导出问题）
// ─────────────────────────────────────────
async function parsePdf(filePath: string): Promise<ParseResult> {
  const dataBuffer = fs.readFileSync(filePath);

  // pdf-parse 在某些构建环境下 default 导出层级不固定，逐层尝试
  let parseFn: ((buf: Buffer) => Promise<{ text: string }>) | null = null;

  try {
    // 优先用 createRequire 走 CJS 路径，避免 Vite/ESM 转换干扰
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    parseFn = require('pdf-parse');
  } catch {
    // fallback：动态 import
    try {
      const mod = await import('pdf-parse');
      parseFn = mod.default ?? (mod as any);
    } catch (e: any) {
      return { text: '', error: `pdf-parse 加载失败: ${e.message}` };
    }
  }

  if (typeof parseFn !== 'function') {
    return { text: '', error: 'pdf-parse 未能识别为可调用函数' };
  }

  try {
    const result = await parseFn(dataBuffer);
    return { text: result.text ?? '' };
  } catch (e: any) {
    return { text: '', error: `PDF 解析失败: ${e.message}` };
  }
}

// ─────────────────────────────────────────
// Excel / CSV 解析
// ─────────────────────────────────────────
function parseSpreadsheet(filePath: string): ParseResult {
  try {
    const workbook = xlsx.readFile(filePath, { cellDates: true });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = xlsx.utils.sheet_to_csv(sheet);
      if (csv?.trim()) {
        parts.push(`--- 表格: ${sheetName} ---\n${csv.trim()}`);
      }
    }

    return { text: parts.join('\n\n') || '（表格内容为空）' };
  } catch (e: any) {
    return { text: '', error: `表格解析失败: ${e.message}` };
  }
}

// ─────────────────────────────────────────
// Office 文档解析（docx / pptx / ppt / doc）
// ─────────────────────────────────────────
async function parseOfficeDoc(filePath: string): Promise<ParseResult> {
  try {
    // officeparser 同样存在 ESM/CJS 混用问题，用 createRequire 优先
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const officeparser = require('officeparser');

    // officeparser v3+ 提供 parseOfficeAsync
    if (typeof officeparser.parseOfficeAsync === 'function') {
      const text = await officeparser.parseOfficeAsync(filePath, {
        outputErrorToConsole: false,
        newlineDelimiter: '\n',
        ignoreNotes: false,
      });
      return { text: typeof text === 'string' ? text : String(text) };
    }

    // officeparser v2 提供回调式 parseOffice
    if (typeof officeparser.parseOffice === 'function') {
      const text = await new Promise<string>((resolve, reject) => {
        officeparser.parseOffice(
          filePath,
          (data: unknown, err: unknown) => {
            // v2 回调签名：(data, err) —— 注意 err 在后
            if (err instanceof Error) return reject(err);
            if (typeof err === 'string' && err) return reject(new Error(err));
            if (data instanceof Error) return reject(data);
            resolve(typeof data === 'string' ? data : String(data ?? ''));
          }
        );
      });
      return { text };
    }

    return { text: '', error: 'officeparser 未找到可用的解析方法' };
  } catch (e: any) {
    return { text: '', error: `Office 解析失败: ${e.message}` };
  }
}

// ─────────────────────────────────────────
// 纯文本类解析
// ─────────────────────────────────────────
function parseText(filePath: string): ParseResult {
  try {
    return { text: fs.readFileSync(filePath, 'utf-8') };
  } catch (e: any) {
    return { text: '', error: `文本读取失败: ${e.message}` };
  }
}

// ─────────────────────────────────────────
// 扩展名分类表
// ─────────────────────────────────────────
const EXT_MAP = {
  pdf: ['.pdf'],
  spreadsheet: ['.xlsx', '.xls', '.csv'],
  office: ['.docx', '.doc', '.pptx', '.ppt'],
  text: [
    '.txt', '.md', '.json', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx',
    '.py', '.c', '.cpp', '.java',
    '.html', '.css', '.xml', '.sh',
  ],
} as const;

// ─────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────
export async function parseFile(
  filePath: string,
  originalName: string
): Promise<ParseResult> {
  const ext = path.extname(originalName).toLowerCase();

  if (EXT_MAP.pdf.includes(ext as any)) {
    return parsePdf(filePath);
  }

  if (EXT_MAP.spreadsheet.includes(ext as any)) {
    return parseSpreadsheet(filePath);
  }

  if (EXT_MAP.office.includes(ext as any)) {
    return parseOfficeDoc(filePath);
  }

  if (EXT_MAP.text.includes(ext as any)) {
    return parseText(filePath);
  }

  return {
    text: '',
    error: `暂不支持解析 ${ext} 格式的文件`,
  };
}
