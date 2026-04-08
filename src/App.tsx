import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatSession, ModelInfo } from './types';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import { Menu } from 'lucide-react';

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [username, setUsername] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginInput, setLoginInput] = useState('');

  // 检查本地缓存并加载记录
  useEffect(() => {
    const savedUser = localStorage.getItem('chat_username');
    if (savedUser) {
      setUsername(savedUser);
      setIsLoggedIn(true);
      fetchSessions(savedUser);
    }
  }, []);

  const fetchSessions = async (user: string) => {
    try {
      const res = await fetch(`/api/logs/${user}`);
      const data = await res.json();
      if (data && data.length > 0) {
        setSessions(data);
        setCurrentSessionId(data[0].id);
      } else {
        createNewSession();
      }
    } catch (e) {
      console.error('获取历史记录失败', e);
      createNewSession();
    }
  };

  // 只要会话有更新就同步到服务器日志
  useEffect(() => {
    if (isLoggedIn && username && sessions.length > 0) {
      fetch(`/api/logs/${username}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessions)
      }).catch(console.error);
    }
  }, [sessions, isLoggedIn, username]);

  useEffect(() => {
    const fetchModels = async () => {
      if (!isLoggedIn) return;
      try {
        const res = await fetch('/api/models');
        const data = await res.json();
        
        if (res.ok && data.data && data.data.length > 0) {
          setModels(data.data);
          setSelectedModel(data.data[0].id);
        } else if (data.isConnectionRefused) {
          setModels([{ id: 'lm-studio-not-connected', object: 'model', owned_by: 'system' }]);
          setSelectedModel('lm-studio-not-connected');
        }
      } catch (error) {
        console.error('获取模型失败', error);
      }
    };
    fetchModels();
  }, [isLoggedIn]);

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: uuidv4(),
      title: '新对话',
      messages: [],
      updatedAt: Date.now(),
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null);
      if (remaining.length === 0) {
        createNewSession();
      }
    }
  };

  const updateSessionMessages = (sessionId: string, messages: Message[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        let title = s.title;
        if (title === '新对话' && messages.length > 0) {
          const firstUserMsg = messages.find(m => m.role === 'user');
          if (firstUserMsg) {
            title = firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
          }
        }
        return { ...s, messages, title, updatedAt: Date.now() };
      }
      return s;
    }).sort((a, b) => b.updatedAt - a.updatedAt));
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginInput.trim()) {
      const user = loginInput.trim();
      localStorage.setItem('chat_username', user);
      setUsername(user);
      setIsLoggedIn(true);
      fetchSessions(user);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('chat_username');
    setIsLoggedIn(false);
    setUsername('');
    setLoginInput('');
    setSessions([]);
    setCurrentSessionId(null);
  };

  if (!isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1e1e2e] text-gray-200">
        <form onSubmit={handleLogin} className="bg-[#181825] p-8 rounded-xl shadow-lg border border-gray-800 flex flex-col gap-4 min-w-[300px]">
          <h2 className="text-xl font-semibold text-center mb-2">登录系统</h2>
          <input
            type="text"
            placeholder="请输入您的用户名"
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            className="px-4 py-2 bg-[#313244] border border-gray-700 rounded-md focus:outline-none focus:border-blue-500 text-gray-200"
            autoFocus
          />
          <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors">
            进入对话
          </button>
        </form>
      </div>
    );
  }

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="flex h-screen bg-[#1e1e2e] text-gray-200 font-sans overflow-hidden">
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed md:static inset-y-0 left-0 z-30 w-64 bg-[#181825] border-r border-gray-800 transform transition-transform duration-200 ease-in-out flex flex-col
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <Sidebar 
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={(id) => {
            setCurrentSessionId(id);
            if (window.innerWidth < 768) setIsSidebarOpen(false);
          }}
          onNewSession={createNewSession}
          onDeleteSession={deleteSession}
          username={username}
          onLogout={handleLogout}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        <header className="h-14 border-b border-gray-800 bg-[#1e1e2e] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 -ml-2 rounded-md hover:bg-gray-800 md:hidden text-gray-400"
            >
              <Menu size={20} />
            </button>
            <h1 className="font-semibold text-lg truncate text-gray-200">
              {currentSession?.title || '本地大模型对话'}
            </h1>
          </div>
          
          <div className="flex items-center">
            {models.length > 0 ? (
              <select 
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="text-sm border-gray-700 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-1.5 pl-3 pr-8 bg-[#313244] text-gray-200 outline-none"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-gray-400 bg-[#313244] px-3 py-1.5 rounded-md">
                未找到模型
              </span>
            )}
          </div>
        </header>

        {currentSession && (
          <ChatArea 
            session={currentSession}
            onUpdateMessages={(msgs) => updateSessionMessages(currentSession.id, msgs)}
            selectedModel={selectedModel}
          />
        )}
      </div>
    </div>
  );
}
