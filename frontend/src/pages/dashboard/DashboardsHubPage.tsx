import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, BarChart3, Scale, Gauge, TrendingUp } from 'lucide-react'

const CARDS = [
  { to: '/dashboard',            titulo: 'DRE — Acompanhamento', desc: 'Execução orçado × realizado de UM ano, em granularidade mensal, trimestral ou semestral.', icon: LayoutDashboard, cor: '#3b5bdb' },
  { to: '/dashboards/anual',     titulo: 'DRE — Comparativo anual', desc: 'Compare vários anos lado a lado (Receita, EBITDA, Resultado…). Lê o cubo anual — rápido.', icon: BarChart3, cor: '#2f9e44' },
  { to: '/balanco',             titulo: 'Balanço', desc: 'Indicadores e índices patrimoniais: liquidez, endividamento, ciclo, estrutura.', icon: Scale, cor: '#7048e8' },
  { to: '/dashboards/executivo', titulo: 'Visão executiva', desc: 'KPIs de alto nível do ano: receita, EBITDA, resultado e execução orçamentária.', icon: Gauge, cor: '#e8590c' },
  { to: '/dashboards/cagr',      titulo: 'CAGR', desc: 'Crescimento anual composto de linhas selecionadas ao longo dos anos.', icon: TrendingUp, cor: '#1098ad' },
]

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:   { fontSize: 13, color: '#868e96', margin: '4px 0 20px' },
  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card:  { display: 'flex', gap: 14, alignItems: 'flex-start', background: 'white', border: '1px solid #e9ecef', borderRadius: 14, padding: 18, textDecoration: 'none', color: 'inherit', transition: 'box-shadow .15s, transform .15s' },
  ico:   { width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ctit:  { fontSize: 15, fontWeight: 600, color: '#212529', margin: 0 },
  cdesc: { fontSize: 12.5, color: '#868e96', margin: '6px 0 0', lineHeight: 1.45 },
}

export default function DashboardsHubPage() {
  return (
    <div style={S.page}>
      <h1 style={S.title}>Dashboards</h1>
      <p style={S.sub}>Escolha uma visão. Cada painel é separado para não carregar dados além do necessário.</p>
      <div style={S.grid}>
        {CARDS.map(c => {
          const Icon = c.icon
          return (
            <Link key={c.to} to={c.to} style={S.card}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 10px 30px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; (e.currentTarget as HTMLElement).style.transform = 'none' }}>
              <div style={{ ...S.ico, background: c.cor + '1a', color: c.cor }}><Icon size={22} /></div>
              <div>
                <p style={S.ctit}>{c.titulo}</p>
                <p style={S.cdesc}>{c.desc}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
