import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession } from '../types';
import { Send, Loader2, StopCircle, Paperclip, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface ChatAreaProps {
  session: ChatSession;
  onUpdateMessages: (messages: Message[]) => void;
  selectedModel: string;
}

export default function ChatArea({ session, onUpdateMessages, selectedModel }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
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
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
    if (e.target) e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !selectedFile) || isGenerating) return;

    let uploadedFileUrl = '';
    let uploadedFileName = '';
    let fileTextContent = '';

    if (selectedFile) {
      const formData = new FormData();
      formData.append('file', selectedFile);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        
        if (data.url) {
          uploadedFileUrl = data.url;
          uploadedFileName = data.name;
          // 直接接收后端的纯文本提取结果
          if (data.text) {
            fileTextContent = data.text;
          }
        }
      } catch (e) {
        console.error('上传或解析文件失败', e);
      }
    }

    let messageContent = input.trim();
    if (uploadedFileName) {
      messageContent = messageContent + (messageContent ? '\n' : '') + `[系统: 用户已上传文件 - ${uploadedFileName}]`;
    }

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      fileUrl: uploadedFileUrl,
      fileName: uploadedFileName,
      fileContent: fileTextContent,
    };

    const newMessages = [...session.messages, userMessage];
    onUpdateMessages(newMessages);
    setInput('');
    setSelectedFile(null);
    setIsGenerating(true);

    const assistantMessageId = uuidv4();
    let assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    onUpdateMessages([...newMessages, assistantMessage]);

    abortControllerRef.current = new AbortController();

    try {
      // 剥离多模态结构，全部强制转为纯文本发给模型
      const apiMessages = newMessages.map(m => {
        let finalContent = m.content;
        if (m.fileContent) {
          finalContent += `\n\n[文件 ${m.fileName} 的提取内容如下]:\n\`\`\`\n${m.fileContent}\n\`\`\``;
        }
        return { role: m.role, content: finalContent };
      });

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
        throw new Error(`HTTP 错误! 状态码: ${response.status}`);
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
                if (content) {
                  assistantMessage.content += content;
                  onUpdateMessages([...newMessages, { ...assistantMessage }]);
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
        console.error('对话出错:', error);
        assistantMessage.content += '\n\n**错误:** 无法连接到本地模型或模型拒绝了该请求。';
        onUpdateMessages([...newMessages, { ...assistantMessage }]);
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
            <p className="text-lg">发送消息或文档开始对话</p>
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
                    <div className="whitespace-pre-wrap">{message.content.replace(/\[系统: 用户已上传文件 - .*\]/, '')}</div>
                    
                    {message.fileName && (
                      <div className="mt-1 text-xs bg-black/20 p-2 rounded-md flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Paperclip size={14} />
                          <a href={message.fileUrl} target="_blank" rel="noreferrer" className="underline hover:text-blue-200 break-all">
                            {message.fileName}
                          </a>
                        </div>
                        {message.fileContent ? (
                           <span className="text-[10px] text-green-300 opacity-90 border border-green-400/30 px-1.5 py-0.5 rounded whitespace-nowrap">文本已提取</span>
                        ) : (
                           <span className="text-[10px] text-gray-400 opacity-90 border border-gray-400/30 px-1.5 py-0.5 rounded whitespace-nowrap">附件</span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="prose prose-sm md:prose-base max-w-none prose-invert">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({node, inline, className, children, ...props}: any) {
                          const match = /language-(\w+)/.exec(className || '')
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
                            <code {...props} className={`${className} bg-[#181825] px-1.5 py-0.5 rounded text-sm font-mono text-pink-300`}>
                              {children}
                            </code>
                          )
                        }
                      }}
                    >
                      {message.content || '...'}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-[#1e1e2e] border-t border-gray-800">
        <div className="max-w-4xl mx-auto relative">
          {selectedFile && (
            <div className="absolute -top-12 left-0 right-0">
              <div className="bg-[#313244] inline-flex items-center gap-2 px-3 py-1.5 rounded-t-lg border border-b-0 border-gray-700 text-sm">
                <Paperclip size={14} className="text-blue-400" />
                <span className="truncate max-w-[200px] text-gray-300">{selectedFile.name}</span>
                <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-red-400">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit} className={`relative flex items-end gap-2 bg-[#313244] border border-gray-700 p-2 transition-all ${selectedFile ? 'rounded-b-xl rounded-tr-xl' : 'rounded-xl'} focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500`}>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 mb-1 text-gray-400 hover:text-blue-400 transition-colors"
              title="上传文档"
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
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  title="停止生成"
                >
                  <StopCircle size={20} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={(!input.trim() && !selectedFile)}
                  className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="text-center mt-2 text-xs text-gray-500">
            按 Enter 发送。支持解析 PDF、Excel、Word、PPTX 以及代码文本文件。
          </div>
        </div>
      </div>
    </div>
  );
}
