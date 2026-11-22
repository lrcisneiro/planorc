import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useCapacidades } from '../../hooks/useCapacidades'
import { pageAll } from '../../lib/pageAll'
import { fimDoMes, taxaRealizada, materializa } from '../../lib/cambio'
import { FileArchive, Upload, Download, FileDown, AlertCircle, RefreshCw, Trash2, X, Filter } from 'lucide-react'
import { useGrid, GridHead } from '../../lib/grid'
import type { GCol } from '../../lib/grid'
import { ErpPills } from '../erp/ErpPills'
import { inventariarRazao, extrairRazao, RazaoZipErro } from '../../lib/razaoZip'
import type { PerfilRazao, Competencia } from '../../lib/razaoZip'

declare const XLSX: any

type Empresa = { id: string; codigo: string; descricao: string }

const ANOS = [2024, 2025, 2026, 2027, 2028]
const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Colunas do modelo de importação (razão / lançamentos)
// ⚠⚠ OS PERFIS SÃO DESCOBERTOS, não listados. `import.meta.glob` varre
// `lib/perfis/*.json`, então atender outro ERP continua sendo "acrescentar um
// perfil", nunca "editar a tela" — que é a promessa da seção de importação do
// CLAUDE.md. `_modelo.json` fica de fora: é gabarito, não perfil.
// ⚠ O MESMO arquivo é lido pelo `scripts/gerar_lotes_mensais.py`. Duas cópias
// da regra divergiriam no primeiro ajuste, e o sintoma seria o lote do script
// e o da tela deixando de bater sem nada acusar.
const PERFIS = Object.entries(
  import.meta.glob<PerfilRazao>('../../lib/perfis/*.json', { eager: true, import: 'default' }))
  .filter(([cam]) => !cam.split('/').pop()!.startsWith('_'))
  .map(([cam, p]) => ({ id: cam.split('/').pop()!.replace('.json', ''), nome: p.nome, perfil: p }))
  .sort((a, b) => a.id.localeCompare(b.id))

const MESES_ABR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Um lote a importar: arquivo de planilha OU linhas já convertidas (do zip). */
type LoteImport = { name: string; file?: File; linhas?: Record<string, any>[] }

const HEADERS = ['empresa_codigo', 'filial_codigo', 'cc_codigo', 'conta_codigo', 'data', 'ano', 'mes', 'documento', 'historico', 'debito', 'credito', 'lote', 'sublote']
const EXEMPLO = [
  ['01', '2001', '111', '3.1.01.001', '15/01/2026', '', '', 'NF 123', 'Energia elétrica', 1500, 0, '008850', '001'],
  ['01', '2001', '', '4.1.01.001', '20/01/2026', '', '', 'NF 456', 'Receita de serviços', 0, 28000, '008850', '001'],
]

const S: Record<string, CSSProperties> = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' },
  header:  { marginBottom: 16 },
  title:   { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 },
  sub:     { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' },
  bar:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  sel:     { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', color: 'var(--text-mid)' },
  spacer:  { flex: 1 },
  btn:     { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  card:    { background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', padding: '9px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0 },
  thR:     { textAlign: 'right', padding: '9px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  td:      { padding: '7px 12px', borderBottom: '1px solid var(--panel)', color: 'var(--text)', whiteSpace: 'nowrap' },
  tdR:     { padding: '7px 12px', borderBottom: '1px solid var(--panel)', color: 'var(--text)', textAlign: 'right' },
  mono:    { fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' },
  empty:   { padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  erro:    { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: 'var(--red)', fontSize: 13 },
  info:    { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(59,130,246,0.16)', border: '1px solid rgba(59,130,246,0.30)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: 'var(--blue)', fontSize: 13 },
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
  const capImp = useCapacidades()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [ano, setAno] = useState(2026)
  const [mes, setMes] = useState(0) // 0 = todos
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [modo, setModo] = useState<'add' | 'full'>('add')
  const [moedaArq, setMoedaArq] = useState<number>(1)          // slot da moeda do arquivo
  const [moedas, setMoedas] = useState<any[]>([])              // slots ativos
  useEffect(() => { supabase.from('moeda').select('slot,codigo').eq('ativo', true).order('slot').then(r => setMoedas(r.data || [])) }, [])
  const [importOpen, setImportOpen] = useState(false)
  const [dropFiles, setDropFiles] = useState<File[]>([])
  // ── zip do ERP
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [zipBuf, setZipBuf] = useState<Uint8Array | null>(null)
  const [perfilId, setPerfilId] = useState<string>(PERFIS[0]?.id || '')
  const [comps, setComps] = useState<Competencia[]>([])
  const [compSel, setCompSel] = useState<Set<number>>(new Set())
  const [zipBusy, setZipBusy] = useState(false)
  const [zipProg, setZipProg] = useState('')
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

  // ⚠ Passou a aceitar LINHAS PRONTAS além de arquivo. O zip do ERP é
  // convertido em memória (`lib/razaoZip.ts`) e entra por aqui — todo o resto
  // do caminho (resolver conta/empresa/filial/CC, câmbio, lote ignorado, modo
  // substituir, log) já existe e está provado. Gerar um xlsx intermediário só
  // para alimentá-lo seria construir 35 mil linhas de planilha no navegador
  // para desmontá-las na linha seguinte.
  // Separa o que é planilha do que é zip do ERP. Só UM zip por vez: cada um é
  // um razão inteiro, e dois em memória são 50 MB comprimidos somados ao que
  // a conversão aloca.
  const receber = (fs: File[]) => {
    const zips = fs.filter(f => /\.zip$/i.test(f.name))
    const plan = fs.filter(f => /\.(xlsx|xls|xlsm|csv)$/i.test(f.name))
    if (plan.length) setDropFiles(p => [...p, ...plan])
    if (zips.length) { setZipFile(zips[0]); setZipBuf(null); setComps([]); setCompSel(new Set()); setZipProg('') }
  }

  const perfilAtual = () => PERFIS.find(p => p.id === perfilId)?.perfil
  const podeImportar = !impBusy && !zipBusy && (compSel.size > 0 || dropFiles.length > 0)

  const lerZip = async () => {
    const perfil = perfilAtual()
    if (!zipFile || !perfil) return
    setZipBusy(true); setZipProg('Abrindo o arquivo…'); setComps([]); setCompSel(new Set())
    try {
      // O buffer fica guardado: a 2ª passada relê o MESMO zip em memória, sem
      // voltar ao disco nem pedir o arquivo de novo.
      const buf = zipBuf ?? new Uint8Array(await zipFile.arrayBuffer())
      setZipBuf(buf)
      const inv = await inventariarRazao(buf, perfil,
        n => setZipProg(`Lendo o razão… ${n.toLocaleString('pt-BR')} lançamentos`))
      setComps(inv)
      setZipProg(inv.length
        ? `${inv.length} competências · ${inv.reduce((s, c) => s + c.linhas, 0).toLocaleString('pt-BR')} lançamentos no arquivo. Marque o que importar.`
        : 'Nenhum lançamento com data válida foi encontrado.')
    } catch (e: any) {
      // ⚠ Coluna que falta é o erro mais comum e o mais fácil de resolver: a
      // mensagem diz qual perfil esperava o quê, e lista o que o arquivo TEM.
      const cols = (e as RazaoZipErro)?.colunasDoArquivo
      setZipProg('✗ ' + (e?.message === 'ARQUIVO_NAO_ENCONTRADO'
        ? `Não achei "${perfil.arquivo_padrao || 'LancamentoContabil.csv'}" dentro do zip.`
        : (e?.message || String(e))) + (cols ? ` · O arquivo tem: ${cols.join(', ')}` : ''))
    }
    setZipBusy(false)
  }

  const importarZip = async () => {
    const perfil = perfilAtual()
    if (!zipBuf || !perfil || !compSel.size) return
    setZipBusy(true); setZipProg('Separando os meses escolhidos…')
    try {
      const escolhidas = comps.filter(c => compSel.has(c.ano * 100 + c.mes))
      const lotes = await extrairRazao(zipBuf, perfil, escolhidas,
        n => setZipProg(`Separando… ${n.toLocaleString('pt-BR')} lançamentos`))
      setZipProg('')
      await importarLote(lotes.map(l => ({ name: `${l.nome} (do zip)`, linhas: l.linhas })))
    } catch (e: any) {
      setZipProg('✗ ' + (e?.message || String(e)))
    }
    setZipBusy(false)
  }

  const importarLote = async (files: LoteImport[]) => {
    if (!files.length) return
    setImpBusy(true); setImpLog([]); setImpProg('Carregando cadastros…')
    try {
      // pageAll obrigatório: o PostgREST corta em 1000 SEM erro. São 1.699 contas
      // (dois planos povoados) e o corte deixava ~700 de fora — a linha do razão
      // caía em "conta não encontrada" e era ignorada. Pior: sem .order() o corte é
      // arbitrário, então o mesmo arquivo podia importar diferente a cada tentativa.
      const [contas, emps, fis, cc] = await Promise.all([
        pageAll(() => supabase.from('conta_contabil').select('id,codigo,plano_id,natureza')),
        pageAll(() => supabase.from('empresa').select('id,codigo,plano_id')),
        pageAll(() => supabase.from('filial').select('id,codigo,empresa_id')),
        pageAll(() => supabase.from('centro_custo').select('id,codigo')),
      ])
      const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()
      const contaMap: Record<string, string> = {}; contas.forEach((c: any) => { contaMap[`${c.plano_id}|${norm(c.codigo)}`] = c.id })
      const contaNat: Record<string, string> = {}; contas.forEach((c: any) => { contaNat[c.id] = c.natureza || '' })
      const ccObrig = (cid: string | undefined) => cid != null && (contaNat[cid] === 'RECEITA' || contaNat[cid] === 'DESPESA')   // CC obrigatório
      const ccFaltando = new Map<string, number>()   // código do CC faltando → nº de lançamentos (conta receita/despesa)
      const ccEmBranco = new Map<string, number>()   // conta → nº de lançamentos que vieram SEM CC na origem
      const empMap: Record<string, string> = {}; emps.forEach((e: any) => { empMap[norm(e.codigo)] = e.id })
      const empPlano: Record<string, string> = {}; emps.forEach((e: any) => { empPlano[e.id] = e.plano_id })
      const filMap: Record<string, string> = {}; fis.forEach((f: any) => { filMap[norm(f.codigo)] = f.id })
      // Plano pela FILIAL, não pela empresa. A filial é o CNPJ do ERP e define
      // em que plano o lançamento foi escriturado; a empresa é agrupador
      // GERENCIAL e pode ser trocada pelo item contábil na conversão. Procurar
      // a conta no plano da empresa de destino descartava, em silêncio, tudo o
      // que o item contábil reclassificava para uma empresa de outro plano —
      // medido: 467 linhas e R$ 817 mil da XX por ano, com o motivo registrado
      // como "conta não encontrada".
      const filPlano: Record<string, string> = {}
      fis.forEach((f: any) => { const pl = f.empresa_id ? empPlano[f.empresa_id] : null; if (pl) filPlano[f.id] = pl })
      const ccMap: Record<string, string> = {}; cc.forEach((c: any) => { ccMap[norm(c.codigo)] = c.id })
      const empSelCod = empresas.find(e => e.id === empresaId)?.codigo || ''

      // MULTIMOEDA: materializa val_m1(=valor)/val_m2/val_m3 na moeda do arquivo, pela
      // taxa REAL da DATA do lançamento (diária, carry-forward). Slot 1 = base (BRL).
      const cambio = await pageAll(() => supabase.from('cambio').select('moeda_slot,data,taxa'))
      const slotsAtivos = (moedas.length ? moedas.map((m: any) => m.slot) : [1]) as number[]
      const conv = (valor: number, ano: number, mes: number, dataISO: string | null): { valor: number; val_m2: number | null; val_m3: number | null } | null => {
        if (moedaArq === 1 && slotsAtivos.every(s => s === 1)) return { valor, val_m2: null, val_m3: null }
        const data = dataISO || fimDoMes(ano, mes)
        const { vals } = materializa(valor, moedaArq, slotsAtivos, (slot) => taxaRealizada(slot, data, cambio))
        if (vals[1] == null) return null
        return { valor: vals[1] as number, val_m2: vals[2] ?? null, val_m3: vals[3] ?? null }
      }

      // lotes marcados para NÃO importar (pular_import). Casa por lote + sublote opcional + empresa opcional.
      const { data: lotesPular } = await supabase.from('lote_ignorado').select('lote,sublote,empresa_id,por_prefixo,ativo,pular_import').eq('pular_import', true)
      const pularRegras = (lotesPular || []) as { lote: string; sublote: string | null; empresa_id: string | null; por_prefixo: boolean }[]
      const devePular = (lote: string, sub: string, empId: string | undefined) =>
        !!lote && pularRegras.some(g =>
          (g.por_prefixo ? norm(lote).startsWith(norm(g.lote)) : norm(g.lote) === norm(lote)) &&
          (g.sublote == null || g.sublote === '' || norm(g.sublote) === norm(sub)) &&
          (g.empresa_id == null || g.empresa_id === empId))

      if (modo === 'full' && !confirm(`Modo SUBSTITUIR: para cada arquivo, o realizado das competências (empresa/ano/mês) do arquivo será EXCLUÍDO antes de inserir — só na moeda ${moedas.find((m: any) => m.slot === moedaArq)?.codigo || 'base'}, para não apagar o que a mesma empresa recebe de outra origem.\n\n${files.length} arquivo(s). Confirmar?`)) { setImpProg('Cancelado.'); setImpBusy(false); return }

      const log: string[] = []; let totIns = 0, totIgn = 0
      const faltaConta = new Set<string>(), faltaEmp = new Set<string>()
      const arqResumo: any[][] = []           // aba "Arquivos"
      const ignDet: any[][] = []              // aba "Ignorados" (detalhe)
      const CAP_IGN = 20000
      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        setImpProg(`(${fi + 1}/${files.length}) Lendo ${file.name}…`)
        const raw = file.linhas ?? (await parseXlsx(file.file!)).rows
        if (!raw.length) { log.push(`⚠ ${file.name}: sem linhas`); setImpLog([...log]); arqResumo.push([file.name, 0, 0, 0]); continue }
        const inserts: any[] = []; const comboEmp: Record<string, Set<string>> = {}; let ign = 0
        for (const r of raw) {
          const contaCod = txt(r, 'conta_codigo', 'conta', 'CONTA', 'conta_contabil')
          const empCod = txt(r, 'empresa_codigo', 'empresa', 'EMPRESA') || empSelCod
          const empresa_id = empMap[norm(empCod)]
          const filCodR = txt(r, 'filial_codigo', 'filial', 'FILIAL')
          const filial_id_r = filCodR ? (filMap[norm(filCodR)] || null) : null
          // a filial manda; a empresa é o fallback de quem não tem filial no arquivo
          const planoLin = (filial_id_r ? filPlano[filial_id_r] : null) || (empresa_id ? empPlano[empresa_id] : null)
          const conta_id = planoLin ? contaMap[`${planoLin}|${norm(contaCod)}`] : undefined
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
          const ccCod = txt(r, 'cc_codigo', 'cc', 'centro_custo', 'CENTRO DE CUSTO')
          const cc_id = ccCod ? (ccMap[norm(ccCod)] || null) : null
          // CC é obrigatório em conta de receita/despesa → detecta os que faltam.
          // ⚠ SÃO DOIS PROBLEMAS DIFERENTES e o aviso tratava como um só: código
          // que o arquivo traz e o cadastro não tem (cadastre e reimporte) × CC
          // EM BRANCO na origem (não há o que cadastrar — o ERP lançou assim).
          // O texto antigo mandava "cadastrar (sem CC)", que não existe.
          if (!cc_id && ccObrig(conta_id)) {
            if (ccCod) ccFaltando.set(ccCod, (ccFaltando.get(ccCod) || 0) + 1)
            else {
              const c = contaCod || '?'
              ccEmBranco.set(c, (ccEmBranco.get(c) || 0) + 1)
            }
          }
          const valor = +(cre - deb).toFixed(2)
          const cv = conv(valor, comp.ano, comp.mes, comp.dataISO || null)
          if (!cv) { ign++; addIgn('sem cotação de câmbio da data'); continue }
          inserts.push({
            tenant_id: TENANT_ID, linha_id: null, conta_id, empresa_id,
            filial_id: filial_id_r,
            cc_id,
            ano: comp.ano, mes: comp.mes, data: comp.dataISO,
            documento: txt(r, 'documento', 'doc', 'DOCUMENTO') || null,
            historico: txt(r, 'historico', 'Histórico', 'HISTORICO') || null,
            debito: deb || null, credito: cre || null, dc: cre >= deb ? 'C' : 'D',
            lote: lote || null, sublote: sublote || null,
            valor: cv.valor, moeda_origem: moedaArq, val_m2: cv.val_m2, val_m3: cv.val_m3,
            dims: (ccCod && !cc_id) ? { cc_orig: ccCod } : {}, origem: 'IMPORT',
          })
          const ck = `${comp.ano}-${comp.mes}`; (comboEmp[ck] ||= new Set()).add(empresa_id)
        }
        if (!inserts.length) { log.push(`⚠ ${file.name}: nenhuma linha válida (${ign} ignoradas)`); setImpLog([...log]); arqResumo.push([file.name, raw.length, 0, ign]); continue }
        if (modo === 'full') {
          for (const ck of Object.keys(comboEmp)) {
            const [a, m] = ck.split('-').map(Number)
            // ⚠ O delete é por (ano, mes, empresa) MAIS A MOEDA DO ARQUIVO. Uma mesma
            // empresa recebe lançamento de mais de uma origem: a empresa XX (Paraguai)
            // tem o razão paraguaio em USD e, vindas do razão BRASILEIRO em BRL, as
            // linhas que o item contábil reclassifica para lá. Sem o recorte de moeda
            // os dois imports se derrubavam: reimportar o PY apagava o que veio do
            // Brasil, e reimportar o Brasil apagava o Paraguai inteiro.
            // Lançamento antigo, anterior ao multimoeda, tem moeda_origem nulo e conta
            // como base (slot 1) — por isso o or() quando o arquivo é da moeda base.
            let q = supabase.from('fat_realizado').delete().eq('ano', a).eq('mes', m).in('empresa_id', [...comboEmp[ck]])
            q = moedaArq === 1
              ? q.or('moeda_origem.is.null,moeda_origem.eq.1')
              : q.eq('moeda_origem', moedaArq)
            const { error: delErr } = await q
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
        log.push(`⚠ ${total.toLocaleString('pt-BR')} lançamento(s) de receita/despesa com CC NÃO CADASTRADO: ${lista}. Cadastre-os em Cadastros → Centro de Custo e reimporte.`)
        setImpLog([...log])
      }
      // CC vazio na origem: não há o que cadastrar. O que importa saber é QUAIS
      // CONTAS lançam assim — é por elas que a conversa com a contabilidade
      // começa — e que esse valor some de qualquer recorte por centro de custo,
      // então a soma das áreas não bate com o total da DRE.
      if (ccEmBranco.size) {
        const total = [...ccEmBranco.values()].reduce((s, n) => s + n, 0)
        const lista = [...ccEmBranco.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(', ')
        log.push(`⚠ ${total.toLocaleString('pt-BR')} lançamento(s) de receita/despesa vieram SEM centro de custo no arquivo — não é cadastro faltando, é o ERP que lançou assim. Contas: ${lista}. Eles entram na DRE consolidada mas somem de qualquer recorte por CC, então a soma das áreas não fecha com o total.`)
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
      // O texto de progresso é TROCADO no fim, não só acrescentado quando dá
      // erro: antes, terminando bem, a tela ficava para sempre em "Recalculando
      // agregados…" — indistinguível de travada. A constante evita que a frase
      // anexada e a removida saiam de sincronia.
      const AGG = ' Recalculando agregados…'
      setImpProg(p => p + AGG)
      const { error: aggErr } = await supabase.rpc('refresh_realizado_mensal')
      setImpProg(p => p.replace(AGG, aggErr
        ? ` ⚠ Agregados NÃO recalculados (${aggErr.message}) — use o botão Recalcular; os lançamentos já estão gravados.`
        : ' ✓ Agregados recalculados.'))
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
      <ErpPills />

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
        <button style={{ ...S.btn, ...(grid.filtrosOn ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : {}) }} onClick={() => grid.setFiltrosOn(v => !v)} title="Mostrar/ocultar filtro por coluna"><Filter size={13} /> Filtrar colunas</button>
        <div style={S.spacer} />
        <button style={S.btn} onClick={exportar}><FileDown size={13} /> Exportar</button>
        <button style={S.btn} onClick={recalcular} title="Recalcular os agregados mensais (DRE/dashboards) — use após mudar lotes ignorados"><RefreshCw size={13} /> Recalcular</button>
        <button style={{ ...S.btn, color: '#e67700', borderColor: 'rgba(251,191,36,0.20)' }} onClick={buscarCcFaltando} title="Lançamentos de receita/despesa sem CC cadastrado (CC obrigatório)"><AlertCircle size={13} /> CCs faltando</button>
        {capImp.can('realizado.importar') && <button style={{ ...S.btn, background: 'var(--violet)', color: '#ffffff', borderColor: 'var(--violet)' }} onClick={() => { setImportOpen(true); setImpProg(''); setImpLog([]); setLogXlsx(null) }}><Upload size={13} /> Importar</button>}
        <button style={{ ...S.btn, color: 'var(--red)', borderColor: 'rgba(248,113,113,0.35)' }} onClick={limpar} title="Excluir o realizado (todos os anos/meses) para reimportar"><Trash2 size={13} /> Limpar</button>
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
                <td style={{ ...S.td, fontSize: 11, color: 'var(--blue)' }}>{r.conta_contabil?.plano_contas?.codigo || '—'}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.conta_contabil?.codigo || '—'}</td>
                <td style={S.td}>{r.conta_contabil?.descricao || ''}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.filial?.codigo || '—'}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.centro_custo?.codigo || '—'}</td>
                <td style={S.td}>{r.documento || '—'}</td>
                <td style={S.td}>{r.historico || '—'}</td>
                <td style={S.tdR}>{r.debito != null ? Number(r.debito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={S.tdR}>{r.credito != null ? Number(r.credito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={{ ...S.tdR, fontWeight: 600, color: Number(r.valor) < 0 ? 'var(--red)' : 'var(--green)' }}>{Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.lote ? `${r.lote}${r.sublote ? '/' + r.sublote : ''}` : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: r.origem === 'ERP' ? 'var(--cyan)' : r.origem === 'IMPORT' ? '#e67700' : 'var(--muted)' }}>{r.origem}</td>
                <td style={S.td}></td>
              </tr>
            ))}
          </tbody>
          {!loading && grid.rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={10} style={{ ...S.td, fontWeight: 600, textAlign: 'right', background: 'var(--bg)' }}>Total · {grid.rows.length} lançamento{grid.rows.length > 1 ? 's' : ''}</td>
                <td style={{ ...S.tdR, fontWeight: 700, background: 'var(--bg)' }}>{fmt2(somaDeb)}</td>
                <td style={{ ...S.tdR, fontWeight: 700, background: 'var(--bg)' }}>{fmt2(somaCred)}</td>
                <td style={{ ...S.tdR, fontWeight: 700, background: 'var(--bg)', color: somaVal < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt2(somaVal)}</td>
                <td colSpan={3} style={{ ...S.td, background: 'var(--bg)' }}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length >= 2000 && <p style={S.sub}>Mostrando os primeiros 2000 lançamentos. Use os filtros (mês) para refinar.</p>}

      {ccFaltOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setCcFaltOpen(false)}>
          <div style={{ background: 'var(--panel)', borderRadius: 14, padding: 24, width: 620, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 15 }}>Receita/despesa sem centro de custo ({ano}{empresaId ? ' · empresa selecionada' : ' · todas'})</strong>
              <div style={{ flex: 1 }} />
              <X size={18} style={{ cursor: 'pointer', color: 'var(--muted)' }} onClick={() => setCcFaltOpen(false)} />
            </div>
            {/* ⚠ Dois casos no mesmo lugar, e só um se resolve cadastrando. A
                coluna "CC (orig)" é que distingue: com código, falta cadastro;
                com "(sem CC)", o ERP lançou vazio e não há o que cadastrar. */}
            <p style={{ ...S.sub, marginTop: 0 }}>Em contas de receita/despesa o CC é obrigatório, e aqui ficam os lançamentos que não têm.
              Veja a coluna <b>CC (orig)</b>: se vier um <b>código</b>, falta cadastrá-lo em Cadastros → Centro de Custo e reimportar.
              Se vier <b>(sem CC)</b>, o ERP lançou sem centro de custo — não há o que cadastrar, e a conversa é com a contabilidade.
              Nos dois casos o valor entra na DRE consolidada mas some de qualquer recorte por CC, então a soma das áreas não fecha com o total.</p>
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
                        <td style={{ ...S.td, ...S.mono, fontWeight: 600, color: 'var(--orange)' }}>{g.cc}</td>
                        <td style={S.tdR}>{g.n.toLocaleString('pt-BR')}</td>
                        <td style={{ ...S.tdR, color: g.valor < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt2(g.valor)}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--muted)' }}>{g.contas.slice(0, 6).join(', ')}{g.contas.length > 6 ? `  +${g.contas.length - 6}` : ''}</td>
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
          <div style={{ background: 'var(--panel)', borderRadius: 14, padding: 24, width: 560, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <strong style={{ fontSize: 16, color: 'var(--text)' }}>Importar realizado</strong>
              <X size={18} style={{ cursor: 'pointer', color: 'var(--muted)' }} onClick={() => !impBusy && setImportOpen(false)} />
            </div>

            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); receber(Array.from(e.dataTransfer.files)) }}
              style={{ border: `2px dashed ${dragOver ? 'var(--violet)' : 'var(--border-strong)'}`, background: dragOver ? 'rgba(139,92,246,0.14)' : 'var(--bg-soft)', borderRadius: 12, padding: '28px 16px', textAlign: 'center', cursor: 'pointer' }}>
              <Upload size={26} style={{ color: dragOver ? 'var(--violet)' : 'var(--muted)' }} />
              <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-mid)' }}>Arraste os arquivos aqui ou <span style={{ color: 'var(--violet)', fontWeight: 600 }}>clique para selecionar</span></div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>.xlsx de um mês, ou o <strong>.zip do ERP</strong> — dele a tela separa os meses sozinha</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,.zip" multiple style={{ display: 'none' }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { receber(Array.from(e.target.files || [])); e.target.value = '' }} />

            {zipFile && (
              <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <FileArchive size={15} style={{ color: 'var(--violet)' }} />
                  <strong style={{ fontSize: 13 }}>{zipFile.name}</strong>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{(zipFile.size / 1048576).toFixed(1)} MB</span>
                  <span style={{ flex: 1 }} />
                  {!zipBusy && !impBusy && <X size={14} style={{ cursor: 'pointer', color: 'var(--red)' }}
                    onClick={() => { setZipFile(null); setComps([]); setCompSel(new Set()); setZipProg('') }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)' }}>Perfil:</label>
                  <select style={S.sel} value={perfilId} disabled={zipBusy || impBusy}
                    onChange={e => { setPerfilId(e.target.value); setComps([]); setCompSel(new Set()) }}>
                    {PERFIS.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  {!comps.length && <button style={{ ...S.btn, background: 'var(--violet)', color: '#fff', borderColor: 'var(--violet)' }}
                    disabled={zipBusy || impBusy} onClick={lerZip}>{zipBusy ? 'Lendo…' : 'Ler o arquivo'}</button>}
                </div>
                {zipProg && <div style={{ ...S.info, marginTop: 10 }}>{zipProg}</div>}
                {comps.length > 0 && (
                  <>
                    {/* ⚠ O INVENTÁRIO VEM ANTES DA ESCOLHA. Pedir ano e mês de
                        antemão obriga a saber o que o arquivo tem — e o razão
                        traz desde 2022. Aqui a tela mostra e a pessoa marca.
                        ⚠ Nada vem marcado: importar é reescrever competência,
                        e marcação pré-pronta é a que ninguém confere. */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{comps.length} competências no arquivo:</span>
                      <span style={{ fontSize: 11.5, color: 'var(--violet)', cursor: 'pointer' }}
                        onClick={() => { const u = comps[comps.length - 1]; setCompSel(new Set([u.ano * 100 + u.mes])) }}>só a última</span>
                      <span style={{ fontSize: 11.5, color: 'var(--violet)', cursor: 'pointer' }}
                        onClick={() => { const a = comps[comps.length - 1].ano; setCompSel(new Set(comps.filter(c => c.ano === a).map(c => c.ano * 100 + c.mes))) }}>ano de {comps[comps.length - 1].ano}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--violet)', cursor: 'pointer' }} onClick={() => setCompSel(new Set())}>limpar</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8, maxHeight: 160, overflow: 'auto' }}>
                      {comps.map(c => {
                        const k = c.ano * 100 + c.mes, on = compSel.has(k)
                        return (
                          <button key={k} disabled={zipBusy || impBusy}
                            onClick={() => setCompSel(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })}
                            title={`${c.linhas.toLocaleString('pt-BR')} lançamentos`}
                            style={{ padding: '4px 8px', fontSize: 11.5, borderRadius: 7, cursor: 'pointer',
                                     border: '1px solid ' + (on ? 'var(--violet)' : 'var(--border-strong)'),
                                     background: on ? 'rgba(139,92,246,0.16)' : 'transparent',
                                     color: on ? 'var(--violet)' : 'var(--text-mid)', fontWeight: on ? 700 : 500 }}>
                            {MESES_ABR[c.mes - 1]}/{String(c.ano).slice(2)}
                            <span style={{ opacity: .6, marginLeft: 4, fontWeight: 400 }}>{c.linhas > 999 ? `${Math.round(c.linhas / 1000)}k` : c.linhas}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {dropFiles.length > 0 && (
              <div style={{ marginTop: 12, maxHeight: 150, overflow: 'auto', border: '1px solid var(--panel)', borderRadius: 8 }}>
                {dropFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, borderBottom: '1px solid var(--bg)' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{(f.size / 1024).toFixed(0)} KB</span>
                    {!impBusy && <X size={14} style={{ cursor: 'pointer', color: 'var(--red)' }} onClick={() => setDropFiles(p => p.filter((_, j) => j !== i))} />}
                  </div>
                ))}
                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{dropFiles.length} arquivo(s)</span>
                  {!impBusy && <span style={{ cursor: 'pointer', color: 'var(--violet)' }} onClick={() => setDropFiles([])}>limpar lista</span>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Modo:</label>
              <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as 'add' | 'full')} disabled={impBusy}>
                <option value="add">Adicionar</option>
                <option value="full">Substituir (escopo do arquivo)</option>
              </select>
              {moedas.length > 1 && <><label style={{ fontSize: 12, color: 'var(--muted)' }}>Moeda:</label>
                <select style={S.sel} value={moedaArq} onChange={e => setMoedaArq(Number(e.target.value))} disabled={impBusy}
                  title="Moeda em que os valores deste arquivo estão. Converte para os demais slots pela taxa real da data do lançamento.">
                  {moedas.map((m: any) => <option key={m.slot} value={m.slot}>{m.codigo}</option>)}
                </select></>}
              <button style={S.btn} onClick={() => downloadSheet('modelo_realizado.xlsx', [HEADERS, ...EXEMPLO])}><Download size={13} /> Baixar modelo</button>
            </div>

            {impProg && <div style={{ ...S.info, marginTop: 12 }}>{impProg}</div>}
            {impLog.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 140, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', color: 'var(--text-mid)', background: 'var(--bg)', borderRadius: 8, padding: '8px 10px' }}>
                {impLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              {logXlsx && <button style={S.btn} onClick={() => downloadSheets('log_importacao_realizado.xlsx', [{ nome: 'Arquivos', aoa: logXlsx.arq }, { nome: 'Ignorados', aoa: logXlsx.ign }])}><Download size={13} /> Baixar log</button>}
              <button style={S.btn} onClick={() => !impBusy && setImportOpen(false)} disabled={impBusy}>Fechar</button>
              {/* Um botão só: o que ele importa depende do que foi solto. Com o
                  zip, o número é de MESES marcados — "importar 3" dizendo 3
                  arquivos quando são 3 meses de um arquivo confunde. */}
              <button style={{ ...S.btn, background: podeImportar ? 'var(--green)' : 'var(--border-strong)', color: '#ffffff', borderColor: 'transparent', cursor: podeImportar ? 'pointer' : 'default' }}
                disabled={!podeImportar} onClick={() => (compSel.size ? importarZip() : importarLote(dropFiles.map(f => ({ name: f.name, file: f }))))}>
                {impBusy || zipBusy ? 'Importando…' : compSel.size ? `Importar ${compSel.size} mês(es)` : `Importar ${dropFiles.length || ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
