// src/components/ChatArea.tsx
import React, { useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession, MessageFile, MessageImage, Citation } from '../types';
import { browserFetchUrl } from '../utils/browserFetch';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

interface ChatAreaProps {
  session: ChatSession;
  onUpdateMessages: (messages: Message[]) => void;
  isGenerating: boolean;
  setIsGenerating: (val: boolean) => void;
}

export default function ChatArea({ session, onUpdateMessages, isGenerating, setIsGenerating }: ChatAreaProps) {
  const MAX_UPLOAD_LENGTH = 128000;
  const MAX_CONTEXT_CHARS = 120000;
  const abortControllerRef = useRef<AbortController | null>(null);

  const getUsername = () => localStorage.getItem('chat_username') || 'anonymous';

  const processChatStream = async (currentMessages: Message[], assistantId: string, injectedCitations?: Citation[]) => {
    abortControllerRef.current = new AbortController();
    let assistantMsg = currentMessages.find(m => m.id === assistantId)!;

    if (injectedCitations && injectedCitations.length > 0) {
      assistantMsg.citations = injectedCitations;
    }

    let finalBotContent = '';
    let finalUserContent = '';
    let firstTokenTime = 0; // 用于记录大模型吐出第一个字的时间

    try {
      let currentChars = 0;
      const apiMessages: any[] = [];
      const historyWindow = currentMessages
        .filter((m) => m.id !== assistantId)
        .slice(-15)
        .reverse();

      for (const m of historyWindow) {
        let text = m.content;
        
        if (m.files && m.files.length > 0 && !m.isTemplateCall) {
          const hasTextFiles = m.files.some((f) => f.content);
          if (hasTextFiles) {
            text += `\n\n[附件数据]:\n`;
            m.files.forEach((f) => {
              if (f.content) {
                text += `--- ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\`\n`;
              }
            });
          }
        }

        if (currentChars + text.length > MAX_CONTEXT_CHARS) {
          const remainingSpace = MAX_CONTEXT_CHARS - currentChars;
          if (apiMessages.length === 0) {
            text = text.substring(0, remainingSpace) + '\n\n...[系统介入：为防止崩溃，本次请求已被动态裁剪尾部内容]...';
          } else if (remainingSpace > 2000) {
            text = text.substring(0, remainingSpace) + '\n\n...[系统介入：更早的历史记忆已被清理]...';
          }
        }

        currentChars += text.length;

        if (m.images && m.images.length > 0) {
          const contentArray: any[] = [{ type: 'text', text: text }];
          m.images.forEach(img => {
            contentArray.push({ type: 'image_url', image_url: { url: img.base64 } });
          });
          apiMessages.unshift({ role: m.role, content: contentArray });
        } else {
          apiMessages.unshift({ role: m.role, content: text });
        }

        if (currentChars > MAX_CONTEXT_CHARS) break;
      }

      if (injectedCitations && injectedCitations.length > 0) {
        const lastUserMsg = apiMessages[apiMessages.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user') {
          const contextStr = injectedCitations.map((c: any) => `[来源: ${c.name}]\n${c.content}`).join('\n\n');
          const augmentedInput = `参考以下检索到的历史资料来回答我的问题：\n\n<检索资料>\n${contextStr}\n</检索资料>\n\n我的问题：${lastUserMsg.content}`;
          
          if (typeof lastUserMsg.content === 'string') {
            lastUserMsg.content = augmentedInput;
          } else if (Array.isArray(lastUserMsg.content)) {
            const textObj = lastUserMsg.content.find((c: any) => c.type === 'text');
            if (textObj) textObj.text = augmentedInput;
          }
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        let errText = '';
        try {
          const errJson = await response.json();
          errText = errJson.error?.message || errJson.error || JSON.stringify(errJson);
        } catch { errText = await response.text(); }
        throw new Error(errText || `请求失败，状态码: ${response.status}`);
      }
      if (!response.body) throw new Error('没有返回内容');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let lastRenderTime = Date.now(); 

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((line) => line.trim() !== '');

          let hasUpdates = false;

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '');
              if (dataStr === '[DONE]') continue;
              try {
                const data = JSON.parse(dataStr);
                const content = data.choices[0]?.delta?.content || '';
                const reasoning = data.choices[0]?.delta?.reasoning_content || '';

                if (content || reasoning) {
                  // 记录首字输出时间
                  if (!firstTokenTime) firstTokenTime = Date.now();
                  
                  if (reasoning) assistantMsg.reasoningContent = (assistantMsg.reasoningContent || '') + reasoning;
                  if (content) assistantMsg.content += content;
                  hasUpdates = true;
                }
              } catch (e) {}
            }
          }

          if (hasUpdates) {
            const now = Date.now();
            if (now - lastRenderTime > 60) {
              onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
              lastRenderTime = now;
            }
          }
        }
      }
      
      // 流式读取彻底完毕，计算生成速度
      const endTime = Date.now();
      if (firstTokenTime > 0 && endTime > firstTokenTime) {
        const durationSec = (endTime - firstTokenTime) / 1000;
        const totalChars = assistantMsg.content.length + (assistantMsg.reasoningContent?.length || 0);
        if (durationSec > 0.1) { // 避免除以0或极短时间造成的数值异常
          assistantMsg.speed = `${(totalChars / durationSec).toFixed(1)} 字/秒`;
        }
      }
      
      onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
      
      finalBotContent = assistantMsg.content;
      finalUserContent = currentMessages.slice().reverse().find(m => m.role === 'user')?.content || '';
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        let friendlyError = error.message;
        if (friendlyError.includes('context length') || friendlyError.includes('n_ctx') || friendlyError.includes('too large')) {
          friendlyError = `模型负载过重（Context Overflow）。底层报错: ${friendlyError}\n\n**建议**：当前超长内容已被自动拦截隔离，您可以直接在下方输入框**继续提问**。`;
        }
        assistantMsg.content += `\n\n> ⚠️ **系统中断:** ${friendlyError}`;
        onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
      }
    } finally {
      // 1. 彻底关闭生成状态，解放 UI 主线程
      assistantMsg.timestamp = Date.now();
      onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
      setIsGenerating(false);
      abortControllerRef.current = null;

      // 2. 利用 requestIdleCallback（浏览器空闲期执行）彻底杜绝抢占资源
      // 这样就算延迟再久，也一定是等用户在安静看回复时才执行
      if (finalBotContent && finalBotContent.trim() !== '') {
        const embedUsername = getUsername();
        const executeEmbedding = () => {
          fetch('/api/rag/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: embedUsername,
              prompt: finalUserContent,
              response: finalBotContent,
              timestamp: Date.now()
            })
          }).catch(err => console.error('[Embedding API] 后台同步失败:', err));
        };

        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(executeEmbedding, { timeout: 10000 });
        } else {
          // 降级方案：延迟 2 秒执行
          setTimeout(executeEmbedding, 2000);
        }
      }
    }
  };

  const handleTemplateSubmit = async (templateFiles: File[]) => {
    if (templateFiles.length === 0 || isGenerating) return;

    const userMsgId = uuidv4();
    const userMessage: Message = {
      id: userMsgId,
      role: 'user',
      content: '【技术应答审核】',
      timestamp: Date.now(),
      files: templateFiles.map(f => ({ name: f.name, url: '', content: '' })),
      isUploading: true,
      progress: 0,
      isTemplateCall: true, 
    };

    let currentMessages = [...session.messages, userMessage];
    onUpdateMessages(currentMessages);
    setIsGenerating(true);

    try {
      const formData = new FormData();
      templateFiles.forEach(f => formData.append('files', f));

      const res = await fetch('/api/template/audit', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || '模板解析失败');
      }

      const data = await res.json();
      const finalPrompt = data.prompt;

      currentMessages = currentMessages.map(m =>
        m.id === userMsgId ? { ...m, content: finalPrompt, isUploading: false, progress: 100 } : m
      );
      onUpdateMessages(currentMessages);

      const assistantId = uuidv4();
      const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', reasoningContent: '', timestamp: Date.now() };
      currentMessages = [...currentMessages, assistantMsg];
      onUpdateMessages(currentMessages);

      await processChatStream(currentMessages, assistantId);

    } catch (error: any) {
      currentMessages = currentMessages.map((m) =>
        m.id === userMsgId ? { ...m, isUploading: false, content: m.content + `\n\n> ⚠️ **系统提示:** ${error.message}` } : m
      );
      onUpdateMessages(currentMessages);
      setIsGenerating(false);
    }
  };

  const handleNormalSubmit = async (
    input: string, 
    selectedFiles: File[], 
    selectedUrls: string[],
    selectedImages: MessageImage[],
    isRAGEnabled: boolean = false,
    isPublic: boolean = false
  ) => {
    const userMsgId = uuidv4();
    let fetchedCitations: Citation[] = [];

    if (isRAGEnabled && input.trim()) {
      try {
        const ragRes = await fetch('/api/rag/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: input, username: getUsername() })
        });
        if (ragRes.ok) {
          const ragData = await ragRes.json();
          if (ragData.citations && ragData.citations.length > 0) {
            fetchedCitations = ragData.citations;
          }
        }
      } catch (err) { console.error('[RAG Frontend] RAG 检索网络请求失败', err); }
    }

    const currentAttachedUrls = [...selectedUrls];
    const urlRegex = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;
    const inlineUrls = input.match(urlRegex) || [];
    const allUrlsToParse = Array.from(new Set([...currentAttachedUrls, ...inlineUrls]));
    const hasUrls = allUrlsToParse.length > 0;
    const isUploadingFlag = selectedFiles.length > 0 || hasUrls;

    const userMessage: Message = {
      id: userMsgId,
      role: 'user',
      content: input,
      timestamp: Date.now(),
      images: selectedImages,
      files: [
        ...selectedFiles.map((f) => ({ name: f.name, url: '', content: '' })),
        ...currentAttachedUrls.map((url) => ({ name: url, url, content: '' })),
      ],
      isUploading: isUploadingFlag,
      progress: selectedFiles.length > 0 ? 0 : 100,
    };

    let currentMessages = [...session.messages, userMessage];
    onUpdateMessages(currentMessages);
    setIsGenerating(true);

    let uploadedMessageFiles: MessageFile[] = [];
    let parsedUrlFiles: MessageFile[] = [];

    if (selectedFiles.length > 0) {
      try {
        const uploadResult = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const formData = new FormData();
          selectedFiles.forEach((file) => formData.append('files', file));

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              currentMessages = currentMessages.map((m) =>
                m.id === userMsgId ? { ...m, progress: percent } : m
              );
              onUpdateMessages(currentMessages);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
            else reject(new Error('上传失败'));
          };

          xhr.onerror = () => reject(new Error('网络错误'));
          xhr.open('POST', '/api/upload');
          xhr.setRequestHeader('X-User-Name', encodeURIComponent(getUsername()));
          xhr.setRequestHeader('X-Is-Public', isPublic ? 'true' : 'false');
          xhr.send(formData);
        });

        uploadedMessageFiles = uploadResult.files.map((resItem: any) => {
          let text = resItem.text || '';
          let isTruncated = false;
          if (text.length > MAX_UPLOAD_LENGTH) {
            text = text.substring(0, MAX_UPLOAD_LENGTH) + '\n\n...[⚠️ 前端提示：文件过大，后半部分已被舍弃]...';
            isTruncated = true;
          }
          return { name: resItem.name, url: resItem.url, content: text, isTruncated };
        });
      } catch (error) {
        currentMessages = currentMessages.map((m) =>
          m.id === userMsgId ? { ...m, isUploading: false, content: m.content + '\n\n> ⚠️ **系统提示:** 文件上传或解析失败' } : m
        );
        onUpdateMessages(currentMessages);
        setIsGenerating(false);
        return;
      }
    }

    if (hasUrls) {
      for (const url of allUrlsToParse) {
        let result: any = null;
        const browserResult = await browserFetchUrl(url);

        if (!browserResult.hasError) {
          result = browserResult;
        } else if (browserResult.errorMsg === 'CORS_BLOCKED') {
          try {
            const res = await fetch('/api/parse-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            const data = await res.json();
            result = { ...data, source: 'server' };
          } catch (apiErr: any) {
            result = { title: '接口请求失败', text: `[⚠️ 系统日志：服务端调用失败，详情：${apiErr.message}]`, url, hasError: true, source: 'server' };
          }
        } else {
          try {
            const res = await fetch('/api/parse-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            const data = await res.json();
            result = data.hasError ? browserResult : { ...data, source: 'server' };
          } catch { result = browserResult; }
        }

        let text: string = result.text || '';
        let isTruncated = false;
        if (!result.hasError && text.length > MAX_UPLOAD_LENGTH) {
          text = text.substring(0, MAX_UPLOAD_LENGTH) + '\n\n...[⚠️ 前端提示：网页内容过大，后半部分已被舍弃]...';
          isTruncated = true;
        }
        parsedUrlFiles.push({ name: result.title ? (result.hasError ? result.title : `网页: ${result.title}`) : url, url, content: text, isTruncated, hasError: result.hasError ?? false } as any);
      }
    }

    const allAttachments = [...uploadedMessageFiles, ...parsedUrlFiles];
    currentMessages = currentMessages.map((m) =>
      m.id === userMsgId ? { ...m, isUploading: false, progress: 100, files: allAttachments } : m
    );
    onUpdateMessages(currentMessages);

    const assistantId = uuidv4();
    let assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', reasoningContent: '', timestamp: Date.now() };
    currentMessages = [...currentMessages, assistantMsg];
    onUpdateMessages(currentMessages);

    await processChatStream(currentMessages, assistantId, fetchedCitations);
  };

  const handleEquipmentAudit = async (reportContent: string) => {
    const assistantMsgId = uuidv4();
    const msg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: reportContent,
      timestamp: Date.now(),
    };
    onUpdateMessages([...session.messages, msg]);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#1e1e2e]">
      <MessageList session={session} isGenerating={isGenerating} />
      <ChatInput
        isGenerating={isGenerating}
        onSubmit={handleNormalSubmit}
        onTemplateSubmit={handleTemplateSubmit}
        onEquipmentAudit={handleEquipmentAudit}
      />
    </div>
  );
}
