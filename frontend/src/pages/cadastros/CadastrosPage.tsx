import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { decodeCC, AREA_MAP, DIVISAO_MAP, BU_MAP } from '../../lib/ccDims'
import { useGrid, GridHead } from '../../lib/grid'
import type { GCol } from '../../lib/grid'

// SheetJS carregado via CDN no index.html
declare const XLSX: any
import { Plus, Trash2, Check, X, Upload, AlertCircle, Download, FileDown, Pencil, Copy, Link2 } from 'lucide-react'

type Aba = 'empresas' | 'filiais' | 'cc' | 'planos' | 'contas' | 'estrutura' | 'funcionarios' | 'verbas' | 'versoes' | 'lotes'

// ─── Styles ──────────────────────────────────────────────────
const S = {
  page:     { padding: 24, fontFamily: 'system-ui, sans-serif' } as CSSProperties,
  header:   { marginBottom: 20 } as CSSProperties,
  title:    { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 } as CSSProperties,
  subtitle: { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' } as CSSProperties,
  tabs:     { display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)' } as CSSProperties,
  tab:      (active: boolean): CSSProperties => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
    background: 'none', color: active ? 'var(--violet)' : 'var(--muted)',
    borderBottom: active ? '2px solid var(--violet)' : '2px solid transparent',
    marginBottom: -1, transition: 'all 0.15s',
  }),
  card:     { background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' } as CSSProperties,
  toolbar:  { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', padding: '10px 16px', borderBottom: '1px solid var(--panel)' } as CSSProperties,
  table:    { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th:       { textAlign: 'left' as const, padding: '9px 14px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  td:       { padding: '9px 14px', borderBottom: '1px solid var(--panel)', color: 'var(--text)' },
  tdMono:   { padding: '9px 14px', borderBottom: '1px solid var(--panel)', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 13 },
  badge:    (ativo: boolean): CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 500,
    background: ativo ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.10)', color: ativo ? 'var(--green)' : 'var(--red)',
  }),
  btnAdd:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'var(--violet)', color: '#ffffff', border: 'none', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  btnImp:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  treeBtn:  { display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', fontSize: 12, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' } as CSSProperties,
  btnDel:   { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-strong)', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' } as CSSProperties,
  input:    { padding: '5px 8px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  search:   { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, outline: 'none', width: 240, boxSizing: 'border-box' as const },
  select:   { padding: '5px 8px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, outline: 'none', width: '100%', background: 'var(--panel)' },
  empty:    { padding: '40px 24px', textAlign: 'center' as const, color: 'var(--muted)', fontSize: 13 },
  erro:     { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', margin: '0 16px 12px', color: 'var(--red)', fontSize: 13 } as CSSProperties,
  info:     { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.30)', borderRadius: 8, padding: '10px 14px', margin: '0 16px 12px', color: 'var(--blue)', fontSize: 13 } as CSSProperties,
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as CSSProperties,
  modal:    { background: 'var(--panel)', borderRadius: 14, padding: 24, width: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' } as CSSProperties,
  mTitle:   { fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--text)' } as CSSProperties,
  field:    { marginBottom: 14 } as CSSProperties,
  label:    { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 } as CSSProperties,
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
    <tr style={{ background: 'rgba(139,92,246,0.07)' }}>
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
        <button style={{ ...S.btnDel, color: 'var(--green)' }} onClick={() => onSave(vals)}><Check size={15} /></button>
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
          {busca ? <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{mostrando} de {total}</span>
            : (total != null ? <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{total} registro{total !== 1 ? 's' : ''}</span> : null)}
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
  const GRID: GCol[] = [
    { key: 'codigo', label: 'Código' },
    { key: 'descricao', label: 'Descrição' },
    { key: 'plano', label: 'Plano (ERP)', get: e => planoCod(e.plano_id) },
    { key: 'ativo', label: 'Status', get: e => e.ativo ? 'Ativo' : 'Inativo' },
  ]
  const grid = useGrid(filtered, GRID)

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
        <GridHead cols={GRID} grid={grid} thStyle={S.th} />
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {grid.rows.length === 0 && !adding && <tr><td colSpan={5} style={S.empty}>{busca || grid.filtrosOn ? 'Nenhum resultado.' : <>Nenhuma empresa cadastrada.<br /><small>Use "Baixar modelo" e depois "Importar Excel".</small></>}</td></tr>}
          {grid.rows.map(e => editId === e.id ? (
            <AddRow key={e.id} cols={COLS} initial={{ codigo: e.codigo, descricao: e.descricao, plano_id: e.plano_id || '' }} onSave={v => save(v, e.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={e.id}>
              <td style={S.tdMono}>{e.codigo}</td>
              <td style={S.td}>{e.descricao}</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{planoCod(e.plano_id) || '—'}</td>
              <td style={S.td}><span style={S.badge(e.ativo)}>{e.ativo ? 'Ativo' : 'Inativo'}</span></td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(e.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
    { key: 'imp_fat', placeholder: 'ISS % (imp_fat)' },
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
  const GRID: GCol[] = [
    { key: 'codigo', label: 'Código' },
    { key: 'descricao', label: 'Descrição' },
    { key: 'empresa', label: 'Empresa', get: f => f.empresa?.descricao || '' },
    { key: 'imp_fat', label: 'ISS %', align: 'right', get: f => f.imp_fat ?? null },
  ]
  const grid = useGrid(filtered, GRID)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao || !v.empresa_id) { setErro('Código, descrição e empresa são obrigatórios'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), empresa_id: v.empresa_id, imp_fat: v.imp_fat ? Number(String(v.imp_fat).replace(',', '.')) : null }
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
        <GridHead cols={GRID} grid={grid} thStyle={S.th} />
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {grid.rows.length === 0 && !adding && <tr><td colSpan={5} style={S.empty}>{busca || grid.filtrosOn ? 'Nenhum resultado.' : <>Nenhuma filial cadastrada.<br /><small>Use "Baixar modelo" e depois "Importar Excel".</small></>}</td></tr>}
          {grid.rows.map(f => editId === f.id ? (
            <AddRow key={f.id} cols={COLS} initial={{ codigo: f.codigo, descricao: f.descricao, empresa_id: f.empresa_id || '', imp_fat: f.imp_fat != null ? String(f.imp_fat) : '' }} onSave={v => save(v, f.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={f.id}>
              <td style={S.tdMono}>{f.codigo}</td>
              <td style={S.td}>{f.descricao}</td>
              <td style={S.td}>{f.empresa?.descricao}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>{f.imp_fat != null ? Number(f.imp_fat).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(f.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
  const opt = (m: Record<string, string>) => [{ value: '', label: '—' }, ...Object.entries(m).map(([value, label]) => ({ value, label: `${value} · ${label}` }))]
  const CC_COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'tipo', placeholder: 'Tipo', type: 'select' as const, options: [{ value: 'ANALITICA', label: 'Analítica' }, { value: 'SINTETICA', label: 'Sintética' }] },
    { key: 'pai_id', placeholder: 'Pai', type: 'select' as const, options: data.map(c => ({ value: c.id, label: `${c.codigo} · ${c.descricao}` })) },
    { key: 'area_cod', placeholder: 'Área', type: 'select' as const, options: opt(AREA_MAP) },
    { key: 'divisao_cod', placeholder: 'Divisão', type: 'select' as const, options: opt(DIVISAO_MAP) },
    { key: 'bu_cod', placeholder: 'BU', type: 'select' as const, options: opt(BU_MAP) },
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
    // dims: usa o que foi escolhido manualmente; se vazio, cai na decodificação pelo código (CC legado pode editar à mão)
    const dec = decodeCC(v.codigo.trim())
    const dim = {
      area_cod: v.area_cod || dec.area_cod || null,
      area_nome: v.area_cod ? (AREA_MAP[v.area_cod] || v.area_cod) : (dec.area_nome || null),
      divisao_cod: v.divisao_cod || dec.divisao_cod || null,
      divisao_nome: v.divisao_cod ? (DIVISAO_MAP[v.divisao_cod] || v.divisao_cod) : (dec.divisao_nome || null),
      bu_cod: v.bu_cod || dec.bu_cod || null,
      bu_nome: v.bu_cod ? (BU_MAP[v.bu_cod] || v.bu_cod) : (dec.bu_nome || null),
    }
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), tipo: v.tipo || 'ANALITICA', pai_id: v.pai_id || null, ...dim }
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
      const fase1 = unicos.map(r => ({ tenant_id: TENANT_ID, codigo: r.codigo, descricao: r.descricao, area: r.area, ativo: true, ...decodeCC(r.codigo) }))
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
          ...decodeCC(r.codigo),
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

  const recalcAtributos = async () => {
    setErro(null); setInfo('Recalculando Área/Divisão/BU pela posição do código…')
    const { error } = await supabase.rpc('decodificar_cc')
    if (error) { setErro(error.message); setInfo(null); return }
    setInfo('Atributos Área/Divisão/BU recalculados.'); load()
  }

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid var(--panel)' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Área/Divisão/BU derivados da posição do código.</span>
        <div style={{ flex: 1 }} />
        <button style={S.btnImp} onClick={recalcAtributos}>Recalcular Área/Divisão/BU</button>
      </div>
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Tipo</th><th style={S.th}>Pai</th><th style={S.th}>Área</th><th style={S.th}>Divisão</th><th style={S.th}>BU</th><th style={S.th}>Status</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={CC_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={9} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhum centro de custo cadastrado.<br /><small>Use "Importar Excel" (TOTVS ou modelo).</small></>}</td></tr>}
          {filtered.map(c => {
            const isSint = c.tipo === 'SINTETICA'
            return editId === c.id ? (
              <AddRow key={c.id} cols={CC_COLS} initial={{ codigo: c.codigo, descricao: c.descricao, tipo: c.tipo || 'ANALITICA', pai_id: c.pai_id || '', area_cod: c.area_cod || '', divisao_cod: c.divisao_cod || '', bu_cod: c.bu_cod || '' }} onSave={v => save(v, c.id)} onCancel={() => setEditId(null)} />
            ) : (
              <tr key={c.id}>
                <td style={{ ...S.tdMono, fontWeight: isSint ? 700 : 400, color: isSint ? 'var(--text)' : 'var(--muted)' }}>{c.codigo}</td>
                <td style={{ ...S.td, fontWeight: isSint ? 600 : 400 }}>{c.descricao}</td>
                <td style={{ ...S.td, color: isSint ? 'var(--blue)' : 'var(--green)', fontSize: 12, fontWeight: 500 }}>{c.tipo || 'ANALITICA'}</td>
                <td style={{ ...S.tdMono }}>{codeById[c.pai_id] || '—'}</td>
                <td style={{ ...S.td, color: 'var(--text-mid)' }}>{c.area_nome || '—'}</td>
                <td style={{ ...S.td, color: 'var(--muted)' }}>{c.divisao_nome || '—'}</td>
                <td style={{ ...S.td, color: 'var(--muted)' }}>{c.bu_nome || '—'}</td>
                <td style={S.td}><span style={S.badge(c.ativo)}>{c.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                  <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(c.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
  const NAT_OPTS = [{ value: 'ATIVO', label: 'Ativo' }, { value: 'PASSIVO', label: 'Passivo' }, { value: 'RECEITA', label: 'Receita' }, { value: 'DESPESA', label: 'Despesa' }, { value: 'TRANSITORIA', label: 'Transitória' }]
  const natPorCodigo = (cod: string) => ({ '1': 'ATIVO', '2': 'PASSIVO', '3': 'RECEITA', '4': 'DESPESA' } as Record<string, string>)[(cod || '').trim()[0]] || 'TRANSITORIA'
  const CT_COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'tipo', placeholder: 'Tipo', type: 'select' as const, options: [{ value: 'ANALITICA', label: 'Analítica' }, { value: 'SINTETICA', label: 'Sintética' }] },
    { key: 'natureza', placeholder: 'Natureza', type: 'select' as const, options: NAT_OPTS },
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
  const filtered = filtraBusca(data, busca, c => `${c.codigo} ${c.descricao} ${c.tipo || ''} ${c.natureza || ''} ${codeById[c.pai_id] || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    if (!planoId) { setErro('Selecione um plano de contas.'); return }
    setErro(null)
    const payload = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), tipo: v.tipo || 'ANALITICA', natureza: v.natureza || natPorCodigo(v.codigo), pai_id: v.pai_id || null }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--panel)' }}>
        <span style={{ fontSize: 13, color: 'var(--text-mid)', fontWeight: 500 }}>Plano de contas:</span>
        <select style={S.select} value={planoId} onChange={e => setPlanoId(e.target.value)}>
          {planos.length === 0 && <option value="">— crie um plano em "Planos de Contas" —</option>}
          {planos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>(as contas pertencem a este plano/ERP)</span>
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
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Tipo</th><th style={S.th}>Natureza</th><th style={S.th}>Pai</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={CT_COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={6} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhuma conta cadastrada.<br /><small>Use "Importar Excel" (TOTVS CT1_CONTA ou modelo).</small></>}</td></tr>}
          {filtered.map(c => {
            const isSint = c.tipo === 'SINTETICA'
            return editId === c.id ? (
              <AddRow key={c.id} cols={CT_COLS} initial={{ codigo: c.codigo, descricao: c.descricao, tipo: c.tipo || 'ANALITICA', natureza: c.natureza || '', pai_id: c.pai_id || '' }} onSave={v => save(v, c.id)} onCancel={() => setEditId(null)} />
            ) : (
              <tr key={c.id}>
                <td style={{ ...S.tdMono, fontWeight: isSint ? 700 : 400, color: isSint ? 'var(--text)' : 'var(--muted)' }}>{c.codigo}</td>
                <td style={{ ...S.td, fontWeight: isSint ? 600 : 400 }}>{c.descricao}</td>
                <td style={{ ...S.td, color: isSint ? 'var(--blue)' : 'var(--green)', fontSize: 12, fontWeight: 500 }}>{c.tipo}</td>
                <td style={{ ...S.td, fontSize: 12, color: 'var(--text-mid)' }}>{c.natureza || '—'}</td>
                <td style={S.tdMono}>{codeById[c.pai_id] || '—'}</td>
                <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                  <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(c.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
              <td style={{ ...S.td, color: 'var(--muted)' }}>{f.filial?.descricao || '—'}</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{f.centro_custo?.descricao || '—'}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(f.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
    SALARIO: 'var(--blue)', ENCARGO: '#e67700', BENEFICIO: 'var(--green)', PROVISAO: 'var(--violet)', OUTRO: 'var(--muted)',
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
              <td style={{ ...S.td, color: corTipo[v.tipo] || 'var(--muted)', fontWeight: 500, fontSize: 12 }}>{v.tipo}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(v.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
                <button style={{ ...S.btnDel, color: 'var(--blue)' }} title="Copiar lançamentos de outra versão para esta" onClick={() => { setCopia({ destino: v }); setCopiaOrigem(''); setCopiaSubst(true); setErro(null) }}><Copy size={14} /></button>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(v.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(v.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {copia && (
        <div style={S.overlay} onClick={() => !copiando && setCopia(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.mTitle}>Copiar orçado → <span style={{ color: 'var(--blue)' }}>{copia.destino.codigo}</span></div>
            <div style={S.field}>
              <label style={S.label}>Versão de origem</label>
              <select style={S.input} value={copiaOrigem} onChange={e => setCopiaOrigem(e.target.value)}>
                <option value="">— selecione —</option>
                {data.filter(v => v.id !== copia.destino.id).map(v => <option key={v.id} value={v.id}>{v.codigo} · {v.descricao}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-mid)' }}>
              <input type="checkbox" checked={copiaSubst} onChange={e => setCopiaSubst(e.target.checked)} />
              Substituir (apaga o orçado atual de "{copia.destino.codigo}" antes de copiar)
            </label>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Copia todos os lançamentos do orçado (todas as empresas/linhas/períodos) da origem para esta versão.</div>
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
        <div style={S.mTitle}>Contas → <span style={{ color: 'var(--blue)' }}>{linha.codigo} · {linha.descricao}</span></div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Contas contábeis cujo realizado é somado nesta linha. Valor importado = crédito − débito; use sinal −1 para inverter (ex.: deixar receita/despesa positiva).</div>
        {mapeadas.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
            <span>Aplicar a todas:</span>
            <button onClick={() => todas(1)} style={{ padding: '3px 10px', border: '1px solid var(--green)', borderRadius: 6, cursor: 'pointer', background: 'rgba(52,211,153,0.12)', color: 'var(--green)', fontWeight: 700 }}>+ Tudo</button>
            <button onClick={() => todas(-1)} style={{ padding: '3px 10px', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 6, cursor: 'pointer', background: 'rgba(248,113,113,0.10)', color: 'var(--red)', fontWeight: 700 }}>− Tudo</button>
          </div>
        )}
        <div style={{ maxHeight: 260, overflow: 'auto', margin: '4px 0' }}>
          {mapeadas.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Nenhuma conta amarrada ainda.</div>}
          {mapeadas.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--panel)' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', minWidth: 90 }}>{m.conta_contabil?.codigo}</span>
              {m.conta_contabil?.plano_contas?.codigo && <span style={{ fontSize: 10, color: 'var(--blue)', background: 'rgba(59,130,246,0.16)', borderRadius: 4, padding: '1px 5px' }}>{m.conta_contabil.plano_contas.codigo}</span>}
              <span style={{ fontSize: 13, flex: 1 }}>{m.conta_contabil?.descricao}</span>
              <button onClick={() => toggle(m.id, m.sinal === 1 ? -1 : 1)} title="Inverter sinal"
                style={{ width: 28, border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer', background: m.sinal === 1 ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.10)', color: m.sinal === 1 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{m.sinal === 1 ? '+' : '−'}</button>
              <button onClick={() => remove(m.id)} style={{ ...S.btnDel, color: 'var(--red)' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div style={S.field}>
          <label style={S.label}>Adicionar contas (marque várias)</label>
          <input style={S.input} placeholder="Buscar por código ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
          {result.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0', fontSize: 12 }}>
                <button onClick={() => setSel(prev => { const n = new Set(prev); result.forEach(c => n.add(c.id)); return n })} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', padding: 0 }}>Marcar resultados ({result.length})</button>
                {sel.size > 0 && <button onClick={() => setSel(new Set())} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}>Limpar</button>}
                <div style={{ flex: 1 }} />
                <button disabled={!sel.size} onClick={() => addMany([...sel])} style={{ ...S.btnAdd, opacity: sel.size ? 1 : 0.5, cursor: sel.size ? 'pointer' : 'default' }}>Adicionar{sel.size ? ` ${sel.size}` : ''}</button>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
                {result.map(c => { const on = sel.has(c.id); const elsewhere = linked.has(c.id); return (
                  <div key={c.id} onClick={() => toggleSel(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--bg)', background: on ? 'rgba(59,130,246,0.16)' : elsewhere ? 'rgba(251,191,36,0.12)' : 'var(--panel)' }}>
                    <input type="checkbox" checked={on} readOnly />
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', minWidth: 90 }}>{c.codigo}</span>
                    {(c as any).plano && <span style={{ fontSize: 10, color: 'var(--blue)', background: 'rgba(59,130,246,0.16)', borderRadius: 4, padding: '1px 5px' }}>{(c as any).plano}</span>}
                    <span style={{ flex: 1, color: elsewhere ? '#b08900' : undefined }}>{c.descricao}</span>
                    {elsewhere && <span title="já amarrada em outra linha" style={{ fontSize: 10, color: '#b08900', background: 'rgba(251,191,36,0.14)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>já amarrada</span>}
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
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [contaModal, setContaModal] = useState<any | null>(null)

  const HEADERS = ['codigo', 'descricao', 'natureza']
  const EXEMPLO = ['2', 'DESPESAS', 'DESPESA']
  // indentação só visual, derivada do próprio código (1 · 1.1 · 1.1.1). A estrutura real vive no relatório.
  const depthCod = (cod: string) => Math.max(0, String(cod || '').split('.').length - 1)
  const COLS = [
    { key: 'codigo', placeholder: 'Código' },
    { key: 'descricao', placeholder: 'Descrição' },
    { key: 'natureza', placeholder: 'Natureza', type: 'select' as const, options: NATUREZAS },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('conta_orcamentaria').select('*').order('codigo'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => { load() }, [])
  const filtered = (filtraBusca(data, busca, c => `${c.codigo} ${c.descricao} ${c.natureza || ''}`) as any[])
    .slice().sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), undefined, { numeric: true }))

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.codigo || !v.descricao) { setErro('Código e descrição são obrigatórios'); return }
    setErro(null)
    const payload: any = { codigo: v.codigo.trim(), descricao: v.descricao.trim(), natureza: v.natureza || 'NEUTRO' }
    const { error } = id
      ? await supabase.from('conta_orcamentaria').update(payload).eq('id', id)   // preserva tipo_linha/pai_id existentes
      : await supabase.from('conta_orcamentaria').insert({ tenant_id: TENANT_ID, tipo_linha: 'ANALITICA', ...payload })
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
        natureza: (col(r, 'natureza', 'Natureza', 'NATUREZA') || '').toUpperCase(),
      })).filter(r => r.codigo && r.descricao)
      const unicos = dedupe(base, r => r.codigo)
      const normNat = (n: string) => (['RECEITA', 'DESPESA', 'NEUTRO'].includes(n) ? n : 'NEUTRO')
      const payload = unicos.map(r => ({ tenant_id: TENANT_ID, codigo: r.codigo, descricao: r.descricao, natureza: normNat(r.natureza) }))
      const { error: e1 } = await supabase.from('conta_orcamentaria').upsert(payload, { onConflict: 'tenant_id,codigo', ignoreDuplicates: false })
      if (e1) { setErro(e1.message); setInfo(null); return }
      setInfo(`${unicos.length} contas importadas.`)
      load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('estrutura_orcamentaria', HEADERS, data.map(c => [c.codigo, c.descricao, c.natureza || '']))

  return (
    <div style={S.card}>
      <Toolbar modelo={() => baixarModelo('estrutura_orcamentaria', HEADERS, EXEMPLO)} onImport={importar} onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }} busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length} />
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Código</th><th style={S.th}>Descrição</th><th style={S.th}>Natureza</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {data.length === 0 && !adding && <tr><td colSpan={4} style={S.empty}>Estrutura vazia.<br /><small>Importe as contas (código + descrição) ou rode a migração F1.</small></td></tr>}
          {data.length > 0 && filtered.length === 0 && <tr><td colSpan={4} style={S.empty}>Nenhum resultado para a busca.</td></tr>}
          {filtered.map(c => editId === c.id ? (
            <AddRow key={c.id} cols={COLS} initial={{ codigo: c.codigo, descricao: c.descricao, natureza: c.natureza || 'NEUTRO' }} onSave={v => save(v, c.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={c.id}>
              <td style={S.tdMono}>{c.codigo}</td>
              <td style={S.td}>
                <div style={{ paddingLeft: depthCod(c.codigo) * 18 }}>
                  <span style={{ fontWeight: depthCod(c.codigo) === 0 ? 600 : 400 }}>{c.descricao}</span>
                </div>
              </td>
              <td style={{ ...S.td, fontSize: 12, color: 'var(--muted)' }}>{c.natureza || '—'}</td>
              <td style={{ ...S.td, width: 100, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--blue)' }} title="Contas (DE-PARA do realizado)" onClick={() => setContaModal(c)}><Link2 size={14} /></button>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(c.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
              <td style={{ ...S.td, color: 'var(--muted)' }}>{p.conta_contabil?.[0]?.count ?? 0}</td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(p.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
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
// ─── LotesTab (lotes contábeis a ignorar nos comparativos) ────
function LotesTab() {
  const [data, setData] = useState<any[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [sugAno, setSugAno] = useState<number>(new Date().getFullYear())
  const [sug, setSug] = useState<any[] | null>(null)
  const [sugBusy, setSugBusy] = useState(false)
  const [histTermo, setHistTermo] = useState('ENCERRAMENTO, EXERC, APURACAO, APURAÇÃO, RESULTADO DO EXERC')
  const [sugH, setSugH] = useState<any[] | null>(null)
  const [sugHBusy, setSugHBusy] = useState(false)

  const HEADERS = ['lote', 'por_prefixo', 'sublote', 'empresa_codigo', 'descricao', 'ativo', 'pular_import']
  const EXEMPLO = ['Q', 'SIM', '', '', 'Lotes de fechamento (começam com Q)', 'SIM', 'SIM']
  const empCod = (id: string) => empresas.find(e => e.id === id)?.codigo || ''
  const COLS = [
    { key: 'lote', placeholder: 'Lote' },
    { key: 'por_prefixo', placeholder: 'Prefixo?', type: 'select' as const, options: [{ value: '1', label: 'Sim (começa com)' }] },
    { key: 'sublote', placeholder: 'Sublote (opcional)' },
    { key: 'empresa_id', placeholder: 'Empresa', type: 'select' as const, options: empresas.map(e => ({ value: e.id, label: `${e.codigo} · ${e.descricao}` })) },
    { key: 'descricao', placeholder: 'Descrição' },
  ]

  const load = async () => {
    try { setData(await fetchAll(() => supabase.from('lote_ignorado').select('*, empresa(codigo,descricao)').order('lote'))) }
    catch (e: any) { setErro(String(e)) }
  }
  useEffect(() => {
    load()
    fetchAll(() => supabase.from('empresa').select('id,codigo,descricao').order('codigo')).then(setEmpresas)
  }, [])
  const filtered = filtraBusca(data, busca, l => `${l.lote} ${l.sublote || ''} ${empCod(l.empresa_id)} ${l.descricao || ''}`)

  const save = async (v: Record<string, string>, id?: string) => {
    if (!v.lote) { setErro('Lote é obrigatório'); return }
    setErro(null)
    const payload = { lote: v.lote.trim(), por_prefixo: !!v.por_prefixo, sublote: v.sublote?.trim() || null, empresa_id: v.empresa_id || null, descricao: v.descricao?.trim() || null }
    const { error } = id
      ? await supabase.from('lote_ignorado').update(payload).eq('id', id)
      : await supabase.from('lote_ignorado').insert({ tenant_id: TENANT_ID, ...payload, ativo: true, pular_import: false })
    if (error) { setErro(error.message); return }
    setAdding(false); setEditId(null); load()
  }

  const del = async (id: string) => {
    if (!confirm('Excluir este lote do cadastro?')) return
    const { error } = await supabase.from('lote_ignorado').delete().eq('id', id)
    if (error) setErro(error.message); else load()
  }

  const toggle = async (l: any, campo: 'ativo' | 'pular_import' | 'por_prefixo') => {
    const { error } = await supabase.from('lote_ignorado').update({ [campo]: !l[campo] }).eq('id', l.id)
    if (error) setErro(error.message); else load()
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const rows = await parseXlsx(file)
      if (!rows.length) { setErro('Arquivo vazio'); setInfo(null); return }
      const empByCod: Record<string, string> = {}; empresas.forEach(e => { empByCod[String(e.codigo).toUpperCase()] = e.id })
      const sim = (s: string) => ['SIM', 'S', 'TRUE', '1', 'X'].includes(s.trim().toUpperCase())
      const registros = rows.map(r => ({
        tenant_id: TENANT_ID,
        lote: col(r, 'lote', 'LOTE'),
        por_prefixo: sim(col(r, 'por_prefixo', 'prefixo', 'PREFIXO')),
        sublote: col(r, 'sublote', 'SUBLOTE') || null,
        empresa_id: empByCod[col(r, 'empresa_codigo', 'empresa', 'EMPRESA').toUpperCase()] || null,
        descricao: col(r, 'descricao', 'Descrição', 'DESCRICAO') || null,
        ativo: parseAtivo(col(r, 'ativo', 'Ativo', 'ATIVO')),
        pular_import: sim(col(r, 'pular_import', 'pular', 'PULAR')),
      })).filter(r => r.lote)
      const { error } = await supabase.from('lote_ignorado').upsert(registros, { onConflict: 'tenant_id,lote,sublote,empresa_id', ignoreDuplicates: false })
      if (error) { setErro(error.message); setInfo(null); return }
      setInfo(`${registros.length} lote(s) importado(s).`); load()
    } catch (e: any) { setErro(String(e)); setInfo(null) }
  }

  const exportar = () => exportarDados('lotes_ignorados', HEADERS, data.map(l => [l.lote, l.por_prefixo ? 'SIM' : 'NAO', l.sublote || '', empCod(l.empresa_id), l.descricao || '', l.ativo ? 'SIM' : 'NAO', l.pular_import ? 'SIM' : 'NAO']))

  const sugerir = async () => {
    setSugBusy(true); setErro(null)
    const { data: cand, error } = await supabase.rpc('lotes_candidatos_encerramento', { p_ano: sugAno || null })
    setSugBusy(false)
    if (error) { setErro(error.message); return }
    const existe = new Set(data.filter(l => l.por_prefixo).map(l => String(l.lote).toUpperCase()))
    setSug((cand || []).filter((c: any) => !existe.has(String(c.prefixo).toUpperCase())))
  }
  const regraDe = (c: any) => ({ tenant_id: TENANT_ID, lote: c.prefixo, por_prefixo: true, sublote: null, empresa_id: null, descricao: `Fechamento (lotes "${c.prefixo}…")`, ativo: true, pular_import: false })
  const addSug = async (c: any) => {
    const { error } = await supabase.from('lote_ignorado').insert(regraDe(c))
    if (error) { setErro(error.message); return }
    setSug(s => s ? s.filter(x => x !== c) : s); load()
  }
  const addTodos = async () => {
    if (!sug?.length) return
    const { error } = await supabase.from('lote_ignorado').upsert(sug.map(regraDe), { onConflict: 'tenant_id,lote,sublote,empresa_id', ignoreDuplicates: true })
    if (error) { setErro(error.message); return }
    setSug([]); load()
  }

  // sugestão por HISTÓRICO (ENCERRAMENTO, EXERC, APURACAO...)
  const buscarHist = async () => {
    const termos = histTermo.split(',').map(s => s.trim()).filter(Boolean)
    if (!termos.length) return
    setSugHBusy(true); setErro(null)
    const { data: cand, error } = await supabase.rpc('lotes_por_historico', { p_termos: termos, p_ano: sugAno || null })
    setSugHBusy(false)
    if (error) { setErro(error.message); return }
    const jaTem = new Set(data.filter(l => !l.por_prefixo).map(l => String(l.lote).toUpperCase()))
    setSugH((cand || []).filter((c: any) => !jaTem.has(String(c.lote).toUpperCase())))
  }
  const regraHist = (c: any) => ({ tenant_id: TENANT_ID, lote: c.lote, por_prefixo: false, sublote: null, empresa_id: null, descricao: 'Encerramento (por histórico)', ativo: true, pular_import: false })
  const addSugH = async (c: any) => {
    const { error } = await supabase.from('lote_ignorado').insert(regraHist(c))
    if (error) { setErro(error.message); return }
    setSugH(s => s ? s.filter(x => x !== c) : s); load()
  }
  const addTodosH = async () => {
    if (!sugH?.length) return
    const { error } = await supabase.from('lote_ignorado').upsert(sugH.map(regraHist), { onConflict: 'tenant_id,lote,sublote,empresa_id', ignoreDuplicates: true })
    if (error) { setErro(error.message); return }
    setSugH([]); load()
  }

  // aplica as regras ATIVAS aos dados: apaga do fat_realizado os lançamentos casados + recalcula
  const [aplBusy, setAplBusy] = useState(false)
  const aplicarDados = async () => {
    if (!confirm('Excluir do REALIZADO (fat_realizado) todos os lançamentos que casam com as regras ATIVAS deste cadastro?\n\nAção irreversível — para recuperar seria preciso reimportar. Em seguida os agregados são recalculados.')) return
    setAplBusy(true); setErro(null); setInfo('Excluindo lançamentos dos lotes ignorados…')
    const { data: n, error } = await supabase.rpc('excluir_lotes_ignorados')
    if (error) { setErro(error.message); setInfo(null); setAplBusy(false); return }
    setInfo('Recalculando agregados…')
    const { error: e2 } = await supabase.rpc('refresh_realizado_mensal')
    setAplBusy(false)
    if (e2) { setErro('Excluiu, mas falhou ao recalcular: ' + e2.message); return }
    setInfo(`${Number(n || 0).toLocaleString('pt-BR')} lançamento(s) excluído(s) do realizado e agregados recalculados.`)
  }

  const fmt = (n: number) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const togBadge = (on: boolean): CSSProperties => ({ cursor: 'pointer', border: 'none', display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: on ? 'rgba(52,211,153,0.12)' : 'var(--panel)', color: on ? 'var(--green)' : 'var(--muted)' })

  return (
    <div style={S.card}>
      <Toolbar
        modelo={() => baixarModelo('lotes_ignorados', HEADERS, EXEMPLO)}
        onImport={importar}
        onExport={exportar}
        onAdd={() => { setAdding(true); setErro(null); setInfo(null) }}
        busca={busca} onBusca={setBusca} total={data.length} mostrando={filtered.length}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--panel)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Lotes que zeram contas de resultado (encerramento/apuração) são excluídos dos comparativos por movimento. Após alterar aqui, clique em <strong>Recalcular</strong> na tela Realizado para os relatórios refletirem.</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>Ano (0 = todos)</span>
        <input type="number" style={{ ...S.input, width: 90 }} value={sugAno} onChange={e => setSugAno(+e.target.value)} />
        <button style={S.btnImp} onClick={sugerir} disabled={sugBusy}>{sugBusy ? 'Analisando…' : 'Sugerir por prefixo'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--panel)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Buscar lotes por <strong>histórico</strong> (termos separados por vírgula; use raízes p/ pegar variações):</span>
        <input style={{ ...S.input, flex: 1, minWidth: 240 }} value={histTermo} onChange={e => setHistTermo(e.target.value)} placeholder="ENCERRAMENTO, EXERC, APURACAO" />
        <button style={S.btnImp} onClick={buscarHist} disabled={sugHBusy}>{sugHBusy ? 'Buscando…' : 'Buscar por histórico'}</button>
        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <button style={{ ...S.btnImp, color: 'var(--red)', borderColor: 'rgba(248,113,113,0.35)' }} onClick={aplicarDados} disabled={aplBusy} title="Apaga do fat_realizado os lançamentos que casam com as regras ativas e recalcula">
          <Trash2 size={13} /> {aplBusy ? 'Aplicando…' : 'Aplicar aos dados'}
        </button>
      </div>
      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}

      {sug !== null && (
        <div style={{ margin: '0 16px 12px', border: '1px solid var(--orange)', background: 'rgba(251,191,36,0.12)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: 'var(--orange)' }}>Lotes com prefixo de letra{sugAno ? ` em ${sugAno}` : ''} (convenção de fechamento, ex. "Q")</strong>
            <div style={{ flex: 1 }} />
            {!!sug.length && <button style={{ ...S.btnAdd, padding: '4px 10px' }} onClick={addTodos}>Adicionar todos</button>}
            <button style={S.btnDel} onClick={() => setSug(null)}><X size={15} /></button>
          </div>
          {sug.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nenhum lote com prefixo de letra encontrado (já cadastrado ou inexistente).</div> : (
            <table style={S.table}>
              <thead><tr><th style={S.th}>Prefixo</th><th style={S.th}>Exemplos</th><th style={{ ...S.th, textAlign: 'right' }}>Linhas</th><th style={{ ...S.th, textAlign: 'right' }}>Líquido</th><th style={{ ...S.th, textAlign: 'right' }}>Bruto</th><th style={S.th}>Meses</th><th style={S.th}></th></tr></thead>
              <tbody>
                {sug.map((c, i) => (
                  <tr key={i}>
                    <td style={{ ...S.tdMono, fontWeight: 600 }}>{c.prefixo}…</td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.exemplos}>{c.exemplos}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{c.linhas}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmt(c.soma)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmt(c.bruto)}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{c.meses}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}><button style={{ ...S.btnAdd, padding: '3px 9px' }} onClick={() => addSug(c)}><Plus size={13} /> Add</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {sugH !== null && (
        <div style={{ margin: '0 16px 12px', border: '1px solid var(--orange)', background: 'rgba(251,191,36,0.12)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 13, color: 'var(--orange)' }}>Lotes com histórico de fechamento{sugAno ? ` em ${sugAno}` : ''}</strong>
            <div style={{ flex: 1 }} />
            {!!sugH.length && <button style={{ ...S.btnAdd, padding: '4px 10px' }} onClick={addTodosH}>Adicionar todos</button>}
            <button style={S.btnDel} onClick={() => setSugH(null)}><X size={15} /></button>
          </div>
          {sugH.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Nenhum lote encontrado com esses termos (ou já cadastrados).</div> : (
            <table style={S.table}>
              <thead><tr><th style={S.th}>Lote</th><th style={S.th}>Exemplos de histórico</th><th style={{ ...S.th, textAlign: 'right' }}>Linhas</th><th style={{ ...S.th, textAlign: 'right' }}>Líquido</th><th style={{ ...S.th, textAlign: 'right' }}>Bruto</th><th style={S.th}>Meses</th><th style={S.th}></th></tr></thead>
              <tbody>
                {sugH.map((c, i) => (
                  <tr key={i}>
                    <td style={{ ...S.tdMono, fontWeight: 600 }}>{c.lote}</td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.exemplos}>{c.exemplos}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{c.n}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmt(c.soma)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmt(c.bruto)}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{c.meses}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}><button style={{ ...S.btnAdd, padding: '3px 9px' }} onClick={() => addSugH(c)}><Plus size={13} /> Add</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>Lote</th><th style={S.th}>Prefixo</th><th style={S.th}>Sublote</th><th style={S.th}>Empresa</th><th style={S.th}>Descrição</th>
          <th style={S.th}>Excluir consulta</th><th style={S.th}>Pular import</th><th style={S.th}></th>
        </tr></thead>
        <tbody>
          {adding && <AddRow cols={COLS} onSave={save} onCancel={() => setAdding(false)} />}
          {filtered.length === 0 && !adding && <tr><td colSpan={8} style={S.empty}>{busca ? 'Nenhum resultado para a busca.' : <>Nenhum lote cadastrado.<br /><small>Use "Sugerir fechamento" ou adicione manualmente.</small></>}</td></tr>}
          {filtered.map(l => editId === l.id ? (
            <AddRow key={l.id} cols={COLS} initial={{ lote: l.lote, por_prefixo: l.por_prefixo ? '1' : '', sublote: l.sublote || '', empresa_id: l.empresa_id || '', descricao: l.descricao || '' }} onSave={v => save(v, l.id)} onCancel={() => setEditId(null)} />
          ) : (
            <tr key={l.id}>
              <td style={S.tdMono}>{l.lote}{l.por_prefixo ? '…' : ''}</td>
              <td style={S.td}><button style={togBadge(l.por_prefixo)} onClick={() => toggle(l, 'por_prefixo')} title="Casar por início do código (começa com)">{l.por_prefixo ? 'Sim' : 'Não'}</button></td>
              <td style={S.tdMono}>{l.sublote || '—'}</td>
              <td style={S.td}>{empCod(l.empresa_id) || <span style={{ color: 'var(--muted)' }}>todas</span>}</td>
              <td style={S.td}>{l.descricao || '—'}</td>
              <td style={S.td}><button style={togBadge(l.ativo)} onClick={() => toggle(l, 'ativo')} title="Excluir nos comparativos">{l.ativo ? 'Sim' : 'Não'}</button></td>
              <td style={S.td}><button style={togBadge(l.pular_import)} onClick={() => toggle(l, 'pular_import')} title="Nem importar as linhas deste lote">{l.pular_import ? 'Sim' : 'Não'}</button></td>
              <td style={{ ...S.td, width: 70, whiteSpace: 'nowrap' }}>
                <button style={{ ...S.btnDel, color: 'var(--muted)' }} title="Editar" onClick={() => { setEditId(l.id); setAdding(false); setErro(null) }}><Pencil size={14} /></button>
                <button style={S.btnDel} title="Excluir" onClick={() => del(l.id)}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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
  { id: 'lotes',        label: 'Lotes Ignorados' },
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
      {aba === 'lotes'        && <LotesTab />}
    </div>
  )
}
