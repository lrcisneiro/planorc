import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { Upload, Download, FileDown, AlertCircle, RefreshCw, Trash2, X, Filter } from 'lucide-react'
import { useGrid, GridHead } from '../../lib/grid'
import type { GCol } from '../../lib/grid'

declare const XLSX: any

type Empresa = { id: string; codigo: string; descricao: string }

const ANOS = [2024, 2025, 2026, 2027, 2028]
const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Colunas do modelo de importação (razão / lançamentos)
const HEADERS = ['empresa_codigo', 'filial_codigo', 'cc_codigo', 'conta_codigo', 'data', 'ano', 'mes', 'documento', 'historico', 'debito', 'credito', 'lote', 'sublote']
const EXEMPLO = [
  ['01', '2001', '111', '3.1.01.001', '15/01/2026', '', '', 'NF 123', 'Energia elétrica', 1500, 0, '008850', '001'],
  ['01', '2001', '', '4.1.01.001', '20/01/2026', '', '', 'NF 456', 'Receita de serviços', 0, 28000, '008850', '001'],
]

const S: Record<string, CSSProperties> = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' },
  header:  { marginBottom: 16 },
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:     { fontSize: 13, color: '#868e96', margin: '4px 0 0' },
  bar:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  sel:     { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  spacer:  { flex: 1 },
  btn:     { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  card:    { background: 'white', borderRadius: 10, border: '1px solid #e9ecef', overflow: 'hidden' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', padding: '9px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef', position: 'sticky', top: 0 },
  thR:     { textAlign: 'right', padding: '9px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td:      { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', whiteSpace: 'nowrap' },
  tdR:     { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', textAlign: 'right' },
  mono:    { fontFamily: 'monospace', fontSize: 12, color: '#868e96' },
  empty:   { padding: '40px 24px', textAlign: 'center', color: '#aaa', fontSize: 13 },
  erro:    { display: 'flex', alignItems: 'center', gap: 8, background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#c92a2a', fontSize: 13 },
  info:    { display: 'flex', alignItems: 'center', gap: 8, background: '#e7f5ff', border: '1px solid #a5d8ff', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#1971c2', fontSize: 13 },
}

function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Realizado')
  XLSX.writeFile(wb, filename)
}
function downloadSheets(filename: string, abas: { nome: string; aoa: any[][] }[]) {
  const wb = XLSX.utils.book_new()
  for (const a of abas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a.aoa), a.nome.slice(0, 31))
  XLSX.writeFile(wb, filename)
}
// Colunas que esperamos encontrar no cabeçalho (para detectar a linha de header)
const HEADER_HINTS = ['conta', 'debito', 'débito', 'credito', 'crédito', 'empresa', 'filial', 'historico', 'histórico', 'data', 'ano', 'mes', 'mês', 'cc', 'documento', 'valor']

// Converte uma aba em objetos, detectando a linha de cabeçalho (pula títulos acima dela)
function objectsFromSheet(ws: any): any[] {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as any[][]
  if (!aoa.length) return []
  const isHint = (s: string) => HEADER_HINTS.some(h => s.includes(h))
  let hr = -1
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const cells = (aoa[i] || []).map(c => String(c).trim().toLowerCase())
    const nonEmpty = cells.filter(Boolean).length
    if (nonEmpty >= 2 && cells.some(isHint)) { hr = i; break }
  }
  if (hr < 0) for (let i = 0; i < aoa.length; i++) { if ((aoa[i] || []).filter(c => String(c).trim()).length >= 2) { hr = i; break } }
  if (hr < 0) return []
  const headers = (aoa[hr] || []).map(c => String(c).trim())
  const out: any[] = []
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i] || []
    if (!row.some(c => String(c).trim() !== '')) continue
    const obj: any = {}
    headers.forEach((h, j) => { if (h) obj[h] = row[j] })
    out.push(obj)
  }
  return out
}

function readWorkbook(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = new Uint8Array(e.target?.result as ArrayBuffer)
        resolve(XLSX.read(buf, { type: 'array', cellDates: true, dense: true }))
      } catch (err) { reject(err) }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo (muito grande?). Tente dividir por mês.'))
    reader.readAsArrayBuffer(file)
  })
}

// Varre TODAS as abas e escolhe a que tem mais linhas de dados
async function parseXlsx(file: File): Promise<{ rows: any[]; sheet: string; sheets: string[] }> {
  const wb = await readWorkbook(file)
  const sheets: string[] = wb.SheetNames || []
  let best: any[] = [], bestName = ''
  for (const name of sheets) {
    const objs = objectsFromSheet(wb.Sheets[name])
    if (objs.length > best.length) { best = objs; bestName = name }
  }
  return { rows: best, sheet: bestName, sheets }
}
function rawCol(row: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return ''
}
function txt(row: any, ...keys: string[]): string {
  const v = rawCol(row, ...keys)
  return v === '' ? '' : String(v).trim()
}
function num(v: any): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  return parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0
}
// Competência: usa colunas ano+mes, senão deriva de uma data (Date, serial Excel ou texto dd/mm/aaaa).
function competencia(row: any): { ano: number; mes: number; dataISO: string | null } | null {
  const anoC = parseInt(txt(row, 'ano', 'ANO'), 10)
  const mesC = parseInt(txt(row, 'mes', 'MES'), 10)
  const raw = rawCol(row, 'data', 'Data', 'competencia', 'Competência', 'dt', 'DT')
  let d: Date | null = null
  if (raw instanceof Date) d = raw
  else if (typeof raw === 'number') d = new Date(Math.round((raw - 25569) * 86400 * 1000))
  else if (typeof raw === 'string') {
    let m = raw.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (m) { const yy = m[3].length === 2 ? 2000 + +m[3] : +m[3]; d = new Date(yy, +m[2] - 1, +m[1]) }
    else { m = raw.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (m) d = new Date(+m[1], +m[2] - 1, +m[3]) }
  }
  const ano = anoC || (d ? d.getFullYear() : 0)
  const mes = mesC || (d ? d.getMonth() + 1 : 0)
  if (!ano || !mes || mes < 1 || mes > 12) return null
  const dataISO = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
  return { ano, mes, dataISO }
}

export default function RealizadoDadosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [ano, setAno] = useState(2026)
  const [mes, setMes] = useState(0) // 0 = todos
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [modo, setModo] = useState<'add' | 'full'>('add')
  const [importOpen, setImportOpen] = useState(false)
  const [dropFiles, setDropFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [impBusy, setImpBusy] = useState(false)
  const [impProg, setImpProg] = useState('')
  const [impLog, setImpLog] = useState<string[]>([])
  const [logXlsx, setLogXlsx] = useState<{ arq: any[][]; ign: any[][] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [ccFaltOpen, setCcFaltOpen] = useState(false)
  const [ccFaltBusy, setCcFaltBusy] = useState(false)
  const [ccFalt, setCcFalt] = useState<{ cc: string; n: number; valor: number; contas: string[] }[]>([])
  const [ccFaltCap, setCcFaltCap] = useState(false)
  const [ccFaltDet, setCcFaltDet] = useState<any[]>([])

  useEffect(() => {
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
  }, [])

  const GRID: GCol[] = [
    { key: 'mes', label: 'Mês', align: 'right', get: r => r.mes },
    { key: 'empresa', label: 'Empresa', get: r => r.empresa?.codigo || '' },
    { key: 'data', label: 'Data', get: r => r.data || '' },
    { key: 'plano', label: 'Plano', get: r => r.conta_contabil?.plano_contas?.codigo || '' },
    { key: 'conta', label: 'Conta', get: r => r.conta_contabil?.codigo || '' },
    { key: 'contaDesc', label: 'Descrição conta', get: r => r.conta_contabil?.descricao || '' },
    { key: 'filial', label: 'Filial', get: r => r.filial?.codigo || '' },
    { key: 'cc', label: 'CC', get: r => r.centro_custo?.codigo || '' },
    { key: 'documento', label: 'Documento', get: r => r.documento || '' },
    { key: 'historico', label: 'Histórico', get: r => r.historico || '' },
    { key: 'debito', label: 'Débito', align: 'right', get: r => r.debito != null ? Number(r.debito) : null },
    { key: 'credito', label: 'Crédito', align: 'right', get: r => r.credito != null ? Number(r.credito) : null },
    { key: 'valor', label: 'Valor', align: 'right', get: r => Number(r.valor) },
    { key: 'lote', label: 'Lote', get: r => r.lote ? `${r.lote}${r.sublote ? '/' + r.sublote : ''}` : '' },
    { key: 'origem', label: 'Origem', get: r => r.origem || '' },
  ]
  const grid = useGrid(rows, GRID)

  const load = async () => {
    setLoading(true); setErro(null)
    const cf = grid.cf
    const f = (k: string) => (cf[k] || '').trim()
    const like = (v: string) => `%${v}%`
    // filtros de coluna que vão ao banco (joins com !inner quando filtrados)
    const sel = `id,ano,mes,data,documento,historico,debito,credito,dc,valor,origem,lote,sublote,`
      + ` empresa${f('empresa') ? '!inner' : ''}(codigo),`
      + ` conta_contabil${(f('conta') || f('contaDesc')) ? '!inner' : ''}(codigo,descricao, plano_contas(codigo)),`
      + ` filial${f('filial') ? '!inner' : ''}(codigo),`
      + ` centro_custo${f('cc') ? '!inner' : ''}(codigo)`
    let q = supabase.from('fat_realizado').select(sel).eq('ano', ano)
      .order('mes').order('data', { nullsFirst: true }).limit(2000)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    if (mes) q = q.eq('mes', mes)
    if (f('mes') && !isNaN(+f('mes'))) q = q.eq('mes', +f('mes'))
    if (f('documento')) q = q.ilike('documento', like(f('documento')))
    if (f('historico')) q = q.ilike('historico', like(f('historico')))
    if (f('lote')) q = q.ilike('lote', like(f('lote')))
    if (f('origem')) q = q.ilike('origem', like(f('origem')))
    if (f('cc')) q = q.ilike('centro_custo.codigo', like(f('cc')))
    if (f('conta')) q = q.ilike('conta_contabil.codigo', like(f('conta')))
    if (f('contaDesc')) q = q.ilike('conta_contabil.descricao', like(f('contaDesc')))
    if (f('filial')) q = q.ilike('filial.codigo', like(f('filial')))
    if (f('empresa')) q = q.ilike('empresa.codigo', like(f('empresa')))
    const { data, error } = await q
    if (error) setErro(error.message)
    else setRows((data as any[]) || [])
    setLoading(false)
  }
  // recarrega ao mudar período/empresa ou os filtros de coluna (server-side, com debounce)
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [empresaId, ano, mes, JSON.stringify(grid.cf)]) // eslint-disable-line

  // CCs faltando: lançamentos de conta RECEITA/DESPESA com cc_id nulo (CC obrigatório). Agrupa pelo código original (dims.cc_orig).
  const CAP = 20000
  const buscarCcFaltando = async () => {
    setCcFaltOpen(true); setCcFaltBusy(true); setCcFalt([]); setCcFaltCap(false); setCcFaltDet([])
    let q = supabase.from('fat_realizado')
      .select('ano,mes,data,documento,historico,debito,credito,valor,lote,sublote,dims, empresa(codigo), conta_contabil!inner(codigo,descricao,natureza)')
      .is('cc_id', null).eq('ano', ano)
      .in('conta_contabil.natureza', ['RECEITA', 'DESPESA']).order('mes').limit(CAP)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    const { data, error } = await q
    if (error) { setErro(error.message); setCcFaltBusy(false); return }
    const rows = (data as any[]) || []
    const m = new Map<string, { n: number; valor: number; contas: Set<string> }>()
    for (const r of rows) {
      const cc = (r.dims && (r.dims.cc_orig || r.dims.cc)) || '(sem CC no arquivo)'
      const g = m.get(cc) || { n: 0, valor: 0, contas: new Set<string>() }
      g.n++; g.valor += Number(r.valor) || 0; if (r.conta_contabil?.codigo) g.contas.add(r.conta_contabil.codigo)
      m.set(cc, g)
    }
    const out = [...m.entries()].map(([cc, g]) => ({ cc, n: g.n, valor: g.valor, contas: [...g.contas].sort() })).sort((a, b) => b.n - a.n)
    setCcFalt(out); setCcFaltDet(rows); setCcFaltCap(rows.length >= CAP); setCcFaltBusy(false)
  }
  const baixarCcFaltando = () => {
    const aoa = [['CC (orig)', 'Empresa', 'Conta', 'Descrição conta', 'Natureza', 'Ano', 'Mês', 'Data', 'Documento', 'Histórico', 'Débito', 'Crédito', 'Valor', 'Lote', 'Sublote'],
      ...ccFaltDet.map(r => [
        (r.dims && (r.dims.cc_orig || r.dims.cc)) || '(sem CC)', r.empresa?.codigo || '', r.conta_contabil?.codigo || '', r.conta_contabil?.descricao || '', r.conta_contabil?.natureza || '',
        r.ano, r.mes, r.data || '', r.documento || '', r.historico || '', r.debito ?? '', r.credito ?? '', r.valor ?? '', r.lote || '', r.sublote || '',
      ])]
    downloadSheets('cc_faltando_realizado.xlsx', [{ nome: 'CCs faltando', aoa }])
  }

  const exportar = () => {
    const empCod = empresas.find(e => e.id === empresaId)?.codigo || ''
    const aoa = [HEADERS, ...rows.map(r => [
      empCod, r.filial?.codigo || '', r.centro_custo?.codigo || '', r.conta_contabil?.codigo || '',
      r.data || '', r.ano, r.mes, r.documento || '', r.historico || '',
      r.debito ?? '', r.credito ?? '', r.lote || '', r.sublote || '',
    ])]
    downloadSheet('realizado.xlsx', aoa)
  }

  // Limpa o realizado (todos os anos/meses). Escopo: empresa selecionada, ou TODAS se nenhuma.
  const limpar = async () => {
    const empCod = empresas.find(e => e.id === empresaId)?.codigo
    const escopo = empresaId ? `da empresa ${empCod}` : 'de TODAS as empresas'
    if (!confirm(`Excluir TODO o realizado ${escopo} (todos os anos e meses)?\n\nIsto NÃO afeta orçado nem balancete. Use para reimportar do zero. Ação irreversível.`)) return
    setLoading(true); setErro(null); setInfo(null)
    let q = supabase.from('fat_realizado').delete().gte('ano', 0)
    if (empresaId) q = q.eq('empresa_id', empresaId)
    const { error } = await q
    await supabase.rpc('refresh_realizado_mensal')
    setLoading(false)
    if (error) { setErro(error.message); return }
    setInfo(`Realizado ${escopo} excluído. Pode reimportar.`); load()
  }

  // Recalcula o rollup mensal (agregados que alimentam DRE/dashboards)
  const recalcular = async () => {
    setLoading(true); setErro(null); setInfo('Re-vinculando CCs órfãos…')
    const { data: nrel, error: e1 } = await supabase.rpc('revincular_cc_orfaos')
    if (e1) { setLoading(false); setErro(e1.message); return }
    setInfo(`Recalculando agregados…${nrel ? ` (${Number(nrel).toLocaleString('pt-BR')} lançamento(s) re-vinculados a CC)` : ''}`)
    const { error } = await supabase.rpc('refresh_realizado_mensal')
    setLoading(false)
    if (error) setErro(error.message)
    else setInfo(`Agregados recalculados.${nrel ? ` ${Number(nrel).toLocaleString('pt-BR')} lançamento(s) re-vinculados a CC.` : ''}`)
  }

  const importarLote = async (files: File[]) => {
    if (!files.length) return
    setImpBusy(true); setImpLog([]); setImpProg('Carregando cadastros…')
    try {
      const [{ data: contas }, { data: emps }, { data: fis }, { data: cc }] = await Promise.all([
        supabase.from('conta_contabil').select('id,codigo,plano_id,natureza'),
        supabase.from('empresa').select('id,codigo,plano_id'),
        supabase.from('filial').select('id,codigo'),
        supabase.from('centro_custo').select('id,codigo'),
      ])
      const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()
      const contaMap: Record<string, string> = {}; (contas || []).forEach((c: any) => { contaMap[`${c.plano_id}|${norm(c.codigo)}`] = c.id })
      const contaNat: Record<string, string> = {}; (contas || []).forEach((c: any) => { contaNat[c.id] = c.natureza || '' })
      const ccObrig = (cid: string | undefined) => cid != null && (contaNat[cid] === 'RECEITA' || contaNat[cid] === 'DESPESA')   // CC obrigatório
      const ccFaltando = new Map<string, number>()   // código do CC faltando → nº de lançamentos (conta receita/despesa)
      const empMap: Record<string, string> = {}; (emps || []).forEach((e: any) => { empMap[norm(e.codigo)] = e.id })
      const empPlano: Record<string, string> = {}; (emps || []).forEach((e: any) => { empPlano[e.id] = e.plano_id })
      const filMap: Record<string, string> = {}; (fis || []).forEach((f: any) => { filMap[norm(f.codigo)] = f.id })
      const ccMap: Record<string, string> = {}; (cc || []).forEach((c: any) => { ccMap[norm(c.codigo)] = c.id })
      const empSelCod = empresas.find(e => e.id === empresaId)?.codigo || ''

      // lotes marcados para NÃO importar (pular_import). Casa por lote + sublote opcional + empresa opcional.
      const { data: lotesPular } = await supabase.from('lote_ignorado').select('lote,sublote,empresa_id,por_prefixo,ativo,pular_import').eq('pular_import', true)
      const pularRegras = (lotesPular || []) as { lote: string; sublote: string | null; empresa_id: string | null; por_prefixo: boolean }[]
      const devePular = (lote: string, sub: string, empId: string | undefined) =>
        !!lote && pularRegras.some(g =>
          (g.por_prefixo ? norm(lote).startsWith(norm(g.lote)) : norm(g.lote) === norm(lote)) &&
          (g.sublote == null || g.sublote === '' || norm(g.sublote) === norm(sub)) &&
          (g.empresa_id == null || g.empresa_id === empId))

      if (modo === 'full' && !confirm(`Modo SUBSTITUIR: para cada arquivo, o realizado das competências (empresa/ano/mês) do arquivo será EXCLUÍDO antes de inserir.\n\n${files.length} arquivo(s). Confirmar?`)) { setImpProg('Cancelado.'); setImpBusy(false); return }

      const log: string[] = []; let totIns = 0, totIgn = 0
      const faltaConta = new Set<string>(), faltaEmp = new Set<string>()
      const arqResumo: any[][] = []           // aba "Arquivos"
      const ignDet: any[][] = []              // aba "Ignorados" (detalhe)
      const CAP_IGN = 20000
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        setImpProg(`(${fi + 1}/${files.length}) Lendo ${file.name}…`)
        const { rows: raw } = await parseXlsx(file)
        if (!raw.length) { log.push(`⚠ ${file.name}: sem linhas`); setImpLog([...log]); arqResumo.push([file.name, 0, 0, 0]); continue }
        const inserts: any[] = []; const comboEmp: Record<string, Set<string>> = {}; let ign = 0
        for (const r of raw) {
          const contaCod = txt(r, 'conta_codigo', 'conta', 'CONTA', 'conta_contabil')
          const empCod = txt(r, 'empresa_codigo', 'empresa', 'EMPRESA') || empSelCod
          const empresa_id = empMap[norm(empCod)]
          const conta_id = empresa_id ? contaMap[`${empPlano[empresa_id]}|${norm(contaCod)}`] : undefined
          const comp = competencia(r)
          const deb = num(rawCol(r, 'debito', 'Débito', 'DEBITO'))
          const cre = num(rawCol(r, 'credito', 'Crédito', 'CREDITO'))
          const addIgn = (motivo: string) => { if (ignDet.length < CAP_IGN) ignDet.push([file.name, motivo, empCod, contaCod, txt(r, 'filial_codigo', 'filial', 'FILIAL'), txt(r, 'cc_codigo', 'cc', 'centro_custo'), String(rawCol(r, 'data', 'Data', 'DATA') ?? ''), txt(r, 'ano'), txt(r, 'mes'), txt(r, 'documento', 'doc', 'DOCUMENTO'), txt(r, 'historico', 'Histórico', 'HISTORICO'), deb, cre]) }
          if (!contaCod && !deb && !cre) { ign++; addIgn('linha em branco'); continue }
          if (!conta_id) { faltaConta.add(contaCod || '(vazio)'); ign++; addIgn('conta não encontrada'); continue }
          if (!empresa_id) { faltaEmp.add(empCod || '(vazio)'); ign++; addIgn('empresa não encontrada'); continue }
          if (!comp) { ign++; addIgn('sem competência (data/ano/mês)'); continue }
          if (!deb && !cre) { ign++; addIgn('sem valor (débito/crédito zerados)'); continue }
          const lote = txt(r, 'lote', 'LOTE')
          const sublote = txt(r, 'sublote', 'SUBLOTE', 'sub_lote')
          if (devePular(lote, sublote, empresa_id)) { ign++; addIgn(`lote ignorado (${lote}${sublote ? '/' + sublote : ''})`); continue }
          const filCod = txt(r, 'filial_codigo', 'filial', 'FILIAL')
          const ccCod = txt(r, 'cc_codigo', 'cc', 'centro_custo', 'CENTRO DE CUSTO')
          const cc_id = ccCod ? (ccMap[norm(ccCod)] || null) : null
          // CC é obrigatório em conta de receita/despesa → detecta os que faltam
          if (!cc_id && ccObrig(conta_id)) { const k = ccCod || '(sem CC)'; ccFaltando.set(k, (ccFaltando.get(k) || 0) + 1) }
          const valor = +(cre - deb).toFixed(2)
          inserts.push({
            tenant_id: TENANT_ID, linha_id: null, conta_id, empresa_id,
            filial_id: filCod ? (filMap[norm(filCod)] || null) : null,
            cc_id,
            ano: comp.ano, mes: comp.mes, data: comp.dataISO,
            documento: txt(r, 'documento', 'doc', 'DOCUMENTO') || null,
            historico: txt(r, 'historico', 'Histórico', 'HISTORICO') || null,
            debito: deb || null, credito: cre || null, dc: cre >= deb ? 'C' : 'D',
            lote: lote || null, sublote: sublote || null,
            valor, dims: (ccCod && !cc_id) ? { cc_orig: ccCod } : {}, origem: 'IMPORT',
          })
          const ck = `${comp.ano}-${comp.mes}`; (comboEmp[ck] ||= new Set()).add(empresa_id)
        }
        if (!inserts.length) { log.push(`⚠ ${file.name}: nenhuma linha válida (${ign} ignoradas)`); setImpLog([...log]); arqResumo.push([file.name, raw.length, 0, ign]); continue }
        if (modo === 'full') {
          for (const ck of Object.keys(comboEmp)) {
            const [a, m] = ck.split('-').map(Number)
            const { error: delErr } = await supabase.from('fat_realizado').delete().eq('ano', a).eq('mes', m).in('empresa_id', [...comboEmp[ck]])
            if (delErr) throw delErr
          }
        }
        const LOTE = 1000
        for (let i = 0; i < inserts.length; i += LOTE) {
          const { error } = await supabase.from('fat_realizado').insert(inserts.slice(i, i + LOTE))
          if (error) throw new Error(`${file.name}: ${error.message}`)
          setImpProg(`(${fi + 1}/${files.length}) ${file.name}: gravando ${Math.min(i + LOTE, inserts.length).toLocaleString('pt-BR')}/${inserts.length.toLocaleString('pt-BR')}`)
        }
        totIns += inserts.length; totIgn += ign
        log.push(`✓ ${file.name}: ${inserts.length.toLocaleString('pt-BR')} importados${ign ? `, ${ign} ignorados` : ''}`)
        setImpLog([...log])
        arqResumo.push([file.name, raw.length, inserts.length, ign])
      }
      setImpProg(`Concluído: ${totIns.toLocaleString('pt-BR')} lançamento(s) de ${files.length} arquivo(s)${totIgn ? `, ${totIgn} ignorados` : ''}.`)
      // ⚠ CC obrigatório (receita/despesa) faltando — lista os códigos de CC não cadastrados
      if (ccFaltando.size) {
        const total = [...ccFaltando.values()].reduce((s, n) => s + n, 0)
        const lista = [...ccFaltando.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ')
        log.push(`⚠ ${total.toLocaleString('pt-BR')} lançamento(s) de receita/despesa SEM CC cadastrado. CCs faltando: ${lista}. Cadastre-os em Cadastros → Centro de Custo e reimporte.`)
        setImpLog([...log])
      }
      // monta o log em xlsx (aba Arquivos + aba Ignorados) e baixa automaticamente se houver ignorados
      const arqAoa = [['arquivo', 'linhas', 'importados', 'ignorados'], ...arqResumo]
      const ignAoa = [['arquivo', 'motivo', 'empresa', 'conta', 'filial', 'cc', 'data', 'ano', 'mes', 'documento', 'historico', 'debito', 'credito'], ...ignDet]
      setLogXlsx({ arq: arqAoa, ign: ignAoa })
      if (ignDet.length) {
        downloadSheets('log_importacao_realizado.xlsx', [{ nome: 'Arquivos', aoa: arqAoa }, { nome: 'Ignorados', aoa: ignAoa }])
        if (ignDet.length >= CAP_IGN) setImpProg(p => p + ` (log truncado em ${CAP_IGN.toLocaleString('pt-BR')} linhas)`)
      }
      setImpProg(p => p + ' Recalculando agregados…')
      const { error: aggErr } = await supabase.rpc('refresh_realizado_mensal')
      if (aggErr) setImpProg(p => p + ` (⚠ recalcule os agregados manualmente: ${aggErr.message})`)
      load()
    } catch (e: any) { setImpProg('Erro: ' + (e?.message ?? JSON.stringify(e))) }
    setImpBusy(false)
  }

  const fmt2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  const somaDeb = grid.rows.reduce((s, r) => s + (Number(r.debito) || 0), 0)
  const somaCred = grid.rows.reduce((s, r) => s + (Number(r.credito) || 0), 0)
  const somaVal = grid.rows.reduce((s, r) => s + (Number(r.valor) || 0), 0)

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.title}>Realizado — dados (fato)</h1>
        <p style={S.sub}>Lançamentos do realizado (fat_realizado), grão de razão. A conta contábil é resolvida para a linha do relatório pelo DE-PARA (conta → linha). Valor = crédito − débito; o sinal final na linha vem do conta_linha (+/−).</p>
      </div>

      <div style={S.bar}>
        <select style={S.sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
          <option value="">— Todas as empresas —</option>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}
        </select>
        <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>
          {ANOS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select style={S.sel} value={mes} onChange={e => setMes(Number(e.target.value))}>
          <option value={0}>Todos os meses</option>
          {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <button style={{ ...S.btn, ...(grid.filtrosOn ? { borderColor: '#3b5bdb', color: '#3b5bdb' } : {}) }} onClick={() => grid.setFiltrosOn(v => !v)} title="Mostrar/ocultar filtro por coluna"><Filter size={13} /> Filtrar colunas</button>
        <div style={S.spacer} />
        <button style={S.btn} onClick={exportar}><FileDown size={13} /> Exportar</button>
        <button style={S.btn} onClick={recalcular} title="Recalcular os agregados mensais (DRE/dashboards) — use após mudar lotes ignorados"><RefreshCw size={13} /> Recalcular</button>
        <button style={{ ...S.btn, color: '#e67700', borderColor: '#ffe8cc' }} onClick={buscarCcFaltando} title="Lançamentos de receita/despesa sem CC cadastrado (CC obrigatório)"><AlertCircle size={13} /> CCs faltando</button>
        <button style={{ ...S.btn, background: '#3b5bdb', color: 'white', borderColor: '#3b5bdb' }} onClick={() => { setImportOpen(true); setImpProg(''); setImpLog([]); setLogXlsx(null) }}><Upload size={13} /> Importar</button>
        <button style={{ ...S.btn, color: '#e03131', borderColor: '#ffc9c9' }} onClick={limpar} title="Excluir o realizado (todos os anos/meses) para reimportar"><Trash2 size={13} /> Limpar</button>
      </div>

      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}

      <div style={S.card}>
        <table style={S.table}>
          <GridHead cols={GRID} grid={grid} thStyle={S.th} />
          <tbody>
            {loading && <tr><td colSpan={16} style={S.empty}>Carregando...</td></tr>}
            {!loading && grid.rows.length === 0 && <tr><td colSpan={16} style={S.empty}>{rows.length ? 'Nenhum resultado para o filtro de coluna.' : <>Nenhum lançamento para os filtros selecionados.<br /><small>Use "Importar Excel" com o razão (débito/crédito).</small></>}</td></tr>}
            {!loading && grid.rows.map(r => (
              <tr key={r.id}>
                <td style={S.tdR}>{MESES[r.mes]}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.empresa?.codigo || '—'}</td>
                <td style={S.td}>{r.data ? String(r.data).split('-').reverse().join('/') : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#1971c2' }}>{r.conta_contabil?.plano_contas?.codigo || '—'}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.conta_contabil?.codigo || '—'}</td>
                <td style={S.td}>{r.conta_contabil?.descricao || ''}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.filial?.codigo || '—'}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.centro_custo?.codigo || '—'}</td>
                <td style={S.td}>{r.documento || '—'}</td>
                <td style={S.td}>{r.historico || '—'}</td>
                <td style={S.tdR}>{r.debito != null ? Number(r.debito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={S.tdR}>{r.credito != null ? Number(r.credito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={{ ...S.tdR, fontWeight: 600, color: Number(r.valor) < 0 ? '#e03131' : '#2f9e44' }}>{Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.lote ? `${r.lote}${r.sublote ? '/' + r.sublote : ''}` : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: r.origem === 'ERP' ? '#0c8599' : r.origem === 'IMPORT' ? '#e67700' : '#868e96' }}>{r.origem}</td>
                <td style={S.td}></td>
              </tr>
            ))}
          </tbody>
          {!loading && grid.rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={10} style={{ ...S.td, fontWeight: 600, textAlign: 'right', background: '#f8f9fa' }}>Total · {grid.rows.length} lançamento{grid.rows.length > 1 ? 's' : ''}</td>
                <td style={{ ...S.tdR, fontWeight: 700, background: '#f8f9fa' }}>{fmt2(somaDeb)}</td>
                <td style={{ ...S.tdR, fontWeight: 700, background: '#f8f9fa' }}>{fmt2(somaCred)}</td>
                <td style={{ ...S.tdR, fontWeight: 700, background: '#f8f9fa', color: somaVal < 0 ? '#e03131' : '#2f9e44' }}>{fmt2(somaVal)}</td>
                <td colSpan={3} style={{ ...S.td, background: '#f8f9fa' }}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length >= 2000 && <p style={S.sub}>Mostrando os primeiros 2000 lançamentos. Use os filtros (mês) para refinar.</p>}

      {ccFaltOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setCcFaltOpen(false)}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 620, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 15 }}>CCs faltando — receita/despesa sem CC ({ano}{empresaId ? ' · empresa selecionada' : ' · todas'})</strong>
              <div style={{ flex: 1 }} />
              <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={() => setCcFaltOpen(false)} />
            </div>
            <p style={{ ...S.sub, marginTop: 0 }}>Em contas de receita/despesa o CC é obrigatório. Aqui ficam os lançamentos com CC não cadastrado (código original do arquivo). Cadastre o CC em Cadastros → Centro de Custo e reimporte (ou recalcule).</p>
            {ccFaltBusy ? <div style={S.sub}>Buscando…</div> : ccFalt.length === 0 ? (
              <div style={{ ...S.info, marginTop: 8 }}>Nenhum lançamento de receita/despesa sem CC. 👍</div>
            ) : (
              <>
                {ccFaltCap && <div style={S.erro}><AlertCircle size={15} />Resultado limitado a {CAP.toLocaleString('pt-BR')} linhas — refine por empresa.</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <button style={S.btn} onClick={baixarCcFaltando}><Download size={13} /> Baixar detalhado (xlsx)</button>
                </div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>CC (código)</th><th style={S.thR}>Lançamentos</th><th style={S.thR}>Valor</th><th style={S.th}>Contas</th></tr></thead>
                  <tbody>
                    {ccFalt.map(g => (
                      <tr key={g.cc}>
                        <td style={{ ...S.td, ...S.mono, fontWeight: 600, color: '#e8590c' }}>{g.cc}</td>
                        <td style={S.tdR}>{g.n.toLocaleString('pt-BR')}</td>
                        <td style={{ ...S.tdR, color: g.valor < 0 ? '#e03131' : '#2f9e44' }}>{fmt2(g.valor)}</td>
                        <td style={{ ...S.td, fontSize: 11, color: '#868e96' }}>{g.contas.slice(0, 6).join(', ')}{g.contas.length > 6 ? `  +${g.contas.length - 6}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {importOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => !impBusy && setImportOpen(false)}>
          <div style={{ background: 'white', borderRadius: 14, padding: 24, width: 560, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <strong style={{ fontSize: 16, color: '#212529' }}>Importar realizado</strong>
              <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={() => !impBusy && setImportOpen(false)} />
            </div>

            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const fs = Array.from(e.dataTransfer.files).filter(f => /\.(xlsx|xls|xlsm|csv)$/i.test(f.name)); if (fs.length) setDropFiles(p => [...p, ...fs]) }}
              style={{ border: `2px dashed ${dragOver ? '#3b5bdb' : '#ced4da'}`, background: dragOver ? '#edf2ff' : '#fafbfc', borderRadius: 12, padding: '28px 16px', textAlign: 'center', cursor: 'pointer' }}>
              <Upload size={26} style={{ color: dragOver ? '#3b5bdb' : '#adb5bd' }} />
              <div style={{ marginTop: 8, fontSize: 14, color: '#495057' }}>Arraste os arquivos aqui ou <span style={{ color: '#3b5bdb', fontWeight: 600 }}>clique para selecionar</span></div>
              <div style={{ fontSize: 12, color: '#adb5bd', marginTop: 4 }}>.xlsx — pode soltar vários meses de uma vez</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" multiple style={{ display: 'none' }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { const fs = Array.from(e.target.files || []); if (fs.length) setDropFiles(p => [...p, ...fs]); e.target.value = '' }} />

            {dropFiles.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 150, overflow: 'auto', border: '1px solid #f1f3f5', borderRadius: 8 }}>
                {dropFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, borderBottom: '1px solid #f8f9fa' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: '#adb5bd' }}>{(f.size / 1024).toFixed(0)} KB</span>
                    {!impBusy && <X size={14} style={{ cursor: 'pointer', color: '#ffa8a8' }} onClick={() => setDropFiles(p => p.filter((_, j) => j !== i))} />}
                  </div>
                ))}
                <div style={{ padding: '6px 10px', fontSize: 11, color: '#868e96', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{dropFiles.length} arquivo(s)</span>
                  {!impBusy && <span style={{ cursor: 'pointer', color: '#3b5bdb' }} onClick={() => setDropFiles([])}>limpar lista</span>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: '#868e96' }}>Modo:</label>
              <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as 'add' | 'full')} disabled={impBusy}>
                <option value="add">Adicionar</option>
                <option value="full">Substituir (escopo do arquivo)</option>
              </select>
              <button style={S.btn} onClick={() => downloadSheet('modelo_realizado.xlsx', [HEADERS, ...EXEMPLO])}><Download size={13} /> Baixar modelo</button>
            </div>

            {impProg && <div style={{ ...S.info, marginTop: 12 }}>{impProg}</div>}
            {impLog.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 140, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', color: '#495057', background: '#f8f9fa', borderRadius: 8, padding: '8px 10px' }}>
                {impLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              {logXlsx && <button style={S.btn} onClick={() => downloadSheets('log_importacao_realizado.xlsx', [{ nome: 'Arquivos', aoa: logXlsx.arq }, { nome: 'Ignorados', aoa: logXlsx.ign }])}><Download size={13} /> Baixar log</button>}
              <button style={S.btn} onClick={() => !impBusy && setImportOpen(false)} disabled={impBusy}>Fechar</button>
              <button style={{ ...S.btn, background: dropFiles.length && !impBusy ? '#2f9e44' : '#ced4da', color: 'white', borderColor: 'transparent', cursor: dropFiles.length && !impBusy ? 'pointer' : 'default' }} disabled={!dropFiles.length || impBusy} onClick={() => importarLote(dropFiles)}>
                {impBusy ? 'Importando…' : `Importar ${dropFiles.length || ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
