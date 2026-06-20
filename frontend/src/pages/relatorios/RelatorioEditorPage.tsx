import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import {
  computeCenario, computeTotais, formatValor, parseNum, pkey,
} from '../../lib/engine'
import type { LinhaCalc, RawValues, Computed, Periodo, TipoLinha, Formato } from '../../lib/engine'
import FormulaCellInput from './FormulaCellInput'
import {
  ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2, Settings2, X,
  Sigma, FunctionSquare, Percent, Minus, Type, Download, Upload, Link2, Filter, ChevronsUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Pencil, Eye, EyeOff, Strikethrough, ListTree, History, RotateCcw, Save,
} from 'lucide-react'

declare const XLSX: any

// ─── Types ───────────────────────────────────────────────────
type Funcao = 'MENSAL' | 'ACM' | 'MENSAL_ACM' | 'COMPARATIVO'

type Linha = LinhaCalc & {
  descricao: string
  natureza: string | null
  ordem: number | null
  nivel: number
  negrito: boolean
  italico: boolean
  formato: Formato
  casas_decimais: number
  cor_texto: string | null
  linha_orc_id: string | null   // âncora do dado na estrutura compartilhada (F2)
  _depth: number
}
type Relatorio = { id: string; codigo: string; nome: string; categoria?: string | null }
type Empresa   = { id: string; codigo: string; descricao: string }
type Versao    = { id: string; codigo: string }
type ViewConfig = { id: string; nome: string; ordem: number | null; funcao: Funcao; cenarios: string[]; filtros: any; _synthetic?: boolean }

type ValMap = Record<string, RawValues>        // [cenario][linhaId][pkey] = {valor,expressao}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const ANOS  = [2024, 2025, 2026, 2027, 2028]
const MPB: Record<string, number> = { MENSAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }
const GRAN_LABEL: Record<string, string> = { MENSAL: 'Mensal', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' }
function bucketLabel(gran: string, start: number, ano: number, showYear: boolean): string {
  const yy = showYear ? `/${String(ano).slice(2)}` : ''
  if (gran === 'ANUAL') return String(ano)
  if (gran === 'TRIMESTRAL') return `${Math.floor((start - 1) / 3) + 1}ºT${yy}`
  if (gran === 'SEMESTRAL') return `${Math.floor((start - 1) / 6) + 1}ºS${yy}`
  return MESES[start - 1] + yy
}
// Aritmética de período (multi-ano)
const perIdx = (p: Periodo) => p.ano * 12 + (p.mes - 1)
const addMes = (p: Periodo, d: number): Periodo => { const z = perIdx(p) + d; return { ano: Math.floor(z / 12), mes: (z % 12) + 1 } }
const samePer = (a: Periodo | null | undefined, b: Periodo | null | undefined) => !!a && !!b && a.ano === b.ano && a.mes === b.mes
const ordPer = (a: Periodo, b: Periodo): [Periodo, Periodo] => perIdx(a) <= perIdx(b) ? [a, b] : [b, a]
const mesesNoRange = (ini: Periodo, fim: Periodo): Periodo[] => {
  const n = perIdx(fim) - perIdx(ini) + 1
  return Array.from({ length: Math.max(0, n) }, (_, i) => addMes(ini, i))
}
const REALIZADO = 'REALIZADO'
const FUNCAO_LABEL: Record<Funcao, string> = { MENSAL: 'Períodos', ACM: 'Acumulado', MENSAL_ACM: 'Acum. + Períodos', COMPARATIVO: 'Comparativo' }
const TIPO_INFO: Record<TipoLinha, { label: string; icon: any; cor: string }> = {
  SOMAR_FILHOS: { label: 'Subtotal — soma das filhas',                 icon: Sigma,          cor: '#1971c2' },
  ANALITICA:    { label: 'Analítica — valor ou fórmula por célula',    icon: Type,           cor: '#212529' },
  FORMULA:      { label: 'Fórmula — uma expressão p/ a linha toda',    icon: FunctionSquare, cor: '#6741d9' },
  INDICADOR:    { label: 'Indicador — fórmula (ex.: %)',               icon: Percent,        cor: '#0c8599' },
  ESPACO:       { label: 'Espaço / separador',                          icon: Minus,          cor: '#adb5bd' },
}

function buildTree(linhas: Linha[], paiId: string | null = null, depth = 0): Linha[] {
  return linhas.filter(l => l.pai_id === paiId)
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    .flatMap(l => [{ ...l, _depth: depth }, ...buildTree(linhas, l.id, depth + 1)])
}

function savedFiltro(id?: string): any {
  if (!id) return {}
  try { return JSON.parse(localStorage.getItem('planorc_filtro_' + id) || '{}') } catch { return {} }
}
function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, filename)
}
// Busca TODAS as linhas paginando (PostgREST limita ~1000 por request).
async function fetchAllRows(build: () => any): Promise<any[]> {
  const out: any[] = []
  const size = 1000
  let from = 0
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error) throw new Error(error.message || JSON.stringify(error))
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < size) break
    from += size
  }
  return out
}
function readWorkbook(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => { try { resolve(XLSX.read(e.target?.result, { type: 'binary', cellDates: true })) } catch (err) { reject(err) } }
    reader.readAsBinaryString(file)
  })
}
// pai pelo prefixo do código (numérico ou com pontos)
function parentByPrefix(cod: string, set: Set<string>): string | null {
  if (cod.includes('.')) {
    const parts = cod.split('.')
    while (parts.length > 1) { parts.pop(); const c = parts.join('.'); if (set.has(c)) return c }
    return null
  }
  for (let len = cod.length - 1; len >= 1; len--) { const c = cod.slice(0, len); if (set.has(c)) return c }
  return null
}

// ─── Styles (reaproveita o padrão do editor anterior) ─────────
const S: Record<string, CSSProperties> = {
  page:      { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8f9fa' },
  header:    { background: 'white', borderBottom: '1px solid #e9ecef', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' },
  back:      { background: 'none', border: 'none', cursor: 'pointer', color: '#6c757d', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '4px 8px', borderRadius: 6 },
  title:     { fontSize: 15, fontWeight: 600, color: '#212529', flex: 1, whiteSpace: 'nowrap' },
  sel:       { padding: '5px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057', cursor: 'pointer' },
  viewsBar:  { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px', background: 'white', borderBottom: '1px solid #e9ecef', flexShrink: 0, flexWrap: 'wrap' },
  tableWrap: { flex: 1, overflow: 'auto' },
  table:     { borderCollapse: 'collapse', fontSize: 13 },
  th:        { padding: '7px 10px', background: '#f1f3f5', color: '#6c757d', fontWeight: 600, fontSize: 11, textAlign: 'right', borderBottom: '2px solid #dee2e6', borderRight: '1px solid #e9ecef', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 },
  thDesc:    { textAlign: 'left', minWidth: 80, position: 'sticky', left: 0, zIndex: 3, background: '#f1f3f5' },
  td:        { padding: '5px 10px', borderBottom: '1px solid #f1f3f5', borderRight: '1px solid #f4f5f7', textAlign: 'right', whiteSpace: 'nowrap' },
  tdDesc:    { textAlign: 'left', position: 'sticky', left: 0, zIndex: 1, padding: '5px 8px', minWidth: 80, overflow: 'hidden' },
  iconBtn:   { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center', color: '#ced4da' },
  cellInput: { width: 96, border: '1px solid #339af0', borderRadius: 4, padding: '2px 6px', fontSize: 13, textAlign: 'right', outline: 'none', background: '#e7f5ff' },
  addRow:    { background: 'none', border: '1px dashed #ced4da', borderRadius: 6, padding: '6px 14px', color: '#adb5bd', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 },
  newInput:  { flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid #69db7c', borderRadius: 6, outline: 'none' },
  btnGreen:  { padding: '6px 14px', background: '#2f9e44', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnGray:   { padding: '6px 10px', background: 'none', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:     { background: 'white', borderRadius: 14, padding: 24, width: 460, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  mTitle:    { fontSize: 16, fontWeight: 600, marginBottom: 18, color: '#212529', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  field:     { marginBottom: 14 },
  label:     { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 6 },
  input:     { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ced4da', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  mFooter:   { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 },
  btnSec:    { padding: '8px 16px', fontSize: 14, background: 'none', border: '1px solid #dee2e6', borderRadius: 8, cursor: 'pointer', color: '#495057' },
  btnPri:    { padding: '8px 16px', fontSize: 14, background: '#3b5bdb', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 500 },
  chk:       { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#495057', cursor: 'pointer', padding: '6px 0' },
  help:      { fontSize: 11, color: '#adb5bd', marginTop: 4, lineHeight: 1.5 },
}
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#495057' }

function Checklist({ titulo, items, sel, setSel }: {
  titulo: string
  items: { id: string; codigo: string; descricao: string }[]
  sel: string[]
  setSel: (v: string[]) => void
}) {
  const [b, setB] = useState('')
  const f = b ? items.filter(i => `${i.codigo} ${i.descricao}`.toLowerCase().includes(b.toLowerCase())) : items
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ ...S.label, margin: 0 }}>{titulo}</label>
        <span style={{ fontSize: 11, color: '#adb5bd' }}>{sel.length ? `${sel.length} de ${items.length}` : 'nenhuma'}</span>
        <div style={{ flex: 1 }} />
        <button style={miniBtn} onClick={() => setSel(items.map(i => i.id))}>Todas</button>
        <button style={miniBtn} onClick={() => setSel([])}>Limpar</button>
      </div>
      <input style={{ ...S.input, marginBottom: 6 }} placeholder="filtrar..." value={b} onChange={e => setB(e.target.value)} />
      <div style={{ maxHeight: 140, overflow: 'auto', border: '1px solid #f1f3f5', borderRadius: 8, padding: 4 }}>
        {f.map(i => (
          <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
            <span style={{ fontFamily: 'monospace', color: '#868e96', minWidth: 60 }}>{i.codigo}</span>
            <span>{i.descricao}</span>
          </label>
        ))}
        {!f.length && <div style={{ padding: 8, color: '#adb5bd', fontSize: 12 }}>Nenhum item.</div>}
      </div>
    </div>
  )
}

// Grade visual de período (anos × meses). Clique no início e depois no fim para marcar o intervalo (pode cruzar anos).
function PeriodPicker({ anos, ini, fim, onChange }: {
  anos: number[]; ini: Periodo; fim: Periodo; onChange: (ini: Periodo, fim: Periodo) => void
}) {
  const [anchor, setAnchor] = useState<Periodo | null>(null)
  const [hover, setHover]   = useState<Periodo | null>(null)
  const click = (y: number, m: number) => {
    const p = { ano: y, mes: m }
    if (anchor == null) { setAnchor(p); onChange(p, p) }
    else { const [a, b] = ordPer(anchor, p); onChange(a, b); setAnchor(null); setHover(null) }
  }
  const [lo, hi] = anchor ? ordPer(anchor, hover ?? anchor) : [ini, fim]
  const loI = perIdx(lo), hiI = perIdx(hi)
  const hb: CSSProperties = { fontSize: 10, color: '#adb5bd', textAlign: 'center', padding: '2px 0' }
  return (
    <div style={{ border: '1px solid #e9ecef', borderRadius: 8, padding: 8, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `44px repeat(12, minmax(20px, 1fr))`, gap: 2, minWidth: 360 }}
        onMouseLeave={() => setHover(null)}>
        <div />
        {MESES.map((m, i) => <div key={i} style={hb}>{m}</div>)}
        {anos.map(y => (
          <Fragment key={y}>
            <div onClick={() => { onChange({ ano: y, mes: 1 }, { ano: y, mes: 12 }); setAnchor(null); setHover(null) }} title="Selecionar o ano inteiro"
              style={{ fontSize: 12, fontWeight: 600, color: '#495057', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>{y}</div>
            {MESES.map((_, i) => {
              const mes = i + 1, idx = y * 12 + (mes - 1)
              const on = idx >= loI && idx <= hiI
              const isEnd = idx === loI || idx === hiI
              return (
                <div key={i} onClick={() => click(y, mes)} onMouseEnter={() => setHover({ ano: y, mes })} title={`${MESES[i]}/${y}`}
                  style={{ height: 24, borderRadius: 4, cursor: 'pointer',
                    background: isEnd ? '#3b5bdb' : on ? '#cfe0ff' : '#f8f9fa',
                    border: '1px solid ' + (isEnd ? '#3b5bdb' : on ? '#a5c4ff' : '#eef0f2') }} />
              )
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#adb5bd', marginTop: 6 }}>
        {anchor ? 'Clique no mês final…' : 'Clique no mês inicial e depois no final. (Clique no ano = ano inteiro.)'}
      </div>
    </div>
  )
}

function viewTab(active: boolean): CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
    borderRadius: 7, border: '1px solid', borderColor: active ? '#3b5bdb' : '#e9ecef',
    background: active ? '#edf2ff' : 'white', color: active ? '#3b5bdb' : '#868e96', fontWeight: active ? 600 : 500 }
}

type Period = number | 'TOTAL'
type Column = { key: string; label: string; cenarioKey?: string; period: Period; kind: 'value' | 'delta'; empresaId?: string }
type Group  = { label: string; span: number }

// ─── Component ───────────────────────────────────────────────
export default function RelatorioEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const saved0 = savedFiltro(id)

  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)
  const [linhas,    setLinhas]    = useState<Linha[]>([])
  const [raw,       setRaw]       = useState<ValMap>({})
  const [empresas,  setEmpresas]  = useState<Empresa[]>([])
  const [filiais,   setFiliais]   = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [ccs,       setCcs]       = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [versoes,   setVersoes]   = useState<Versao[]>([])
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(saved0.empresaSel) ? saved0.empresaSel : [])
  const [filialSel,  setFilialSel]  = useState<string[]>(Array.isArray(saved0.filialSel) ? saved0.filialSel : [])
  const [ccSel,      setCcSel]      = useState<string[]>(Array.isArray(saved0.ccSel) ? saved0.ccSel : [])
  const [versaoId,  setVersaoId]  = useState<string>(saved0.versaoId || '')
  const [pIni, setPIni] = useState<Periodo>(saved0.pIni && saved0.pIni.ano ? saved0.pIni : { ano: 2026, mes: 1 })
  const [pFim, setPFim] = useState<Periodo>(saved0.pFim && saved0.pFim.ano ? saved0.pFim : { ano: 2026, mes: 12 })
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [hideEmpty, setHideEmpty] = useState<boolean>(!!saved0.hideEmpty)
  const [hideOff, setHideOff] = useState<boolean>(!!saved0.hideOff)
  const [dupContas, setDupContas] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [masters, setMasters] = useState<any[]>([])
  const [views,     setViews]     = useState<ViewConfig[]>([])
  const [activeView, setActiveView] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editCell,  setEditCell]  = useState<{ linhaId: string; period: number } | null>(null)
  const [editVal,   setEditVal]   = useState('')
  const [adding,    setAdding]    = useState<{ paiId: string | null } | null>(null)
  const [newDesc,   setNewDesc]   = useState('')
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [linhaModal, setLinhaModal] = useState<Linha | null>(null)
  const [viewModal,  setViewModal]  = useState<ViewConfig | null>(null)
  const [contaModal, setContaModal] = useState<Linha | null>(null)
  const [razao, setRazao] = useState<any | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [contas,     setContas]     = useState<{ id: string; codigo: string; descricao: string; plano_id?: string; plano?: string }[]>([])
  const [contaLinks, setContaLinks] = useState<Record<string, any[]>>({})
  const [detalhado,  setDetalhado]  = useState<Record<string, Set<string>>>({})  // [cenario] -> Set(`linhaId-mes`) com detalhe (read-only)
  const [impMenu,    setImpMenu]    = useState(false)
  const [impMode,    setImpMode]    = useState<'linhas' | 'baseline_full' | 'baseline_add'>('baseline_full')
  const [colW,       setColW]       = useState<Record<string, number>>({})
  const [valErro,   setValErro]   = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)   // descarta resultados de carregamentos obsoletos (corrida async)
  const [snapOpen, setSnapOpen] = useState(false)
  const [snaps, setSnaps] = useState<any[]>([])
  const [snapBusy, setSnapBusy] = useState(false)
  const autoSnapRef = useRef(false)
  const [rawEmp, setRawEmp] = useState<Record<string, ValMap>>({})   // [empresaId][cenario][linha][pk] — modo "Por empresa"

  const anos = useMemo(() => { const out: number[] = []; for (let y = pIni.ano; y <= pFim.ano; y++) out.push(y); return out }, [pIni.ano, pFim.ano])
  const periodos: Periodo[] = useMemo(() => mesesNoRange(pIni, pFim), [pIni.ano, pIni.mes, pFim.ano, pFim.mes]) // eslint-disable-line

  // F2: âncora do dado é a linha mestre (conta_orcamentaria). Mapas linha do relatório <-> mestre.
  const rlOfOrc = useMemo(() => { const m: Record<string, string> = {}; for (const l of linhas) if (l.linha_orc_id) m[l.linha_orc_id] = l.id; return m }, [linhas])
  const masterIds = useMemo(() => linhas.map(l => l.linha_orc_id).filter(Boolean) as string[], [linhas])
  const orcOf = (rlId: string) => linhas.find(l => l.id === rlId)?.linha_orc_id || null

  // EXIBIÇÃO: despesa é mostrada positiva (o dado continua negativo p/ cálculo). natureza efetiva = herda do ancestral.
  const linById = useMemo(() => { const m: Record<string, Linha> = {}; for (const l of linhas) m[l.id] = l; return m }, [linhas])
  const natEff = (id: string | null): string => { let cur = id ? linById[id] : undefined, g = 0; while (cur && g++ < 60) { if (cur.natureza === 'RECEITA' || cur.natureza === 'DESPESA') return cur.natureza; cur = cur.pai_id ? linById[cur.pai_id] : undefined } return '' }
  const facOf = (l: Linha) => natEff(l.id) === 'DESPESA' ? -1 : 1

  // Dimensões obrigatórias e únicas para edição: 1 empresa, 1 versão, 1 ano, sem filtro de filial/CC
  const empresaUnica = empresaSel.length === 1 ? empresaSel[0] : null
  // filial/CC "todas" = nada marcado OU tudo marcado (ambos = sem filtro)
  const filialAll = filialSel.length === 0 || filialSel.length === filiais.length
  const ccAll = ccSel.length === 0 || ccSel.length === ccs.length
  const editavel = !!empresaUnica && !!versaoId && filialAll && ccAll

  // ── Loads
  const loadRelatorio = useCallback(async () => {
    if (!id) return
    const { data: r } = await supabase.from('relatorio').select('id,codigo,nome, categoria_relatorio(codigo)').eq('id', id).single()
    setRelatorio(r ? { id: r.id, codigo: r.codigo, nome: r.nome, categoria: (r as any).categoria_relatorio?.codigo || null } : null)
    const { data: ls } = await supabase.from('relatorio_linha').select('*').eq('relatorio_id', id).order('ordem', { nullsFirst: false })
    setLinhas((ls || []).map((l: any) => ({ ...l, _depth: 0 })))
  }, [id])

  const loadViews = useCallback(async () => {
    if (!id) return
    const { data } = await supabase.from('view_config').select('*').eq('relatorio_id', id).order('ordem', { nullsFirst: false })
    const vs = (data || []) as ViewConfig[]
    setViews(vs)
    if (vs.length) setActiveView(prev => prev || vs[0].id)
  }, [id])

  const loadDim = useCallback(async () => {
    const [{ data: emps }, { data: vers }, { data: fis }, { data: cc }] = await Promise.all([
      supabase.from('empresa').select('id,codigo,descricao').order('codigo'),
      supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
      supabase.from('filial').select('id,codigo,descricao').order('codigo'),
      supabase.from('centro_custo').select('id,codigo,descricao').order('codigo'),
    ])
    const e = emps || [], v = vers || []
    setEmpresas(e); setVersoes(v); setFiliais(fis || []); setCcs(cc || [])
    if (e.length) setEmpresaSel(prev => prev.length ? prev : [e[0].id])
    if (v.length) setVersaoId(prev => prev || v[0].id)
  }, [])

  const loadContas = useCallback(async () => {
    const { data } = await supabase.from('conta_contabil').select('id,codigo,descricao,plano_id, plano_contas(codigo)').order('codigo')
    setContas((data || []).map((c: any) => ({ id: c.id, codigo: c.codigo, descricao: c.descricao, plano_id: c.plano_id, plano: c.plano_contas?.codigo || '' })))
  }, [])
  const loadContaLinks = useCallback(async () => {
    if (!id) return
    // F2: conta_linha aponta para a linha mestre. Mapeia mestre -> linha do relatório.
    const ls = await fetchAllRows(() => supabase.from('relatorio_linha').select('id,linha_orc_id').eq('relatorio_id', id))
    const rlOf: Record<string, string> = {}; const masters: string[] = []
    for (const l of ls || []) if (l.linha_orc_id) { rlOf[l.linha_orc_id] = l.id; masters.push(l.linha_orc_id) }
    const data = masters.length ? await fetchAllRows(() => supabase.from('conta_linha')
      .select('id,conta_id,sinal,linha_id, conta_contabil(codigo,descricao, plano_contas(codigo))').in('linha_id', masters)) : []
    const map: Record<string, any[]> = {}
    for (const r of data || []) { const rl = rlOf[r.linha_id]; if (rl) (map[rl] ||= []).push(r) }
    setContaLinks(map)
  }, [id])

  const addContaMany = async (linhaId: string, contaIds: string[], sinal = 1) => {
    const master = orcOf(linhaId)
    if (!master) { alert('Linha sem vínculo com a estrutura compartilhada (rode a migração F1/F2).'); return }
    const ex = new Set((contaLinks[linhaId] || []).map((m: any) => m.conta_id))
    const novos = contaIds.filter(c => !ex.has(c))
    if (!novos.length) return
    await ensureSnapshot()
    const { error } = await supabase.from('conta_linha').insert(novos.map(c => ({ tenant_id: TENANT_ID, conta_id: c, linha_id: master, sinal })))
    if (error) { alert('Erro: ' + error.message); return }
    loadContaLinks()
  }
  const removeConta = async (rid: string) => { await ensureSnapshot(); await supabase.from('conta_linha').delete().eq('id', rid); loadContaLinks() }
  const toggleSinal = async (rid: string, sinal: number) => { await ensureSnapshot(); await supabase.from('conta_linha').update({ sinal }).eq('id', rid); loadContaLinks() }

  useEffect(() => {
    // Mostra as linhas assim que o relatório carrega; o resto vem em segundo plano.
    setLoading(true)
    loadRelatorio().finally(() => setLoading(false))
    loadDim(); loadViews(); loadContas(); loadContaLinks()
  }, [id]) // eslint-disable-line

  // Salva o filtro do usuário quando muda (restaurado via lazy-init de useState)
  useEffect(() => {
    if (!id) return
    localStorage.setItem('planorc_filtro_' + id, JSON.stringify({ empresaSel, filialSel, ccSel, versaoId, pIni, pFim, hideEmpty, hideOff }))
  }, [empresaSel, filialSel, ccSel, versaoId, pIni, pFim, hideEmpty, hideOff, id])

  const view: ViewConfig = useMemo(() => {
    const f = views.find(v => v.id === activeView)
    if (f) return f
    return { id: '__default', nome: 'Mensal', ordem: 0, funcao: 'MENSAL', cenarios: versaoId ? [versaoId] : [], filtros: {}, _synthetic: true }
  }, [views, activeView, versaoId])

  const cenariosAtivos = useMemo(() => {
    const set = new Set<string>(view.cenarios)
    if (versaoId) set.add(versaoId)
    return Array.from(set)
  }, [view, versaoId])

  // ── Agrupar colunas por EMPRESA (visão "Por empresa"; só leitura; não em comparativo)
  const colEmpresa = !!(view.filtros?.colEmpresa) && view.funcao !== 'COMPARATIVO'
  const empsCols = useMemo(() => (empresaSel.length ? empresaSel : empresas.map(e => e.id)), [empresaSel, empresas])
  const empCodById = useMemo(() => Object.fromEntries(empresas.map(e => [e.id, `${e.codigo} · ${e.descricao}`])), [empresas])

  // ── Carrega valores brutos por cenário
  const loadValores = useCallback(async () => {
    if (!empresaSel.length || !cenariosAtivos.length) { setRaw({}); setDetalhado({}); return }
    const myseq = ++loadSeq.current   // só conta os carregamentos "de verdade" (com deps prontas)
    try {
    // filtra filial/CC só quando é um subconjunto (nem vazio nem tudo = sem filtro, inclui consolidados null)
    const filialFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
    const ccFilter = (ccSel.length > 0 && ccSel.length < ccs.length) ? ccSel : null
    const isBalanco = relatorio?.categoria === 'BP'   // Balanço lê o realizado do saldo (fat_saldo)
    // carrega só os meses exibidos (evita puxar o ano inteiro)
    const mesesExib = [...new Set(periodos.map(p => p.mes))]
    const next: ValMap = {}
    const det: Record<string, Set<string>> = {}
    // Aviso de DE-PARA: conta amarrada a >1 linha deste relatório (consulta pequena)
    const dups = new Set<string>()
    if (cenariosAtivos.includes(REALIZADO) && masterIds.length) {
      const cl = await fetchAllRows(() => supabase.from('conta_linha').select('conta_id,linha_id').in('linha_id', masterIds))
      const seen: Record<string, string> = {}
      for (const m of cl || []) { if (seen[m.conta_id] && seen[m.conta_id] !== m.linha_id) dups.add(m.conta_id); seen[m.conta_id] = m.linha_id }
    }
    setDupContas(Array.from(dups))
    // Totais AGREGADOS NO BANCO (RPC) — devolve só linha/mês somados (rápido p/ qualquer volume)
    for (const cen of cenariosAtivos) {
      const map: RawValues = {}
      if (!masterIds.length) { next[cen] = map; continue }
      if (cen === REALIZADO) {
        if (isBalanco) {
          // Balanço: realizado = SALDO (balancete) por mês, lido do fat_saldo
          for (const y of anos) {
            const { data, error } = await supabase.rpc('relatorio_saldo_agg',
              { p_empresas: empresaSel, p_ano: y, p_meses: mesesExib, p_linhas: masterIds, p_filiais: filialFilter })
            if (error) throw new Error(error.message)
            for (const r of data || []) { const rl = rlOfOrc[r.linha_id]; if (!rl) continue; (map[rl] ||= {})[`${y}-${r.mes}`] = { valor: Number(r.saldo) || 0 } }
          }
        } else {
          const { data, error } = await supabase.rpc('relatorio_realizado_agg',
            { p_empresas: empresaSel, p_anos: anos, p_meses: mesesExib, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccFilter })
          if (error) throw new Error(error.message)
          for (const r of data || []) { const rl = rlOfOrc[r.linha_id]; if (!rl) continue; (map[rl] ||= {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0 } }
        }
      } else {
        const { data, error } = await supabase.rpc('relatorio_orcado_agg',
          { p_versao: cen, p_empresas: empresaSel, p_anos: anos, p_meses: mesesExib, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccFilter })
        if (error) throw new Error(error.message)
        for (const r of data || []) {
          const rl = rlOfOrc[r.linha_id]; if (!rl) continue
          const k = `${r.ano}-${r.mes}`
          ;(map[rl] ||= {})[k] = (Number(r.n) === 1 && r.expr) ? { expressao: r.expr } : { valor: Number(r.valor) || 0 }
          if (r.det) { (det[cen] ||= new Set()).add(`${rl}-${k}`) }
        }
      }
      next[cen] = map
    }

    // ── Modo "Por empresa": carrega os valores POR empresa (uma RPC por empresa/cenário)
    const nextEmp: Record<string, ValMap> = {}
    if (colEmpresa && masterIds.length) {
      for (const eid of empsCols) {
        const m: ValMap = {}
        for (const cen of cenariosAtivos) {
          const map: RawValues = {}
          if (cen === REALIZADO) {
            if (isBalanco) {
              for (const y of anos) {
                const { data, error } = await supabase.rpc('relatorio_saldo_agg', { p_empresas: [eid], p_ano: y, p_meses: mesesExib, p_linhas: masterIds, p_filiais: filialFilter })
                if (error) throw new Error(error.message)
                for (const r of data || []) { const rl = rlOfOrc[r.linha_id]; if (!rl) continue; (map[rl] ||= {})[`${y}-${r.mes}`] = { valor: Number(r.saldo) || 0 } }
              }
            } else {
              const { data, error } = await supabase.rpc('relatorio_realizado_agg', { p_empresas: [eid], p_anos: anos, p_meses: mesesExib, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccFilter })
              if (error) throw new Error(error.message)
              for (const r of data || []) { const rl = rlOfOrc[r.linha_id]; if (!rl) continue; (map[rl] ||= {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0 } }
            }
          } else {
            const { data, error } = await supabase.rpc('relatorio_orcado_agg', { p_versao: cen, p_empresas: [eid], p_anos: anos, p_meses: mesesExib, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccFilter })
            if (error) throw new Error(error.message)
            for (const r of data || []) { const rl = rlOfOrc[r.linha_id]; if (!rl) continue; const k = `${r.ano}-${r.mes}`; (map[rl] ||= {})[k] = (Number(r.n) === 1 && r.expr) ? { expressao: r.expr } : { valor: Number(r.valor) || 0 } }
          }
          m[cen] = map
        }
        nextEmp[eid] = m
      }
    }

      if (myseq !== loadSeq.current) return   // um carregamento mais novo começou → descarta este
      setRaw(next); setDetalhado(det); setRawEmp(nextEmp); setValErro(null)
    } catch (e: any) {
      console.error('loadValores erro:', e)
      setValErro(e?.message ?? String(e))
    }
  }, [empresaSel, filialSel, ccSel, pIni.ano, pFim.ano, pIni.mes, pFim.mes, cenariosAtivos, filiais.length, ccs.length, id, masterIds, rlOfOrc, relatorio, colEmpresa, empsCols]) // eslint-disable-line

  useEffect(() => { loadValores() }, [loadValores])

  // ── Pontos de restauração (snapshots no servidor)
  const loadSnaps = useCallback(async () => {
    if (!id) return
    const { data } = await supabase.from('relatorio_snapshot').select('id,criado_em,descricao,auto').eq('relatorio_id', id).order('criado_em', { ascending: false }).limit(20)
    setSnaps(data || [])
  }, [id])
  const criarSnap = async (auto: boolean, descricao?: string | null) => {
    if (!id) return
    setSnapBusy(true)
    const { error } = await supabase.rpc('criar_snapshot', { p_relatorio: id, p_descricao: descricao ?? null, p_auto: auto })
    setSnapBusy(false)
    if (error) { if (!auto) alert('Erro ao salvar ponto: ' + error.message); return }
    loadSnaps()
  }
  const restaurarSnap = async (sid: string) => {
    if (!confirm('Restaurar este ponto?\n\nIsto SUBSTITUI o estado atual do relatório (linhas, views, amarrações e valores orçados das contas dele). Atenção: como valores e DE-PARA são compartilhados, outros relatórios que usam as mesmas contas também serão afetados.')) return
    setSnapBusy(true)
    const { error } = await supabase.rpc('restaurar_snapshot', { p_snapshot: sid })
    setSnapBusy(false)
    if (error) { alert('Erro ao restaurar: ' + error.message); return }
    setSnapOpen(false)
    await loadRelatorio(); await loadViews(); await loadContaLinks(); await loadValores(); loadSnaps()
  }
  // snapshot LAZY: cria o ponto só na 1ª alteração da sessão (captura o estado de ANTES).
  // Consultar o relatório não gera ponto. Resetado ao trocar de relatório.
  useEffect(() => { autoSnapRef.current = false }, [id])
  const ensureSnapshot = useCallback(async () => {
    if (autoSnapRef.current || !id) return
    autoSnapRef.current = true   // marca antes do await p/ evitar duplicar em edições rápidas
    const { error } = await supabase.rpc('criar_snapshot', { p_relatorio: id, p_descricao: null, p_auto: true })
    if (error) { autoSnapRef.current = false; return }
    loadSnaps()
  }, [id, loadSnaps])

  // ── Cálculo por cenário
  const linhasCalc = linhas as LinhaCalc[]
  const computed = useMemo(() => {
    const out: Record<string, Computed> = {}
    for (const cen of cenariosAtivos) out[cen] = computeCenario(linhasCalc, raw[cen] || {}, periodos)
    return out
  }, [linhas, raw, cenariosAtivos, periodos])
  // ── Período: granularidade vem da VIEW; o intervalo (de–até, multi-ano) vem do filtro
  const gran = (view.filtros?.granularidade as string) || 'MENSAL'
  const mpb = MPB[gran] || 1
  const showYear = pIni.ano !== pFim.ano
  const buckets = useMemo(() => {
    const arr: { label: string; meses: Periodo[] }[] = []
    for (let i = 0; i < periodos.length; i += mpb) {
      const grp = periodos.slice(i, i + mpb)
      const first = grp[0]
      arr.push({ label: bucketLabel(gran, first.mes, first.ano, showYear), meses: grp })
    }
    return arr
  }, [periodos, mpb, gran, showYear])
  const displayedMeses = useMemo(() => buckets.flatMap(b => b.meses), [buckets])
  const bucketTotais = useMemo(() => {
    const out: Record<string, Record<string, number>[]> = {}
    for (const cen of cenariosAtivos) out[cen] = buckets.map(b => computeTotais(linhasCalc, computed[cen] || {}, b.meses))
    return out
  }, [linhas, computed, cenariosAtivos, buckets]) // eslint-disable-line
  const totalByCen = useMemo(() => {
    const out: Record<string, Record<string, number>> = {}
    for (const cen of cenariosAtivos) out[cen] = computeTotais(linhasCalc, computed[cen] || {}, displayedMeses)
    return out
  }, [linhas, computed, cenariosAtivos, displayedMeses]) // eslint-disable-line

  const cellVal = (cen: string, linhaId: string, period: Period): number =>
    period === 'TOTAL' ? (totalByCen[cen]?.[linhaId] ?? 0) : (bucketTotais[cen]?.[period as number]?.[linhaId] ?? 0)

  // ── Cálculo POR empresa (modo "Por empresa")
  const computedEmp = useMemo(() => {
    const out: Record<string, Record<string, Computed>> = {}
    if (!colEmpresa) return out
    for (const eid of empsCols) { out[eid] = {}; for (const cen of cenariosAtivos) out[eid][cen] = computeCenario(linhasCalc, rawEmp[eid]?.[cen] || {}, periodos) }
    return out
  }, [colEmpresa, empsCols, cenariosAtivos, rawEmp, linhas, periodos]) // eslint-disable-line
  const bucketTotaisEmp = useMemo(() => {
    const out: Record<string, Record<string, Record<string, number>[]>> = {}
    if (!colEmpresa) return out
    for (const eid of empsCols) { out[eid] = {}; for (const cen of cenariosAtivos) out[eid][cen] = buckets.map(b => computeTotais(linhasCalc, computedEmp[eid]?.[cen] || {}, b.meses)) }
    return out
  }, [colEmpresa, empsCols, cenariosAtivos, computedEmp, buckets]) // eslint-disable-line
  const totalByCenEmp = useMemo(() => {
    const out: Record<string, Record<string, Record<string, number>>> = {}
    if (!colEmpresa) return out
    for (const eid of empsCols) { out[eid] = {}; for (const cen of cenariosAtivos) out[eid][cen] = computeTotais(linhasCalc, computedEmp[eid]?.[cen] || {}, displayedMeses) }
    return out
  }, [colEmpresa, empsCols, cenariosAtivos, computedEmp, displayedMeses]) // eslint-disable-line
  const cellValE = (eid: string, cen: string, linhaId: string, period: Period): number =>
    period === 'TOTAL' ? (totalByCenEmp[eid]?.[cen]?.[linhaId] ?? 0) : (bucketTotaisEmp[eid]?.[cen]?.[period as number]?.[linhaId] ?? 0)

  // ── Árvore / colapso
  const temFilhos = (lid: string) => linhas.some(l => l.pai_id === lid)
  const toggle = (lid: string) => setCollapsed(prev => { const n = new Set(prev); n.has(lid) ? n.delete(lid) : n.add(lid); return n })
  const tree = buildTree(linhas)
  // "Ocultar vazias": mantém linhas com valor em alguma coluna do período + seus ancestrais
  const keepIds = useMemo(() => {
    if (!hideEmpty) return null
    const hasVal = (lid: string) => cenariosAtivos.some(cen =>
      (totalByCen[cen]?.[lid] ?? 0) !== 0 || buckets.some((_, i) => (bucketTotais[cen]?.[i]?.[lid] ?? 0) !== 0))
    const keep = new Set<string>()
    for (const l of tree) {
      if (hasVal(l.id)) { let c: Linha | undefined = l; while (c) { keep.add(c.id); c = linhas.find(x => x.id === c!.pai_id) } }
    }
    return keep
  }, [hideEmpty, tree, linhas, cenariosAtivos, buckets, bucketTotais, totalByCen])
  const visivel = tree.filter(l => {
    if (hideOff && l.desativada) return false
    if (keepIds && !keepIds.has(l.id)) return false
    let c = linhas.find(x => x.id === l.pai_id)
    while (c) { if (collapsed.has(c.id)) return false; c = linhas.find(x => x.id === c!.pai_id) }
    return true
  })
  const maxDepth = tree.reduce((m, l) => Math.max(m, l._depth ?? 0), 0)
  // Onde inserir a linha-de-inclusão inline (após o último descendente do pai)
  const addAfterIndex = (() => {
    if (!adding || adding.paiId == null) return -1
    const pIdx = visivel.findIndex(x => x.id === adding.paiId)
    if (pIdx < 0) return -1
    const pDepth = visivel[pIdx]._depth ?? 0
    let k = pIdx + 1
    while (k < visivel.length && (visivel[k]._depth ?? 0) > pDepth) k++
    return k - 1
  })()
  const addChildDepth = (() => {
    if (!adding || adding.paiId == null) return 0
    const p = visivel.find(x => x.id === adding.paiId)
    return ((p?._depth ?? 0) + 1) * 18
  })()
  const expandirTudo = () => setCollapsed(new Set())
  const recolherAteNivel = (n: number) => {
    const next = new Set<string>()
    for (const l of tree) if ((l._depth ?? 0) >= n - 1 && temFilhos(l.id)) next.add(l.id)
    setCollapsed(next)
  }

  // ── Fórmula: exibição por NOME da linha (interno = código)
  const codeToDesc = useMemo(() => Object.fromEntries(linhas.map(l => [l.codigo, l.descricao])), [linhas])
  const descToCode = useMemo(() => { const m: Record<string, string> = {}; linhas.forEach(l => { if (!(l.descricao in m)) m[l.descricao] = l.codigo }); return m }, [linhas])
  const toDisplay = (expr: string | null | undefined) => expr ? expr.replace(/\[([^\]]+)\]/g, (_m, c) => `[${codeToDesc[c] ?? c}]`) : (expr ?? '')
  const toStored  = (expr: string | null | undefined) => expr ? expr.replace(/\[([^\]]+)\]/g, (_m, c) => `[${descToCode[c] ?? c}]`) : (expr ?? '')

  // ── Razão (drill da célula até os lançamentos)
  const linhasAnaliticasDe = (rootId: string): string[] => {
    const out: string[] = []
    const root = linhas.find(l => l.id === rootId)
    if (root?.tipo_linha === 'ANALITICA') out.push(rootId)
    const rec = (pid: string) => {
      for (const c of linhas.filter(l => l.pai_id === pid)) {
        if (c.tipo_linha === 'ANALITICA') out.push(c.id)
        rec(c.id)
      }
    }
    rec(rootId)
    return out
  }
  const abrirRazao = (l: Linha, period: Period, cen: string) => {
    if (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR' || l.tipo_linha === 'ESPACO') return
    if (!empresaSel.length) return
    const filialFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
    const ccFilter = (ccSel.length > 0 && ccSel.length < ccs.length) ? ccSel : null
    const meses: Periodo[] = period === 'TOTAL' ? displayedMeses : (buckets[period as number]?.meses ?? [])
    const lbl0 = period === 'TOTAL' ? 'Período' : (buckets[period as number]?.label ?? '')
    const periodoLabel = period === 'TOTAL'
      ? `${MESES[displayedMeses[0]?.mes - 1] ?? ''}/${displayedMeses[0]?.ano ?? ''} – ${MESES[displayedMeses[displayedMeses.length - 1]?.mes - 1] ?? ''}/${displayedMeses[displayedMeses.length - 1]?.ano ?? ''}`
      : lbl0
    // Editável: 1 mês, linha analítica, cenário = versão (orçado)
    const editavelRazao = cen !== REALIZADO && l.tipo_linha === 'ANALITICA' && meses.length === 1
    // F2: orçado consulta por linha MESTRE (fat_orcado.linha_id agora é mestre)
    const linhaIdsRl = editavelRazao ? [l.id] : linhasAnaliticasDe(l.id)
    const linhaIds = linhaIdsRl.map(orcOf).filter(Boolean) as string[]
    // Realizado: resolve as contas amarradas (conta_linha) à linha e sua subárvore + sinal
    const subtreeIds = (rootId: string): string[] => { const out = [rootId]; const rec = (pid: string) => { for (const c of linhas.filter(x => x.pai_id === pid)) { out.push(c.id); rec(c.id) } }; rec(rootId); return out }
    const contaSinal: Record<string, number> = {}
    for (const lid of subtreeIds(l.id)) for (const m of (contaLinks[lid] || [])) contaSinal[m.conta_id] = m.sinal ?? 1
    const contaIds = Object.keys(contaSinal)
    if ((cen === REALIZADO ? !contaIds.length : !linhaIds.length) || !meses.length) {
      // ainda abre o modal (mostra a mensagem de "sem contas amarradas")
    }
    setRazao({
      titulo: l.descricao, cen, cenLabel: cenarioLabel(cen), periodoLabel, meses, perAdd: meses.length === 1 ? meses[0] : null,
      linhaIds, contaIds, contaSinal, empresaSel, filialFilter, ccFilter,
      ccById: Object.fromEntries(ccs.map(c => [c.id, c])),
      contaById: Object.fromEntries(contas.map(c => [c.id, c])),
      linhaById: Object.fromEntries(linhas.map(x => [x.linha_orc_id, x.descricao])),
      empById: Object.fromEntries(empresas.map(e => [e.id, e])),
      filById: Object.fromEntries(filiais.map(f => [f.id, f])),
      editavel: editavelRazao, versaoId: cen, linhaId: orcOf(l.id) || l.id,
      empresasList: empresas, filiaisList: filiais, ccsList: ccs,
      isBalanco: relatorio?.categoria === 'BP',
      onChanged: loadValores,
      onBeforeChange: ensureSnapshot,
    })
  }

  // ── Largura de colunas (redimensionável)
  const dw = (key: string, def: number) => colW[key] ?? def
  const startResize = (key: string, def: number) => (e: { clientX: number; preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = colW[key] ?? def
    const onMove = (ev: MouseEvent) => setColW(p => ({ ...p, [key]: Math.max(36, startW + (ev.clientX - startX)) }))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  const resizeHandle = (key: string, def: number) => (
    <div
      onMouseDown={startResize(key, def)}
      onClick={e => e.stopPropagation()}
      style={{ position: 'absolute', top: 0, bottom: 0, right: -5, width: 10, cursor: 'col-resize', zIndex: 5 }}
    />
  )

  // ── Colunas conforme view
  const cenarioLabel = (key: string) => key === REALIZADO ? 'Real.' : (versoes.find(v => v.id === key)?.codigo ?? '—')
  const { columns, groups, twoRow } = useMemo<{ columns: Column[]; groups: Group[]; twoRow: boolean }>(() => {
    const cens = view.cenarios.length ? view.cenarios : (versaoId ? [versaoId] : [])
    const primary = cens[0] || versaoId
    // Por empresa: cada empresa é um grupo; embaixo repetem os períodos (+ Total) do cenário primário
    if (colEmpresa) {
      const base: { label: string; period: Period }[] = buckets.map((b, i) => ({ label: b.label, period: i as Period }))
      // Total só quando há mais de um período (com 1 período ele duplica a coluna). ACM = só Total.
      if (view.funcao === 'ACM') { base.length = 0; base.push({ label: 'Total', period: 'TOTAL' as Period }) }
      else if (buckets.length > 1) base.push({ label: 'Total', period: 'TOTAL' as Period })
      const cols: Column[] = [], grps: Group[] = []
      for (const eid of empsCols) {
        for (const bc of base) cols.push({ key: `${eid}-${bc.period}`, label: bc.label, cenarioKey: primary, period: bc.period, kind: 'value', empresaId: eid })
        grps.push({ label: empCodById[eid] || '—', span: base.length })
      }
      return { columns: cols, groups: grps, twoRow: true }
    }
    if (view.funcao === 'COMPARATIVO') {
      const pers: Period[] = [...buckets.map((_, i) => i as Period), 'TOTAL']
      const cols: Column[] = [], grps: Group[] = []
      for (const per of pers) {
        const lbl = per === 'TOTAL' ? 'Total' : buckets[per as number].label
        let span = 0
        for (const cen of cens) { cols.push({ key: `${per}-${cen}`, label: cenarioLabel(cen), cenarioKey: cen, period: per, kind: 'value' }); span++ }
        if (cens.length >= 2) { cols.push({ key: `${per}-d`, label: 'Δ%', period: per, kind: 'delta' }); span++ }
        grps.push({ label: lbl, span })
      }
      return { columns: cols, groups: grps, twoRow: true }
    }
    if (view.funcao === 'ACM')
      return { columns: [{ key: 'acm', label: 'Total', cenarioKey: primary, period: 'TOTAL', kind: 'value' }], groups: [], twoRow: false }
    const cols: Column[] = buckets.map((b, i) => ({ key: `b${i}`, label: b.label, cenarioKey: primary, period: i as Period, kind: 'value' as const }))
    const total: Column = { key: 'total', label: 'Total', cenarioKey: primary, period: 'TOTAL', kind: 'value' }
    if (view.funcao === 'MENSAL_ACM') return { columns: [{ ...total, label: 'Acum.' }, ...cols], groups: [], twoRow: false }
    return { columns: [...cols, total], groups: [], twoRow: false }
  }, [view, versaoId, versoes, buckets, colEmpresa, empsCols, empCodById]) // eslint-disable-line

  // ── Salvar célula (valor OU fórmula =)
  const saveCell = async (linhaId: string, per: Periodo) => {
    const master = orcOf(linhaId)
    if (!versaoId || !empresaUnica || !master) { setEditCell(null); return }
    setSaving(true)
    await ensureSnapshot()
    const fac = facOf(linById[linhaId] || ({} as Linha))   // exibe positivo p/ despesa → grava com sinal
    const txt = editVal.trim()
    const isFormula = txt.startsWith('=')
    const valor = isFormula ? null : fac * parseNum(txt)
    const expressao = isFormula ? toStored(txt) : null
    const { data: ex } = await supabase.from('fat_orcado').select('id')
      .eq('versao_id', versaoId).eq('linha_id', master).eq('empresa_id', empresaUnica)
      .eq('ano', per.ano).eq('mes', per.mes).is('filial_id', null).is('cc_id', null).maybeSingle()
    if (ex) await supabase.from('fat_orcado').update({ valor, expressao, origem: 'MANUAL' }).eq('id', ex.id)
    else await supabase.from('fat_orcado').insert({
      tenant_id: TENANT_ID, versao_id: versaoId, linha_id: master, empresa_id: empresaUnica,
      filial_id: null, cc_id: null, ano: per.ano, mes: per.mes, valor, expressao, origem: 'MANUAL', dims: {},
    })
    setRaw(prev => ({ ...prev, [versaoId]: { ...(prev[versaoId] || {}),
      [linhaId]: { ...(prev[versaoId]?.[linhaId] || {}), [pkey(per)]: { valor, expressao } } } }))
    setEditCell(null); setSaving(false)
  }

  // Salva a fórmula NO NÍVEL DA LINHA (vale p/ todas as empresas; não grava na fato)
  const saveLineExpr = async (l: Linha, txt: string) => {
    const t = txt.trim()
    const expr = t ? toStored(t.startsWith('=') ? t : '=' + t) : null
    setSaving(true)
    await ensureSnapshot()
    const { error } = await supabase.from('relatorio_linha').update({ expressao: expr }).eq('id', l.id)
    if (!error) setLinhas(prev => prev.map(x => x.id === l.id ? { ...x, expressao: expr } : x))
    setEditCell(null); setSaving(false)
  }
  // Decide onde gravar a edição da célula: fórmula de linha (FORMULA/INDICADOR) vs valor na fato
  const commitCell = (linhaId: string, period: number) => {
    const l = linhas.find(x => x.id === linhaId)
    if (l && (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR')) { saveLineExpr(l, editVal); return }
    const perUnico = mpb === 1 ? buckets[period]?.meses[0] : null
    if (perUnico) saveCell(linhaId, perUnico); else setEditCell(null)
  }

  // ── Replicar célula até o fim do período exibido (fill-to-right, multi-ano)
  const fillRight = async (linhaId: string, fromPer: Periodo, txt: string) => {
    const master = orcOf(linhaId)
    if (!versaoId || !empresaUnica || !master) { setEditCell(null); return }
    setSaving(true)
    await ensureSnapshot()
    const fac = facOf(linById[linhaId] || ({} as Linha))
    const t = txt.trim()
    const isFormula = t.startsWith('=')
    const valor = isFormula ? null : fac * parseNum(t)
    const expressao = isFormula ? toStored(t) : null
    const updates: Record<string, { valor: number | null; expressao: string | null }> = {}
    const start = displayedMeses.findIndex(p => samePer(p, fromPer))
    const alvos = start >= 0 ? displayedMeses.slice(start) : [fromPer]
    for (const per of alvos) {
      const { data: ex } = await supabase.from('fat_orcado').select('id')
        .eq('versao_id', versaoId).eq('linha_id', master).eq('empresa_id', empresaUnica)
        .eq('ano', per.ano).eq('mes', per.mes).is('filial_id', null).is('cc_id', null).maybeSingle()
      if (ex) await supabase.from('fat_orcado').update({ valor, expressao, origem: 'MANUAL' }).eq('id', ex.id)
      else await supabase.from('fat_orcado').insert({
        tenant_id: TENANT_ID, versao_id: versaoId, linha_id: master, empresa_id: empresaUnica,
        filial_id: null, cc_id: null, ano: per.ano, mes: per.mes, valor, expressao, origem: 'MANUAL', dims: {},
      })
      updates[pkey(per)] = { valor, expressao }
    }
    setRaw(prev => ({ ...prev, [versaoId]: { ...(prev[versaoId] || {}),
      [linhaId]: { ...(prev[versaoId]?.[linhaId] || {}), ...updates } } }))
    setEditCell(null); setSaving(false)
  }

  // ── Exportar / Importar matriz (Excel) desta empresa/versão/ano
  const exportMatrix = () => {
    const ano = pIni.ano
    const empCod = empresaUnica ? (empresas.find(e => e.id === empresaUnica)?.codigo || 'EMP') : 'VARIAS'
    const verCod = versoes.find(v => v.id === versaoId)?.codigo || 'VER'
    const header = ['linha_codigo', 'descricao', 'tipo', ...MESES]
    const aoa: any[][] = [header]
    for (const l of buildTree(linhas)) {
      const row: any[] = [l.codigo, l.descricao, l.tipo_linha]
      for (let m = 1; m <= 12; m++) {
        if (l.tipo_linha === 'ANALITICA') {
          const cell = raw[versaoId]?.[l.id]?.[`${ano}-${m}`]
          row.push(cell?.expressao ? cell.expressao : (cell?.valor ?? ''))
        } else {
          row.push(computed[versaoId]?.[l.id]?.[`${ano}-${m}`] ?? '')
        }
      }
      aoa.push(row)
    }
    downloadSheet(`relatorio_${relatorio?.codigo || 'rel'}_${empCod}_${verCod}_${ano}.xlsx`, aoa)
  }

  // ── Modelos (templates) para cada tipo de importação
  const modeloLinhas = () => downloadSheet('modelo_linhas.xlsx', [
    ['codigo', 'descricao'], ['2', 'DESPESAS'], ['220', 'Despesas Administrativas'], ['22004', 'Aluguel de imóveis'],
  ])
  const modeloBaseline = () => {
    const ano = pIni.ano
    const dates = Array.from({ length: 12 }, (_, i) => new Date(ano, i, 1))
    const header = ['Empresa', 'Filial', 'ItemOrcamento', 'Centro De Custo', 'Area', 'Divisão', 'BU', 'Histórico', ...dates]
    const ex = ['01', '2001', '22004', '111', '3-CSC', '0', '0', 'Baseline Despesas', ...Array(12).fill(1000)]
    downloadSheet(`modelo_orcado_baseline_${ano}.xlsx`, [header, ex])
  }
  // ── Importar estrutura de linhas (Linhas Orçamentárias)
  const importLinhas = async (file: File) => {
    if (!id) return
    if (!confirm('Importar linhas orçamentárias para este relatório?\n(Cria linhas novas com hierarquia pelo código; mantém as existentes.)')) return
    setSaving(true)
    await ensureSnapshot()
    try {
      const wb = await readWorkbook(file)
      const sn = wb.SheetNames.find((n: string) => /linha/i.test(n)) || wb.SheetNames[0]
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1 }) as any[]
      const items: { cod: string; desc: string }[] = []
      const seen = new Set<string>()
      for (const row of aoa) {
        const cod = String(row?.[0] ?? '').trim(); const desc = String(row?.[1] ?? '').trim()
        if (!cod || !desc) continue
        if (!/^[0-9]+$/.test(cod)) continue                // só códigos numéricos (ignora 'Mascara' 1.01.01 etc.)
        if (/mascara/i.test(desc)) continue
        if (seen.has(cod)) continue; seen.add(cod)
        items.push({ cod, desc })
      }
      if (!items.length) { alert('Nenhuma linha (código numérico + descrição) encontrada na aba.'); setSaving(false); return }
      const codeSet = new Set(items.map(i => i.cod))
      const parentOf: Record<string, string | null> = {}
      items.forEach(i => { parentOf[i.cod] = parentByPrefix(i.cod, codeSet) })
      const ehPai = new Set<string>(); items.forEach(i => { const p = parentOf[i.cod]; if (p) ehPai.add(p) })
      const { data: ex } = await supabase.from('relatorio_linha').select('codigo').eq('relatorio_id', id)
      const existing = new Set((ex || []).map((l: any) => String(l.codigo)))
      const novos = items.filter(i => !existing.has(i.cod))
      if (novos.length) {
        const ins = novos.map((i, idx) => ({
          relatorio_id: id, codigo: i.cod, descricao: i.desc,
          tipo_linha: ehPai.has(i.cod) ? 'SOMAR_FILHOS' : 'ANALITICA', natureza: 'NEUTRO',
          ordem: (idx + 1) * 10, formato: 'NUMERO', casas_decimais: 0,
        }))
        const { error } = await supabase.from('relatorio_linha').insert(ins); if (error) throw error
      }
      const { data: all2 } = await supabase.from('relatorio_linha').select('id,codigo').eq('relatorio_id', id)
      const idByCod: Record<string, string> = {}; (all2 || []).forEach((l: any) => { idByCod[String(l.codigo)] = l.id })
      for (const i of items) {
        const p = parentOf[i.cod]
        if (p && idByCod[i.cod] && idByCod[p]) await supabase.from('relatorio_linha').update({ pai_id: idByCod[p] }).eq('id', idByCod[i.cod])
      }
      // Hub PLANO: a conta orçamentária guarda só as ANALÍTICAS (lançáveis). A hierarquia/totalização
      // vive no relatório (relatorio_linha); totalizadores ficam com linha_orc_id nulo.
      const folhas = items.filter(i => !ehPai.has(i.cod))
      if (folhas.length) await supabase.from('conta_orcamentaria').upsert(
        folhas.map(i => ({ tenant_id: TENANT_ID, codigo: i.cod, descricao: i.desc, tipo_linha: 'ANALITICA', natureza: 'NEUTRO' })),
        { onConflict: 'tenant_id,codigo', ignoreDuplicates: true })
      const masters = await fetchAllRows(() => supabase.from('conta_orcamentaria').select('id,codigo'))
      const masterByCod: Record<string, string> = {}; masters.forEach((m: any) => { masterByCod[String(m.codigo)] = m.id })
      for (const i of folhas) {
        if (idByCod[i.cod] && masterByCod[i.cod]) await supabase.from('relatorio_linha').update({ linha_orc_id: masterByCod[i.cod] }).eq('id', idByCod[i.cod])
      }
      await loadRelatorio()
      alert(`${novos.length} linhas criadas (${items.length} no arquivo).`)
    } catch (e: any) { alert('Erro ao importar linhas: ' + (e?.message ?? JSON.stringify(e))) }
    setSaving(false)
  }

  // ── Importar orçado Baseline (largo, detalhado por empresa/filial/CC/dims)
  const importBaseline = async (file: File, modo: 'full' | 'add') => {
    if (!versaoId) { alert('Selecione a versão de destino no topo.'); return }
    const verCod = versoes.find(v => v.id === versaoId)?.codigo
    const msgModo = modo === 'full'
      ? `SUBSTITUIR (full load): apaga TODO o orçado manual da versão "${verCod}" das empresas presentes no arquivo e importa de novo.`
      : `ADICIONAR: soma os valores ao orçado já existente da versão "${verCod}" (não apaga nada).`
    if (!confirm(`${msgModo}\n\nConfirmar importação?`)) return
    setSaving(true)
    await ensureSnapshot()
    try {
      const wb = await readWorkbook(file)
      let aoa: any[] | null = null
      for (const n of wb.SheetNames) {
        const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }) as any[]
        if (a[0] && a[0].some((h: any) => typeof h === 'string' && h.toLowerCase().replace(/\s/g, '').includes('itemorcamento'))) { aoa = a; break }
      }
      if (!aoa) { alert('Não encontrei aba com a coluna "ItemOrcamento".'); setSaving(false); return }
      const header = aoa[0]
      const norm = (h: any) => typeof h === 'string' ? h.toLowerCase().replace(/\s/g, '') : ''
      const find = (...names: string[]) => header.findIndex((h: any) => names.includes(norm(h)))
      const iEmp = find('empresa'), iFil = find('filial'), iItem = find('itemorcamento'), iCC = find('centrodecusto')
      const iArea = find('area'), iDiv = find('divisão', 'divisao'), iBU = find('bu'), iHist = find('histórico', 'historico')
      const months: { idx: number; ano: number; mes: number }[] = []
      header.forEach((h: any, idx: number) => { if (h instanceof Date) months.push({ idx, ano: h.getFullYear(), mes: h.getMonth() + 1 }) })
      if (iEmp < 0 || iItem < 0 || !months.length) { alert('Colunas obrigatórias não encontradas (Empresa, ItemOrcamento e colunas de mês).'); setSaving(false); return }

      // F2: ItemOrcamento resolve para a LINHA MESTRE (fat_orcado.linha_id é mestre)
      const [{ data: emps }, { data: fils }, { data: ccs }, lns] = await Promise.all([
        supabase.from('empresa').select('id,codigo'),
        supabase.from('filial').select('id,codigo'),
        supabase.from('centro_custo').select('id,codigo'),
        fetchAllRows(() => supabase.from('conta_orcamentaria').select('id,codigo')),
      ])
      const empMap: any = {}; emps?.forEach((e: any) => { empMap[String(e.codigo)] = e.id })
      const filMap: any = {}; fils?.forEach((f: any) => { filMap[String(f.codigo)] = f.id })
      const ccMap: any = {}; ccs?.forEach((c: any) => { ccMap[String(c.codigo)] = c.id })
      const lnMap: any = {}; lns?.forEach((l: any) => { lnMap[String(l.codigo)] = l.id })

      // Agrega por chave única (soma duplicatas que colapsam na mesma combinação)
      const agg = new Map<string, any>()
      const empSet = new Set<string>(); const anoSet = new Set<number>()
      const missEmp = new Set<string>(); const missItem = new Set<string>(); let skip = 0
      const dimsKeyOf = (d: any) => JSON.stringify(Object.keys(d).sort().reduce((o: any, k) => { o[k] = d[k]; return o }, {}))
      // forward-fill: células mescladas/repetidas vazias herdam a linha anterior
      const dimIdxs = [iEmp, iFil, iItem, iCC, iArea, iDiv, iBU, iHist].filter(i => i >= 0)
      const carry: Record<number, any> = {}
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r]; if (!row || !row.length) continue
        for (const ix of dimIdxs) {
          if (row[ix] !== '' && row[ix] != null) carry[ix] = row[ix]
          else row[ix] = carry[ix] ?? ''
        }
        const empCod = String(row[iEmp] ?? '').trim(); const itemCod = String(row[iItem] ?? '').trim()
        if (!empCod && !itemCod) continue
        const empresa_id = empMap[empCod]; const linha_id = lnMap[itemCod]
        if (!empresa_id || !linha_id) { skip++; if (empCod && !empresa_id) missEmp.add(empCod); if (itemCod && !linha_id) missItem.add(itemCod); continue }
        const filial_id = iFil >= 0 ? (filMap[String(row[iFil] ?? '').trim()] || null) : null
        const cc_id = iCC >= 0 ? (ccMap[String(row[iCC] ?? '').trim()] || null) : null
        const dims: any = {}
        if (iArea >= 0 && row[iArea] !== '' && row[iArea] != null) dims.area = String(row[iArea]).trim()
        if (iDiv >= 0 && row[iDiv] !== '' && row[iDiv] != null) dims.divisao = String(row[iDiv]).trim()
        if (iBU >= 0 && row[iBU] !== '' && row[iBU] != null) dims.bu = String(row[iBU]).trim()
        if (iHist >= 0 && row[iHist] !== '' && row[iHist] != null) dims.historico = String(row[iHist]).trim()
        const dk = dimsKeyOf(dims)
        empSet.add(empresa_id)
        for (const m of months) {
          const v = row[m.idx]
          const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
          if (!num) continue
          anoSet.add(m.ano)
          const key = `${linha_id}|${empresa_id}|${filial_id || ''}|${cc_id || ''}|${m.ano}|${m.mes}|${dk}`
          const cur = agg.get(key)
          if (cur) cur.valor += num
          else agg.set(key, { tenant_id: TENANT_ID, versao_id: versaoId, linha_id, empresa_id, filial_id, cc_id, ano: m.ano, mes: m.mes, valor: num, expressao: null, origem: 'MANUAL', dims })
        }
      }
      const records = Array.from(agg.values())
      const detalhe = () => {
        let m = ''
        if (missEmp.size) m += `\n• Empresas não cadastradas (${missEmp.size}): ${[...missEmp].slice(0, 20).join(', ')}${missEmp.size > 20 ? '…' : ''}`
        if (missItem.size) m += `\n• Itens/linhas não encontrados (${missItem.size}): ${[...missItem].slice(0, 20).join(', ')}${missItem.size > 20 ? '…' : ''}`
        return m
      }
      if (!records.length) { alert(`Nenhum lançamento válido. ${skip} linhas ignoradas.` + detalhe()); setSaving(false); return }
      const totalVal = records.reduce((s, r) => s + (Number(r.valor) || 0), 0)
      const fmtTotal = totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

      if (modo === 'full') {
        // Full load: apaga todo o orçado manual da versão p/ as empresas do arquivo, depois insere
        await supabase.from('fat_orcado').delete().eq('versao_id', versaoId).eq('origem', 'MANUAL').in('empresa_id', Array.from(empSet))
        for (let i = 0; i < records.length; i += 500) {
          const { error } = await supabase.from('fat_orcado').insert(records.slice(i, i + 500)); if (error) throw error
        }
        await loadValores()
        alert(`Full load: ${records.length} lançamentos importados (total ${fmtTotal}) em ${empSet.size} empresa(s).` + (skip ? `\n${skip} linhas ignoradas.` + detalhe() : ''))
      } else {
        // Adicionar: soma aos existentes (busca chaves atuais e acumula)
        const ex = await fetchAllRows(() => supabase.from('fat_orcado')
          .select('id,linha_id,empresa_id,filial_id,cc_id,ano,mes,valor,dims')
          .eq('versao_id', versaoId).eq('origem', 'MANUAL').in('empresa_id', Array.from(empSet)))
        const exMap: Record<string, { id: string; valor: number }> = {}
        ;(ex || []).forEach((r: any) => {
          const k = `${r.linha_id}|${r.empresa_id}|${r.filial_id || ''}|${r.cc_id || ''}|${r.ano}|${r.mes}|${dimsKeyOf(r.dims || {})}`
          exMap[k] = { id: r.id, valor: Number(r.valor) || 0 }
        })
        const toInsert: any[] = []; const toUpdate: { id: string; valor: number }[] = []
        for (const [key, rec] of agg.entries()) {
          const hit = exMap[key]
          if (hit) toUpdate.push({ id: hit.id, valor: hit.valor + rec.valor })
          else toInsert.push(rec)
        }
        for (let i = 0; i < toInsert.length; i += 500) {
          const { error } = await supabase.from('fat_orcado').insert(toInsert.slice(i, i + 500)); if (error) throw error
        }
        for (const u of toUpdate) { const { error } = await supabase.from('fat_orcado').update({ valor: u.valor }).eq('id', u.id); if (error) throw error }
        await loadValores()
        alert(`Adicionado: ${toInsert.length} novos, ${toUpdate.length} somados (total do arquivo ${fmtTotal}).` + (skip ? `\n${skip} linhas ignoradas.` + detalhe() : ''))
      }
    } catch (e: any) { alert('Erro ao importar: ' + (e?.message ?? JSON.stringify(e))) }
    setSaving(false)
  }

  // ── Linhas CRUD
  const addLinha = async () => {
    if (!newDesc.trim() || !id) return
    await ensureSnapshot()
    const sib = linhas.filter(l => l.pai_id === (adding?.paiId ?? null))
    const maxOrdem = sib.reduce((m, l) => Math.max(m, l.ordem ?? 0), 0)
    const codigo = `L${Date.now().toString(36)}`
    // F2: cria a linha mestre (estrutura compartilhada) p/ ancorar os dados
    const { data: master, error: em } = await supabase.from('conta_orcamentaria')
      .insert({ tenant_id: TENANT_ID, codigo, descricao: newDesc.trim(), tipo_linha: 'ANALITICA', natureza: 'NEUTRO' })
      .select('id').single()
    if (em) { alert('Erro ao criar linha: ' + em.message); return }
    const { data, error } = await supabase.from('relatorio_linha').insert({
      relatorio_id: id, pai_id: adding?.paiId ?? null, descricao: newDesc.trim(),
      codigo, tipo_linha: 'ANALITICA', natureza: 'NEUTRO',
      ordem: maxOrdem + 10, formato: 'NUMERO', casas_decimais: 0, linha_orc_id: master?.id ?? null,
    }).select().single()
    if (!error && data) setLinhas(prev => [...prev, { ...data, _depth: 0 }])
    setAdding(null); setNewDesc('')
  }
  const deleteLinha = async (lid: string) => {
    if (!confirm('Excluir esta linha do relatório? (Os dados ficam na estrutura compartilhada; só some deste layout.)')) return
    await ensureSnapshot()
    await supabase.from('relatorio_linha').delete().eq('id', lid)
    setLinhas(prev => prev.filter(l => l.id !== lid && l.pai_id !== lid))
  }

  // F4: adicionar linhas a partir da estrutura compartilhada (reaproveita + dados vêm junto)
  const openPicker = async () => {
    const ms = await fetchAllRows(() => supabase.from('conta_orcamentaria')
      .select('id,codigo,descricao,tipo_linha,natureza,pai_id').order('codigo'))
    setMasters(ms); setPickerOpen(true)
  }
  const addDaEstrutura = async (rootMasterId: string, incluirSub: boolean) => {
    if (!id) { return }
    const byId: Record<string, any> = {}; masters.forEach(m => { byId[m.id] = m })
    const chosen: any[] = []
    const collect = (mid: string) => { const m = byId[mid]; if (!m) return; chosen.push(m); if (incluirSub) masters.filter(x => x.pai_id === mid).forEach(c => collect(c.id)) }
    collect(rootMasterId)
    const existCodes = new Set(linhas.map(l => l.codigo))
    const novos = chosen.filter(m => !existCodes.has(m.codigo))
    if (!novos.length) { alert('Essas linhas já estão no relatório.'); setPickerOpen(false); return }
    await ensureSnapshot()
    const baseOrdem = linhas.reduce((mx, l) => Math.max(mx, l.ordem ?? 0), 0)
    const ins = novos.map((m, i) => ({
      relatorio_id: id, codigo: m.codigo, descricao: m.descricao, tipo_linha: m.tipo_linha,
      natureza: m.natureza, linha_orc_id: m.id, ordem: baseOrdem + (i + 1) * 10, formato: 'NUMERO', casas_decimais: 0,
    }))
    const { error } = await supabase.from('relatorio_linha').insert(ins)
    if (error) { alert('Erro ao adicionar: ' + error.message); return }
    // resolve pai por código dentro do relatório (raiz vira filha da linha selecionada, ou topo)
    const all = await fetchAllRows(() => supabase.from('relatorio_linha').select('id,codigo').eq('relatorio_id', id))
    const rlByCode: Record<string, string> = {}; all.forEach((l: any) => { rlByCode[l.codigo] = l.id })
    for (const m of novos) {
      const isRoot = m.id === rootMasterId
      const paiCode = byId[m.pai_id]?.codigo
      const paiRlId = isRoot ? selId : (paiCode && rlByCode[paiCode] ? rlByCode[paiCode] : null)
      if (rlByCode[m.codigo]) await supabase.from('relatorio_linha').update({ pai_id: paiRlId }).eq('id', rlByCode[m.codigo])
    }
    await loadRelatorio(); await loadContaLinks(); await loadValores()
    setPickerOpen(false)
  }
  // Move a linha entre irmãos (mesmo pai) e reordena sequencialmente
  const moveLinha = async (l: Linha, dir: -1 | 1) => {
    const sib = linhas.filter(x => x.pai_id === l.pai_id).sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    const i = sib.findIndex(x => x.id === l.id)
    const j = i + dir
    if (j < 0 || j >= sib.length) return
    await ensureSnapshot()
    const reord = [...sib]; reord.splice(i, 1); reord.splice(j, 0, l)
    const updates = reord.map((x, k) => ({ id: x.id, ordem: (k + 1) * 10 }))
    setLinhas(prev => prev.map(x => { const u = updates.find(u => u.id === x.id); return u ? { ...x, ordem: u.ordem } : x }))
    for (const u of updates) await supabase.from('relatorio_linha').update({ ordem: u.ordem }).eq('id', u.id)
  }

  // Reparenta a linha e re-sequencia o grupo de irmãos do destino
  const reparent = async (l: Linha, novoPai: string | null, insertAt: number) => {
    await ensureSnapshot()
    const sibs = linhas.filter(x => x.pai_id === novoPai && x.id !== l.id).sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    const arr = [...sibs]; arr.splice(Math.min(insertAt, arr.length), 0, l)
    const updates = arr.map((x, k) => ({ id: x.id, ordem: (k + 1) * 10 }))
    const lOrdem = updates.find(u => u.id === l.id)?.ordem ?? 10
    setLinhas(prev => prev.map(x => {
      if (x.id === l.id) return { ...x, pai_id: novoPai, ordem: lOrdem }
      const u = updates.find(u => u.id === x.id); return u ? { ...x, ordem: u.ordem } : x
    }))
    await supabase.from('relatorio_linha').update({ pai_id: novoPai, ordem: lOrdem }).eq('id', l.id)
    for (const u of updates.filter(u => u.id !== l.id)) await supabase.from('relatorio_linha').update({ ordem: u.ordem }).eq('id', u.id)
  }
  // → indentar: vira filha do irmão imediatamente acima
  const indentLinha = async (l: Linha) => {
    const sib = linhas.filter(x => x.pai_id === l.pai_id).sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    const i = sib.findIndex(x => x.id === l.id)
    if (i <= 0) return
    setCollapsed(prev => { const n = new Set(prev); n.delete(sib[i - 1].id); return n })
    await reparent(l, sib[i - 1].id, Number.MAX_SAFE_INTEGER) // no fim dos filhos
  }
  // ← desindentar: sobe um nível, logo após o pai atual
  const outdentLinha = async (l: Linha) => {
    if (l.pai_id == null) return
    const pai = linhas.find(x => x.id === l.pai_id)
    if (!pai) return
    const grandSibs = linhas.filter(x => x.pai_id === (pai.pai_id ?? null) && x.id !== l.id).sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    const pi = grandSibs.findIndex(x => x.id === pai.id)
    await reparent(l, pai.pai_id ?? null, pi >= 0 ? pi + 1 : grandSibs.length)
  }
  const saveLinha = async (l: Linha) => {
    await ensureSnapshot()
    const patch = {
      codigo: l.codigo.trim(), descricao: l.descricao.trim(), tipo_linha: l.tipo_linha,
      natureza: l.natureza || null, negrito: l.negrito, italico: l.italico, desativada: !!l.desativada,
      formato: l.formato, casas_decimais: l.casas_decimais, cor_texto: l.cor_texto || null,
      expressao: (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') ? (toStored(l.expressao) || null) : null,
    }
    const { error } = await supabase.from('relatorio_linha').update(patch).eq('id', l.id)
    if (error) { alert('Erro: ' + error.message); return }
    setLinhas(prev => prev.map(x => x.id === l.id ? { ...x, ...patch } : x))
    setLinhaModal(null)
  }

  // ── Views CRUD
  const saveView = async (v: ViewConfig) => {
    if (!id) return
    await ensureSnapshot()
    if (v._synthetic || v.id === '__default') {
      const ordem = views.reduce((m, x) => Math.max(m, x.ordem ?? 0), 0) + 10
      const { data, error } = await supabase.from('view_config').insert({
        relatorio_id: id, nome: v.nome, ordem, funcao: v.funcao, cenarios: v.cenarios, filtros: v.filtros || {},
      }).select().single()
      if (error) { alert('Erro: ' + error.message); return }
      await loadViews(); if (data) setActiveView(data.id)
    } else {
      const { error } = await supabase.from('view_config').update({ nome: v.nome, funcao: v.funcao, cenarios: v.cenarios, filtros: v.filtros || {} }).eq('id', v.id)
      if (error) { alert('Erro: ' + error.message); return }
      await loadViews()
    }
    setViewModal(null)
  }
  const deleteView = async (vid: string) => {
    if (!confirm('Excluir esta visão?')) return
    await ensureSnapshot()
    await supabase.from('view_config').delete().eq('id', vid)
    if (activeView === vid) setActiveView('')
    loadViews()
  }

  if (loading) return <div style={{ padding: 32, color: '#aaa', fontSize: 14 }}>Carregando...</div>

  return (
    <div style={S.page}>
      <div style={S.header}>
        <button style={S.back} onClick={() => navigate('/relatorios')}><ChevronLeft size={15} /> Relatórios</button>
        <span style={S.title}>{relatorio?.nome ?? '...'}</span>

        <div style={{ position: 'relative' }}>
          <button style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6, borderColor: editavel ? '#dee2e6' : '#ffd43b' }} onClick={() => setFiltroOpen(o => !o)} title="Filtros">
            <Filter size={13} /> Filtros
          </button>
          {filtroOpen && (
            <>
              <div onClick={() => setFiltroOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'white', border: '1px solid #dee2e6', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 1500, width: 520, maxHeight: '78vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f1f3f5' }}>
                  <strong style={{ fontSize: 14, color: '#212529' }}>Filtros</strong>
                  <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={() => setFiltroOpen(false)} />
                </div>
                <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
                  <div>
                    <label style={S.label}>Versão *</label>
                    <select style={S.input} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
                      <option value="">—</option>{versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
                    </select>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={S.label}>Período</label>
                    <PeriodPicker anos={ANOS} ini={pIni} fim={pFim}
                      onChange={(a, b) => { setPIni(a); setPFim(b) }} />
                    <div style={{ fontSize: 11, color: '#868e96', marginTop: 6 }}>
                      {MESES[pIni.mes - 1]}/{pIni.ano} – {MESES[pFim.mes - 1]}/{pFim.ano} · {GRAN_LABEL[gran] || 'Mensal'} · {buckets.length} {buckets.length === 1 ? 'período' : 'períodos'}
                      <span style={{ marginLeft: 6, color: '#adb5bd' }}>(granularidade na Visão)</span>
                    </div>
                  </div>
                  <Checklist titulo="Empresa *" items={empresas} sel={empresaSel} setSel={setEmpresaSel} />
                  <Checklist titulo="Filial" items={filiais} sel={filialSel} setSel={setFilialSel} />
                  <Checklist titulo="Centro de Custo" items={ccs} sel={ccSel} setSel={setCcSel} />
                  <div style={{ marginTop: 12, fontSize: 12, color: editavel ? '#2f9e44' : '#e8590c' }}>
                    {editavel ? '✓ Edição habilitada (1 empresa, 1 versão; filial/CC em "todas"). Para digitar nas células use a visão na granularidade Mensal.' : 'Somente leitura — para editar, selecione exatamente 1 empresa e 1 versão, e deixe Filial/CC em "todas".'}
                  </div>
                </div>
                <div style={{ padding: '10px 14px', borderTop: '1px solid #f1f3f5', textAlign: 'right' }}>
                  <button style={S.btnPri} onClick={() => setFiltroOpen(false)}>Aplicar e fechar</button>
                </div>
              </div>
            </>
          )}
        </div>
        <span style={{ fontSize: 12, color: '#868e96', whiteSpace: 'nowrap' }}>
          {(empresaSel.length === 0 ? 'nenhuma empresa' : empresaSel.length === empresas.length ? 'Todas empresas' : empresaSel.length === 1 ? (empresas.find(e => e.id === empresaSel[0])?.codigo || '1 empresa') : `${empresaSel.length} empresas`)}
          {' · '}{versoes.find(v => v.id === versaoId)?.codigo || '—'}{' · '}{pIni.ano === pFim.ano ? pIni.ano : `${pIni.ano}–${pFim.ano}`}
          {filialSel.length ? ` · ${filialSel.length} filial` : ''}{ccSel.length ? ` · ${ccSel.length} CC` : ''}
        </span>
        {!editavel && <span style={{ fontSize: 11, fontWeight: 600, color: '#e8590c', background: '#fff4e6', border: '1px solid #ffd8a8', borderRadius: 99, padding: '2px 8px' }}>somente leitura</span>}

        <div style={{ position: 'relative' }}>
          <button style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setSnapOpen(o => !o); loadSnaps() }} title="Pontos de restauração (desfazer alterações)">
            <History size={13} /> Pontos {snapBusy && '…'}
          </button>
          {snapOpen && (
            <>
              <div onClick={() => setSnapOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'white', border: '1px solid #dee2e6', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.18)', zIndex: 1500, width: 320, maxHeight: 380, overflow: 'auto' }}>
                <div style={{ padding: 10, borderBottom: '1px solid #f1f3f5', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 13, color: '#212529', flex: 1 }}>Pontos de restauração</strong>
                  <button style={{ ...S.btnGreen, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }} disabled={snapBusy}
                    onClick={() => { const d = prompt('Nome do ponto (opcional):') ; if (d !== null) criarSnap(false, d || 'manual') }}>
                    <Save size={12} /> Salvar ponto
                  </button>
                </div>
                {snaps.length === 0 && <div style={{ padding: 14, fontSize: 12, color: '#adb5bd' }}>Nenhum ponto ainda.</div>}
                {snaps.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #f8f9fa', fontSize: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: '#212529', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {new Date(s.criado_em).toLocaleString('pt-BR')}
                        {s.auto ? <span style={{ marginLeft: 6, fontSize: 10, color: '#868e96', background: '#f1f3f5', borderRadius: 4, padding: '1px 5px' }}>auto</span> : null}
                      </div>
                      {s.descricao && !s.auto && <div style={{ color: '#868e96' }}>{s.descricao}</div>}
                    </div>
                    <button style={{ ...S.btnGray, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 5 }} disabled={snapBusy} onClick={() => restaurarSnap(s.id)} title="Restaurar este ponto">
                      <RotateCcw size={12} /> Restaurar
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <button style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6 }} onClick={exportMatrix} title="Exportar para Excel (modelo preenchível)">
          <Download size={13} /> Excel
        </button>
        <div style={{ position: 'relative' }}>
          <button style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setImpMenu(o => !o)}>
            <Upload size={13} /> Importar ▾
          </button>
          {impMenu && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'white', border: '1px solid #dee2e6', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 1000, minWidth: 240 }}>
              {[
                { m: 'linhas' as const,        label: 'Linhas (estrutura)',                modelo: modeloLinhas },
                { m: 'baseline_full' as const, label: 'Orçado Baseline — substituir (full)', modelo: modeloBaseline },
                { m: 'baseline_add' as const,  label: 'Orçado Baseline — adicionar',         modelo: modeloBaseline },
              ].map(o => (
                <div key={o.m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', fontSize: 13 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#edf2ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                  <span style={{ cursor: 'pointer', flex: 1 }} onClick={() => { setImpMode(o.m); setImpMenu(false); fileRef.current?.click() }}>{o.label}</span>
                  <span style={{ cursor: 'pointer', color: '#3b5bdb', fontSize: 11, whiteSpace: 'nowrap' }}
                    onClick={e => { e.stopPropagation(); o.modelo() }} title="Baixar planilha modelo">⬇ modelo</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0]
            if (f) {
              if (impMode === 'linhas') importLinhas(f)
              else importBaseline(f, impMode === 'baseline_full' ? 'full' : 'add')
              e.target.value = ''
            }
          }} />
        {saving && <span style={{ fontSize: 12, color: '#aaa' }}>Salvando...</span>}
      </div>

      <div style={S.viewsBar}>
        {(views.length ? views : [view]).map(v => (
          <div key={v.id} style={viewTab(v.id === view.id)} onClick={() => setActiveView(v.id)}>
            <span>{v.nome}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>· {FUNCAO_LABEL[v.funcao]}</span>
            <Settings2 size={12} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setViewModal(v) }} />
            {!v._synthetic && v.id === view.id && <X size={12} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); deleteView(v.id) }} />}
          </div>
        ))}
        <button style={{ ...viewTab(false), borderStyle: 'dashed', color: '#adb5bd' }}
          onClick={() => setViewModal({ id: '__default', nome: 'Nova visão', ordem: 0, funcao: 'MENSAL', cenarios: versaoId ? [versaoId] : [], filtros: {}, _synthetic: true })}>
          <Plus size={13} /> Visão
        </button>

        <div style={{ flex: 1 }} />
        <button title="Ocultar linhas sem valor no período selecionado" onClick={() => setHideEmpty(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', fontSize: 11, borderRadius: 6, cursor: 'pointer', marginRight: 6,
            border: '1px solid ' + (hideEmpty ? '#74c0fc' : '#dee2e6'), background: hideEmpty ? '#e7f5ff' : 'white', color: hideEmpty ? '#1971c2' : '#495057' }}>
          {hideEmpty ? <EyeOff size={13} /> : <Eye size={13} />} Ocultar vazias
        </button>
        <button title="Ocultar linhas desativadas (remove do relatório)" onClick={() => setHideOff(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', fontSize: 11, borderRadius: 6, cursor: 'pointer', marginRight: 6,
            border: '1px solid ' + (hideOff ? '#74c0fc' : '#dee2e6'), background: hideOff ? '#e7f5ff' : 'white', color: hideOff ? '#1971c2' : '#495057' }}>
          <Strikethrough size={13} /> Ocultar desativadas
        </button>
        <span style={{ fontSize: 11, color: '#adb5bd', marginRight: 4 }}>Níveis:</span>
        {Array.from({ length: Math.min(maxDepth + 1, 5) }, (_, i) => i + 1).map(n => (
          <button key={n} title={`Expandir até o nível ${n}`} onClick={() => recolherAteNivel(n)}
            style={{ width: 24, height: 24, fontSize: 12, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057', cursor: 'pointer' }}>{n}</button>
        ))}
        <button title="Expandir tudo" onClick={expandirTudo}
          style={{ display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', fontSize: 11, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057', cursor: 'pointer' }}>
          <ChevronsUpDown size={13} /> Tudo
        </button>
      </div>

      {(() => {
        const sel = selId ? (linhas.find(x => x.id === selId) ?? null) : null
        const ab: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', fontSize: 12, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: sel ? '#495057' : '#ced4da', cursor: sel ? 'pointer' : 'default', flexShrink: 0 }
        const act = (fn: (l: Linha) => void) => () => { if (sel) fn(sel) }
        const sep = <div style={{ width: 1, height: 18, background: '#e9ecef', margin: '0 2px' }} />
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', background: 'white', borderBottom: '1px solid #e9ecef', flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: '#868e96', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sel ? <>Linha: <b style={{ color: '#212529' }}>{sel.descricao}</b></> : 'Clique numa linha para selecionar'}
            </span>
            <div style={{ flex: 1 }} />
            <button style={ab} title="Mover para cima" onClick={act(l => moveLinha(l, -1))}><ArrowUp size={13} /></button>
            <button style={ab} title="Mover para baixo" onClick={act(l => moveLinha(l, 1))}><ArrowDown size={13} /></button>
            <button style={ab} title="Desindentar (subir nível)" onClick={act(outdentLinha)}><ArrowLeft size={13} /></button>
            <button style={ab} title="Indentar (virar filha da linha acima)" onClick={act(indentLinha)}><ArrowRight size={13} /></button>
            {sep}
            <button style={ab} title="Adicionar linha filha" onClick={act(l => { setCollapsed(prev => { const n = new Set(prev); n.delete(l.id); return n }); setAdding({ paiId: l.id }); setNewDesc('') })}><Plus size={13} /> Filha</button>
            <button style={ab} title="Adicionar linha irmã" onClick={act(l => { setAdding({ paiId: l.pai_id }); setNewDesc('') })}><Plus size={13} /> Irmã</button>
            <button style={{ ...ab, color: '#1971c2', cursor: 'pointer' }} title="Adicionar da estrutura compartilhada (reaproveita linha + subárvore; os dados vêm junto)" onClick={openPicker}><ListTree size={13} /> Estrutura</button>
            {sep}
            <button style={ab} title="Editar linha" onClick={act(l => setLinhaModal(l))}><Pencil size={13} /></button>
            <button style={ab} title="Contas (DE-PARA do realizado)" onClick={act(l => setContaModal(l))}><Link2 size={13} /></button>
            <button style={{ ...ab, color: sel ? '#e03131' : '#ced4da' }} title="Excluir linha" onClick={act(l => { deleteLinha(l.id); setSelId(null) })}><Trash2 size={13} /></button>
          </div>
        )
      })()}

      {valErro && (
        <div style={{ margin: '8px 16px 0', padding: '8px 12px', background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, fontSize: 12, color: '#c92a2a' }}>
          ⚠ Erro ao carregar valores: {valErro}
        </div>
      )}
      {dupContas.length > 0 && (
        <div style={{ margin: '8px 16px 0', padding: '8px 12px', background: '#fff4e6', border: '1px solid #ffd8a8', borderRadius: 8, fontSize: 12, color: '#e8590c' }}>
          ⚠ {dupContas.length} conta(s) contábil(is) estão amarradas a mais de uma linha deste relatório — isso duplicava a totalização. Agora cada lançamento conta uma vez (linha mais recente do DE-PARA). Revise no botão 🔗: {dupContas.slice(0, 6).map(cid => contas.find(c => c.id === cid)?.codigo || cid).join(', ')}{dupContas.length > 6 ? '…' : ''}
        </div>
      )}
      <div style={S.tableWrap}>
        <table style={{ ...S.table, tableLayout: 'fixed', width: dw('__desc', 260) + columns.reduce((s, c) => s + dw(c.key, c.period === 'TOTAL' ? 104 : c.kind === 'delta' ? 64 : 84), 0) }}>
          <colgroup>
            <col style={{ width: dw('__desc', 260) }} />
            {columns.map(c => <col key={c.key} style={{ width: dw(c.key, c.period === 'TOTAL' ? 104 : c.kind === 'delta' ? 64 : 84) }} />)}
          </colgroup>
          <thead>
            {twoRow ? (
              <>
                <tr>
                  <th style={{ ...S.th, ...S.thDesc, position: 'sticky' }} rowSpan={2}>Descrição{resizeHandle('__desc', 260)}</th>
                  {groups.map((g, i) => <th key={i} colSpan={g.span} style={{ ...S.th, textAlign: 'center', color: '#495057' }}>{g.label}</th>)}
                </tr>
                <tr>{columns.map(c => <th key={c.key} style={{ ...S.th, top: 28, color: c.kind === 'delta' ? '#868e96' : '#6c757d', position: 'sticky' }}>{c.label}{resizeHandle(c.key, c.period === 'TOTAL' ? 104 : c.kind === 'delta' ? 64 : 84)}</th>)}</tr>
              </>
            ) : (
              <tr>
                <th style={{ ...S.th, ...S.thDesc }}>Descrição{resizeHandle('__desc', 260)}</th>
                {columns.map(c => <th key={c.key} style={{ ...S.th, color: c.period === 'TOTAL' ? '#1971c2' : '#6c757d', position: 'sticky' }}>{c.label}{resizeHandle(c.key, c.period === 'TOTAL' ? 104 : c.kind === 'delta' ? 64 : 84)}</th>)}
              </tr>
            )}
          </thead>
          <tbody>
            {visivel.map((l, idx) => {
              const depth = l._depth ?? 0
              const isAgg = l.tipo_linha === 'SOMAR_FILHOS'
              const isSpac = l.tipo_linha === 'ESPACO'
              const editable = l.tipo_linha === 'ANALITICA'
              const hasKids = temFilhos(l.id)
              const isOpen = !collapsed.has(l.id)
              const rowBg = isAgg ? '#f0f4ff' : isSpac ? '#fbfbfc' : 'white'
              const fw = l.negrito || isAgg ? 600 : 400
              const off = !!l.desativada
              const corAuto = isAgg ? '#1971c2' : l.tipo_linha === 'INDICADOR' ? '#0c8599' : l.tipo_linha === 'FORMULA' ? '#6741d9' : isSpac ? '#ccc' : '#212529'
              const fac = facOf(l)   // -1 p/ despesa (exibe positivo)
              const clr = off ? '#adb5bd' : (l.cor_texto || corAuto)
              const TipoIcon = TIPO_INFO[l.tipo_linha].icon
              const isSel = selId === l.id
              const rowBgSel = isSel ? '#cfe0ff' : rowBg
              return (
                <Fragment key={l.id}>
                <tr style={{ background: rowBgSel }} onClick={() => setSelId(l.id)}>
                  <td style={{ ...S.tdDesc, background: rowBgSel, borderLeft: isSel ? '3px solid #3b5bdb' : '3px solid transparent', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: depth * 18, height: 22 }}>
                      <button style={{ ...S.iconBtn, width: 18, flexShrink: 0 }} onClick={e => { e.stopPropagation(); hasKids && toggle(l.id) }}>
                        {hasKids ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
                      </button>
                      {l.cor_texto ? <span style={{ width: 8, height: 8, borderRadius: 2, background: l.cor_texto, flexShrink: 0 }} /> : <TipoIcon size={12} style={{ color: TIPO_INFO[l.tipo_linha].cor, flexShrink: 0, opacity: 0.7 }} />}
                      <span style={{ fontWeight: fw, color: clr, fontStyle: l.italico ? 'italic' : 'normal', textDecoration: off ? 'line-through' : 'none', fontSize: 13, paddingLeft: 2, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        onDoubleClick={() => setLinhaModal(l)} title={(l.descricao || '') + (off ? ' — desativada (fora da soma)' : ' — duplo-clique p/ editar')}>
                        {l.descricao || <em style={{ color: '#ccc' }}>sem nome</em>}
                      </span>
                      {!isSpac && contaLinks[l.id]?.length ? <span style={{ fontSize: 9, fontWeight: 700, color: '#2f9e44', flexShrink: 0 }} title="contas amarradas">🔗{contaLinks[l.id].length}</span> : null}
                    </div>
                  </td>
                  {columns.map(c => {
                    if (c.empresaId) {
                      const v = cellValE(c.empresaId, c.cenarioKey!, l.id, c.period)
                      const disp = isSpac ? '' : (v !== 0 ? formatValor(fac * v, l.formato, l.casas_decimais) : '')
                      return <td key={c.key} style={{ ...S.td, color: clr, fontWeight: fw, textDecoration: off ? 'line-through' : undefined, background: isSel ? '#cfe0ff' : (c.period === 'TOTAL' ? '#fafbff' : undefined) }}>{disp}</td>
                    }
                    if (c.kind === 'delta') {
                      const base = cellVal(view.cenarios[0], l.id, c.period)
                      const comp = cellVal(view.cenarios[1], l.id, c.period)
                      const d = base !== 0 ? (comp - base) / Math.abs(base) : NaN
                      const col = !isFinite(d) ? '#ced4da' : d >= 0 ? '#2f9e44' : '#e03131'
                      return <td key={c.key} style={{ ...S.td, color: col, fontSize: 12, fontWeight: 500 }}>{isSpac ? '' : (isFinite(d) ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%` : '—')}</td>
                    }
                    const cen = c.cenarioKey!
                    const val = cellVal(cen, l.id, c.period)
                    const perUnico = mpb === 1 && typeof c.period === 'number' ? buckets[c.period as number]?.meses[0] ?? null : null
                    const pk = perUnico ? pkey(perUnico) : ''
                    const isDet = !!perUnico && !!detalhado[cen]?.has(`${l.id}-${pk}`)
                    const isLineFx = l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR'
                    const editLineFx = isLineFx && cen === versaoId && typeof c.period === 'number'
                    const canEditCell = editable && cen === versaoId && !!perUnico && editavel && !isDet
                    const canEdit = canEditCell || editLineFx
                    const isEditing = editCell?.linhaId === l.id && editCell?.period === c.period
                    const hasFx = !!perUnico && !!raw[cen]?.[l.id]?.[pk]?.expressao
                    const naoUltimo = !!perUnico && !samePer(perUnico, displayedMeses[displayedMeses.length - 1])
                    const display = isSpac ? '' : (val !== 0 ? formatValor(fac * val, l.formato, l.casas_decimais) : (canEditCell ? <span style={{ color: '#e9ecef' }}>—</span> : ''))
                    return (
                      <td key={c.key}
                        style={{ ...S.td, color: clr, fontWeight: fw, textDecoration: off ? 'line-through' : undefined, cursor: canEdit ? 'text' : (isSpac ? 'default' : 'pointer'), background: isSel ? '#cfe0ff' : (cen !== versaoId && !isSpac ? '#fcfcfd' : undefined) }}
                        onClick={() => {
                          setSelId(l.id)
                          if (canEditCell) {
                            setEditCell({ linhaId: l.id, period: c.period as number })
                            const cell = raw[versaoId]?.[l.id]?.[pk]
                            setEditVal(cell?.expressao ? toDisplay(cell.expressao) : (val ? formatValor(fac * val, l.formato, l.casas_decimais) : ''))
                          } else if (editLineFx) {
                            setEditCell({ linhaId: l.id, period: c.period as number })
                            setEditVal(toDisplay(l.expressao))
                          } else {
                            abrirRazao(l, c.period, cen)
                          }
                        }}
                        onContextMenu={e => { e.preventDefault(); abrirRazao(l, c.period, cen) }}
                        title={editLineFx ? 'Fórmula da linha (vale p/ todas as empresas). Clique p/ editar.' : isDet ? 'Detalhado por filial/CC (somado). Clique p/ ver o razão.' : (hasFx ? raw[cen]?.[l.id]?.[pk]?.expressao ?? '' : 'Botão direito: ver razão (detalhe)')}>
                        {isEditing ? (
                          <FormulaCellInput
                            value={editVal}
                            onChange={setEditVal}
                            onCommit={() => commitCell(l.id, c.period as number)}
                            onCancel={() => setEditCell(null)}
                            onFill={canEditCell && naoUltimo && perUnico ? () => fillRight(l.id, perUnico, editVal) : undefined}
                            onDetail={canEditCell ? () => { setEditCell(null); abrirRazao(l, c.period, cen) } : undefined}
                            linhas={linhas.map(x => ({ codigo: x.codigo, descricao: x.descricao }))}
                            inputStyle={S.cellInput}
                          />
                        ) : (
                          <span style={{ display: 'block', minWidth: 54 }}>
                            {hasFx && <span style={{ color: '#6741d9', fontSize: 9, marginRight: 3 }}>ƒ</span>}{display}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
                {adding && adding.paiId !== null && idx === addAfterIndex && (
                  <tr>
                    <td colSpan={columns.length + 1} style={{ padding: '8px 12px', background: '#f8fff8', borderBottom: '1px solid #d3f9d8' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: addChildDepth }}>
                        <span style={{ fontSize: 12, color: '#2f9e44', fontWeight: 600 }}>↳ filho</span>
                        <input style={S.newInput} placeholder="Descrição da linha..." autoFocus value={newDesc}
                          onChange={e => setNewDesc(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addLinha(); if (e.key === 'Escape') { setAdding(null); setNewDesc('') } }} />
                        <button style={S.btnGreen} onClick={addLinha}>Adicionar</button>
                        <button style={S.btnGray} onClick={() => { setAdding(null); setNewDesc('') }}>Cancelar</button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
            {adding && adding.paiId === null ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: '8px 12px', background: '#f8fff8', borderBottom: '1px solid #d3f9d8' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input style={S.newInput} placeholder="Descrição da linha..." autoFocus value={newDesc}
                      onChange={e => setNewDesc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addLinha(); if (e.key === 'Escape') { setAdding(null); setNewDesc('') } }} />
                    <button style={S.btnGreen} onClick={addLinha}>Adicionar</button>
                    <button style={S.btnGray} onClick={() => { setAdding(null); setNewDesc('') }}>Cancelar</button>
                  </div>
                </td>
              </tr>
            ) : !adding ? (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: '8px 12px' }}>
                  <button style={S.addRow} onClick={() => { setAdding({ paiId: null }); setNewDesc('') }}><Plus size={13} /> Adicionar linha</button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {!editavel && (
        <div style={{ position: 'fixed', bottom: 16, right: 16, background: '#fff3bf', border: '1px solid #ffd43b', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#856404', maxWidth: 340 }}>
          {versoes.length === 0
            ? 'Nenhuma versão cadastrada. Crie em Cadastros → Versões/Cenários (ex.: Orçado 2026).'
            : 'Somente leitura. Abra Filtros e selecione 1 empresa e 1 versão (Filial/CC em "todas") para editar.'}
        </div>
      )}

      {linhaModal && <LinhaModal linha={{ ...linhaModal, expressao: toDisplay(linhaModal.expressao) }} refLinhas={linhas.map(x => ({ codigo: x.codigo, descricao: x.descricao }))} onClose={() => setLinhaModal(null)} onSave={saveLinha} />}
      {viewModal && <ViewModal view={viewModal} versoes={versoes} onClose={() => setViewModal(null)} onSave={saveView} />}
      {razao && <RazaoModal {...razao} onClose={() => setRazao(null)} />}
      {pickerOpen && <EstruturaPicker masters={masters} jaNoRelatorio={new Set(linhas.map(l => l.codigo))} alvo={selId ? linhas.find(l => l.id === selId)?.descricao ?? null : null} onAdd={addDaEstrutura} onClose={() => setPickerOpen(false)} />}
      {contaModal && (
        <ContaLinkModal
          linha={contaModal} contas={contas} mapeadas={contaLinks[contaModal.id] || []}
          onAddMany={(cids) => addContaMany(contaModal.id, cids)} onRemove={removeConta} onToggleSinal={toggleSinal}
          onClose={() => setContaModal(null)}
        />
      )}
    </div>
  )
}

// ─── Modal: Razão (detalhe + edição dos lançamentos de uma célula) ────
function RazaoModal({ titulo, cen, cenLabel, periodoLabel, meses, perAdd, linhaIds, contaIds, contaSinal, empresaSel, filialFilter, ccFilter, ccById, contaById, linhaById, empById, filById, editavel, linhaId, isBalanco, empresasList, filiaisList, ccsList, onChanged, onBeforeChange, onClose }: {
  titulo: string; cen: string; cenLabel: string; periodoLabel: string; meses: Periodo[]; perAdd: Periodo | null
  linhaIds: string[]; contaIds: string[]; contaSinal: Record<string, number>; empresaSel: string[]; filialFilter: string[] | null; ccFilter: string[] | null
  ccById: Record<string, any>; contaById: Record<string, any>; linhaById: Record<string, string>; empById: Record<string, any>; filById: Record<string, any>
  editavel: boolean; linhaId: string; isBalanco?: boolean
  empresasList: { id: string; codigo: string; descricao: string }[]
  filiaisList: { id: string; codigo: string; descricao: string }[]
  ccsList: { id: string; codigo: string; descricao: string }[]
  onChanged: () => void; onBeforeChange?: () => Promise<void>; onClose: () => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'valor', dir: 'desc' })
  const sortClick = (col: string) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'valor' ? 'desc' : 'asc' })
  const seta = (col: string) => sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
  const emptyForm = { empresa_id: empresaSel.length === 1 ? empresaSel[0] : (empresaSel[0] || ''), filial_id: '', cc_id: '', area: '', divisao: '', bu: '', historico: '', valor: '' }
  const [form, setForm] = useState<any>(emptyForm)

  const isReal = cen === REALIZADO
  const load = async () => {
    setLoading(true)
    if (isReal && !contaIds.length) { setRows([]); setLoading(false); return }
    const anosQ = [...new Set(meses.map(m => m.ano))]
    const mesesQ = [...new Set(meses.map(m => m.mes))]
    const perSet = new Set(meses.map(pkey))
    // Balanço: realizado = SALDO por conta (balancete), do fat_saldo
    if (isReal && isBalanco) {
      const raw = await fetchAllRows(() => {
        let q = supabase.from('fat_saldo').select('conta_id,empresa_id,filial_id,ano,mes,saldo').in('conta_id', contaIds).in('empresa_id', empresaSel).in('ano', anosQ).in('mes', mesesQ)
        if (filialFilter) q = q.in('filial_id', filialFilter)
        return q
      })
      const data = (raw as any[]).filter(r => perSet.has(`${r.ano}-${r.mes}`))
      const agg = new Map<string, any>()
      for (const r of data) {
        const k = `${r.conta_id}|${r.empresa_id || ''}|${r.filial_id || ''}`
        const v = (Number(r.saldo) || 0) * (contaSinal[r.conta_id] ?? 1)
        const cur = agg.get(k)
        if (cur) cur.valor += v
        else agg.set(k, { conta_id: r.conta_id, empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: null, dims: { historico: '' }, valor: v })
      }
      setRows(Array.from(agg.values()).sort((a, b) => (contaById[a.conta_id]?.codigo || '').localeCompare(contaById[b.conta_id]?.codigo || '')))
      setLoading(false); return
    }
    const raw = await fetchAllRows(() => {
      let q = isReal
        ? supabase.from('fat_realizado').select('conta_id,empresa_id,filial_id,cc_id,ano,mes,valor,historico,documento,dims,lote,sublote').in('conta_id', contaIds)
        : supabase.from('fat_orcado').select(editavel ? 'id,empresa_id,filial_id,cc_id,ano,mes,valor,dims,origem' : 'linha_id,empresa_id,filial_id,cc_id,ano,mes,valor,dims').in('linha_id', linhaIds).eq('versao_id', cen)
      q = q.in('empresa_id', empresaSel).in('ano', anosQ).in('mes', mesesQ)
      if (filialFilter) q = q.in('filial_id', filialFilter)
      if (ccFilter) q = q.in('cc_id', ccFilter)
      return q
    })
    // filtra os períodos exatos (evita cross-product de ano×mês em baldes multi-ano)
    let data = (raw as any[]).filter(r => perSet.has(`${r.ano}-${r.mes}`))
    if (isReal) {
      // exclui lotes ignorados ativos (casa com a RPC relatorio_realizado_agg → célula bate com o drill)
      const { data: regras } = await supabase.from('lote_ignorado').select('lote,sublote,empresa_id,por_prefixo').eq('ativo', true)
      const rs = (regras || []) as { lote: string; sublote: string | null; empresa_id: string | null; por_prefixo: boolean }[]
      if (rs.length) {
        const nl = (s: string) => (s || '').replace(/\s+/g, '').toUpperCase()
        data = data.filter(r => !(r.lote && rs.some(g => (g.por_prefixo ? nl(r.lote).startsWith(nl(g.lote)) : nl(g.lote) === nl(r.lote)) && (g.sublote == null || g.sublote === '' || nl(g.sublote) === nl(r.sublote)) && (g.empresa_id == null || g.empresa_id === r.empresa_id))))
      }
    }
    if (isReal) {
      // razão do realizado: agrega por conta+empresa+filial+cc, aplica sinal do conta_linha (casa com a célula)
      const agg = new Map<string, any>()
      for (const r of data) {
        const k = `${r.conta_id}|${r.empresa_id || ''}|${r.filial_id || ''}|${r.cc_id || ''}|${r.historico || ''}`
        const v = (Number(r.valor) || 0) * (contaSinal[r.conta_id] ?? 1)
        const cur = agg.get(k)
        if (cur) cur.valor += v
        else agg.set(k, { conta_id: r.conta_id, empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: r.cc_id, dims: { historico: r.historico || '' }, valor: v })
      }
      setRows(Array.from(agg.values()).sort((a, b) => (contaById[a.conta_id]?.codigo || '').localeCompare(contaById[b.conta_id]?.codigo || '')))
    } else if (editavel) {
      setRows((data as any[]).map(r => ({ ...r, dims: r.dims || {} })).sort((a, b) => (a.dims.historico || '').localeCompare(b.dims.historico || '')))
    } else {
      const agg = new Map<string, any>()
      for (const r of data as any[]) {
        const k = `${r.linha_id}|${r.empresa_id || ''}|${r.filial_id || ''}|${r.cc_id || ''}|${JSON.stringify(r.dims || {})}`
        const cur = agg.get(k)
        if (cur) cur.valor += Number(r.valor) || 0
        else agg.set(k, { linha_id: r.linha_id, empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: r.cc_id, dims: r.dims || {}, valor: Number(r.valor) || 0 })
      }
      setRows(Array.from(agg.values()).sort((a, b) => (a.dims.historico || '').localeCompare(b.dims.historico || '')))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const soma = rows.reduce((s, r) => s + (Number(r.valor) || 0), 0)
  const exportar = () => downloadSheet('razao.xlsx', [
    [...(isReal ? ['Conta', 'Descrição Conta'] : []), 'Empresa', 'Filial', 'Linha', 'CC', 'Descrição CC', 'Área', 'Divisão', 'BU', 'Histórico', 'Valor'],
    ...rows.map(r => [
      ...(isReal ? [contaById[r.conta_id]?.codigo || '', contaById[r.conta_id]?.descricao || ''] : []),
      empById[r.empresa_id]?.codigo || '', filById[r.filial_id]?.codigo || '',
      linhaById[r.linha_id ?? linhaId] || titulo, ccById[r.cc_id]?.codigo || '', ccById[r.cc_id]?.descricao || '',
      r.dims.area || '', r.dims.divisao || '', r.dims.bu || '', r.dims.historico || '', r.valor,
    ]),
  ])

  // ── edição (modo editável) ──
  const saveValor = async (r: any, str: string) => {
    const v = parseNum(str); if (v === Number(r.valor)) return
    await onBeforeChange?.()
    await supabase.from('fat_orcado').update({ valor: v, origem: 'MANUAL' }).eq('id', r.id)
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, valor: v } : x)); onChanged()
  }
  const saveHist = async (r: any, str: string) => {
    const h = str.trim(); if (h === (r.dims.historico || '')) return
    const dims = { ...r.dims }; if (h) dims.historico = h; else delete dims.historico
    await onBeforeChange?.()
    const { error } = await supabase.from('fat_orcado').update({ dims }).eq('id', r.id)
    if (error) { alert('Erro: ' + error.message); return }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, dims } : x)); onChanged()
  }
  const delRow = async (r: any) => {
    if (!confirm('Excluir este lançamento?')) return
    await onBeforeChange?.()
    await supabase.from('fat_orcado').delete().eq('id', r.id)
    setRows(prev => prev.filter(x => x.id !== r.id)); onChanged()
  }
  const addRow = async () => {
    if (perAdd == null) { alert('Adição disponível só em célula de mês.'); return }
    if (!form.empresa_id) { alert('Selecione a empresa.'); return }
    const valor = parseNum(form.valor)
    if (!valor) { alert('Informe um valor.'); return }
    const dims: any = {}
    for (const k of ['area', 'divisao', 'bu', 'historico']) if (form[k]?.trim()) dims[k] = form[k].trim()
    await onBeforeChange?.()
    const { error } = await supabase.from('fat_orcado').insert({
      tenant_id: TENANT_ID, versao_id: cen, linha_id: linhaId, empresa_id: form.empresa_id,
      filial_id: form.filial_id || null, cc_id: form.cc_id || null, ano: perAdd.ano, mes: perAdd.mes, valor, expressao: null, origem: 'MANUAL', dims,
    })
    if (error) { alert('Erro ao adicionar: ' + (error.message.includes('uq_fat_orcado') ? 'já existe um lançamento com essas dimensões — edite o existente.' : error.message)); return }
    setForm(emptyForm); setShowAdd(false); await load(); onChanged()
  }

  const th: CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 11, color: '#868e96', fontWeight: 600, borderBottom: '1px solid #e9ecef', position: 'sticky', top: 0, background: '#f8f9fa' }
  const td: CSSProperties = { padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #f4f5f7', whiteSpace: 'nowrap' }
  const inp: CSSProperties = { padding: '4px 6px', fontSize: 12, border: '1px solid #ced4da', borderRadius: 5, outline: 'none', width: '100%', boxSizing: 'border-box' }
  const colSpan = (editavel ? 11 : 10) + (isReal ? 1 : 0)
  const keyOf = (r: any, col: string): string | number => {
    switch (col) {
      case 'conta': return contaById[r.conta_id]?.codigo || ''
      case 'empresa': return empById[r.empresa_id]?.codigo || ''
      case 'filial': return filById[r.filial_id]?.codigo || ''
      case 'cc': return ccById[r.cc_id]?.codigo || ''
      case 'ccdesc': return ccById[r.cc_id]?.descricao || ''
      case 'area': return r.dims?.area || ''
      case 'divisao': return r.dims?.divisao || ''
      case 'bu': return r.dims?.bu || ''
      case 'historico': return r.dims?.historico || ''
      case 'valor': return Number(r.valor) || 0
      default: return ''
    }
  }
  const rowsSorted = [...rows].sort((a, b) => {
    const ka = keyOf(a, sort.col), kb = keyOf(b, sort.col)
    const s = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'pt')
    return sort.dir === 'asc' ? s : -s
  })

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, width: 'min(1080px, 96vw)', maxHeight: '90vh', padding: 0, display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e9ecef' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#212529' }}>Razão — {titulo}</div>
            <div style={{ fontSize: 12, color: '#868e96' }}>{cenLabel} · {periodoLabel}{editavel ? ' · editável' : ''}</div>
          </div>
          <X size={20} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} />
        </div>

        {editavel && (
          <div style={{ padding: '10px 18px', borderBottom: '1px solid #f1f3f5', background: '#fbfcff' }}>
            {!showAdd ? (
              <button style={{ ...S.btnPri, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setShowAdd(true)}><Plus size={14} /> Novo lançamento</button>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <Campo label="Empresa *"><select style={{ ...inp, width: 150 }} value={form.empresa_id} onChange={e => setForm({ ...form, empresa_id: e.target.value })}><option value="">—</option>{empresasList.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}</select></Campo>
                <Campo label="Filial"><select style={{ ...inp, width: 140 }} value={form.filial_id} onChange={e => setForm({ ...form, filial_id: e.target.value })}><option value="">(todas)</option>{filiaisList.map(f => <option key={f.id} value={f.id}>{f.codigo} · {f.descricao}</option>)}</select></Campo>
                <Campo label="Centro de Custo"><select style={{ ...inp, width: 150 }} value={form.cc_id} onChange={e => setForm({ ...form, cc_id: e.target.value })}><option value="">(nenhum)</option>{ccsList.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.descricao}</option>)}</select></Campo>
                <Campo label="Área"><input style={{ ...inp, width: 90 }} value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} /></Campo>
                <Campo label="Divisão"><input style={{ ...inp, width: 90 }} value={form.divisao} onChange={e => setForm({ ...form, divisao: e.target.value })} /></Campo>
                <Campo label="BU"><input style={{ ...inp, width: 80 }} value={form.bu} onChange={e => setForm({ ...form, bu: e.target.value })} /></Campo>
                <Campo label="Histórico"><input style={{ ...inp, width: 200 }} value={form.historico} onChange={e => setForm({ ...form, historico: e.target.value })} /></Campo>
                <Campo label="Valor *"><input style={{ ...inp, width: 110, textAlign: 'right' }} value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} placeholder="0,00" /></Campo>
                <button style={S.btnGreen} onClick={addRow}>Adicionar</button>
                <button style={S.btnGray} onClick={() => { setShowAdd(false); setForm(emptyForm) }}>Cancelar</button>
              </div>
            )}
          </div>
        )}

        <div style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {isReal && <th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('conta')}>Conta{seta('conta')}</th>}
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('empresa')}>Empresa{seta('empresa')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('filial')}>Filial{seta('filial')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('cc')}>CC{seta('cc')}</th>
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('ccdesc')}>Descrição CC{seta('ccdesc')}</th>
              {!isReal && <><th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('area')}>Área{seta('area')}</th><th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('divisao')}>Divisão{seta('divisao')}</th><th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('bu')}>BU{seta('bu')}</th></>}
              <th style={{ ...th, cursor: 'pointer' }} onClick={() => sortClick('historico')}>Histórico{seta('historico')}</th>
              <th style={{ ...th, textAlign: 'right', cursor: 'pointer' }} onClick={() => sortClick('valor')}>Valor{seta('valor')}</th>
              {editavel && <th style={th}>Origem</th>}
              {editavel && <th style={th} />}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={colSpan} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 24 }}>Carregando...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={colSpan} style={{ ...td, textAlign: 'center', color: '#aaa', padding: 24 }}>{isReal && !contaIds.length ? 'Nenhuma conta contábil amarrada a esta linha. Use o botão 🔗 no editor para mapear contas → linha (conta_linha).' : `Sem lançamentos.${editavel ? ' Use "Novo lançamento".' : ''}`}</td></tr>}
              {!loading && rowsSorted.map((r, i) => {
                const prot = editavel && r.origem === 'FORMULARIO'
                return (
                  <tr key={r.id ?? i}>
                    {isReal && <td style={{ ...td, fontFamily: 'monospace' }} title={contaById[r.conta_id]?.descricao || ''}>{contaById[r.conta_id]?.codigo || '—'}{contaById[r.conta_id]?.descricao ? ` · ${contaById[r.conta_id].descricao}` : ''}</td>}
                    <td style={td} title={empById[r.empresa_id]?.descricao || ''}>{empById[r.empresa_id]?.codigo || '—'}</td>
                    <td style={td} title={filById[r.filial_id]?.descricao || ''}>{filById[r.filial_id]?.codigo || '—'}</td>
                    <td style={{ ...td, fontFamily: 'monospace', color: '#868e96' }}>{ccById[r.cc_id]?.codigo || '—'}</td>
                    <td style={td}>{ccById[r.cc_id]?.descricao || ''}</td>
                    {!isReal && <><td style={td}>{r.dims.area || ''}</td>
                    <td style={td}>{r.dims.divisao || ''}</td>
                    <td style={td}>{r.dims.bu || ''}</td></>}
                    <td style={td}>
                      {editavel && !prot
                        ? <input key={`h${r.id}`} style={inp} defaultValue={r.dims.historico || ''} onBlur={e => saveHist(r, e.target.value)} />
                        : (r.dims.historico || '')}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {editavel && !prot
                        ? <input key={`v${r.id}`} style={{ ...inp, textAlign: 'right' }} defaultValue={String(r.valor)} onBlur={e => saveValor(r, e.target.value)} />
                        : formatValor(Number(r.valor) || 0, 'NUMERO', 2)}
                    </td>
                    {editavel && <td style={{ ...td, fontSize: 10, color: r.origem === 'FORMULARIO' ? '#0c8599' : '#adb5bd' }}>{r.origem || 'MANUAL'}</td>}
                    {editavel && <td style={td}>{!prot && <button style={{ ...S.iconBtn, color: '#ffa8a8' }} onClick={() => delRow(r)}><Trash2 size={13} /></button>}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid #e9ecef', background: '#f8f9fa' }}>
          <strong style={{ fontSize: 13 }}>Soma: {formatValor(soma, 'NUMERO', 2)} ({rows.length} itens)</strong>
          <button style={{ ...S.btnSec, display: 'flex', alignItems: 'center', gap: 6 }} onClick={exportar}><Download size={14} /> Exportar</button>
        </div>
      </div>
    </div>
  )
}
function Campo({ label, children }: { label: string; children: any }) {
  return <div><label style={{ display: 'block', fontSize: 10, color: '#868e96', marginBottom: 2 }}>{label}</label>{children}</div>
}

// ─── Modal: adicionar linhas da estrutura compartilhada (F4) ──
const TIPO_LBL: Record<string, string> = { ANALITICA: 'Analítica', SOMAR_FILHOS: 'Somar filhos', FORMULA: 'Fórmula', INDICADOR: 'Indicador', ESPACO: 'Espaço' }
function EstruturaPicker({ masters, jaNoRelatorio, alvo, onAdd, onClose }: {
  masters: any[]; jaNoRelatorio: Set<string>; alvo: string | null
  onAdd: (rootMasterId: string, incluirSub: boolean) => Promise<void> | void; onClose: () => void
}) {
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [sub, setSub] = useState(true)
  const [busy, setBusy] = useState(false)
  const s = busca.trim().toLowerCase()
  const filtrados = s ? masters.filter(m => `${m.codigo} ${m.descricao}`.toLowerCase().includes(s)) : masters
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, width: 'min(640px, 96vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e9ecef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#212529' }}>Adicionar da estrutura compartilhada</div>
          <X size={20} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} />
        </div>
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #f1f3f5' }}>
          <input autoFocus placeholder="🔎 Buscar por código ou descrição..." value={busca} onChange={e => setBusca(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 8, boxSizing: 'border-box', outline: 'none' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#495057', marginTop: 10 }}>
            <input type="checkbox" checked={sub} onChange={e => setSub(e.target.checked)} /> Incluir a subárvore (linhas filhas/netas)
          </label>
          <div style={{ fontSize: 12, color: '#868e96', marginTop: 6 }}>{alvo ? <>Será adicionada como filha de: <b>{alvo}</b></> : 'Será adicionada no topo (selecione uma linha antes para aninhar).'}</div>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {filtrados.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#aaa', fontSize: 13 }}>Nada encontrado.</div>}
          {filtrados.map(m => {
            const ja = jaNoRelatorio.has(m.codigo)
            return (
              <div key={m.id} onClick={() => !ja && setSel(m.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', cursor: ja ? 'default' : 'pointer', fontSize: 13, background: sel === m.id ? '#edf2ff' : 'white', opacity: ja ? 0.45 : 1, borderBottom: '1px solid #f8f9fa' }}>
                <input type="radio" checked={sel === m.id} disabled={ja} onChange={() => setSel(m.id)} />
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#868e96', minWidth: 90 }}>{m.codigo}</span>
                <span style={{ flex: 1 }}>{m.descricao}</span>
                <span style={{ fontSize: 11, color: '#adb5bd' }}>{TIPO_LBL[m.tipo_linha] || m.tipo_linha}{ja ? ' · já no relatório' : ''}</span>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e9ecef', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={S.btnSec} onClick={onClose}>Cancelar</button>
          <button style={{ ...S.btnPri, opacity: (!sel || busy) ? 0.5 : 1 }} disabled={!sel || busy}
            onClick={async () => { if (!sel) return; setBusy(true); await onAdd(sel, sub); setBusy(false) }}>{busy ? 'Adicionando…' : 'Adicionar'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: DE-PARA conta → linha ────────────────────────────
function ContaLinkModal({ linha, contas, mapeadas, onAddMany, onRemove, onToggleSinal, onClose }: {
  linha: Linha
  contas: { id: string; codigo: string; descricao: string }[]
  mapeadas: any[]
  onAddMany: (contaIds: string[]) => void
  onRemove: (id: string) => void
  onToggleSinal: (id: string, sinal: number) => void
  onClose: () => void
}) {
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [linked, setLinked] = useState<Set<string>>(new Set())   // contas já amarradas em qualquer linha
  useEffect(() => { supabase.from('conta_linha').select('conta_id').then((r: any) => setLinked(new Set((r.data || []).map((x: any) => x.conta_id)))) }, [])
  const toggleSel = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const mapped = new Set(mapeadas.map(m => m.conta_id))
  const b = busca.trim().toLowerCase()
  const result = b
    ? contas.filter(c => !mapped.has(c.id) && (c.codigo.toLowerCase().includes(b) || c.descricao.toLowerCase().includes(b))).slice(0, 60)
    : []
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, width: 520 }} onClick={e => e.stopPropagation()}>
        <div style={S.mTitle}>Contas → <span style={{ color: '#1971c2' }}>{linha.descricao}</span> <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} /></div>
        <div style={S.help}>Contas contábeis cujo realizado será somado nesta linha. O valor importado é crédito − débito; use sinal −1 para inverter (ex.: deixar receita ou despesa positiva).</div>

        {mapeadas.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: '#868e96' }}>
            <span>Aplicar a todas:</span>
            <button onClick={() => mapeadas.forEach(m => onToggleSinal(m.id, 1))}
              style={{ padding: '3px 10px', border: '1px solid #b2f2bb', borderRadius: 6, cursor: 'pointer', background: '#ebfbee', color: '#2f9e44', fontWeight: 700 }}>+ Tudo</button>
            <button onClick={() => mapeadas.forEach(m => onToggleSinal(m.id, -1))}
              style={{ padding: '3px 10px', border: '1px solid #ffc9c9', borderRadius: 6, cursor: 'pointer', background: '#fff5f5', color: '#e03131', fontWeight: 700 }}>− Tudo</button>
          </div>
        )}

        <div style={{ margin: '12px 0' }}>
          {mapeadas.length === 0 && <div style={{ fontSize: 13, color: '#adb5bd', padding: '8px 0' }}>Nenhuma conta amarrada ainda.</div>}
          {mapeadas.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f3f5' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#868e96', minWidth: 90 }}>{m.conta_contabil?.codigo}</span>
              {m.conta_contabil?.plano_contas?.codigo && <span style={{ fontSize: 10, color: '#1971c2', background: '#e7f5ff', borderRadius: 4, padding: '1px 5px' }}>{m.conta_contabil.plano_contas.codigo}</span>}
              <span style={{ fontSize: 13, flex: 1 }}>{m.conta_contabil?.descricao}</span>
              <button onClick={() => onToggleSinal(m.id, m.sinal === 1 ? -1 : 1)}
                title="Inverter sinal"
                style={{ width: 28, border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer', background: m.sinal === 1 ? '#ebfbee' : '#fff5f5', color: m.sinal === 1 ? '#2f9e44' : '#e03131', fontWeight: 700 }}>
                {m.sinal === 1 ? '+' : '−'}
              </button>
              <button onClick={() => onRemove(m.id)} style={{ ...S.iconBtn, color: '#ffa8a8' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div style={S.field}>
          <label style={S.label}>Adicionar contas (marque várias)</label>
          <input style={S.input} placeholder="Buscar por código ou descrição..." value={busca} onChange={e => setBusca(e.target.value)} />
          {result.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0', fontSize: 12 }}>
                <button onClick={() => setSel(prev => { const n = new Set(prev); result.forEach(c => n.add(c.id)); return n })} style={{ background: 'none', border: 'none', color: '#3b5bdb', cursor: 'pointer', padding: 0 }}>Marcar resultados ({result.length})</button>
                {sel.size > 0 && <button onClick={() => setSel(new Set())} style={{ background: 'none', border: 'none', color: '#868e96', cursor: 'pointer', padding: 0 }}>Limpar</button>}
                <div style={{ flex: 1 }} />
                <button disabled={!sel.size} onClick={() => { onAddMany([...sel]); setSel(new Set()); setBusca('') }}
                  style={{ ...S.btnPri, opacity: sel.size ? 1 : 0.5, cursor: sel.size ? 'pointer' : 'default', padding: '6px 12px' }}>Adicionar{sel.size ? ` ${sel.size}` : ''}</button>
              </div>
              <div style={{ border: '1px solid #e9ecef', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
                {result.map(c => { const on = sel.has(c.id); const elsewhere = linked.has(c.id); return (
                  <div key={c.id} onClick={() => toggleSel(c.id)}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f8f9fa', background: on ? '#edf2ff' : elsewhere ? '#fff9db' : 'white' }}>
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

        <div style={S.mFooter}>
          <button style={S.btnPri} onClick={onClose}>Concluir</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: linha ────────────────────────────────────────────
function LinhaModal({ linha, refLinhas, onClose, onSave }: { linha: Linha; refLinhas: { codigo: string; descricao: string }[]; onClose: () => void; onSave: (l: Linha) => void }) {
  const [l, setL] = useState<Linha>(linha)
  const isFormula = l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR'
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.mTitle}>Editar linha <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} /></div>
        <div style={S.field}>
          <label style={S.label}>Descrição</label>
          <input style={S.input} value={l.descricao} onChange={e => setL({ ...l, descricao: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ ...S.field, flex: 1 }}>
            <label style={S.label}>Código (ref. em fórmulas)</label>
            <input style={S.input} value={l.codigo} onChange={e => setL({ ...l, codigo: e.target.value })} />
          </div>
          <div style={{ ...S.field, flex: 1 }}>
            <label style={S.label}>Natureza</label>
            <select style={S.input} value={l.natureza ?? 'NEUTRO'} onChange={e => setL({ ...l, natureza: e.target.value })}>
              <option value="RECEITA">Receita</option><option value="DESPESA">Despesa</option><option value="NEUTRO">Neutro</option>
            </select>
          </div>
        </div>
        <div style={S.field}>
          <label style={S.label}>Tipo de linha</label>
          <select style={S.input} value={l.tipo_linha} onChange={e => setL({ ...l, tipo_linha: e.target.value as TipoLinha })}>
            {(Object.keys(TIPO_INFO) as TipoLinha[]).map(t => <option key={t} value={t}>{TIPO_INFO[t].label}</option>)}
          </select>
          <div style={S.help}>
            <b>Analítica</b>: cada célula aceita número OU fórmula (ex.: Jan = 1000, Fev = <code>=ANTERIOR()*1,05</code>).
            {' '}<b>Fórmula/Indicador</b>: uma só expressão governa a linha inteira (células não digitáveis).
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ ...S.field, flex: 1 }}>
            <label style={S.label}>Formato</label>
            <select style={S.input} value={l.formato} onChange={e => setL({ ...l, formato: e.target.value as Formato })}>
              <option value="NUMERO">Número</option><option value="PERCENTUAL">Percentual (%)</option><option value="MOEDA">Moeda</option>
            </select>
          </div>
          <div style={{ ...S.field, flex: 1 }}>
            <label style={S.label}>Casas decimais</label>
            <input type="number" min={0} max={4} style={S.input} value={l.casas_decimais}
              onChange={e => setL({ ...l, casas_decimais: Number(e.target.value) })} />
          </div>
        </div>
        {isFormula && (
          <div style={S.field}>
            <label style={S.label}>Expressão</label>
            <FormulaCellInput
              value={l.expressao ?? ''}
              onChange={v => setL({ ...l, expressao: v })}
              linhas={refLinhas}
              inputStyle={{ ...S.input, fontFamily: 'monospace' }}
              fullWidth
            />
            <div style={S.help}>Use o <b>nome da linha</b> entre colchetes (digite <code>[</code> p/ sugerir). Ex.: <code>=[Lucro Bruto]/[Receita Líquida]*100</code> · <code>=ANTERIOR()*1,05</code>.</div>
          </div>
        )}
        <div style={S.field}>
          <label style={S.label}>Cor do texto</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="color" value={l.cor_texto || '#212529'} onChange={e => setL({ ...l, cor_texto: e.target.value })}
              style={{ width: 44, height: 32, padding: 0, border: '1px solid #ced4da', borderRadius: 6, cursor: 'pointer' }} />
            <button style={S.btnSec} onClick={() => setL({ ...l, cor_texto: null })}>Automático</button>
            <span style={{ fontSize: 12, color: '#adb5bd' }}>{l.cor_texto || 'automático (pelo tipo)'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <label style={S.chk}><input type="checkbox" checked={l.negrito} onChange={e => setL({ ...l, negrito: e.target.checked })} /> Negrito</label>
          <label style={S.chk}><input type="checkbox" checked={l.italico} onChange={e => setL({ ...l, italico: e.target.checked })} /> Itálico</label>
        </div>
        <label style={{ ...S.chk, color: l.desativada ? '#e03131' : '#495057' }}>
          <input type="checkbox" checked={!!l.desativada} onChange={e => setL({ ...l, desativada: e.target.checked })} /> Desativar linha (valores tachados, fora da somatória)
        </label>
        <div style={S.mFooter}>
          <button style={S.btnSec} onClick={onClose}>Cancelar</button>
          <button style={S.btnPri} onClick={() => onSave(l)}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: view ─────────────────────────────────────────────
function ViewModal({ view, versoes, onClose, onSave }: { view: ViewConfig; versoes: Versao[]; onClose: () => void; onSave: (v: ViewConfig) => void }) {
  const [v, setV] = useState<ViewConfig>(view)
  const toggleCen = (k: string) => setV(p => ({ ...p, cenarios: p.cenarios.includes(k) ? p.cenarios.filter(c => c !== k) : [...p.cenarios, k] }))
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.mTitle}>{view._synthetic ? 'Nova visão' : 'Editar visão'} <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} /></div>
        <div style={S.field}>
          <label style={S.label}>Nome</label>
          <input style={S.input} value={v.nome} onChange={e => setV({ ...v, nome: e.target.value })} />
        </div>
        <div style={S.field}>
          <label style={S.label}>Função (colunas)</label>
          <select style={S.input} value={v.funcao} onChange={e => setV({ ...v, funcao: e.target.value as Funcao })}>
            {(Object.keys(FUNCAO_LABEL) as Funcao[]).map(f => <option key={f} value={f}>{FUNCAO_LABEL[f]}</option>)}
          </select>
          <div style={S.help}>Layout das colunas (independente da granularidade): <b>Períodos</b> (cada período + total) · <b>Acumulado</b> (só o total) · <b>Acum. + Períodos</b> · <b>Comparativo</b> (cenários lado a lado + Δ%).</div>
        </div>
        <div style={S.field}>
          <label style={S.label}>Granularidade</label>
          <select style={S.input} value={v.filtros?.granularidade || 'MENSAL'}
            onChange={e => setV({ ...v, filtros: { ...(v.filtros || {}), granularidade: e.target.value } })}>
            {Object.keys(GRAN_LABEL).map(g => <option key={g} value={g}>{GRAN_LABEL[g]}</option>)}
          </select>
        </div>
        <div style={S.help}>O intervalo (de–até) é definido na grade dos Filtros. A granularidade agrupa esse intervalo em meses, trimestres, semestres ou anos.</div>
        <label style={{ ...S.chk, marginTop: 8 }}>
          <input type="checkbox" checked={!!v.filtros?.colEmpresa} onChange={e => setV({ ...v, filtros: { ...(v.filtros || {}), colEmpresa: e.target.checked } })} />
          Agrupar colunas por empresa (lado a lado)
        </label>
        <div style={S.help}>Cada empresa selecionada no filtro vira um grupo de colunas, com os períodos embaixo. Somente leitura; não se aplica ao Comparativo.</div>
        <div style={S.field}>
          <label style={S.label}>Cenários exibidos</label>
          {versoes.map(ver => (
            <label key={ver.id} style={S.chk}>
              <input type="checkbox" checked={v.cenarios.includes(ver.id)} onChange={() => toggleCen(ver.id)} /> {ver.codigo}
            </label>
          ))}
          <label style={S.chk}><input type="checkbox" checked={v.cenarios.includes(REALIZADO)} onChange={() => toggleCen(REALIZADO)} /> Realizado</label>
        </div>
        <div style={S.mFooter}>
          <button style={S.btnSec} onClick={onClose}>Cancelar</button>
          <button style={S.btnPri} onClick={() => onSave(v)}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
