'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import ChatSidebar from '@/components/ChatSidebar';
import ChatArea from '@/components/ChatArea';
import ChatContextPanel from '@/components/ChatContextPanel';

export default function ChatPage() {
  const { agent, isAuthenticated, loading, loadFromStorage } = useAuthStore();
  const { connect, disconnect } = useSocketStore();
  const router = useRouter();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      connect();
      return () => disconnect();
    }
  }, [isAuthenticated, connect, disconnect]);

  if (loading || !agent) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <ChatSidebar />
      <ChatArea />
      <ChatContextPanel />
    </div>
  );
}
