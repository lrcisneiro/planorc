import { useEffect, useState, useRef, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { computeCenario, computeTotais, pkey, formatValor } from '../../lib/engine'
import type { LinhaCalc, Computed, Periodo, RawValues } from '../../lib/engine'
import { totaisRelatorio } from '../../lib/relatorioTotais'
import type { RLData } from '../../lib/relatorioTotais'
import { ResponsiveBar } from '@nivo/bar'
import { nivoTheme } from '../../lib/nivoTheme'
import { ResponsiveLine } from '@nivo/line'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, RefreshCw, ArrowLeft } from 'lucide-react'
import DrillModal from './DrillModal'
import { escopoFiltro, effectiveCcFilter, FiltrosButton, PeriodoButton, SalvarCardButton, useCardPreset, ModalPanel, Checklist } from './DashFiltros'
import { useUserAccess } from '../../hooks/useUserAccess'
import { ListChecks } from 'lucide-react'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ANOS = [2024, 2025, 2026, 2027, 2028]
const CAT = ['#3b5bdb', '#f59f00', '#2f9e44', '#e8590c', '#7048e8', '#1098ad', '#e64980', '#0ca678', '#f76707', '#4263eb']
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const fmtK = (v: number) => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k' : String(Math.round(v))
const pctOf = (real: number, orc: number) => orc === 0 ? null : (real / orc) * 100
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tipBox: CSSProperties = { background: 'var(--panel)', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }
// tooltip de Orçado × Realizado com Δ (R−O) e separador de milhar
function TipOR({ titulo, data, hint }: { titulo: string; data: any; hint?: string }) {
  const o = Number(data['Orçado'] || 0), r = Number(data['Realizado'] || 0), d = r - o
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{titulo}</div>
      <div><span style={{ color: 'var(--muted)' }}>Orçado:</span> {fmt(o)}</div>
      <div><span style={{ color: 'var(--muted)' }}>Realizado:</span> {fmt(r)}</div>
      <div style={{ color: d >= 0 ? '#2f9e44' : '#e03131', fontWeight: 600 }}>Δ (R−O): {fmt(d)}</div>
      {hint && <div style={{ color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type Item = { id: string; codigo: string; descricao: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null; visivel_dashboard?: boolean; nao_soma?: boolean; filtro_escopo?: any; formato?: any; casas_decimais?: number; redutora?: boolean }

const S: Record<string, CSSProperties> = {
  page:   { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title:  { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 },
  sub:    { fontSize: 13, color: 'var(--muted)', margin: '4px 0 16px' },
  bar:    { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  sel:    { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', color: 'var(--text-mid)' },
  btn:    { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  chip:   { fontSize: 12, color: 'var(--muted)', marginBottom: 16 },
  kpis:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 16 },
  kpi:    { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 },
  kpiLbl: { fontSize: 12, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiVal: { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '6px 0 2px' },
  kpiSub: { fontSize: 12, color: 'var(--muted)' },
  grid2:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 },
  card:   { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardT:  { fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  chart:  { height: 320, background: 'var(--chart-bg)', borderRadius: 10, padding: 8 },
  empty:  { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 },
  label:  { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 },
  input:  { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  pop:    { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1500, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', padding: 16, width: 'min(860px, calc(100vw - 40px))', maxHeight: '85vh', overflowY: 'auto', overflowX: 'hidden' },
  miniSeg:{ padding: '3px 10px', fontSize: 12, border: '1px solid var(--border-strong)', cursor: 'pointer', background: 'var(--panel)', color: 'var(--text-mid)' },
}
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', cursor: 'pointer', color: 'var(--text-mid)' }


function AnoMesGrid({ anosSel, mesesSel, setAnosSel, setMesesSel }: {
  anosSel: number[]; mesesSel: number[]; setAnosSel: (v: number[]) => void; setMesesSel: (v: number[]) => void
}) {
  const toggleAno = (y: number) => setAnosSel(anosSel.includes(y) ? anosSel.filter(x => x !== y) : [...anosSel, y].sort((a, b) => a - b))
  const toggleMes = (m: number) => setMesesSel(mesesSel.includes(m) ? mesesSel.filter(x => x !== m) : [...mesesSel, m].sort((a, b) => a - b))
  return (
    <div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(12, minmax(20px, 1fr))`, gap: 2, minWidth: 400 }}>
          <div />
          {MESES.map((m, i) => (
            <div key={i} onClick={() => toggleMes(i + 1)} title={`marcar ${m}`}
              style={{ fontSize: 10, textAlign: 'center', padding: '2px 0', cursor: 'pointer', fontWeight: mesesSel.includes(i + 1) ? 700 : 400, color: mesesSel.includes(i + 1) ? '#3b5bdb' : 'var(--muted)' }}>{m}</div>
          ))}
          {ANOS.map(y => (
            <Fragment key={y}>
              <div onClick={() => toggleAno(y)} title="marcar o ano"
                style={{ fontSize: 12, fontWeight: anosSel.includes(y) ? 700 : 500, color: anosSel.includes(y) ? '#3b5bdb' : 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>{y}</div>
              {MESES.map((_, i) => {
                const on = anosSel.includes(y) && mesesSel.includes(i + 1)
                const half = anosSel.includes(y) !== mesesSel.includes(i + 1)
                return <div key={i} onClick={() => { if (!anosSel.includes(y)) toggleAno(y); if (!mesesSel.includes(i + 1)) toggleMes(i + 1) }}
                  style={{ height: 22, borderRadius: 4, cursor: 'pointer', background: on ? '#3b5bdb' : 'var(--bg)', border: '1px solid ' + (on ? '#3b5bdb' : 'var(--panel-2)'), opacity: half ? 0.45 : 1 }} />
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
  const cor = pct == null ? 'var(--border-strong)' : pct >= 100 ? '#2f9e44' : pct >= 80 ? '#f59f00' : '#e03131'
  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 180 110" width="100%" style={{ maxWidth: 220 }}>
        <path d={`M ${tx0} ${ty0} A ${r} ${r} 0 0 1 ${tx1} ${ty1}`} fill="none" stroke="#edf0f2" strokeWidth={14} strokeLinecap="round" />
        <path d={`M ${tx0} ${ty0} A ${r} ${r} 0 0 1 ${vx} ${vy}`} fill="none" stroke={cor} strokeWidth={14} strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--text)">{pct == null ? '—' : Math.round(pct) + '%'}</text>
      </svg>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginTop: -6 }}>{label}</div>
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
  const ksub: CSSProperties = { fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{c.label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '6px 0 4px' }}>{f(c.R)}</div>
      <div style={ksub}>Orçado {f(c.O)} · {c.isPct
        ? <span style={{ color: bomY ? '#2f9e44' : '#e03131' }}>{d >= 0 ? '+' : ''}{formatValor(d, 'NUMERO', c.casas)} pp</span>
        : (exec == null ? '—' : <span style={{ color: bomExec ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{Arrow(bomExec)}{exec.toFixed(0)}%</span>)}</div>
      <div style={{ ...ksub, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--panel)' }}>
        <strong style={{ color: 'var(--text-mid)' }}>{anoPrev}</strong> {f(c.P)} · {c.isPct
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
  const acessoDash = useUserAccess()
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
  const [kpi, setKpi] = useState({ resOrc: 0, resReal: 0, recOrc: 0, recReal: 0, despOrc: 0, despReal: 0, resPrev: 0, recPrev: 0, despPrev: 0, recBrutaOrc: 0, recBrutaReal: 0, recBrutaPrev: 0 })
  const [orcRealMes, setOrcRealMes] = useState<any[]>([])
  const [resMes, setResMes] = useState<{ mes: string; res: number }[]>([])
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
  // gráficos por Área / Centro de Custo (cruzam CC × natureza da linha)
  const [recAreaLinhas, setRecAreaLinhas] = useState<any[]>([])   // receitas por área: realizado (cheia) + orçado (tracejada)
  const [recDespLinhas, setRecDespLinhas] = useState<any[]>([])   // 3: evolução receitas × despesas (linhas)
  const [recAreaBar, setRecAreaBar] = useState<any[]>([])         // 2: receitas por área O×R+Δ (barras)
  const [despAreaBar, setDespAreaBar] = useState<any[]>([])       // 4: despesas por área O×R+Δ (barras)
  const [despCcBar, setDespCcBar] = useState<any[]>([])           // 5: despesas por CC (nível 2) O×R+Δ
  const [recCcBar, setRecCcBar] = useState<any[]>([])             // 6: receitas por CC (nível 2) O×R+Δ
  const [temDados, setTemDados] = useState(false)
  const [drill, setDrill] = useState<{ nodeId: string; meses?: number[]; ccFilter?: string[] | null } | null>(null)
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
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao,ordem,visivel_dashboard,nao_soma,filtro_escopo,formato,casas_decimais,redutora').eq('relatorio_id', relId)
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
      // linha marcada como "redutora de receita" (imposto) → separa bruta/líquida
      const redutoraByMaster: Record<string, boolean> = {}
      masterIds.forEach(m => { redutoraByMaster[m] = !!byId[rlOfMaster[m]]?.redutora })

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
      const empIds = escopoFiltro(empresaSel.length ? empresaSel : allEmp, empresas, 'empresa', acessoDash.canSee) ?? []
      const empSet = new Set(empIds)
      const filFilter = escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acessoDash.canSee)
      const ccFilter = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acessoDash.canSee)
      if (!scopedMasters.length || !empIds.length) { setTemDados(false); setLoading(false); return }
      const anos = [...anosSel].sort((a, b) => a - b), meses = [...mesesSel].sort((a, b) => a - b)
      setQparams({ empIds, anos, meses, filFilter, ccFilter })

      // cards dinâmicos: linhas de apoio/indicador do relatório (respeita visivel_dashboard) — usa o helper p/ escopo de CC
      const indicLines = linhas.filter(l => (l.tipo_linha === 'INDICADOR' || l.nao_soma) && l.visivel_dashboard !== false)
        .sort((a, b) => (seqOrd[a.id] ?? 9999) - (seqOrd[b.id] ?? 9999))
      if (indicLines.length) {
        const ccPermI = (ccs as any).every((c: any) => acessoDash.canSee('centro_custo', c.id)) ? null : (ccs as any).filter((c: any) => acessoDash.canSee('centro_custo', c.id)).map((c: any) => c.id)
        const baseI = { linhas: linhas as RLData[], ccs: ccs as any, empresas: empIds, meses, filialFilter: filFilter, ccFilter, ccPermitidos: ccPermI }
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
      // dashboard_cc_agg retorna cc×linha×mês (muitas linhas) → PAGINAR pra não truncar no limite do Supabase
      const fetchCcAggAll = async (): Promise<any[]> => {
        const out: any[] = []; const size = 1000; let from = 0
        for (;;) {
          const { data, error } = await supabase.rpc('dashboard_cc_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }).range(from, from + size - 1)
          if (error || !data || !data.length) break   // não-fatal: se a RPC não existe, fica vazio
          out.push(...data)
          if (data.length < size) break
          from += size
        }
        return out
      }
      const [orcR, realR, lineEmpR, realPrevR, ccAggRows] = await Promise.all([
        supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_linha_empresa_agg', { p_versao: versaoId, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos.map(a => a - 1), p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        fetchCcAggAll(),
      ])
      if (orcR.error) throw new Error(orcR.error.message)
      if (realR.error) throw new Error(realR.error.message)
      if (lineEmpR.error) throw new Error(lineEmpR.error.message)
      if (realPrevR.error) throw new Error(realPrevR.error.message)

      // ── período como lista e avaliação via ENGINE (orçado avalia fórmula de célula, igual ao relatório) ──
      const periodos: Periodo[] = []
      for (const y of anos) for (const m of meses) periodos.push({ ano: y, mes: m })
      periodos.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
      const rawOrc: RawValues = {}, rawReal: RawValues = {}
      for (const r of orcR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawOrc[rl] = rawOrc[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: r.expr ?? null } }
      for (const r of realR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawReal[rl] = rawReal[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const cOrc = computeCenario(linhasCalc, rawOrc, periodos), cReal = computeCenario(linhasCalc, rawReal, periodos)
      const tOrc = computeTotais(linhasCalc, cOrc, periodos), tReal = computeTotais(linhasCalc, cReal, periodos)
      // realizado do ano ANTERIOR (mesmos nós) p/ o comparativo YoY nos gauges
      const periodosPrev: Periodo[] = []
      for (const y of anos) for (const m of meses) periodosPrev.push({ ano: y - 1, mes: m })
      periodosPrev.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
      const rawRealPrev: RawValues = {}
      for (const r of realPrevR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawRealPrev[rl] = rawRealPrev[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const tRealPrev = computeTotais(linhasCalc, computeCenario(linhasCalc, rawRealPrev, periodosPrev), periodosPrev)
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
      // acumulado dos anos selecionados agregados (a comparação ano a ano vive no dash Comparativo Anual)
      let accR = 0, accO = 0
      const acc = [
        { id: 'Realizado', data: meses.map(m => { accR += rmM[m] || 0; return { x: MESES[m - 1], y: Math.round(nodeFac * accR) } }) },
        { id: 'Orçado', data: meses.map(m => { accO += omM[m] || 0; return { x: MESES[m - 1], y: Math.round(nodeFac * accO) } }) },
      ]

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
      let recOF = 0, recRF = 0, despOF = 0, despRF = 0, recBrutaOF = 0, recBrutaRF = 0
      for (const l of leaves) {
        const nat = natByMaster[l.linha_orc_id!]
        if (nat === 'RECEITA') {
          recOF += tOrc[l.id] || 0; recRF += tReal[l.id] || 0                                  // líquida (com redutoras)
          if (!redutoraByMaster[l.linha_orc_id!]) { recBrutaOF += tOrc[l.id] || 0; recBrutaRF += tReal[l.id] || 0 }  // bruta (sem redutoras)
        } else if (nat === 'DESPESA') { despOF += tOrc[l.id] || 0; despRF += tReal[l.id] || 0 }
      }
      const resNode = linhas.find(l => norm(l.descricao).includes('resultado liquido'))
      const resOrcKpi = resNode ? (tOrc[resNode.id] || 0) : leaves.reduce((s, l) => s + (tOrc[l.id] || 0), 0)
      const resRealKpi = resNode ? (tReal[resNode.id] || 0) : leaves.reduce((s, l) => s + (tReal[l.id] || 0), 0)
      // ano anterior (mesma lógica de resultado/receita/despesa, sobre o realizado de anos-1)
      let recPF = 0, despPF = 0, recBrutaPF = 0
      for (const l of leaves) {
        const nat = natByMaster[l.linha_orc_id!]
        if (nat === 'RECEITA') { recPF += tRealPrev[l.id] || 0; if (!redutoraByMaster[l.linha_orc_id!]) recBrutaPF += tRealPrev[l.id] || 0 }
        else if (nat === 'DESPESA') despPF += tRealPrev[l.id] || 0
      }
      const resPrevKpi = resNode ? (tRealPrev[resNode.id] || 0) : leaves.reduce((s, l) => s + (tRealPrev[l.id] || 0), 0)
      // Resultado Líquido realizado por mês (linha sobreposta no gráfico Orçado × Realizado)
      const resByMesN: Record<number, number> = {}
      if (resNode) for (const p of periodos) resByMesN[p.mes] = (resByMesN[p.mes] || 0) + (cReal[resNode.id]?.[pkey(p)] || 0)
      const resMesArr = meses.map(m => ({ mes: MESES[m - 1], res: Math.round(resByMesN[m] || 0) }))

      // ── Gráficos por Área / Centro de Custo (dashboard_cc_agg → cc_id × linha × mês) ──
      // mesmos masters que o card/engine contam (folhas analíticas válidas: exclui desativada/não-soma)
      const leafMasters = new Set<string>(leaves.map(l => l.linha_orc_id as string))
      const ccInfo: Record<string, { area: string; cc: string }> = {}
      ;(ccs as any[]).forEach(c => {
        const area = c.area_cod ? `${c.area_cod}-${c.area_nome || ''}`.trim() : (c.area_nome || 'Sem área')
        ccInfo[c.id] = { area: area || 'Sem área', cc: `${c.codigo} · ${cut(c.descricao, 22)}` }
      })
      const areaDe = (cc: string | null) => (cc && ccInfo[cc]) ? ccInfo[cc].area : 'Sem área'
      // nível do meio do CC = 2 primeiros dígitos do código (área + divisão); rótulo do CC-pai se existir
      const ccById2: Record<string, any> = {}; (ccs as any[]).forEach(c => { ccById2[c.id] = c })
      const ccByCode2: Record<string, any> = {}; (ccs as any[]).forEach(c => { ccByCode2[String(c.codigo)] = c })
      const nivel2De = (ccid: string | null) => {
        const c = ccid ? ccById2[ccid] : null
        if (!c) return 'Sem CC'
        const cod2 = String(c.codigo || '').slice(0, 2)
        if (cod2.length < 2) return `${c.codigo} · ${cut(c.descricao, 20)}`
        const nome = ccByCode2[cod2]?.descricao || `${c.area_nome || ''}${c.divisao_nome ? ' / ' + c.divisao_nome : ''}`.trim() || cod2
        return `${cod2} · ${cut(nome, 20)}`
      }
      const recAreaMesA: Record<string, Record<number, number>> = {}        // 1 (realizado)
      const recAreaMesAOrc: Record<string, Record<number, number>> = {}     // 1b (orçado, p/ investigar)
      const recMesT: Record<number, number> = {}, despMesT: Record<number, number> = {}  // 3
      const recAreaB: Record<string, { o: number; r: number }> = {}         // 2
      const despAreaB: Record<string, { o: number; r: number }> = {}        // 4
      const despCcB: Record<string, { o: number; r: number; ccs: Set<string> }> = {}   // 5 (despesa nível 2 do CC)
      const recCcB: Record<string, { o: number; r: number; ccs: Set<string> }> = {}    // 6 (receita nível 2 do CC)
      for (const row of ccAggRows) {
        if (!leafMasters.has(row.linha_id)) continue   // só folhas válidas (igual ao card; exclui desativada/não-soma)
        const nat = natByMaster[row.linha_id]
        if (nat !== 'RECEITA' && nat !== 'DESPESA') continue
        if (nat === 'RECEITA' && redutoraByMaster[row.linha_id]) continue   // receita por área = BRUTA (sem redutoras)
        const fac = nat === 'DESPESA' ? -1 : 1
        const od = fac * (Number(row.orcado) || 0), rd = fac * (Number(row.realizado) || 0)   // exibição (positivo)
        const area = areaDe(row.cc_id)
        if (nat === 'RECEITA') {
          ;(recAreaMesA[area] = recAreaMesA[area] || {})[row.mes] = (recAreaMesA[area]?.[row.mes] || 0) + rd
          ;(recAreaMesAOrc[area] = recAreaMesAOrc[area] || {})[row.mes] = (recAreaMesAOrc[area]?.[row.mes] || 0) + od
          recMesT[row.mes] = (recMesT[row.mes] || 0) + rd
          const b = (recAreaB[area] = recAreaB[area] || { o: 0, r: 0 }); b.o += od; b.r += rd
          const cnr = nivel2De(row.cc_id); const bcr = (recCcB[cnr] = recCcB[cnr] || { o: 0, r: 0, ccs: new Set<string>() }); bcr.o += od; bcr.r += rd; if (row.cc_id) bcr.ccs.add(row.cc_id)
        } else {
          despMesT[row.mes] = (despMesT[row.mes] || 0) + rd
          const b = (despAreaB[area] = despAreaB[area] || { o: 0, r: 0 }); b.o += od; b.r += rd
          const cn = nivel2De(row.cc_id); const bc = (despCcB[cn] = despCcB[cn] || { o: 0, r: 0, ccs: new Set<string>() }); bc.o += od; bc.r += rd; if (row.cc_id) bc.ccs.add(row.cc_id)
        }
      }
      const mesesOrd = [...meses].sort((a, b) => a - b)
      const PALETA = ['#3b5bdb', '#e8590c', '#2f9e44', '#7048e8', '#1098ad', '#f59f00', '#e64980', '#15aabf']
      // Receitas por área: realizado (cheia) + orçado (tracejada, id "… (orç)"), mesma cor por área
      const areasRec = [...new Set([...Object.keys(recAreaMesA), ...Object.keys(recAreaMesAOrc)])].sort()
      const corArea: Record<string, string> = {}; areasRec.forEach((a, i) => { corArea[a] = PALETA[i % PALETA.length] })
      const recAreaLinhasD: any[] = []
      for (const a of areasRec) {
        recAreaLinhasD.push({ id: a, color: corArea[a], data: mesesOrd.map(m => ({ x: MESES[m - 1], y: Math.round((recAreaMesA[a]?.[m]) || 0) })) })
        recAreaLinhasD.push({ id: `${a} (orç)`, color: corArea[a], data: mesesOrd.map(m => ({ x: MESES[m - 1], y: Math.round((recAreaMesAOrc[a]?.[m]) || 0) })) })
      }
      const recDespLinhasD = [
        { id: 'Receitas', data: mesesOrd.map(m => ({ x: MESES[m - 1], y: Math.round(recMesT[m] || 0) })) },
        { id: 'Despesas', data: mesesOrd.map(m => ({ x: MESES[m - 1], y: Math.round(despMesT[m] || 0) })) },
      ]
      const barDe = (acc: Record<string, { o: number; r: number }>, key: string) => Object.entries(acc).filter(([, v]) => v.o || v.r)
        .map(([k, v]) => ({ [key]: k, 'Orçado': Math.round(v.o), 'Realizado': Math.round(v.r), 'Δ': Math.round(v.r - v.o) }))
        .sort((a, b) => (b['Realizado'] as number) - (a['Realizado'] as number))
      const recAreaBarD = barDe(recAreaB, 'area'), despAreaBarD = barDe(despAreaB, 'area')
      const ccBar = (acc: Record<string, { o: number; r: number; ccs: Set<string> }>) => Object.entries(acc).filter(([, v]) => v.o || v.r)
        .map(([k, v]) => ({ cc: k, 'Orçado': Math.round(v.o), 'Realizado': Math.round(v.r), 'Δ': Math.round(v.r - v.o), _ccs: [...v.ccs] }))
        .sort((a, b) => String(a.cc).localeCompare(String(b.cc), 'pt-BR', { numeric: true }))   // ordena pelo rótulo do eixo X (nível 2)
      const despCcBarD = ccBar(despCcB), recCcBarD = ccBar(recCcB)

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
      setKpi({ resOrc: resOrcKpi, resReal: resRealKpi, recOrc: recOF, recReal: recRF, despOrc: despOF, despReal: despRF, resPrev: resPrevKpi, recPrev: recPF, despPrev: despPF, recBrutaOrc: recBrutaOF, recBrutaReal: recBrutaRF, recBrutaPrev: recBrutaPF })
      setOrcRealMes(orMes); setResMes(resMesArr); setAccLines(acc); setComposicao(comps); setCompOcultas(childrenOcultas); setFilhasMes(fMes); setCascata(steps)
      setRecAreaLinhas(recAreaLinhasD); setRecDespLinhas(recDespLinhasD); setRecAreaBar(recAreaBarD); setDespAreaBar(despAreaBarD); setDespCcBar(despCcBarD); setRecCcBar(recCcBarD)
      setPorEmpresa(pe); setEbitdaEmp(eb); setDesvios(desv)
      setTemDados(Object.keys(omM).length > 0 || Object.keys(rmM).length > 0)
    } catch (e: any) { if (myseq === loadSeq.current) setErro(e?.message ?? String(e)) }
    if (myseq === loadSeq.current) setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, empresas, filiais, ccs, acessoDash.loading]) // eslint-disable-line

  const anosOrd = [...anosSel].sort((a, b) => a - b)
  const deltaMes = orcRealMes.map((m: any) => ({ mes: m.mes, 'Δ': Math.round((m.Realizado || 0) - (m.Orçado || 0)) }))
  // mapas p/ o drill dos gráficos por área/CC (área/CC clicada → cc_ids, só os visíveis ao usuário)
  const areaToCcs: Record<string, string[]> = {}
  ;(ccs as any[]).forEach(c => {
    if (!acessoDash.canSee('centro_custo', c.id)) return
    const area = ((c.area_cod ? `${c.area_cod}-${c.area_nome || ''}`.trim() : (c.area_nome || 'Sem área')) || 'Sem área')
    ;(areaToCcs[area] = areaToCcs[area] || []).push(c.id)
  })
  const drillPorCcs = (ids: string[], mes?: number) => {
    if (!qparams || !ids.length) return
    const f = qparams.ccFilter ? ids.filter(i => qparams.ccFilter!.includes(i)) : ids
    if (f.length) setDrill({ nodeId: '__root', ccFilter: f, meses: mes ? [mes] : undefined })
  }
  // drill a partir de um ponto de linha (área × mês) → razão escopado àquela área e mês
  const drillAreaMes = (area: string, mesLabel: string) => {
    const a = String(area).replace(' (orç)', '')   // série de orçado compartilha os CCs da área
    const m = MESES.indexOf(String(mesLabel)) + 1
    drillPorCcs(areaToCcs[a] || [], m > 0 ? m : undefined)
  }
  const chip = `${escopoNome} · ${anosOrd.join(', ') || '—'} · ${mesesSel.length === 12 ? 'todos os meses' : mesesSel.length + ' meses'}`
    + ` · ${empresaSel.length ? empresaSel.length + ' empresa(s)' : 'todas as empresas'}`
    + (filialSel.length && filialSel.length < filiais.length ? ` · ${filialSel.length} filial` : '')
    + (ccSel.length && ccSel.length < ccs.length ? ` · ${ccSel.length} CC` : '')

  const KpiCard = ({ lbl, orc, real, prev, anoPrev, desp, liq }: { lbl: string; orc: number; real: number; prev?: number; anoPrev?: number; desp?: boolean; liq?: number }) => {
    const p = pctOf(real, orc); const up = real >= orc
    const f = desp ? -1 : 1   // despesa exibida positiva (dado é negativo)
    const d = f * (real - orc)   // delta (Realizado − Orçado) na orientação exibida
    // comparativo com o ano anterior (mesma lógica dos cards personalizados)
    const temP = prev != null && anoPrev != null
    const Rv = f * real, Pv = temP ? f * (prev as number) : 0
    const yoy = temP && Pv !== 0 ? (Rv / Pv - 1) * 100 : null
    const bomY = desp ? Rv <= Pv : Rv >= Pv
    return (
      <div style={S.kpi}>
        <div style={S.kpiLbl}>{lbl}</div>
        <div style={{ ...S.kpiVal, color: desp ? '#e03131' : 'var(--text)' }}>{fmt(f * real)}</div>
        <div style={S.kpiSub}>Orçado {fmt(f * orc)} <span style={{ color: up ? '#2f9e44' : '#e03131', fontWeight: 600 }}>({d >= 0 ? '+' : ''}{fmt(d)})</span> · {p == null ? '—' : <span style={{ color: up ? '#2f9e44' : '#e03131', fontWeight: 600 }}>{up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {p.toFixed(0)}%</span>}</div>
        {temP && (Pv !== 0
          ? <div style={{ ...S.kpiSub, marginTop: 2 }}>{anoPrev}: {fmt(Pv)} <span style={{ color: bomY ? '#2f9e44' : '#e03131', fontWeight: 600 }}>{yoy != null ? `(${yoy >= 0 ? '+' : ''}${yoy.toFixed(0)}%)` : ''}</span></div>
          : <div style={{ ...S.kpiSub, marginTop: 2, color: 'var(--faint)' }}>sem dado {anoPrev}</div>)}
        {liq != null && <div style={{ ...S.kpiSub, marginTop: 2 }}>Líquida: <strong style={{ color: 'var(--text-mid)' }}>{fmt(liq)}</strong></div>}
      </div>
    )
  }

  // Layer custom do @nivo/line: orçado (id "… orç") sai tracejado; realizado, cheio
  const AccLinhas = ({ series, lineGenerator }: any) => (
    <g>
      {series.map((s: any) => (
        <path key={s.id} d={lineGenerator(s.data.map((d: any) => d.position))} fill="none" stroke={s.color} strokeWidth={2}
          strokeDasharray={String(s.id).toLowerCase().includes('orç') ? '6 4' : undefined} />
      ))}
    </g>
  )

  // Tooltip dos comparativos por área/CC (Orçado/Realizado/Δ; cor do Δ por bom/ruim, despesa invertida)
  const barTip = (titulo: string, data: any, desp: boolean) => {
    const o = Number(data['Orçado'] || 0), r = Number(data['Realizado'] || 0), dd = Number(data['Δ'] || 0)
    const bom = desp ? dd <= 0 : dd >= 0
    return <div style={tipBox}><strong>{titulo}</strong><br />Orçado: {fmt(o)}<br />Realizado: <strong>{fmt(r)}</strong><br /><span style={{ color: bom ? '#2f9e44' : '#e03131', fontWeight: 600 }}>Δ (R−O): {(dd >= 0 ? '+' : '') + fmt(dd)}</span></div>
  }

  // Layer custom do @nivo/bar: sobrepõe a linha de Resultado Líquido (realizado) por mês, com rótulos
  const LinhaResultado = ({ bars, yScale }: any) => {
    if (!resMes.length || !bars?.length) return null
    const centro: Record<string, { sx: number; n: number }> = {}
    bars.forEach((b: any) => { const k = String(b.data.indexValue); const c = centro[k] || (centro[k] = { sx: 0, n: 0 }); c.sx += b.x + b.width / 2; c.n++ })
    const pts = resMes.filter(r => centro[r.mes]).map(r => ({ x: centro[r.mes].sx / centro[r.mes].n, y: yScale(r.res), v: r.res }))
    if (!pts.length) return null
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    return (
      <g>
        <path d={d} fill="none" stroke="#f59f00" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="#f59f00" stroke="var(--panel)" strokeWidth={1} />
            <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize={9} fontWeight={700} fill="#f59f00">{fmtK(p.v)}</text>
          </g>
        ))}
      </g>
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
        <FiltrosButton empresas={acessoDash.filterList('empresa', empresas)} filiais={acessoDash.filterList('filial', filiais)} ccs={acessoDash.filterList('centro_custo', ccs as any) as any} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <SalvarCardButton base="/dashboard" cor="#3b5bdb" cardId={cardId} getFiltros={() => ({ relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel })} />
        {indicCards.length > 0 && <button style={S.btn} onClick={() => setPickIndic(true)} title="Escolher quais indicadores exibir"><ListChecks size={13} /> Indicadores{indicSel.length ? ` (${indicSel.length})` : ''}</button>}
        {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Carregando…</span>}
      </div>
      {pickIndic && (
        <ModalPanel titulo="Indicadores a exibir" onClose={() => setPickIndic(false)} width="min(520px, calc(100vw - 40px))">
          <Checklist titulo="Indicadores" items={indicCards.map(c => ({ id: c.id, codigo: '', descricao: c.label }))} sel={indicSel} setSel={setIndicSel} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Vazio = mostra todos. Use para esconder indicadores que não fazem sentido neste preset (ex.: EBITDA num recorte por CC).</div>
        </ModalPanel>
      )}
      <div style={S.chip}>{chip}</div>

      {erro && <div style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>⚠ {erro}</div>}

      {!temDados && !loading ? (
        <div style={S.empty}>Sem dados para os filtros selecionados.</div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 8 }}>Visão geral do relatório (não afetada pela linha agrupadora)</div>
          <div style={S.kpis}>
            <KpiCard lbl="Resultado" orc={kpi.resOrc} real={kpi.resReal} prev={kpi.resPrev} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} />
            <KpiCard lbl="Receita Bruta" orc={kpi.recBrutaOrc} real={kpi.recBrutaReal} prev={kpi.recBrutaPrev} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} liq={kpi.recReal} />
            <KpiCard lbl="Despesa" orc={kpi.despOrc} real={kpi.despReal} prev={kpi.despPrev} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} desp />
          </div>

          <div style={{ ...S.card, display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16 }}>
            <Gauge label="Execução Resultado" pct={pctOf(kpi.resReal, kpi.resOrc)} />
            <Gauge label="Execução Receita" pct={pctOf(kpi.recReal, kpi.recOrc)} />
            <Gauge label="Execução Despesa" pct={pctOf(kpi.despReal, kpi.despOrc)} />
          </div>

          {(() => { const vis = indicCards.filter(c => indicSel.includes(c.id)); return vis.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '16px 0 8px' }}>Indicadores do relatório</div>
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
                <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, composicao.length * 34 + 50) }}>
                  <ResponsiveBar theme={nivoTheme()} data={composicao} keys={['Orçado', 'Realizado']} indexBy="filha" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 160 }} padding={0.25} innerPadding={2}
                    colors={['#9aa0aa', '#3b5bdb']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }}
                    enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate onClick={(d: any) => d.data.id && qparams && setDrill({ nodeId: d.data.id })}
                    tooltip={({ data }: any) => <TipOR titulo={data.filha} data={data} hint="clique para detalhar" />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Esta linha não tem filhas com valor.</div>}
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Filhas ao longo dos meses (realizado)</div>
              {filhasMes.length ? (
                <div style={S.chart}>
                  <ResponsiveLine theme={nivoTheme()} data={filhasMes} margin={{ top: 10, right: 16, bottom: 64, left: 56 }}
                    xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                    colors={filhasMes.map((_, i) => CAT[i % CAT.length])} pointSize={5} useMesh curve="monotoneX"
                    axisLeft={{ format: (v: any) => fmtK(Number(v)) }}
                    legends={[{ anchor: 'bottom', direction: 'row', translateY: 56, itemWidth: 110, itemHeight: 14, symbolSize: 10, itemsSpacing: 2 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Sem filhas com realizado.</div>}
            </div>
          </div>


          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>Orçado × Realizado por mês <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(clique no mês p/ detalhar)</span> <span style={{ fontSize: 11, fontWeight: 600, color: '#f59f00' }}>— linha: Resultado Líquido</span></div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={orcRealMes} keys={['Orçado', 'Realizado']} indexBy="mes" groupMode="grouped"
                  margin={{ top: 18, right: 10, bottom: 40, left: 56 }} padding={0.25} innerPadding={2}
                  colors={['#9aa0aa', '#3b5bdb']} borderRadius={3}
                  layers={['grid', 'axes', 'bars', LinhaResultado, 'markers', 'legends']}
                  axisLeft={{ format: (v: any) => fmtK(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  onClick={(d: any) => { const m = d.data?.mesN || (MESES.indexOf(String(d.indexValue)) + 1); if (m > 0 && qparams) setDrill({ nodeId: agrupId || '__root', meses: [m] }) }}
                  tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Diferença (Realizado − Orçado) por mês</div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={deltaMes} keys={['Δ']} indexBy="mes"
                  margin={{ top: 10, right: 10, bottom: 40, left: 56 }} padding={0.3} borderRadius={3}
                  colors={(b: any) => (b.value >= 0 ? '#2f9e44' : '#e03131')}
                  axisLeft={{ format: (v: any) => fmtK(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, value }: any) => <div style={tipBox}><strong>{String(indexValue)}</strong><br /><span style={{ color: Number(value) >= 0 ? '#2f9e44' : '#e03131', fontWeight: 600 }}>Δ (R−O): {fmt(Number(value))}</span></div>} />
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Acumulado por ano <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(linha cheia = realizado · tracejada = orçado)</span></div>
            <div style={S.chart}>
              <ResponsiveLine theme={nivoTheme()} data={accLines} margin={{ top: 10, right: 16, bottom: 40, left: 56 }}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={(s: any) => s.id === 'Orçado' ? '#9aa0aa' : '#3b5bdb'}
                pointSize={6} pointBorderWidth={1} useMesh curve="monotoneX"
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }}
                layers={['grid', 'markers', 'axes', AccLinhas, 'points', 'slices', 'mesh', 'legends']}
                legends={[{ anchor: 'top-left', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Cascata — {escopoNome} (realizado, por filha)</div>
            <div style={S.chart}>
              <ResponsiveBar theme={nivoTheme()} data={cascata} keys={['base', 'neg', 'pos', 'total']} indexBy="step"
                margin={{ top: 10, right: 10, bottom: 50, left: 56 }} padding={0.3}
                colors={(b: any) => b.id === 'base' ? 'transparent' : b.id === 'total' ? '#3b5bdb' : b.id === 'pos' ? '#2f9e44' : '#e03131'}
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }} axisBottom={{ tickRotation: -30 }}
                enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate />
            </div>
          </div>

          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>{escopoNome} por empresa</div>
              <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, porEmpresa.length * 30 + 50) }}>
                <ResponsiveBar theme={nivoTheme()} data={porEmpresa} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                  margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                  colors={['#9aa0aa', '#3b5bdb']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }}
                  enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>EBITDA por empresa</div>
              {ebitdaEmp.length ? (
                <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, ebitdaEmp.length * 30 + 50) }}>
                  <ResponsiveBar theme={nivoTheme()} data={ebitdaEmp} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                    colors={['#ffd8a8', '#e8590c']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }}
                    enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                    tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Nenhuma linha "EBITDA" encontrada neste relatório.</div>}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Maiores desvios (Realizado − Orçado) — {escopoNome}</div>
            <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, desvios.length * 26 + 50) }}>
              <ResponsiveBar theme={nivoTheme()} data={desvios} keys={['Δ']} indexBy="conta" layout="horizontal"
                margin={{ top: 6, right: 24, bottom: 24, left: 200 }} padding={0.3}
                colors={(b: any) => (b.value >= 0 ? '#2f9e44' : '#e03131')} enableGridX
                axisBottom={{ format: (v: any) => fmtK(Number(v)) }} valueFormat={(v: any) => fmt(Number(v))}
                labelSkipWidth={9999} animate onClick={(d: any) => d.data.nodeId && qparams && setDrill({ nodeId: d.data.nodeId })} />
            </div>
          </div>

          {/* ── Por Área / Centro de Custo (cruza CC × natureza da linha) ── */}
          <div style={S.grid2}>
          <div style={S.card}>
            <div style={S.cardT}>Receitas por área <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(cheia = realizado · tracejada = orçado · clique p/ razão)</span></div>
            <div style={S.chart}>
              <ResponsiveLine theme={nivoTheme()} data={recAreaLinhas} margin={{ top: 10, right: 16, bottom: 40, left: 56 }}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={(s: any) => s.color} pointSize={5} pointBorderWidth={1} useMesh curve="monotoneX"
                onClick={(p: any) => drillAreaMes(String(p.serieId), String(p.data?.x))}
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }}
                layers={['grid', 'markers', 'axes', AccLinhas, 'points', 'slices', 'mesh', 'legends']}
                legends={[{ anchor: 'top-left', direction: 'row', translateY: -2, itemWidth: 110, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Evolução Receitas × Despesas <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(realizado)</span></div>
            <div style={S.chart}>
              <ResponsiveLine theme={nivoTheme()} data={recDespLinhas} margin={{ top: 10, right: 16, bottom: 40, left: 56 }}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={(s: any) => s.id === 'Receitas' ? '#2f9e44' : '#e03131'} pointSize={6} pointBorderWidth={1} useMesh curve="monotoneX"
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }}
                legends={[{ anchor: 'top-left', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>
          </div>

          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>Receitas por área <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · clique p/ detalhar)</span></div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={recAreaBar} keys={['Orçado', 'Realizado', 'Δ']} indexBy="area" groupMode="grouped"
                  onClick={(d: any) => drillPorCcs(areaToCcs[String(d.indexValue)] || [])}
                  margin={{ top: 18, right: 10, bottom: 60, left: 56 }} padding={0.3} innerPadding={2}
                  colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={3}
                  axisLeft={{ format: (v: any) => fmtK(Number(v)) }} axisBottom={{ tickRotation: -20 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, false)}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Despesas por área <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · clique p/ detalhar)</span></div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={despAreaBar} keys={['Orçado', 'Realizado', 'Δ']} indexBy="area" groupMode="grouped"
                  onClick={(d: any) => drillPorCcs(areaToCcs[String(d.indexValue)] || [])}
                  margin={{ top: 18, right: 10, bottom: 60, left: 56 }} padding={0.3} innerPadding={2}
                  colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={3}
                  axisLeft={{ format: (v: any) => fmtK(Number(v)) }} axisBottom={{ tickRotation: -20 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, true)}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Despesas por centro de custo (nível 2 — área/divisão) <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · acumulado · clique p/ detalhar)</span></div>
            <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: 340 }}>
              <ResponsiveBar theme={nivoTheme()} data={despCcBar} keys={['Orçado', 'Realizado', 'Δ']} indexBy="cc" groupMode="grouped"
                onClick={(d: any) => { const ids = (d.data?._ccs || []) as string[]; if (ids.length) drillPorCcs(ids) }}
                margin={{ top: 18, right: 10, bottom: 110, left: 56 }} padding={0.3} innerPadding={1}
                colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={2}
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }} axisBottom={{ tickRotation: -45 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, true)}
                legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Receitas por centro de custo (nível 2 — área/divisão) <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · bruta · clique p/ detalhar)</span></div>
            <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: 340 }}>
              <ResponsiveBar theme={nivoTheme()} data={recCcBar} keys={['Orçado', 'Realizado', 'Δ']} indexBy="cc" groupMode="grouped"
                onClick={(d: any) => { const ids = (d.data?._ccs || []) as string[]; if (ids.length) drillPorCcs(ids) }}
                margin={{ top: 18, right: 10, bottom: 110, left: 56 }} padding={0.3} innerPadding={1}
                colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={2}
                axisLeft={{ format: (v: any) => fmtK(Number(v)) }} axisBottom={{ tickRotation: -45 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, false)}
                legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>
        </>
      )}

      {drill && qparams && (
        <DrillModal relId={relId} versaoId={versaoId} empIds={qparams.empIds} anos={qparams.anos} meses={drill.meses || qparams.meses}
          filFilter={qparams.filFilter} ccFilter={drill.ccFilter !== undefined ? drill.ccFilter : qparams.ccFilter} startNodeId={drill.nodeId} onClose={() => setDrill(null)} />
      )}
    </div>
  )
}
