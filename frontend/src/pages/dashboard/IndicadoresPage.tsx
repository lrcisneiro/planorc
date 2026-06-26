import { useEffect, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatValor } from '../../lib/engine'
import { totaisRelatorio } from '../../lib/relatorioTotais'
import type { RLData } from '../../lib/relatorioTotais'
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, ListChecks } from 'lucide-react'
import { escopoFiltro, FiltrosButton, PeriodoButton, ModalPanel, Checklist, effectiveCcFilter, SalvarCardButton, useCardPreset } from './DashFiltros'
import { useUserAccess } from '../../hooks/useUserAccess'
import type { Item, CC } from './DashFiltros'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ULT_FECHADO = new Date().getMonth() === 0 ? 12 : new Date().getMonth()

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type RL = RLData & { descricao: string; natureza: string | null; formato: any; casas_decimais: number }

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 16px' },
  bar:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  sel:   { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', color: 'var(--text-mid)' },
  btn:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 },
  kpi:   { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 },
  lbl:   { fontSize: 12, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 },
  val:   { fontSize: 26, fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px' },
  ksub:  { fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 },
  empty: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 },
}

const SAVE = 'planorc_indic_filtro'
const loadSaved = (): any => { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

type Card = { id: string; label: string; isPct: boolean; desp: boolean; casas: number; formato: any; R: number; O: number; P: number }

export default function IndicadoresPage() {
  const sv = loadSaved()
  const [rels, setRels] = useState<Rel[]>([]); const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([]); const [filiais, setFiliais] = useState<Item[]>([]); const [ccs, setCcs] = useState<CC[]>([])
  const [relId, setRelId] = useState(''); const [versaoId, setVersaoId] = useState(''); const [ano, setAno] = useState<number>(sv.ano || 2026); const [ateMes, setAteMes] = useState<number>(sv.ateMes || ULT_FECHADO)
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const acessoDash = useUserAccess()
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [areaSel, setAreaSel] = useState<string[]>(Array.isArray(sv.areaSel) ? sv.areaSel : [])
  const [divisaoSel, setDivisaoSel] = useState<string[]>(Array.isArray(sv.divisaoSel) ? sv.divisaoSel : [])
  const [buSel, setBuSel] = useState<string[]>(Array.isArray(sv.buSel) ? sv.buSel : [])
  const [linhas, setLinhas] = useState<RL[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [pickOpen, setPickOpen] = useState(false)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [loading, setLoading] = useState(false); const [erro, setErro] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const { cardId, nome: cardNome } = useCardPreset('/dashboards/indicadores', (f) => {
    if (f.relId !== undefined) setRelId(f.relId); if (f.versaoId !== undefined) setVersaoId(f.versaoId)
    if (typeof f.ano === 'number') setAno(f.ano); if (typeof f.ateMes === 'number') setAteMes(f.ateMes)
    if (Array.isArray(f.empresaSel)) setEmpresaSel(f.empresaSel); if (Array.isArray(f.filialSel)) setFilialSel(f.filialSel); if (Array.isArray(f.ccSel)) setCcSel(f.ccSel)
    if (Array.isArray(f.areaSel)) setAreaSel(f.areaSel); if (Array.isArray(f.divisaoSel)) setDivisaoSel(f.divisaoSel); if (Array.isArray(f.buSel)) setBuSel(f.buSel)
    if (Array.isArray(f.sel)) setSel(f.sel)
  })

  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('codigo').then(r => { setRels(r.data || []); if (r.data?.length) setRelId(p => p || sv.relId || r.data![0].id) })
    supabase.from('versao_orcamento').select('id,codigo').order('codigo').then(r => { setVersoes(r.data || []); if (r.data?.length) setVersaoId(p => p || sv.versaoId || r.data![0].id) })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').order('codigo').then(r => setCcs(r.data || []))
  }, []) // eslint-disable-line
  useEffect(() => { if (cardId) return; localStorage.setItem(SAVE, JSON.stringify({ relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, ano, ateMes })) }, [cardId, relId, versaoId, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, ano, ateMes])

  // carrega linhas do relatório + seleção (persistida por relatório; default = linhas de apoio/indicador)
  useEffect(() => {
    if (!relId) return
    supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,linha_orc_id,nao_soma,filtro_escopo,descricao,natureza,formato,casas_decimais').eq('relatorio_id', relId).order('ordem', { nullsFirst: false }).then(r => {
      const ls = (r.data || []) as RL[]
      setLinhas(ls)
      if (cardId) return   // modo card: a seleção vem do preset, não do localStorage do base
      let saved: string[] | null = null
      try { saved = JSON.parse(localStorage.getItem('planorc_indic_sel_' + relId) || 'null') } catch { saved = null }
      if (saved && saved.length) setSel(saved.filter(id => ls.some(l => l.id === id)))
      else setSel(ls.filter(l => l.tipo_linha === 'INDICADOR' || l.nao_soma).map(l => l.id))   // default: linhas tipo Indicador (+ apoio)
    })
  }, [relId, cardId])
  useEffect(() => { if (cardId || !relId) return; localStorage.setItem('planorc_indic_sel_' + relId, JSON.stringify(sel)) }, [cardId, relId, sel])

  const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
  const natOf = (id: string | null): string | null => { if (!id) return null; const l = byId[id]; if (!l) return null; return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id) }

  const load = async () => {
    if (!relId || !sel.length) { setCards(null); return }
    const myseq = ++loadSeq.current
    setLoading(true); setErro(null)
    try {
      const empIds = escopoFiltro(empresaSel.length ? empresaSel : empresas.map(e => e.id), empresas, 'empresa', acessoDash.canSee) ?? []
      const filFilter = escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acessoDash.canSee)
      const ccFilter = escopoFiltro(effectiveCcFilter(ccs, ccSel, areaSel, divisaoSel, buSel), ccs, 'centro_custo', acessoDash.canSee)
      const meses = Array.from({ length: ateMes }, (_, i) => i + 1)
      const ccPerm = ccs.every(c => acessoDash.canSee('centro_custo', c.id)) ? null : ccs.filter(c => acessoDash.canSee('centro_custo', c.id)).map(c => c.id)
      const base = { linhas: linhas as RLData[], ccs, empresas: empIds, meses, filialFilter: filFilter, ccFilter, ccPermitidos: ccPerm }
      const [orc, real, prev] = await Promise.all([
        totaisRelatorio({ ...base, cen: versaoId, anos: [ano] }),
        totaisRelatorio({ ...base, cen: 'REALIZADO', anos: [ano] }),
        totaisRelatorio({ ...base, cen: 'REALIZADO', anos: [ano - 1] }),
      ])
      const cs: Card[] = sel.filter(id => byId[id]).map(id => {
        const l = byId[id]; const f = natOf(id) === 'DESPESA' ? -1 : 1
        return { id, label: l.descricao, isPct: l.formato === 'PERCENTUAL', desp: natOf(id) === 'DESPESA', casas: l.casas_decimais ?? (l.formato === 'PERCENTUAL' ? 1 : 0), formato: l.formato, R: f * (real[id] || 0), O: f * (orc[id] || 0), P: f * (prev[id] || 0) }
      })
      if (myseq !== loadSeq.current) return
      setCards(cs)
    } catch (e: any) { if (myseq === loadSeq.current) setErro(e?.message ?? String(e)) }
    if (myseq === loadSeq.current) setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, sel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, ano, ateMes, empresas, filiais, ccs, linhas, acessoDash.loading]) // eslint-disable-line

  const linhaItems: Item[] = linhas.filter(l => l.tipo_linha !== 'ESPACO').map(l => ({ id: l.id, codigo: l.codigo, descricao: l.descricao }))

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>Indicadores{cardNome && <span style={{ color: 'var(--cyan)' }}> · {cardNome}</span>}</h1>
      </div>
      <p style={S.sub}>Linhas do relatório (incl. indicadores e medidas com filtro de CC) como cards — realizado × orçado, % execução e variação vs. {ano - 1}. Jan–{MESES[ateMes - 1]}/{ano}.</p>

      <div style={S.bar}>
        <select style={S.sel} value={relId} onChange={e => setRelId(e.target.value)}>{rels.map(r => <option key={r.id} value={r.id}>{r.codigo} · {r.nome}</option>)}</select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>{versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}</select>
        <button style={S.btn} onClick={() => setPickOpen(true)}><ListChecks size={14} /> Linhas{sel.length ? ` (${sel.length})` : ''}</button>
        <PeriodoButton width="min(420px, calc(100vw - 40px))" resumo={`${ano} · até ${MESES[ateMes - 1]}`}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', display: 'block', marginBottom: 6 }}>Ano</label>
          <select style={{ ...S.sel, marginBottom: 14 }} value={ano} onChange={e => setAno(+e.target.value)}>{[2022, 2023, 2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}</select>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', display: 'block', marginBottom: 6 }}>Acumulado até o mês</label>
          <select style={S.sel} value={ateMes} onChange={e => setAteMes(+e.target.value)}>{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        </PeriodoButton>
        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        <button style={S.btn} onClick={load}><RefreshCw size={13} /></button>
        <SalvarCardButton base="/dashboards/indicadores" cor="var(--cyan)" cardId={cardId} getFiltros={() => ({ relId, versaoId, ano, ateMes, sel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel })} />
      </div>

      {pickOpen && (
        <ModalPanel titulo="Linhas a exibir como card" onClose={() => setPickOpen(false)} width="min(560px, calc(100vw - 40px))">
          <Checklist titulo="Linhas" items={linhaItems} sel={sel} setSel={setSel} />
        </ModalPanel>
      )}

      {erro && <div style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: 'var(--red)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {loading && <div style={S.sub}>Carregando…</div>}
      {!loading && (!cards || !cards.length) && <div style={S.empty}>Selecione um relatório e ao menos uma linha (botão "Linhas").</div>}
      {!loading && cards && cards.length > 0 && (
        <div style={S.kpis}>
          {cards.map(c => <Kpi key={c.id} c={c} anoPrev={ano - 1} />)}
        </div>
      )}
    </div>
  )
}

function Kpi({ c, anoPrev }: { c: Card; anoPrev: number }) {
  const fmt = (v: number) => formatValor(v, c.formato, c.casas)
  const d = c.R - c.O
  // execução: % p/ valores; em pontos (pp) p/ linhas de percentual
  const exec = (!c.isPct && c.O !== 0) ? (c.R / c.O) * 100 : null
  const bomExec = exec == null ? true : c.desp ? exec <= 100 : exec >= 100
  // YoY
  const yoyPct = (!c.isPct && c.P !== 0) ? (c.R / c.P - 1) * 100 : null
  const bomY = c.desp ? c.R <= c.P : c.R >= c.P
  const arrow = (bom: boolean) => bom ? <TrendingUp size={13} /> : <TrendingDown size={13} />
  return (
    <div style={S.kpi}>
      <div style={S.lbl}>{c.label}</div>
      <div style={S.val}>{fmt(c.R)}</div>
      <div style={S.ksub}>
        Orçado {fmt(c.O)} · {c.isPct
          ? <span style={{ color: bomY ? 'var(--green)' : 'var(--red)' }}>{d >= 0 ? '+' : ''}{formatValor(d, 'NUMERO', c.casas)} pp</span>
          : (exec == null ? '—' : <span style={{ color: bomExec ? 'var(--green)' : 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{arrow(bomExec)}{exec.toFixed(0)}%</span>)}
      </div>
      <div style={{ ...S.ksub, marginTop: 2 }}>Δ (R−O) <strong style={{ color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>{d >= 0 ? '+' : ''}{fmt(d)}</strong></div>
      <div style={{ ...S.ksub, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--panel)' }}>
        <strong style={{ color: 'var(--text-mid)' }}>{anoPrev}</strong> {fmt(c.P)} · {c.isPct
          ? <span style={{ color: bomY ? 'var(--green)' : 'var(--red)' }}>{(c.R - c.P) >= 0 ? '+' : ''}{formatValor(c.R - c.P, 'NUMERO', c.casas)} pp</span>
          : (yoyPct == null ? '—' : <span style={{ color: bomY ? 'var(--green)' : 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{arrow(bomY)}{yoyPct >= 0 ? '+' : ''}{yoyPct.toFixed(0)}%</span>)}
      </div>
    </div>
  )
}
