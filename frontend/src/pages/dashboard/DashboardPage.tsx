import { useEffect, useState, useRef, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { computeCenario, computeTotais, pkey, formatValor } from '../../lib/engine'
import type { LinhaCalc, Computed, Periodo, RawValues } from '../../lib/engine'
import { totaisRelatorio } from '../../lib/relatorioTotais'
import type { RLData } from '../../lib/relatorioTotais'
import { ResponsiveBar } from '@nivo/bar'
import { ResponsiveLine } from '@nivo/line'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, RefreshCw, ArrowLeft } from 'lucide-react'
import DrillModal from './DrillModal'
import { effectiveCcFilter, FiltrosButton, PeriodoButton, SalvarCardButton, useCardPreset, ModalPanel, Checklist } from './DashFiltros'
import { ListChecks } from 'lucide-react'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ANOS = [2024, 2025, 2026, 2027, 2028]
const YCOLORS = ['#3b5bdb', '#f59f00', '#2f9e44', '#e8590c', '#7048e8', '#1098ad']
const CAT = ['#3b5bdb', '#f59f00', '#2f9e44', '#e8590c', '#7048e8', '#1098ad', '#e64980', '#0ca678', '#f76707', '#4263eb']
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const fmtK = (v: number) => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k' : String(Math.round(v))
const pctOf = (real: number, orc: number) => orc === 0 ? null : (real / orc) * 100
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tipBox: CSSProperties = { background: 'white', padding: '8px 10px', border: '1px solid #e9ecef', borderRadius: 6, fontSize: 12, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }
// tooltip de Orçado × Realizado com Δ (R−O) e separador de milhar
function TipOR({ titulo, data, hint }: { titulo: string; data: any; hint?: string }) {
  const o = Number(data['Orçado'] || 0), r = Number(data['Realizado'] || 0), d = r - o
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{titulo}</div>
      <div><span style={{ color: '#868e96' }}>Orçado:</span> {fmt(o)}</div>
      <div><span style={{ color: '#868e96' }}>Realizado:</span> {fmt(r)}</div>
      <div style={{ color: d >= 0 ? '#2f9e44' : '#e03131', fontWeight: 600 }}>Δ (R−O): {fmt(d)}</div>
      {hint && <div style={{ color: '#adb5bd', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type Item = { id: string; codigo: string; descricao: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null; visivel_dashboard?: boolean; nao_soma?: boolean; filtro_escopo?: any; formato?: any; casas_decimais?: number }

const S: Record<string, CSSProperties> = {
  page:   { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title:  { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:    { fontSize: 13, color: '#868e96', margin: '4px 0 16px' },
  bar:    { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  sel:    { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  btn:    { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  chip:   { fontSize: 12, color: '#868e96', marginBottom: 16 },
  kpis:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 16 },
  kpi:    { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 16 },
  kpiLbl: { fontSize: 12, color: '#868e96', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiVal: { fontSize: 24, fontWeight: 700, color: '#212529', margin: '6px 0 2px' },
  kpiSub: { fontSize: 12, color: '#868e96' },
  grid2:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 },
  card:   { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardT:  { fontSize: 14, fontWeight: 600, color: '#212529', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  chart:  { height: 320 },
  empty:  { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: '#aaa', fontSize: 14 },
  label:  { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 6 },
  input:  { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ced4da', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  pop:    { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1500, background: 'white', border: '1px solid #e9ecef', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', padding: 16, width: 'min(860px, calc(100vw - 40px))', maxHeight: '85vh', overflowY: 'auto', overflowX: 'hidden' },
  miniSeg:{ padding: '3px 10px', fontSize: 12, border: '1px solid #dee2e6', cursor: 'pointer', background: 'white', color: '#495057' },
}
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#495057' }


function AnoMesGrid({ anosSel, mesesSel, setAnosSel, setMesesSel }: {
  anosSel: number[]; mesesSel: number[]; setAnosSel: (v: number[]) => void; setMesesSel: (v: number[]) => void
}) {
  const toggleAno = (y: number) => setAnosSel(anosSel.includes(y) ? anosSel.filter(x => x !== y) : [...anosSel, y].sort((a, b) => a - b))
  const toggleMes = (m: number) => setMesesSel(mesesSel.includes(m) ? mesesSel.filter(x => x !== m) : [...mesesSel, m].sort((a, b) => a - b))
  return (
    <div>
      <div style={{ border: '1px solid #e9ecef', borderRadius: 8, padding: 8, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(12, minmax(20px, 1fr))`, gap: 2, minWidth: 400 }}>
          <div />
          {MESES.map((m, i) => (
            <div key={i} onClick={() => toggleMes(i + 1)} title={`marcar ${m}`}
              style={{ fontSize: 10, textAlign: 'center', padding: '2px 0', cursor: 'pointer', fontWeight: mesesSel.includes(i + 1) ? 700 : 400, color: mesesSel.includes(i + 1) ? '#3b5bdb' : '#adb5bd' }}>{m}</div>
          ))}
          {ANOS.map(y => (
            <Fragment key={y}>
              <div onClick={() => toggleAno(y)} title="marcar o ano"
                style={{ fontSize: 12, fontWeight: anosSel.includes(y) ? 700 : 500, color: anosSel.includes(y) ? '#3b5bdb' : '#868e96', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>{y}</div>
              {MESES.map((_, i) => {
                const on = anosSel.includes(y) && mesesSel.includes(i + 1)
                const half = anosSel.includes(y) !== mesesSel.includes(i + 1)
                return <div key={i} onClick={() => { if (!anosSel.includes(y)) toggleAno(y); if (!mesesSel.includes(i + 1)) toggleMes(i + 1) }}
                  style={{ height: 22, borderRadius: 4, cursor: 'pointer', background: on ? '#3b5bdb' : '#f8f9fa', border: '1px solid ' + (on ? '#3b5bdb' : '#eef0f2'), opacity: half ? 0.45 : 1 }} />
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button style={miniBtn} onClick={() => setMesesSel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])}>Todos meses</button>
        <button style={miniBtn} onClick={() => setAnosSel([...ANOS])}>Todos anos</button>
        <button style={miniBtn} onClick={() => { setAnosSel([2026]); setMesesSel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }}>Reset</button>
      </div>
    </div>
  )
}

function Gauge({ label, pct }: { label: string; pct: number | null }) {
  const cx = 90, cy = 92, r = 70
  const f = pct == null ? 0 : Math.max(0, Math.min(pct, 150)) / 150
  const pt = (deg: number) => [cx + r * Math.cos(deg * Math.PI / 180), cy - r * Math.sin(deg * Math.PI / 180)]
  const av = 180 - f * 180
  const [tx0, ty0] = pt(180), [tx1, ty1] = pt(0), [vx, vy] = pt(av)
  const cor = pct == null ? '#ced4da' : pct >= 100 ? '#2f9e44' : pct >= 80 ? '#f59f00' : '#e03131'
  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 180 110" width="100%" style={{ maxWidth: 220 }}>
        <path d={`M ${tx0} ${ty0} A ${r} ${r} 0 0 1 ${tx1} ${ty1}`} fill="none" stroke="#edf0f2" strokeWidth={14} strokeLinecap="round" />
        <path d={`M ${tx0} ${ty0} A ${r} ${r} 0 0 1 ${vx} ${vy}`} fill="none" stroke={cor} strokeWidth={14} strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={26} fontWeight={700} fill="#212529">{pct == null ? '—' : Math.round(pct) + '%'}</text>
      </svg>
      <div style={{ fontSize: 12, color: '#868e96', fontWeight: 500, marginTop: -6 }}>{label}</div>
    </div>
  )
}

type IC = { id: string; label: string; isPct: boolean; desp: boolean; casas: number; formato: any; R: number; O: number; P: number }
function IndicCard({ c, anoPrev }: { c: IC; anoPrev: number }) {
  const f = (v: number) => formatValor(v, c.formato, c.casas)
  const d = c.R - c.O
  const exec = (!c.isPct && c.O !== 0) ? (c.R / c.O) * 100 : null
  const bomExec = exec == null ? true : c.desp ? exec <= 100 : exec >= 100
  const yoyPct = (!c.isPct && c.P !== 0) ? (c.R / c.P - 1) * 100 : null
  const bomY = c.desp ? c.R <= c.P : c.R >= c.P
  const Arrow = (bom: boolean) => bom ? <TrendingUp size={13} /> : <TrendingDown size={13} />
  const ksub: CSSProperties = { fontSize: 12, color: '#868e96', display: 'flex', alignItems: 'center', gap: 6 }
  return (
    <div style={{ background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#868e96', fontWeight: 500 }}>{c.label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#212529', margin: '6px 0 4px' }}>{f(c.R)}</div>
      <div style={ksub}>Orçado {f(c.O)} · {c.isPct
        ? <span style={{ color: bomY ? '#2f9e44' : '#e03131' }}>{d >= 0 ? '+' : ''}{formatValor(d, 'NUMERO', c.casas)} pp</span>
        : (exec == null ? '—' : <span style={{ color: bomExec ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{Arrow(bomExec)}{exec.toFixed(0)}%</span>)}</div>
      <div style={{ ...ksub, marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f3f5' }}>
        <strong style={{ color: '#495057' }}>{anoPrev}</strong> {f(c.P)} · {c.isPct
          ? <span style={{ color: bomY ? '#2f9e44' : '#e03131' }}>{(c.R - c.P) >= 0 ? '+' : ''}{formatValor(c.R - c.P, 'NUMERO', c.casas)} pp</span>
          : (yoyPct == null ? '—' : <span style={{ color: bomY ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{Arrow(bomY)}{yoyPct >= 0 ? '+' : ''}{yoyPct.toFixed(0)}%</span>)}
      </div>
    </div>
  )
}

const SAVE = 'planorc_dash_filtro'
function loadSaved(): any { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function DashboardPage() {
  const [rels, setRels] = useState<Rel[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([])
  const [filiais, setFiliais] = useState<Item[]>([])
  const [ccs, setCcs] = useState<Item[]>([])
  const sv = loadSaved()
  const [relId, setRelId] = useState('')
  const [versaoId, setVersaoId] = useState('')
  const [agrupId, setAgrupId] = useState<string>(sv.agrupId || '')
  const [agrupOpts, setAgrupOpts] = useState<{ id: string; label: string }[]>([])
  const [anosSel, setAnosSel] = useState<number[]>(Array.isArray(sv.anosSel) && sv.anosSel.length ? sv.anosSel : [2026])
  const [mesesSel, setMesesSel] = useState<number[]>(Array.isArray(sv.mesesSel) && sv.mesesSel.length ? sv.mesesSel : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [areaSel, setAreaSel] = useState<string[]>(Array.isArray(sv.areaSel) ? sv.areaSel : [])
  const [divisaoSel, setDivisaoSel] = useState<string[]>(Array.isArray(sv.divisaoSel) ? sv.divisaoSel : [])
  const [buSel, setBuSel] = useState<string[]>(Array.isArray(sv.buSel) ? sv.buSel : [])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const loadSeq = useRef(0)

  // Meus Cards: aplica preset quando ?card=<id> bate com este dashboard
  const { cardId, nome: cardNome } = useCardPreset('/dashboard', (f) => {
    if (f.relId !== undefined) setRelId(f.relId); if (f.versaoId !== undefined) setVersaoId(f.versaoId); if (f.agrupId !== undefined) setAgrupId(f.agrupId)
    if (Array.isArray(f.anosSel)) setAnosSel(f.anosSel); if (Array.isArray(f.mesesSel)) setMesesSel(f.mesesSel)
    if (Array.isArray(f.empresaSel)) setEmpresaSel(f.empresaSel); if (Array.isArray(f.filialSel)) setFilialSel(f.filialSel); if (Array.isArray(f.ccSel)) setCcSel(f.ccSel)
    if (Array.isArray(f.areaSel)) setAreaSel(f.areaSel); if (Array.isArray(f.divisaoSel)) setDivisaoSel(f.divisaoSel); if (Array.isArray(f.buSel)) setBuSel(f.buSel)
    if (Array.isArray(f.indicSel)) setIndicSel(f.indicSel)
  })

  const [escopoNome, setEscopoNome] = useState('Relatório inteiro')
  const [kpi, setKpi] = useState({ resOrc: 0, resReal: 0, recOrc: 0, recReal: 0, despOrc: 0, despReal: 0 })
  const [orcRealMes, setOrcRealMes] = useState<any[]>([])
  const [accLines, setAccLines] = useState<any[]>([])
  const [composicao, setComposicao] = useState<any[]>([])
  const [compOcultas, setCompOcultas] = useState(0)
  const [indicCards, setIndicCards] = useState<{ id: string; label: string; isPct: boolean; desp: boolean; casas: number; formato: any; R: number; O: number; P: number }[]>([])
  const [indicSel, setIndicSel] = useState<string[]>(Array.isArray(sv.indicSel) ? sv.indicSel : [])   // quais indicadores exibir (vazio = todos)
  const [pickIndic, setPickIndic] = useState(false)
  const [filhasMes, setFilhasMes] = useState<any[]>([])
  const [cascata, setCascata] = useState<any[]>([])
  const [porEmpresa, setPorEmpresa] = useState<any[]>([])
  const [ebitdaEmp, setEbitdaEmp] = useState<any[]>([])
  const [desvios, setDesvios] = useState<any[]>([])
  const [temDados, setTemDados] = useState(false)
  const [drill, setDrill] = useState<{ nodeId: string; meses?: number[] } | null>(null)
  const [qparams, setQparams] = useState<{ empIds: string[]; anos: number[]; meses: number[]; filFilter: string[] | null; ccFilter: string[] | null } | null>(null)

  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('nome').then(r => { setRels(r.data || []); if (r.data?.length) setRelId(p => p || sv.relId || r.data![0].id) })
    supabase.from('versao_orcamento').select('id,codigo').order('codigo').then(r => { setVersoes(r.data || []); if (r.data?.length) setVersaoId(p => p || sv.versaoId || r.data![0].id) })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').order('codigo').then(r => setCcs(r.data || []))
  }, []) // eslint-disable-line

  useEffect(() => { if (cardId) return; localStorage.setItem(SAVE, JSON.stringify({ relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel })) }, [cardId, relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel])

  const load = async () => {
    if (!relId || !versaoId || !anosSel.length || !mesesSel.length) return
    const myseq = ++loadSeq.current   // descarta resultados de cargas antigas (ex.: preset aplica filtro e dispara 2ª carga)
    setLoading(true); setErro(null)
    try {
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao,ordem,visivel_dashboard,nao_soma,filtro_escopo,formato,casas_decimais').eq('relatorio_id', relId)
      const linhas = (linhasRaw || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const childrenByPai: Record<string, RL[]> = {}
      linhas.forEach(l => { const k = l.pai_id || '__root'; (childrenByPai[k] = childrenByPai[k] || []).push(l) })
      Object.values(childrenByPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
      // sequência de exibição = ordem da árvore do relatório (DFS), p/ ordenar os cards de indicadores
      const seqOrd: Record<string, number> = {}; let _si = 0
      const dfsSeq = (k: string) => { for (const c of (childrenByPai[k] || [])) { seqOrd[c.id] = _si++; dfsSeq(c.id) } }
      dfsSeq('__root')
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const descByMaster: Record<string, string> = {}, rlOfMaster: Record<string, string> = {}
      linhas.forEach(l => { if (l.linha_orc_id) { descByMaster[l.linha_orc_id] = l.descricao; rlOfMaster[l.linha_orc_id] = l.id } })
      // masters de linhas DESATIVADAS — excluídos das somatórias (como no relatório)
      const disabledMasters = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabledMasters.add(l.linha_orc_id) })
      // natureza vem do dado (relatorio_linha/conta_orcamentaria); folha sem natureza herda do ANCESTRAL
      const natCache: Record<string, string | null> = {}
      const natOfLine = (id: string | null): string | null => {
        if (!id) return null
        if (id in natCache) return natCache[id]
        const l = byId[id]; if (!l) return null
        const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOfLine(l.pai_id)
        natCache[id] = n; return n
      }
      const natByMaster: Record<string, string> = {}
      masterIds.forEach(m => { const n = natOfLine(rlOfMaster[m]); if (n) natByMaster[m] = n })

      // opções de linha agrupadora (apenas nós com filhas), indentadas
      const opts: { id: string; label: string }[] = []
      const walk = (paiKey: string, depth: number) => {
        for (const c of (childrenByPai[paiKey] || [])) {
          if ((childrenByPai[c.id] || []).length) { opts.push({ id: c.id, label: ' '.repeat(depth * 3) + c.descricao }); walk(c.id, depth + 1) }
        }
      }
      walk('__root', 0)
      setAgrupOpts(opts)
      const agrup = agrupId && byId[agrupId] ? agrupId : ''
      if (agrupId && !byId[agrupId]) setAgrupId('')
      setEscopoNome(agrup ? byId[agrup].descricao : 'Relatório inteiro')

      // subárvore de masters de um nó (inclui o próprio e descendentes)
      const subMasters = (nodeId: string): string[] => { const acc: string[] = [], st = [nodeId]; while (st.length) { const n = st.pop()!; if (byId[n]?.linha_orc_id) acc.push(byId[n].linha_orc_id!); (childrenByPai[n] || []).forEach(c => st.push(c.id)) } return acc }
      const scopedMasters = agrup ? subMasters(agrup) : masterIds
      const scopedSet = new Set(scopedMasters)
      // filhas diretas do nó (ou raiz) e a qual filha cada master pertence
      // visivel_dashboard=false some do display, mas continua no cálculo (totais/EBITDA via leaves+engine)
      const allChildren = (childrenByPai[agrup || '__root'] || []).filter(c => c.tipo_linha !== 'ESPACO' && !c.nao_soma)
      const nodeChildren = allChildren.filter(c => c.visivel_dashboard !== false)
      const childrenOcultas = allChildren.length - nodeChildren.length
      const masterToChild: Record<string, string> = {}, childDesc: Record<string, string> = {}
      nodeChildren.forEach(c => { childDesc[c.id] = c.descricao; subMasters(c.id).forEach(m => { masterToChild[m] = c.id }) })

      const allEmp = empresas.map(e => e.id)
      const empIds = empresaSel.length ? empresaSel : allEmp
      const empSet = new Set(empIds)
      const filFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
      const ccFilter = effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel)
      if (!scopedMasters.length || !empIds.length) { setTemDados(false); setLoading(false); return }
      const anos = [...anosSel].sort((a, b) => a - b), meses = [...mesesSel].sort((a, b) => a - b)
      setQparams({ empIds, anos, meses, filFilter, ccFilter })

      // cards dinâmicos: linhas de apoio/indicador do relatório (respeita visivel_dashboard) — usa o helper p/ escopo de CC
      const indicLines = linhas.filter(l => (l.tipo_linha === 'INDICADOR' || l.nao_soma) && l.visivel_dashboard !== false)
        .sort((a, b) => (seqOrd[a.id] ?? 9999) - (seqOrd[b.id] ?? 9999))
      if (indicLines.length) {
        const baseI = { linhas: linhas as RLData[], ccs: ccs as any, empresas: empIds, meses, filialFilter: filFilter, ccFilter }
        const [iOrc, iReal, iPrev] = await Promise.all([
          totaisRelatorio({ ...baseI, cen: versaoId, anos }),
          totaisRelatorio({ ...baseI, cen: 'REALIZADO', anos }),
          totaisRelatorio({ ...baseI, cen: 'REALIZADO', anos: anos.map(a => a - 1) }),
        ])
        if (myseq !== loadSeq.current) return   // carga mais nova já começou → não sobrescreve com dados antigos
        const byIdI: Record<string, RL> = {}; linhas.forEach(l => { byIdI[l.id] = l })
        const natOfI = (id: string | null): string | null => { if (!id) return null; const l = byIdI[id]; if (!l) return null; return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOfI(l.pai_id) }
        setIndicCards(indicLines.map(l => { const f = natOfI(l.id) === 'DESPESA' ? -1 : 1; return { id: l.id, label: l.descricao, isPct: l.formato === 'PERCENTUAL', desp: natOfI(l.id) === 'DESPESA', casas: l.casas_decimais ?? (l.formato === 'PERCENTUAL' ? 1 : 0), formato: l.formato, R: f * (iReal[l.id] || 0), O: f * (iOrc[l.id] || 0), P: f * (iPrev[l.id] || 0) } }))
      } else if (myseq === loadSeq.current) setIndicCards([])

      // orçado/realizado ESCOPADOS ao nó; lineEmp FULL (p/ EBITDA = fórmula do relatório inteiro)
      const ebNode = linhas.find(l => (l.descricao || '').toLowerCase().includes('ebitda'))
      const linhasCalc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
      const [orcR, realR, lineEmpR] = await Promise.all([
        supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_linha_empresa_agg', { p_versao: versaoId, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
      ])
      if (orcR.error) throw new Error(orcR.error.message)
      if (realR.error) throw new Error(realR.error.message)
      if (lineEmpR.error) throw new Error(lineEmpR.error.message)

      // ── período como lista e avaliação via ENGINE (orçado avalia fórmula de célula, igual ao relatório) ──
      const periodos: Periodo[] = []
      for (const y of anos) for (const m of meses) periodos.push({ ano: y, mes: m })
      periodos.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
      const rawOrc: RawValues = {}, rawReal: RawValues = {}
      for (const r of orcR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawOrc[rl] = rawOrc[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: r.expr ?? null } }
      for (const r of realR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawReal[rl] = rawReal[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const cOrc = computeCenario(linhasCalc, rawOrc, periodos), cReal = computeCenario(linhasCalc, rawReal, periodos)
      const tOrc = computeTotais(linhasCalc, cOrc, periodos), tReal = computeTotais(linhasCalc, cReal, periodos)
      const leaves = linhas.filter(l => l.tipo_linha === 'ANALITICA' && !l.desativada && l.linha_orc_id && !l.nao_soma)

      // agregações ESCOPADAS (por mês/ano, por master, por filha) a partir da engine
      const omYM: Record<number, Record<number, number>> = {}, rmYM: Record<number, Record<number, number>> = {}
      const omM: Record<number, number> = {}, rmM: Record<number, number> = {}
      const orcByMaster: Record<string, number> = {}, realByMaster: Record<string, number> = {}
      const childMonthReal: Record<string, Record<number, number>> = {}
      const childOrc: Record<string, number> = {}, childReal: Record<string, number> = {}
      for (const l of leaves) {
        const m = l.linha_orc_id!; if (!scopedSet.has(m)) continue
        orcByMaster[m] = tOrc[l.id] || 0; realByMaster[m] = tReal[l.id] || 0
        const ch = masterToChild[m]
        if (ch) { childOrc[ch] = (childOrc[ch] || 0) + (tOrc[l.id] || 0); childReal[ch] = (childReal[ch] || 0) + (tReal[l.id] || 0) }
        for (const p of periodos) {
          const k = pkey(p), ov = cOrc[l.id]?.[k] || 0, rv = cReal[l.id]?.[k] || 0
          ;(omYM[p.ano] = omYM[p.ano] || {})[p.mes] = (omYM[p.ano]?.[p.mes] || 0) + ov
          ;(rmYM[p.ano] = rmYM[p.ano] || {})[p.mes] = (rmYM[p.ano]?.[p.mes] || 0) + rv
          omM[p.mes] = (omM[p.mes] || 0) + ov; rmM[p.mes] = (rmM[p.mes] || 0) + rv
          if (ch) (childMonthReal[ch] = childMonthReal[ch] || {})[p.mes] = (childMonthReal[ch]?.[p.mes] || 0) + rv
        }
      }

      // EXIBIÇÃO: despesa mostrada positiva (dado continua com sinal p/ cálculo). Fator pela natureza.
      const natFac = (n: string) => n === 'DESPESA' ? -1 : 1
      const nodeFac = agrup ? natFac(natOfLine(agrup) || '') : 1
      const childNat: Record<string, string> = {}; nodeChildren.forEach(c => { childNat[c.id] = natOfLine(c.id) || '' })

      const orMes = meses.map(m => ({ mes: MESES[m - 1], mesN: m, Orçado: Math.round(nodeFac * (omM[m] || 0)), Realizado: Math.round(nodeFac * (rmM[m] || 0)) }))
      const acc = anos.map(y => { let a = 0; return { id: String(y), data: meses.map(m => { a += rmYM[y]?.[m] || 0; return { x: MESES[m - 1], y: Math.round(nodeFac * a) } }) } })

      const comps = nodeChildren.filter(c => (childOrc[c.id] || childReal[c.id])).map(c => { const f = natFac(childNat[c.id]); return { id: c.id, filha: cut(childDesc[c.id], 26), Orçado: Math.round(f * (childOrc[c.id] || 0)), Realizado: Math.round(f * (childReal[c.id] || 0)) } })
        // ordena por magnitude (Realizado, fallback Orçado): ascendente p/ o gráfico horizontal exibir o maior no topo
        .sort((a, b) => (Math.abs(a.Realizado || a.Orçado)) - (Math.abs(b.Realizado || b.Orçado)))
      let run = 0
      const steps: any[] = []
      for (const c of nodeChildren) { const d = childReal[c.id] || 0; if (!d && !(childOrc[c.id])) continue; steps.push({ step: cut(childDesc[c.id], 14), base: Math.round(Math.min(run, run + d)), total: 0, pos: d >= 0 ? Math.round(Math.abs(d)) : 0, neg: d < 0 ? Math.round(Math.abs(d)) : 0 }); run += d }
      steps.push({ step: 'Total', base: 0, total: Math.round(run), pos: 0, neg: 0 })
      const childByTotal = nodeChildren.filter(c => childReal[c.id]).sort((a, b) => Math.abs(childReal[b.id]) - Math.abs(childReal[a.id])).slice(0, 8)
      const fMes = childByTotal.map(c => { const f = natFac(childNat[c.id]); return { id: cut(childDesc[c.id], 18), data: meses.map(m => ({ x: MESES[m - 1], y: Math.round(f * (childMonthReal[c.id]?.[m] || 0)) })) } })

      // KPIs do TOPO = relatório INTEIRO (todas as linhas), via engine
      let recOF = 0, recRF = 0, despOF = 0, despRF = 0
      for (const l of leaves) { const nat = natByMaster[l.linha_orc_id!]; if (nat === 'RECEITA') { recOF += tOrc[l.id] || 0; recRF += tReal[l.id] || 0 } else if (nat === 'DESPESA') { despOF += tOrc[l.id] || 0; despRF += tReal[l.id] || 0 } }
      const resNode = linhas.find(l => norm(l.descricao).includes('resultado liquido'))
      const resOrcKpi = resNode ? (tOrc[resNode.id] || 0) : leaves.reduce((s, l) => s + (tOrc[l.id] || 0), 0)
      const resRealKpi = resNode ? (tReal[resNode.id] || 0) : leaves.reduce((s, l) => s + (tReal[l.id] || 0), 0)

      // por empresa (016) + EBITDA por empresa (engine por empresa)
      const empName: Record<string, string> = {}; empresas.forEach(e => { empName[e.id] = `${e.codigo} · ${cut(e.descricao, 22)}` })
      const totByEmp: Record<string, { o: number; r: number }> = {}
      const orcEM: Record<string, Record<string, number>> = {}, realEM: Record<string, Record<string, number>> = {}
      for (const x of lineEmpR.data || []) {
        if (!empSet.has(x.empresa_id) || disabledMasters.has(x.linha_id)) continue
        const e = x.empresa_id, m = x.linha_id, o = Number(x.orcado) || 0, r = Number(x.realizado) || 0
        ;(orcEM[e] = orcEM[e] || {})[m] = o; (realEM[e] = realEM[e] || {})[m] = r
        if (scopedSet.has(m)) { (totByEmp[e] = totByEmp[e] || { o: 0, r: 0 }).o += o; totByEmp[e].r += r }
      }
      // top 14 por Realizado; ascendente p/ o gráfico horizontal exibir o maior no topo
      const pe = Object.entries(totByEmp).map(([id, v]) => ({ empresa: empName[id] || '?', Orçado: Math.round(nodeFac * v.o), Realizado: Math.round(nodeFac * v.r) })).sort((a, b) => b.Realizado - a.Realizado).slice(0, 14).reverse()

      const SP: Periodo = { ano: 0, mes: 1 }; const EPK = pkey(SP)
      const evalTot = (lineId: string, valByMaster?: Record<string, number>) => {
        const computed: Computed = {}; linhasCalc.forEach(l => { computed[l.id] = {} })
        for (const mm of masterIds) { const rl = rlOfMaster[mm]; if (rl) computed[rl][EPK] = (valByMaster?.[mm]) || 0 }
        return computeTotais(linhasCalc, computed, [SP])[lineId] || 0
      }
      let eb: any[] = []
      if (ebNode) {
        eb = Object.keys(orcEM).filter(id => empSet.has(id)).map(id => ({ empresa: empName[id] || '?', Orçado: Math.round(evalTot(ebNode.id, orcEM[id])), Realizado: Math.round(evalTot(ebNode.id, realEM[id])) }))
          .filter(x => x.Orçado || x.Realizado).sort((a, b) => b.Realizado - a.Realizado).slice(0, 14).reverse()
      }

      const desv = scopedMasters.map(m => ({ m, conta: descByMaster[m] || '—', d: (realByMaster[m] || 0) - (orcByMaster[m] || 0) }))
        .filter(x => x.d).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 12).reverse().map(x => ({ conta: cut(x.conta, 26), Δ: Math.round(x.d), nodeId: rlOfMaster[x.m] }))

      if (myseq !== loadSeq.current) return   // carga mais nova já começou → descarta esta
      setKpi({ resOrc: resOrcKpi, resReal: resRealKpi, recOrc: recOF, recReal: recRF, despOrc: despOF, despReal: despRF })
      setOrcRealMes(orMes); setAccLines(acc); setComposicao(comps); setCompOcultas(childrenOcultas); setFilhasMes(fMes); setCascata(steps)
      setPorEmpresa(pe); setEbitdaEmp(eb); setDesvios(desv)
      setTemDados(Object.keys(omM).length > 0 || Object.keys(rmM).length > 0)
    } catch (e: any) { if (myseq === loadSeq.current) setErro(e?.message ?? String(e)) }
    if (myseq === loadSeq.current) setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, empresas, filiais, ccs]) // eslint-disable-line

  const anosOrd = [...anosSel].sort((a, b) => a - b)
  const yearKeys = anosOrd.map(String)
  const deltaMes = orcRealMes.map((m: any) => ({ mes: m.mes, 'Δ': Math.round((m.Realizado || 0) - (m.Orçado || 0)) }))
  const chip = `${escopoNome} · ${anosOrd.join(', ') || '—'} · ${mesesSel.length === 12 ? 'todos os meses' : mesesSel.length + ' meses'}`
    + ` · ${empresaSel.length ? empresaSel.length + ' empresa(s)' : 'todas as empresas'}`
    + (filialSel.length && filialSel.length < filiais.length ? ` · ${filialSel.length} filial` : '')
    + (ccSel.length && ccSel.length < ccs.length ? ` · ${ccSel.length} CC` : '')

  const KpiCard = ({ lbl, orc, real, desp }: { lbl: string; orc: number; real: number; desp?: boolean }) => {
    const p = pctOf(real, orc); const up = real >= orc
    const f = desp ? -1 : 1   // despesa exibida positiva (dado é negativo)
    const d = f * (real - orc)   // delta (Realizado − Orçado) na orientação exibida
    return (
      <div style={S.kpi}>
        <div style={S.kpiLbl}>{lbl}</div>
        <div style={{ ...S.kpiVal, color: desp ? '#e03131' : '#212529' }}>{fmt(f * real)}</div>
        <div style={S.kpiSub}>Orçado {fmt(f * orc)} <span style={{ color: up ? '#2f9e44' : '#e03131', fontWeight: 600 }}>({d >= 0 ? '+' : ''}{fmt(d)})</span> · {p == null ? '—' : <span style={{ color: up ? '#2f9e44' : '#e03131', fontWeight: 600 }}>{up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {p.toFixed(0)}%</span>}</div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>DRE — Acompanhamento{cardNome && <span style={{ color: '#3b5bdb' }}> · {cardNome}</span>}</h1>
      </div>
      <p style={S.sub}>Escopo: <strong>{escopoNome}</strong>. Execução orçado × realizado, por filha e por empresa.</p>

      <div style={S.bar}>
        <select style={S.sel} value={relId} onChange={e => { setRelId(e.target.value); setAgrupId('') }}>
          <option value="">— Relatório —</option>
          {rels.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <select style={{ ...S.sel, maxWidth: 260 }} value={agrupId} onChange={e => setAgrupId(e.target.value)} title="Linha agrupadora">
          <option value="">Relatório inteiro</option>
          {agrupOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
          <option value="">— Versão —</option>
          {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
        </select>
        <PeriodoButton resumo={`${anosOrd.join(', ') || '—'} · ${mesesSel.length === 12 ? 'todos meses' : mesesSel.length + ' meses'}`}>
          <label style={S.label}>Período — anos (vertical) × meses (horizontal)</label>
          <div style={{ overflowX: 'auto' }}>
            <AnoMesGrid anosSel={anosSel} mesesSel={mesesSel} setAnosSel={setAnosSel} setMesesSel={setMesesSel} />
          </div>
        </PeriodoButton>
        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs as any} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <SalvarCardButton base="/dashboard" cor="#3b5bdb" cardId={cardId} getFiltros={() => ({ relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel })} />
        {indicCards.length > 0 && <button style={S.btn} onClick={() => setPickIndic(true)} title="Escolher quais indicadores exibir"><ListChecks size={13} /> Indicadores{indicSel.length ? ` (${indicSel.length})` : ''}</button>}
        {loading && <span style={{ fontSize: 12, color: '#aaa' }}>Carregando…</span>}
      </div>
      {pickIndic && (
        <ModalPanel titulo="Indicadores a exibir" onClose={() => setPickIndic(false)} width="min(520px, calc(100vw - 40px))">
          <Checklist titulo="Indicadores" items={indicCards.map(c => ({ id: c.id, codigo: '', descricao: c.label }))} sel={indicSel} setSel={setIndicSel} />
          <div style={{ fontSize: 12, color: '#adb5bd', marginTop: 8 }}>Vazio = mostra todos. Use para esconder indicadores que não fazem sentido neste preset (ex.: EBITDA num recorte por CC).</div>
        </ModalPanel>
      )}
      <div style={S.chip}>{chip}</div>

      {erro && <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', color: '#c92a2a', fontSize: 13, marginBottom: 16 }}>⚠ {erro}</div>}

      {!temDados && !loading ? (
        <div style={S.empty}>Sem dados para os filtros selecionados.</div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 8 }}>Visão geral do relatório (não afetada pela linha agrupadora)</div>
          <div style={S.kpis}>
            <KpiCard lbl="Resultado" orc={kpi.resOrc} real={kpi.resReal} />
            <KpiCard lbl="Receita" orc={kpi.recOrc} real={kpi.recReal} />
            <KpiCard lbl="Despesa" orc={kpi.despOrc} real={kpi.despReal} desp />
          </div>

          <div style={{ ...S.card, display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16 }}>
            <Gauge label="Execução Resultado" pct={pctOf(kpi.resReal, kpi.resOrc)} />
            <Gauge label="Execução Receita" pct={pctOf(kpi.recReal, kpi.recOrc)} />
            <Gauge label="Execução Despesa" pct={pctOf(kpi.despReal, kpi.despOrc)} />
          </div>

          {(() => { const vis = indicCards.filter(c => indicSel.includes(c.id)); return vis.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '16px 0 8px' }}>Indicadores do relatório</div>
              <div style={S.kpis}>
                {vis.map(c => <IndicCard key={c.id} c={c} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} />)}
              </div>
            </>
          ) })()}

          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>Composição por filha — {escopoNome}
                {compOcultas > 0 && <span title="Há linhas marcadas como não visíveis no dashboard. Elas continuam no cálculo, por isso as filhas podem não somar o total." style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#7048e8', border: '1px solid #d0bfff', borderRadius: 4, padding: '1px 6px' }}>+{compOcultas} oculta{compOcultas > 1 ? 's' : ''}</span>}
              </div>
              {composicao.length ? (
                <div style={{ height: Math.max(220, composicao.length * 34 + 50) }}>
                  <ResponsiveBar data={composicao} keys={['Orçado', 'Realizado']} indexBy="filha" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 160 }} padding={0.25} innerPadding={2}
                    colors={['#adb5bd', '#3b5bdb']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }}
                    enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate onClick={(d: any) => d.data.id && qparams && setDrill({ nodeId: d.data.id })}
                    tooltip={({ data }: any) => <TipOR titulo={data.filha} data={data} hint="clique para detalhar" />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: '#adb5bd', fontSize: 13, textAlign: 'center' }}>Esta linha não tem filhas com valor.</div>}
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Filhas ao longo dos meses (realizado)</div>
              {filhasMes.length ? (
                <div style={S.chart}>
                  <ResponsiveLine data={filhasMes} margin={{ top: 10, right: 16, bottom: 64, left: 56 }}
                    xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                    colors={filhasMes.map((_, i) => CAT[i % CAT.length])} pointSize={5} useMesh curve="monotoneX"
                    axisLeft={{ format: (v: any) => fmtK(Number(v)) }}
                    legends={[{ anchor: 'bottom', direction: 'row', translateY: 56, itemWidth: 110, itemHeight: 14, symbolSize: 10, itemsSpacing: 2 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: '#adb5bd', fontSize: 13, textAlign: 'center' }}>Sem filhas com realizado.</div>}
            </div>
          </div>


          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>Orçado × Realizado por mês <span style={{ fontSize: 11, fontWeight: 400, color: '#adb5bd' }}>(clique no mês p/ detalhar)</span></div>
              <div style={S.chart}>
                <ResponsiveBar data={orcRealMes} keys={['Orçado', 'Realizado']} indexBy="mes" groupMode="grouped"
                  margin={{ top: 10, right: 10, bottom: 40, left: 56 }} padding={0.25} innerPadding={2}
                  colors={['#adb5bd', '#3b5bdb']} borderRadius={3}
                  axisLeft={{ format: (v: any) => fmtK(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  onClick={(d: any) => { const m = d.data?.mesN || (MESES.indexOf(String(d.indexValue)) + 1); if (m > 0 && qparams) setDrill({ nodeId: agrupId || '__root', meses: [m] }) }}
                  tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Diferença (Realizado − Orçado) por mês</div>
              <div style={S.chart}>
                <ResponsiveBar data={deltaMes} keys={['Δ']} indexBy="mes"
                  margin={{ top: 10, right: 10, bottom: 40, left: 56 }} padding={0.3} borderRadius={3}
                  colors={(b: any) => (b.value >= 0 ? '#2f9e44' : '#e03131')}
                  axisLeft={{ format: (v: any) => fmtK(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, value }: any) => <div style={tipBox}><strong>{String(indexValue)}</strong><br /><span style={{ color: Number(value) >= 0 ? '#2f9e44' : '#e03131', fontWeight: 600 }}>Δ (R−O): {fmt(Number(value))}</span></div>} />
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Acumulado (realizado) por ano</div>
            <div style={S.chart}>
              <ResponsiveLine data={accLines} margin={{ top: 10, right: 16, bottom: 40, left: 56 }}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={yearKeys.map((_, i) => YCOLORS[i % YCOLORS.length])} pointSize={6} pointBorderWidth={1} useMesh curve="monotoneX"
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }} enableArea areaOpacity={0.05}
                legends={[{ anchor: 'top-left', direction: 'row', translateY: -2, itemWidth: 56, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Cascata — {escopoNome} (realizado, por filha)</div>
            <div style={S.chart}>
              <ResponsiveBar data={cascata} keys={['base', 'neg', 'pos', 'total']} indexBy="step"
                margin={{ top: 10, right: 10, bottom: 50, left: 56 }} padding={0.3}
                colors={(b: any) => b.id === 'base' ? 'transparent' : b.id === 'total' ? '#3b5bdb' : b.id === 'pos' ? '#2f9e44' : '#e03131'}
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }} axisBottom={{ tickRotation: -30 }}
                enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate />
            </div>
          </div>

          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>{escopoNome} por empresa</div>
              <div style={{ height: Math.max(220, porEmpresa.length * 30 + 50) }}>
                <ResponsiveBar data={porEmpresa} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                  margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                  colors={['#adb5bd', '#3b5bdb']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }}
                  enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>EBITDA por empresa</div>
              {ebitdaEmp.length ? (
                <div style={{ height: Math.max(220, ebitdaEmp.length * 30 + 50) }}>
                  <ResponsiveBar data={ebitdaEmp} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                    colors={['#ffd8a8', '#e8590c']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }}
                    enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                    tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: '#adb5bd', fontSize: 13, textAlign: 'center' }}>Nenhuma linha "EBITDA" encontrada neste relatório.</div>}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Maiores desvios (Realizado − Orçado) — {escopoNome}</div>
            <div style={{ height: Math.max(220, desvios.length * 26 + 50) }}>
              <ResponsiveBar data={desvios} keys={['Δ']} indexBy="conta" layout="horizontal"
                margin={{ top: 6, right: 24, bottom: 24, left: 200 }} padding={0.3}
                colors={(b: any) => (b.value >= 0 ? '#2f9e44' : '#e03131')} enableGridX
                axisBottom={{ format: (v: any) => fmtK(Number(v)) }} valueFormat={(v: any) => fmt(Number(v))}
                labelSkipWidth={9999} animate onClick={(d: any) => d.data.nodeId && qparams && setDrill({ nodeId: d.data.nodeId })} />
            </div>
          </div>
        </>
      )}

      {drill && qparams && (
        <DrillModal relId={relId} versaoId={versaoId} empIds={qparams.empIds} anos={qparams.anos} meses={drill.meses || qparams.meses}
          filFilter={qparams.filFilter} ccFilter={qparams.ccFilter} startNodeId={drill.nodeId} onClose={() => setDrill(null)} />
      )}
    </div>
  )
}
