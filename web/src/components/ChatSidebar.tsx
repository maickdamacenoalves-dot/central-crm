'use client';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore, type Conversation } from '@/stores/chatStore';
import { useSocketStore } from '@/stores/socketStore';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_COLORS: Record<string, string> = {
  BOT: 'bg-[#059669]',
  WAITING_QUEUE: 'bg-[#D97706]',
  IN_PROGRESS: 'bg-[#2563EB]',
  RESOLVED: 'bg-[#64748b]',
  CLOSED: 'bg-[#94a3b8]',
};

const STATUS_LABELS: Record<string, string> = {
  BOT: 'IA',
  WAITING_QUEUE: 'Fila',
  IN_PROGRESS: 'Ativo',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};

function ConversationItem({
  conversation,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const name = conversation.contact?.name || conversation.contact?.phone || 'Desconhecido';
  const initials = name.slice(0, 2).toUpperCase();
  const timeAgo = formatDistanceToNow(new Date(conversation.updatedAt), {
    addSuffix: false,
    locale: ptBR,
  });

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-[#f1f5f9] hover:bg-[#f1f5f9] ${
        isActive ? 'bg-[#eff6ff] border-l-2 border-l-[#2563EB]' : ''
      }`}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-[#e2e8f0] flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-semibold text-[#64748b]">{initials}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[#1e293b] truncate">{name}</span>
          <span className="text-[10px] text-[#94a3b8] ml-2 flex-shrink-0">{timeAgo}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[conversation.status] || 'bg-gray-400'}`} />
          <span className="text-[11px] text-[#64748b]">{STATUS_LABELS[conversation.status] || conversation.status}</span>
          {conversation._count?.messages && (
            <span className="text-[10px] text-[#94a3b8] ml-auto">{conversation._count.messages} msgs</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function ChatSidebar() {
  const agent = useAuthStore((s) => s.agent);
  const { conversations, activeConversation, filter, search, setFilter, setSearch, fetchConversations, selectConversation } = useChatStore();
  const connected = useSocketStore((s) => s.connected);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Filtra conversas
  const filtered = conversations.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      if (!c.contact?.name?.toLowerCase().includes(q) && !c.contact?.phone?.includes(q)) return false;
    }
    if (filter === 'active') return c.status === 'IN_PROGRESS';
    if (filter === 'bot_queue') return c.status === 'BOT' || c.status === 'WAITING_QUEUE';
    if (filter === 'closed') return c.status === 'CLOSED' || c.status === 'RESOLVED';
    return true;
  });

  const counts = {
    active: conversations.filter((c) => c.status === 'IN_PROGRESS').length,
    queue: conversations.filter((c) => c.status === 'WAITING_QUEUE').length,
    today: conversations.filter((c) => {
      const d = new Date(c.updatedAt);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length,
  };

  return (
    <div className="w-80 border-r border-[#e2e8f0] bg-white flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#2563EB] flex items-center justify-center">
            <span className="text-xs font-bold text-white">{agent?.name?.slice(0, 2).toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1e293b] truncate">{agent?.name}</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#059669]' : 'bg-[#94a3b8]'}`} />
              <span className="text-[11px] text-[#64748b]">{connected ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <input
          type="text"
          placeholder="Buscar conversa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-[#e2e8f0] rounded-lg placeholder-[#94a3b8] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
      </div>

      {/* Filters */}
      <div className="px-4 py-1 flex gap-1">
        {(['all', 'active', 'bot_queue', 'closed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors ${
              filter === f
                ? 'bg-[#2563EB] text-white'
                : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'active' ? 'Ativos' : f === 'bot_queue' ? 'IA+Fila' : 'Fechados'}
          </button>
        ))}
      </div>

      {/* Counters */}
      <div className="px-4 py-2 flex gap-3 text-[11px] text-[#64748b]">
        <span><strong className="text-[#2563EB]">{counts.active}</strong> ativos</span>
        <span><strong className="text-[#D97706]">{counts.queue}</strong> na fila</span>
        <span><strong className="text-[#64748b]">{counts.today}</strong> hoje</span>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#94a3b8]">Nenhuma conversa</div>
        ) : (
          filtered.map((c) => (
            <ConversationItem
              key={c.id}
              conversation={c}
              isActive={activeConversation?.id === c.id}
              onClick={() => selectConversation(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
