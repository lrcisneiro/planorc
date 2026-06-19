import { useEffect, useMemo, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { evaluate } from 'mathjs'
import { supabase, TENANT_ID } from '../../lib/supabase'
import {
  ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2,
  Settings2, X, Sigma, FunctionSquare, Percent, Minus, Type,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────
type TipoLinha = 'SOMAR_FILHOS' | 'ANALITICA' | 'FORMULA' | 'INDICADOR' | 'ESPACO'
type Funcao    = 'MENSAL' | 'ACM' | 'MENSAL_ACM' | 'COMPARATIVO'

type Linha = {
  id: string
  template_id: string
  pai_id: string | null
  codigo: string
  descricao: string
  tipo_linha: TipoLinha
  natureza: string | null
  ordem: number | null
  negrito: boolean
  italico: boolean
  expressao: string | null
  _depth: number
}

type Template = { id: string; codigo: string; nome: string; tipo: string }
type Empresa  = { id: string; codigo: string; descricao: string }
type Versao   = { id: string; codigo: string }
type ViewConfig = {
  id: string
  nome: string
  ordem: number | null
  funcao: Funcao
  cenarios: string[]      // uuids de versao + 'REALIZADO'
  filtros: any
  _synthetic?: boolean
}

// valores[cenarioKey][linhaId][mes]
type ValMap = Record<string, Record<string, Record<number, number>>>

// ─── Constants ───────────────────────────────────────────────
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const ANOS  = [2024, 2025, 2026, 2027, 2028]
const REALIZADO = 'REALIZADO'

const FUNCAO_LABEL: Record<Funcao, string> = {
  MENSAL: 'Mensal', ACM: 'Acumulado', MENSAL_ACM: 'Acum. + Mensal', COMPARATIVO: 'Comparativo',
}

const TIPO_INFO: Record<TipoLinha, { label: string; icon: any; cor: string }> = {
  SOMAR_FILHOS: { label: 'Subtotal (soma filhos)', icon: Sigma,          cor: '#1971c2' },
  ANALITICA:    { label: 'Analítica (lançável)',   icon: Type,           cor: '#212529' },
  FORMULA:      { label: 'Fórmula',                 icon: FunctionSquare, cor: '#6741d9' },
  INDICADOR:    { label: 'Indicador (%)',           icon: Percent,        cor: '#0c8599' },
  ESPACO:       { label: 'Espaço / separador',      icon: Minus,          cor: '#adb5bd' },
}

// ─── Helpers ─────────────────────────────────────────────────
function buildTree(linhas: Linha[], paiId: string | null = null, depth = 0): Linha[] {
  return linhas
    .filter(l => l.pai_id === paiId)
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    .flatMap(l => [{ ...l, _depth: depth }, ...buildTree(linhas, l.id, depth + 1)])
}

function fmt(v: number): string {
  if (!v) return ''
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtPct(v: number): string {
  if (!isFinite(v)) return ''
  return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}
function parseNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
}

// ─── Engine de cálculo ───────────────────────────────────────
// Avalia a expressão de uma linha FORMULA/INDICADOR para um mês.
function evalExpr(
  expr: string | null,
  lineId: string,
  mes: number,
  codeToId: Record<string, string>,
  result: Record<string, Record<number, number>>,
  cur: Record<string, number>,
): number {
  if (!expr) return 0
  let s = expr.trim().replace(/^=/, '').trim()
  if (!s) return 0
  try {
    // ANTERIOR([cod], N) -> valor de cod há N meses
    s = s.replace(/ANTERIOR\s*\(\s*\[([^\]]+)\]\s*,\s*(\d+)\s*\)/gi,
      (_m, c, n) => String(result[codeToId[c]]?.[mes - Number(n)] ?? 0))
    // ANTERIOR([cod]) -> valor de cod no mês anterior
    s = s.replace(/ANTERIOR\s*\(\s*\[([^\]]+)\]\s*\)/gi,
      (_m, c) => String(result[codeToId[c]]?.[mes - 1] ?? 0))
    // ANTERIOR() -> valor desta linha no mês anterior
    s = s.replace(/ANTERIOR\s*\(\s*\)/gi,
      () => String(result[lineId]?.[mes - 1] ?? 0))
    // [cod] -> valor de cod no mês atual
    s = s.replace(/\[([^\]]+)\]/g, (_m, c) => String(cur[codeToId[c]] ?? 0))
    const val = evaluate(s)
    return typeof val === 'number' && isFinite(val) ? val : 0
  } catch {
    return 0
  }
}

// Avalia expressão sobre os TOTAIS anuais (sem dimensão temporal).
function evalExprTotal(
  expr: string | null,
  codeToId: Record<string, string>,
  totals: Record<string, number>,
): number {
  if (!expr) return 0
  let s = expr.trim().replace(/^=/, '').trim()
  if (!s) return 0
  try {
    s = s.replace(/ANTERIOR\s*\([^)]*\)/gi, '0')        // sem tempo no total
    s = s.replace(/\[([^\]]+)\]/g, (_m, c) => String(totals[codeToId[c]] ?? 0))
    const val = evaluate(s)
    return typeof val === 'number' && isFinite(val) ? val : 0
  } catch {
    return 0
  }
}

// Calcula valores mensais de um cenário (resolve fórmulas e subtotais por ponto-fixo).
function computeCenario(linhas: Linha[], raw: Record<string, Record<number, number>>) {
  const codeToId: Record<string, string> = {}
  linhas.forEach(l => { codeToId[l.codigo] = l.id })
  const childrenOf: Record<string, Linha[]> = {}
  linhas.forEach(l => { const p = l.pai_id ?? '__root'; (childrenOf[p] ||= []).push(l) })

  const result: Record<string, Record<number, number>> = {}
  linhas.forEach(l => { result[l.id] = {} })

  for (let mes = 1; mes <= 12; mes++) {
    const cur: Record<string, number> = {}
    const passes = linhas.length + 2
    for (let p = 0; p < passes; p++) {
      for (const l of linhas) {
        let v = 0
        if (l.tipo_linha === 'ESPACO') v = 0
        else if (l.tipo_linha === 'SOMAR_FILHOS') {
          v = (childrenOf[l.id] || [])
            .filter(c => c.tipo_linha !== 'INDICADOR' && c.tipo_linha !== 'ESPACO')
            .reduce((s, c) => s + (cur[c.id] ?? 0), 0)
        } else if (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') {
          v = evalExpr(l.expressao, l.id, mes, codeToId, result, cur)
        } else {
          v = raw[l.id]?.[mes] ?? 0
        }
        cur[l.id] = v
      }
    }
    for (const l of linhas) result[l.id][mes] = cur[l.id]
  }
  return result
}

// Totais anuais por linha (respeitando o tipo).
function computeTotais(linhas: Linha[], computed: Record<string, Record<number, number>>) {
  const codeToId: Record<string, string> = {}
  linhas.forEach(l => { codeToId[l.codigo] = l.id })
  const childrenOf: Record<string, Linha[]> = {}
  linhas.forEach(l => { const p = l.pai_id ?? '__root'; (childrenOf[p] ||= []).push(l) })

  const totals: Record<string, number> = {}
  const passes = linhas.length + 2
  for (let p = 0; p < passes; p++) {
    for (const l of linhas) {
      let v = 0
      if (l.tipo_linha === 'ESPACO') v = 0
      else if (l.tipo_linha === 'SOMAR_FILHOS') {
        v = (childrenOf[l.id] || [])
          .filter(c => c.tipo_linha !== 'INDICADOR' && c.tipo_linha !== 'ESPACO')
          .reduce((s, c) => s + (totals[c.id] ?? 0), 0)
      } else if (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') {
        v = evalExprTotal(l.expressao, codeToId, totals)
      } else {
        v = Array.from({ length: 12 }, (_, i) => computed[l.id]?.[i + 1] ?? 0).reduce((s, x) => s + x, 0)
      }
      totals[l.id] = v
    }
  }
  return totals
}

// ─── Styles ──────────────────────────────────────────────────
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
  thDesc:    { textAlign: 'left', minWidth: 260, position: 'sticky', left: 0, zIndex: 3, background: '#f1f3f5' },
  td:        { padding: '5px 10px', borderBottom: '1px solid #f1f3f5', borderRight: '1px solid #f4f5f7', textAlign: 'right', whiteSpace: 'nowrap' },
  tdDesc:    { textAlign: 'left', position: 'sticky', left: 0, zIndex: 1, padding: '5px 8px', minWidth: 260 },
  iconBtn:   { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center', color: '#ced4da' },
  cellInput: { width: 80, border: '1px solid #339af0', borderRadius: 4, padding: '2px 6px', fontSize: 13, textAlign: 'right', outline: 'none', background: '#e7f5ff' },
  addRow:    { background: 'none', border: '1px dashed #ced4da', borderRadius: 6, padding: '6px 14px', color: '#adb5bd', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 },
  newInput:  { flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid #69db7c', borderRadius: 6, outline: 'none' },
  btnGreen:  { padding: '6px 14px', background: '#2f9e44', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnGray:   { padding: '6px 10px', background: 'none', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  // Modal
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

function viewTab(active: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer',
    borderRadius: 7, border: '1px solid', borderColor: active ? '#3b5bdb' : '#e9ecef',
    background: active ? '#edf2ff' : 'white', color: active ? '#3b5bdb' : '#868e96', fontWeight: active ? 600 : 500,
  }
}

// ─── Tipos de coluna ─────────────────────────────────────────
type Period = number | 'TOTAL'
type Column = { key: string; label: string; cenarioKey?: string; period: Period; kind: 'value' | 'delta' }
type Group  = { label: string; span: number }

// ─── Component ───────────────────────────────────────────────
export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [template,  setTemplate]  = useState<Template | null>(null)
  const [linhas,    setLinhas]    = useState<Linha[]>([])
  const [raw,       setRaw]       = useState<ValMap>({})   // valores brutos por cenário
  const [empresas,  setEmpresas]  = useState<Empresa[]>([])
  const [versoes,   setVersoes]   = useState<Versao[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [versaoId,  setVersaoId]  = useState('')           // versão editável
  const [ano,       setAno]       = useState(2026)
  const [views,     setViews]     = useState<ViewConfig[]>([])
  const [activeView, setActiveView] = useState<string>('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editCell,  setEditCell]  = useState<{ linhaId: string; mes: number } | null>(null)
  const [editVal,   setEditVal]   = useState('')
  const [adding,    setAdding]    = useState<{ paiId: string | null } | null>(null)
  const [newDesc,   setNewDesc]   = useState('')
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [linhaModal, setLinhaModal] = useState<Linha | null>(null)
  const [viewModal,  setViewModal]  = useState<ViewConfig | null>(null)

  // ── Carrega template + linhas
  const loadTemplate = useCallback(async () => {
    if (!id) return
    const { data: t } = await supabase.from('template').select('*').eq('id', id).single()
    setTemplate(t)
    const { data: ls } = await supabase
      .from('linha_template').select('*').eq('template_id', id).order('ordem', { nullsFirst: false })
    setLinhas((ls || []).map((l: any) => ({ ...l, _depth: 0 })))
  }, [id])

  // ── Carrega views
  const loadViews = useCallback(async () => {
    if (!id) return
    const { data } = await supabase.from('view_config').select('*').eq('template_id', id).order('ordem', { nullsFirst: false })
    const vs = (data || []) as ViewConfig[]
    setViews(vs)
    if (vs.length) setActiveView(prev => prev || vs[0].id)
  }, [id])

  // ── Carrega empresas / versões
  const loadDim = useCallback(async () => {
    const [{ data: emps }, { data: vers }] = await Promise.all([
      supabase.from('empresa').select('id,codigo,descricao').order('codigo'),
      supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
    ])
    const e = emps || [], v = vers || []
    setEmpresas(e); setVersoes(v)
    if (e.length) setEmpresaId(prev => prev || e[0].id)
    if (v.length) setVersaoId(prev => prev || v[0].id)
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadTemplate(), loadDim(), loadViews()]).then(() => setLoading(false))
  }, [id]) // eslint-disable-line

  // View ativa (com fallback sintético)
  const view: ViewConfig = useMemo(() => {
    const found = views.find(v => v.id === activeView)
    if (found) return found
    return { id: '__default', nome: 'Mensal', ordem: 0, funcao: 'MENSAL', cenarios: versaoId ? [versaoId] : [], filtros: {}, _synthetic: true }
  }, [views, activeView, versaoId])

  // Cenários a carregar = os da view + a versão editável
  const cenariosAtivos = useMemo(() => {
    const set = new Set<string>(view.cenarios)
    if (versaoId) set.add(versaoId)
    return Array.from(set)
  }, [view, versaoId])

  // ── Carrega valores de todos os cenários ativos
  const loadValores = useCallback(async () => {
    if (!empresaId || !cenariosAtivos.length) { setRaw({}); return }
    const next: ValMap = {}
    for (const cen of cenariosAtivos) {
      const map: Record<string, Record<number, number>> = {}
      if (cen === REALIZADO) {
        const { data } = await supabase
          .from('fat_realizado').select('linha_id,mes,valor')
          .eq('empresa_id', empresaId).eq('ano', ano)
        for (const r of data || []) {
          (map[r.linha_id] ||= {})[r.mes] = (map[r.linha_id]?.[r.mes] ?? 0) + (Number(r.valor) || 0)
        }
      } else {
        const { data } = await supabase
          .from('fat_orcado').select('linha_id,mes,valor')
          .eq('versao_id', cen).eq('empresa_id', empresaId).eq('ano', ano)
          .is('filial_id', null).is('cc_id', null)
        for (const r of data || []) {
          (map[r.linha_id] ||= {})[r.mes] = (map[r.linha_id]?.[r.mes] ?? 0) + (Number(r.valor) || 0)
        }
      }
      next[cen] = map
    }
    setRaw(next)
  }, [empresaId, ano, cenariosAtivos])

  useEffect(() => { loadValores() }, [loadValores])

  // ── Cálculo (computed + totais por cenário)
  const computed = useMemo(() => {
    const out: ValMap = {}
    for (const cen of cenariosAtivos) out[cen] = computeCenario(linhas, raw[cen] || {})
    return out
  }, [linhas, raw, cenariosAtivos])

  const totais = useMemo(() => {
    const out: Record<string, Record<string, number>> = {}
    for (const cen of cenariosAtivos) out[cen] = computeTotais(linhas, computed[cen] || {})
    return out
  }, [linhas, computed, cenariosAtivos])

  // ── Leitura de célula
  function cellVal(cen: string, linhaId: string, period: Period): number {
    if (period === 'TOTAL') return totais[cen]?.[linhaId] ?? 0
    return computed[cen]?.[linhaId]?.[period] ?? 0
  }

  // ── Helpers de árvore
  const temFilhos = (linhaId: string) => linhas.some(l => l.pai_id === linhaId)
  const toggle = (linhaId: string) => setCollapsed(prev => {
    const next = new Set(prev); next.has(linhaId) ? next.delete(linhaId) : next.add(linhaId); return next
  })

  const tree = buildTree(linhas)
  const visivel = tree.filter(l => {
    let cursor = linhas.find(x => x.id === l.pai_id)
    while (cursor) {
      if (collapsed.has(cursor.id)) return false
      cursor = linhas.find(x => x.id === cursor!.pai_id)
    }
    return true
  })

  // ── Colunas conforme a view
  const cenarioLabel = (key: string): string =>
    key === REALIZADO ? 'Real.' : (versoes.find(v => v.id === key)?.codigo ?? '—')

  const { columns, groups, twoRow } = useMemo<{ columns: Column[]; groups: Group[]; twoRow: boolean }>(() => {
    const cens = view.cenarios.length ? view.cenarios : (versaoId ? [versaoId] : [])
    const primary = cens[0] || versaoId

    if (view.funcao === 'COMPARATIVO') {
      const periods: Period[] = [...Array.from({ length: 12 }, (_, i) => i + 1), 'TOTAL']
      const cols: Column[] = []
      const grps: Group[] = []
      for (const per of periods) {
        const perLabel = per === 'TOTAL' ? 'Total' : MESES[(per as number) - 1]
        let span = 0
        for (const cen of cens) {
          cols.push({ key: `${per}-${cen}`, label: cenarioLabel(cen), cenarioKey: cen, period: per, kind: 'value' }); span++
        }
        if (cens.length >= 2) { cols.push({ key: `${per}-delta`, label: 'Δ%', period: per, kind: 'delta' }); span++ }
        grps.push({ label: perLabel, span })
      }
      return { columns: cols, groups: grps, twoRow: true }
    }

    if (view.funcao === 'ACM') {
      return {
        columns: [{ key: 'acm', label: 'Acumulado', cenarioKey: primary, period: 'TOTAL', kind: 'value' }],
        groups: [], twoRow: false,
      }
    }

    const monthCols: Column[] = Array.from({ length: 12 }, (_, i) => ({
      key: `m${i + 1}`, label: MESES[i], cenarioKey: primary, period: (i + 1) as Period, kind: 'value' as const,
    }))
    const totalCol: Column = { key: 'total', label: 'Total', cenarioKey: primary, period: 'TOTAL', kind: 'value' }

    if (view.funcao === 'MENSAL_ACM') {
      return { columns: [{ ...totalCol, label: 'Acum.' }, ...monthCols], groups: [], twoRow: false }
    }
    // MENSAL
    return { columns: [...monthCols, totalCol], groups: [], twoRow: false }
  }, [view, versaoId, versoes])

  // ── Salvar célula (apenas versão editável, linha ANALITICA, período mensal)
  const saveCell = async (linhaId: string, mes: number) => {
    if (!versaoId || !empresaId) { setEditCell(null); return }
    setSaving(true)
    const valor = parseNum(editVal)
    const { data: existing } = await supabase
      .from('fat_orcado').select('id')
      .eq('versao_id', versaoId).eq('linha_id', linhaId).eq('empresa_id', empresaId)
      .eq('ano', ano).eq('mes', mes).is('filial_id', null).is('cc_id', null)
      .maybeSingle()

    if (existing) await supabase.from('fat_orcado').update({ valor }).eq('id', existing.id)
    else await supabase.from('fat_orcado').insert({
      tenant_id: TENANT_ID, versao_id: versaoId, linha_id: linhaId,
      empresa_id: empresaId, filial_id: null, cc_id: null, ano, mes, valor, dims: {},
    })

    setRaw(prev => ({
      ...prev,
      [versaoId]: { ...(prev[versaoId] || {}), [linhaId]: { ...(prev[versaoId]?.[linhaId] || {}), [mes]: valor } },
    }))
    setEditCell(null); setSaving(false)
  }

  // ── Adicionar linha
  const addLinha = async () => {
    if (!newDesc.trim() || !id) return
    const siblings = linhas.filter(l => l.pai_id === (adding?.paiId ?? null))
    const maxOrdem = siblings.reduce((m, l) => Math.max(m, l.ordem ?? 0), 0)
    const { data, error } = await supabase.from('linha_template').insert({
      template_id: id, pai_id: adding?.paiId ?? null, descricao: newDesc.trim(),
      codigo: `L${Date.now().toString(36)}`, tipo_linha: 'ANALITICA', natureza: 'NEUTRO',
      ordem: maxOrdem + 10, negrito: false, italico: false,
    }).select().single()
    if (!error && data) setLinhas(prev => [...prev, { ...data, _depth: 0 }])
    setAdding(null); setNewDesc('')
  }

  const deleteLinha = async (linhaId: string) => {
    if (!confirm('Excluir esta linha e todos os valores associados?')) return
    await supabase.from('linha_template').delete().eq('id', linhaId)
    setLinhas(prev => prev.filter(l => l.id !== linhaId && l.pai_id !== linhaId))
  }

  // ── Salvar propriedades da linha
  const saveLinha = async (l: Linha) => {
    const patch = {
      codigo: l.codigo.trim(), descricao: l.descricao.trim(), tipo_linha: l.tipo_linha,
      natureza: l.natureza || null, negrito: l.negrito, italico: l.italico,
      expressao: (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') ? (l.expressao || null) : null,
    }
    const { error } = await supabase.from('linha_template').update(patch).eq('id', l.id)
    if (error) { alert('Erro ao salvar linha: ' + error.message); return }
    setLinhas(prev => prev.map(x => x.id === l.id ? { ...x, ...patch } : x))
    setLinhaModal(null)
  }

  // ── Salvar view
  const saveView = async (v: ViewConfig) => {
    if (!id) return
    if (v._synthetic || !v.id || v.id === '__default') {
      const ordem = (views.reduce((m, x) => Math.max(m, x.ordem ?? 0), 0)) + 10
      const { data, error } = await supabase.from('view_config').insert({
        template_id: id, nome: v.nome, ordem, funcao: v.funcao, cenarios: v.cenarios, filtros: {},
      }).select().single()
      if (error) { alert('Erro ao salvar view: ' + error.message); return }
      await loadViews(); if (data) setActiveView(data.id)
    } else {
      const { error } = await supabase.from('view_config').update({
        nome: v.nome, funcao: v.funcao, cenarios: v.cenarios,
      }).eq('id', v.id)
      if (error) { alert('Erro ao salvar view: ' + error.message); return }
      await loadViews()
    }
    setViewModal(null)
  }
  const deleteView = async (vid: string) => {
    if (!confirm('Excluir esta visão?')) return
    await supabase.from('view_config').delete().eq('id', vid)
    if (activeView === vid) setActiveView('')
    loadViews()
  }

  // ── Render
  if (loading) return <div style={{ padding: 32, color: '#aaa', fontSize: 14 }}>Carregando...</div>

  return (
    <div style={S.page}>

      {/* ── Header ── */}
      <div style={S.header}>
        <button style={S.back} onClick={() => navigate('/templates')}>
          <ChevronLeft size={15} /> Templates
        </button>
        <span style={S.title}>{template?.nome ?? '...'}</span>

        <select style={S.sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
          <option value="">— Empresa —</option>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}
        </select>

        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)} title="Versão editável">
          <option value="">— Versão —</option>
          {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
        </select>

        <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>
          {ANOS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {saving && <span style={{ fontSize: 12, color: '#aaa' }}>Salvando...</span>}
      </div>

      {/* ── Barra de views ── */}
      <div style={S.viewsBar}>
        {(views.length ? views : [view]).map(v => (
          <div key={v.id} style={viewTab(v.id === view.id)} onClick={() => setActiveView(v.id)}>
            <span>{v.nome}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>· {FUNCAO_LABEL[v.funcao]}</span>
            {!v._synthetic && v.id === view.id && (
              <>
                <Settings2 size={12} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setViewModal(v) }} />
                <X size={12} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); deleteView(v.id) }} />
              </>
            )}
            {v._synthetic && v.id === view.id && (
              <Settings2 size={12} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setViewModal(v) }} />
            )}
          </div>
        ))}
        <button
          style={{ ...viewTab(false), borderStyle: 'dashed', color: '#adb5bd' }}
          onClick={() => setViewModal({ id: '__default', nome: 'Nova visão', ordem: 0, funcao: 'MENSAL', cenarios: versaoId ? [versaoId] : [], filtros: {}, _synthetic: true })}
        >
          <Plus size={13} /> Visão
        </button>
      </div>

      {/* ── Grid ── */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            {twoRow ? (
              <>
                <tr>
                  <th style={{ ...S.th, ...S.thDesc }} rowSpan={2}>Descrição</th>
                  {groups.map((g, i) => (
                    <th key={i} colSpan={g.span} style={{ ...S.th, textAlign: 'center', color: '#495057' }}>{g.label}</th>
                  ))}
                  <th style={{ ...S.th, width: 32 }} rowSpan={2} />
                </tr>
                <tr>
                  {columns.map(c => (
                    <th key={c.key} style={{ ...S.th, top: 28, color: c.kind === 'delta' ? '#868e96' : '#6c757d' }}>{c.label}</th>
                  ))}
                </tr>
              </>
            ) : (
              <tr>
                <th style={{ ...S.th, ...S.thDesc }}>Descrição</th>
                {columns.map(c => (
                  <th key={c.key} style={{ ...S.th, color: c.period === 'TOTAL' ? '#1971c2' : '#6c757d' }}>{c.label}</th>
                ))}
                <th style={{ ...S.th, width: 32 }} />
              </tr>
            )}
          </thead>

          <tbody>
            {visivel.map(l => {
              const depth   = l._depth ?? 0
              const isAgg   = l.tipo_linha === 'SOMAR_FILHOS'
              const isSpac  = l.tipo_linha === 'ESPACO'
              const isInd   = l.tipo_linha === 'INDICADOR'
              const isForm  = l.tipo_linha === 'FORMULA'
              const editable = l.tipo_linha === 'ANALITICA'
              const hasKids = temFilhos(l.id)
              const isOpen  = !collapsed.has(l.id)
              const rowBg   = isAgg ? '#f0f4ff' : isSpac ? '#fbfbfc' : 'white'
              const fw      = l.negrito || isAgg ? 600 : 400
              const baseClr = isAgg ? '#1971c2' : isInd ? '#0c8599' : isForm ? '#6741d9' : isSpac ? '#ccc' : '#212529'
              const clr     = l.italico ? baseClr : baseClr
              const TipoIcon = TIPO_INFO[l.tipo_linha].icon

              return (
                <tr key={l.id} style={{ background: rowBg }}>
                  {/* Descrição (sticky) */}
                  <td style={{ ...S.tdDesc, background: rowBg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: depth * 18 }}>
                      <button style={{ ...S.iconBtn, width: 18, flexShrink: 0 }} onClick={() => hasKids && toggle(l.id)}>
                        {hasKids ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
                      </button>
                      <TipoIcon size={12} style={{ color: TIPO_INFO[l.tipo_linha].cor, flexShrink: 0, opacity: 0.7 }} />
                      <span style={{
                        fontWeight: fw, color: clr, fontStyle: l.italico ? 'italic' : 'normal',
                        fontSize: 13, paddingLeft: 4, cursor: 'pointer',
                      }} onClick={() => setLinhaModal(l)} title="Editar linha">
                        {l.descricao || <em style={{ color: '#ccc' }}>sem nome</em>}
                      </span>
                      <button style={{ ...S.iconBtn, color: '#a5d8ff', flexShrink: 0 }} title="Adicionar linha filha"
                        onClick={() => { setAdding({ paiId: l.id }); setNewDesc('') }}>
                        <Plus size={11} />
                      </button>
                    </div>
                  </td>

                  {/* Células */}
                  {columns.map(c => {
                    if (c.kind === 'delta') {
                      const base = cellVal(view.cenarios[0], l.id, c.period)
                      const comp = cellVal(view.cenarios[1], l.id, c.period)
                      const d = base !== 0 ? (comp - base) / Math.abs(base) : NaN
                      const dColor = !isFinite(d) ? '#ced4da' : d >= 0 ? '#2f9e44' : '#e03131'
                      return (
                        <td key={c.key} style={{ ...S.td, color: dColor, fontSize: 12, fontWeight: 500 }}>
                          {isSpac ? '' : (isFinite(d) ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%` : '—')}
                        </td>
                      )
                    }
                    const cen = c.cenarioKey!
                    const val = cellVal(cen, l.id, c.period)
                    const canEditHere = editable && cen === versaoId && typeof c.period === 'number' && empresaId && versaoId
                    const isEditing = editCell?.linhaId === l.id && editCell?.mes === c.period
                    const display = isSpac ? '' : isInd ? fmtPct(val) : (val !== 0 ? fmt(val) : (canEditHere ? <span style={{ color: '#e9ecef' }}>—</span> : ''))

                    return (
                      <td key={c.key}
                        style={{ ...S.td, color: clr, fontWeight: fw, cursor: canEditHere ? 'text' : 'default', background: cen !== versaoId && !isSpac ? '#fcfcfd' : undefined }}
                        onClick={() => {
                          if (!canEditHere) return
                          setEditCell({ linhaId: l.id, mes: c.period as number })
                          setEditVal(val ? fmt(val) : '')
                        }}
                      >
                        {isEditing ? (
                          <input style={S.cellInput} autoFocus value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={() => saveCell(l.id, c.period as number)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveCell(l.id, c.period as number)
                              if (e.key === 'Escape') setEditCell(null)
                            }}
                          />
                        ) : (
                          <span style={{ display: 'block', minWidth: 54 }}>{display}</span>
                        )}
                      </td>
                    )
                  })}

                  {/* Excluir */}
                  <td style={S.td}>
                    <button style={{ ...S.iconBtn, color: '#ffa8a8' }} title="Excluir linha" onClick={() => deleteLinha(l.id)}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              )
            })}

            {/* Adicionar linha */}
            {adding ? (
              <tr>
                <td colSpan={columns.length + 2} style={{ padding: '8px 12px', background: '#f8fff8', borderBottom: '1px solid #d3f9d8' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: adding.paiId ? 40 : 0 }}>
                    {adding.paiId && <span style={{ fontSize: 12, color: '#2f9e44', fontWeight: 600 }}>↳ filho</span>}
                    <input style={S.newInput} placeholder="Descrição da linha..." autoFocus value={newDesc}
                      onChange={e => setNewDesc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addLinha(); if (e.key === 'Escape') { setAdding(null); setNewDesc('') } }}
                    />
                    <button style={S.btnGreen} onClick={addLinha}>Adicionar</button>
                    <button style={S.btnGray} onClick={() => { setAdding(null); setNewDesc('') }}>Cancelar</button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={columns.length + 2} style={{ padding: '8px 12px' }}>
                  <button style={S.addRow} onClick={() => { setAdding({ paiId: null }); setNewDesc('') }}>
                    <Plus size={13} /> Adicionar linha
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!empresaId && (
        <div style={{ position: 'fixed', bottom: 16, right: 16, background: '#fff3bf', border: '1px solid #ffd43b', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#856404' }}>
          Selecione uma empresa para editar os valores
        </div>
      )}

      {/* ── Modal de linha ── */}
      {linhaModal && <LinhaModal linha={linhaModal} onClose={() => setLinhaModal(null)} onSave={saveLinha} />}

      {/* ── Modal de view ── */}
      {viewModal && (
        <ViewModal
          view={viewModal} versoes={versoes}
          onClose={() => setViewModal(null)} onSave={saveView}
        />
      )}
    </div>
  )
}

// ─── Modal: editar linha ─────────────────────────────────────
function LinhaModal({ linha, onClose, onSave }: { linha: Linha; onClose: () => void; onSave: (l: Linha) => void }) {
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
              <option value="RECEITA">Receita</option>
              <option value="DESPESA">Despesa</option>
              <option value="NEUTRO">Neutro</option>
            </select>
          </div>
        </div>

        <div style={S.field}>
          <label style={S.label}>Tipo de linha</label>
          <select style={S.input} value={l.tipo_linha} onChange={e => setL({ ...l, tipo_linha: e.target.value as TipoLinha })}>
            {(Object.keys(TIPO_INFO) as TipoLinha[]).map(t => (
              <option key={t} value={t}>{TIPO_INFO[t].label}</option>
            ))}
          </select>
        </div>

        {isFormula && (
          <div style={S.field}>
            <label style={S.label}>Expressão</label>
            <input style={{ ...S.input, fontFamily: 'monospace' }} placeholder="=[REC]-[CMV]" value={l.expressao ?? ''}
              onChange={e => setL({ ...l, expressao: e.target.value })} />
            <div style={S.help}>
              Refs por código entre colchetes. Ex.: <code>=[REC]-[CMV]</code> · <code>=[LUCRO]/[REC]</code> (indicador) ·
              {' '}<code>=ANTERIOR()*1.05</code> (mês anterior desta linha) · <code>=ANTERIOR([REC])</code> · <code>=ANTERIOR([REC],12)</code>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 20 }}>
          <label style={S.chk}>
            <input type="checkbox" checked={l.negrito} onChange={e => setL({ ...l, negrito: e.target.checked })} /> Negrito
          </label>
          <label style={S.chk}>
            <input type="checkbox" checked={l.italico} onChange={e => setL({ ...l, italico: e.target.checked })} /> Itálico
          </label>
        </div>

        <div style={S.mFooter}>
          <button style={S.btnSec} onClick={onClose}>Cancelar</button>
          <button style={S.btnPri} onClick={() => onSave(l)}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: configurar view ──────────────────────────────────
function ViewModal({ view, versoes, onClose, onSave }: {
  view: ViewConfig; versoes: Versao[]; onClose: () => void; onSave: (v: ViewConfig) => void
}) {
  const [v, setV] = useState<ViewConfig>(view)
  const toggleCen = (key: string) => setV(p => ({
    ...p, cenarios: p.cenarios.includes(key) ? p.cenarios.filter(c => c !== key) : [...p.cenarios, key],
  }))

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.mTitle}>{view._synthetic ? 'Nova visão' : 'Editar visão'} <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} /></div>

        <div style={S.field}>
          <label style={S.label}>Nome</label>
          <input style={S.input} value={v.nome} onChange={e => setV({ ...v, nome: e.target.value })} />
        </div>

        <div style={S.field}>
          <label style={S.label}>Função (organização das colunas)</label>
          <select style={S.input} value={v.funcao} onChange={e => setV({ ...v, funcao: e.target.value as Funcao })}>
            {(Object.keys(FUNCAO_LABEL) as Funcao[]).map(f => <option key={f} value={f}>{FUNCAO_LABEL[f]}</option>)}
          </select>
          <div style={S.help}>
            Mensal: Jan…Dez + Total · Acumulado: só o total do ano · Acum.+Mensal: total + meses ·
            Comparativo: cenários lado a lado com Δ% (ex.: Orçado × Realizado).
          </div>
        </div>

        <div style={S.field}>
          <label style={S.label}>Cenários exibidos</label>
          {versoes.map(ver => (
            <label key={ver.id} style={S.chk}>
              <input type="checkbox" checked={v.cenarios.includes(ver.id)} onChange={() => toggleCen(ver.id)} /> {ver.codigo}
            </label>
          ))}
          <label style={S.chk}>
            <input type="checkbox" checked={v.cenarios.includes(REALIZADO)} onChange={() => toggleCen(REALIZADO)} /> Realizado
          </label>
          {v.funcao !== 'COMPARATIVO' && v.cenarios.length > 1 && (
            <div style={S.help}>Nesta função, apenas o 1º cenário marcado é exibido. Use "Comparativo" para ver vários lado a lado.</div>
          )}
        </div>

        <div style={S.mFooter}>
          <button style={S.btnSec} onClick={onClose}>Cancelar</button>
          <button style={S.btnPri} onClick={() => onSave(v)}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
