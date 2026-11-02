import { Link, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useCapacidades } from '../../hooks/useCapacidades'

// ============================================================
// Navegação da seção Dados do ERP — fonte única da ordem e dos rótulos.
//
// As três telas eram um GRUPO no menu lateral, com três linhas permanentes.
// Viraram um item só em Base, porque são o mesmo assunto — o que o ERP
// manda — e porque quem orça não entra nelas todo dia. Mesma mecânica de
// Posto de trabalho: passo sem capacidade some e a numeração se refaz sem
// buraco, por isso o número sai da lista VISÍVEL e nunca de PASSOS.
//
// Ordem = o fluxo: o razão chega, o balancete chega, e a amarração é o que
// liga as contas do ERP às linhas do relatório.
// ============================================================

export const PASSOS: { to: string; label: string; cap: string }[] = [
  { to: '/realizado', label: 'Realizado',   cap: 'menu.realizado' },
  { to: '/saldos',    label: 'Saldos (BP)', cap: 'menu.saldos' },
  { to: '/amarracao', label: 'Amarração',   cap: 'menu.amarracao' },
]

const pill = (a: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5,
  borderRadius: 99, textDecoration: 'none', cursor: a ? 'default' : 'pointer', fontWeight: 600,
  border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'),
  background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)',
  color: a ? 'var(--violet)' : 'var(--text-mid)',
})

/** Primeiro passo que a pessoa alcança — é para onde o item do menu aponta.
 *  Fixar `/realizado` mandaria quem só tem Amarração para uma tela negada. */
export function useErpInicio(): string | null {
  const { can } = useCapacidades()
  return PASSOS.find(p => can(p.cap))?.to ?? null
}

export function ErpPills() {
  const { pathname } = useLocation()
  const { can } = useCapacidades()
  const visiveis = PASSOS.filter(p => can(p.cap))
  if (visiveis.length < 2) return null   // uma pill só não é navegação
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0 0 16px' }}>
      {visiveis.map((p, i) => {
        const ativo = pathname.startsWith(p.to)
        const txt = `${i + 1} · ${p.label}`
        return ativo
          ? <span key={p.to} style={pill(true)}>{txt}</span>
          : <Link key={p.to} to={p.to} style={pill(false)}>{txt}</Link>
      })}
    </div>
  )
}
