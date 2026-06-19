import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export type RefLinha = { codigo: string; descricao: string }

// Funções disponíveis (nomes em PT, resolvidos pelo engine)
const FUNCS: { name: string; insert: string; desc: string }[] = [
  { name: 'ANTERIOR',              insert: 'ANTERIOR()',               desc: 'valor do mês anterior' },
  { name: 'MEDIA',                 insert: 'MEDIA(',                   desc: 'média' },
  { name: 'MEDIANA',              insert: 'MEDIANA(',                 desc: 'mediana' },
  { name: 'SOMA',                  insert: 'SOMA(',                    desc: 'soma' },
  { name: 'MINIMO',                insert: 'MINIMO(',                  desc: 'mínimo' },
  { name: 'MAXIMO',                insert: 'MAXIMO(',                  desc: 'máximo' },
  { name: 'ARREDONDAR',            insert: 'ARREDONDAR(',              desc: 'arredonda' },
  { name: 'ARREDONDAR.PARA.BAIXO', insert: 'ARREDONDAR.PARA.BAIXO(',  desc: 'arredonda p/ baixo' },
  { name: 'ARREDONDAR.PARA.CIMA',  insert: 'ARREDONDAR.PARA.CIMA(',   desc: 'arredonda p/ cima' },
  { name: 'SE',                    insert: 'SE(',                      desc: 'condicional' },
  { name: 'CONCATENAR',            insert: 'CONCATENAR(',              desc: 'concatena texto' },
]

type Sug =
  | { kind: 'fn'; label: string; sub: string; insert: string }
  | { kind: 'ref'; label: string; sub: string; codigo: string }

const ST: Record<string, CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-block' },
  drop: {
    position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 2000,
    background: 'white', border: '1px solid #dee2e6', borderRadius: 8, minWidth: 260, maxWidth: 320,
    maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', textAlign: 'left',
  },
  name: { fontWeight: 600, color: '#212529', fontFamily: 'monospace' },
  sub:  { color: '#adb5bd', marginLeft: 'auto', fontSize: 11 },
}
const itemStyle = (hi: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
  background: hi ? '#edf2ff' : 'white',
})
const tagStyle = (c: string): CSSProperties => ({ fontSize: 9, fontWeight: 700, color: c, width: 26, flexShrink: 0 })

export default function FormulaCellInput({ value, onChange, onCommit, onCancel, onFill, onDetail, linhas, inputStyle, fullWidth }: {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  onCancel?: () => void
  onFill?: () => void
  onDetail?: () => void
  linhas: RefLinha[]
  inputStyle: CSSProperties
  fullWidth?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [hi, setHi] = useState(0)
  const [closed, setClosed] = useState(false)
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (pendingCaret != null && ref.current) {
      ref.current.focus()
      ref.current.setSelectionRange(pendingCaret, pendingCaret)
      setPendingCaret(null)
    }
  }, [pendingCaret])

  const isFormula = value.trimStart().startsWith('=')
  const caret = ref.current?.selectionStart ?? value.length

  // Token atual (palavra sendo digitada antes do cursor)
  let i = caret
  while (i > 0 && /[A-Za-zÀ-ÿ0-9_.]/.test(value[i - 1])) i--
  const token = value.slice(i, caret)
  const refMode = value[i - 1] === '['

  // Só sugere se estiver no início de um termo: logo após = ( + - * / ; , espaço,
  // se houver token sendo digitado, ou logo após [ (modo referência).
  const prevCh = value[i - 1] ?? ''
  const atTermStart = ['=', '(', '+', '-', '*', '/', ';', ',', ' '].includes(prevCh)
  const tokenIsNumber = /^[0-9]/.test(token)   // está digitando um número → não sugere referência
  const showByToken = (token.length > 0 || refMode || atTermStart) && !(tokenIsNumber && !refMode)

  // Monta sugestões
  const T = token.toUpperCase()
  let sugs: Sug[] = []
  if (isFormula && !closed && showByToken) {
    const refs: Sug[] = linhas
      .filter(l => !!l.descricao && (!T || l.codigo.toUpperCase().includes(T) || l.descricao.toUpperCase().includes(T)))
      .slice(0, 8)
      .map(l => ({ kind: 'ref' as const, label: l.descricao, sub: l.codigo, codigo: l.descricao }))
    if (refMode) {
      sugs = refs
    } else {
      const fns: Sug[] = FUNCS
        .filter(f => !T || f.name.toUpperCase().includes(T))
        .map(f => ({ kind: 'fn' as const, label: f.name, sub: f.desc, insert: f.insert }))
      sugs = [...fns, ...refs].slice(0, 10)
    }
  }
  const open = sugs.length > 0

  const accept = (s: Sug) => {
    const insert = s.kind === 'fn' ? s.insert : (refMode ? `${s.codigo}]` : `[${s.codigo}]`)
    const before = value.slice(0, caret - token.length)
    const after = value.slice(caret)
    const next = before + insert + after
    onChange(next)
    setPendingCaret((before + insert).length)
    setHi(0)
  }

  return (
    <span style={{ ...ST.wrap, ...(fullWidth ? { display: 'block', width: '100%' } : {}) }}>
      <input
        ref={ref}
        style={{ ...inputStyle, width: fullWidth ? '100%' : (isFormula ? 180 : (inputStyle.width as number)), boxSizing: 'border-box' }}
        autoFocus={!fullWidth}
        value={value}
        onChange={e => { onChange(e.target.value); setClosed(false); setHi(0) }}
        onBlur={() => { if (!open) onCommit?.() }}
        onKeyDown={e => {
          // Ctrl/Cmd+Enter → replicar até dezembro (mesmo com menu aberto)
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onFill) { e.preventDefault(); onFill(); return }
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % sugs.length); return }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => (h - 1 + sugs.length) % sugs.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(sugs[hi]); return }
            if (e.key === 'Escape')    { e.preventDefault(); setClosed(true); return }
          } else {
            if (e.key === 'Enter') { onCommit?.(); return }
            if (e.key === 'Escape') { onCancel?.(); return }
          }
        }}
      />
      {onFill && (
        <button
          title="Replicar até dezembro (Ctrl+Enter)"
          onMouseDown={e => { e.preventDefault(); onFill() }}
          style={{ marginLeft: 4, padding: '2px 6px', fontSize: 11, border: '1px solid #69db7c', background: '#ebfbee', color: '#2f9e44', borderRadius: 4, cursor: 'pointer' }}>
          →|
        </button>
      )}
      {onDetail && (
        <button
          title="Lançamentos detalhados (adicionar por filial/CC/dimensão)"
          onMouseDown={e => { e.preventDefault(); onDetail() }}
          style={{ marginLeft: 4, padding: '2px 6px', fontSize: 11, border: '1px solid #a5d8ff', background: '#e7f5ff', color: '#1971c2', borderRadius: 4, cursor: 'pointer' }}>
          ⋯
        </button>
      )}
      {open && (
        <div style={ST.drop} onMouseDown={e => e.preventDefault()}>
          {sugs.map((s, idx) => (
            <div key={idx} style={itemStyle(idx === hi)}
              onMouseEnter={() => setHi(idx)}
              onMouseDown={e => { e.preventDefault(); accept(s) }}>
              <span style={tagStyle(s.kind === 'fn' ? '#6741d9' : '#1971c2')}>{s.kind === 'fn' ? 'ƒ(x)' : '[ ]'}</span>
              <span style={ST.name}>{s.label}</span>
              <span style={ST.sub}>{s.sub}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
