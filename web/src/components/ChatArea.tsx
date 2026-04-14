'use client';
import { useState, useRef, useEffect } from 'react';
import { useChatStore, type Message } from '@/stores/chatStore';
import { useSocketStore } from '@/stores/socketStore';
import { useAuthStore } from '@/stores/authStore';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const QUICK_REPLIES = [
  { label: 'Saudacao', text: 'Olá! Bem-vindo à Central de Tintas. Como posso ajudar?' },
  { label: 'Aguardar', text: 'Um momento, estou verificando para você.' },
  { label: 'Orcamento', text: 'Vou preparar um orçamento para você. Pode me informar os itens e quantidades?' },
  { label: 'Despedida', text: 'Obrigado por entrar em contato! Se precisar de mais alguma coisa, estamos à disposição.' },
  { label: 'Estoque', text: 'Vou verificar a disponibilidade desse produto. Um momento!' },
  { label: 'Visita', text: 'Você é bem-vindo(a) para visitar nossa loja! Nosso horário de funcionamento é de segunda a sexta, das 8h às 18h, e sábado das 8h às 12h.' },
];

function MessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === 'INBOUND';
  const isBot = message.senderType === 'BOT';
  const isAgent = message.senderType === 'AGENT';

  let bgColor = 'bg-[#f1f5f9]'; // customer (inbound) - gray
  let textColor = 'text-[#1e293b]';
  let align = 'items-start';
  let labelColor = 'text-[#64748b]';
  let label = 'Cliente';

  if (isBot) {
    bgColor = 'bg-[#ecfdf5]';
    labelColor = 'text-[#059669]';
    label = 'IA';
    align = 'items-end';
  } else if (isAgent) {
    bgColor = 'bg-[#eff6ff]';
    labelColor = 'text-[#2563EB]';
    label = 'Atendente';
    align = 'items-end';
  } else if (isInbound) {
    align = 'items-start';
  }

  const time = format(new Date(message.timestamp), 'HH:mm');

  return (
    <div className={`flex flex-col ${align} mb-3`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[10px] font-medium ${labelColor}`}>{label}</span>
        <span className="text-[10px] text-[#94a3b8]">{time}</span>
      </div>
      <div className={`${bgColor} ${textColor} px-3.5 py-2 rounded-2xl max-w-[75%] text-sm leading-relaxed`}>
        {message.body || (
          <span className="italic text-[#94a3b8]">
            {message.mediaAttachments?.length ? '[Mídia]' : '[Mensagem vazia]'}
          </span>
        )}
        {message.mediaAttachments?.map((m) => (
          <div key={m.id} className="mt-1">
            {m.type === 'IMAGE' ? (
              <img src={`http://localhost:3000${m.url}`} alt="" className="max-w-[240px] rounded-lg" />
            ) : (
              <a href={`http://localhost:3000${m.url}`} target="_blank" rel="noreferrer" className="text-[#2563EB] underline text-xs">
                {m.fileName || 'Arquivo'}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatArea() {
  const { activeConversation, messages } = useChatStore();
  const { sendMessage, sendTyping, closeConversation, transferConversation } = useSocketStore();
  const agent = useAuthStore((s) => s.agent);
  const [input, setInput] = useState('');
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#f8fafc]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#f1f5f9] flex items-center justify-center">
            <svg className="w-8 h-8 text-[#94a3b8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-[#64748b] font-medium">Selecione uma conversa</p>
          <p className="text-sm text-[#94a3b8] mt-1">Escolha uma conversa na lista ao lado</p>
        </div>
      </div>
    );
  }

  const contact = activeConversation.contact;
  const contactName = contact?.name || contact?.phone || 'Desconhecido';

  function handleSend() {
    if (!input.trim() || !activeConversation) return;
    sendMessage(activeConversation.id, input.trim());

    // Optimistic update
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      conversationId: activeConversation.id,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      body: input.trim(),
      agentId: agent?.id || null,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    useChatStore.getState().addMessage(optimistic);

    setInput('');
    sendTyping(activeConversation.id, false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === '/' && input === '') {
      setShowQuickReplies(true);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);

    if (activeConversation) {
      sendTyping(activeConversation.id, true);

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(activeConversation.id, false);
      }, 2000);
    }
  }

  async function handleClose() {
    if (!activeConversation) return;
    try {
      await closeConversation(activeConversation.id);
      useChatStore.getState().updateConversation(activeConversation.id, { status: 'CLOSED' });
      toast.success('Conversa encerrada');
    } catch {
      toast.error('Erro ao encerrar');
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-[#e2e8f0] bg-white">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#e2e8f0] flex items-center justify-center">
            <span className="text-xs font-semibold text-[#64748b]">{contactName.slice(0, 2).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1e293b]">{contactName}</p>
            <p className="text-[11px] text-[#94a3b8]">
              {contact?.phone}
              {contact?.isCarteirizado && (
                <span className="ml-2 px-1.5 py-0.5 bg-[#eff6ff] text-[#2563EB] rounded text-[10px] font-medium">Carteirizado</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTransfer(!showTransfer)}
            className="px-3 py-1.5 text-xs font-medium text-[#64748b] bg-[#f1f5f9] rounded-lg hover:bg-[#e2e8f0] transition-colors"
            title="Transferir"
          >
            Transferir
          </button>
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs font-medium text-[#DC2626] bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            Encerrar
          </button>
        </div>
      </div>

      {/* Transfer bar */}
      {showTransfer && (
        <TransferBar
          conversationId={activeConversation.id}
          onClose={() => setShowTransfer(false)}
          onTransfer={transferConversation}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#f8fafc]">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies drawer */}
      {showQuickReplies && (
        <div className="border-t border-[#e2e8f0] bg-white px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[#64748b]">Respostas Rapidas</span>
            <button onClick={() => setShowQuickReplies(false)} className="text-[#94a3b8] text-xs hover:text-[#64748b]">Fechar</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_REPLIES.map((qr) => (
              <button
                key={qr.label}
                onClick={() => { setInput(qr.text); setShowQuickReplies(false); }}
                className="px-3 py-1.5 text-xs bg-[#f1f5f9] text-[#475569] rounded-full hover:bg-[#e2e8f0] transition-colors"
              >
                {qr.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[#e2e8f0] bg-white px-5 py-3">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem... (/ para respostas rapidas)"
            rows={1}
            className="flex-1 px-4 py-2.5 text-sm border border-[#e2e8f0] rounded-xl resize-none placeholder-[#94a3b8] focus:outline-none focus:ring-1 focus:ring-[#2563EB] max-h-32"
            style={{ minHeight: '42px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-4 py-2.5 bg-[#2563EB] text-white rounded-xl hover:bg-[#1d4ed8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferBar({
  conversationId,
  onClose,
  onTransfer,
}: {
  conversationId: string;
  onClose: () => void;
  onTransfer: (id: string, agentId?: string, storeId?: string) => Promise<unknown>;
}) {
  const [targetAgentId, setTargetAgentId] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; name: string; store?: { name: string } }>>([]);

  useEffect(() => {
    import('@/lib/api').then(({ default: api }) => {
      api.get('/api/agents').then(({ data }) => setAgents(data.data || []));
    });
  }, []);

  async function handleTransfer() {
    if (!targetAgentId) return;
    try {
      await onTransfer(conversationId, targetAgentId);
      toast.success('Conversa transferida');
      onClose();
    } catch {
      toast.error('Erro ao transferir');
    }
  }

  return (
    <div className="px-5 py-2 bg-[#fffbeb] border-b border-[#fde68a] flex items-center gap-3">
      <span className="text-xs text-[#92400e] font-medium">Transferir para:</span>
      <select
        value={targetAgentId}
        onChange={(e) => setTargetAgentId(e.target.value)}
        className="text-xs border border-[#fde68a] rounded-lg px-2 py-1 bg-white"
      >
        <option value="">Selecione um atendente</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name} - {a.store?.name}</option>
        ))}
      </select>
      <button onClick={handleTransfer} className="text-xs px-3 py-1 bg-[#D97706] text-white rounded-lg hover:bg-[#b45309]">
        Transferir
      </button>
      <button onClick={onClose} className="text-xs text-[#92400e] hover:underline">Cancelar</button>
    </div>
  );
}
