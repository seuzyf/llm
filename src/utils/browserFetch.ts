/**
 * 浏览器端直接抓取网页 HTML，绕过服务器网络限制。
 * 对有 CORS 限制的网站会失败，失败后交由调用方处理。
 */

// 检测并解码编码
function decodeBuffer(buffer: ArrayBuffer, contentType: string): string {
    const bytes = new Uint8Array(buffer);
  
    // 检测 BOM
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(buffer);
    }
  
    // 从 Content-Type 取编码
    let charset = '';
    const ctMatch = contentType.match(/charset=([^\s;]+)/i);
    if (ctMatch) charset = ctMatch[1].replace(/['"]/g, '').toLowerCase();
  
    // 从 HTML meta 取编码（前 2048 字节）
    if (!charset) {
      const preview = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
      const metaMatch =
        preview.match(/charset=["']?([a-zA-Z0-9\-_]+)/i) ||
        preview.match(/<meta[^>]+charset["'\s]*=["'\s]*([a-zA-Z0-9\-_]+)/i);
      if (metaMatch) charset = metaMatch[1].toLowerCase();
    }
  
    // 尝试用检测到的编码解码
    if (charset && charset !== 'utf-8') {
      try {
        return new TextDecoder(charset).decode(buffer);
      } catch {
        // 编码名不合法，fallback
      }
    }
  
    return new TextDecoder('utf-8').decode(buffer);
  }
  
  // 从 HTML 提取标题和正文
  function parseHtml(html: string, url: string): { title: string; text: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
  
    // 移除无用节点
    const removeSelectors = [
      'script', 'style', 'noscript', 'iframe', 'svg',
      'nav', 'footer', 'header', 'aside',
      '[class*="ad"]', '[id*="ad"]',
      '[class*="banner"]', '[id*="banner"]',
      '[class*="recommend"]', '[class*="related"]',
      '[class*="comment"]', '[id*="comment"]',
    ];
    removeSelectors.forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });
  
    // 提取标题
    const title =
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      doc.querySelector('title')?.textContent?.trim() ||
      url;
  
    // 语义化内容区优先提取
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-content',
      '.article_content',
      '.post-content',
      '.entry-content',
      '.news-content',
      '.text-content',
      '#article',
      '#content',
      '.content',
      '.article',
    ];
  
    let text = '';
    for (const sel of contentSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 200) {
        text = el.textContent;
        break;
      }
    }
  
    // fallback: body 全文
    if (!text || text.trim().length < 100) {
      text = doc.body?.textContent || '';
    }
  
    // 清理空白
    text = text
      .replace(/\t/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  
    return { title: title.trim(), text };
  }
  
  export interface BrowserFetchResult {
    title: string;
    text: string;
    url: string;
    hasError: boolean;
    errorMsg?: string;
    source: 'browser' | 'server';
  }
  
  export async function browserFetchUrl(url: string): Promise<BrowserFetchResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
  
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8',
          'Cache-Control': 'no-cache',
        },
      });
  
      clearTimeout(timer);
  
      if (!response.ok) {
        return {
          title: '网页访问被拒',
          text: `[⚠️ 系统日志：HTTP ${response.status}，目标网站拒绝了访问请求。]`,
          url,
          hasError: true,
          errorMsg: `HTTP ${response.status}`,
          source: 'browser',
        };
      }
  
      const contentType = response.headers.get('content-type') || '';
      const buffer = await response.arrayBuffer();
      const html = decodeBuffer(buffer, contentType);
      const { title, text } = parseHtml(html, url);
  
      // SPA 检测
      let finalText = text;
      if (text.length < 200 && (html.includes('id="root"') || html.includes('id="app"'))) {
        finalText += '\n\n[系统检测提示：该网页为前端动态渲染(SPA)，静态抓取无法获取实际内容。]';
      }
  
      return {
        title,
        text: finalText,
        url,
        hasError: false,
        source: 'browser',
      };
  
    } catch (err: any) {
      const isCors =
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('CORS') ||
        err.message?.includes('NetworkError');
  
      const isTimeout = err.name === 'AbortError';
  
      let errorMsg = err.message || String(err);
      if (isCors) errorMsg = 'CORS_BLOCKED'; // 特殊标记，让调用方知道要回退
      if (isTimeout) errorMsg = '浏览器端请求超时（20秒）';
  
      return {
        title: '浏览器端抓取失败',
        text: `[⚠️ 系统日志：浏览器端抓取失败，原因：${errorMsg}]`,
        url,
        hasError: true,
        errorMsg,
        source: 'browser',
      };
    }
  }
