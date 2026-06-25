import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { LayoutDashboard, FileText, Settings, BookOpen, Table2, Receipt, Link2, Wallet, LogOut, Menu, X, SlidersHorizontal, Users, Layers, ShieldCheck, ListChecks, Sun, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { setTheme } from './lib/theme'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import CadastrosPage from './pages/cadastros/CadastrosPage'
import RelatorioPage from './pages/relatorios/RelatorioPage'
import RelatorioEditorPage from './pages/relatorios/RelatorioEditorPage'
import OrcadoDadosPage from './pages/orcamento/OrcadoDadosPage'
import RealizadoDadosPage from './pages/realizado/RealizadoDadosPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import DashboardsHubPage from './pages/dashboard/DashboardsHubPage'
import ComparativoAnualPage from './pages/dashboard/ComparativoAnualPage'
import CagrPage from './pages/dashboard/CagrPage'
import ExecutivoPage from './pages/dashboard/ExecutivoPage'
import IndicadoresPage from './pages/dashboard/IndicadoresPage'
import BalancoDashboardPage from './pages/balanco/BalancoDashboardPage'
import DrePage from './pages/dre/DrePage'
import AmarracaoPage from './pages/amarracao/AmarracaoPage'
import SaldoDadosPage from './pages/saldos/SaldoDadosPage'
import ConfiguracoesPage from './pages/configuracoes/ConfiguracoesPage'
import LoginPage from './pages/login/LoginPage'

// Menu agrupado por modo de interação (igual ao protótipo planorc-v2-menu-mesclado).
// `soon: true` = item proposto (aparece, mas ainda não navega).
type NavItem = { label: string; icon: LucideIcon; to?: string; soon?: boolean }
type NavGroup = { area: string; mode: string; dot: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { area: 'Orçamentação', mode: 'escrita', dot: '#8b5cf6', items: [
    { to: '/orcamento', label: 'Orçamento',             icon: FileText },
    { label: 'Formulário de drivers',  icon: SlidersHorizontal, soon: true },
    { label: 'Posto de trabalho',      icon: Users,             soon: true },
    { label: 'Versões & cenários',     icon: Layers,            soon: true },
    { label: 'Governança & aprovação', icon: ShieldCheck,       soon: true },
  ] },
  { area: 'Dados · ERP', mode: 'realizado', dot: '#22d3ee', items: [
    { to: '/realizado', label: 'Realizado',   icon: Receipt },
    { to: '/saldos',    label: 'Saldos (BP)', icon: Wallet },
    { to: '/amarracao', label: 'Amarração',   icon: Link2 },
    { label: 'Lotes / Conciliação', icon: ListChecks, soon: true },
  ] },
  { area: 'Relatórios', mode: 'leitura', dot: '#34d399', items: [
    { to: '/dashboards', label: 'Dashboards', icon: LayoutDashboard },
    { to: '/relatorios', label: 'Relatórios', icon: Table2 },
  ] },
  { area: 'Base', mode: '', dot: 'var(--muted)', items: [
    { to: '/cadastros', label: 'Cadastros',     icon: BookOpen },
    { to: '/config',    label: 'Configurações', icon: Settings },
  ] },
]

const S = {
  layout:  { display: 'flex', height: '100vh', overflow: 'hidden' } as const,
  sidebar: {
    width: 256, background: 'var(--bg-soft)', color: 'var(--text-mid)',
    display: 'flex', flexDirection: 'column' as const, flexShrink: 0,
    borderRight: '1px solid var(--border)',
  },
  logo: {
    padding: '18px 16px 14px', fontSize: 18, fontWeight: 800, letterSpacing: 0.4,
    color: 'var(--text)', borderBottom: '1px solid var(--border)',
  },
  nav:  { flex: 1, padding: '10px 0', overflowY: 'auto' as const },
  group: { marginBottom: 12 },
  groupH: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px 5px', fontSize: 10, fontWeight: 700,
    letterSpacing: 1, textTransform: 'uppercase' as const, color: 'var(--muted)',
  },
  groupDot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' } as const,
  groupMode: { marginLeft: 'auto', fontSize: 9, fontWeight: 600, letterSpacing: 0, textTransform: 'none' as const, color: 'var(--faint)' },
  link: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '8px 11px', fontSize: 13, color: 'var(--text-mid)',
    textDecoration: 'none', borderRadius: 10, margin: '1px 8px',
    outline: 'none',
    transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
  },
  linkActive: { background: 'rgba(139,92,246,0.16)', color: '#ffffff', boxShadow: 'inset 0 0 0 1px rgba(139,92,246,0.45)' },
  linkLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  linkSoon: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '8px 11px', fontSize: 13, color: 'var(--faint)',
    borderRadius: 10, margin: '1px 8px', cursor: 'default',
    userSelect: 'none' as const,
  },
  soonBadge: {
    marginLeft: 'auto', flex: '0 0 auto', fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
    textTransform: 'uppercase' as const, color: '#9a7bff',
    background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)',
    borderRadius: 999, padding: '2px 6px',
  },
  footer: { borderTop: '1px solid var(--border)', padding: 12, fontSize: 12, color: 'var(--muted)' },
  sair: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
    padding: '8px 10px', marginTop: 8, fontSize: 13, color: 'var(--text-mid)',
    background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minWidth: 0 },
  content: {
    flex: 1, overflowY: 'auto' as const, color: 'var(--text)',
    background: 'radial-gradient(1200px 600px at 85% -10%, rgba(139,92,246,0.10), transparent 60%), radial-gradient(900px 500px at -5% 8%, rgba(59,130,246,0.06), transparent 55%), var(--bg)',
  },
  topbar: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-soft)', color: 'var(--text)', flexShrink: 0, borderBottom: '1px solid var(--border)' } as const,
  burger: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer' } as const,
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCarregando(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (carregando) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#868e96', fontFamily: 'system-ui' }}>Carregando…</div>
  if (!session) return <LoginPage />

  return <BrowserRouter><Shell session={session} /></BrowserRouter>
}

function Shell({ session }: { session: Session }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [tema, setTema] = useState<'dark' | 'light'>('dark')
  const trocarTema = () => { const n = tema === 'dark' ? 'light' : 'dark'; setTheme(n); setTema(n) }
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)')
    const h = () => { setIsMobile(mq.matches); if (!mq.matches) setMenuOpen(false) }
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  const sidebarStyle: CSSProperties = isMobile
    ? { ...S.sidebar, position: 'fixed', top: 0, left: 0, height: '100%', zIndex: 2000, transform: menuOpen ? 'none' : 'translateX(-100%)', transition: 'transform .2s ease', boxShadow: menuOpen ? '0 0 40px rgba(0,0,0,0.4)' : 'none' }
    : S.sidebar

  return (
    <div style={S.layout}>
      {isMobile && menuOpen && <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1900 }} />}
      <aside style={sidebarStyle}>
        <div style={{ ...S.logo, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          PlanOrc
          {isMobile && <X size={20} style={{ cursor: 'pointer' }} onClick={() => setMenuOpen(false)} />}
        </div>
        <style>{`
          .po-navlink{ outline:none !important; }
          .po-navlink:hover{ background:var(--panel-2); color:var(--text); }
          .po-navlink:focus, .po-navlink:focus-visible{ outline:none !important; box-shadow:none; }
        `}</style>
        <nav style={S.nav}>
          {NAV_GROUPS.map(g => (
            <div key={g.area} style={S.group}>
              <div style={S.groupH}>
                <span style={{ ...S.groupDot, background: g.dot }} />
                <span>{g.area}</span>
                {g.mode && <span style={S.groupMode}>{g.mode}</span>}
              </div>
              {g.items.map((item) => {
                const Icon = item.icon
                if (item.soon || !item.to) {
                  return (
                    <div key={item.label} style={S.linkSoon} title={item.label}>
                      <Icon size={15} style={{ opacity: 0.5, flex: '0 0 auto' }} />
                      <span style={S.linkLabel}>{item.label}</span>
                      <span style={S.soonBadge}>em breve</span>
                    </div>
                  )
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className="po-navlink"
                    onClick={() => setMenuOpen(false)}
                    style={({ isActive }) => ({ ...S.link, ...(isActive ? S.linkActive : {}) })}
                  >
                    <Icon size={15} style={{ opacity: 0.85, flex: '0 0 auto' }} />
                    <span style={S.linkLabel}>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div style={S.footer}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user?.email}</div>
          <button style={S.sair} onClick={trocarTema}>
            {tema === 'dark' ? <Sun size={14} /> : <Moon size={14} />} Tema {tema === 'dark' ? 'claro' : 'escuro'}
          </button>
          <button style={S.sair} onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Sair</button>
        </div>
      </aside>
      <main style={S.main}>
        {isMobile && (
          <div style={S.topbar}>
            <button style={S.burger} onClick={() => setMenuOpen(o => !o)} aria-label="Menu"><Menu size={20} /></button>
            <span style={{ fontWeight: 700 }}>PlanOrc</span>
          </div>
        )}
        <div style={S.content}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboards" replace />} />
            <Route path="/dashboards"      element={<DashboardsHubPage />} />
            <Route path="/dashboards/anual"     element={<ComparativoAnualPage />} />
            <Route path="/dashboards/cagr"      element={<CagrPage />} />
            <Route path="/dashboards/executivo" element={<ExecutivoPage />} />
            <Route path="/dashboards/indicadores" element={<IndicadoresPage />} />
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/balanco"         element={<BalancoDashboardPage />} />
            <Route path="/relatorios"      element={<RelatorioPage />} />
            <Route path="/relatorios/:id"  element={<RelatorioEditorPage />} />
            <Route path="/dre"             element={<DrePage />} />
            <Route path="/orcamento"       element={<OrcadoDadosPage />} />
            <Route path="/realizado"       element={<RealizadoDadosPage />} />
            <Route path="/saldos"          element={<SaldoDadosPage />} />
            <Route path="/amarracao"       element={<AmarracaoPage />} />
            <Route path="/cadastros"       element={<CadastrosPage />} />
            <Route path="/config"          element={<ConfiguracoesPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
