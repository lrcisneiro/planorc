// Grid reutilizável: cabeçalho ordenável (clique) + filtro por coluna (funil).
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Filter } from 'lucide-react'

export type GCol = { key: string; label: string; get?: (r: any) => any; align?: CSSProperties['textAlign'] }

export function useGrid(rows: any[], cols: GCol[]) {
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null)
  const [cf, setCf] = useState<Record<string, string>>({})
  const [filtrosOn, setFiltrosOn] = useState(false)
  const val = (r: any, k: string) => { const c = cols.find(x => x.key === k); return c?.get ? c.get(r) : r[k] }
  let out = rows
  const ativos = Object.entries(cf).filter(([, v]) => (v || '').trim())
  if (ativos.length) out = out.filter(r => ativos.every(([k, v]) => String(val(r, k) ?? '').toLowerCase().includes(v.trim().toLowerCase())))
  if (sort) out = [...out].sort((a, b) => {
    const av = val(a, sort.col), bv = val(b, sort.col)
    const c = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : String(av ?? '').localeCompare(String(bv ?? ''), 'pt', { numeric: true })
    return sort.dir === 'asc' ? c : -c
  })
  return { rows: out, sort, setSort, cf, setCf, filtrosOn, setFiltrosOn }
}

// Cabeçalho. `thStyle` = estilo base da célula de cabeçalho da página. Sempre há uma coluna
// extra à direita (funil + ações) — a página deve render uma <td> a mais por linha.
export function GridHead({ cols, grid, thStyle }: { cols: GCol[]; grid: ReturnType<typeof useGrid>; thStyle: CSSProperties }) {
  const toggle = (k: string) => grid.setSort(s => s?.col === k ? (s.dir === 'asc' ? { col: k, dir: 'desc' } : null) : { col: k, dir: 'asc' })
  const seta = (k: string) => grid.sort?.col === k ? (grid.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '2px 6px', fontSize: 11, border: '1px solid #dee2e6', borderRadius: 4 }
  return (
    <thead>
      <tr>
        {cols.map(c => <th key={c.key} style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', textAlign: c.align || 'left' }} title="Ordenar" onClick={() => toggle(c.key)}>{c.label}{seta(c.key)}</th>)}
        <th style={{ ...thStyle, width: 60, textAlign: 'right' }}>
          <button title="Filtrar por coluna" onClick={() => grid.setFiltrosOn(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: grid.filtrosOn ? '#3b5bdb' : '#adb5bd', padding: 0 }}><Filter size={14} /></button>
        </th>
      </tr>
      {grid.filtrosOn && (
        <tr>
          {cols.map(c => <th key={c.key} style={{ ...thStyle, padding: '3px 6px' }}><input value={grid.cf[c.key] || ''} onChange={e => grid.setCf(p => ({ ...p, [c.key]: e.target.value }))} placeholder="filtrar" style={inp} /></th>)}
          <th style={thStyle}></th>
        </tr>
      )}
    </thead>
  )
}
