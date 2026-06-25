import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard, BarChart3, Scale, Gauge, TrendingUp, ListChecks, Bookmark, Trash2, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { T } from '../../lib/theme'

const CARDS = [
  { to: '/dashboard',            titulo: 'DRE — Acompanhamento', desc: 'Execução orçado × realizado de UM ano, em granularidade mensal, trimestral ou semestral.', icon: LayoutDashboard, cor: '#3b5bdb' },
  { to: '/dashboards/anual',     titulo: 'DRE — Comparativo anual', desc: 'Compare vários anos lado a lado (Receita, EBITDA, Resultado…). Lê o cubo anual — rápido.', icon: BarChart3, cor: '#2f9e44' },
  { to: '/balanco',             titulo: 'Balanço', desc: 'Indicadores e índices patrimoniais: liquidez, endividamento, ciclo, estrutura.', icon: Scale, cor: '#7048e8' },
  { to: '/dashboards/executivo', titulo: 'Visão executiva', desc: 'KPIs de alto nível do ano: receita, EBITDA, resultado e execução orçamentária.', icon: Gauge, cor: '#e8590c' },
  { to: '/dashboards/cagr',      titulo: 'CAGR', desc: 'Crescimento anual composto de linhas selecionadas ao longo dos anos.', icon: TrendingUp, cor: '#1098ad' },
  { to: '/dashboards/indicadores', titulo: 'Indicadores', desc: 'Linhas do relatório como cards (EBITDA, margens, medidas com filtro de CC) — realizado × orçado × ano anterior.', icon: ListChecks, cor: '#0c8599' },
]
const BASE_NOME: Record<string, string> = {
  '/dashboard': 'DRE — Acompanhamento', '/dashboards/anual': 'DRE — Comparativo anual', '/balanco': 'Balanço',
  '/dashboards/executivo': 'Visão executiva', '/dashboards/cagr': 'CAGR', '/dashboards/indicadores': 'Indicadores',
}

type MeuCard = { id: string; nome: string; base: string; cor: string | null }

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 700, color: T.text, margin: 0 },
  sub:   { fontSize: 13, color: T.muted, margin: '4px 0 20px' },
  sechd: { fontSize: 12, color: T.faint, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '26px 0 10px' },
  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card:  { display: 'flex', gap: 14, alignItems: 'flex-start', background: `linear-gradient(180deg, ${T.panel}, ${T.bgSoft})`, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, textDecoration: 'none', color: 'inherit', transition: 'box-shadow .15s, transform .15s, border-color .15s' },
  ico:   { width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  ctit:  { fontSize: 15, fontWeight: 600, color: T.text, margin: 0 },
  cdesc: { fontSize: 12.5, color: T.muted, margin: '6px 0 0', lineHeight: 1.45 },
}

export default function DashboardsHubPage() {
  const [meus, setMeus] = useState<MeuCard[]>([])
  const loadMeus = () => { supabase.from('dashboard_card').select('id,nome,base,cor').order('ordem', { nullsFirst: false }).order('created_at').then(r => setMeus((r.data || []) as MeuCard[])) }
  useEffect(() => { loadMeus() }, [])
  const excluir = async (id: string, nome: string) => {
    if (!window.confirm(`Excluir o card "${nome}"?`)) return
    const { error } = await supabase.from('dashboard_card').delete().eq('id', id)
    if (error) { alert('Erro: ' + error.message); return }
    loadMeus()
  }
  const renomear = async (id: string, atual: string) => {
    const novo = window.prompt('Novo nome do card:', atual)?.trim()
    if (!novo || novo === atual) return
    const { error } = await supabase.from('dashboard_card').update({ nome: novo }).eq('id', id)
    if (error) { alert('Erro: ' + error.message); return }
    loadMeus()
  }

  const hover = (on: boolean) => (e: any) => { e.currentTarget.style.boxShadow = on ? '0 10px 30px rgba(0,0,0,0.4)' : 'none'; e.currentTarget.style.transform = on ? 'translateY(-2px)' : 'none'; e.currentTarget.style.borderColor = on ? 'var(--border-strong)' : 'var(--border)' }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Dashboards</h1>
      <p style={S.sub}>Escolha uma visão. Cada painel é separado para não carregar dados além do necessário.</p>
      <div style={S.grid}>
        {CARDS.map(c => {
          const Icon = c.icon
          return (
            <Link key={c.to} to={c.to} style={S.card} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>
              <div style={{ ...S.ico, background: c.cor + '1a', color: c.cor }}><Icon size={22} /></div>
              <div>
                <p style={S.ctit}>{c.titulo}</p>
                <p style={S.cdesc}>{c.desc}</p>
              </div>
            </Link>
          )
        })}
      </div>

      {meus.length > 0 && (
        <>
          <div style={S.sechd}>Meus cards</div>
          <div style={S.grid}>
            {meus.map(m => {
              const cor = m.cor || '#3b5bdb'
              return (
                <Link key={m.id} to={`${m.base}?card=${m.id}`} style={S.card} onMouseEnter={hover(true)} onMouseLeave={hover(false)}>
                  <div style={{ ...S.ico, background: cor + '1a', color: cor }}><Bookmark size={20} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={S.ctit}>{m.nome}</p>
                    <p style={S.cdesc}>{BASE_NOME[m.base] || m.base} · preset salvo</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <span title="Renomear" style={{ display: 'inline-flex' }} onClick={e => { e.preventDefault(); e.stopPropagation(); renomear(m.id, m.nome) }}>
                      <Pencil size={15} style={{ color: 'var(--muted)', cursor: 'pointer' }} />
                    </span>
                    <span title="Excluir" style={{ display: 'inline-flex' }} onClick={e => { e.preventDefault(); e.stopPropagation(); excluir(m.id, m.nome) }}>
                      <Trash2 size={15} style={{ color: 'var(--muted)', cursor: 'pointer' }} />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
