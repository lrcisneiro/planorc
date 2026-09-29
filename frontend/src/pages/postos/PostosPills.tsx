import { Link, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useTenantFlags } from '../../lib/tenantFlags'

// Navegação (pills) da seção Posto de trabalho — FONTE ÚNICA da ordem e dos rótulos.
// Ordem = fluxo principal primeiro (orçar o quadro → estrutura → realizado da folha →
// conciliar) e as telas de apoio (memória de cálculo, rateio) no fim.
//
// `flag` = passo que só existe onde a funcionalidade existe (tenant.usa_apontamento).
// Some da navegação inteira quando desligado, e a numeração se refaz sem buraco —
// por isso o número é sempre calculado sobre a lista VISÍVEL, nunca sobre PASSOS.
const PASSOS: { to: string; label: string; flag?: 'usa_apontamento' }[] = [
  { to: '/postos',             label: 'Postos' },
  { to: '/postos/memoria',     label: 'Memória de cálculo' },
  { to: '/postos/folha',       label: 'Folha realizada' },
  { to: '/postos/apontamento', label: 'Apontamento', flag: 'usa_apontamento' },
  { to: '/postos/conciliacao', label: 'Conciliação' },
  { to: '/postos/regras',      label: 'Estrutura' },
  { to: '/postos/rateio',      label: 'Rateio' },
]

const pill = (a: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: a ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : 'var(--text-mid)' })

// Rótulo do passo (com o número da ordem) — para citar um pill no texto das telas.
// Hook, porque o número depende de quais passos estão ligados neste tenant.
export function usePassoLabel() {
  const flags = useTenantFlags()
  const visiveis = PASSOS.filter(p => !p.flag || flags[p.flag])
  return (to: string) => {
    const i = visiveis.findIndex(p => p.to === to)
    return i < 0 ? '' : `${i + 1} · ${visiveis[i].label}`
  }
}

export function PostosPills() {
  const { pathname } = useLocation()
  const flags = useTenantFlags()
  const visiveis = PASSOS.filter(p => !p.flag || flags[p.flag])
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {visiveis.map((p, i) => {
        const ativo = p.to === '/postos' ? pathname === '/postos' : pathname.startsWith(p.to)
        const txt = `${i + 1} · ${p.label}`
        return ativo
          ? <span key={p.to} style={pill(true)}>{txt}</span>
          : <Link key={p.to} to={p.to} style={pill(false)}>{txt}</Link>
      })}
    </div>
  )
}
