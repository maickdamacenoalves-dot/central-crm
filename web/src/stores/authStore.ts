'use client';
import { create } from 'zustand';
import api from '@/lib/api';

export interface Agent {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT';
  storeId: string;
  store?: { id: string; name: string };
  isOnline: boolean;
}

interface AuthState {
  agent: Agent | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<Agent>;
  logout: () => Promise<void>;
  loadFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  agent: null,
  token: null,
  isAuthenticated: false,
  loading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });

    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('agent', JSON.stringify(data.agent));

    set({ agent: data.agent, token: data.accessToken, isAuthenticated: true, loading: false });
    return data.agent;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('agent');
    set({ agent: null, token: null, isAuthenticated: false, loading: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('accessToken');
    const agentStr = localStorage.getItem('agent');

    if (token && agentStr) {
      try {
        const agent = JSON.parse(agentStr);
        set({ agent, token, isAuthenticated: true, loading: false });
      } catch {
        set({ loading: false });
      }
    } else {
      set({ loading: false });
    }
  },
}));
