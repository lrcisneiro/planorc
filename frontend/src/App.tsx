import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { TrendingUp, Table2, LayoutDashboard, Settings, Building2, Database } from 'lucide-react'
import DrePage from './pages/dre/DrePage'
import OrcamentoPage from './pages/orcamento/OrcamentoPage'
import CadastrosPage from './pages/cadastros/CadastrosPage'

const navItems = [
  { to: '/dre',       icon: TrendingUp,     label: 'DRE' },
  { to: '/orcamento', icon: Table2,          label: 'Orçamento' },
  { to: '/cadastros', icon: Database,        label: 'Cadastros' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/config',    icon: Settings,        label: 'Config.' },
]

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f8f9fa' }}>
      {/* Sidebar */}
      <aside style={{
        width: 64, background: '#1e2d5a', display: 'flex',
        flexDirection: 'column', alignItems: 'center', padding: '16px 0', gap: 4
      }}>
        <div style={{
          width: 40, height: 40, background: '#3b5bdb', borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16
        }}>
          <Building2 size={20} color="white" />
        </div>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} style={({ isActive }) => ({
            width: 52, height: 52, borderRadius: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 2, textDecoration: 'none',
            fontSize: 10, transition: 'all 0.15s',
            background: isActive ? '#3b5bdb' : 'transparent',
            color: isActive ? 'white' : '#8899bb',
          })}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </aside>

      {/* Conteúdo */}
      <main style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dre" element={<DrePage />} />
          <Route path="/orcamento" element={<OrcamentoPage />} />
          <Route path="/cadastros" element={<CadastrosPage />} />
          <Route path="/dashboard" element={<div style={{ padding: 24 }}><h2>Dashboard — em breve</h2></div>} />
          <Route path="/config" element={<div style={{ padding: 24 }}><h2>Configurações — em breve</h2></div>} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
