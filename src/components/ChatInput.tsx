// src/components/ChatInput.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, FileUp, Link as LinkIcon, FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';
import { MessageImage } from '../types';

interface ChatInputProps {
  isGenerating: boolean;
  onSubmit: (input: string, files: File[], urls: string[], images: MessageImage[]) => void;
  onTemplateSubmit: (files: File[]) => void;
}

export default function ChatInput({ isGenerating, onSubmit, onTemplateSubmit }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<MessageImage[]>([]);
  
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  
  const [templateMode, setTemplateMode] = useState<string | null>(null);
  const [templateFiles, setTemplateFiles] = useState<File[]>([]);

  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
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

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const images = files.filter(f => f.type.startsWith('image/'));
      const docs = files.filter(f => !f.type.startsWith('image/'));

      if (docs.length > 0) {
        setSelectedFiles((prev) => [...prev, ...docs].slice(0, 10));
      }

      for (const img of images) {
        const base64 = await readFileAsBase64(img);
        setSelectedImages((prev) => [...prev, { name: img.name, base64 }]);
      }
    }
    if (e.target) e.target.value = '';
    setShowAttachMenu(false);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (templateMode) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImage = false;
    const newImages: MessageImage[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        hasImage = true;
        const file = items[i].getAsFile();
        if (file) {
          const base64 = await readFileAsBase64(file);
          newImages.push({ name: file.name || `pasted_image_${Date.now()}.png`, base64 });
        }
      }
    }

    if (hasImage && newImages.length > 0) {
      setSelectedImages((prev) => [...prev, ...newImages]);
    }
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && selectedFiles.length === 0 && selectedUrls.length === 0 && selectedImages.length === 0) || isGenerating) return;
    
    onSubmit(input, selectedFiles, selectedUrls, selectedImages);
    setInput('');
    setSelectedFiles([]);
    setSelectedUrls([]);
    setSelectedImages([]);
  };

  const handleTemplateSubmitClick = () => {
    onTemplateSubmit(templateFiles);
    setTemplateMode(null);
    setTemplateFiles([]);
  };

  return (
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

        {/* Gemini 样式的附件缩略图展示区 */}
        {(selectedFiles.length > 0 || selectedUrls.length > 0 || selectedImages.length > 0) && !templateMode && (
          <div className="absolute -top-[72px] left-0 right-0 z-10 flex gap-3 overflow-x-auto pb-2 items-end" style={{ scrollbarWidth: 'none' }}>
            {selectedImages.map((img, index) => (
              <div key={`img-${index}`} className="relative group shrink-0 shadow-lg">
                <div className="w-16 h-16 rounded-xl border border-gray-600 overflow-hidden bg-black/40">
                  <img src={img.base64} alt="preview" className="w-full h-full object-cover" />
                </div>
                <button
                  onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== index))}
                  disabled={isGenerating}
                  className="absolute -top-1.5 -right-1.5 bg-gray-700 text-gray-300 hover:text-white hover:bg-red-500 rounded-full p-0.5 shadow-md transition-colors disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {selectedFiles.map((file, index) => (
              <div key={`file-${index}`} className="bg-[#313244] shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-600 text-sm shadow-lg mb-2">
                <Paperclip size={14} className="text-blue-400" />
                <span className="truncate max-w-[120px] text-gray-300">{file.name}</span>
                <button onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== index))} disabled={isGenerating} className="text-gray-400 hover:text-red-400 ml-1 disabled:opacity-50">
                  <X size={14} />
                </button>
              </div>
            ))}
            {selectedUrls.map((url, index) => (
              <div key={`url-${index}`} className="bg-[#313244] shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-600 text-sm shadow-lg mb-2">
                <LinkIcon size={14} className="text-blue-400" />
                <span className="truncate max-w-[120px] text-gray-300" title={url}>{url}</span>
                <button onClick={() => setSelectedUrls(prev => prev.filter((_, i) => i !== index))} disabled={isGenerating} className="text-gray-400 hover:text-red-400 ml-1 disabled:opacity-50">
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
                  selectedFiles.length > 0 || selectedUrls.length > 0 || selectedImages.length > 0
                    ? 'rounded-b-xl rounded-tr-xl'
                    : 'rounded-xl'
                } focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500`
          }`}
        >
          {templateMode === 'audit_supplier' ? (
            <div className="w-full flex flex-col items-center justify-center min-h-[120px] text-center animate-in fade-in zoom-in-95 duration-200">
              <FileSpreadsheet size={40} className="text-gray-500 mb-3 opacity-50" />
              <p className="text-gray-300 mb-4 text-sm">请上传需要智能审核的《供应商答复》Excel表格或邮件</p>
              <input
                type="file" multiple disabled={isGenerating} accept=".xls,.xlsx,.xlsm,.xlsb,.csv,.msg"
                onChange={(e) => {
                  if (e.target.files) setTemplateFiles(Array.from(e.target.files));
                }}
                className="mb-4 text-sm text-gray-400 file:mr-4 file:py-2.5 file:px-5 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              />
              
              {templateFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6 justify-center max-w-lg">
                  {templateFiles.map((f, i) => (
                    <span key={i} className="text-xs bg-gray-800 text-gray-300 px-3 py-1.5 rounded-md border border-gray-700 flex items-center gap-1.5">
                      <FileText size={12} className="text-blue-400"/> {f.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => { setTemplateMode(null); setTemplateFiles([]); }} disabled={isGenerating} className="px-6 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 transition-colors">取消</button>
                <button type="button" onClick={handleTemplateSubmitClick} disabled={templateFiles.length === 0 || isGenerating} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow-md">提取并开始审核</button>
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
                accept="image/*, .xls, .xlsx, .csv, .txt, .pdf, .doc, .docx" 
                className="hidden"
              />

              <div className="relative shrink-0 mb-1 ml-1" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  disabled={isGenerating}
                  className={`p-2 transition-colors rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                    showAttachMenu ? 'bg-gray-700 text-blue-400' : 'text-gray-400 hover:text-blue-400 hover:bg-gray-800'
                  }`}
                  title="添加附件"
                >
                  <Paperclip size={20} />
                </button>

                {showAttachMenu && !isGenerating && (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 w-36 bg-[#181825] border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
                    <button
                      type="button"
                      onClick={() => { fileInputRef.current?.setAttribute('accept', 'image/*'); fileInputRef.current?.click(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-[#313244] hover:text-white transition-colors"
                    >
                      <ImageIcon size={16} /><span>上传图片</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { fileInputRef.current?.setAttribute('accept', '*/*'); fileInputRef.current?.click(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-[#313244] hover:text-white transition-colors border-t border-gray-700/50"
                    >
                      <FileUp size={16} /><span>上传文档</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowUrlModal(true); setShowAttachMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-[#313244] hover:text-white transition-colors border-t border-gray-700/50"
                    >
                      <LinkIcon size={16} /><span>添加网址</span>
                    </button>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                disabled={isGenerating}
                placeholder={isGenerating ? "模型正在处理任务中，请稍候..." : "输入消息... 或直接截图 Ctrl+V 粘贴图片"}
                className={`w-full max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none py-2.5 px-3 text-gray-200 placeholder-gray-500 outline-none ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                rows={1}
              />

              <div className="flex shrink-0 mb-1 mr-1">
                <button
                  type="submit"
                  disabled={isGenerating || (!input.trim() && selectedFiles.length === 0 && selectedUrls.length === 0 && selectedImages.length === 0)}
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
            按 Enter 发送，或直接截屏粘贴图片。目前单次对话只能处理10万字以下数据
          </div>
        )}
      </div>

      {/* 网址解析弹出层 */}
      {showUrlModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#181825] border border-gray-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-800">
              <h3 className="font-medium text-gray-200 flex items-center gap-2"><LinkIcon size={18} className="text-blue-400" />添加网页附件</h3>
              <button onClick={() => setShowUrlModal(false)} className="text-gray-400 hover:text-red-400 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleAddUrl} className="p-5 space-y-5">
              <div className="space-y-2">
                <label className="text-sm text-gray-400 block">请输入需要大模型阅读的外部链接：</label>
                <input type="url" autoFocus value={tempUrl} onChange={(e) => setTempUrl(e.target.value)} placeholder="https://..." className="w-full px-4 py-3 bg-[#313244] border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-shadow" required />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowUrlModal(false)} className="px-5 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 transition-colors">取消</button>
                <button type="submit" disabled={!tempUrl.trim()} className="px-5 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors">确定添加</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
