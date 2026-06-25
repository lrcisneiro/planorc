import { useEffect, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { computeCenario, computeTotais } from '../../lib/engine'
import type { LinhaCalc, RawValues, Periodo } from '../../lib/engine'
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { FiltrosButton, PeriodoButton, effectiveCcFilter, SalvarCardButton, useCardPreset } from './DashFiltros'
import type { Item, CC } from './DashFiltros'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ULT_FECHADO = new Date().getMonth() === 0 ? 12 : new Date().getMonth()
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string; nao_soma?: boolean }

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:   { fontSize: 13, color: '#868e96', margin: '4px 0 16px' },
  bar:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  sel:   { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  btn:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 },
  kpi:   { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 18 },
  lbl:   { fontSize: 12, color: '#868e96', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 },
  val:   { fontSize: 26, fontWeight: 700, color: '#212529', margin: '8px 0 4px' },
  ksub:  { fontSize: 12, color: '#868e96', display: 'flex', alignItems: 'center', gap: 6 },
  empty: { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: '#aaa', fontSize: 14 },
}

function Kpi({ label, real, orc, despesa, prev, anoPrev }: { label: string; real: number; orc: number; despesa?: boolean; prev?: number; anoPrev?: number }) {
  const exec = orc !== 0 ? (real / orc) * 100 : null
  // p/ despesa, executar acima do orçado é ruim → cor invertida
  const bom = exec == null ? true : despesa ? exec <= 100 : exec >= 100
  const d = real - orc
  const yoy = (prev != null && prev !== 0) ? (real / prev - 1) * 100 : null
  // p/ despesa, crescer vs ano anterior é ruim → cor invertida
  const bomY = yoy == null ? true : despesa ? real <= (prev || 0) : real >= (prev || 0)
  return (
    <div style={S.kpi}>
      <div style={S.lbl}>{label}</div>
      <div style={S.val}>{fmt(real)}</div>
      <div style={S.ksub}>Orçado {fmt(orc)} · {exec == null ? '—' : <span style={{ color: bom ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{bom ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{exec.toFixed(0)}%</span>}</div>
      <div style={{ ...S.ksub, marginTop: 2 }}>Δ (R−O) <strong style={{ color: d >= 0 ? '#2f9e44' : '#e03131' }}>{d >= 0 ? '+' : ''}{fmt(d)}</strong></div>
      {prev != null && (
        <div style={{ ...S.ksub, marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f3f5' }}>
          <strong style={{ color: '#495057' }}>{anoPrev}</strong> {fmt(prev)} · {yoy == null ? '—' :<span style={{ color: bomY ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{real >= (prev || 0) ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{yoy >= 0 ? '+' : ''}{yoy.toFixed(0)}%</span>}
        </div>
      )}
    </div>
  )
}

const SAVE = 'planorc_exec_filtro'
const loadSaved = (): any => { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function ExecutivoPage() {
  const sv = loadSaved()
  const [rels, setRels] = useState<Rel[]>([]); const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([]); const [filiais, setFiliais] = useState<Item[]>([]); const [ccs, setCcs] = useState<CC[]>([])
  const [relId, setRelId] = useState(''); const [versaoId, setVersaoId] = useState(''); const [ano, setAno] = useState<number>(sv.ano || 2026); const [ateMes, setAteMes] = useState<number>(sv.ateMes || ULT_FECHADO)
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [areaSel, setAreaSel] = useState<string[]>(Array.isArray(sv.areaSel) ? sv.areaSel : [])
  const [divisaoSel, setDivisaoSel] = useState<string[]>(Array.isArray(sv.divisaoSel) ? sv.divisaoSel : [])
  const [buSel, setBuSel] = useState<string[]>(Array.isArray(sv.buSel) ? sv.buSel : [])
  const [k, setK] = useState<{ rec: number[]; desp: number[]; eb: number[]; res: number[]; prev: { rec: number; desp: number; eb: number; res: number }; anoPrev: number } | null>(null)
  const [loading, setLoading] = useState(false); const [erro, setErro] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const { cardId, nome: cardNome } = useCardPreset('/dashboards/executivo', (f) => {
    if (f.relId !== undefined) setRelId(f.relId); if (f.versaoId !== undefined) setVersaoId(f.versaoId)
    if (typeof f.ano === 'number') setAno(f.ano); if (typeof f.ateMes === 'number') setAteMes(f.ateMes)
    if (Array.isArray(f.empresaSel)) setEmpresaSel(f.empresaSel); if (Array.isArray(f.filialSel)) setFilialSel(f.filialSel); if (Array.isArray(f.ccSel)) setCcSel(f.ccSel)
    if (Array.isArray(f.areaSel)) setAreaSel(f.areaSel); if (Array.isArray(f.divisaoSel)) setDivisaoSel(f.divisaoSel); if (Array.isArray(f.buSel)) setBuSel(f.buSel)
  })

  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('codigo').then(r => { setRels(r.data || []); if (r.data?.length) setRelId(p => p || sv.relId || r.data![0].id) })
    supabase.from('versao_orcamento').select('id,codigo').order('codigo').then(r => { setVersoes(r.data || []); if (r.data?.length) setVersaoId(p => p || sv.versaoId || r.data![0].id) })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').order('codigo').then(r => setCcs(r.data || []))
  }, [])
  useEffect(() => { if (cardId) return; localStorage.setItem(SAVE, JSON.stringify({ relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, ano, ateMes })) }, [cardId, relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, ano, ateMes])

  const load = async () => {
    if (!relId || !versaoId) return
    const myseq = ++loadSeq.current
    setLoading(true); setErro(null)
    try {
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao,nao_soma').eq('relatorio_id', relId)
      const linhas = (linhasRaw || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const rlOfMaster: Record<string, string> = {}; linhas.forEach(l => { if (l.linha_orc_id) rlOfMaster[l.linha_orc_id] = l.id })
      const disabled = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabled.add(l.linha_orc_id) })
      const linhasCalc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
      const natCache: Record<string, string | null> = {}
      const natOf = (id: string | null): string | null => { if (!id) return null; if (id in natCache) return natCache[id]; const l = byId[id]; if (!l) return null; const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id); natCache[id] = n; return n }
      const empIds = empresaSel.length ? empresaSel : empresas.map(e => e.id)
      const filFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
      const ccFilter = effectiveCcFilter(ccs, ccSel, areaSel, divisaoSel, buSel)
      const meses = Array.from({ length: ateMes }, (_, i) => i + 1)
      if (!masterIds.length || !empIds.length) { setK(null); setLoading(false); return }

      const anoPrev = ano - 1
      const [orcR, realR, realRprev] = await Promise.all([
        supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: [ano], p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: [ano], p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: [anoPrev], p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
      ])
      if (orcR.error) throw new Error(orcR.error.message); if (realR.error) throw new Error(realR.error.message); if (realRprev.error) throw new Error(realRprev.error.message)
      const periodos: Periodo[] = meses.map(m => ({ ano, mes: m }))
      const periodosPrev: Periodo[] = meses.map(m => ({ ano: anoPrev, mes: m }))
      const rawOrc: RawValues = {}, rawReal: RawValues = {}, rawRealPrev: RawValues = {}
      for (const r of orcR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabled.has(r.linha_id)) continue; (rawOrc[rl] = rawOrc[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: r.expr ?? null } }
      for (const r of realR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabled.has(r.linha_id)) continue; (rawReal[rl] = rawReal[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      for (const r of realRprev.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabled.has(r.linha_id)) continue; (rawRealPrev[rl] = rawRealPrev[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const cO = computeCenario(linhasCalc, rawOrc, periodos), cR = computeCenario(linhasCalc, rawReal, periodos), cRp = computeCenario(linhasCalc, rawRealPrev, periodosPrev)
      const tO = computeTotais(linhasCalc, cO, periodos), tR = computeTotais(linhasCalc, cR, periodos), tRp = computeTotais(linhasCalc, cRp, periodosPrev)
      const leaves = linhas.filter(l => l.tipo_linha === 'ANALITICA' && !l.desativada && l.linha_orc_id && !l.nao_soma)
      let recO = 0, recR = 0, despO = 0, despR = 0, recRp = 0, despRp = 0
      for (const l of leaves) { const n = natOf(l.id); if (n === 'RECEITA') { recO += tO[l.id] || 0; recR += tR[l.id] || 0; recRp += tRp[l.id] || 0 } else if (n === 'DESPESA') { despO += tO[l.id] || 0; despR += tR[l.id] || 0; despRp += tRp[l.id] || 0 } }
      const ebN = linhas.find(l => norm(l.descricao).includes('ebitda'))
      const resN = linhas.find(l => norm(l.descricao).includes('resultado liquido'))
      const eb = ebN ? [tO[ebN.id] || 0, tR[ebN.id] || 0] : [0, 0]
      const res = resN ? [tO[resN.id] || 0, tR[resN.id] || 0] : [leaves.reduce((s, l) => s + (tO[l.id] || 0), 0), leaves.reduce((s, l) => s + (tR[l.id] || 0), 0)]
      const ebPrev = ebN ? (tRp[ebN.id] || 0) : 0
      const resPrev = resN ? (tRp[resN.id] || 0) : leaves.reduce((s, l) => s + (tRp[l.id] || 0), 0)
      if (myseq !== loadSeq.current) return
      setK({ rec: [recO, recR], desp: [-despO, -despR], eb, res, prev: { rec: recRp, desp: -despRp, eb: ebPrev, res: resPrev }, anoPrev })
    } catch (e: any) { if (myseq === loadSeq.current) setErro(e?.message ?? String(e)) }
    if (myseq === loadSeq.current) setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, ano, ateMes, empresas, filiais, ccs]) // eslint-disable-line

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>Visão executiva{cardNome && <span style={{ color: '#e8590c' }}> · {cardNome}</span>}</h1>
      </div>
      <p style={S.sub}>KPIs consolidados Jan–{MESES[ateMes - 1]}/{ano} — orçado × realizado nos mesmos meses, % de execução e variação vs. {ano - 1} (mesmos meses). Despesas exibidas como positivas.</p>

      <div style={S.bar}>
        <select style={S.sel} value={relId} onChange={e => setRelId(e.target.value)}>{rels.map(r => <option key={r.id} value={r.id}>{r.codigo} · {r.nome}</option>)}</select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>{versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}</select>
        <PeriodoButton width="min(420px, calc(100vw - 40px))" resumo={`${ano} · até ${MESES[ateMes - 1]}`}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#495057', display: 'block', marginBottom: 6 }}>Ano</label>
          <select style={{ ...S.sel, marginBottom: 14 }} value={ano} onChange={e => setAno(+e.target.value)}>{[2022, 2023, 2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}</select>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#495057', display: 'block', marginBottom: 6 }}>Acumulado até o mês (realizado × orçado na mesma base)</label>
          <select style={S.sel} value={ateMes} onChange={e => setAteMes(+e.target.value)}>{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        </PeriodoButton>
        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        <button style={S.btn} onClick={load}><RefreshCw size={13} /></button>
        <SalvarCardButton base="/dashboards/executivo" cor="#e8590c" cardId={cardId} getFiltros={() => ({ relId, versaoId, ano, ateMes, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel })} />
      </div>

      {erro && <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', color: '#c92a2a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {loading && <div style={S.sub}>Carregando…</div>}
      {!loading && !k && <div style={S.empty}>Selecione um relatório com dados.</div>}
      {!loading && k && (
        <div style={S.kpis}>
          <Kpi label="Receita" real={k.rec[1]} orc={k.rec[0]} prev={k.prev.rec} anoPrev={k.anoPrev} />
          <Kpi label="Despesa" real={k.desp[1]} orc={k.desp[0]} despesa prev={k.prev.desp} anoPrev={k.anoPrev} />
          <Kpi label="EBITDA" real={k.eb[1]} orc={k.eb[0]} prev={k.prev.eb} anoPrev={k.anoPrev} />
          <Kpi label="Resultado líquido" real={k.res[1]} orc={k.res[0]} prev={k.prev.res} anoPrev={k.anoPrev} />
        </div>
      )}
    </div>
  )
}
