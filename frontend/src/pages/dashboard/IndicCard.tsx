// Card de indicador do relatório — compartilhado pelos dashboards (Acompanhamento,
// Visão executiva). Mostra realizado, orçado e o ano anterior; em linha PERCENTUAL
// a comparação é em pontos percentuais (pp), não em % de execução.
import type { CSSProperties } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatValor } from '../../lib/engine'

export type IC = { id: string; label: string; isPct: boolean; desp: boolean; casas: number; formato: any; R: number; O: number; P: number }

export default function IndicCard({ c, anoPrev }: { c: IC; anoPrev: number }) {
  const f = (v: number) => formatValor(v, c.formato, c.casas)
  const d = c.R - c.O
  const exec = (!c.isPct && c.O !== 0) ? (c.R / c.O) * 100 : null
  const bomExec = exec == null ? true : c.desp ? exec <= 100 : exec >= 100
  const yoyPct = (!c.isPct && c.P !== 0) ? (c.R / c.P - 1) * 100 : null
  const bomY = c.desp ? c.R <= c.P : c.R >= c.P
  const Arrow = (bom: boolean) => bom ? <TrendingUp size={13} /> : <TrendingDown size={13} />
  const ksub: CSSProperties = { fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{c.label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '6px 0 4px' }}>{f(c.R)}</div>
      <div style={ksub}>Orçado {f(c.O)} · {c.isPct
        ? <span style={{ color: bomY ? '#2f9e44' : '#e03131' }}>{d >= 0 ? '+' : ''}{formatValor(d, 'NUMERO', c.casas)} pp</span>
        : (exec == null ? '—' : <span style={{ color: bomExec ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{Arrow(bomExec)}{exec.toFixed(0)}%</span>)}</div>
      <div style={{ ...ksub, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--panel)' }}>
        <strong style={{ color: 'var(--text-mid)' }}>{anoPrev}</strong> {f(c.P)} · {c.isPct
          ? <span style={{ color: bomY ? '#2f9e44' : '#e03131' }}>{(c.R - c.P) >= 0 ? '+' : ''}{formatValor(c.R - c.P, 'NUMERO', c.casas)} pp</span>
          : (yoyPct == null ? '—' : <span style={{ color: bomY ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{Arrow(bomY)}{yoyPct >= 0 ? '+' : ''}{yoyPct.toFixed(0)}%</span>)}
      </div>
    </div>
  )
}
