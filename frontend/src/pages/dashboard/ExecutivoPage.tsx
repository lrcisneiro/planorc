import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { computeCenario, computeTotais } from '../../lib/engine'
import type { LinhaCalc, RawValues, Periodo } from '../../lib/engine'
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { FiltrosButton } from './DashFiltros'
import type { Item } from './DashFiltros'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ULT_FECHADO = new Date().getMonth() === 0 ? 12 : new Date().getMonth()
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string }

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

function Kpi({ label, real, orc, despesa }: { label: string; real: number; orc: number; despesa?: boolean }) {
  const exec = orc !== 0 ? (real / orc) * 100 : null
  // p/ despesa, executar acima do orçado é ruim → cor invertida
  const bom = exec == null ? true : despesa ? exec <= 100 : exec >= 100
  const d = real - orc
  return (
    <div style={S.kpi}>
      <div style={S.lbl}>{label}</div>
      <div style={S.val}>{fmt(real)}</div>
      <div style={S.ksub}>Orçado {fmt(orc)} · {exec == null ? '—' : <span style={{ color: bom ? '#2f9e44' : '#e03131', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{bom ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{exec.toFixed(0)}%</span>}</div>
      <div style={{ ...S.ksub, marginTop: 2 }}>Δ (R−O) <strong style={{ color: d >= 0 ? '#2f9e44' : '#e03131' }}>{d >= 0 ? '+' : ''}{fmt(d)}</strong></div>
    </div>
  )
}

const SAVE = 'planorc_exec_filtro'
const loadSaved = (): any => { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function ExecutivoPage() {
  const sv = loadSaved()
  const [rels, setRels] = useState<Rel[]>([]); const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([]); const [filiais, setFiliais] = useState<Item[]>([]); const [ccs, setCcs] = useState<Item[]>([])
  const [relId, setRelId] = useState(''); const [versaoId, setVersaoId] = useState(''); const [ano, setAno] = useState<number>(sv.ano || 2026); const [ateMes, setAteMes] = useState<number>(sv.ateMes || ULT_FECHADO)
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [k, setK] = useState<{ rec: number[]; desp: number[]; eb: number[]; res: number[] } | null>(null)
  const [loading, setLoading] = useState(false); const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('codigo').then(r => { setRels(r.data || []); if (r.data?.length) setRelId(p => p || sv.relId || r.data![0].id) })
    supabase.from('versao_orcamento').select('id,codigo').order('codigo').then(r => { setVersoes(r.data || []); if (r.data?.length) setVersaoId(p => p || sv.versaoId || r.data![0].id) })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao').order('codigo').then(r => setCcs(r.data || []))
  }, [])
  useEffect(() => { localStorage.setItem(SAVE, JSON.stringify({ relId, versaoId, empresaSel, filialSel, ccSel, ano, ateMes })) }, [relId, versaoId, empresaSel, filialSel, ccSel, ano, ateMes])

  const load = async () => {
    if (!relId || !versaoId) return
    setLoading(true); setErro(null)
    try {
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao').eq('relatorio_id', relId)
      const linhas = (linhasRaw || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const rlOfMaster: Record<string, string> = {}; linhas.forEach(l => { if (l.linha_orc_id) rlOfMaster[l.linha_orc_id] = l.id })
      const disabled = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabled.add(l.linha_orc_id) })
      const linhasCalc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada }))
      const natCache: Record<string, string | null> = {}
      const natOf = (id: string | null): string | null => { if (!id) return null; if (id in natCache) return natCache[id]; const l = byId[id]; if (!l) return null; const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id); natCache[id] = n; return n }
      const empIds = empresaSel.length ? empresaSel : empresas.map(e => e.id)
      const filFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
      const ccFilter = (ccSel.length > 0 && ccSel.length < ccs.length) ? ccSel : null
      const meses = Array.from({ length: ateMes }, (_, i) => i + 1)
      if (!masterIds.length || !empIds.length) { setK(null); setLoading(false); return }

      const [orcR, realR] = await Promise.all([
        supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: [ano], p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: [ano], p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
      ])
      if (orcR.error) throw new Error(orcR.error.message); if (realR.error) throw new Error(realR.error.message)
      const periodos: Periodo[] = meses.map(m => ({ ano, mes: m }))
      const rawOrc: RawValues = {}, rawReal: RawValues = {}
      for (const r of orcR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabled.has(r.linha_id)) continue; (rawOrc[rl] = rawOrc[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: r.expr ?? null } }
      for (const r of realR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabled.has(r.linha_id)) continue; (rawReal[rl] = rawReal[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const cO = computeCenario(linhasCalc, rawOrc, periodos), cR = computeCenario(linhasCalc, rawReal, periodos)
      const tO = computeTotais(linhasCalc, cO, periodos), tR = computeTotais(linhasCalc, cR, periodos)
      const leaves = linhas.filter(l => l.tipo_linha === 'ANALITICA' && !l.desativada && l.linha_orc_id)
      let recO = 0, recR = 0, despO = 0, despR = 0
      for (const l of leaves) { const n = natOf(l.id); if (n === 'RECEITA') { recO += tO[l.id] || 0; recR += tR[l.id] || 0 } else if (n === 'DESPESA') { despO += tO[l.id] || 0; despR += tR[l.id] || 0 } }
      const ebN = linhas.find(l => norm(l.descricao).includes('ebitda'))
      const resN = linhas.find(l => norm(l.descricao).includes('resultado liquido'))
      const eb = ebN ? [tO[ebN.id] || 0, tR[ebN.id] || 0] : [0, 0]
      const res = resN ? [tO[resN.id] || 0, tR[resN.id] || 0] : [leaves.reduce((s, l) => s + (tO[l.id] || 0), 0), leaves.reduce((s, l) => s + (tR[l.id] || 0), 0)]
      setK({ rec: [recO, recR], desp: [-despO, -despR], eb, res })
    } catch (e: any) { setErro(e?.message ?? String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, empresaSel, filialSel, ccSel, ano, ateMes, empresas, filiais, ccs]) // eslint-disable-line

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>Visão executiva</h1>
      </div>
      <p style={S.sub}>KPIs consolidados Jan–{MESES[ateMes - 1]}/{ano} — orçado × realizado nos mesmos meses e % de execução. Despesas exibidas como positivas.</p>

      <div style={S.bar}>
        <select style={S.sel} value={relId} onChange={e => setRelId(e.target.value)}>{rels.map(r => <option key={r.id} value={r.id}>{r.codigo} · {r.nome}</option>)}</select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>{versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}</select>
        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} />
        <select style={S.sel} value={ano} onChange={e => setAno(+e.target.value)}>{[2022, 2023, 2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}</select>
        <span style={{ fontSize: 13, color: '#868e96' }}>acum. até</span>
        <select style={S.sel} value={ateMes} onChange={e => setAteMes(+e.target.value)} title="Realizado e orçado nos mesmos meses (base justa de execução)">{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        <button style={S.btn} onClick={load}><RefreshCw size={13} /></button>
      </div>

      {erro && <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', color: '#c92a2a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {loading && <div style={S.sub}>Carregando…</div>}
      {!loading && !k && <div style={S.empty}>Selecione um relatório com dados.</div>}
      {!loading && k && (
        <div style={S.kpis}>
          <Kpi label="Receita" real={k.rec[1]} orc={k.rec[0]} />
          <Kpi label="Despesa" real={k.desp[1]} orc={k.desp[0]} despesa />
          <Kpi label="EBITDA" real={k.eb[1]} orc={k.eb[0]} />
          <Kpi label="Resultado líquido" real={k.res[1]} orc={k.res[0]} />
        </div>
      )}
    </div>
  )
}
