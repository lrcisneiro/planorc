import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { computeTotais, pkey } from '../../lib/engine'
import type { LinhaCalc, Computed, Periodo } from '../../lib/engine'
import { ResponsiveBar } from '@nivo/bar'
import { nivoTheme } from '../../lib/nivoTheme'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { FiltrosButton, PeriodoButton, effectiveCcFilter, SalvarCardButton, useCardPreset } from './DashFiltros'
import type { Item, CC } from './DashFiltros'

const ANOS = [2022, 2023, 2024, 2025, 2026, 2027, 2028]
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ULT_FECHADO = new Date().getMonth() === 0 ? 12 : new Date().getMonth() // mês anterior ao atual (1-based)
const YCOLORS = ['#3b5bdb', '#f59f00', '#2f9e44', '#e8590c', '#7048e8', '#1098ad']
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null; nao_soma?: boolean }

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 16px' },
  bar:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  sel:   { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', color: 'var(--text-mid)' },
  btn:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  card:  { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardT: { fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  chart: { height: 340, background: 'var(--chart-bg)', borderRadius: 10, padding: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'right', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  thL:   { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)', position: 'sticky', left: 0 },
  td:    { textAlign: 'right', padding: '6px 12px', borderBottom: '1px solid var(--panel)', color: 'var(--text)', whiteSpace: 'nowrap' },
  tdL:   { textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid var(--panel)', color: 'var(--text)', position: 'sticky', left: 0, background: 'var(--panel)' },
  empty: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 },
}
const ybtn = (on: boolean): CSSProperties => ({ padding: '5px 11px', fontSize: 13, borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (on ? '#3b5bdb' : 'var(--border-strong)'), background: on ? '#3b5bdb' : 'white', color: on ? 'white' : 'var(--text-mid)' })

const SAVE = 'planorc_anual_filtro'
const loadSaved = (): any => { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function ComparativoAnualPage() {
  const sv = loadSaved()
  const [rels, setRels] = useState<Rel[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([])
  const [filiais, setFiliais] = useState<Item[]>([])
  const [ccs, setCcs] = useState<CC[]>([])
  const [relId, setRelId] = useState(''); const [versaoId, setVersaoId] = useState('')
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [areaSel, setAreaSel] = useState<string[]>(Array.isArray(sv.areaSel) ? sv.areaSel : [])
  const [divisaoSel, setDivisaoSel] = useState<string[]>(Array.isArray(sv.divisaoSel) ? sv.divisaoSel : [])
  const [buSel, setBuSel] = useState<string[]>(Array.isArray(sv.buSel) ? sv.buSel : [])
  const [anosSel, setAnosSel] = useState<number[]>(Array.isArray(sv.anosSel) && sv.anosSel.length ? sv.anosSel : [2024, 2025, 2026])
  const [ateMes, setAteMes] = useState<number>(sv.ateMes || ULT_FECHADO)
  const [medida, setMedida] = useState<'Realizado' | 'Orçado'>(sv.medida || 'Realizado')
  const [ocultarVazias, setOcultarVazias] = useState<boolean>(sv.ocultarVazias ?? true)
  const [rows, setRows] = useState<{ id: string; depth: number; desc: string; tipo: any; vals: Record<number, number>; cagr: number | null }[]>([])
  const [chartLine, setChartLine] = useState('')
  const [loading, setLoading] = useState(false); const [erro, setErro] = useState<string | null>(null); const [temDados, setTemDados] = useState(true)

  const { cardId, nome: cardNome } = useCardPreset('/dashboards/anual', (f) => {
    if (f.relId !== undefined) setRelId(f.relId); if (f.versaoId !== undefined) setVersaoId(f.versaoId)
    if (Array.isArray(f.anosSel)) setAnosSel(f.anosSel); if (typeof f.ateMes === 'number') setAteMes(f.ateMes); if (f.medida) setMedida(f.medida)
    if (typeof f.ocultarVazias === 'boolean') setOcultarVazias(f.ocultarVazias)
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
  useEffect(() => { if (cardId) return; localStorage.setItem(SAVE, JSON.stringify({ relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, anosSel, ateMes, medida, ocultarVazias })) }, [cardId, relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, anosSel, ateMes, medida, ocultarVazias])

  const load = async () => {
    if (!relId || !versaoId) return
    setLoading(true); setErro(null)
    try {
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao,ordem,nao_soma').eq('relatorio_id', relId)
      const linhas = (linhasRaw || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const childrenByPai: Record<string, RL[]> = {}
      linhas.forEach(l => { const k = l.pai_id || '__root'; (childrenByPai[k] = childrenByPai[k] || []).push(l) })
      Object.values(childrenByPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const rlOfMaster: Record<string, string> = {}; linhas.forEach(l => { if (l.linha_orc_id) rlOfMaster[l.linha_orc_id] = l.id })
      const disabled = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabled.add(l.linha_orc_id) })
      const linhasCalc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
      // natureza efetiva (herda do ancestral) p/ exibir despesa positiva
      const natCache: Record<string, string | null> = {}
      const natOf = (id: string | null): string | null => { if (!id) return null; if (id in natCache) return natCache[id]; const l = byId[id]; if (!l) return null; const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id); natCache[id] = n; return n }
      const facOf = (id: string) => natOf(id) === 'DESPESA' ? -1 : 1

      const anos = [...anosSel].sort((a, b) => a - b)
      const empIds = empresaSel.length ? empresaSel : empresas.map(e => e.id)
      const filFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
      const ccFilter = effectiveCcFilter(ccs, ccSel, areaSel, divisaoSel, buSel)
      if (!masterIds.length || !empIds.length || !anos.length) { setRows([]); setTemDados(false); setLoading(false); return }

      const meses = Array.from({ length: ateMes }, (_, i) => i + 1)
      const [realR, orcR] = await Promise.all([
        supabase.rpc('relatorio_realizado_anual', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_orcado_anual', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
      ])
      if (realR.error) throw new Error(realR.error.message)
      if (orcR.error) throw new Error(orcR.error.message)
      const src = medida === 'Realizado' ? realR.data : orcR.data
      // valor por master por ano
      const valYM: Record<number, Record<string, number>> = {}
      for (const r of src || []) { (valYM[r.ano] = valYM[r.ano] || {})[r.linha_id] = Number(r.valor) || 0 }

      // engine por ano (1 período) → totais por linha (inclui subtotais/fórmulas)
      const SP: Periodo = { ano: 0, mes: 1 }; const K = pkey(SP)
      const totByYear: Record<number, Record<string, number>> = {}
      for (const y of anos) {
        const computed: Computed = {}; linhasCalc.forEach(l => { computed[l.id] = {} })
        for (const m of masterIds) { const rl = rlOfMaster[m]; if (rl && !disabled.has(m)) computed[rl][K] = (valYM[y]?.[m]) || 0 }
        totByYear[y] = computeTotais(linhasCalc, computed, [SP])
      }

      // monta linhas em ordem hierárquica
      const out: { id: string; depth: number; desc: string; tipo: any; vals: Record<number, number>; cagr: number | null }[] = []
      const walk = (paiKey: string, depth: number) => {
        for (const c of (childrenByPai[paiKey] || [])) {
          if (c.tipo_linha !== 'ESPACO' && !c.nao_soma) {
            const f = facOf(c.id)
            const vals: Record<number, number> = {}
            anos.forEach(y => { vals[y] = f * (totByYear[y]?.[c.id] || 0) })
            const v0 = vals[anos[0]], vN = vals[anos[anos.length - 1]], n = anos.length - 1
            const cagr = (n > 0 && v0 > 0 && vN > 0) ? (Math.pow(vN / v0, 1 / n) - 1) * 100 : null
            const algum = anos.some(y => Math.abs(vals[y]) > 0.005)
            if (!ocultarVazias || algum) out.push({ id: c.id, depth, desc: c.descricao, tipo: c.tipo_linha, vals, cagr })
          }
          walk(c.id, depth + 1)
        }
      }
      walk('__root', 0)
      setRows(out)
      if (!out.find(r => r.id === chartLine)) setChartLine(out.find(r => r.tipo === 'FORMULA' || r.tipo === 'SUBTOTAL')?.id || out[0]?.id || '')
      setTemDados(out.length > 0)
    } catch (e: any) { setErro(e?.message ?? String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, anosSel, ateMes, medida, ocultarVazias, empresas, filiais, ccs]) // eslint-disable-line

  const anos = [...anosSel].sort((a, b) => a - b)
  const toggleAno = (y: number) => setAnosSel(s => s.includes(y) ? s.filter(x => x !== y) : [...s, y])
  const chartRow = rows.find(r => r.id === chartLine)
  const chartData = chartRow ? anos.map((y, i) => { const v = Math.round(chartRow.vals[y] || 0); const pv = i > 0 ? Math.round(chartRow.vals[anos[i - 1]] || 0) : null; return { ano: String(y), valor: v, delta: pv == null ? null : v - pv, deltaPct: pv ? ((v - pv) / Math.abs(pv)) * 100 : null } }) : []
  const isBold = (t: any) => t === 'SUBTOTAL' || t === 'FORMULA' || t === 'TOTAL'

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>DRE — Comparativo anual{cardNome && <span style={{ color: '#2f9e44' }}> · {cardNome}</span>}</h1>
      </div>
      <p style={S.sub}>Vários anos em base equivalente: compara os meses <strong>Jan–{MESES[ateMes - 1]}</strong> em todos os anos. Despesas exibidas como positivas.</p>

      <div style={S.bar}>
        <select style={S.sel} value={relId} onChange={e => setRelId(e.target.value)}>{rels.map(r => <option key={r.id} value={r.id}>{r.codigo} · {r.nome}</option>)}</select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>{versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}</select>
        <PeriodoButton resumo={`${[...anosSel].sort((a, b) => a - b).join(', ') || '—'} · até ${MESES[ateMes - 1]}`}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', display: 'block', marginBottom: 6 }}>Anos a comparar</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {ANOS.map(y => <button key={y} style={ybtn(anosSel.includes(y))} onClick={() => toggleAno(y)}>{y}</button>)}
          </div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', display: 'block', marginBottom: 6 }}>Acumulado até o mês (base equivalente em todos os anos)</label>
          <select style={S.sel} value={ateMes} onChange={e => setAteMes(+e.target.value)}>{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        </PeriodoButton>
        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        <select style={S.sel} value={medida} onChange={e => setMedida(e.target.value as any)}><option>Realizado</option><option>Orçado</option></select>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={ocultarVazias} onChange={e => setOcultarVazias(e.target.checked)} /> ocultar vazias</label>
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <SalvarCardButton base="/dashboards/anual" cor="#2f9e44" cardId={cardId} getFiltros={() => ({ relId, versaoId, anosSel, ateMes, medida, ocultarVazias, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel })} />
      </div>

      {erro && <div style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid #ffc9c9', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {loading && <div style={S.sub}>Carregando…</div>}
      {!loading && !temDados && <div style={S.empty}>Sem dados para os anos/filtros selecionados.</div>}

      {!loading && temDados && (
        <>
          <div style={S.card}>
            <div style={S.cardT}>
              Evolução por ano
              <div style={{ flex: 1 }} />
              <select style={S.sel} value={chartLine} onChange={e => setChartLine(e.target.value)}>
                {rows.map(r => <option key={r.id} value={r.id}>{' '.repeat(r.depth * 2)}{cut(r.desc, 40)}</option>)}
              </select>
            </div>
            <div style={S.chart}>
              <ResponsiveBar theme={nivoTheme()} data={chartData as any} keys={['valor']} indexBy="ano" margin={{ top: 10, right: 20, bottom: 40, left: 70 }}
                padding={0.35} colors={YCOLORS[0]} enableLabel={false} axisLeft={{ format: (v: any) => fmt(v) }}
                valueFormat={(v: any) => fmt(v)} tooltip={({ indexValue, value, data }: any) => <div style={{ background: 'var(--panel)', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}><strong>{indexValue}</strong>: {fmt(value)}{data.delta != null && <div style={{ color: data.delta >= 0 ? '#2f9e44' : '#e03131', marginTop: 2 }}>Δ vs ano anterior: {data.delta >= 0 ? '+' : ''}{fmt(data.delta)}{data.deltaPct != null ? ` (${data.deltaPct >= 0 ? '+' : ''}${data.deltaPct.toFixed(1)}%)` : ''}</div>}</div>} />
            </div>
          </div>

          <div style={{ ...S.card, padding: 0, overflow: 'auto' }}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.thL}>Linha</th>
                {anos.map(y => <th key={y} style={S.th}>{y}</th>)}
                <th style={S.th}>CAGR</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...S.tdL, paddingLeft: 12 + r.depth * 16, fontWeight: isBold(r.tipo) ? 600 : 400 }}>{r.desc}</td>
                    {anos.map(y => <td key={y} style={{ ...S.td, fontWeight: isBold(r.tipo) ? 600 : 400 }}>{r.vals[y] ? fmt(r.vals[y]) : '—'}</td>)}
                    <td style={{ ...S.td, color: r.cagr == null ? 'var(--muted)' : r.cagr >= 0 ? '#2f9e44' : '#e03131', fontWeight: 600 }}>{r.cagr == null ? '—' : `${r.cagr >= 0 ? '+' : ''}${r.cagr.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
