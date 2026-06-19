import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { computeTotais, pkey } from '../../lib/engine'
import type { LinhaCalc, Computed, Periodo } from '../../lib/engine'
import { ResponsiveBar } from '@nivo/bar'
import { ResponsiveLine } from '@nivo/line'
import { RefreshCw, Scale, Filter, X } from 'lucide-react'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ANOS = [2024, 2025, 2026, 2027, 2028]
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const fmt = (v: number | null) => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('pt-BR')
const fmtK = (v: number) => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k' : String(Math.round(v))
const rat = (v: number | null) => v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number | null) => v == null || !isFinite(v) ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
const dias = (v: number | null) => v == null || !isFinite(v) ? '—' : Math.round(v) + ' d'

type Rel = { id: string; nome: string }
type Item = { id: string; codigo: string; descricao: string }
type RL = { id: string; pai_id: string | null; codigo: string; descricao: string; tipo_linha: any; expressao: string | null; natureza: string | null; desativada: boolean; linha_orc_id: string | null }

async function fetchAll(q: () => any): Promise<any[]> {
  const out: any[] = []; let from = 0; const size = 1000
  while (true) { const { data, error } = await q().range(from, from + size - 1); if (error) throw error; out.push(...(data || [])); if (!data || data.length < size) break; from += size }
  return out
}

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0, display: 'flex', alignItems: 'center', gap: 8 },
  sub:   { fontSize: 13, color: '#868e96', margin: '4px 0 16px' },
  bar:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  sel:   { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  btn:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  secT:  { fontSize: 12, fontWeight: 700, color: '#adb5bd', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' },
  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  card:  { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 16 },
  cLbl:  { fontSize: 12, color: '#868e96', fontWeight: 500 },
  cVal:  { fontSize: 22, fontWeight: 700, color: '#212529', margin: '6px 0 2px' },
  cSub:  { fontSize: 11, color: '#adb5bd' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 16 },
  chart: { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 16 },
  chartT:{ fontSize: 14, fontWeight: 600, color: '#212529', marginBottom: 4 },
  empty: { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: '#aaa', fontSize: 14 },
  chip:  { fontSize: 12, color: '#868e96', marginBottom: 16 },
  pop:   { position: 'absolute', top: '110%', left: 0, zIndex: 1500, background: 'white', border: '1px solid #e9ecef', borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.16)', padding: 16, width: 420, maxHeight: '78vh', overflow: 'auto' },
  label: { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 6 },
  input: { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ced4da', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
}
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#495057' }

function Checklist({ titulo, items, sel, setSel }: { titulo: string; items: Item[]; sel: string[]; setSel: (v: string[]) => void }) {
  const [b, setB] = useState('')
  const f = b ? items.filter(i => `${i.codigo} ${i.descricao}`.toLowerCase().includes(b.toLowerCase())) : items
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <label style={{ ...S.label, margin: 0 }}>{titulo}</label>
        <span style={{ fontSize: 11, color: '#adb5bd' }}>{sel.length ? `${sel.length} de ${items.length}` : 'todas'}</span>
        <div style={{ flex: 1 }} />
        <button style={miniBtn} onClick={() => setSel(items.map(i => i.id))}>Todas</button>
        <button style={miniBtn} onClick={() => setSel([])}>Limpar</button>
      </div>
      <input style={{ ...S.input, marginBottom: 6 }} placeholder="filtrar..." value={b} onChange={e => setB(e.target.value)} />
      <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid #f1f3f5', borderRadius: 8, padding: 4 }}>
        {f.map(i => (
          <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
            <span style={{ fontFamily: 'monospace', color: '#868e96', minWidth: 50 }}>{i.codigo}</span>
            <span>{i.descricao}</span>
          </label>
        ))}
        {!f.length && <div style={{ padding: 8, color: '#adb5bd', fontSize: 12 }}>Nenhum item.</div>}
      </div>
    </div>
  )
}

function Card({ lbl, val, sub, tone }: { lbl: string; val: string; sub?: string; tone?: 'good' | 'bad' | 'warn' }) {
  const col = tone === 'good' ? '#2f9e44' : tone === 'bad' ? '#e03131' : tone === 'warn' ? '#f59f00' : '#212529'
  return (
    <div style={S.card}>
      <div style={S.cLbl}>{lbl}</div>
      <div style={{ ...S.cVal, color: col }}>{val}</div>
      {sub && <div style={S.cSub}>{sub}</div>}
    </div>
  )
}

const SAVE = 'planorc_bal_filtro'
function loadSaved(): any { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function BalancoDashboardPage() {
  const sv = loadSaved()
  const [rels, setRels] = useState<Rel[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([])
  const [filiais, setFiliais] = useState<Item[]>([])
  const [bpId, setBpId] = useState('')
  const [dreId, setDreId] = useState<string>(sv.dreId || '')
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [filtroOpen, setFiltroOpen] = useState(false)
  const [ano, setAno] = useState<number>(sv.ano || 2026)
  const [mes, setMes] = useState<number>(sv.mes || 12)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [temDados, setTemDados] = useState(false)

  const [ind, setInd] = useState<any>({})
  const [compAtivo, setCompAtivo] = useState<any[]>([])
  const [compPassivo, setCompPassivo] = useState<any[]>([])
  const [evol, setEvol] = useState<any[]>([])

  useEffect(() => {
    supabase.from('relatorio').select('id,nome').order('nome').then(r => { setRels(r.data || []); if (r.data?.length) { setBpId(p => p || sv.bpId || r.data![0].id); setDreId(p => p || r.data![0].id) } })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
  }, []) // eslint-disable-line
  useEffect(() => { localStorage.setItem(SAVE, JSON.stringify({ bpId, dreId, empresaSel, filialSel, ano, mes })) }, [bpId, dreId, empresaSel, filialSel, ano, mes])

  const load = async () => {
    if (!bpId) return
    setLoading(true); setErro(null)
    try {
      const empIds = empresaSel.length ? empresaSel : empresas.map(e => e.id)
      const filIds = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
      if (!empIds.length) { setTemDados(false); setLoading(false); return }
      const todosMeses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

      // ── BALANÇO: saldo (balancete) no mês de referência — leitura DIRETA, sem acumular
      const bpLines = (await fetchAll(() => supabase.from('relatorio_linha').select('id,pai_id,codigo,descricao,tipo_linha,expressao,natureza,desativada,linha_orc_id').eq('relatorio_id', bpId))) as RL[]
      const bpMasters = [...new Set(bpLines.filter(l => l.tipo_linha === 'ANALITICA' && l.linha_orc_id).map(l => l.linha_orc_id))] as string[]
      const rlOf: Record<string, string> = {}; bpLines.forEach(l => { if (l.linha_orc_id) rlOf[l.linha_orc_id] = l.id })
      const rpc = (anos: number[], meses: number[], linhas: string[]) => supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: linhas, p_filiais: filIds, p_ccs: null })
      const saldoR = await supabase.rpc('relatorio_saldo_agg', { p_empresas: empIds, p_ano: ano, p_meses: todosMeses, p_linhas: bpMasters, p_filiais: filIds })
      if (saldoR.error) throw new Error(saldoR.error.message)
      const saldoM: Record<string, Record<number, number>> = {}
      for (const r of saldoR.data || []) { (saldoM[r.linha_id] = saldoM[r.linha_id] || {})[r.mes] = (saldoM[r.linha_id]?.[r.mes] || 0) + (Number(r.saldo) || 0) }
      const saldoAt = (master: string, m: number) => saldoM[master]?.[m] || 0

      // engine: saldo por linha (período único) — robusto a subtotais/fórmulas
      const calc: LinhaCalc[] = bpLines.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada }))
      const SP: Periodo = { ano: 0, mes: 1 }; const PK = pkey(SP)
      const computed: Computed = {}; calc.forEach(l => { computed[l.id] = {} })
      for (const m of bpMasters) { if (rlOf[m]) computed[rlOf[m]][PK] = saldoAt(m, mes) }
      const tot = computeTotais(calc, computed, [SP])
      const bal = (lineId: string) => Math.abs(tot[lineId] || 0)   // exibe magnitudes (independe do sinal débito/crédito)

      // detecção de grupos por NOME, dentro do topo correto
      const byId: Record<string, RL> = {}; bpLines.forEach(l => { byId[l.id] = l })
      const topAnc = (id: string) => { let cur = byId[id], g = 0; while (cur && cur.pai_id && byId[cur.pai_id] && g++ < 60) cur = byId[cur.pai_id]; return cur }
      const depthOf = (id: string) => { let d = 0, cur = byId[id]; while (cur && cur.pai_id && d < 60) { d++; cur = byId[cur.pai_id] } return d }
      const tops = bpLines.filter(l => !l.pai_id)
      const findTop = (...kw: string[]) => tops.find(t => kw.some(k => norm(t.descricao).includes(k)))
      const ativoTop = findTop('ativo'), passivoTop = findTop('passiv'), plTop = findTop('patrim', 'liquido')
      const findGrp = (top: RL | undefined, kw: string[]) => {
        const cand = bpLines.filter(l => l.id !== top?.id && (!top || topAnc(l.id)?.id === top.id) && kw.some(k => norm(l.descricao).includes(k)))
        if (!cand.length) return 0
        cand.sort((a, b) => depthOf(a.id) - depthOf(b.id))
        return bal(cand[0].id)
      }
      const Ativo = ativoTop ? bal(ativoTop.id) : 0
      const Passivo = passivoTop ? bal(passivoTop.id) : 0
      const PL = plTop ? bal(plTop.id) : 0
      const Caixa = findGrp(ativoTop, ['disponib', 'caixa', 'banco'])
      const CR = findGrp(ativoTop, ['receber', 'cliente'])
      const Estoq = findGrp(ativoTop, ['estoque'])
      const TribCred = findGrp(ativoTop, ['tributo', 'credito', 'crédito'])
      const Forn = findGrp(passivoTop, ['fornecedor'])
      const Pessoas = findGrp(passivoTop, ['pessoa', 'salar', 'salár'])
      const TribPas = findGrp(passivoTop, ['tributo', 'imposto'])
      const Divida = findGrp(passivoTop, ['divida', 'dívida', 'financ', 'emprest', 'emprést'])
      const AC = Caixa + CR + Estoq + TribCred
      const PC = Forn + Pessoas + TribPas
      const NaoCircAtivo = Math.max(0, Ativo - AC)
      const DividaLiq = Divida - Caixa

      // ── DRE (YTD do ano até o mês) para Receita / Custos / EBITDA
      let Receita = 0, Despesa = 0, EBITDA = 0
      if (dreId) {
        const dreLines = (await fetchAll(() => supabase.from('relatorio_linha').select('id,pai_id,codigo,descricao,tipo_linha,expressao,natureza,desativada,linha_orc_id').eq('relatorio_id', dreId))) as RL[]
        const dMasters = [...new Set(dreLines.filter(l => l.tipo_linha === 'ANALITICA' && l.linha_orc_id).map(l => l.linha_orc_id))] as string[]
        const dRlOf: Record<string, string> = {}; dreLines.forEach(l => { if (l.linha_orc_id) dRlOf[l.linha_orc_id] = l.id })
        const dById: Record<string, RL> = {}; dreLines.forEach(l => { dById[l.id] = l })
        const natCache: Record<string, string | null> = {}
        const natOf = (id: string | null): string | null => { if (!id) return null; if (id in natCache) return natCache[id]; const l = dById[id]; if (!l) return null; const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id); natCache[id] = n; return n }
        const mesesYTD = todosMeses.filter(m => m <= mes)
        const dre = await rpc([ano], mesesYTD, dMasters)
        if (dre.error) throw new Error(dre.error.message)
        const valByM: Record<string, number> = {}
        for (const r of dre.data || []) valByM[r.linha_id] = (valByM[r.linha_id] || 0) + (Number(r.valor) || 0)
        const dcalc: LinhaCalc[] = dreLines.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada }))
        const dcomp: Computed = {}; dcalc.forEach(l => { dcomp[l.id] = {} })
        for (const m of dMasters) { if (dRlOf[m]) dcomp[dRlOf[m]][PK] = valByM[m] || 0 }
        const dtot = computeTotais(dcalc, dcomp, [SP])
        for (const l of dreLines) { if (l.tipo_linha !== 'ANALITICA' || l.desativada || !l.linha_orc_id) continue; const n = natOf(l.id); if (n === 'RECEITA') Receita += Math.abs(dtot[l.id] || 0); else if (n === 'DESPESA') Despesa += Math.abs(dtot[l.id] || 0) }
        const eb = dreLines.find(l => norm(l.descricao).includes('ebitda'))
        EBITDA = eb ? (dtot[eb.id] || 0) : 0
      }
      const d = mes * 30
      const EBITDAanual = mes ? EBITDA / mes * 12 : EBITDA

      const indic = {
        Ativo, Passivo, PL, AC, PC, Caixa, CR, Estoq, Forn, Divida, NaoCircAtivo, DividaLiq, Receita, Despesa, EBITDA,
        PLAtivo: Ativo ? PL / Ativo : null,
        Solvencia: Passivo ? Ativo / Passivo : null,
        ImobPL: PL ? NaoCircAtivo / PL : null,
        LC: PC ? AC / PC : null,
        LS: PC ? (AC - Estoq) / PC : null,
        CG: AC - PC,
        NCG: (CR + Estoq) - Forn,
        DivPL: PL ? Divida / PL : null,
        DL_EBITDA: EBITDAanual > 0 ? DividaLiq / EBITDAanual : null,
        PMR: Receita ? CR / Receita * d : null,
        PMP: Despesa ? Forn / Despesa * d : null,
        PME: Despesa ? Estoq / Despesa * d : null,
        get Ciclo() { return (this.PMR != null && this.PMP != null && this.PME != null) ? this.PMR + this.PME - this.PMP : null },
      }
      setInd(indic)

      // composição (filhas diretas dos topos)
      const childrenOf = (pid: string) => bpLines.filter(l => l.pai_id === pid && l.tipo_linha !== 'ESPACO')
      setCompAtivo(ativoTop ? childrenOf(ativoTop.id).map(c => ({ grupo: c.descricao.replace(/^\d+\.\s*/, '').slice(0, 20), valor: bal(c.id) })).filter(x => x.valor) : [])
      setCompPassivo([...(passivoTop ? childrenOf(passivoTop.id) : []), ...(plTop ? childrenOf(plTop.id) : [])].map(c => ({ grupo: c.descricao.replace(/^\d+\.\s*/, '').slice(0, 20), valor: bal(c.id) })).filter(x => x.valor))

      // evolução Ativo Total e PL por mês (acumulado)
      const leaves = bpLines.filter(l => l.tipo_linha === 'ANALITICA' && l.linha_orc_id)
      const sumLeavesAte = (top: RL | undefined, m: number) => { if (!top) return 0; let s = 0; for (const l of leaves) { if (topAnc(l.id)?.id === top.id) s += saldoAt(l.linha_orc_id!, m) } return Math.abs(s) }
      const evAtivo = { id: 'Ativo', data: todosMeses.map(m => ({ x: MESES[m - 1], y: Math.round(sumLeavesAte(ativoTop, m)) })) }
      const evPL = { id: 'PL', data: todosMeses.map(m => ({ x: MESES[m - 1], y: Math.round(sumLeavesAte(plTop, m)) })) }
      setEvol([evAtivo, evPL])

      setTemDados(!!(Ativo || Passivo || PL))
    } catch (e: any) { setErro(e?.message ?? String(e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [bpId, dreId, empresaSel, filialSel, ano, mes, empresas.length, filiais.length]) // eslint-disable-line

  return (
    <div style={S.page}>
      <h1 style={S.title}><Scale size={20} /> Dashboard — Balanço Patrimonial</h1>
      <p style={S.sub}>Posição (saldo acumulado do realizado) em {MESES[mes - 1]}/{ano}. Índices de ciclo usam Receita/Custos/EBITDA da DRE.</p>

      <div style={S.bar}>
        <span style={{ fontSize: 12, color: '#adb5bd' }}>Balanço:</span>
        <select style={S.sel} value={bpId} onChange={e => setBpId(e.target.value)}>{rels.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select>
        <span style={{ fontSize: 12, color: '#adb5bd' }}>DRE:</span>
        <select style={S.sel} value={dreId} onChange={e => setDreId(e.target.value)}><option value="">— (sem ciclo) —</option>{rels.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select>
        <div style={{ position: 'relative' }}>
          <button style={S.btn} onClick={() => setFiltroOpen(o => !o)}><Filter size={13} /> Empresa / Filial</button>
          {filtroOpen && (
            <>
              <div onClick={() => setFiltroOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1400 }} />
              <div style={S.pop}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: 14, color: '#212529' }}>Empresa / Filial</strong>
                  <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={() => setFiltroOpen(false)} />
                </div>
                <div style={{ fontSize: 12, color: '#adb5bd' }}>Marque para agrupar (consolida o que estiver marcado). Vazio = todas.</div>
                <Checklist titulo="Empresa" items={empresas} sel={empresaSel} setSel={setEmpresaSel} />
                <Checklist titulo="Filial" items={filiais} sel={filialSel} setSel={setFilialSel} />
                <button style={{ ...S.btn, width: '100%', justifyContent: 'center', marginTop: 14, background: '#3b5bdb', color: 'white', borderColor: '#3b5bdb' }} onClick={() => setFiltroOpen(false)}>Aplicar e fechar</button>
              </div>
            </>
          )}
        </div>
        <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>{ANOS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select style={S.sel} value={mes} onChange={e => setMes(Number(e.target.value))}>{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        {loading && <span style={{ fontSize: 12, color: '#aaa' }}>Carregando…</span>}
      </div>
      <div style={S.chip}>{empresaSel.length ? `${empresaSel.length} empresa(s)` : 'todas as empresas'} · {filialSel.length ? `${filialSel.length} filial(is)` : 'todas as filiais'}</div>

      {erro && <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', color: '#c92a2a', fontSize: 13, marginBottom: 16 }}>⚠ {erro}</div>}

      {!temDados && !loading ? <div style={S.empty}>Sem dados de Balanço para os filtros. Confira se o relatório BP tem realizado amarrado.</div> : (
        <>
          <div style={S.secT}>Estrutura & Solidez</div>
          <div style={S.grid}>
            <Card lbl="Ativo Total" val={fmt(ind.Ativo)} />
            <Card lbl="Passivo Total" val={fmt(ind.Passivo)} />
            <Card lbl="Patrimônio Líquido" val={fmt(ind.PL)} />
            <Card lbl="PL / Ativo" val={pct(ind.PLAtivo)} sub="solidez" tone={ind.PLAtivo != null && ind.PLAtivo >= 0.4 ? 'good' : 'warn'} />
            <Card lbl="Solvência (Ativo/Passivo)" val={rat(ind.Solvencia)} tone={ind.Solvencia != null && ind.Solvencia >= 1 ? 'good' : 'bad'} />
            <Card lbl="Imobilização do PL" val={pct(ind.ImobPL)} sub="Ativo não circ. / PL" />
          </div>

          <div style={S.secT}>Liquidez & Capital de Giro</div>
          <div style={S.grid}>
            <Card lbl="Liquidez Corrente" val={rat(ind.LC)} sub="AC / PC operacional" tone={ind.LC != null && ind.LC >= 1 ? 'good' : 'bad'} />
            <Card lbl="Liquidez Seca" val={rat(ind.LS)} sub="(AC − Estoques) / PC" tone={ind.LS != null && ind.LS >= 1 ? 'good' : 'warn'} />
            <Card lbl="Capital de Giro" val={fmt(ind.CG)} sub="AC − PC" tone={ind.CG >= 0 ? 'good' : 'bad'} />
            <Card lbl="NCG" val={fmt(ind.NCG)} sub="(Receber+Estoq) − Fornec." />
            <Card lbl="Caixa / Disponibilidades" val={fmt(ind.Caixa)} />
          </div>

          <div style={S.secT}>Endividamento</div>
          <div style={S.grid}>
            <Card lbl="Dívida Bruta" val={fmt(ind.Divida)} />
            <Card lbl="Dívida Líquida" val={fmt(ind.DividaLiq)} sub="Dívida − Caixa" tone={ind.DividaLiq <= 0 ? 'good' : undefined} />
            <Card lbl="Dívida Líquida / EBITDA" val={ind.DL_EBITDA == null ? '—' : rat(ind.DL_EBITDA) + 'x'} sub="EBITDA anualizado" tone={ind.DL_EBITDA != null && ind.DL_EBITDA <= 3 ? 'good' : 'bad'} />
            <Card lbl="Dívida / PL" val={pct(ind.DivPL)} tone={ind.DivPL != null && ind.DivPL <= 1 ? 'good' : 'warn'} />
          </div>

          <div style={S.secT}>Eficiência (ciclo){!dreId && ' — selecione uma DRE'}</div>
          <div style={S.grid}>
            <Card lbl="PMR — Prazo Médio Receb." val={dias(ind.PMR)} sub="Contas a Receber / Receita" />
            <Card lbl="PMP — Prazo Médio Pagto." val={dias(ind.PMP)} sub="Fornecedores / Custos" />
            <Card lbl="PME — Prazo Médio Estoque" val={dias(ind.PME)} sub="Estoques / Custos" />
            <Card lbl="Ciclo de Caixa" val={dias(ind.Ciclo)} sub="PMR + PME − PMP" tone={ind.Ciclo != null && ind.Ciclo <= 0 ? 'good' : undefined} />
          </div>

          <div style={S.grid2}>
            <div style={S.chart}>
              <div style={S.chartT}>Composição do Ativo</div>
              <div style={{ height: Math.max(200, compAtivo.length * 34 + 40) }}>
                <ResponsiveBar data={compAtivo} keys={['valor']} indexBy="grupo" layout="horizontal" margin={{ top: 6, right: 20, bottom: 24, left: 150 }} padding={0.3} colors={['#3b5bdb']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate />
              </div>
            </div>
            <div style={S.chart}>
              <div style={S.chartT}>Composição do Passivo + PL</div>
              <div style={{ height: Math.max(200, compPassivo.length * 34 + 40) }}>
                <ResponsiveBar data={compPassivo} keys={['valor']} indexBy="grupo" layout="horizontal" margin={{ top: 6, right: 20, bottom: 24, left: 150 }} padding={0.3} colors={['#e8590c']} axisBottom={{ format: (v: any) => fmtK(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate />
              </div>
            </div>
          </div>

          <div style={{ ...S.chart, marginTop: 16 }}>
            <div style={S.chartT}>Evolução — Ativo Total × PL ({ano})</div>
            <div style={{ height: 300 }}>
              <ResponsiveLine data={evol} margin={{ top: 10, right: 20, bottom: 40, left: 60 }} xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} colors={['#3b5bdb', '#2f9e44']} pointSize={6} useMesh curve="monotoneX" axisLeft={{ format: (v: any) => fmtK(Number(v)) }} enableArea areaOpacity={0.05} legends={[{ anchor: 'top-left', direction: 'row', translateY: -2, itemWidth: 60, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
