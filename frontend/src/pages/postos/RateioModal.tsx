import type { CSSProperties } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { cascataRateio } from '../../lib/rateioFolha'
import { passoLabel } from './PostosPills'

// Modal de rateio por posto — cascata dos códigos anexados + resultado no grão final.
// Compartilhado pela grade (/postos) e pela memória (/postos/memoria).

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const th: CSSProperties = { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap' }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }

export type Anexo = { regra_id: string; ordem: number }

export function RateioModal({ posto, totMes, totAno, anexos, rateioCods, destByRegra, empById, ccById, onClose }: {
  posto: any
  totMes: number
  totAno: number
  anexos: Anexo[]
  rateioCods: any[]
  destByRegra: Record<string, any[]>
  empById: Map<string, any>
  ccById: Map<string, any>
  onClose: () => void
}) {
  const { steps, cells: finais } = cascataRateio({ empresa_id: posto.empresa_id, cc_id: posto.cc_id || null }, anexos, rateioCods, destByRegra)
  const somaPct = finais.reduce((s, c) => s + c.pct, 0)
  const ok = Math.abs(somaPct - 1) < 0.0001
  const nomeEmp = (id: string | null) => { const e = id ? empById.get(id) : null; return e ? `${e.codigo} · ${e.descricao}` : '—' }
  const nomeCc = (id: string | null) => { const c = id ? ccById.get(id) : null; return c ? `${c.codigo} · ${c.descricao}` : '—' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={onClose}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, width: 'min(760px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Rateio · {posto.codigo} {posto.nome ? `· ${posto.nome}` : '· Vaga'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Origem: <b>{posto.empresa?.codigo || '—'}</b> · CC <b>{posto.centro_custo?.codigo || '—'}</b> · custo/mês {money(totMes)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '14px 20px' }}>
          {/* cascata */}
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 8 }}>Cascata</div>
          {!steps.length && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Sem código de rateio — 100% na empresa/CC do posto.</div>}
          {steps.map((s, i) => (
            <div key={i} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: '2px solid var(--violet)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>{s.ordem} · {s.cod.nome} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({s.cod.dimensao === 'CC' ? 'por CC' : 'por empresa'})</span></div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.dests.map((d: any, j: number) => (
                <span key={j} style={{ marginRight: 12 }}>{s.cod.dimensao === 'CC' ? nomeCc(d.cc_id) : nomeEmp(d.empresa_id)} <b style={{ color: 'var(--text-mid)' }}>{(Number(d.pct) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</b></span>
              ))}</div>
            </div>
          ))}

          {/* resultado */}
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '16px 0 8px' }}>Resultado (grão final)</div>
          <table style={table}>
            <thead><tr><th style={th}>Empresa</th><th style={th}>Centro de custo</th><th style={{ ...th, textAlign: 'right' }}>%</th><th style={{ ...th, textAlign: 'right' }}>Custo/mês</th><th style={{ ...th, textAlign: 'right' }}>Custo/ano</th></tr></thead>
            <tbody>
              {finais.map((c, i) => (
                <tr key={i}>
                  <td style={td}>{nomeEmp(c.empresa_id)}</td>
                  <td style={td}>{nomeCc(c.cc_id)}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{(c.pct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
                  <td style={{ ...td, textAlign: 'right' }}>{money(totMes * c.pct)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(totAno * c.pct)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, fontWeight: 700 }} colSpan={2}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: ok ? 'var(--green)' : 'var(--orange)' }}>{(somaPct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(totMes * somaPct)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(totAno * somaPct)}</td>
              </tr>
            </tbody>
          </table>
          {!ok && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--orange)', fontSize: 12.5 }}>
            <AlertTriangle size={15} /> A soma do rateio é {(somaPct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% — algum código não fecha 100%. Ajuste os destinos em <b>{passoLabel('/postos/rateio')}</b> antes de aplicar.</div>}
        </div>
      </div>
    </div>
  )
}
