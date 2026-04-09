// src/components/ChatArea.tsx
import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession, MessageFile } from '../types';
import { Send, StopCircle, Paperclip, X, FileText, Brain, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface ChatAreaProps {
  session: ChatSession;
  onUpdateMessages: (messages: Message[]) => void;
  selectedModel: string;
}

// 单文件上传的最大字符保护（前端预处理阈值，防止单体巨无霸）
const MAX_UPLOAD_LENGTH = 100000; 
// 核心防线：全局上下文最大字符限制（确保永远不会触发 n_ctx 溢出，约留出 2-4万 token 余量）
const MAX_CONTEXT_CHARS = 80000; 

export default function ChatArea({ session, onUpdateMessages, selectedModel }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  
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
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

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
      setSelectedFiles(prev => [...prev, ...newFiles].slice(0, 10)); 
    }
    if (e.target) e.target.value = '';
  };

  const removeSelectedFile = (indexToRemove: number) => {
    setSelectedFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && selectedFiles.length === 0) || isGenerating) return;

    const userMsgId = uuidv4();
    const currentInput = input.trim();
    const currentFilesToUpload = [...selectedFiles];

    const userMessage: Message = {
      id: userMsgId,
      role: 'user',
      content: currentInput,
      timestamp: Date.now(),
      files: currentFilesToUpload.map(f => ({ name: f.name, url: '', content: '' })),
      isUploading: currentFilesToUpload.length > 0,
      progress: currentFilesToUpload.length > 0 ? 0 : 100,
    };

    let currentMessages = [...session.messages, userMessage];
    onUpdateMessages(currentMessages);
    
    setInput('');
    setSelectedFiles([]);
    setIsGenerating(true);

    let uploadedMessageFiles: MessageFile[] = [];

    // --- 1. 文件上传与解析 ---
    if (currentFilesToUpload.length > 0) {
      try {
        const uploadResult = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const formData = new FormData();
          currentFilesToUpload.forEach(file => formData.append('files', file));

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              currentMessages = currentMessages.map(m => 
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
            text = text.substring(0, MAX_UPLOAD_LENGTH) + '\n\n...[⚠️ 前端提示：文件过大，后半部分已被舍弃]...';
            isTruncated = true;
          }
          
          return {
            name: resItem.name,
            url: resItem.url,
            content: text,
            isTruncated
          };
        });

        currentMessages = currentMessages.map(m => 
          m.id === userMsgId ? { 
            ...m, 
            isUploading: false, 
            progress: 100, 
            files: uploadedMessageFiles,
          } : m
        );
        onUpdateMessages(currentMessages);

      } catch (error) {
        currentMessages = currentMessages.map(m => 
          m.id === userMsgId ? { ...m, isUploading: false, content: m.content + '\n\n> ⚠️ **系统提示:** 文件上传或解析失败' } : m
        );
        onUpdateMessages(currentMessages);
        setIsGenerating(false);
        return; 
      }
    }

    // --- 2. 准备 AI 助理消息框 ---
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
      // --- 3. 动态上下文装箱（核心修复逻辑） ---
      let currentChars = 0;
      const apiMessages: {role: string, content: string}[] = [];
      
      // 倒序遍历（从最新消息开始往老消息倒推），确保优先记住最新对话
      const historyWindow = currentMessages.filter(m => m.id !== assistantId).slice(-15).reverse();

      for (const m of historyWindow) {
        let text = m.content;
        if (m.files && m.files.length > 0) {
          const hasTextFiles = m.files.some(f => f.content);
          if (hasTextFiles) {
            text += `\n\n[附件数据]:\n`;
            m.files.forEach((f, idx) => {
              if (f.content) {
                text += `--- ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\`\n`;
              }
            });
          }
        }

        // 检查加上这条消息后，是否超过了安全容量 MAX_CONTEXT_CHARS
        if (currentChars + text.length > MAX_CONTEXT_CHARS) {
          const remainingSpace = MAX_CONTEXT_CHARS - currentChars;
          
          if (apiMessages.length === 0) {
            // 情况 A：这是最新的一条消息，且本身就超长了（通常是刚传了巨型文件）。必须截断强制保留。
            text = text.substring(0, remainingSpace) + '\n\n...[系统介入：为防止崩溃，本次请求已被动态裁剪尾部内容]...';
            apiMessages.unshift({ role: m.role, content: text });
            currentChars += text.length;
          } else if (remainingSpace > 2000) {
            // 情况 B：历史消息，空间还剩一点，能塞多少塞多少
            text = text.substring(0, remainingSpace) + '\n\n...[系统介入：更早的历史记忆已被清理]...';
            apiMessages.unshift({ role: m.role, content: text });
            currentChars += text.length;
          }
          // 容量满，强行终止循环，彻底丢弃更老的消息（解除了历史卡死的魔咒）
          break; 
        } else {
          // 容量充足，完整放入装箱车
          apiMessages.unshift({ role: m.role, content: text });
          currentChars += text.length;
        }
      }

      // --- 4. 发起对话请求 ---
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

      // 捕获后端的具体报错原因
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
          const lines = chunk.split('\n').filter(line => line.trim() !== '');
          
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
        // 提供人性化的错误诊断
        if (friendlyError.includes('context length') || friendlyError.includes('n_ctx') || friendlyError.includes('too large')) {
          friendlyError = `模型负载过重（Context Overflow）。底层报错: ${friendlyError}\n\n**建议**：当前超长内容已被自动拦截隔离，您可以直接在下方输入框**继续提问**。`;
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
            <p className="text-lg">发送消息或多个文档开始对话</p>
          </div>
        ) : (
          session.messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[#313244] text-gray-200'}`}>
                {message.role === 'user' ? (
                  <div className="flex flex-col gap-2">
                    {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
                    
                    {message.files && message.files.length > 0 && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {message.files.map((file, idx) => (
                          <div key={idx} className="bg-black/20 p-3 rounded-lg w-full flex flex-col justify-between border border-white/5">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText size={16} className="text-blue-300 shrink-0" />
                              <span className="truncate text-sm" title={file.name}>{file.name}</span>
                            </div>
                            
                            {message.isUploading ? (
                              <div className="space-y-1.5 mt-auto">
                                <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                  <div className="bg-blue-400 h-full transition-all duration-200" style={{ width: `${message.progress || 0}%` }} />
                                </div>
                                <div className="text-[10px] text-gray-300 text-right">上传中 {message.progress}%</div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between mt-auto pt-2 gap-2">
                                <div className="flex gap-2 items-center">
                                  {file.url && <a href={file.url} target="_blank" rel="noreferrer" className="text-[10px] underline text-blue-200 hover:text-blue-100">下载</a>}
                                  {file.content ? (
                                    <span className="text-[10px] text-green-300 opacity-90 border border-green-400/30 px-1.5 py-0.5 rounded whitespace-nowrap">文本已提取</span>
                                  ) : (
                                    <span className="text-[10px] text-gray-400 opacity-90 border border-gray-400/30 px-1.5 py-0.5 rounded whitespace-nowrap">无文本</span>
                                  )}
                                </div>
                                {file.isTruncated && (
                                  <span 
                                    className="text-[10px] font-medium text-yellow-300 bg-yellow-400/20 border border-yellow-400/40 px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1 cursor-help" 
                                    title="内容超过阈值，已被截断以保证可用性"
                                  >
                                    <AlertTriangle size={10} />
                                    内容已截断
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full">
                    {(() => {
                      let displayContent = message.content;
                      let displayReasoning = message.reasoningContent || '';

                      if (displayContent.includes('<think>')) {
                        const thinkMatch = displayContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
                        if (thinkMatch) {
                          displayReasoning = (displayReasoning + '\n' + thinkMatch[1]).trim();
                          displayContent = displayContent.replace(/<think>([\s\S]*?)(?:<\/think>|$)/, '').trim();
                        }
                      }

                      return (
                        <>
                          {displayReasoning && (
                            <details className="mb-4 group bg-black/20 rounded-lg overflow-hidden border border-gray-700/50">
                              <summary className="flex items-center cursor-pointer p-3 text-sm text-gray-400 hover:text-gray-200 select-none">
                                <Brain size={16} className="mr-2 text-blue-400" />
                                <span className="font-medium">思考过程</span>
                                <span className="ml-auto opacity-50 group-open:hidden"><ChevronRight size={16} /></span>
                                <span className="ml-auto opacity-50 hidden group-open:block"><ChevronDown size={16} /></span>
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
                                code({node, inline, className, children, ...props}: any) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  return !inline && match ? (
                                    <SyntaxHighlighter {...props} children={String(children).replace(/\n$/, '')} style={vscDarkPlus} language={match[1]} PreTag="div" className="rounded-md my-2 !bg-[#181825]" />
                                  ) : (
                                    <code {...props} className={`${className} bg-[#181825] px-1.5 py-0.5 rounded text-sm font-mono text-pink-300`}>{children}</code>
                                  );
                                },
                                span({node, className, children, ...props}: any) {
                                  return <span className={className} {...props}>{children}</span>
                                }
                              }}
                            >
                              {displayContent || (isGenerating && !displayReasoning ? '...' : '')}
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
          {selectedFiles.length > 0 && (
            <div className="absolute -top-12 left-0 right-0 z-10 flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {selectedFiles.map((file, index) => (
                <div key={index} className="bg-[#313244] shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 text-sm shadow-md">
                  <Paperclip size={14} className="text-blue-400" />
                  <span className="truncate max-w-[150px] text-gray-300">{file.name}</span>
                  <button onClick={() => removeSelectedFile(index)} className="text-gray-400 hover:text-red-400 ml-1">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className={`relative flex items-end gap-2 bg-[#313244] border border-gray-700 p-2 transition-all shadow-sm ${selectedFiles.length > 0 ? 'rounded-b-xl rounded-tr-xl' : 'rounded-xl'} focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500`}>
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 mb-1 text-gray-400 hover:text-blue-400 transition-colors shrink-0"
              title="上传文档（可多选）"
            >
              <Paperclip size={20} />
            </button>
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
              placeholder="输入消息或上传文档、代码..."
              className="w-full max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none py-2.5 px-3 text-gray-200 placeholder-gray-500 outline-none"
              rows={1}
            />
            
            <div className="flex shrink-0 mb-1 mr-1">
              {isGenerating ? (
                <button type="button" onClick={handleStop} className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors">
                  <StopCircle size={20} />
                </button>
              ) : (
                <button type="submit" disabled={(!input.trim() && selectedFiles.length === 0)} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
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
    </div>
  );
}
