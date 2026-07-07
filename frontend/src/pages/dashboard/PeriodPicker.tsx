import { Fragment } from 'react'
import type { CSSProperties } from 'react'

export type Periodo = { ano: number; mes: number }

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Grade visual de período (anos × meses) — seleção MÚLTIPLA/avulsa (cada quadrado é um período; não precisa ser contígua).
// Clique liga/desliga um mês; clique no ano liga/desliga o ano inteiro. Compartilhado por relatório e dashboard.
export function PeriodPicker({ anos, sel, onChange }: {
  anos: number[]; sel: Periodo[]; onChange: (sel: Periodo[]) => void
}) {
  const has = (y: number, m: number) => sel.some(p => p.ano === y && p.mes === m)
  const toggle = (y: number, m: number) =>
    onChange(has(y, m) ? sel.filter(p => !(p.ano === y && p.mes === m)) : [...sel, { ano: y, mes: m }])
  const toggleYear = (y: number) => {
    const full = MESES.every((_, i) => has(y, i + 1))
    const rest = sel.filter(p => p.ano !== y)
    onChange(full ? rest : [...rest, ...MESES.map((_, i) => ({ ano: y, mes: i + 1 }))])
  }
  const hb: CSSProperties = { fontSize: 10, color: 'var(--muted)', textAlign: 'center', padding: '2px 0' }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `44px repeat(12, minmax(20px, 1fr))`, gap: 2, minWidth: 360 }}>
        <div />
        {MESES.map((m, i) => <div key={i} style={hb}>{m}</div>)}
        {anos.map(y => (
          <Fragment key={y}>
            <div onClick={() => toggleYear(y)} title="Marcar/desmarcar o ano inteiro"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>{y}</div>
            {MESES.map((_, i) => {
              const mes = i + 1, on = has(y, mes)
              return (
                <div key={i} onClick={() => toggle(y, mes)} title={`${MESES[i]}/${y}`}
                  style={{ height: 24, borderRadius: 4, cursor: 'pointer',
                    background: on ? 'var(--violet)' : 'var(--bg)',
                    border: '1px solid ' + (on ? 'var(--violet)' : 'var(--panel-2)') }} />
              )
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
        Clique nos meses para marcar/desmarcar — pode ser avulso, não precisa ser contínuo. (Clique no ano = ano inteiro.)
      </div>
    </div>
  )
}
