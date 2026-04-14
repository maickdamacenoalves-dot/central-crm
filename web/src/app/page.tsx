'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const agentStr = localStorage.getItem('agent');

    if (!token || !agentStr) {
      router.replace('/login');
      return;
    }

    try {
      const agent = JSON.parse(agentStr);
      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(agent.role)) {
        router.replace('/admin');
      } else {
        router.replace('/chat');
      }
    } catch {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full" />
    </div>
  );
}
