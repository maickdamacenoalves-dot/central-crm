'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import api from '@/lib/api';
import toast from 'react-hot-toast';

type Tab = 'overview' | 'stores' | 'agents' | 'conversations' | 'ai';

interface Overview {
  activeConversations: number;
  queueCount: number;
  closedToday: number;
  botConversations: number;
  totalContacts: number;
  newContactsToday: number;
  avgResponseTimeMinutes: number;
}

interface StoreStat {
  id: string;
  name: string;
  active: number;
  queue: number;
  closedToday: number;
  contacts: number;
  onlineAgents: number;
}

interface AgentStat {
  id: string;
  name: string;
  isOnline: boolean;
  store: { name: string };
  activeConversations: number;
  closedToday: number;
  messagesToday: number;
}

interface AiStats {
  totalInteractions: number;
  transferred: number;
  resolvedByBot: number;
  transferRate: number;
  intents: Array<{ intent: string; count: number }>;
  sentiments: Array<{ sentiment: string; count: number }>;
}

export default function AdminPage() {
  const { agent, isAuthenticated, loading, loadFromStorage, logout } = useAuthStore();
  const { connect, disconnect } = useSocketStore();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [storeStats, setStoreStats] = useState<StoreStat[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [aiStats, setAiStats] = useState<AiStats | null>(null);
  const [conversations, setConversations] = useState<Array<Record<string, unknown>>>([]);
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [showCreateAgent, setShowCreateAgent] = useState(false);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login');
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) { connect(); return () => disconnect(); }
  }, [isAuthenticated, connect, disconnect]);

  const fetchData = useCallback(async () => {
    try {
      const [ov, st, ag, ai, conv, stList] = await Promise.all([
        api.get('/api/dashboard/overview'),
        api.get('/api/dashboard/stores'),
        api.get('/api/dashboard/agents'),
        api.get('/api/dashboard/ai'),
        api.get('/api/conversations', { params: { limit: 50 } }),
        api.get('/api/stores'),
      ]);
      setOverview(ov.data);
      setStoreStats(st.data.data);
      setAgentStats(ag.data.data);
      setAiStats(ai.data);
      setConversations(conv.data.data);
      setStores(stList.data.data.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchData();
  }, [isAuthenticated, fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchData]);

  if (loading || !agent) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full" />
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Visao Geral' },
    { key: 'stores', label: 'Lojas' },
    { key: 'agents', label: 'Atendentes' },
    { key: 'conversations', label: 'Conversas' },
    { key: 'ai', label: 'IA / Chatbot' },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 bg-white border-r border-[#e2e8f0] flex flex-col">
        <div className="p-4 border-b border-[#e2e8f0]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#2563EB] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-[#1e293b]">Central de Tintas</p>
              <p className="text-[10px] text-[#94a3b8]">Painel Admin</p>
            </div>
          </div>
        </div>

        {/* Store filter */}
        <div className="px-4 py-3 border-b border-[#e2e8f0]">
          <label className="text-[10px] font-medium text-[#94a3b8] block mb-1">FILTRAR LOJA</label>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="w-full text-xs border border-[#e2e8f0] rounded-lg px-2 py-1.5"
          >
            <option value="all">Todas as lojas</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Menu */}
        <nav className="flex-1 py-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                tab === t.key
                  ? 'text-[#2563EB] bg-[#eff6ff] font-medium border-r-2 border-[#2563EB]'
                  : 'text-[#64748b] hover:bg-[#f8fafc]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Agent info + Logout */}
        <div className="p-4 border-t border-[#e2e8f0]">
          <p className="text-xs font-medium text-[#1e293b] truncate">{agent.name}</p>
          <p className="text-[10px] text-[#94a3b8]">{agent.role}</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => router.push('/chat')}
              className="text-[10px] text-[#2563EB] hover:underline"
            >
              Chat
            </button>
            <button
              onClick={async () => { await logout(); router.push('/login'); }}
              className="text-[10px] text-[#DC2626] hover:underline"
            >
              Sair
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-6">
        {tab === 'overview' && overview && <OverviewTab overview={overview} storeStats={storeStats} agentStats={agentStats} aiStats={aiStats} conversations={conversations} />}
        {tab === 'stores' && <StoresTab storeStats={storeStats} />}
        {tab === 'agents' && <AgentsTab agentStats={agentStats} showCreate={showCreateAgent} setShowCreate={setShowCreateAgent} stores={stores} onRefresh={fetchData} />}
        {tab === 'conversations' && <ConversationsTab conversations={conversations} />}
        {tab === 'ai' && aiStats && <AiTab aiStats={aiStats} />}
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────

function OverviewTab({
  overview, storeStats, agentStats, aiStats, conversations,
}: {
  overview: Overview;
  storeStats: StoreStat[];
  agentStats: AgentStat[];
  aiStats: AiStats | null;
  conversations: Array<Record<string, unknown>>;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[#1e293b]">Visao Geral</h2>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Conversas Ativas" value={overview.activeConversations} color="#2563EB" />
        <KpiCard label="Na Fila" value={overview.queueCount} color="#D97706" />
        <KpiCard label="Fechadas Hoje" value={overview.closedToday} color="#059669" />
        <KpiCard label="Tempo Medio (min)" value={overview.avgResponseTimeMinutes} color="#64748b" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Bot Ativas" value={overview.botConversations} color="#059669" />
        <KpiCard label="Total Contatos" value={overview.totalContacts} color="#2563EB" />
        <KpiCard label="Novos Hoje" value={overview.newContactsToday} color="#D97706" />
      </div>

      {/* Store performance */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <div className="px-5 py-3 border-b border-[#e2e8f0]">
          <h3 className="text-sm font-semibold text-[#1e293b]">Performance por Loja</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc]">
            <tr>
              <th className="px-5 py-2.5 text-left text-[11px] font-medium text-[#94a3b8]">Loja</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Online</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Ativas</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Fila</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Fechadas</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Contatos</th>
            </tr>
          </thead>
          <tbody>
            {storeStats.map((s) => (
              <tr key={s.id} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                <td className="px-5 py-2.5 font-medium text-[#1e293b]">{s.name}</td>
                <td className="px-5 py-2.5 text-center">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${s.onlineAgents > 0 ? 'bg-[#ecfdf5] text-[#059669]' : 'bg-[#f1f5f9] text-[#94a3b8]'}`}>
                    {s.onlineAgents}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-center text-[#2563EB] font-medium">{s.active}</td>
                <td className="px-5 py-2.5 text-center text-[#D97706] font-medium">{s.queue}</td>
                <td className="px-5 py-2.5 text-center text-[#059669]">{s.closedToday}</td>
                <td className="px-5 py-2.5 text-center text-[#64748b]">{s.contacts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* AI metrics */}
      {aiStats && (
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          <h3 className="text-sm font-semibold text-[#1e293b] mb-3">Metricas da IA</h3>
          <div className="grid grid-cols-4 gap-4">
            <MiniKpi label="Interacoes" value={aiStats.totalInteractions} />
            <MiniKpi label="Resolvidos (bot)" value={aiStats.resolvedByBot} />
            <MiniKpi label="Transferidos" value={aiStats.transferred} />
            <MiniKpi label="Taxa Transfer." value={`${aiStats.transferRate}%`} />
          </div>
        </div>
      )}

      {/* Agent status */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
        <h3 className="text-sm font-semibold text-[#1e293b] mb-3">Status dos Atendentes</h3>
        <div className="flex flex-wrap gap-2">
          {agentStats.map((a) => (
            <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 bg-[#f8fafc] rounded-lg">
              <span className={`w-2 h-2 rounded-full ${a.isOnline ? 'bg-[#059669]' : 'bg-[#94a3b8]'}`} />
              <span className="text-xs text-[#1e293b]">{a.name}</span>
              <span className="text-[10px] text-[#94a3b8]">{a.store?.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Real-time conversations */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <div className="px-5 py-3 border-b border-[#e2e8f0]">
          <h3 className="text-sm font-semibold text-[#1e293b]">Conversas em Tempo Real</h3>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#f8fafc] sticky top-0">
              <tr>
                <th className="px-5 py-2 text-left text-[11px] font-medium text-[#94a3b8]">Cliente</th>
                <th className="px-5 py-2 text-center text-[11px] font-medium text-[#94a3b8]">Status</th>
                <th className="px-5 py-2 text-center text-[11px] font-medium text-[#94a3b8]">Atendente</th>
              </tr>
            </thead>
            <tbody>
              {conversations.slice(0, 15).map((c: Record<string, unknown>) => {
                const contact = c.contact as Record<string, unknown> | undefined;
                const agentData = c.agent as Record<string, unknown> | undefined;
                return (
                  <tr key={c.id as string} className="border-t border-[#f1f5f9]">
                    <td className="px-5 py-2 text-[#1e293b]">{(contact?.name as string) || (contact?.phone as string) || '-'}</td>
                    <td className="px-5 py-2 text-center">
                      <StatusBadge status={c.status as string} />
                    </td>
                    <td className="px-5 py-2 text-center text-[#64748b]">{(agentData?.name as string) || 'IA'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Stores Tab ───────────────────────────────────────────

function StoresTab({ storeStats }: { storeStats: StoreStat[] }) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[#1e293b]">Lojas</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {storeStats.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border border-[#e2e8f0] p-5">
            <h3 className="text-sm font-semibold text-[#1e293b] mb-3">{s.name}</h3>
            <div className="grid grid-cols-2 gap-3">
              <MiniKpi label="Ativas" value={s.active} />
              <MiniKpi label="Fila" value={s.queue} />
              <MiniKpi label="Fechadas" value={s.closedToday} />
              <MiniKpi label="Contatos" value={s.contacts} />
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${s.onlineAgents > 0 ? 'bg-[#059669]' : 'bg-[#94a3b8]'}`} />
              <span className="text-[11px] text-[#64748b]">{s.onlineAgents} atendente(s) online</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agents Tab ───────────────────────────────────────────

function AgentsTab({
  agentStats, showCreate, setShowCreate, stores, onRefresh,
}: {
  agentStats: AgentStat[];
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  stores: Array<{ id: string; name: string }>;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#1e293b]">Atendentes</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 text-xs font-medium bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] transition-colors"
        >
          + Criar Atendente
        </button>
      </div>

      {showCreate && <CreateAgentForm stores={stores} onClose={() => setShowCreate(false)} onRefresh={onRefresh} />}

      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc]">
            <tr>
              <th className="px-5 py-2.5 text-left text-[11px] font-medium text-[#94a3b8]">Nome</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Status</th>
              <th className="px-5 py-2.5 text-left text-[11px] font-medium text-[#94a3b8]">Loja</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Ativas</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Fechadas</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Msgs Hoje</th>
            </tr>
          </thead>
          <tbody>
            {agentStats.map((a) => (
              <tr key={a.id} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                <td className="px-5 py-2.5 font-medium text-[#1e293b]">{a.name}</td>
                <td className="px-5 py-2.5 text-center">
                  <span className={`inline-flex items-center gap-1 text-xs ${a.isOnline ? 'text-[#059669]' : 'text-[#94a3b8]'}`}>
                    <span className={`w-2 h-2 rounded-full ${a.isOnline ? 'bg-[#059669]' : 'bg-[#94a3b8]'}`} />
                    {a.isOnline ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-[#64748b]">{a.store?.name}</td>
                <td className="px-5 py-2.5 text-center text-[#2563EB] font-medium">{a.activeConversations}</td>
                <td className="px-5 py-2.5 text-center text-[#059669]">{a.closedToday}</td>
                <td className="px-5 py-2.5 text-center text-[#64748b]">{a.messagesToday}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateAgentForm({
  stores, onClose, onRefresh,
}: {
  stores: Array<{ id: string; name: string }>;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [storeId, setStoreId] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/agents', { name, email, password, storeId });
      toast.success('Atendente criado!');
      onClose();
      onRefresh();
    } catch {
      toast.error('Erro ao criar atendente');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" required className="px-3 py-2 text-sm border border-[#e2e8f0] rounded-lg" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required className="px-3 py-2 text-sm border border-[#e2e8f0] rounded-lg" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" type="password" required className="px-3 py-2 text-sm border border-[#e2e8f0] rounded-lg" />
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required className="px-3 py-2 text-sm border border-[#e2e8f0] rounded-lg">
          <option value="">Selecione a loja</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="col-span-2 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-[#64748b] bg-[#f1f5f9] rounded-lg">Cancelar</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-xs bg-[#2563EB] text-white rounded-lg disabled:opacity-60">
            {saving ? 'Salvando...' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Conversations Tab ────────────────────────────────────

function ConversationsTab({ conversations }: { conversations: Array<Record<string, unknown>> }) {
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const contact = c.contact as Record<string, unknown> | undefined;
    return (
      (contact?.name as string)?.toLowerCase().includes(q) ||
      (contact?.phone as string)?.includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#1e293b]">Conversas</h2>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 text-sm border border-[#e2e8f0] rounded-lg w-64"
        />
      </div>

      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#f8fafc]">
            <tr>
              <th className="px-5 py-2.5 text-left text-[11px] font-medium text-[#94a3b8]">Cliente</th>
              <th className="px-5 py-2.5 text-left text-[11px] font-medium text-[#94a3b8]">Telefone</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Status</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Atendente</th>
              <th className="px-5 py-2.5 text-center text-[11px] font-medium text-[#94a3b8]">Msgs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const contact = c.contact as Record<string, unknown> | undefined;
              const agentData = c.agent as Record<string, unknown> | undefined;
              const count = c._count as Record<string, number> | undefined;
              return (
                <tr key={c.id as string} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                  <td className="px-5 py-2.5 text-[#1e293b] font-medium">{(contact?.name as string) || '-'}</td>
                  <td className="px-5 py-2.5 text-[#64748b]">{(contact?.phone as string) || '-'}</td>
                  <td className="px-5 py-2.5 text-center"><StatusBadge status={c.status as string} /></td>
                  <td className="px-5 py-2.5 text-center text-[#64748b]">{(agentData?.name as string) || 'IA'}</td>
                  <td className="px-5 py-2.5 text-center text-[#94a3b8]">{count?.messages ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AI Tab ───────────────────────────────────────────────

function AiTab({ aiStats }: { aiStats: AiStats }) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-[#1e293b]">IA / Chatbot</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Interacoes Hoje" value={aiStats.totalInteractions} color="#2563EB" />
        <KpiCard label="Resolvidos (Bot)" value={aiStats.resolvedByBot} color="#059669" />
        <KpiCard label="Transferidos" value={aiStats.transferred} color="#D97706" />
        <KpiCard label="Taxa Transfer." value={`${aiStats.transferRate}%`} color="#64748b" />
      </div>

      {/* Intents */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
        <h3 className="text-sm font-semibold text-[#1e293b] mb-3">Intencoes Detectadas</h3>
        <div className="space-y-2">
          {aiStats.intents.length > 0 ? aiStats.intents.map((i) => (
            <div key={i.intent} className="flex items-center justify-between">
              <span className="text-sm text-[#475569]">{i.intent}</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#2563EB] rounded-full"
                    style={{ width: `${Math.min((i.count / Math.max(...aiStats.intents.map(x => x.count))) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-[#94a3b8] w-8 text-right">{i.count}</span>
              </div>
            </div>
          )) : <p className="text-sm text-[#94a3b8]">Sem dados</p>}
        </div>
      </div>

      {/* Sentiments */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
        <h3 className="text-sm font-semibold text-[#1e293b] mb-3">Sentimento</h3>
        <div className="flex gap-4">
          {aiStats.sentiments.map((s) => (
            <div key={s.sentiment} className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${
                s.sentiment === 'positive' ? 'bg-[#059669]'
                  : s.sentiment === 'negative' ? 'bg-[#DC2626]'
                  : 'bg-[#94a3b8]'
              }`} />
              <span className="text-sm text-[#475569] capitalize">{s.sentiment}</span>
              <span className="text-xs text-[#94a3b8]">({s.count})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared components ────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e8f0] p-4">
      <p className="text-[11px] font-medium text-[#94a3b8]">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-[10px] text-[#94a3b8]">{label}</p>
      <p className="text-lg font-bold text-[#1e293b]">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    BOT: 'bg-[#ecfdf5] text-[#059669]',
    WAITING_QUEUE: 'bg-[#fef3c7] text-[#D97706]',
    IN_PROGRESS: 'bg-[#eff6ff] text-[#2563EB]',
    RESOLVED: 'bg-[#f1f5f9] text-[#64748b]',
    CLOSED: 'bg-[#f1f5f9] text-[#94a3b8]',
  };

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${colors[status] || 'bg-[#f1f5f9] text-[#64748b]'}`}>
      {status}
    </span>
  );
}
