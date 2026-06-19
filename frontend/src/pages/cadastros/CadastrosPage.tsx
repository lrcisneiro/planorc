import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'

// SheetJS carregado via CDN no index.html
declare const XLSX: any
import { Plus, Trash2, Check, X, Upload, AlertCircle, Download, FileDown, Pencil, Copy, Link2, ChevronRight, ChevronDown, ChevronsUpDown } from 'lucide-react'

type Aba = 'empresas' | 'filiais' | 'cc' | 'planos' | 'contas' | 'estrutura' | 'funcionarios' | 'verbas' | 'versoes'

// ─── Styles ──────────────────────────────────────────────────
const S = {
  page:     { padding: 24, fontFamily: 'system-ui, sans-serif' } as CSSProperties,
  header:   { marginBottom: 20 } as CSSProperties,
  title:    { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as CSSProperties,
  subtitle: { fontSize: 13, color: '#868e96', margin: '4px 0 0' } as CSSProperties,
  tabs:     { display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid #e9ecef' } as CSSProperties,
  tab:      (active: boolean): CSSProperties => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
    background: 'none', color: active ? '#3b5bdb' : '#868e96',
    borderBottom: active ? '2px solid #3b5bdb' : '2px solid transparent',
    marginBottom: -1, transition: 'all 0.15s',
  }),
  card:     { background: 'white', borderRadius: 10, border: '1px solid #e9ecef', overflow: 'hidden' } as CSSProperties,
  toolbar:  { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', padding: '10px 16px', borderBottom: '1px solid #f1f3f5' } as CSSProperties,
  table:    { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th:       { textAlign: 'left' as const, padding: '9px 14px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td:       { padding: '9px 14px', borderBottom: '1px solid #f1f3f5', color: '#343a40' },
  tdMono:   { padding: '9px 14px', borderBottom: '1px solid #f1f3f5', color: '#868e96', fontFamily: 'monospace', fontSize: 13 },
  badge:    (ativo: boolean): CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 500,
    background: ativo ? '#ebfbee' : '#fff5f5', color: ativo ? '#2f9e44' : '#c92a2a',
  }),
  btnAdd:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: '#3b5bdb', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  btnImp:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  treeBtn:  { display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', fontSize: 12, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  btnDel:   { background: 'none', border: 'none', cursor: 'pointer', color: '#dee2e6', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' } as CSSProperties,
  input:    { padding: '5px 8px', fontSize: 13, border: '1px solid #ced4da', borderRadius: 6, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  search:   { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, outline: 'none', width: 240, boxSizing: 'border-box' as const },
  select:   { padding: '5px 8px', fontSize: 13, border: '1px solid #ced4da', borderRadius: 6, outline: 'none', width: '100%', background: 'white' },
  empty:    { padding: '40px 24px', textAlign: 'center' as const, color: '#aaa', fontSize: 13 },
  erro:     { display: 'flex', alignItems: 'center', gap: 8, background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', margin: '0 16px 12px', color: '#c92a2a', fontSize: 13 } as CSSProperties,
  info:     { display: 'flex', alignItems: 'center', gap: 8, background: '#e7f5ff', border: '1px solid #a5d8ff', borderRadius: 8, padding: '10px 14px', margin: '0 16px 12px', color: '#1971c2', fontSize: 13 } as CSSProperties,
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as CSSProperties,
  modal:    { background: 'white', borderRadius: 14, padding: 24, width: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' } as CSSProperties,
  mTitle:   { fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#212529' } as CSSProperties,
  field:    { marginBottom: 14 } as CSSProperties,
  label:    { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 6 } as CSSProperties,
  mFooter:  { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 } as CSSProperties,
}

// ─── Helpers ─────────────────────────────────────────────────
function col(row: any, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (val !== undefined && val !== null && val !== '') return String(val).trim()
  }
  return ''
}

// Remove duplicatas pela chave (mantém a última ocorrência) — evita o erro
// "ON CONFLICT DO UPDATE command cannot affect row a second time" no upsert.
function dedupe<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of arr) map.set(keyFn(item), item)
  return Array.from(map.values())
}

// Carrega TODAS as linhas (passa do limite de 1000 do PostgREST)
async function fetchAll(build: () => any): Promise<any[]> {
  const out: any[] = []; const size = 1000; let from = 0
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error || !data || !data.length) break
    out.push(...data); if (data.length < size) break; from += size
  }
  return out
}

// Filtro de busca por texto livre (nas colunas exibidas)
function filtraBusca<T>(data: T[], q: string, texto: (r: T) => string): T[] {
  const s = q.trim().toLowerCase()
  if (!s) return data
  const termos = s.split(/\s+/)
  return data.filter(r => { const t = texto(r).toLowerCase(); return termos.every(x => t.includes(x)) })
}

// Monta árvore (pai_id) ordenada por código → lista achatada com profundidade
function buildArvore(rows: any[]): { node: any; depth: number }[] {
  const byPai: Record<string, any[]> = {}
  for (const r of rows) { const p = r.pai_id ?? '__root'; (byPai[p] ||= []).push(r) }
  const cmp = (a: any, b: any) => String(a.codigo).localeCompare(String(b.codigo), undefined, { numeric: true })
  Object.values(byPai).forEach(arr => arr.sort(cmp))
  const out: { node: any; depth: number }[] = []; const seen = new Set<string>()
  const walk = (pid: string, depth: number) => {
    for (const n of byPai[pid] || []) { if (seen.has(n.id)) continue; seen.add(n.id); out.push({ node: n, depth }); walk(n.id, depth + 1) }
  }
  walk('__root', 0)
  for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push({ node: r, depth: 0 }) }  // órfãos
  return out
}

// Pai (conta/CC superior) pelo prefixo do código.
// Códigos com ponto: remove o último segmento ('1.1.01' -> '1.1' -> '1').
// Códigos contíguos: maior prefixo existente ('10101' -> '101' -> '1').
function findParentCode(codigo: string, codeSet: Set<string>): string | null {
  if (codigo.includes('.')) {
    const parts = codigo.split('.')
    while (parts.length > 1) {
      parts.pop()
      const cand = parts.join('.')
      if (codeSet.has(cand)) return cand
    }
    return null
  }
  for (let len = codigo.length - 1; len >= 1; len--) {
    const cand = codigo.slice(0, len)
    if (codeSet.has(cand)) return cand
  }
  return null
}

// Calcula, para um conjunto de códigos, o pai de cada um e quais são "pais"
// (ou seja, sintéticos por terem filhos).
function calcularHierarquia(allCodes: string[]) {
  const codeSet = new Set(allCodes)
  const parentOf: Record<string, string | null> = {}
  for (const c of allCodes) parentOf[c] = findParentCode(c, codeSet)
  const ehPai = new Set<string>()
  for (const c of allCodes) { const p = parentOf[c]; if (p) ehPai.add(p) }
  return { parentOf, ehPai }
}

// Resolve o tipo: coluna explícita > CLASSE TOTVS (1=sint., 2=anal.) > tem filhos.
function resolverTipo(explicito: string, classe: string, codigo: string, ehPai: Set<string>): 'SINTETICA' | 'ANALITICA' {
  const ex = explicito.trim().toUpperCase()
  if (ex.startsWith('SINT')) return 'SINTETICA'
  if (ex.startsWith('ANAL')) return 'ANALITICA'
  if (classe.trim() === '1') return 'SINTETICA'
  if (classe.trim() === '2') return 'ANALITICA'
  return ehPai.has(codigo) ? 'SINTETICA' : 'ANALITICA'
}

function parseAtivo(s: string): boolean {
  const v = s.trim().toUpperCase()
  if (!v) return true
  return !['NAO', 'NÃO', 'N', 'FALSE', '0', 'INATIVO'].includes(v)
}

function parseXlsx(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows as any[])
      } catch (err) { reject(err) }
    }
    reader.readAsBinaryString(file)
  })
}

// ─── Export / Modelo helpers ─────────────────────────────────
function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, filename)
}

function baixarModelo(nome: string, headers: string[], exemplo: (string | number)[]) {
  downloadSheet(`modelo_${nome}.xlsx`, [headers, exemplo])
}

function exportarDados(nome: string, headers: string[], rows: (string | number)[][]) {
  downloadSheet(`${nome}.xlsx`, [headers, ...rows])
}

// ─── AddRow inline ───────────────────────────────────────────
function AddRow({ cols, initial, onSave, onCancel }: {
  cols: { key: string; placeholder: string; type?: 'text' | 'select'; options?: { value: string; label: string }[] }[]
  initial?: Record<string, string>
  onSave: (vals: Record<string, string>) => void
  onCancel: () => void
}) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(cols.map(c => [c.key, initial?.[c.key] ?? '']))
  )
  const set = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }))

  return (
    <tr style={{ background: '#f0f4ff' }}>
      {cols.map(c => (
        <td key={c.key} style={S.td}>
          {c.type === 'select' ? (
            <select style={S.select} value={vals[c.key]} onChange={e => set(c.key, e.target.value)}>
              <option value="">— selecione —</option>
              {(c.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              style={S.input}
              placeholder={c.placeholder}
              value={vals[c.key]}
              onChange={e => set(c.key, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSave(vals); if (e.key === 'Escape') onCancel() }}
            />
          )}
        </td>
      ))}
      <td style={{ ...S.td, whiteSpace: 'nowrap' as const }}>
        <button style={{ ...S.btnDel, color: '#2f9e44' }} onClick={() => onSave(vals)}><Check size={15} /></button>
        <button style={S.btnDel} onClick={onCancel}><X size={15} /></button>
      </td>
    </tr>
  )
}

// ─── Toolbar (busca + modelo + import + export + add) ─────────
function Toolbar({ modelo, onImport, onExport, onAdd, busca, onBusca, total, mostrando }: {
  modelo?: () => void
  onImport?: (f: File) => void
  onExport?: () => void
  onAdd: () => void
  busca?: string
  onBusca?: (v: string) => void
  total?: number
  mostrando?: number
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div style={S.toolbar}>
      {onBusca && (
        <>
          <input style={S.search} placeholder="🔎 Buscar..." value={busca || ''} onChange={e => onBusca(e.target.value)} />
          {busca ? <span style={{ fontSize: 12, color: '#868e96', whiteSpace: 'nowrap' }}>{mostrando} de {total}</span>
            : (total != null ? <span style={{ fontSize: 12, color: '#adb5bd', whiteSpace: 'nowrap' }}>{total} registro{total !== 1 ? 's' : ''}</span> : null)}
          <div style={{ flex: 1 }} />
        </>
      )}
      {onExport && (
        <button style={S.btnImp} onClick={onExport} title="Exportar dados cadastrados">
          <FileDown size={13} /> Exportar
        </button>
      )}
      {modelo && (
        <button style={S.btnImp} onClick={modelo} title="Baixar planilha modelo para preencher">
          <Download size={13} /> Baixar modelo
        </button>
      )}
      {onImport && (
        <>
          <button style={S.btnImp} onClick={() => ref.current?.click()}>
            <Upload size={13} /> Importar Excel
          </button>
          <input
            ref={ref}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0]
              if (f) { onImport(f); e.target.value = '' }
            }}
          />
        </>
      )}
      <button style={S.btnAdd} onClick={onAdd}><Plus size={14} /> Adicionar</button>
    </div>
  )
}

// ─── EmpresasTab ─────────────────────────────────────────────
function EmpresasTab() {
  const [data, setData] = useState<any[]>([])
  const [planos, setPlanos] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const HEADERS = ['codigo', 'descricao', 'plano_codigo', 'ativo']
  const EXEMPLO = ['01', 'Empresa Matriz', 'TOTVS', 'SIM']
  const COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'plano_id', placeholder: 'Plano de contas (ERP)', type: 'select' as const, options: planos.map(p => ({ value: p.id, label: `${p.codigo} · ${p.nome}` })) },
  ]
  const planoCod = (id: string) => planos.find(p => p.id === id)?.codigo || ''

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('empresa').select('*').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => {
    load()
    fetchAll(() => supabase.from('plano_contas').select('id,codigo,nome').order('codigo')).then(setPlanos)
  }, [])
  const filtered = filtraBusca(data, busca, e => `${e.codigo} ${e.descricao} ${planoCod(e.plano_id)} ${e.ativo ? 'ativo' : 'inativo'}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), plano_id: v.plano_id || null }
    const { error } = id
      ? await supabase.from('empresa').update(payload).eq('id', id)
      : await supabase.from('empresa').insert({ tenant_id: TENANT_ID, ...payload, ativo: true })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir empresa?')) return
    const { error } = await supabase.from('empresa').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }
      const planoByCod: Record<string, string> = {}; planos.forEach(p => { planoByCod[String(p.codigo).toUpperCase()] = p.id })
      const registros = rows
        .map(r => ({
          tenant_id: TENANT_ID,
          codigo:    col(r, 'codigo', 'Código', 'CODIGO'),
          descricao: col(r, 'descricao', 'Descrição', 'DESCRICAO'),
          plano_id:  planoByCod[col(r, 'plano_codigo', 'plano', 'PLANO').toUpperCase()] || null,
          ativo:     parseAtivo(col(r, 'ativo', 'Ativo', 'ATIVO')),
        }))
        .filter(r => r.codigo && r.descricao)
      const unicos = dedupe(registros, r => r.codigo)
      const { error } = await supabase.from('empresa').upsert(unicos, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (error) { setErro(error.message); setInfo(null); return }
      setInfo(`${unicos.length} empresas importadas.`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('empresas', HEADERS, data.map(e => [e.codigo, e.descricao, planoCod(e.plano_id), e.ativo ? 'SIM' : 'NAO']))

  return (
    <div style={S.card}>
      <Toolbar
        modelo={() => baixarModelo('empresas', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Plano (ERP)</th><th style={S.th}>Status</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={5} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhuma empresa cadastrada.<br /><small>Use "Baixar modelo" e depois "Importar Excel".</small></>}</td></tr>}
          {filtered.map(e => editId === e.id ? (
            <AddRow key={e.id} cols={COLS} initial={{ codigo: e.codigo, descricao: e.descricao, plano_id: e.plano_id || '' }} onSave={v => save(v, e.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={e.id}>
              <td style={S.tdMono}>{e.codigo}</td>
              <td style={S.td}>{e.descricao}</td>
              <td style={{ ...S.td, color: '#868e96' }}>{planoCod(e.plano_id) || '—'}</td>
              <td style={S.td}><span style={S.badge(e.ativo)}>{e.ativo ? 'Ativo' : 'Inativo'}</span></td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(e.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(e.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── FiliaisTab ───────────────────────────────────────────────
function FiliaisTab() {
  const [data, setData] = useState<any[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const HEADERS = ['codigo', 'descricao', 'empresa_codigo']
  const EXEMPLO = ['0101', 'Filial São Paulo', '01']
  const COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'empresa_id', placeholder: 'Empresa', type: 'select' as const, options: empresas.map(e => ({ value: e.id, label: `${e.codigo} · ${e.descricao}` })) },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('filial').select('*, empresa(codigo,descricao)').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => {
    load()
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
  }, [])
  const filtered = filtraBusca(data, busca, f => `${f.codigo} ${f.descricao} ${f.empresa?.codigo || ''} ${f.empresa?.descricao || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao || !v.empresa_id) { setErro('Todos os campos são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), empresa_id: v.empresa_id }
    const { error } = id
      ? await supabase.from('filial').update(payload).eq('id', id)
      : await supabase.from('filial').insert({ tenant_id: TENANT_ID, ...payload, ativo: true })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir filial?')) return
    const { error } = await supabase.from('filial').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }
      const empMap: Record<string, string> = {}
      empresas.forEach(e => { empMap[e.codigo] = e.id })
      const registros = rows
        .map(r => ({
          tenant_id:  TENANT_ID,
          codigo:     col(r, 'codigo', 'Código', 'CODIGO'),
          descricao:  col(r, 'descricao', 'Descrição', 'DESCRICAO'),
          empresa_id: empMap[col(r, 'empresa_codigo', 'empresa', 'EMPRESA')] || null,
          ativo:      parseAtivo(col(r, 'ativo', 'Ativo', 'ATIVO')),
        }))
        .filter(r => r.codigo && r.descricao && r.empresa_id)
      if (!registros.length) { setErro('Nenhuma filial válida. Confira se o "empresa_codigo" existe no cadastro de Empresas.'); setInfo(null); return }
      const unicos = dedupe(registros, r => r.codigo)
      const { error } = await supabase.from('filial').upsert(unicos, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (error) { setErro(error.message); setInfo(null); return }
      setInfo(`${unicos.length} filiais importadas.`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('filiais', HEADERS, data.map(f => [f.codigo, f.descricao, f.empresa?.codigo || '']))

  return (
    <div style={S.card}>
      <Toolbar
        modelo={() => baixarModelo('filiais', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Empresa</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={4} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhuma filial cadastrada.<br /><small>Use "Baixar modelo" e depois "Importar Excel".</small></>}</td></tr>}
          {filtered.map(f => editId === f.id ? (
            <AddRow key={f.id} cols={COLS} initial={{ codigo: f.codigo, descricao: f.descricao, empresa_id: f.empresa_id || '' }} onSave={v => save(v, f.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={f.id}>
              <td style={S.tdMono}>{f.codigo}</td>
              <td style={S.td}>{f.descricao}</td>
              <td style={S.td}>{f.empresa?.descricao}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(f.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(f.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── CentroCustoTab ───────────────────────────────────────────
function CentroCustoTab() {
  const [data, setData] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const HEADERS = ['codigo', 'descricao', 'tipo', 'area', 'pai_codigo']
  const EXEMPLO = ['1101', 'Comercial', 'ANALITICA', 'COMERCIAL', '11']

  const codeById: Record<string, string> = Object.fromEntries(data.map(c => [c.id, c.codigo]))
  const CC_COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'tipo', placeholder: 'Tipo', type: 'select' as const, options: [{ value: 'ANALITICA', label: 'Analítica' }, { value: 'SINTETICA', label: 'Sintética' }] },
    { key: 'pai_id', placeholder: 'Pai', type: 'select' as const, options: data.map(c => ({ value: c.id, label: `${c.codigo} · ${c.descricao}` })) },
    { key: 'area', placeholder: 'Área (opcional)' },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('centro_custo').select('*').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [])
  const filtered = filtraBusca(data, busca, c => `${c.codigo} ${c.descricao} ${c.tipo || ''} ${c.area || ''} ${codeById[c.pai_id] || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), tipo: v.tipo || 'ANALITICA', pai_id: v.pai_id || null, area: v.area?.trim() || null }
    const { error } = id
      ? await supabase.from('centro_custo').update(payload).eq('id', id)
      : await supabase.from('centro_custo').insert({ tenant_id: TENANT_ID, ...payload, ativo: true })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir centro de custo?')) return
    const { error } = await supabase.from('centro_custo').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }

      // Detecta TOTVS (CTT_CUSTO) ou genérico (codigo/descricao)
      const sample = rows[0]
      const isTotvs = 'CTT_CUSTO' in sample || 'ctt_custo' in sample

      const base = rows
        .map(r => ({
          codigo:    isTotvs ? col(r, 'CTT_CUSTO', 'R_E_C_N_O_') : col(r, 'codigo', 'Código', 'CODIGO'),
          descricao: isTotvs ? col(r, 'CTT_DESC01', 'CTT_DESC') : col(r, 'descricao', 'Descrição', 'DESCRICAO'),
          area:      (isTotvs ? col(r, 'CTT_AREA01', 'CTT_AREA') : col(r, 'area', 'Area', 'ÁREA')) || null,
          classe:    isTotvs ? col(r, 'CTT_CLASSE') : '',
          tipoExpl:  col(r, 'tipo', 'Tipo', 'TIPO'),
          paiExpl:   col(r, 'pai_codigo', 'pai', 'PAI'),
        }))
        .filter(r => r.codigo && r.descricao)
      const unicos = dedupe(base, r => r.codigo)

      // Fase 1: garante que todos os códigos existem (sem pai/tipo ainda)
      const fase1 = unicos.map(r => ({ tenant_id: TENANT_ID, codigo: r.codigo, descricao: r.descricao, area: r.area, ativo: true }))
      const { error: e1 } = await supabase.from('centro_custo').upsert(fase1, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (e1) { setErro(e1.message); setInfo(null); return }

      // Fase 2: resolve pai (prefixo do código) e tipo (CLASSE / tem filhos)
      const { data: all } = await supabase.from('centro_custo').select('id,codigo')
      const codeToId: Record<string, string> = {}
      ;(all || []).forEach((c: any) => { codeToId[c.codigo] = c.id })
      const { parentOf, ehPai } = calcularHierarquia((all || []).map((c: any) => c.codigo))

      const fase2 = unicos.map(r => {
        const paiCod = r.paiExpl || parentOf[r.codigo]
        return {
          tenant_id: TENANT_ID, codigo: r.codigo, descricao: r.descricao, area: r.area, ativo: true,
          tipo: resolverTipo(r.tipoExpl, r.classe, r.codigo, ehPai),
          pai_id: paiCod ? (codeToId[paiCod] || null) : null,
        }
      })
      const { error: e2 } = await supabase.from('centro_custo').upsert(fase2, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (e2) { setErro(e2.message); setInfo(null); return }

      setInfo(`${unicos.length} centros de custo importados (hierarquia e tipo resolvidos).`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('centros_custo', HEADERS,
    data.map(c => [c.codigo, c.descricao, c.tipo || 'ANALITICA', c.area || '', codeById[c.pai_id] || '']))

  return (
    <div style={S.card}>
      <Toolbar
        modelo={() => baixarModelo('centros_custo', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Tipo</th><th style={S.th}>Pai</th><th style={S.th}>Área</th><th style={S.th}>Status</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={CC_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={7} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhum centro de custo cadastrado.<br /><small>Use "Importar Excel" (TOTVS ou modelo).</small></>}</td></tr>}
          {filtered.map(c => {
            const isSint = c.tipo === 'SINTETICA'
            return editId === c.id ? (
              <AddRow key={c.id} cols={CC_COLS} initial={{ codigo: c.codigo, descricao: c.descricao, tipo: c.tipo || 'ANALITICA', pai_id: c.pai_id || '', area: c.area || '' }} onSave={v => save(v, c.id)} onCancel={() => setEditId(null)} />
            ) : (
              <tr key={c.id}>
                <td style={{ ...S.tdMono, fontWeight: isSint ? 700 : 400, color: isSint ? '#212529' : '#868e96' }}>{c.codigo}</td>
                <td style={{ ...S.td, fontWeight: isSint ? 600 : 400 }}>{c.descricao}</td>
                <td style={{ ...S.td, color: isSint ? '#1971c2' : '#2f9e44', fontSize: 12, fontWeight: 500 }}>{c.tipo || 'ANALITICA'}</td>
                <td style={{ ...S.tdMono }}>{codeById[c.pai_id] || '—'}</td>
                <td style={{ ...S.td, color: '#868e96' }}>{c.area || '—'}</td>
                <td style={S.td}><span style={S.badge(c.ativo)}>{c.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                  <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(c.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                  <button style={S.btnDel} title="Excluir" onClick={() => del(c.id)}><Trash2 size={14} /></button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── ContasTab ────────────────────────────────────────────────
function ContasTab() {
  const [data, setData] = useState<any[]>([])
  const [planos, setPlanos] = useState<any[]>([])
  const [planoId, setPlanoId] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const HEADERS = ['codigo', 'descricao', 'tipo', 'pai_codigo']
  const EXEMPLO = ['1.1.01', 'Caixa Geral', 'ANALITICA', '1.1']

  const codeById: Record<string, string> = Object.fromEntries(data.map(c => [c.id, c.codigo]))
  const CT_COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'tipo', placeholder: 'Tipo', type: 'select' as const, options: [{ value: 'ANALITICA', label: 'Analítica' }, { value: 'SINTETICA', label: 'Sintética' }] },
    { key: 'pai_id', placeholder: 'Pai', type: 'select' as const, options: data.map(c => ({ value: c.id, label: `${c.codigo} · ${c.descricao}` })) },
  ]

  useEffect(() => {
    fetchAll(() => supabase.from('plano_contas').select('id,codigo,nome').order('codigo'))
      .then(ps => { setPlanos(ps); setPlanoId(prev => prev || ps[0]?.id || '') })
  }, [])
  const load = async () => {
    if (!planoId) { setData([]); return }
    try { setData(await fetchAll(() => supabase.from('conta_contabil').select('*').eq('plano_id', planoId).order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [planoId]) // eslint-disable-line
  const filtered = filtraBusca(data, busca, c => `${c.codigo} ${c.descricao} ${c.tipo || ''} ${codeById[c.pai_id] || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    if (!planoId) { setErro('Selecione um plano de contas.'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), tipo: v.tipo || 'ANALITICA', pai_id: v.pai_id || null }
    const { error } = id
      ? await supabase.from('conta_contabil').update(payload).eq('id', id)
      : await supabase.from('conta_contabil').insert({ tenant_id: TENANT_ID, plano_id: planoId, ...payload, ativo: true })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir conta?')) return
    const { error } = await supabase.from('conta_contabil').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  const importar = async (file: File) => {
    if (!planoId) { setErro('Selecione (ou crie) um plano de contas antes de importar.'); return }
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }

      const sample = rows[0]
      const isTotvs = 'CT1_CONTA' in sample || 'ct1_conta' in sample

      const base = rows
        .map(r => ({
          codigo:    isTotvs ? col(r, 'CT1_CONTA') : col(r, 'codigo', 'Código', 'CODIGO'),
          descricao: isTotvs ? col(r, 'CT1_DESC01', 'CT1_DESC') : col(r, 'descricao', 'Descrição', 'DESCRICAO'),
          classe:    isTotvs ? col(r, 'CT1_CLASSE') : '',
          tipoExpl:  col(r, 'tipo', 'Tipo', 'TIPO'),
          paiExpl:   col(r, 'pai_codigo', 'pai', 'PAI'),
        }))
        .filter(r => r.codigo && r.descricao)
      const unicos = dedupe(base, r => r.codigo)

      // Fase 1: garante que todos os códigos existem (NESTE plano)
      const fase1 = unicos.map(r => ({ tenant_id: TENANT_ID, plano_id: planoId, codigo: r.codigo, descricao: r.descricao, ativo: true }))
      const { error: e1 } = await supabase.from('conta_contabil').upsert(fase1, { onConflict: 'tenant_id,plano_id,codigo', ignoreDuplicates: false })
      if (e1) { setErro(e1.message); setInfo(null); return }

      // Fase 2: resolve pai e tipo (dentro do plano)
      const all = await fetchAll(() => supabase.from('conta_contabil').select('id,codigo').eq('plano_id', planoId))
      const codeToId: Record<string, string> = {}
      ;(all || []).forEach((c: any) => { codeToId[c.codigo] = c.id })
      const { parentOf, ehPai } = calcularHierarquia((all || []).map((c: any) => c.codigo))

      const fase2 = unicos.map(r => {
        const paiCod = r.paiExpl || parentOf[r.codigo]
        return {
          tenant_id: TENANT_ID, plano_id: planoId, codigo: r.codigo, descricao: r.descricao, ativo: true,
          tipo: resolverTipo(r.tipoExpl, r.classe, r.codigo, ehPai),
          pai_id: paiCod ? (codeToId[paiCod] || null) : null,
        }
      })
      const { error: e2 } = await supabase.from('conta_contabil').upsert(fase2, { onConflict: 'tenant_id,plano_id,codigo', ignoreDuplicates: false })
      if (e2) { setErro(e2.message); setInfo(null); return }

      setInfo(`${unicos.length} contas importadas no plano selecionado (hierarquia e tipo resolvidos).`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('contas_contabeis', HEADERS,
    data.map(c => [c.codigo, c.descricao, c.tipo, codeById[c.pai_id] || '']))

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #f1f3f5' }}>
        <span style={{ fontSize: 13, color: '#495057', fontWeight: 500 }}>Plano de contas:</span>
        <select style={S.select} value={planoId} onChange={e => setPlanoId(e.target.value)}>
          {planos.length === 0 && <option value="">— crie um plano em "Planos de Contas" —</option>}
          {planos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#adb5bd' }}>(as contas pertencem a este plano/ERP)</span>
      </div>
      <Toolbar
        modelo={() => baixarModelo('contas_contabeis', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Tipo</th><th style={S.th}>Pai</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={CT_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={5} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhuma conta cadastrada.<br /><small>Use "Importar Excel" (TOTVS CT1_CONTA ou modelo).</small></>}</td></tr>}
          {filtered.map(c => {
            const isSint = c.tipo === 'SINTETICA'
            return editId === c.id ? (
              <AddRow key={c.id} cols={CT_COLS} initial={{ codigo: c.codigo, descricao: c.descricao, tipo: c.tipo || 'ANALITICA', pai_id: c.pai_id || '' }} onSave={v => save(v, c.id)} onCancel={() => setEditId(null)} />
            ) : (
              <tr key={c.id}>
                <td style={{ ...S.tdMono, fontWeight: isSint ? 700 : 400, color: isSint ? '#212529' : '#868e96' }}>{c.codigo}</td>
                <td style={{ ...S.td, fontWeight: isSint ? 600 : 400 }}>{c.descricao}</td>
                <td style={{ ...S.td, color: isSint ? '#1971c2' : '#2f9e44', fontSize: 12, fontWeight: 500 }}>{c.tipo}</td>
                <td style={S.tdMono}>{codeById[c.pai_id] || '—'}</td>
                <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                  <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(c.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                  <button style={S.btnDel} title="Excluir" onClick={() => del(c.id)}><Trash2 size={14} /></button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── FuncionariosTab ──────────────────────────────────────────
function FuncionariosTab() {
  const [data, setData] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const HEADERS = ['matricula', 'nome', 'filial_codigo', 'cc_codigo']
  const EXEMPLO = ['00123', 'João da Silva', '0101', '1101']
  const FN_COLS = [
    { key: 'matricula', placeholder: 'Matrícula' },
    { key: 'nome', placeholder: 'Nome' },
    { key: 'filial_id', placeholder: 'Filial', type: 'select' as const, options: filiais.map(f => ({ value: f.id, label: f.descricao })) },
    { key: 'cc_id', placeholder: 'CC', type: 'select' as const, options: ccs.map(c => ({ value: c.id, label: c.descricao })) },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('funcionario').select('*, filial(codigo,descricao), centro_custo(codigo,descricao)').order('nome'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => {
    load()
    fetchAll(() => supabase.from('filial').select('id,descricao,codigo').order('codigo')).then(setFiliais)
    fetchAll(() => supabase.from('centro_custo').select('id,descricao,codigo').order('codigo')).then(setCcs)
  }, [])
  const filtered = filtraBusca(data, busca, f => `${f.matricula} ${f.nome} ${f.filial?.codigo || ''} ${f.filial?.descricao || ''} ${f.centro_custo?.codigo || ''} ${f.centro_custo?.descricao || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.matricula || !v.nome) { setErro('Matrícula e nome são obrigatórios'); return }
    setErro(null)
    const payload = { matricula: v.matricula.trim(), nome: v.nome.trim(), filial_id: v.filial_id || null, cc_id: v.cc_id || null }
    const { error } = id
      ? await supabase.from('funcionario').update(payload).eq('id', id)
      : await supabase.from('funcionario').insert({ tenant_id: TENANT_ID, ...payload, ativo: true })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir funcionário?')) return
    const { error } = await supabase.from('funcionario').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }

      // Monta lookup filial e CC por código
      const filialMap: Record<string, string> = {}
      filiais.forEach(f => { filialMap[f.codigo] = f.id })
      const ccMap: Record<string, string> = {}
      ccs.forEach(c => { ccMap[c.codigo] = c.id })

      const sample = rows[0]
      const isTotvs = 'BK_FUNCIONARIO' in sample || 'bk_funcionario' in sample

      const registros = rows
        .map(r => {
          const matricula = isTotvs ? col(r, 'BK_FUNCIONARIO') : col(r, 'matricula', 'Matrícula', 'MATRICULA')
          const nome = isTotvs ? col(r, 'BK_NOME') : col(r, 'nome', 'Nome', 'NOME')
          const filCod = isTotvs ? col(r, 'BK_FILIAL') : col(r, 'filial_codigo', 'filial', 'FILIAL')
          const ccCod = isTotvs ? col(r, 'BK_CC') : col(r, 'cc_codigo', 'centro_custo', 'CC')
          return {
            tenant_id: TENANT_ID,
            matricula,
            nome,
            filial_id: filialMap[filCod] || null,
            cc_id: ccMap[ccCod] || null,
            ativo: true,
          }
        })
        .filter(r => r.matricula && r.nome)

      const unicos = dedupe(registros, r => r.matricula)
      const { error } = await supabase.from('funcionario').upsert(unicos, { onConflict: 'tenant_id,matricula', ignoreDuplicates: false })
      if (error) { setErro(error.message); setInfo(null); return }
      setInfo(`${unicos.length} funcionários importados.`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('funcionarios', HEADERS, data.map(f => [f.matricula, f.nome, f.filial?.codigo || '', f.centro_custo?.codigo || '']))

  return (
    <div style={S.card}>
      <Toolbar
        modelo={() => baixarModelo('funcionarios', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Matrícula</th><th style={S.th}>Nome</th><th style={S.th}>Filial</th><th style={S.th}>CC</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={FN_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={5} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhum funcionário cadastrado.<br /><small>Use "Importar Excel" (TOTVS BK_FUNCIONARIO ou modelo).</small></>}</td></tr>}
          {filtered.map(f => editId === f.id ? (
            <AddRow key={f.id} cols={FN_COLS} initial={{ matricula: f.matricula, nome: f.nome, filial_id: f.filial_id || '', cc_id: f.cc_id || '' }} onSave={v => save(v, f.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={f.id}>
              <td style={S.tdMono}>{f.matricula}</td>
              <td style={S.td}>{f.nome}</td>
              <td style={{ ...S.td, color: '#868e96' }}>{f.filial?.descricao || '—'}</td>
              <td style={{ ...S.td, color: '#868e96' }}>{f.centro_custo?.descricao || '—'}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(f.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(f.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── VerbasTab ────────────────────────────────────────────────
function VerbasTab() {
  const [data, setData] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const TIPOS = [
    { value: 'SALARIO',  label: 'Salário' },
    { value: 'ENCARGO',  label: 'Encargo' },
    { value: 'BENEFICIO',label: 'Benefício' },
    { value: 'PROVISAO', label: 'Provisão' },
    { value: 'OUTRO',    label: 'Outro' },
  ]
  const TIPOS_VALIDOS = TIPOS.map(t => t.value)

  const HEADERS = ['codigo', 'descricao', 'tipo']
  const EXEMPLO = ['001', 'Salário Base', 'SALARIO']
  const VB_COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'tipo', placeholder: 'Tipo', type: 'select' as const, options: TIPOS },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('verba_folha').select('*').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [])
  const filtered = filtraBusca(data, busca, v => `${v.codigo} ${v.descricao} ${v.tipo || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), tipo: v.tipo || 'OUTRO' }
    const { error } = id
      ? await supabase.from('verba_folha').update(payload).eq('id', id)
      : await supabase.from('verba_folha').insert({ tenant_id: TENANT_ID, ...payload, ativo: true })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir verba?')) return
    const { error } = await supabase.from('verba_folha').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }

      const sample = rows[0]
      const isTotvs = 'RV_COD' in sample || 'rv_cod' in sample

      const registros = rows
        .map(r => {
          const tipoRaw = col(r, 'tipo', 'Tipo', 'TIPO').toUpperCase()
          return {
            tenant_id: TENANT_ID,
            codigo:    isTotvs ? col(r, 'RV_COD') : col(r, 'codigo', 'Código', 'CODIGO'),
            descricao: isTotvs ? col(r, 'RV_DESC') : col(r, 'descricao', 'Descrição', 'DESCRICAO'),
            tipo:      TIPOS_VALIDOS.includes(tipoRaw) ? tipoRaw : 'OUTRO',
            ativo:     true,
          }
        })
        .filter(r => r.codigo && r.descricao)

      const unicos = dedupe(registros, r => r.codigo)
      const { error } = await supabase.from('verba_folha').upsert(unicos, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (error) { setErro(error.message); setInfo(null); return }
      setInfo(`${unicos.length} verbas importadas.`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('verbas', HEADERS, data.map(v => [v.codigo, v.descricao, v.tipo]))

  const corTipo: Record<string, string> = {
    SALARIO: '#1971c2', ENCARGO: '#e67700', BENEFICIO: '#2f9e44', PROVISAO: '#6741d9', OUTRO: '#868e96',
  }

  return (
    <div style={S.card}>
      <Toolbar
        modelo={() => baixarModelo('verbas', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Tipo</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={VB_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={4} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhuma verba cadastrada.<br /><small>Use "Importar Excel" (TOTVS RV_COD ou modelo).</small></>}</td></tr>}
          {filtered.map(v => editId === v.id ? (
            <AddRow key={v.id} cols={VB_COLS} initial={{ codigo: v.codigo, descricao: v.descricao, tipo: v.tipo || 'OUTRO' }} onSave={vv => save(vv, v.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={v.id}>
              <td style={S.tdMono}>{v.codigo}</td>
              <td style={S.td}>{v.descricao}</td>
              <td style={{ ...S.td, color: corTipo[v.tipo] || '#868e96', fontWeight: 500, fontSize: 12 }}>{v.tipo}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(v.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(v.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── VersoesTab (cenários de orçamento) ───────────────────────
function VersoesTab() {
  const [data, setData] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [copia, setCopia] = useState<{ destino: any } | null>(null)
  const [copiaOrigem, setCopiaOrigem] = useState('')
  const [copiaSubst, setCopiaSubst] = useState(true)
  const [copiando, setCopiando] = useState(false)

  const VS_COLS = [
    { key: 'codigo', placeholder: 'Ex: ORCADO_2026' },
    { key: 'descricao', placeholder: 'Ex: Orçado 2026' },
    { key: 'ano', placeholder: 'Ano (ex: 2026)' },
  ]

  const copiarVersao = async () => {
    if (!copia || !copiaOrigem) { setErro('Selecione a versão de origem.'); return }
    setCopiando(true); setErro(null)
    const { data: n, error } = await supabase.rpc('copiar_versao_orcado', { p_origem: copiaOrigem, p_destino: copia.destino.id, p_substituir: copiaSubst })
    setCopiando(false)
    if (error) { setErro('Erro ao copiar: ' + error.message); return }
    setCopia(null); setCopiaOrigem('')
    alert(`${n ?? 0} lançamento(s) copiado(s) para "${copia.destino.codigo}".`)
  }

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('versao_orcamento').select('*').order('ano').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [])
  const filtered = filtraBusca(data, busca, v => `${v.codigo} ${v.descricao} ${v.ano ?? ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao || !v.ano) { setErro('Código, descrição e ano são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), ano: Number(v.ano) }
    const { error } = id
      ? await supabase.from('versao_orcamento').update(payload).eq('id', id)
      : await supabase.from('versao_orcamento').insert({ tenant_id: TENANT_ID, ...payload, ativa: true, bloqueada: false })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir versão? Os lançamentos dela serão removidos.')) return
    const { error } = await supabase.from('versao_orcamento').delete().eq('id', id)
    if (error) setErro(error.message)
    else load()
  }

  return (
    <div style={S.card}>
      <Toolbar onAdd={() => { setAdding(true); setErro(null) }} busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length} />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Ano</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={VS_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={4} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhuma versão/cenário cadastrado.<br /><small>Crie uma versão (ex: Orçado 2026) para poder lançar valores nos relatórios.</small></>}</td></tr>}
          {filtered.map(v => editId === v.id ? (
            <AddRow key={v.id} cols={VS_COLS} initial={{ codigo: v.codigo, descricao: v.descricao, ano: String(v.ano ?? '') }} onSave={vv => save(vv, v.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={v.id}>
              <td style={S.tdMono}>{v.codigo}</td>
              <td style={S.td}>{v.descricao}</td>
              <td style={S.td}>{v.ano}</td>
              <td style={{ ...S.td, width: 100, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#1971c2' }} title="Copiar lançamentos de outra versão para esta" onClick={() => { setCopia({ destino: v }); setCopiaOrigem(''); setCopiaSubst(true); setErro(null) }}><Copy size={14} /></button>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(v.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(v.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {copia && (
        <div style={S.overlay} onClick={() => !copiando && setCopia(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.mTitle}>Copiar orçado → <span style={{ color: '#1971c2' }}>{copia.destino.codigo}</span></div>
            <div style={S.field}>
              <label style={S.label}>Versão de origem</label>
              <select style={S.input} value={copiaOrigem} onChange={e => setCopiaOrigem(e.target.value)}>
                <option value="">— selecione —</option>
                {data.filter(v => v.id !== copia.destino.id).map(v => <option key={v.id} value={v.id}>{v.codigo} · {v.descricao}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#495057' }}>
              <input type="checkbox" checked={copiaSubst} onChange={e => setCopiaSubst(e.target.checked)} />
              Substituir (apaga o orçado atual de "{copia.destino.codigo}" antes de copiar)
            </label>
            <div style={{ fontSize: 12, color: '#868e96', marginTop: 8 }}>Copia todos os lançamentos do orçado (todas as empresas/linhas/períodos) da origem para esta versão.</div>
            {erro && <div style={{ ...S.erro, margin: '12px 0 0' }}><AlertCircle size={15} />{erro}</div>}
            <div style={S.mFooter}>
              <button style={S.btnImp} disabled={copiando} onClick={() => setCopia(null)}>Cancelar</button>
              <button style={S.btnAdd} disabled={copiando || !copiaOrigem} onClick={copiarVersao}>{copiando ? 'Copiando…' : 'Copiar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── EstruturaTab (conta_orcamentaria — estrutura compartilhada) ──
const TIPOS_LINHA = [
  { value: 'ANALITICA', label: 'Analítica' },
  { value: 'SOMAR_FILHOS', label: 'Somar filhos' },
  { value: 'FORMULA', label: 'Fórmula' },
  { value: 'INDICADOR', label: 'Indicador' },
  { value: 'ESPACO', label: 'Espaço' },
]
const NATUREZAS = [
  { value: 'RECEITA', label: 'Receita' },
  { value: 'DESPESA', label: 'Despesa' },
  { value: 'NEUTRO', label: 'Neutro' },
]
// ─── Modal: DE-PARA conta → linha mestre (manutenção independente de relatório) ──
function ContaLinhaModal({ linha, onClose }: { linha: any; onClose: () => void }) {
  const [contas, setContas] = useState<any[]>([])
  const [mapeadas, setMapeadas] = useState<any[]>([])
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [linked, setLinked] = useState<Set<string>>(new Set())   // contas já amarradas em qualquer linha orçamentária
  const toggleSel = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const load = async () => {
    setMapeadas(await fetchAll(() => supabase.from('conta_linha')
      .select('id,conta_id,sinal, conta_contabil(codigo,descricao, plano_contas(codigo))').eq('linha_id', linha.id)))
    setLinked(new Set((await fetchAll(() => supabase.from('conta_linha').select('conta_id'))).map((x: any) => x.conta_id)))
  }
  useEffect(() => {
    load()
    fetchAll(() => supabase.from('conta_contabil').select('id,codigo,descricao, plano_contas(codigo)').order('codigo'))
      .then(cs => setContas(cs.map((c: any) => ({ id: c.id, codigo: c.codigo, descricao: c.descricao, plano: c.plano_contas?.codigo || '' }))))
  }, []) // eslint-disable-line
  const addMany = async (ids: string[]) => {
    const ex = new Set(mapeadas.map(m => m.conta_id))
    const novos = ids.filter(c => !ex.has(c))
    if (!novos.length) return
    const { error } = await supabase.from('conta_linha').insert(novos.map(c => ({ tenant_id: TENANT_ID, conta_id: c, linha_id: linha.id, sinal: 1 })))
    if (error) { alert('Erro: ' + error.message); return }
    setBusca(''); setSel(new Set()); load()
  }
  const toggle = async (id: string, sinal: number) => { await supabase.from('conta_linha').update({ sinal }).eq('id', id); load() }
  const todas = async (sinal: number) => { for (const m of mapeadas) await supabase.from('conta_linha').update({ sinal }).eq('id', m.id); load() }
  const remove = async (id: string) => { await supabase.from('conta_linha').delete().eq('id', id); load() }
  const b = busca.trim().toLowerCase()
  const mapped = new Set(mapeadas.map(m => m.conta_id))
  const result = b ? contas.filter(c => !mapped.has(c.id) && (c.codigo.toLowerCase().includes(b) || c.descricao.toLowerCase().includes(b) || (c.plano || '').toLowerCase().includes(b))).slice(0, 60) : []
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, width: 560 }} onClick={e => e.stopPropagation()}>
        <div style={S.mTitle}>Contas → <span style={{ color: '#1971c2' }}>{linha.codigo} · {linha.descricao}</span></div>
        <div style={{ fontSize: 12, color: '#868e96', marginBottom: 6 }}>Contas contábeis cujo realizado é somado nesta linha. Valor importado = crédito − débito; use sinal −1 para inverter (ex.: deixar receita/despesa positiva).</div>
        {mapeadas.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: '#868e96' }}>
            <span>Aplicar a todas:</span>
            <button onClick={() => todas(1)} style={{ padding: '3px 10px', border: '1px solid #b2f2bb', borderRadius: 6, cursor: 'pointer', background: '#ebfbee', color: '#2f9e44', fontWeight: 700 }}>+ Tudo</button>
            <button onClick={() => todas(-1)} style={{ padding: '3px 10px', border: '1px solid #ffc9c9', borderRadius: 6, cursor: 'pointer', background: '#fff5f5', color: '#e03131', fontWeight: 700 }}>− Tudo</button>
          </div>
        )}
        <div style={{ maxHeight: 260, overflow: 'auto', margin: '4px 0' }}>
          {mapeadas.length === 0 && <div style={{ fontSize: 13, color: '#adb5bd', padding: '8px 0' }}>Nenhuma conta amarrada ainda.</div>}
          {mapeadas.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f3f5' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#868e96', minWidth: 90 }}>{m.conta_contabil?.codigo}</span>
              {m.conta_contabil?.plano_contas?.codigo && <span style={{ fontSize: 10, color: '#1971c2', background: '#e7f5ff', borderRadius: 4, padding: '1px 5px' }}>{m.conta_contabil.plano_contas.codigo}</span>}
              <span style={{ fontSize: 13, flex: 1 }}>{m.conta_contabil?.descricao}</span>
              <button onClick={() => toggle(m.id, m.sinal === 1 ? -1 : 1)} title="Inverter sinal"
                style={{ width: 28, border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer', background: m.sinal === 1 ? '#ebfbee' : '#fff5f5', color: m.sinal === 1 ? '#2f9e44' : '#e03131', fontWeight: 700 }}>{m.sinal === 1 ? '+' : '−'}</button>
              <button onClick={() => remove(m.id)} style={{ ...S.btnDel, color: '#ffa8a8' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div style={S.field}>
          <label style={S.label}>Adicionar contas (marque várias)</label>
          <input style={S.input} placeholder="Buscar por código ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
          {result.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0', fontSize: 12 }}>
                <button onClick={() => setSel(prev => { const n = new Set(prev); result.forEach(c => n.add(c.id)); return n })} style={{ background: 'none', border: 'none', color: '#1971c2', cursor: 'pointer', padding: 0 }}>Marcar resultados ({result.length})</button>
                {sel.size > 0 && <button onClick={() => setSel(new Set())} style={{ background: 'none', border: 'none', color: '#868e96', cursor: 'pointer', padding: 0 }}>Limpar</button>}
                <div style={{ flex: 1 }} />
                <button disabled={!sel.size} onClick={() => addMany([...sel])} style={{ ...S.btnAdd, opacity: sel.size ? 1 : 0.5, cursor: sel.size ? 'pointer' : 'default' }}>Adicionar{sel.size ? ` ${sel.size}` : ''}</button>
              </div>
              <div style={{ border: '1px solid #e9ecef', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
                {result.map(c => { const on = sel.has(c.id); const elsewhere = linked.has(c.id); return (
                  <div key={c.id} onClick={() => toggleSel(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f8f9fa', background: on ? '#e7f5ff' : elsewhere ? '#fff9db' : 'white' }}>
                    <input type="checkbox" checked={on} readOnly />
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#868e96', minWidth: 90 }}>{c.codigo}</span>
                    {(c as any).plano && <span style={{ fontSize: 10, color: '#1971c2', background: '#e7f5ff', borderRadius: 4, padding: '1px 5px' }}>{(c as any).plano}</span>}
                    <span style={{ flex: 1, color: elsewhere ? '#b08900' : undefined }}>{c.descricao}</span>
                    {elsewhere && <span title="já amarrada em outra linha" style={{ fontSize: 10, color: '#b08900', background: '#fff3bf', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>já amarrada</span>}
                  </div>) })}
              </div>
            </>
          )}
        </div>
        <div style={S.mFooter}><button style={S.btnAdd} onClick={onClose}>Concluir</button></div>
      </div>
    </div>
  )
}

function EstruturaTab() {
  const [data, setData] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [contaModal, setContaModal] = useState<any | null>(null)

  const HEADERS = ['codigo', 'descricao', 'tipo', 'natureza', 'pai_codigo']
  const EXEMPLO = ['2', 'DESPESAS', 'SOMAR_FILHOS', 'DESPESA', '']
  const codeById: Record<string, string> = Object.fromEntries(data.map(c => [c.id, c.codigo]))
  const byId: Record<string, any> = Object.fromEntries(data.map(c => [c.id, c]))
  const tipoLabel = (t: string) => TIPOS_LINHA.find(x => x.value === t)?.label || t
  const temFilhos = (id: string) => data.some(d => d.pai_id === id)
  const toggle = (id: string) => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'tipo_linha', placeholder: 'Tipo', type: 'select' as const, options: TIPOS_LINHA },
    { key: 'natureza', placeholder: 'Natureza', type: 'select' as const, options: NATUREZAS },
    { key: 'pai_id', placeholder: 'Pai', type: 'select' as const, options: data.map(c => ({ value: c.id, label: `${c.codigo} · ${c.descricao}` })) },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('conta_orcamentaria').select('*').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [])
  const filtered = filtraBusca(data, busca, c => `${c.codigo} ${c.descricao} ${tipoLabel(c.tipo_linha)} ${c.natureza || ''} ${codeById[c.pai_id] || ''}`)
  // árvore: na busca, mantém os resultados + ancestrais (para dar contexto)
  const keepIds: Set<string> | null = busca.trim()
    ? (() => { const k = new Set<string>(); for (const c of filtered) { let x: any = c; while (x) { k.add(x.id); x = byId[x.pai_id] } } return k })()
    : null
  const arvore = buildArvore(data)
  const visivel = arvore.filter(({ node }) => {
    if (keepIds && !keepIds.has(node.id)) return false
    let p = byId[node.pai_id]
    while (p) { if (collapsed.has(p.id)) return false; p = byId[p.pai_id] }
    return true
  })

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), tipo_linha: v.tipo_linha || 'ANALITICA', natureza: v.natureza || 'NEUTRO', pai_id: v.pai_id || null }
    const { error } = id
      ? await supabase.from('conta_orcamentaria').update(payload).eq('id', id)
      : await supabase.from('conta_orcamentaria').insert({ tenant_id: TENANT_ID, ...payload })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }
  const del = async (id: string) => {
    if (!confirm('Excluir linha da estrutura? Lançamentos de orçado e amarrações de conta ligados a ela serão removidos (CASCADE).')) return
    const { error } = await supabase.from('conta_orcamentaria').delete().eq('id', id)
    if (error) setErro(error.message); else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }
      const base = rows.map(r => ({
        codigo: col(r, 'codigo', 'Código', 'CODIGO'),
        descricao: col(r, 'descricao', 'Descrição', 'DESCRICAO'),
        tipoExpl: col(r, 'tipo', 'Tipo', 'TIPO'),
        natureza: (col(r, 'natureza', 'Natureza', 'NATUREZA') || '').toUpperCase(),
        paiExpl: col(r, 'pai_codigo', 'pai', 'PAI'),
      })).filter(r => r.codigo && r.descricao)
      const unicos = dedupe(base, r => r.codigo)
      const { parentOf, ehPai } = calcularHierarquia(unicos.map(r => r.codigo))
      const normTipo = (ex: string, cod: string) => {
        const e = ex.trim().toUpperCase()
        if (['ANALITICA', 'SOMAR_FILHOS', 'FORMULA', 'INDICADOR', 'ESPACO'].includes(e)) return e
        if (e.startsWith('SINT')) return 'SOMAR_FILHOS'
        if (e.startsWith('ANAL')) return 'ANALITICA'
        return ehPai.has(cod) ? 'SOMAR_FILHOS' : 'ANALITICA'
      }
      const normNat = (n: string) => (['RECEITA', 'DESPESA', 'NEUTRO'].includes(n) ? n : 'NEUTRO')
      const fase1 = unicos.map(r => ({ tenant_id: TENANT_ID, codigo: r.codigo, descricao: r.descricao, tipo_linha: normTipo(r.tipoExpl, r.codigo), natureza: normNat(r.natureza) }))
      const { error: e1 } = await supabase.from('conta_orcamentaria').upsert(fase1, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (e1) { setErro(e1.message); setInfo(null); return }
      const all = await fetchAll(() => supabase.from('conta_orcamentaria').select('id,codigo'))
      const idByCod: Record<string, string> = {}; all.forEach((c: any) => { idByCod[String(c.codigo)] = c.id })
      for (const r of unicos) {
        const paiCod = r.paiExpl || parentOf[r.codigo]
        if (paiCod && idByCod[r.codigo] && idByCod[paiCod]) await supabase.from('conta_orcamentaria').update({ pai_id: idByCod[paiCod] }).eq('id', idByCod[r.codigo])
      }
      setInfo(`${unicos.length} linhas da estrutura importadas (hierarquia resolvida).`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('estrutura_orcamentaria', HEADERS, data.map(c => [c.codigo, c.descricao, c.tipo_linha, c.natureza || '', codeById[c.pai_id] || '']))

  return (
    <div style={S.card}>
      <Toolbar modelo={() => baixarModelo('estrutura_orcamentaria', HEADERS, EXEMPLO)} onImport={importar} onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }} busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length} />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <div style={{ display: 'flex', gap: 6, padding: '6px 16px', borderBottom: '1px solid #f1f3f5' }}>
        <button style={S.treeBtn} onClick={() => setCollapsed(new Set())}><ChevronsUpDown size={13} /> Expandir tudo</button>
        <button style={S.treeBtn} onClick={() => setCollapsed(new Set(data.filter(d => temFilhos(d.id)).map(d => d.id)))}>Recolher tudo</button>
      </div>
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição (árvore)</th><th style={S.th}>Tipo</th><th style={S.th}>Natureza</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {data.length === 0 && !adding && <tr><td colSpan={5} style={S.empty}>Estrutura vazia.<br /><small>Importe as linhas (código + descrição) ou rode a migração F1.</small></td></tr>}
          {data.length > 0 && visivel.length === 0 && <tr><td colSpan={5} style={S.empty}>Nenhum resultado para a busca.</td></tr>}
          {visivel.map(({ node: c, depth }) => editId === c.id ? (
            <AddRow key={c.id} cols={COLS} initial={{ codigo: c.codigo, descricao: c.descricao, tipo_linha: c.tipo_linha || 'ANALITICA', natureza: c.natureza || 'NEUTRO', pai_id: c.pai_id || '' }} onSave={v => save(v, c.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={c.id}>
              <td style={S.tdMono}>{c.codigo}</td>
              <td style={S.td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: depth * 18 }}>
                  {temFilhos(c.id)
                    ? <span onClick={() => toggle(c.id)} style={{ cursor: 'pointer', color: '#868e96', display: 'flex' }}>{collapsed.has(c.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
                    : <span style={{ width: 14, display: 'inline-block' }} />}
                  <span style={{ fontWeight: temFilhos(c.id) ? 600 : 400 }}>{c.descricao}</span>
                </div>
              </td>
              <td style={{ ...S.td, fontSize: 12, color: '#1971c2' }}>{tipoLabel(c.tipo_linha)}</td>
              <td style={{ ...S.td, fontSize: 12, color: '#868e96' }}>{c.natureza || '—'}</td>
              <td style={{ ...S.td, width: 100, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#1971c2' }} title="Contas (DE-PARA do realizado)" onClick={() => setContaModal(c)}><Link2 size={14} /></button>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(c.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(c.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {contaModal && <ContaLinhaModal linha={contaModal} onClose={() => setContaModal(null)} />}
    </div>
  )
}

// ─── PlanosTab (plano de contas por ERP) ─────────────────────
function PlanosTab() {
  const [data, setData] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const COLS = [{ key: 'codigo', placeholder: 'Ex: TOTVS' }, { key: 'nome', placeholder: 'Ex: TOTVS (Protheus)' }]
  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('plano_contas').select('*, conta_contabil(count)').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [])
  const filtered = filtraBusca(data, busca, p => `${p.codigo} ${p.nome}`)
  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.nome) { setErro('Código e nome são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), nome: v.nome.trim() }
    const { error } = id
      ? await supabase.from('plano_contas').update(payload).eq('id', id)
      : await supabase.from('plano_contas').insert({ tenant_id: TENANT_ID, ...payload })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }
  const del = async (id: string) => {
    if (!confirm('Excluir plano de contas? As contas contábeis dele serão removidas (CASCADE).')) return
    const { error } = await supabase.from('plano_contas').delete().eq('id', id)
    if (error) setErro(error.message); else load()
  }
  return (
    <div style={S.card}>
      <Toolbar onAdd={() => { setAdding(true); setErro(null) }} busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length} />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      <table style={S.table}>
        <thead><tr><th style={S.th}>Código</th><th style={S.th}>Nome (ERP)</th><th style={S.th}>Contas</th><th style={S.th}></th></tr></thead>
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={4} style={S.empty}>{busca ? 'Nenhum resultado.' : <>Nenhum plano de contas.<br /><small>Crie um plano por ERP (ex.: TOTVS, SAP…). As empresas e contas apontam para um plano.</small></>}</td></tr>}
          {filtered.map(p => editId === p.id ? (
            <AddRow key={p.id} cols={COLS} initial={{ codigo: p.codigo, nome: p.nome }} onSave={v => save(v, p.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={p.id}>
              <td style={S.tdMono}>{p.codigo}</td>
              <td style={S.td}>{p.nome}</td>
              <td style={{ ...S.td, color: '#868e96' }}>{p.conta_contabil?.[0]?.count ?? 0}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: '#868e96' }} title="Editar" onClick={() => { setEditId(p.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(p.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────
const ABAS: { id: Aba; label: string }[] = [
  { id: 'empresas',     label: 'Empresas' },
  { id: 'filiais',      label: 'Filiais' },
  { id: 'cc',           label: 'Centro de Custo' },
  { id: 'planos',       label: 'Planos de Contas' },
  { id: 'contas',       label: 'Conta Contábil' },
  { id: 'estrutura',    label: 'Estrutura Orçamentária' },
  { id: 'funcionarios', label: 'Funcionários' },
  { id: 'verbas',       label: 'Verbas' },
  { id: 'versoes',      label: 'Versões/Cenários' },
]

export default function CadastrosPage() {
  const [aba, setAba] = useState<Aba>('empresas')

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.title}>Cadastros</h1>
        <p style={S.subtitle}>Empresas · Filiais · Centro de Custo · Conta Contábil · Funcionários · Verbas</p>
      </div>
      <div style={S.tabs}>
        {ABAS.map(a => (
          <button key={a.id} style={S.tab(aba === a.id)} onClick={() => setAba(a.id)}>{a.label}</button>
        ))}
      </div>
      {aba === 'empresas'     && <EmpresasTab />}
      {aba === 'filiais'      && <FiliaisTab />}
      {aba === 'cc'           && <CentroCustoTab />}
      {aba === 'planos'       && <PlanosTab />}
      {aba === 'contas'       && <ContasTab />}
      {aba === 'estrutura'    && <EstruturaTab />}
      {aba === 'funcionarios' && <FuncionariosTab />}
      {aba === 'verbas'       && <VerbasTab />}
      {aba === 'versoes'      && <VersoesTab />}
    </div>
  )
}
