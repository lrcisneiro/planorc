import { Link, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useTenantFlags } from '../../lib/tenantFlags'
import { useCapacidades } from '../../hooks/useCapacidades'

// Navegação (pills) da seção Posto de trabalho — FONTE ÚNICA da ordem e dos rótulos.
// Ordem = fluxo principal primeiro (orçar o quadro → estrutura → realizado da folha →
// conciliar) e as telas de apoio (memória de cálculo, rateio) no fim.
//
// `flag` = passo que só existe onde a funcionalidade existe (tenant.usa_apontamento).
// Some da navegação inteira quando desligado, e a numeração se refaz sem buraco —
// por isso o número é sempre calculado sobre a lista VISÍVEL, nunca sobre PASSOS.
//
// `cap` = capacidade que o passo exige. Mesma mecânica da flag: o passo some da
// navegação inteira e a numeração se refaz sem buraco. São duas perguntas
// diferentes e por isso dois campos — a FLAG diz se a funcionalidade existe
// nesta instalação, a CAPACIDADE diz se esta pessoa pode usá-la.
const PASSOS: { to: string; label: string; flag?: 'usa_apontamento'; cap: string }[] = [
  { to: '/postos',             label: 'Postos',             cap: 'menu.postos.quadro' },
  { to: '/postos/memoria',     label: 'Memória de cálculo', cap: 'menu.postos.memoria' },
  { to: '/postos/folha',       label: 'Folha realizada',    cap: 'menu.postos.folha' },
  { to: '/postos/apontamento', label: 'Apontamento',        cap: 'menu.postos.apontamento', flag: 'usa_apontamento' },
  { to: '/postos/conciliacao', label: 'Conciliação',        cap: 'menu.postos.conciliacao' },
  { to: '/postos/regras',      label: 'Estrutura',          cap: 'menu.postos.estrutura' },
  { to: '/postos/rateio',      label: 'Rateio',             cap: 'menu.postos.rateio' },
]

const pill = (a: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: a ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : 'var(--text-mid)' })

// Rótulo do passo (com o número da ordem) — para citar um pill no texto das telas.
// Hook, porque o número depende de quais passos estão ligados neste tenant.
export function usePassoLabel() {
  const flags = useTenantFlags()
  const { can } = useCapacidades()
  const visiveis = PASSOS.filter(p => (!p.flag || flags[p.flag]) && can(p.cap))
  return (to: string) => {
    const i = visiveis.findIndex(p => p.to === to)
    return i < 0 ? '' : `${i + 1} · ${visiveis[i].label}`
  }
}

export function PostosPills() {
  const { pathname } = useLocation()
  const flags = useTenantFlags()
  const { can } = useCapacidades()
  const visiveis = PASSOS.filter(p => (!p.flag || flags[p.flag]) && can(p.cap))
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
