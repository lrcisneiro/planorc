import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { LayoutDashboard, FileText, Settings, BookOpen, Table2, Receipt, Link2, Wallet, LogOut, Menu, X } from 'lucide-react'
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
import BalancoDashboardPage from './pages/balanco/BalancoDashboardPage'
import AmarracaoPage from './pages/amarracao/AmarracaoPage'
import SaldoDadosPage from './pages/saldos/SaldoDadosPage'
import ConfiguracoesPage from './pages/configuracoes/ConfiguracoesPage'
import LoginPage from './pages/login/LoginPage'

const NAV = [
  { to: '/dashboards', label: 'Dashboards',    icon: LayoutDashboard },
  { to: '/relatorios', label: 'Relatórios',    icon: Table2 },
  { to: '/orcamento',  label: 'Orçamento',     icon: FileText },
  { to: '/realizado',  label: 'Realizado',     icon: Receipt },
  { to: '/saldos',     label: 'Saldos (BP)',   icon: Wallet },
  { to: '/amarracao',  label: 'Amarração',     icon: Link2 },
  { to: '/cadastros',  label: 'Cadastros',     icon: BookOpen },
  { to: '/config',     label: 'Configurações', icon: Settings },
]

const S = {
  layout:  { display: 'flex', height: '100vh', overflow: 'hidden' } as const,
  sidebar: {
    width: 220, background: '#1e293b', color: '#cbd5e1',
    display: 'flex', flexDirection: 'column' as const, flexShrink: 0,
  },
  logo: {
    padding: '20px 16px 16px', fontSize: 18, fontWeight: 700,
    color: '#f8fafc', borderBottom: '1px solid #334155',
  },
  nav:  { flex: 1, padding: '12px 0', overflowY: 'auto' as const },
  link: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 16px', fontSize: 14, color: '#94a3b8',
    textDecoration: 'none', borderRadius: 6, margin: '1px 8px',
    transition: 'background 0.15s',
  },
  linkActive: { background: '#2563eb', color: '#fff' },
  footer: { borderTop: '1px solid #334155', padding: 12, fontSize: 12, color: '#94a3b8' },
  sair: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
    padding: '8px 10px', marginTop: 8, fontSize: 13, color: '#cbd5e1',
    background: 'transparent', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minWidth: 0 },
  content: { flex: 1, overflowY: 'auto' as const, background: '#f8f9fa' },
  topbar: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#1e293b', color: '#f8fafc', flexShrink: 0 } as const,
  burger: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, background: 'transparent', border: 'none', color: '#f8fafc', cursor: 'pointer' } as const,
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
        <nav style={S.nav}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMenuOpen(false)}
              style={({ isActive }) => ({ ...S.link, ...(isActive ? S.linkActive : {}) })}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={S.footer}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user?.email}</div>
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
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/balanco"         element={<BalancoDashboardPage />} />
            <Route path="/relatorios"      element={<RelatorioPage />} />
            <Route path="/relatorios/:id"  element={<RelatorioEditorPage />} />
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
