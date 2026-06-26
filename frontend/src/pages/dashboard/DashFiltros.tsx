import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Filter, X, CalendarRange, Bookmark } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'

export type Item = { id: string; codigo: string; descricao: string }

const cut = (s: string, n: number) => (s || '').length > n ? s.slice(0, n) + '…' : (s || '')
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', cursor: 'pointer', color: 'var(--text-mid)' }
const label: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 }
const btn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1490 }
const modalBox: CSSProperties = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1500, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', padding: 16, maxHeight: '85vh', overflowY: 'auto', overflowX: 'hidden' }

// Modal centralizado reutilizável (cabeçalho com Aplicar/X no topo)
export function ModalPanel({ titulo, onClose, children, width }: { titulo: string; onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <>
      <div style={overlay} onClick={onClose} />
      <div style={{ ...modalBox, width: width || 'min(860px, calc(100vw - 40px))' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14, color: 'var(--text)' }}>{titulo}</strong>
          <div style={{ flex: 1 }} />
          <button style={{ ...btn, padding: '5px 12px', background: 'var(--violet)', color: '#ffffff', borderColor: 'var(--violet)' }} onClick={onClose}>Aplicar e fechar</button>
          <X size={18} style={{ cursor: 'pointer', color: 'var(--muted)', marginLeft: 8 }} onClick={onClose} />
        </div>
        {children}
      </div>
    </>
  )
}

// Botão "Períodos" — invólucro padrão; o conteúdo (seletor de tempo) é injetado por cada dashboard.
export function PeriodoButton({ children, resumo, width }: { children: ReactNode; resumo?: string; width?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button style={btn} onClick={() => setOpen(true)}><CalendarRange size={13} /> Períodos{resumo ? ` · ${resumo}` : ''}</button>
      {open && <ModalPanel titulo="Períodos" onClose={() => setOpen(false)} width={width}>{children}</ModalPanel>}
    </div>
  )
}

export function Checklist({ titulo, items, sel, setSel }: { titulo: string; items: Item[]; sel: string[]; setSel: (v: string[]) => void }) {
  const [b, setB] = useState('')
  const f = b ? items.filter(i => `${i.codigo} ${i.descricao}`.toLowerCase().includes(b.toLowerCase())) : items
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ ...label, margin: 0 }}>{titulo}</label>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sel.length ? `${sel.length} de ${items.length}` : 'todas'}</span>
        <div style={{ flex: 1 }} />
        <button style={miniBtn} onClick={() => setSel(items.map(i => i.id))}>Todas</button>
        <button style={miniBtn} onClick={() => setSel([])}>Limpar</button>
      </div>
      {items.length > 8 && <input style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 6, marginBottom: 6, boxSizing: 'border-box' }} placeholder="filtrar…" value={b} onChange={e => setB(e.target.value)} />}
      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--panel)', borderRadius: 8, padding: 6 }}>
        {f.map(i => (
          <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 2px', cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
            <span style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: 12 }}>{i.codigo}</span> {cut(i.descricao, 34)}
          </label>
        ))}
        {!f.length && <div style={{ fontSize: 12, color: 'var(--muted)', padding: 6 }}>Nada encontrado.</div>}
      </div>
    </div>
  )
}

// CC com atributos derivados (Área/Divisão/BU)
export type CC = Item & { area_cod?: string | null; area_nome?: string | null; divisao_cod?: string | null; divisao_nome?: string | null; bu_cod?: string | null; bu_nome?: string | null }

// opções distintas de um atributo a partir da lista de CCs (id = código do atributo)
export function opcoesAttr(ccs: CC[], codKey: keyof CC, nomeKey: keyof CC): Item[] {
  const m = new Map<string, string>()
  ccs.forEach(c => { const cod = c[codKey] as string | null; if (cod) m.set(cod, (c[nomeKey] as string) || cod) })
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cod, nome]) => ({ id: cod, codigo: cod, descricao: nome }))
}

// Expande os filtros (CC + Área/Divisão/BU) para o conjunto efetivo de cc_id.
// Retorna null quando nada restringe os CCs (= todos).
export function effectiveCcFilter(ccs: CC[], ccSel: string[], areaSel: string[], divisaoSel: string[], buSel: string[]): string[] | null {
  if (!ccSel.length && !areaSel.length && !divisaoSel.length && !buSel.length) return null
  if (!ccs.length) return null  // lista de CCs ainda não carregada → não filtra (evita zerar)
  // uma dimensão só RESTRINGE quando um SUBCONJUNTO das opções está marcado.
  // vazio OU todas marcadas = sem restrição (preserva CCs com aquela dimensão nula, ex.: Adm sem BU).
  const distinct = (k: keyof CC) => new Set(ccs.map(c => c[k] as string).filter(Boolean)).size
  const restrAREA = areaSel.length > 0 && areaSel.length < distinct('area_cod')
  const restrDIV  = divisaoSel.length > 0 && divisaoSel.length < distinct('divisao_cod')
  const restrBU   = buSel.length > 0 && buSel.length < distinct('bu_cod')
  const restrCC   = ccSel.length > 0 && ccSel.length < ccs.length
  if (!restrAREA && !restrDIV && !restrBU && !restrCC) return null
  let set = ccs
  if (restrAREA) set = set.filter(c => c.area_cod && areaSel.includes(c.area_cod))
  if (restrDIV)  set = set.filter(c => c.divisao_cod && divisaoSel.includes(c.divisao_cod))
  if (restrBU)   set = set.filter(c => c.bu_cod && buSel.includes(c.bu_cod))
  let ids = set.map(c => c.id)
  if (restrCC) { const cs = new Set(ccSel); ids = ids.filter(id => cs.has(id)) }
  return ids
}

// F2: intersecciona um filtro (ou null=todos) com o escopo VER permitido da dimensão.
// Mesmo sem filtro explícito, restringe ao permitido.
export function escopoFiltro(f: string[] | null, todos: { id: string }[], dim: string, canSee: (d: string, id: string) => boolean): string[] | null {
  const permitidos = todos.filter(i => canSee(dim, i.id)).map(i => i.id)
  if (permitidos.length >= todos.length) return f   // sem restrição nessa dimensão
  if (f === null) return permitidos                 // sem filtro explícito → aplica o escopo
  return f.filter(idd => permitidos.includes(idd))  // interseção filtro × escopo
}

// Botão "Filtros" com popover Empresa/Filial/CC + Área/Divisão/BU (multi-seleção). Vazio = todas.
export function FiltrosButton({ empresas, filiais, ccs, empresaSel, setEmpresaSel, filialSel, setFilialSel, ccSel, setCcSel, areaSel, setAreaSel, divisaoSel, setDivisaoSel, buSel, setBuSel }: {
  empresas: Item[]; filiais: Item[]; ccs: CC[]
  empresaSel: string[]; setEmpresaSel: (v: string[]) => void
  filialSel: string[]; setFilialSel: (v: string[]) => void
  ccSel: string[]; setCcSel: (v: string[]) => void
  areaSel: string[]; setAreaSel: (v: string[]) => void
  divisaoSel: string[]; setDivisaoSel: (v: string[]) => void
  buSel: string[]; setBuSel: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const areas = opcoesAttr(ccs, 'area_cod', 'area_nome')
  const divisoes = opcoesAttr(ccs, 'divisao_cod', 'divisao_nome')
  const bus = opcoesAttr(ccs, 'bu_cod', 'bu_nome')
  const n = empresaSel.length + filialSel.length + ccSel.length + areaSel.length + divisaoSel.length + buSel.length
  return (
    <div style={{ position: 'relative' }}>
      <button style={btn} onClick={() => setOpen(true)}><Filter size={13} /> Filtros{n ? ` (${n})` : ''}</button>
      {open && (
        <ModalPanel titulo="Filtros" onClose={() => setOpen(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 20px' }}>
            <Checklist titulo="Empresa" items={empresas} sel={empresaSel} setSel={setEmpresaSel} />
            <Checklist titulo="Área" items={areas} sel={areaSel} setSel={setAreaSel} />
            <Checklist titulo="Divisão" items={divisoes} sel={divisaoSel} setSel={setDivisaoSel} />
            <Checklist titulo="BU" items={bus} sel={buSel} setSel={setBuSel} />
            <Checklist titulo="Filial" items={filiais} sel={filialSel} setSel={setFilialSel} />
            <Checklist titulo="Centro de custo" items={ccs} sel={ccSel} setSel={setCcSel} />
          </div>
        </ModalPanel>
      )}
    </div>
  )
}

// ── "Meus Cards": salvar o estado atual (filtros) como preset de um dashboard-base.
// Se cardId estiver presente (visualizando um card), oferece também "Atualizar card".
export function SalvarCardButton({ base, getFiltros, cor, cardId }: { base: string; getFiltros: () => any; cor?: string; cardId?: string | null }) {
  const salvarNovo = async () => {
    const nome = window.prompt('Nome do card (ex.: Análise Serviços):')?.trim()
    if (!nome) return
    const { error } = await supabase.from('dashboard_card').insert({ tenant_id: TENANT_ID, nome, base, cor: cor || 'var(--violet)', filtros: getFiltros() })
    if (error) { alert('Erro ao salvar: ' + error.message); return }
    alert('Card salvo! Veja em Dashboards › Meus cards.')
  }
  const atualizar = async () => {
    if (!cardId) return
    if (!window.confirm('Atualizar este card com os filtros atuais?')) return
    const { error } = await supabase.from('dashboard_card').update({ filtros: getFiltros() }).eq('id', cardId)
    if (error) { alert('Erro ao atualizar: ' + error.message); return }
    alert('Card atualizado.')
  }
  return (
    <>
      {cardId && <button style={{ ...btn, background: 'rgba(59,130,246,0.16)', borderColor: 'var(--blue)', color: 'var(--blue)' }} onClick={atualizar} title="Salvar os filtros atuais NESTE card"><Bookmark size={13} /> Atualizar card</button>}
      <button style={btn} onClick={salvarNovo} title="Salvar os filtros atuais como um NOVO card"><Bookmark size={13} /> {cardId ? 'Salvar como novo' : 'Salvar card'}</button>
    </>
  )
}

// Aplica um preset salvo quando a URL tem ?card=<id> e o base bate (sobrepõe o localStorage).
// Retorna o cardId ativo — o dashboard usa isso para NÃO persistir no localStorage do base
// enquanto está em modo card (evita o preset "vazar" para os filtros próprios do dashboard).
export function useCardPreset(base: string, apply: (filtros: any) => void): { cardId: string | null; nome: string } {
  const [sp] = useSearchParams()
  const cardId = sp.get('card')
  const [nome, setNome] = useState('')
  const applyRef = useRef(apply); applyRef.current = apply
  useEffect(() => {
    if (!cardId) { setNome(''); return }
    let vivo = true
    supabase.from('dashboard_card').select('base,filtros,nome').eq('id', cardId).single().then(({ data }) => {
      if (vivo && data && data.base === base) { setNome(data.nome || ''); if (data.filtros) applyRef.current(data.filtros) }
    })
    return () => { vivo = false }
  }, [cardId, base])
  return { cardId, nome }
}
