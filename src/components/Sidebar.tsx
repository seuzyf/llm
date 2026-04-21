import React, { useState } from 'react';
import { ChatSession } from '../types';
import { Plus, MessageSquare, Trash2, LogOut, ChevronDown, ChevronRight } from 'lucide-react';

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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // 按照 M月D日 格式进行分组
  const groupedSessions = sessions.reduce((acc, session) => {
    const date = new Date(session.updatedAt);
    const groupName = `${date.getMonth() + 1}月${date.getDate()}日`;

    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(session);
    return acc;
  }, {} as Record<string, ChatSession[]>);

  // 获取按时间倒序排列的分组名称顺序
  const groupOrder = Object.keys(groupedSessions).sort((a, b) => {
    const timeA = Math.max(...groupedSessions[a].map(s => s.updatedAt));
    const timeB = Math.max(...groupedSessions[b].map(s => s.updatedAt));
    return timeB - timeA;
  });

  // 获取今天的日期字符串，用于判断默认展开状态
  const today = new Date();
  const todayStr = `${today.getMonth() + 1}月${today.getDate()}日`;

  const toggleGroup = (groupName: string, currentState: boolean) => {
    setCollapsedGroups(prev => ({ ...prev, [groupName]: !currentState }));
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    // 删除前的二次确认
    if (window.confirm('确定要删除该对话记录吗？此操作无法恢复。')) {
      onDeleteSession(sessionId);
    }
  };

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
      
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-4">
        {groupOrder.map(groupName => {
          const groupSessions = groupedSessions[groupName];
          if (!groupSessions || groupSessions.length === 0) return null;
          
          // 如果状态未定义，默认逻辑：非今天则折叠 (true)，今天是展开 (false)
          const isCollapsed = collapsedGroups[groupName] !== undefined 
            ? collapsedGroups[groupName] 
            : groupName !== todayStr;

          return (
            <div key={groupName} className="flex flex-col space-y-1">
              <div 
                className="flex items-center gap-2 text-xs font-medium text-gray-500 px-2 py-1 cursor-pointer hover:text-gray-300 transition-colors select-none"
                onClick={() => toggleGroup(groupName, isCollapsed)}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{groupName}</span>
              </div>
              
              {!isCollapsed && groupSessions.map(session => (
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
                    onClick={(e) => handleDelete(e, session.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition-opacity"
                    title="删除对话"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
