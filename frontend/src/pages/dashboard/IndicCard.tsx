// Card de indicador do relatório — compartilhado pelos dashboards (Acompanhamento,
// Visão executiva). Mostra realizado, orçado e o ano anterior; em linha PERCENTUAL
// a comparação é em pontos percentuais (pp), não em % de execução.
import type { CSSProperties } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatValor } from '../../lib/engine'
import { statusMeta, resumoMeta, STATUS_UI } from '../../lib/indicadorMeta'
import type { IndicadorMeta } from '../../lib/indicadorMeta'

export type IC = { id: string; label: string; isPct: boolean; desp: boolean; casas: number; formato: any; R: number; O: number; P: number }

// Chip de faixa (Excelente/Saudável/Atenção/Crítico) — só aparece quando a linha
// tem meta cadastrada em Cadastros → Metas de indicadores.
export function ChipMeta({ valor, meta }: { valor: number; meta?: IndicadorMeta | null }) {
  // Indicador zerado quase sempre é dado faltando (a linha FTE não lançada, por
  // ex.), não desempenho crítico — classificar isso seria afirmar o que não se
  // sabe. Exceção: onde MENOR é melhor (churn, DSO), zero é resultado legítimo.
  if (!valor && meta?.maior_melhor !== false) return null
  const st = statusMeta(valor, meta)
  if (!st) return null
  const ui = STATUS_UI[st]
  return (
    <span title={meta?.comentario || undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, letterSpacing: 0.2, color: ui.cor, background: ui.fundo, whiteSpace: 'nowrap' }}>
      ● {ui.label}
    </span>
  )
}

export default function IndicCard({ c, anoPrev, meta }: { c: IC; anoPrev: number; meta?: IndicadorMeta | null }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, flex: 1, minWidth: 0 }}>{c.label}</div>
        <ChipMeta valor={c.R} meta={meta} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '6px 0 4px' }}>{f(c.R)}</div>
      {meta && <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 4 }}>{resumoMeta(meta, c.casas)}</div>}
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
