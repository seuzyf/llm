import React from 'react';
import { ChatSession } from '../types';
import { Plus, MessageSquare, Trash2, LogOut } from 'lucide-react';

interface SidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  username: string;
  onLogout: () => void;
}

export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  username,
  onLogout
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-400 font-medium truncate">用户: {username}</div>
          <button 
            onClick={onLogout}
            className="p-1 hover:text-red-400 text-gray-500 transition-colors"
            title="退出登录"
          >
            <LogOut size={16} />
          </button>
        </div>
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors"
        >
          <Plus size={20} />
          <span>新对话</span>
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
              currentSessionId === session.id 
                ? 'bg-gray-800 text-white' 
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <MessageSquare size={18} className="shrink-0" />
              <span className="truncate text-sm">{session.title}</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(session.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
              title="删除对话"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
