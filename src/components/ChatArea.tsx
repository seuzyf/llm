import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession, MessageFile } from '../types';
import {
  Send, StopCircle, Paperclip, X, FileText, Brain,
  ChevronDown, ChevronRight, AlertTriangle, FileUp, Link, AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { browserFetchUrl } from '../utils/browserFetch';

interface ChatAreaProps {
  session: ChatSession;
  onUpdateMessages: (messages: Message[]) => void;
  selectedModel: string;
}

const MAX_UPLOAD_LENGTH = 100000;
const MAX_CONTEXT_CHARS = 80000;

export default function ChatArea({ session, onUpdateMessages, selectedModel }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom(isGenerating ? 'auto' : 'smooth');
  }, [session.messages, isGenerating]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...newFiles].slice(0, 10));
    }
    if (e.target) e.target.value = '';
    setShowAttachMenu(false);
  };

  const removeSelectedFile = (indexToRemove: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const removeSelectedUrl = (indexToRemove: number) => {
    setSelectedUrls((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempUrl.trim()) {
      setSelectedUrls((prev) => [...prev, tempUrl.trim()]);
      setTempUrl('');
      setShowUrlModal(false);
      textareaRef.current?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (!input.trim() && selectedFiles.length === 0 && selectedUrls.length === 0) ||
      isGenerating
    )
      return;

    const userMsgId = uuidv4();
    const currentInput = input.trim();
    const currentFilesToUpload = [...selectedFiles];
    const currentAttachedUrls = [...selectedUrls];

    const urlRegex = /(https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;
    const inlineUrls = currentInput.match(urlRegex) || [];
    const allUrlsToParse = Array.from(new Set([...currentAttachedUrls, ...inlineUrls]));
    const hasUrls = allUrlsToParse.length > 0;

    const userMessage: Message = {
      id: userMsgId,
      role: 'user',
      content: currentInput,
      timestamp: Date.now(),
      files: [
        ...currentFilesToUpload.map((f) => ({ name: f.name, url: '', content: '' })),
        ...currentAttachedUrls.map((url) => ({ name: url, url, content: '' })),
      ],
      isUploading: currentFilesToUpload.length > 0 || hasUrls,
      progress: currentFilesToUpload.length > 0 ? 0 : 100,
    };

    let currentMessages = [...session.messages, userMessage];
    onUpdateMessages(currentMessages);

    setInput('');
    setSelectedFiles([]);
    setSelectedUrls([]);
    setIsGenerating(true);

    let uploadedMessageFiles: MessageFile[] = [];
    let parsedUrlFiles: MessageFile[] = [];

    // ── 1. 文件上传 ──────────────────────────────────────────
    if (currentFilesToUpload.length > 0) {
      try {
        const uploadResult = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const formData = new FormData();
          currentFilesToUpload.forEach((file) => formData.append('files', file));

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
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              reject(new Error('上传失败'));
            }
          };

          xhr.onerror = () => reject(new Error('网络错误'));
          xhr.open('POST', '/api/upload');
          xhr.send(formData);
        });

        uploadedMessageFiles = uploadResult.files.map((resItem: any) => {
          let text = resItem.text || '';
          let isTruncated = false;

          if (text.length > MAX_UPLOAD_LENGTH) {
            text =
              text.substring(0, MAX_UPLOAD_LENGTH) +
              '\n\n...[⚠️ 前端提示：文件过大，后半部分已被舍弃]...';
            isTruncated = true;
          }

          return { name: resItem.name, url: resItem.url, content: text, isTruncated };
        });
      } catch (error) {
        currentMessages = currentMessages.map((m) =>
          m.id === userMsgId
            ? { ...m, isUploading: false, content: m.content + '\n\n> ⚠️ **系统提示:** 文件上传或解析失败' }
            : m
        );
        onUpdateMessages(currentMessages);
        setIsGenerating(false);
        return;
      }
    }

    // ── 1.5 网址抓取（浏览器优先 + 服务端兜底）────────────────
    if (hasUrls) {
      for (const url of allUrlsToParse) {
        let result: any = null;

        // 第一步：浏览器端抓取
        console.log(`[URL抓取] 浏览器端尝试: ${url}`);
        const browserResult = await browserFetchUrl(url);

        if (!browserResult.hasError) {
          console.log(`[URL抓取] 浏览器端成功: ${url}`);
          result = browserResult;
        } else if (browserResult.errorMsg === 'CORS_BLOCKED') {
          // CORS 拦截 → 服务端兜底
          console.log(`[URL抓取] CORS拦截，回退服务端: ${url}`);
          try {
            const res = await fetch('/api/parse-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            const data = await res.json();
            result = { ...data, source: 'server' };
          } catch (apiErr: any) {
            result = {
              title: '接口请求失败',
              text: `[⚠️ 系统日志：服务端接口调用失败，详情：${apiErr.message}]`,
              url,
              hasError: true,
              source: 'server',
            };
          }
        } else {
          // 其他错误也尝试服务端兜底
          console.log(`[URL抓取] 浏览器端失败(${browserResult.errorMsg})，尝试服务端: ${url}`);
          try {
            const res = await fetch('/api/parse-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            const data = await res.json();
            result = data.hasError ? browserResult : { ...data, source: 'server' };
          } catch {
            result = browserResult;
          }
        }

        // 截断超长内容
        let text: string = result.text || '';
        let isTruncated = false;
        if (!result.hasError && text.length > MAX_UPLOAD_LENGTH) {
          text =
            text.substring(0, MAX_UPLOAD_LENGTH) +
            '\n\n...[⚠️ 前端提示：网页内容过大，后半部分已被舍弃]...';
          isTruncated = true;
        }

        parsedUrlFiles.push({
          name: result.title
            ? result.hasError
              ? result.title
              : `网页: ${result.title}`
            : url,
          url,
          content: text,
          isTruncated,
          hasError: result.hasError ?? false,
        } as any);
      }
    }

    // 更新消息附件
    const allAttachments = [...uploadedMessageFiles, ...parsedUrlFiles];
    currentMessages = currentMessages.map((m) =>
      m.id === userMsgId
        ? { ...m, isUploading: false, progress: 100, files: allAttachments }
        : m
    );
    onUpdateMessages(currentMessages);

    // ── 2. AI 助理消息占位 ────────────────────────────────────
    const assistantId = uuidv4();
    let assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      reasoningContent: '',
      timestamp: Date.now(),
    };

    currentMessages = [...currentMessages, assistantMsg];
    onUpdateMessages(currentMessages);
    abortControllerRef.current = new AbortController();

    try {
      // ── 3. 动态上下文装箱 ──────────────────────────────────
      let currentChars = 0;
      const apiMessages: { role: string; content: string }[] = [];
      const historyWindow = currentMessages
        .filter((m) => m.id !== assistantId)
        .slice(-15)
        .reverse();

      for (const m of historyWindow) {
        let text = m.content;
        if (m.files && m.files.length > 0) {
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
            text =
              text.substring(0, remainingSpace) +
              '\n\n...[系统介入：为防止崩溃，本次请求已被动态裁剪尾部内容]...';
            apiMessages.unshift({ role: m.role, content: text });
            currentChars += text.length;
          } else if (remainingSpace > 2000) {
            text =
              text.substring(0, remainingSpace) +
              '\n\n...[系统介入：更早的历史记忆已被清理]...';
            apiMessages.unshift({ role: m.role, content: text });
            currentChars += text.length;
          }
          break;
        } else {
          apiMessages.unshift({ role: m.role, content: text });
          currentChars += text.length;
        }
      }

      // ── 4. 发起对话请求 ────────────────────────────────────
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel || 'local-model',
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
        } catch {
          errText = await response.text();
        }
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
                  if (reasoning)
                    assistantMsg.reasoningContent =
                      (assistantMsg.reasoningContent || '') + reasoning;
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
        if (
          friendlyError.includes('context length') ||
          friendlyError.includes('n_ctx') ||
          friendlyError.includes('too large')
        ) {
          friendlyError =
            `模型负载过重（Context Overflow）。底层报错: ${friendlyError}\n\n` +
            `**建议**：当前超长内容已被自动拦截隔离，您可以直接在下方输入框**继续提问**。`;
        }
        assistantMsg.content += `\n\n> ⚠️ **系统中断:** ${friendlyError}`;
        onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#1e1e2e]">
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {session.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
            <div className="w-16 h-16 bg-[#313244] rounded-full flex items-center justify-center">
              <Send size={24} className="text-gray-400" />
            </div>
            <p className="text-lg">发送消息或添加文件、网址作为附件开始对话</p>
          </div>
        ) : (
          session.messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#313244] text-gray-200'
                }`}
              >
                {message.role === 'user' ? (
                  <div className="flex flex-col gap-2">
                    {message.content && (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    )}
                    {message.files && message.files.length > 0 && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {message.files.map((file, idx) => {
                          const isUrlAttachment =
                            file.url &&
                            file.url.startsWith('http') &&
                            file.url === file.name;
                          const isError =
                            (file as any).hasError === true ||
                            (!!file.content && file.content.startsWith('[⚠️'));
                          const isSuccess = !isError && !!file.content;

                          return (
                            <div
                              key={idx}
                              className="bg-black/20 p-3 rounded-lg w-full flex flex-col justify-between border border-white/5"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                {isUrlAttachment ? (
                                  <Link size={16} className="text-blue-300 shrink-0" />
                                ) : (
                                  <FileText size={16} className="text-blue-300 shrink-0" />
                                )}
                                <span className="truncate text-sm" title={file.name}>
                                  {file.name}
                                </span>
                              </div>

                              {message.isUploading ? (
                                <div className="space-y-1.5 mt-auto">
                                  <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className="bg-blue-400 h-full transition-all duration-200"
                                      style={{ width: `${message.progress || 0}%` }}
                                    />
                                  </div>
                                  <div className="text-[10px] text-gray-300 text-right">
                                    处理中 {message.progress}%
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between mt-auto pt-2 gap-2 flex-wrap">
                                  <div className="flex gap-2 items-center flex-wrap">
                                    {file.url && (
                                      <a
                                        href={file.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] underline text-blue-200 hover:text-blue-100"
                                      >
                                        {file.url.startsWith('http') ? '访问' : '下载'}
                                      </a>
                                    )}
                                    {isSuccess ? (
                                      <span className="text-[10px] text-green-300 opacity-90 border border-green-400/30 px-1.5 py-0.5 rounded whitespace-nowrap">
                                        {isUrlAttachment ? '内容已抓取' : '文本已提取'}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-red-300 opacity-90 border border-red-400/30 px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1">
                                        <AlertCircle size={10} />
                                        {isUrlAttachment ? '抓取失败' : '提取异常'}
                                      </span>
                                    )}
                                  </div>
                                  {file.isTruncated && (
                                    <span
                                      className="text-[10px] font-medium text-yellow-300 bg-yellow-400/20 border border-yellow-400/40 px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1 cursor-help"
                                      title="内容超过阈值，已被截断"
                                    >
                                      <AlertTriangle size={10} />
                                      内容已截断
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full">
                    {(() => {
                      let displayContent = message.content;
                      let displayReasoning = message.reasoningContent || '';

                      if (displayContent.includes('<think>')) {
                        const thinkMatch = displayContent.match(
                          /<think>([\s\S]*?)(?:<\/think>|$)/
                        );
                        if (thinkMatch) {
                          displayReasoning = (displayReasoning + '\n' + thinkMatch[1]).trim();
                          displayContent = displayContent
                            .replace(/<think>([\s\S]*?)(?:<\/think>|$)/, '')
                            .trim();
                        }
                      }

                      return (
                        <>
                          {displayReasoning && (
                            <details className="mb-4 group bg-black/20 rounded-lg overflow-hidden border border-gray-700/50">
                              <summary className="flex items-center cursor-pointer p-3 text-sm text-gray-400 hover:text-gray-200 select-none">
                                <Brain size={16} className="mr-2 text-blue-400" />
                                <span className="font-medium">思考过程</span>
                                <span className="ml-auto opacity-50 group-open:hidden">
                                  <ChevronRight size={16} />
                                </span>
                                <span className="ml-auto opacity-50 hidden group-open:block">
                                  <ChevronDown size={16} />
                                </span>
                              </summary>
                              <div className="p-4 pt-0 text-sm text-gray-400 border-t border-gray-700/50 mt-1 whitespace-pre-wrap font-mono leading-relaxed opacity-90">
                                {displayReasoning}
                              </div>
                            </details>
                          )}
                          <div className="prose prose-sm md:prose-base max-w-none prose-invert">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                code({ node, inline, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  return !inline && match ? (
                                    <SyntaxHighlighter
                                      {...props}
                                      children={String(children).replace(/\n$/, '')}
                                      style={vscDarkPlus}
                                      language={match[1]}
                                      PreTag="div"
                                      className="rounded-md my-2 !bg-[#181825]"
                                    />
                                  ) : (
                                    <code
                                      {...props}
                                      className={`${className} bg-[#181825] px-1.5 py-0.5 rounded text-sm font-mono text-pink-300`}
                                    >
                                      {children}
                                    </code>
                                  );
                                },
                                span({ node, className, children, ...props }: any) {
                                  return (
                                    <span className={className} {...props}>
                                      {children}
                                    </span>
                                  );
                                },
                              }}
                            >
                              {displayContent ||
                                (isGenerating && !displayReasoning ? '...' : '')}
                            </ReactMarkdown>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-[#1e1e2e] border-t border-gray-800 shrink-0">
        <div className="max-w-4xl mx-auto relative">
          {(selectedFiles.length > 0 || selectedUrls.length > 0) && (
            <div
              className="absolute -top-12 left-0 right-0 z-10 flex gap-2 overflow-x-auto pb-2"
              style={{ scrollbarWidth: 'none' }}
            >
              {selectedFiles.map((file, index) => (
                <div
                  key={`file-${index}`}
                  className="bg-[#313244] shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 text-sm shadow-md"
                >
                  <Paperclip size={14} className="text-blue-400" />
                  <span className="truncate max-w-[150px] text-gray-300">{file.name}</span>
                  <button
                    onClick={() => removeSelectedFile(index)}
                    className="text-gray-400 hover:text-red-400 ml-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {selectedUrls.map((url, index) => (
                <div
                  key={`url-${index}`}
                  className="bg-[#313244] shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 text-sm shadow-md"
                >
                  <Link size={14} className="text-blue-400" />
                  <span className="truncate max-w-[150px] text-gray-300" title={url}>
                    {url}
                  </span>
                  <button
                    onClick={() => removeSelectedUrl(index)}
                    className="text-gray-400 hover:text-red-400 ml-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className={`relative flex items-end gap-2 bg-[#313244] border border-gray-700 p-2 transition-all shadow-sm ${
              selectedFiles.length > 0 || selectedUrls.length > 0
                ? 'rounded-b-xl rounded-tr-xl'
                : 'rounded-xl'
            } focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500`}
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="relative shrink-0 mb-1 ml-1" ref={menuRef}>
              <button
                type="button"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                className={`p-2 transition-colors rounded-lg ${
                  showAttachMenu
                    ? 'bg-gray-700 text-blue-400'
                    : 'text-gray-400 hover:text-blue-400 hover:bg-gray-800'
                }`}
                title="添加附件"
              >
                <Paperclip size={20} />
              </button>

              {showAttachMenu && (
                <div className="absolute bottom-[calc(100%+8px)] left-0 w-36 bg-[#181825] border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-[#313244] hover:text-white transition-colors"
                  >
                    <FileUp size={16} />
                    <span>上传文档</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUrlModal(true);
                      setShowAttachMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-[#313244] hover:text-white transition-colors border-t border-gray-700/50"
                  >
                    <Link size={16} />
                    <span>添加网址</span>
                  </button>
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="输入消息..."
              className="w-full max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none py-2.5 px-3 text-gray-200 placeholder-gray-500 outline-none"
              rows={1}
            />

            <div className="flex shrink-0 mb-1 mr-1">
              {isGenerating ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  <StopCircle size={20} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !input.trim() &&
                    selectedFiles.length === 0 &&
                    selectedUrls.length === 0
                  }
                  className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={20} />
                </button>
              )}
            </div>
          </form>

          <div className="text-center mt-2 text-xs text-gray-500">
            按 Enter 发送。目前上下文长度为120k，单次对话只能处理10万字以下数据
          </div>
        </div>
      </div>

      {showUrlModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#181825] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-800">
              <h3 className="font-medium text-gray-200 flex items-center gap-2">
                <Link size={18} className="text-blue-400" />
                添加网页附件
              </h3>
              <button
                onClick={() => setShowUrlModal(false)}
                className="text-gray-400 hover:text-red-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddUrl} className="p-5 space-y-5">
              <div className="space-y-2">
                <label className="text-sm text-gray-400 block">
                  请输入需要大模型阅读的外部链接：
                </label>
                <input
                  type="url"
                  autoFocus
                  value={tempUrl}
                  onChange={(e) => setTempUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="w-full px-4 py-3 bg-[#313244] border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-shadow"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUrlModal(false)}
                  className="px-5 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!tempUrl.trim()}
                  className="px-5 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  确定添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
