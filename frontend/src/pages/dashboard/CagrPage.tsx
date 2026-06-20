import { useEffect, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { computeTotais, pkey } from '../../lib/engine'
import type { LinhaCalc, Computed, Periodo } from '../../lib/engine'
import { ResponsiveBar } from '@nivo/bar'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { FiltrosButton } from './DashFiltros'
import type { Item } from './DashFiltros'

const ANOS = [2022, 2023, 2024, 2025, 2026, 2027, 2028]
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ULT_FECHADO = new Date().getMonth() === 0 ? 12 : new Date().getMonth()
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

type Rel = { id: string; codigo: string; nome: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null }

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:   { fontSize: 13, color: '#868e96', margin: '4px 0 16px' },
  bar:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  sel:   { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  btn:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  card:  { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardT: { fontSize: 14, fontWeight: 600, color: '#212529', marginBottom: 10 },
  chart: { height: 360 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'right', padding: '8px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  thL:   { textAlign: 'left', padding: '8px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td:    { textAlign: 'right', padding: '6px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', whiteSpace: 'nowrap' },
  tdL:   { textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40' },
  empty: { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: '#aaa', fontSize: 14 },
  pick:  { maxHeight: 230, overflow: 'auto', border: '1px solid #e9ecef', borderRadius: 8, padding: 8 },
}

const SAVE = 'planorc_cagr_filtro'
const loadSaved = (): any => { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function CagrPage() {
  const sv = useRef(loadSaved()).current  // captura UMA vez (o efeito de persist sobrescreve o localStorage logo na montagem)
  const [rels, setRels] = useState<Rel[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([])
  const [filiais, setFiliais] = useState<Item[]>([])
  const [ccs, setCcs] = useState<Item[]>([])
  const [relId, setRelId] = useState('')
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [anoIni, setAnoIni] = useState<number>(sv.anoIni || 2024); const [anoFim, setAnoFim] = useState<number>(sv.anoFim || 2026)
  const [ateMes, setAteMes] = useState<number>(sv.ateMes || ULT_FECHADO)
  const [linhasOpt, setLinhasOpt] = useState<{ id: string; desc: string; tipo: any }[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [res, setRes] = useState<{ id: string; desc: string; vi: number; vf: number; cagr: number | null }[]>([])
  const [loading, setLoading] = useState(false); const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('codigo').then(r => { setRels(r.data || []); if (r.data?.length) setRelId(p => p || sv.relId || r.data![0].id) })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao').order('codigo').then(r => setCcs(r.data || []))
  }, [])
  useEffect(() => { localStorage.setItem(SAVE, JSON.stringify({ relId, empresaSel, filialSel, ccSel, anoIni, anoFim, ateMes, sel })) }, [relId, empresaSel, filialSel, ccSel, anoIni, anoFim, ateMes, sel])

  // carrega as linhas do relatório p/ o seletor
  useEffect(() => {
    if (!relId) return
    supabase.from('relatorio_linha').select('id,tipo_linha,descricao,ordem,pai_id').eq('relatorio_id', relId).then(r => {
      const ls = (r.data || []).filter((l: any) => l.tipo_linha !== 'ESPACO')
      const opts = ls.map((l: any) => ({ id: l.id, desc: l.descricao, tipo: l.tipo_linha }))
      setLinhasOpt(opts)
      const ids = new Set(opts.map((o: any) => o.id))
      // restaura seleção salva (se for o mesmo relatório); senão, default = linhas-resumo
      if (sv.relId === relId && Array.isArray(sv.sel) && sv.sel.some((id: string) => ids.has(id))) {
        setSel(sv.sel.filter((id: string) => ids.has(id)))
      } else {
        setSel(opts.filter((o: any) => ['FORMULA', 'SUBTOTAL', 'TOTAL'].includes(o.tipo)).slice(0, 8).map((o: any) => o.id))
      }
    })
  }, [relId]) // eslint-disable-line

  const load = async () => {
    if (!relId || anoFim <= anoIni) { setRes([]); return }
    setLoading(true); setErro(null)
    try {
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao,ordem').eq('relatorio_id', relId)
      const linhas = (linhasRaw || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const rlOfMaster: Record<string, string> = {}; linhas.forEach(l => { if (l.linha_orc_id) rlOfMaster[l.linha_orc_id] = l.id })
      const disabled = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabled.add(l.linha_orc_id) })
      const linhasCalc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada }))
      const natCache: Record<string, string | null> = {}
      const natOf = (id: string | null): string | null => { if (!id) return null; if (id in natCache) return natCache[id]; const l = byId[id]; if (!l) return null; const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id); natCache[id] = n; return n }
      const facOf = (id: string) => natOf(id) === 'DESPESA' ? -1 : 1

      const empIds = empresaSel.length ? empresaSel : empresas.map(e => e.id)
      const filFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
      const ccFilter = (ccSel.length > 0 && ccSel.length < ccs.length) ? ccSel : null
      const anos = [anoIni, anoFim]
      if (!masterIds.length || !empIds.length) { setRes([]); setLoading(false); return }
      const meses = Array.from({ length: ateMes }, (_, i) => i + 1)
      const r = await supabase.rpc('relatorio_realizado_anual', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter })
      if (r.error) throw new Error(r.error.message)
      const valYM: Record<number, Record<string, number>> = {}
      for (const x of r.data || []) { (valYM[x.ano] = valYM[x.ano] || {})[x.linha_id] = Number(x.valor) || 0 }

      const SP: Periodo = { ano: 0, mes: 1 }; const K = pkey(SP)
      const totFor = (y: number) => {
        const computed: Computed = {}; linhasCalc.forEach(l => { computed[l.id] = {} })
        for (const m of masterIds) { const rl = rlOfMaster[m]; if (rl && !disabled.has(m)) computed[rl][K] = (valYM[y]?.[m]) || 0 }
        return computeTotais(linhasCalc, computed, [SP])
      }
      const ti = totFor(anoIni), tf = totFor(anoFim)
      const n = anoFim - anoIni
      const out = sel.map(id => {
        const f = facOf(id)
        const vi = f * (ti[id] || 0), vf = f * (tf[id] || 0)
        const cagr = (vi > 0 && vf > 0) ? (Math.pow(vf / vi, 1 / n) - 1) * 100 : null
        return { id, desc: byId[id]?.descricao || '—', vi, vf, cagr }
      })
      setRes(out)
    } catch (e: any) { setErro(e?.message ?? String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [relId, empresaSel, filialSel, ccSel, anoIni, anoFim, ateMes, sel, empresas, filiais, ccs]) // eslint-disable-line

  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const chartData = res.filter(x => x.cagr != null).sort((a, b) => (a.cagr || 0) - (b.cagr || 0)).map(x => ({ linha: cut(x.desc, 28), CAGR: +(x.cagr || 0).toFixed(1) }))

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>CAGR — crescimento anual composto</h1>
      </div>
      <p style={S.sub}>CAGR = (valor final / valor inicial) ^ (1/anos) − 1. Sobre o realizado (cubo anual). Despesas como positivas.</p>

      <div style={S.bar}>
        <select style={S.sel} value={relId} onChange={e => setRelId(e.target.value)}>{rels.map(r => <option key={r.id} value={r.id}>{r.codigo} · {r.nome}</option>)}</select>
        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} />
        <span style={{ fontSize: 13, color: '#868e96' }}>de</span>
        <select style={S.sel} value={anoIni} onChange={e => setAnoIni(+e.target.value)}>{ANOS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <span style={{ fontSize: 13, color: '#868e96' }}>até</span>
        <select style={S.sel} value={anoFim} onChange={e => setAnoFim(+e.target.value)}>{ANOS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <span style={{ fontSize: 13, color: '#868e96' }}>acum. até</span>
        <select style={S.sel} value={ateMes} onChange={e => setAteMes(+e.target.value)} title="Compara os mesmos meses (1 até este) nos dois anos">{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        <button style={S.btn} onClick={load}><RefreshCw size={13} /></button>
      </div>

      {erro && <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', color: '#c92a2a', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>{erro}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 16, alignItems: 'start' }}>
        <div style={S.card}>
          <div style={S.cardT}>Linhas ({sel.length})</div>
          <div style={S.pick}>
            {linhasOpt.map(o => (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 2px', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} /> {cut(o.desc, 34)}
              </label>
            ))}
          </div>
        </div>

        <div>
          {anoFim <= anoIni && <div style={{ ...S.empty, marginBottom: 16 }}>O ano final precisa ser maior que o inicial.</div>}
          {loading && <div style={S.sub}>Calculando…</div>}
          {!loading && !!res.length && (
            <>
              <div style={S.card}>
                <div style={S.cardT}>CAGR por linha ({anoIni}→{anoFim})</div>
                <div style={S.chart}>
                  <ResponsiveBar data={chartData} keys={['CAGR']} indexBy="linha" layout="horizontal" margin={{ top: 6, right: 50, bottom: 30, left: 170 }}
                    padding={0.3} colors={({ data }: any) => data.CAGR >= 0 ? '#2f9e44' : '#e03131'} enableGridX
                    valueFormat={(v: any) => `${v}%`} axisBottom={{ format: (v: any) => `${v}%` }}
                    label={(d: any) => `${d.value}%`} labelSkipWidth={9999}
                    tooltip={({ indexValue, value }: any) => <div style={{ background: 'white', padding: '6px 10px', border: '1px solid #e9ecef', borderRadius: 6, fontSize: 12 }}>{indexValue}: <strong>{value}%</strong></div>} />
                </div>
              </div>
              <div style={{ ...S.card, padding: 0, overflow: 'auto' }}>
                <table style={S.table}>
                  <thead><tr><th style={S.thL}>Linha</th><th style={S.th}>{anoIni}</th><th style={S.th}>{anoFim}</th><th style={S.th}>CAGR</th></tr></thead>
                  <tbody>
                    {res.map(x => (
                      <tr key={x.id}>
                        <td style={S.tdL}>{x.desc}</td>
                        <td style={S.td}>{x.vi ? fmt(x.vi) : '—'}</td>
                        <td style={S.td}>{x.vf ? fmt(x.vf) : '—'}</td>
                        <td style={{ ...S.td, fontWeight: 600, color: x.cagr == null ? '#adb5bd' : x.cagr >= 0 ? '#2f9e44' : '#e03131' }}>{x.cagr == null ? '—' : `${x.cagr >= 0 ? '+' : ''}${x.cagr.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
