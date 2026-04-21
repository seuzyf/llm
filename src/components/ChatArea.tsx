// src/components/ChatArea.tsx
import React, { useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession, MessageFile, MessageImage } from '../types';
import { browserFetchUrl } from '../utils/browserFetch';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

interface ChatAreaProps {
  session: ChatSession;
  onUpdateMessages: (messages: Message[]) => void;
  isGenerating: boolean;
  setIsGenerating: (val: boolean) => void;
}

const MAX_UPLOAD_LENGTH = 100000;
const MAX_CONTEXT_CHARS = 80000;

export default function ChatArea({ session, onUpdateMessages, isGenerating, setIsGenerating }: ChatAreaProps) {
  const abortControllerRef = useRef<AbortController | null>(null);

  const processChatStream = async (currentMessages: Message[], assistantId: string) => {
    abortControllerRef.current = new AbortController();
    let assistantMsg = currentMessages.find(m => m.id === assistantId)!;

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

        // 构造发送给后端的结构
        let msgPayload: any = { role: m.role, content: text };
        
        // 如果包含图片，组装到 api 请求中（供您的 LM Studio sdk 使用）
        if (m.images && m.images.length > 0) {
          msgPayload.images = m.images.map(img => img.base64);
        }

        if (currentChars + text.length > MAX_CONTEXT_CHARS) {
          const remainingSpace = MAX_CONTEXT_CHARS - currentChars;
          if (apiMessages.length === 0) {
            msgPayload.content = text.substring(0, remainingSpace) + '\n\n...[系统介入：为防止崩溃，本次请求已被动态裁剪尾部内容]...';
            apiMessages.unshift(msgPayload);
            currentChars += msgPayload.content.length;
          } else if (remainingSpace > 2000) {
            msgPayload.content = text.substring(0, remainingSpace) + '\n\n...[系统介入：更早的历史记忆已被清理]...';
            apiMessages.unshift(msgPayload);
            currentChars += msgPayload.content.length;
          }
          break;
        } else {
          apiMessages.unshift(msgPayload);
          currentChars += text.length;
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

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((line) => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '');
              if (dataStr === '[DONE]') continue;
              try {
                const data = JSON.parse(dataStr);
                const content = data.choices[0]?.delta?.content || '';
                const reasoning = data.choices[0]?.delta?.reasoning_content || '';

                if (content || reasoning) {
                  if (reasoning) assistantMsg.reasoningContent = (assistantMsg.reasoningContent || '') + reasoning;
                  if (content) assistantMsg.content += content;
                  onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
                }
              } catch (e) {
                console.error('解析流数据出错', e, line);
              }
            }
          }
        }
      }
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
      assistantMsg.timestamp = Date.now();
      onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
      setIsGenerating(false);
      abortControllerRef.current = null;
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
    selectedImages: MessageImage[]
  ) => {
    const userMsgId = uuidv4();
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

    // 处理文档类文件上传
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

    // 处理 URL 抓取
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

    await processChatStream(currentMessages, assistantId);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#1e1e2e]">
      <MessageList session={session} isGenerating={isGenerating} />
      <ChatInput 
        isGenerating={isGenerating} 
        onSubmit={handleNormalSubmit} 
        onTemplateSubmit={handleTemplateSubmit} 
      />
    </div>
  );
}
