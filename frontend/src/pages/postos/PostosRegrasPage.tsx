import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useCapacidades } from '../../hooks/useCapacidades'
import { Plus, Trash2, Pencil, Save, X, AlertCircle, Download, Upload, FileDown } from 'lucide-react'

const pill = (a: boolean, off?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: off ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : off ? 'var(--border-strong)' : 'var(--text-mid)', opacity: off ? 0.7 : 1 })

// SheetJS via CDN (index.html)
declare const XLSX: any
function parseXlsx(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[])
      } catch (err) { reject(err) }
    }
    reader.readAsBinaryString(file)
  })
}
function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, filename)
}

// ── Estrutura (admin) do Posto de Trabalho — catálogos que alimentam o motor:
//    verbas/regras · cargos · sindicatos · premissas de dissídio (versão×sindicato).
//    Ref.: docs/DESIGN_posto_trabalho.md (P1, passo 2).

type Aba = 'verbas' | 'cargos' | 'sindicatos' | 'dissidio'

const TIPO_CALCULO: { value: string; label: string }[] = [
  { value: 'BASE',          label: 'Base (salário)' },
  { value: 'PCT_BASE',      label: '% sobre a base' },
  { value: 'PCT_VERBA',     label: '% sobre outra verba' },
  { value: 'PROVISAO_1_12', label: 'Provisão 1/12' },
  { value: 'VALOR_FIXO',    label: 'Valor fixo' },
  { value: 'INFORMATIVA',   label: 'Informativa (não orça)' },
]
const REGIME_OPTS: { value: string; label: string }[] = [
  { value: 'CLT',       label: 'CLT' },
  { value: 'PRESTADOR', label: 'Prestador' },
  { value: 'PROLABORE', label: 'Pró-labore' },
]
const CATEGORIA_OPTS: { value: string; label: string }[] = [
  { value: 'SALARIO', label: 'Salário' },
  { value: 'ENCARGOS', label: 'Encargos' },
  { value: 'PROVISOES', label: 'Provisões' },
  { value: 'BENEFICIOS', label: 'Benefícios' },
]
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MESES_OPTS = MESES.map((m, i) => ({ value: String(i + 1), label: m }))

const S = {
  page:     { padding: 24, fontFamily: 'system-ui, sans-serif' } as CSSProperties,
  title:    { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 } as CSSProperties,
  subtitle: { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' } as CSSProperties,
  back:     { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: 10 } as CSSProperties,
  tabs:     { display: 'flex', gap: 2, margin: '20px 0', borderBottom: '1px solid var(--border)' } as CSSProperties,
  tab:      (active: boolean): CSSProperties => ({ padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: 'none', color: active ? 'var(--violet)' : 'var(--muted)', borderBottom: active ? '2px solid var(--violet)' : '2px solid transparent', marginBottom: -1 }),
  card:     { background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' } as CSSProperties,
  toolbar:  { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--panel)' } as CSSProperties,
  table:    { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th:       { textAlign: 'left' as const, padding: '9px 14px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)' } as CSSProperties,
  td:       { padding: '7px 14px', borderBottom: '1px solid var(--panel)', color: 'var(--text)', verticalAlign: 'middle' } as CSSProperties,
  tdMono:   { padding: '7px 14px', borderBottom: '1px solid var(--panel)', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 13 } as CSSProperties,
  btnAdd:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  btnImp:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  btnDel:   { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-strong)', padding: 4, borderRadius: 4, display: 'inline-flex', alignItems: 'center' } as CSSProperties,
  input:    { padding: '5px 8px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, outline: 'none', width: '100%', boxSizing: 'border-box' as const, background: 'var(--panel)', color: 'var(--text)' } as CSSProperties,
  select:   { padding: '5px 8px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, outline: 'none', width: '100%', background: 'var(--panel)', color: 'var(--text)' } as CSSProperties,
  empty:    { padding: '40px 24px', textAlign: 'center' as const, color: 'var(--muted)', fontSize: 13 } as CSSProperties,
  erro:     { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', margin: '0 16px 12px', color: 'var(--red)', fontSize: 13 } as CSSProperties,
  hint:     { fontSize: 12, color: 'var(--muted)', padding: '10px 16px 0' } as CSSProperties,
}

// ─── Tabela CRUD genérica (catálogos simples) ────────────────
type Col = {
  key: string
  label: string
  kind?: 'text' | 'num' | 'select' | 'check' | 'regimes' | 'self_multi'
  options?: { value: string; label: string }[]
  lookup?: 'conta' | 'self' | 'self_cod'   // opções dinâmicas ('self_cod' guarda o CÓDIGO de outra linha)
  int?: boolean               // select que grava inteiro
  width?: number
  mono?: boolean
  required?: boolean
  placeholder?: string
  importHeader?: string       // nome da coluna no template/import (FK → código). default = key
  importSample?: string       // valor de exemplo na 1ª linha do modelo
}

function CrudTable({ table, orderBy, cols, defaults, lookups, hint }: {
  table: string
  orderBy: string
  cols: Col[]
  defaults: Record<string, any>
  lookups?: { conta?: any[] }
  hint?: string
}) {
  const [data, setData] = useState<any[]>([])
  const [editId, setEditId] = useState<string | null>(null)   // '__new' ao adicionar
  const [draft, setDraft] = useState<Record<string, any>>({})
  const [erro, setErro] = useState<string | null>(null)

  const load = () => supabase.from(table).select('*').order(orderBy, { nullsFirst: false }).then(r => setData(r.data || []))
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  const optsFor = (c: Col): { value: string; label: string }[] => {
    if (c.options) return c.options
    if (c.lookup === 'conta') return (lookups?.conta || []).map((x: any) => ({ value: x.id, label: `${x.codigo} — ${x.descricao}` }))
    if (c.lookup === 'self') return data.filter(d => d.id !== editId).map((d: any) => ({ value: d.id, label: `${d.codigo} — ${d.descricao}` }))
    if (c.lookup === 'self_cod') return data.filter(d => d.id !== editId).map((d: any) => ({ value: d.codigo, label: `${d.codigo} — ${d.descricao}` }))
    return []
  }
  const disp = (c: Col, row: any): ReactNode => {
    const v = row[c.key]
    if (c.kind === 'check') return v ? 'Sim' : '—'
    if (c.kind === 'select') { const o = optsFor(c).find(o => o.value === String(v)); return o ? o.label : (v ?? '—') }
    if (c.kind === 'regimes') { const s = String(v || '').split(',').map(x => x.trim()).filter(Boolean); return s.length ? s.map(r => REGIME_OPTS.find(o => o.value === r)?.label || r).join(', ') : 'Todos' }
    if (c.kind === 'self_multi') { const s = String(v || '').split(',').map(x => x.trim()).filter(Boolean); return s.length ? s.join(', ') : '—' }
    if (v === null || v === undefined || v === '') return '—'
    return String(v)
  }
  const num = (s: any): number | null => { if (s === '' || s == null) return null; const n = parseFloat(String(s).replace(',', '.')); return isNaN(n) ? null : n }
  const startAdd = () => { setErro(null); setDraft({ ...defaults }); setEditId('__new') }
  const startEdit = (row: any) => { setErro(null); setDraft({ ...row }); setEditId(row.id) }
  const save = async () => {
    for (const c of cols) if (c.required && !String(draft[c.key] ?? '').trim()) { setErro(`Preencha: ${c.label}`); return }
    const payload: Record<string, any> = {}
    for (const c of cols) {
      const v = draft[c.key]
      payload[c.key] = c.kind === 'num' ? num(v)
        : c.kind === 'check' ? !!v
        : (c.kind === 'select' && c.int) ? (v ? parseInt(String(v), 10) : null)
        : (v === '' ? null : v)
    }
    const { error } = editId === '__new'
      ? await supabase.from(table).insert({ tenant_id: TENANT_ID, ...payload })
      : await supabase.from(table).update(payload).eq('id', editId)
    if (error) { setErro(error.message); return }
    setEditId(null); load()
  }
  const del = async (id: string) => {
    if (!confirm('Excluir este registro?')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { setErro(error.message); return }
    load()
  }

  // ── Modelo / Importar / Exportar (xlsx) ──
  const fileRef = useRef<HTMLInputElement>(null)
  const impHeader = (c: Col) => c.importHeader ?? c.key
  const parseBool = (v: any) => ['1', 'true', 'sim', 's', 'x', 'yes', 'y'].includes(String(v).trim().toLowerCase())
  const selfCol = cols.find(c => c.lookup === 'self')

  const baixarModelo = () => {
    const headers = cols.map(impHeader)
    const exemplo = cols.map(c => c.importSample ?? (defaults[c.key] != null && c.kind !== 'check' ? String(defaults[c.key]) : (c.kind === 'check' ? (defaults[c.key] ? 'sim' : '') : '')))
    downloadSheet(`modelo_${table}.xlsx`, [headers, exemplo])
  }
  const exportar = () => {
    const headers = cols.map(impHeader)
    const contaCod = new Map((lookups?.conta || []).map((x: any) => [x.id, x.codigo]))
    const selfCod = new Map(data.map((x: any) => [x.id, x.codigo]))
    const rows = data.map(row => cols.map(c => {
      const v = row[c.key]
      if (c.lookup === 'conta') return v ? (contaCod.get(v) ?? '') : ''
      if (c.lookup === 'self') return v ? (selfCod.get(v) ?? '') : ''
      if (c.kind === 'check') return v ? 'sim' : ''
      return v ?? ''
    }))
    downloadSheet(`${table}.xlsx`, [headers, ...rows])
  }
  const importar = async (file: File) => {
    setErro(null)
    let rows: any[]
    try { rows = await parseXlsx(file) } catch (e: any) { setErro('Erro ao ler o arquivo: ' + (e?.message || e)); return }
    if (!rows.length) { setErro('Planilha vazia.'); return }
    const contaByCod = new Map((lookups?.conta || []).map((x: any) => [String(x.codigo).trim(), x.id]))
    const selfCodes: (string | null)[] = []
    const payloads = rows.map(row => {
      const p: Record<string, any> = { tenant_id: TENANT_ID }
      for (const c of cols) {
        const raw = row[impHeader(c)]
        const s = raw == null ? '' : String(raw).trim()
        if (c.lookup === 'conta') p[c.key] = s ? (contaByCod.get(s) ?? null) : null
        else if (c.lookup === 'self') { /* resolvido no 2º passo */ }
        else if (c.kind === 'num') p[c.key] = num(s)
        else if (c.kind === 'check') p[c.key] = s === '' ? (defaults[c.key] ?? false) : parseBool(s)
        else if (c.kind === 'select' && c.int) p[c.key] = s ? parseInt(s, 10) : null
        else p[c.key] = s || (defaults[c.key] ?? null)
      }
      if (selfCol) { const s = row[impHeader(selfCol)]; selfCodes.push(s ? String(s).trim() : null) }
      return p
    })
    const { error } = await supabase.from(table).upsert(payloads, { onConflict: 'tenant_id,codigo' })
    if (error) { setErro('Import: ' + error.message); return }
    // 2º passo: resolve verba de referência (auto-lookup) por código, agora que os registros existem
    if (selfCol && selfCodes.some(Boolean)) {
      const { data: rl } = await supabase.from(table).select('id,codigo')
      const idByCod = new Map((rl || []).map((x: any) => [String(x.codigo).trim(), x.id]))
      for (let i = 0; i < payloads.length; i++) {
        const cod = selfCodes[i]; if (!cod) continue
        const refId = idByCod.get(cod), ownId = idByCod.get(String(payloads[i].codigo).trim())
        if (refId && ownId) await supabase.from(table).update({ [selfCol.key]: refId }).eq('id', ownId)
      }
    }
    load()
  }

  const cell = (c: Col) => {
    if (c.kind === 'check') return <input type="checkbox" checked={!!draft[c.key]} onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.checked }))} />
    if (c.kind === 'select') return (
      <select style={S.select} value={draft[c.key] ?? ''} onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.value || null }))}>
        <option value="">—</option>
        {optsFor(c).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
    if (c.kind === 'regimes') {
      const selr = String(draft[c.key] || '').split(',').map(x => x.trim()).filter(Boolean)
      const toggle = (r: string) => { const set = new Set(selr); set.has(r) ? set.delete(r) : set.add(r); setDraft(d => ({ ...d, [c.key]: [...set].join(',') || null })) }
      return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{REGIME_OPTS.map(o => (
        <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: 'pointer', color: 'var(--text-mid)' }}>
          <input type="checkbox" checked={selr.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}
        </label>
      ))}</div>
    }
    if (c.kind === 'self_multi') {
      const sel = String(draft[c.key] || '').split(',').map(x => x.trim()).filter(Boolean)
      const toggle = (cod: string) => { const set = new Set(sel); set.has(cod) ? set.delete(cod) : set.add(cod); setDraft(d => ({ ...d, [c.key]: [...set].join(',') || null })) }
      return <div style={{ maxHeight: 110, overflow: 'auto', border: '1px solid var(--border-strong)', borderRadius: 6, padding: 4, minWidth: 160, background: 'var(--panel)' }}>
        {data.filter(d => d.id !== editId).map((d: any) => (
          <label key={d.id} style={{ display: 'flex', gap: 4, fontSize: 11, cursor: 'pointer', padding: '1px 2px', whiteSpace: 'nowrap', color: 'var(--text-mid)' }}>
            <input type="checkbox" checked={sel.includes(d.codigo)} onChange={() => toggle(d.codigo)} />
            <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{d.codigo}</span> {String(d.descricao || '').slice(0, 22)}
          </label>
        ))}
      </div>
    }
    return <input style={S.input} value={draft[c.key] ?? ''} placeholder={c.placeholder} onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.value }))} />
  }
  const acoes = (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button style={{ ...S.btnDel, color: 'var(--green)' }} onClick={save} title="Salvar"><Save size={16} /></button>
      <button style={S.btnDel} onClick={() => { setEditId(null); setErro(null) }} title="Cancelar"><X size={16} /></button>
    </span>
  )

  return (
    <div style={S.card}>
      <div style={S.toolbar}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{data.length} {data.length === 1 ? 'registro' : 'registros'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnImp} onClick={baixarModelo} title="Baixar planilha modelo (com cabeçalhos e 1 exemplo)"><FileDown size={14} /> Modelo</button>
          <button style={S.btnImp} onClick={() => fileRef.current?.click()} title="Importar de xlsx (upsert por código)"><Upload size={14} /> Importar</button>
          <button style={S.btnImp} onClick={exportar} title="Exportar os registros atuais"><Download size={14} /> Exportar</button>
          <button style={S.btnAdd} onClick={startAdd}><Plus size={14} /> Novo</button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = '' }} />
      </div>
      {hint && <div style={S.hint}>{hint}</div>}
      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      <div style={{ overflowX: 'auto' }}>
      <table style={S.table}>
        <thead><tr>{cols.map(c => <th key={c.key} style={{ ...S.th, width: c.width }}>{c.label}</th>)}<th style={{ ...S.th, width: 80 }} /></tr></thead>
        <tbody>
          {editId === '__new' && <tr>{cols.map(c => <td key={c.key} style={S.td}>{cell(c)}</td>)}<td style={S.td}>{acoes}</td></tr>}
          {data.map(row => editId === row.id ? (
            <tr key={row.id}>{cols.map(c => <td key={c.key} style={S.td}>{cell(c)}</td>)}<td style={S.td}>{acoes}</td></tr>
          ) : (
            <tr key={row.id}>
              {cols.map(c => <td key={c.key} style={c.mono ? S.tdMono : S.td}>{disp(c, row)}</td>)}
              <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                <button style={S.btnDel} onClick={() => startEdit(row)} title="Editar"><Pencil size={15} /></button>
                <button style={S.btnDel} onClick={() => del(row.id)} title="Excluir"><Trash2 size={15} /></button>
              </td>
            </tr>
          ))}
          {!data.length && editId !== '__new' && <tr><td colSpan={cols.length + 1} style={S.empty}>Nenhum registro ainda.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// ─── Verbas / regras ─────────────────────────────────────────
function VerbasTab() {
  const [contas, setContas] = useState<any[]>([])
  useEffect(() => { supabase.from('conta_orcamentaria').select('id,codigo,descricao').order('codigo').then(r => setContas(r.data || [])) }, [])
  return <CrudTable table="verba_folha" orderBy="ordem" lookups={{ conta: contas }}
    hint="Regra de cálculo de cada rubrica. A ordem importa (encargos calculam sobre verbas anteriores). A conta destino recebe o valor no Aplicar."
    defaults={{ tipo_calculo: 'BASE', incide_encargos: true, ativo: true }}
    cols={[
      { key: 'ordem',            label: 'Ordem',            kind: 'num',   width: 70,  importSample: '10' },
      { key: 'codigo',           label: 'Código',           kind: 'text',  required: true, width: 110, mono: true, importSample: 'SAL' },
      { key: 'descricao',        label: 'Descrição',        kind: 'text',  required: true, importSample: 'Salário base' },
      { key: 'tipo_calculo',     label: 'Tipo de cálculo',  kind: 'select', options: TIPO_CALCULO, width: 160, importSample: 'BASE' },
      { key: 'parametro',        label: '% / fator / valor', kind: 'num',  width: 120, importSample: '' },
      { key: 'verba_ref',        label: 'Verbas ref. (base do %)', kind: 'self_multi', width: 200, importHeader: 'verba_ref', importSample: '' },
      { key: 'conta_destino_id', label: 'Conta destino',    kind: 'select', lookup: 'conta', width: 220, importHeader: 'conta_destino', importSample: '' },
      { key: 'incide_encargos',  label: 'Base p/ encargos', kind: 'check', width: 100, importSample: 'sim' },
      { key: 'categoria',        label: 'Categoria',        kind: 'select', options: CATEGORIA_OPTS, width: 130, importSample: '' },
      { key: 'regime',           label: 'Regime(s)',        kind: 'regimes', width: 210, importSample: 'CLT,PROLABORE' },
      { key: 'aglutina_em',      label: 'Aglutina em',      kind: 'select', lookup: 'self_cod', width: 150, importSample: '' },
      { key: 'ativo',            label: 'Ativo',            kind: 'check', width: 60, importSample: 'sim' },
    ]} />
}

// ─── Cargos ──────────────────────────────────────────────────
function CargosTab() {
  return <CrudTable table="cargo" orderBy="codigo"
    defaults={{ ativo: true }}
    cols={[
      { key: 'codigo',      label: 'Código',       kind: 'text', required: true, width: 130, mono: true },
      { key: 'nome',        label: 'Nome',         kind: 'text', required: true },
      { key: 'salario_ref', label: 'Salário ref.', kind: 'num',  width: 150 },
      { key: 'ativo',       label: 'Ativo',        kind: 'check', width: 60 },
    ]} />
}

// ─── Sindicatos ──────────────────────────────────────────────
function SindicatosTab() {
  return <CrudTable table="sindicato" orderBy="codigo"
    hint="Mês-base = a partir de qual mês o dissídio da versão é aplicado ao salário."
    defaults={{ mes_database: 1, ativo: true }}
    cols={[
      { key: 'codigo',       label: 'Código',   kind: 'text', required: true, width: 130, mono: true },
      { key: 'nome',         label: 'Nome',     kind: 'text', required: true },
      { key: 'mes_database', label: 'Mês-base', kind: 'select', options: MESES_OPTS, int: true, width: 120 },
      { key: 'ativo',        label: 'Ativo',    kind: 'check', width: 60 },
    ]} />
}

// ─── Dissídio (matriz versão × sindicato) ────────────────────
function DissidioTab() {
  const [versoes, setVersoes] = useState<any[]>([])
  const [sinds, setSinds] = useState<any[]>([])
  const [versaoId, setVersaoId] = useState('')
  const [pcts, setPcts] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('versao_orcamento').select('id,codigo').order('codigo').then(r => setVersoes(r.data || []))
    supabase.from('sindicato').select('id,codigo,nome,mes_database').eq('ativo', true).order('codigo').then(r => setSinds(r.data || []))
  }, [])
  useEffect(() => {
    if (!versaoId) { setPcts({}); return }
    supabase.from('premissa_dissidio').select('sindicato_id,pct').eq('versao_id', versaoId).then(r => {
      const m: Record<string, string> = {}; for (const row of r.data || []) m[row.sindicato_id] = String(row.pct)
      setPcts(m)
    })
  }, [versaoId])

  const salvar = async (sindId: string, raw: string) => {
    if (!versaoId) return
    const pct = raw.trim() === '' ? 0 : parseFloat(raw.replace(',', '.'))
    if (isNaN(pct)) { setErro('Percentual inválido'); return }
    setErro(null)
    const { error } = await supabase.from('premissa_dissidio')
      .upsert({ tenant_id: TENANT_ID, versao_id: versaoId, sindicato_id: sindId, pct }, { onConflict: 'versao_id,sindicato_id' })
    if (error) setErro(error.message)
  }

  return (
    <div style={S.card}>
      <div style={S.toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>Versão / cenário</span>
          <select style={{ ...S.select, width: 220 }} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
            <option value="">— selecione —</option>
            {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
          </select>
        </div>
      </div>
      <div style={S.hint}>Reajuste (%) por sindicato nesta versão. Aplica-se ao salário a partir do mês-base do sindicato.</div>
      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {!versaoId ? (
        <div style={S.empty}>Selecione uma versão para editar os dissídios.</div>
      ) : !sinds.length ? (
        <div style={S.empty}>Cadastre sindicatos primeiro (aba Sindicatos).</div>
      ) : (
        <table style={S.table}>
          <thead><tr><th style={S.th}>Sindicato</th><th style={S.th}>Mês-base</th><th style={{ ...S.th, width: 160 }}>Dissídio %</th></tr></thead>
          <tbody>
            {sinds.map(s => (
              <tr key={s.id}>
                <td style={S.td}><span style={{ fontFamily: 'monospace', color: 'var(--muted)', marginRight: 8 }}>{s.codigo}</span>{s.nome}</td>
                <td style={S.td}>{MESES[(s.mes_database || 1) - 1]}</td>
                <td style={S.td}>
                  <input style={{ ...S.input, textAlign: 'right', width: 120 }} defaultValue={pcts[s.id] ?? ''} placeholder="0"
                    key={versaoId + s.id} onBlur={e => salvar(s.id, e.target.value)} /> <span style={{ color: 'var(--muted)' }}>%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function PostosRegrasPage() {
  const [aba, setAba] = useState<Aba>('verbas')
  const cap = useCapacidades()

  if (!cap.loading && !cap.can('estrutura')) {
    return <div style={S.page}><h1 style={S.title}>Estrutura de Postos</h1><p style={S.subtitle}>Você não tem permissão para editar a estrutura (capacidade «estrutura»).</p></div>
  }

  const TABS: { id: Aba; label: string }[] = [
    { id: 'verbas',     label: 'Verbas / regras' },
    { id: 'cargos',     label: 'Cargos' },
    { id: 'sindicatos', label: 'Sindicatos' },
    { id: 'dissidio',   label: 'Dissídio' },
  ]

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={S.title}>Estrutura de Postos <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>· regras de cálculo da folha</span></h1>
          <p style={S.subtitle}>Catálogos que o motor usa ao orçar por posto: rubricas (verbas), cargos, sindicatos e o dissídio por versão.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link to="/postos" style={pill(false)}>1 · Postos</Link>
          <span style={pill(true)}>2 · Estrutura</span>
          <Link to="/postos/memoria" style={pill(false)}>3 · Memória de cálculo</Link>
          <Link to="/postos/rateio" style={pill(false)}>4 · Rateio</Link>
          <Link to="/postos/folha" style={pill(false)}>5 · Folha</Link>
          <Link to="/postos/conciliacao" style={pill(false)}>6 · Conciliação</Link>
        </div>
      </div>

      <div style={S.tabs}>
        {TABS.map(t => <button key={t.id} style={S.tab(aba === t.id)} onClick={() => setAba(t.id)}>{t.label}</button>)}
      </div>

      {aba === 'verbas'     && <VerbasTab />}
      {aba === 'cargos'     && <CargosTab />}
      {aba === 'sindicatos' && <SindicatosTab />}
      {aba === 'dissidio'   && <DissidioTab />}
    </div>
  )
}
