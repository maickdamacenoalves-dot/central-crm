'use client';
import { create } from 'zustand';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { useChatStore } from './chatStore';
import type { Socket } from 'socket.io-client';

interface SocketState {
  connected: boolean;
  socket: Socket | null;
  typingAgents: Record<string, { agentName: string; conversationId: string }>;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (conversationId: string, body: string) => void;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  transferConversation: (conversationId: string, targetAgentId?: string, targetStoreId?: string) => Promise<unknown>;
  closeConversation: (conversationId: string) => Promise<unknown>;
}

export const useSocketStore = create<SocketState>((set) => ({
  connected: false,
  socket: null,
  typingAgents: {},

  connect: () => {
    const socket = connectSocket();

    socket.on('connect', () => {
      set({ connected: true, socket });
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    // Nova mensagem recebida
    socket.on('message:new', (data: { message: unknown; conversationId: string; contact?: unknown }) => {
      const chatStore = useChatStore.getState();
      chatStore.addMessage(data.message as never);
    });

    // Nova conversa atribuída
    socket.on('conversation:new', (data: { conversation: unknown }) => {
      const chatStore = useChatStore.getState();
      chatStore.addConversation(data.conversation as never);
    });

    // Conversa fechada
    socket.on('conversation:closed', (data: { conversationId: string }) => {
      const chatStore = useChatStore.getState();
      chatStore.updateConversation(data.conversationId, { status: 'CLOSED' });
    });

    // Agent typing
    socket.on('agent:typing', (data: { agentId: string; agentName: string; conversationId: string; isTyping: boolean }) => {
      set((state) => {
        const typing = { ...state.typingAgents };
        if (data.isTyping) {
          typing[data.agentId] = { agentName: data.agentName, conversationId: data.conversationId };
        } else {
          delete typing[data.agentId];
        }
        return { typingAgents: typing };
      });
    });

    // Agent status changes
    socket.on('agent:status', () => {
      // Refresh conversations to reflect agent status changes
      const chatStore = useChatStore.getState();
      chatStore.fetchConversations();
    });

    set({ socket });
  },

  disconnect: () => {
    disconnectSocket();
    set({ connected: false, socket: null });
  },

  sendMessage: (conversationId, body) => {
    const socket = getSocket();
    socket.emit('message:send', { conversationId, body }, () => {});
  },

  sendTyping: (conversationId, isTyping) => {
    const socket = getSocket();
    socket.emit('agent:typing', { conversationId, isTyping });
  },

  transferConversation: (conversationId, targetAgentId, targetStoreId) => {
    return new Promise((resolve, reject) => {
      const socket = getSocket();
      socket.emit(
        'conversation:transfer',
        { conversationId, targetAgentId, targetStoreId },
        (res: { success?: boolean; error?: string }) => {
          if (res?.error) reject(new Error(res.error));
          else resolve(res);
        }
      );
    });
  },

  closeConversation: (conversationId) => {
    return new Promise((resolve, reject) => {
      const socket = getSocket();
      socket.emit(
        'conversation:close',
        { conversationId },
        (res: { success?: boolean; error?: string }) => {
          if (res?.error) reject(new Error(res.error));
          else resolve(res);
        }
      );
    });
  },
}));
