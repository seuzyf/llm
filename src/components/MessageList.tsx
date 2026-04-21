// src/components/MessageList.tsx
import React, { useEffect, useRef } from 'react';
import { Message, ChatSession } from '../types';
import { Send, FileText, Link, AlertTriangle, AlertCircle, Brain, ChevronRight, ChevronDown, FileSpreadsheet } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MessageListProps {
  session: ChatSession;
  isGenerating: boolean;
}

export default function MessageList({ session, isGenerating }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom(isGenerating ? 'auto' : 'smooth');
  }, [session.messages, isGenerating]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
      {session.messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
          <div className="w-16 h-16 bg-[#313244] rounded-full flex items-center justify-center">
            <Send size={24} className="text-gray-400" />
          </div>
          <p className="text-lg">发送消息或添加图片、文件、网址作为附件开始对话</p>
        </div>
      ) : (
        session.messages.map((message) => {
          const isCurrentGenerating = isGenerating && message.role === 'assistant' && message.id === session.messages[session.messages.length - 1]?.id;

          return (
            <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-gray-500 mb-1 mx-2 opacity-75">
                {message.role === 'user' 
                  ? `发送于 ${new Date(message.timestamp).toLocaleString('zh-CN', { hour12: false })}` 
                  : isCurrentGenerating
                    ? '正在回复...'
                    : `回复完成于 ${new Date(message.timestamp).toLocaleString('zh-CN', { hour12: false })}`
                }
              </span>

              <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 ${
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
                                  <span className="truncate text-sm text-gray-200" title={file.name}>{file.name}</span>
                                </div>
                                {message.isUploading ? (
                                  <span className="text-[10px] text-blue-400 shrink-0 ml-2 whitespace-nowrap">处理中 {message.progress}%</span>
                                ) : isError ? (
                                  <span className="text-[10px] text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded shrink-0 ml-2">执行异常</span>
                                ) : (
                                  <span className="text-[10px] text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded shrink-0 ml-2">提取成功</span>
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
                      {message.content && <div className="whitespace-pre-wrap">{message.content}</div>}
                      
                      {/* 渲染用户发送的图片缩略图 */}
                      {message.images && message.images.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {message.images.map((img, idx) => (
                            <img 
                              key={idx} 
                              src={img.base64} 
                              alt={img.name} 
                              className="w-48 h-auto max-h-48 object-cover rounded-lg border border-white/10 shadow-sm"
                            />
                          ))}
                        </div>
                      )}

                      {/* 渲染文件和网址附件 */}
                      {message.files && message.files.length > 0 && (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {message.files.map((file, idx) => {
                            const isUrlAttachment = file.url && file.url.startsWith('http') && file.url === file.name;
                            const isError = (file as any).hasError === true || (!!file.content && file.content.startsWith('[⚠️'));
                            const isSuccess = !isError && !!file.content;

                            return (
                              <div key={idx} className="bg-black/20 p-3 rounded-lg w-full flex flex-col justify-between border border-white/5">
                                <div className="flex items-center gap-2 mb-2">
                                  {isUrlAttachment ? <Link size={16} className="text-blue-300 shrink-0" /> : <FileText size={16} className="text-blue-300 shrink-0" />}
                                  <span className="truncate text-sm" title={file.name}>{file.name}</span>
                                </div>
                                {message.isUploading ? (
                                  <div className="space-y-1.5 mt-auto">
                                    <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                      <div className="bg-blue-400 h-full transition-all duration-200" style={{ width: `${message.progress || 0}%` }} />
                                    </div>
                                    <div className="text-[10px] text-gray-300 text-right">处理中 {message.progress}%</div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between mt-auto pt-2 gap-2 flex-wrap">
                                    <div className="flex gap-2 items-center flex-wrap">
                                      {file.url && (
                                        <a href={file.url} target="_blank" rel="noreferrer" className="text-[10px] underline text-blue-200 hover:text-blue-100">
                                          {file.url.startsWith('http') ? '访问' : '下载'}
                                        </a>
                                      )}
                                      {isSuccess ? (
                                        <span className="text-[10px] text-green-300 opacity-90 border border-green-400/30 px-1.5 py-0.5 rounded whitespace-nowrap">
                                          {isUrlAttachment ? '内容已抓取' : '文本已提取'}
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-red-300 opacity-90 border border-red-400/30 px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1">
                                          <AlertCircle size={10} />{isUrlAttachment ? '抓取失败' : '提取异常'}
                                        </span>
                                      )}
                                    </div>
                                    {file.isTruncated && (
                                      <span className="text-[10px] font-medium text-yellow-300 bg-yellow-400/20 border border-yellow-400/40 px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-1" title="内容超过阈值，已被截断">
                                        <AlertTriangle size={10} />已截断
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
                                    <code {...props} className={`${className} bg-[#181825] px-1.5 py-0.5 rounded text-sm font-mono text-pink-300`}>
                                      {children}
                                    </code>
                                  );
                                },
                                span({ node, className, children, ...props }: any) {
                                  return <span className={className} {...props}>{children}</span>;
                                },
                              }}
                            >
                              {displayContent || (isGenerating && !displayReasoning ? '模型正在思考中...' : '')}
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
  );
}
