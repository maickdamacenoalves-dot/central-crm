'use client';
import { create } from 'zustand';
import api from '@/lib/api';

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  profilePicUrl: string | null;
  assignedStoreId: string | null;
  assignedAgentId: string | null;
  isCarteirizado: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'BOT' | 'AGENT';
  body: string | null;
  agentId: string | null;
  timestamp: string;
  createdAt: string;
  mediaAttachments?: Array<{
    id: string;
    type: string;
    url: string;
    fileName: string | null;
  }>;
}

export interface Conversation {
  id: string;
  contactId: string;
  agentId: string | null;
  status: 'BOT' | 'WAITING_QUEUE' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  subject: string | null;
  startedAt: string;
  closedAt: string | null;
  updatedAt: string;
  contact?: Contact;
  agent?: { id: string; name: string };
  messages?: Message[];
  _count?: { messages: number };
}

type Filter = 'all' | 'active' | 'bot_queue' | 'closed';

interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  filter: Filter;
  search: string;
  loading: boolean;
  setFilter: (filter: Filter) => void;
  setSearch: (search: string) => void;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  addMessage: (message: Message) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, data: Partial<Conversation>) => void;
  sendMessage: (conversationId: string, body: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messages: [],
  filter: 'all',
  search: '',
  loading: false,

  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),

  fetchConversations: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get('/api/conversations', {
        params: { limit: 100 },
      });
      set({ conversations: data.data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  selectConversation: async (id) => {
    try {
      const { data } = await api.get(`/api/conversations/${id}`);
      set({
        activeConversation: data,
        messages: data.messages || [],
      });
    } catch { /* ignore */ }
  },

  addMessage: (message) => {
    const { activeConversation, conversations } = get();

    // Atualiza mensagens se conversa ativa
    if (activeConversation && message.conversationId === activeConversation.id) {
      set((state) => ({
        messages: [...state.messages, message],
      }));
    }

    // Atualiza lista de conversas (reordena)
    const idx = conversations.findIndex((c) => c.id === message.conversationId);
    if (idx >= 0) {
      const updated = [...conversations];
      updated[idx] = { ...updated[idx], updatedAt: message.createdAt };
      updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      set({ conversations: updated });
    }
  },

  addConversation: (conversation) => {
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    }));
  },

  updateConversation: (id, data) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...data } : c
      ),
      activeConversation:
        state.activeConversation?.id === id
          ? { ...state.activeConversation, ...data }
          : state.activeConversation,
    }));
  },

  sendMessage: async (conversationId, body) => {
    // Mensagem é enviada via socket, mas podemos fazer fallback HTTP
    try {
      await api.post('/api/conversations/' + conversationId + '/messages', { body });
    } catch { /* socket will handle */ }
  },
}));
