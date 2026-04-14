'use client';
import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import api from '@/lib/api';

interface ContactDetail {
  id: string;
  phone: string;
  name: string | null;
  isCarteirizado: boolean;
  assignedStore: { id: string; name: string } | null;
  assignedAgent: { id: string; name: string } | null;
  conversations: Array<{ id: string; status: string; createdAt: string; _count: { messages: number } }>;
  aiContexts: Array<{ summary: string | null; intent: string | null; sentiment: string | null; topics: unknown }>;
}

export default function ChatContextPanel() {
  const { activeConversation } = useChatStore();
  const [tab, setTab] = useState<'info' | 'history' | 'ai'>('info');
  const [contactDetail, setContactDetail] = useState<ContactDetail | null>(null);

  useEffect(() => {
    if (activeConversation?.contact?.id) {
      api.get(`/api/contacts/${activeConversation.contact.id}`)
        .then(({ data }) => setContactDetail(data))
        .catch(() => setContactDetail(null));
    } else {
      setContactDetail(null);
    }
  }, [activeConversation?.contact?.id]);

  if (!activeConversation || !activeConversation.contact) {
    return (
      <div className="w-[280px] border-l border-[#e2e8f0] bg-[#f8fafc] flex items-center justify-center">
        <p className="text-sm text-[#94a3b8]">Selecione uma conversa</p>
      </div>
    );
  }

  const contact = activeConversation.contact;
  const contactName = contact.name || contact.phone || 'Desconhecido';
  const aiCtx = contactDetail?.aiContexts?.[0];

  return (
    <div className="w-[280px] border-l border-[#e2e8f0] bg-[#f8fafc] flex flex-col h-full overflow-hidden">
      {/* Contact Card */}
      <div className="p-4 border-b border-[#e2e8f0] bg-white">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#e2e8f0] flex items-center justify-center">
            <span className="text-sm font-bold text-[#64748b]">{contactName.slice(0, 2).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1e293b] truncate">{contactName}</p>
            <p className="text-[11px] text-[#94a3b8]">{contact.phone}</p>
          </div>
        </div>
        <div className="flex gap-1.5 mt-3">
          {contact.isCarteirizado && (
            <span className="px-2 py-0.5 bg-[#eff6ff] text-[#2563EB] rounded text-[10px] font-medium">Carteirizado</span>
          )}
          <span className="px-2 py-0.5 bg-[#f1f5f9] text-[#64748b] rounded text-[10px] font-medium">
            {activeConversation.status}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#e2e8f0] bg-white">
        {(['info', 'history', 'ai'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-[11px] font-medium transition-colors ${
              tab === t
                ? 'text-[#2563EB] border-b-2 border-[#2563EB]'
                : 'text-[#94a3b8] hover:text-[#64748b]'
            }`}
          >
            {t === 'info' ? 'Info' : t === 'history' ? 'Historico' : 'IA'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'info' && (
          <div className="space-y-4">
            <InfoItem label="Telefone" value={contact.phone} />
            <InfoItem label="Nome" value={contact.name || 'Nao informado'} />
            <InfoItem label="Carteirizado" value={contact.isCarteirizado ? 'Sim' : 'Nao'} />
            <InfoItem label="Loja" value={contactDetail?.assignedStore?.name || 'Nenhuma'} />
            <InfoItem label="Atendente" value={contactDetail?.assignedAgent?.name || 'Nenhum'} />
            <InfoItem label="Total conversas" value={String(contactDetail?.conversations?.length || 0)} />
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-2">
            {contactDetail?.conversations?.map((c) => (
              <div key={c.id} className="p-2.5 bg-white rounded-lg border border-[#e2e8f0]">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    c.status === 'CLOSED' ? 'bg-[#f1f5f9] text-[#64748b]'
                      : c.status === 'IN_PROGRESS' ? 'bg-[#eff6ff] text-[#2563EB]'
                      : 'bg-[#fef3c7] text-[#D97706]'
                  }`}>
                    {c.status}
                  </span>
                  <span className="text-[10px] text-[#94a3b8]">{c._count.messages} msgs</span>
                </div>
                <p className="text-[11px] text-[#64748b] mt-1">
                  {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                </p>
              </div>
            )) || <p className="text-sm text-[#94a3b8]">Sem historico</p>}
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-4">
            {aiCtx ? (
              <>
                <div>
                  <p className="text-[11px] font-medium text-[#64748b] mb-1">Intencao detectada</p>
                  <span className="px-2 py-1 bg-[#ecfdf5] text-[#059669] rounded text-xs font-medium">
                    {aiCtx.intent || 'geral'}
                  </span>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#64748b] mb-1">Sentimento</p>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    aiCtx.sentiment === 'positive' ? 'bg-[#ecfdf5] text-[#059669]'
                      : aiCtx.sentiment === 'negative' ? 'bg-red-50 text-[#DC2626]'
                      : 'bg-[#f1f5f9] text-[#64748b]'
                  }`}>
                    {aiCtx.sentiment === 'positive' ? 'Positivo' : aiCtx.sentiment === 'negative' ? 'Negativo' : 'Neutro'}
                  </span>
                </div>
                {aiCtx.summary && (
                  <div>
                    <p className="text-[11px] font-medium text-[#64748b] mb-1">Resumo IA</p>
                    <p className="text-xs text-[#475569] leading-relaxed">{aiCtx.summary}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-[#94a3b8]">Sem dados de IA</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-[#94a3b8]">{label}</p>
      <p className="text-sm text-[#1e293b]">{value}</p>
    </div>
  );
}
