import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession, MessageFile } from '../types';
import {
  Send, Paperclip, X, FileText, Brain,
  ChevronDown, ChevronRight, AlertTriangle, FileUp, Link, AlertCircle,
  FileSpreadsheet
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { browserFetchUrl } from '../utils/browserFetch';

interface ChatAreaProps {
  session: ChatSession;
  onUpdateMessages: (messages: Message[]) => void;
  isGenerating: boolean;
  setIsGenerating: (val: boolean) => void;
}

const MAX_UPLOAD_LENGTH = 100000;
const MAX_CONTEXT_CHARS = 80000;

export default function ChatArea({ session, onUpdateMessages, isGenerating, setIsGenerating }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  
  const [templateMode, setTemplateMode] = useState<string | null>(null);
  const [templateFiles, setTemplateFiles] = useState<File[]>([]);

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

  const processChatStream = async (currentMessages: Message[], assistantId: string) => {
    abortControllerRef.current = new AbortController();
    let assistantMsg = currentMessages.find(m => m.id === assistantId)!;

    try {
      let currentChars = 0;
      const apiMessages: { role: string; content: string }[] = [];
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
            apiMessages.unshift({ role: m.role, content: text });
            currentChars += text.length;
          } else if (remainingSpace > 2000) {
            text = text.substring(0, remainingSpace) + '\n\n...[系统介入：更早的历史记忆已被清理]...';
            apiMessages.unshift({ role: m.role, content: text });
            currentChars += text.length;
          }
          break;
        } else {
          apiMessages.unshift({ role: m.role, content: text });
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
      // 记录流式结束时间作为最终的回复时间
      assistantMsg.timestamp = Date.now();
      onUpdateMessages([...currentMessages.slice(0, -1), { ...assistantMsg }]);
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleTemplateSubmit = async () => {
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
      
      setTemplateMode(null);
      setTemplateFiles([]);

      const assistantId = uuidv4();
      const assistantMsg: Message = {
        id: assistantId, role: 'assistant', content: '', reasoningContent: '', timestamp: Date.now(),
      };
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
            } else { reject(new Error('上传失败')); }
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

    if (hasUrls) {
      for (const url of allUrlsToParse) {
        let result: any = null;
        console.log(`[URL抓取] 浏览器端尝试: ${url}`);
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
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {session.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
            <div className="w-16 h-16 bg-[#313244] rounded-full flex items-center justify-center">
              <Send size={24} className="text-gray-400" />
            </div>
            <p className="text-lg">发送消息或添加文件、网址作为附件开始对话</p>
          </div>
        ) : (
          session.messages.map((message) => {
            // 判断当前是否是正在执行中的助手回复
            const isCurrentGenerating = isGenerating && message.role === 'assistant' && message.id === session.messages[session.messages.length - 1]?.id;

            return (
              <div
                key={message.id}
                className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                {/* 增加时间戳显示 */}
                <span className="text-xs text-gray-500 mb-1 mx-2 opacity-75">
                  {message.role === 'user' 
                    ? `发送于 ${new Date(message.timestamp).toLocaleString('zh-CN', { hour12: false })}` 
                    : isCurrentGenerating
                      ? '正在回复...'
                      : `回复完成于 ${new Date(message.timestamp).toLocaleString('zh-CN', { hour12: false })}`
                  }
                </span>

                <div
                  className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 ${
                    message.role === 'user'
                      ? message.isTemplateCall ? 'bg-blue-900/40 border border-blue-700/50 text-white' : 'bg-blue-600 text-white'
                      : 'bg-[#313244] text-gray-200'
                  }`}
                >
                  {message.role === 'user' ? (
                    message.isTemplateCall ? (
                      <div className="flex flex-col gap-3 min-w-[280px]">
                        <div className="font-medium flex items-center gap-2 text-blue-300">
                          <FileSpreadsheet size={18} />
                          <span>系统任务：供应商答复自动审核</span>
                        </div>
                        
                        <div className="text-sm text-blue-200/80">已接收以下文件，开始进行答复审核：</div>
                        
                        {message.files && message.files.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                            {message.files.map((file, idx) => {
                              const isError = message.content.includes('⚠️ **系统提示:**');
                              return (
                                <div key={idx} className="bg-black/30 p-2.5 rounded-lg flex items-center justify-between border border-white/10 shadow-sm">
                                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                                    <FileText size={16} className="text-blue-400 shrink-0" />
                                    <span className="truncate text-sm text-gray-200" title={file.name}>
                                      {file.name}
                                    </span>
                                  </div>
                                  {message.isUploading ? (
                                    <span className="text-[10px] text-blue-400 shrink-0 ml-2 whitespace-nowrap">正在处理... {message.progress}%</span>
                                  ) : isError ? (
                                    <span className="text-[10px] text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded shrink-0 ml-2 whitespace-nowrap">执行异常</span>
                                  ) : (
                                    <span className="text-[10px] text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded shrink-0 ml-2 whitespace-nowrap">拼接提取成功</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        
                        {message.content.includes('⚠️ **系统提示:**') && (
                          <div className="mt-2 text-xs text-red-300 bg-red-950/40 p-2.5 rounded border border-red-800/50">
                            {message.content.split('⚠️ **系统提示:**')[1]}
                          </div>
                        )}
                      </div>
                    ) : (
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
                    )
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
                                  (isGenerating && !displayReasoning ? '模型正在思考中...' : '')}
                              </ReactMarkdown>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-[#1e1e2e] border-t border-gray-800 shrink-0">
        <div className="max-w-4xl mx-auto relative">
          
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setTemplateMode(templateMode === 'audit_supplier' ? null : 'audit_supplier')}
              disabled={isGenerating}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-t-xl text-sm font-medium transition-all ${
                templateMode === 'audit_supplier'
                  ? 'bg-[#313244] text-blue-400 border border-b-0 border-gray-700 shadow-[0_4px_0_0_#313244] translate-y-[1px] relative z-10'
                  : 'bg-transparent text-gray-400 hover:text-gray-200 border border-transparent'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <FileSpreadsheet size={16} />
              审核供应商答复
            </button>
          </div>

          {(selectedFiles.length > 0 || selectedUrls.length > 0) && !templateMode && (
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
                    disabled={isGenerating}
                    className="text-gray-400 hover:text-red-400 ml-1 disabled:opacity-50"
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
                    disabled={isGenerating}
                    className="text-gray-400 hover:text-red-400 ml-1 disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className={`relative flex items-end gap-2 transition-all shadow-sm ${
              templateMode
                ? 'bg-[#2a2b3d] border border-gray-700 rounded-b-xl rounded-tr-xl p-6 shadow-lg'
                : `bg-[#313244] border border-gray-700 p-2 ${
                    selectedFiles.length > 0 || selectedUrls.length > 0
                      ? 'rounded-b-xl rounded-tr-xl'
                      : 'rounded-xl'
                  } focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500`
            }`}
          >
            {templateMode === 'audit_supplier' ? (
              <div className="w-full flex flex-col items-center justify-center min-h-[120px] text-center animate-in fade-in zoom-in-95 duration-200">
                <FileSpreadsheet size={40} className="text-gray-500 mb-3 opacity-50" />
                <p className="text-gray-300 mb-4 text-sm">请上传需要智能审核的《供应商答复》Excel表格或邮件</p>
                <p className="text-gray-300 mb-4 text-sm">支持多选，建议单次处理内容不要太长，可分多次上传处理，模型单次处理文件越少结果越准确</p>
                <input
                  type="file"
                  multiple
                  disabled={isGenerating}
                  accept=".xls,.xlsx,.xlsm,.xlsb,.csv,.msg"
                  onChange={(e) => {
                    if (e.target.files) {
                      const files = Array.from(e.target.files);
                      const validExts = ['.xls', '.xlsx', '.xlsm', '.xlsb', '.csv', '.msg'];
                      
                      const hasInvalidFormat = files.some(f => {
                        const name = f.name.toLowerCase();
                        return !validExts.some(ext => name.endsWith(ext));
                      });

                      if (hasInvalidFormat) {
                        const confirm = window.confirm('提示：您选择了非表格（Excel/CSV）格式的文件，直接使用该模板流程可能会导致数据提取异常。\n\n确认要继续吗？');
                        if (!confirm) {
                          e.target.value = ''; 
                          return;
                        }
                      }
                      setTemplateFiles(files);
                    }
                  }}
                  className="mb-4 text-sm text-gray-400 file:mr-4 file:py-2.5 file:px-5 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                />
                
                {templateFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6 justify-center max-w-lg">
                    {templateFiles.map((f, i) => (
                      <span key={i} className="text-xs bg-gray-800 text-gray-300 px-3 py-1.5 rounded-md border border-gray-700 flex items-center gap-1.5">
                        <FileText size={12} className="text-blue-400"/>
                        {f.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setTemplateMode(null); setTemplateFiles([]); }}
                    disabled={isGenerating}
                    className="px-6 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleTemplateSubmit}
                    disabled={templateFiles.length === 0 || isGenerating}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                  >
                    提取并开始审核
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  disabled={isGenerating}
                  className="hidden"
                />

                <div className="relative shrink-0 mb-1 ml-1" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setShowAttachMenu(!showAttachMenu)}
                    disabled={isGenerating}
                    className={`p-2 transition-colors rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                      showAttachMenu
                        ? 'bg-gray-700 text-blue-400'
                        : 'text-gray-400 hover:text-blue-400 hover:bg-gray-800'
                    }`}
                    title="添加附件"
                  >
                    <Paperclip size={20} />
                  </button>

                  {showAttachMenu && !isGenerating && (
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
                  disabled={isGenerating}
                  placeholder={isGenerating ? "模型正在处理任务中，请稍候..." : "输入消息..."}
                  className={`w-full max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none py-2.5 px-3 text-gray-200 placeholder-gray-500 outline-none ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                  rows={1}
                />

                <div className="flex shrink-0 mb-1 mr-1">
                  <button
                    type="submit"
                    disabled={
                      isGenerating ||
                      (!input.trim() && selectedFiles.length === 0 && selectedUrls.length === 0)
                    }
                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </>
            )}
          </form>

          {!templateMode && (
            <div className="text-center mt-2 text-xs text-gray-500">
              按 Enter 发送。目前上下文长度为120k，单次对话只能处理10万字以下数据
            </div>
          )}
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
