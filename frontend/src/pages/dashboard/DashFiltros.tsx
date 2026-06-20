import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Filter, X } from 'lucide-react'

export type Item = { id: string; codigo: string; descricao: string }

const cut = (s: string, n: number) => (s || '').length > n ? s.slice(0, n) + '…' : (s || '')
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#495057' }
const label: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 6 }
const btn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' }
const pop: CSSProperties = { position: 'absolute', top: '110%', left: 0, zIndex: 1500, background: 'white', border: '1px solid #e9ecef', borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.16)', padding: 16, width: 'min(440px, 92vw)', maxHeight: '78vh', overflow: 'auto' }

export function Checklist({ titulo, items, sel, setSel }: { titulo: string; items: Item[]; sel: string[]; setSel: (v: string[]) => void }) {
  const [b, setB] = useState('')
  const f = b ? items.filter(i => `${i.codigo} ${i.descricao}`.toLowerCase().includes(b.toLowerCase())) : items
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ ...label, margin: 0 }}>{titulo}</label>
        <span style={{ fontSize: 11, color: '#adb5bd' }}>{sel.length ? `${sel.length} de ${items.length}` : 'todas'}</span>
        <div style={{ flex: 1 }} />
        <button style={miniBtn} onClick={() => setSel(items.map(i => i.id))}>Todas</button>
        <button style={miniBtn} onClick={() => setSel([])}>Limpar</button>
      </div>
      {items.length > 8 && <input style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid #ced4da', borderRadius: 6, marginBottom: 6, boxSizing: 'border-box' }} placeholder="filtrar…" value={b} onChange={e => setB(e.target.value)} />}
      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #f1f3f5', borderRadius: 8, padding: 6 }}>
        {f.map(i => (
          <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 2px', cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
            <span style={{ fontFamily: 'monospace', color: '#868e96', fontSize: 12 }}>{i.codigo}</span> {cut(i.descricao, 34)}
          </label>
        ))}
        {!f.length && <div style={{ fontSize: 12, color: '#adb5bd', padding: 6 }}>Nada encontrado.</div>}
      </div>
    </div>
  )
}

// Botão "Filtros" com popover de Empresa/Filial/CC (multi-seleção). Vazio = todas.
export function FiltrosButton({ empresas, filiais, ccs, empresaSel, setEmpresaSel, filialSel, setFilialSel, ccSel, setCcSel }: {
  empresas: Item[]; filiais: Item[]; ccs: Item[]
  empresaSel: string[]; setEmpresaSel: (v: string[]) => void
  filialSel: string[]; setFilialSel: (v: string[]) => void
  ccSel: string[]; setCcSel: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const n = empresaSel.length + filialSel.length + ccSel.length
  return (
    <div style={{ position: 'relative' }}>
      <button style={btn} onClick={() => setOpen(o => !o)}><Filter size={13} /> Filtros{n ? ` (${n})` : ''}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
          <div style={pop}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <strong style={{ fontSize: 14, color: '#212529' }}>Filtros</strong>
              <div style={{ flex: 1 }} />
              <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={() => setOpen(false)} />
            </div>
            <Checklist titulo="Empresas" items={empresas} sel={empresaSel} setSel={setEmpresaSel} />
            <Checklist titulo="Filiais" items={filiais} sel={filialSel} setSel={setFilialSel} />
            <Checklist titulo="Centros de custo" items={ccs} sel={ccSel} setSel={setCcSel} />
            <button style={{ ...btn, width: '100%', justifyContent: 'center', marginTop: 14, background: '#3b5bdb', color: 'white', borderColor: '#3b5bdb' }} onClick={() => setOpen(false)}>Aplicar e fechar</button>
          </div>
        </>
      )}
    </div>
  )
}
