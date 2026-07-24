import { Link, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'

// Navegação (pills) da seção Posto de trabalho — FONTE ÚNICA da ordem e dos rótulos.
// Ordem = fluxo principal primeiro (orçar o quadro → estrutura → realizado da folha →
// conciliar) e as telas de apoio (memória de cálculo, rateio) no fim.
const PASSOS = [
  { to: '/postos',             label: 'Postos' },
  { to: '/postos/memoria',     label: 'Memória de cálculo' },
  { to: '/postos/folha',       label: 'Folha realizada' },
  { to: '/postos/conciliacao', label: 'Conciliação' },
  { to: '/postos/regras',      label: 'Estrutura' },
  { to: '/postos/rateio',      label: 'Rateio' },
]

const pill = (a: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: a ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : 'var(--text-mid)' })

// Rótulo do passo (com o número da ordem) — para citar um pill no texto das telas.
export const passoLabel = (to: string) => {
  const i = PASSOS.findIndex(p => p.to === to)
  return i < 0 ? '' : `${i + 1} · ${PASSOS[i].label}`
}

export function PostosPills() {
  const { pathname } = useLocation()
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {PASSOS.map((p, i) => {
        const ativo = p.to === '/postos' ? pathname === '/postos' : pathname.startsWith(p.to)
        const txt = `${i + 1} · ${p.label}`
        return ativo
          ? <span key={p.to} style={pill(true)}>{txt}</span>
          : <Link key={p.to} to={p.to} style={pill(false)}>{txt}</Link>
      })}
    </div>
  )
}
