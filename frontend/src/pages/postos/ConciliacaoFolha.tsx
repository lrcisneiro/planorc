import { useEffect, useMemo, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { cascataRateio } from '../../lib/rateioFolha'
import { useLocalPref } from '../../lib/uiPrefs'
import { pageAll } from '../../lib/pageAll'
import { AlertCircle, ChevronDown, ChevronRight, Search, X } from 'lucide-react'

// Corpo reutilizável da conciliação de folha (Orçado motor × Realizado folha, por posto).
// Usado pelo modal (drill do DRE) e pela página avulsa (a partir dos Postos).
// masterIds/contaIds = null → considera TODAS as contas (conciliação cheia da versão).

export type ConcilParams = {
  titulo?: string
  versaoId: string; versaoLabel: string
  meses: { ano: number; mes: number }[]
  masterIds: string[] | null   // conta_orcamentaria (fat_orcado.linha_id) — null = todas
  contaIds: string[] | null    // conta_contabil (fat_folha.conta_id) — null = todas
  empresaSel: string[]; filialFilter: string[] | null; ccFilter: string[] | null
  contaToItem?: Record<string, string>   // conta_contabil → item orçamentário (vindo pronto do DRE); sem isto, resolve no banco
}
type Linha = { key: string; posto_id: string | null; codigo: string; nome: string; matricula: string; cargo: string; empCod: string; filCod: string; ccCod: string; ccDesc: string; orcado: number; realizado: number; divergDims: string[] }
type VerbaReal = { verba_cod: string; verba_desc: string; conta_id: string | null; item_orc_id: string | null; valor: number }
type DimCell = { empId: string | null; filId: string | null; ccId: string | null; orc: number; real: number }

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const milAno = (v: number) => Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${money(v)}`

const S: Record<string, CSSProperties> = {
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '0 0 16px' },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  cardT: { padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 16px' },
  empty: { padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  detLbl:{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '2px 0 6px' },
  detRow:{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '2px 0' },
  mono:  { fontFamily: 'monospace', color: 'var(--muted)' },
  dh:    { textAlign: 'left', padding: '4px 8px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  dt:    { padding: '3px 8px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  bar:   { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: '0 0 12px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  inp:   { padding: '7px 10px 7px 28px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', width: 220 },
  gh:    { padding: '7px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontWeight: 600 },
}

export function ConciliacaoFolha({ params: p }: { params: ConcilParams }) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [orcDet, setOrcDet] = useState<Record<string, VerbaReal[]>>({})
  const [realDet, setRealDet] = useState<Record<string, VerbaReal[]>>({})
  const [contaOrc, setContaOrc] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<{ col: string; dir: 1 | -1 }>({ col: 'delta', dir: 1 })
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [agrupar, setAgrupar] = useLocalPref<'nenhum' | 'cc' | 'cargo'>('planorc_concil_agrupar', 'nenhum')
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  // 'posto' = por posto (headcount, filtra pela ORIGEM); 'rateado' = gerencial (orçado rateado, filtra pelo DESTINO)
  const [modo, setModo] = useLocalPref<'posto' | 'rateado'>('planorc_concil_modo', 'posto')
  const [soDiverg, setSoDiverg] = useState(false)   // filtro rápido: só postos com realizado fora da origem
  const [dimBreak, setDimBreak] = useState<Record<string, DimCell[]>>({})   // posto → células (empresa×filial×CC) orç×real
  const [modalDim, setModalDim] = useState<Linha | null>(null)   // posto aberto no modal comparativo de dimensões

  useEffect(() => {
    (async () => {
      setLoading(true); setErro(null)
      try {
        const anos = [...new Set(p.meses.map(m => m.ano))]
        const mesesNums = [...new Set(p.meses.map(m => m.mes))]
        const anosMeses = new Set(p.meses.map(m => `${m.ano}-${m.mes}`))
        const sEmp = p.empresaSel?.length ? new Set(p.empresaSel) : null
        const sFil = p.filialFilter ? new Set(p.filialFilter) : null
        const sCc = p.ccFilter ? new Set(p.ccFilter) : null
        const passa = (emp: any, fil: any, cc: any) => (!sEmp || sEmp.has(emp)) && (!sFil || (fil && sFil.has(fil))) && (!sCc || (cc && sCc.has(cc)))
        const inPer = (r: any) => anosMeses.has(`${r.ano}-${r.mes}`)

        // busca as linhas (escopo aplicado depois, por MODO)
        const orcRows = await pageAll(() => {
          let q = supabase.from('fat_folha').select('posto_id,empresa_id,filial_id,cc_id,ano,mes,valor,verba_cod,verba_desc,item_orc_id').eq('tipo', 'ORCADO').eq('versao_id', p.versaoId).in('ano', anos).in('mes', mesesNums)
          if (p.masterIds) q = q.in('item_orc_id', p.masterIds)
          return q
        })
        const realRows = await pageAll(() => {
          let q = supabase.from('fat_folha').select('posto_id,empresa_id,filial_id,cc_id,ano,mes,valor,verba_cod,verba_desc,tipo_verba,conta_id,item_orc_id').eq('tipo', 'REALIZADO').in('ano', anos).in('mes', mesesNums)
          if (p.contaIds) q = q.in('conta_id', p.contaIds)
          return q
        })
        // postos referenciados (origem empresa/filial/CC + display)
        const pids = [...new Set([...orcRows.map((r: any) => r.posto_id), ...realRows.map((r: any) => r.posto_id)].filter(Boolean))] as string[]
        const postoById: Record<string, any> = {}
        for (let i = 0; i < pids.length; i += 300) {
          const { data } = await supabase.from('posto').select('id,codigo,nome,matricula,empresa_id,filial_id,cc_id,empresa(codigo),filial(codigo),cargo(nome),centro_custo(codigo,descricao)').in('id', pids.slice(i, i + 300))
          for (const x of data || []) postoById[x.id] = x
        }
        // rateio dos postos — carregado SEMPRE: além do modo rateado, a divergência e o
        // modal (modo posto) precisam saber PARA ONDE o orçado foi rateado, senão um
        // posto rateado (orçado espalhado) parece divergente contra a origem.
        const cellsCache: Record<string, any[]> = {}
        if (pids.length) {
          const [{ data: pr }, { data: rr }, { data: rd }] = await Promise.all([
            supabase.from('posto_rateio').select('posto_id,regra_id,ordem').in('posto_id', pids),
            supabase.from('rateio_regra').select('id,nome,dimensao').eq('ativo', true),
            supabase.from('rateio_destino').select('regra_id,empresa_id,cc_id,pct'),
          ])
          const anexos: Record<string, { regra_id: string; ordem: number }[]> = {}
          for (const r of pr || []) (anexos[r.posto_id] ||= []).push({ regra_id: r.regra_id, ordem: Number(r.ordem) || 1 })
          const destByRegra: Record<string, any[]> = {}
          for (const d of rd || []) (destByRegra[d.regra_id] ||= []).push({ empresa_id: d.empresa_id, cc_id: d.cc_id, pct: Number(d.pct) || 0 })
          for (const pid of pids) {
            const po = postoById[pid]
            cellsCache[pid] = cascataRateio({ empresa_id: po?.empresa_id || null, cc_id: po?.cc_id || null }, anexos[pid] || [], rr || [], destByRegra).cells
          }
        }
        // células do orçado por posto (destinos do rateio, com a filial do posto) e o
        // "footprint" = onde o orçado existe. Sem rateio, cai numa única célula = origem.
        const _cellsC: Record<string, { empId: any; filId: any; ccId: any; pct: number }[]> = {}
        const orcCells = (pid: string) => (_cellsC[pid] ||= (() => {
          const po = postoById[pid]
          const cells = cellsCache[pid] && cellsCache[pid].length ? cellsCache[pid] : [{ empresa_id: po?.empresa_id || null, cc_id: po?.cc_id || null, pct: 1 }]
          return cells.map((c: any) => ({ empId: c.empresa_id, filId: po?.filial_id || null, ccId: c.cc_id, pct: c.pct }))
        })())
        const _fpC: Record<string, Set<string>> = {}
        const footprint = (pid: string) => (_fpC[pid] ||= new Set(orcCells(pid).map(c => `${c.empId}|${c.filId}|${c.ccId}`)))
        // fração do orçado (rateio) que passa no escopo do DESTINO
        const pctEscopo = (pid: string): number => {
          const po = postoById[pid]
          const cells = cellsCache[pid] || [{ empresa_id: po?.empresa_id || null, cc_id: po?.cc_id || null, pct: 1 }]
          let s = 0
          for (const c of cells) if (passa(c.empresa_id, c.empresa_id === po?.empresa_id ? po?.filial_id : null, c.cc_id)) s += c.pct
          return s
        }

        // breakdown por (empresa×filial×CC) por posto — alimenta o modal comparativo
        // "onde está o orçado × onde caiu o realizado" (só modo posto).
        const dimTmp: Record<string, Record<string, DimCell>> = {}
        const addDim = (pid: string, empId: any, filId: any, ccId: any, field: 'orc' | 'real', val: number) => {
          const dk = `${empId}|${filId}|${ccId}`; const dm = (dimTmp[pid] ||= {})
          const cell = (dm[dk] ||= { empId: empId || null, filId: filId || null, ccId: ccId || null, orc: 0, real: 0 })
          cell[field] += val
        }
        // ORÇADO por posto + detalhe por verba
        const orcById: Record<string, number> = {}, orcTmp: Record<string, Record<string, VerbaReal>> = {}
        for (const r of orcRows) {
          if (!inPer(r)) continue
          const pid = r.posto_id || '(sem posto)'
          const po = postoById[r.posto_id]
          let fator = 1
          if (modo === 'posto') { if (!passa(po?.empresa_id, po?.filial_id, po?.cc_id)) continue }
          else { fator = pctEscopo(r.posto_id); if (!fator) continue }
          const v = (Number(r.valor) || 0) * fator
          orcById[pid] = (orcById[pid] || 0) + v
          // breakdown: distribui o orçado pelos destinos do rateio (sem rateio = origem)
          if (modo === 'posto') for (const c of orcCells(pid)) addDim(pid, c.empId, c.filId, c.ccId, 'orc', v * c.pct)
          const t = (orcTmp[pid] ||= {}); const k = `${r.verba_cod}|${r.item_orc_id}`
          if (t[k]) t[k].valor += v; else t[k] = { verba_cod: r.verba_cod || '', verba_desc: r.verba_desc || '', conta_id: null, item_orc_id: r.item_orc_id || null, valor: v }
        }
        const orcDetail: Record<string, VerbaReal[]> = {}
        for (const pid in orcTmp) orcDetail[pid] = Object.values(orcTmp[pid]).sort((a, b) => b.valor - a.valor)

        // REALIZADO por posto + detalhe por verba (item autoritativo; fallback conta_linha)
        const realById: Record<string, number> = {}, realTmp: Record<string, Record<string, VerbaReal>> = {}
        const fallbackItem: Record<string, string> = { ...(p.contaToItem || {}) }
        if (!p.contaToItem) {
          const semItem = [...new Set(realRows.filter((r: any) => !r.item_orc_id && r.conta_id && !(r.tipo_verba || '').startsWith('Desconto')).map((r: any) => r.conta_id))] as string[]
          if (semItem.length) {
            const orcMasters = new Set<string>(orcRows.map((r: any) => r.item_orc_id).filter(Boolean))
            const clByConta: Record<string, string[]> = {}
            for (let i = 0; i < semItem.length; i += 300) {
              const { data, error } = await supabase.from('conta_linha').select('conta_id,linha_id').in('conta_id', semItem.slice(i, i + 300))
              if (error) throw error
              for (const r of (data || []) as any[]) { if (r.linha_id) (clByConta[r.conta_id] ||= []).push(r.linha_id) }
            }
            for (const cid in clByConta) { const opts = clByConta[cid]; fallbackItem[cid] = opts.find(o => orcMasters.has(o)) || opts[0] }
          }
        }
        // divergência de dimensão: no modo POSTO o orçado mora na origem do posto —
        // se o realizado caiu em empresa/filial/CC diferente, marca o posto (tag).
        const divergById: Record<string, Set<string>> = {}
        for (const r of realRows) {
          if (!inPer(r)) continue
          // descontos de funcionário (INSS retido, IRRF…) são RETENÇÃO, não custo do
          // empregador — e o orçado (motor) não os modela. Fora do realizado da conciliação.
          if ((r.tipo_verba || '').startsWith('Desconto')) continue
          const pid = r.posto_id || '(sem posto)'
          const po = postoById[r.posto_id]
          // realizado vem JÁ distribuído do ERP: modo posto filtra pela ORIGEM; rateado pelo DESTINO (linha da folha)
          if (modo === 'posto') { if (!passa(po?.empresa_id, po?.filial_id, po?.cc_id)) continue }
          else { if (!passa(r.empresa_id, r.filial_id, r.cc_id)) continue }
          // divergência = realizado caiu FORA do footprint do orçado (origem ∪ destinos do
          // rateio). Um posto rateado cujo realizado bate os destinos NÃO é divergente.
          if (modo === 'posto' && po && !footprint(pid).has(`${r.empresa_id}|${r.filial_id}|${r.cc_id}`)) {
            const cells = orcCells(pid)
            const s = (divergById[pid] ||= new Set<string>())
            if (!cells.some(c => c.empId === r.empresa_id)) s.add('empresa')
            if (!cells.some(c => (c.filId || null) === (r.filial_id || null))) s.add('filial')
            if (!cells.some(c => (c.ccId || null) === (r.cc_id || null))) s.add('CC')
            if (s.size === 0) s.add('combinação')
          }
          const v = Number(r.valor) || 0
          realById[pid] = (realById[pid] || 0) + v
          if (modo === 'posto') addDim(pid, r.empresa_id, r.filial_id, r.cc_id, 'real', v)
          const t = (realTmp[pid] ||= {}); const k = `${r.verba_cod}|${r.conta_id}`
          if (t[k]) t[k].valor += v; else t[k] = { verba_cod: r.verba_cod || '', verba_desc: r.verba_desc || '', conta_id: r.conta_id || null, item_orc_id: r.item_orc_id || fallbackItem[r.conta_id] || null, valor: v }
        }
        const realDetail: Record<string, VerbaReal[]> = {}
        for (const pid in realTmp) realDetail[pid] = Object.values(realTmp[pid]).sort((a, b) => b.valor - a.valor)
        const itemsUsed = [...new Set([
          ...Object.values(orcDetail).flatMap(l => l.map(x => x.item_orc_id).filter(Boolean)),
          ...Object.values(realDetail).flatMap(l => l.map(x => x.item_orc_id).filter(Boolean)),
        ])] as string[]
        if (itemsUsed.length) { const { data } = await supabase.from('conta_orcamentaria').select('id,codigo,descricao').in('id', itemsUsed); setContaOrc(Object.fromEntries((data || []).map((c: any) => [c.id, c]))) } else setContaOrc({})

        const merge: Linha[] = [...new Set([...Object.keys(orcById), ...Object.keys(realById)])].map(pid => {
          const q = postoById[pid]
          return {
            key: pid, posto_id: pid === '(sem posto)' ? null : pid,
            codigo: q?.codigo || (pid === '(sem posto)' ? '—' : '?'),
            nome: q?.nome || (pid === '(sem posto)' ? 'Sem posto (matrícula não casada)' : 'Vaga'),
            matricula: q?.matricula || '', cargo: q?.cargo?.nome || '',
            empCod: q?.empresa?.codigo || '', filCod: q?.filial?.codigo || '',
            ccCod: q?.centro_custo?.codigo || '', ccDesc: q?.centro_custo?.descricao || '',
            orcado: orcById[pid] || 0, realizado: realById[pid] || 0,
            divergDims: [...(divergById[pid] || [])],
          }
        })
        const dimByPosto: Record<string, DimCell[]> = {}
        for (const pid in dimTmp) dimByPosto[pid] = Object.values(dimTmp[pid]).sort((a, b) => (b.orc + b.real) - (a.orc + a.real))
        setLinhas(merge); setOrcDet(orcDetail); setRealDet(realDetail); setDimBreak(dimByPosto)
      } catch (e: any) { setErro(e?.message || String(e)) }
      finally { setLoading(false) }
    })()
  }, [modo, p.versaoId, JSON.stringify(p.meses), JSON.stringify(p.masterIds), JSON.stringify(p.contaIds), JSON.stringify(p.empresaSel), JSON.stringify(p.filialFilter), JSON.stringify(p.ccFilter), JSON.stringify(p.contaToItem)]) // eslint-disable-line

  const nDiverg = useMemo(() => linhas.filter(l => l.divergDims.length > 0).length, [linhas])
  useEffect(() => { if (nDiverg === 0 && soDiverg) setSoDiverg(false) }, [nDiverg]) // eslint-disable-line
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return linhas.filter(l => (!soDiverg || l.divergDims.length > 0)
      && (!q || [l.codigo, l.nome, l.matricula, l.cargo, l.empCod, l.filCod, l.ccCod, l.ccDesc].some(x => (x || '').toLowerCase().includes(q))))
  }, [linhas, busca, soDiverg])
  const ordenar = (arr: Linha[]) => {
    const val = (l: Linha) => ordem.col === 'orcado' ? l.orcado : ordem.col === 'realizado' ? l.realizado : ordem.col === 'codigo' ? l.codigo : (l.orcado - l.realizado)
    return [...arr].sort((a, b) => { const va = val(a) as any, vb = val(b) as any; return (typeof va === 'string' ? va.localeCompare(vb) : (Math.abs(vb) - Math.abs(va))) * ordem.dir })
  }
  const linhasOrd = useMemo(() => ordenar(filtrados), [filtrados, ordem]) // eslint-disable-line
  const grupos = useMemo(() => {
    if (agrupar === 'nenhum') return null
    const m = new Map<string, { key: string; label: string; linhas: Linha[]; orc: number; real: number }>()
    for (const l of filtrados) {
      const k = agrupar === 'cc' ? (l.ccCod || '(sem CC)') : (l.cargo || '(sem cargo)')
      const label = agrupar === 'cc' ? (l.ccCod ? `${l.ccCod} · ${l.ccDesc}` : 'Sem centro de custo') : (l.cargo || 'Sem cargo')
      let g = m.get(k); if (!g) { g = { key: k, label, linhas: [], orc: 0, real: 0 }; m.set(k, g) }
      g.linhas.push(l); g.orc += l.orcado; g.real += l.realizado
    }
    return [...m.values()].sort((a, b) => Math.abs(b.orc - b.real) - Math.abs(a.orc - a.real))
  }, [filtrados, agrupar])
  const tot = useMemo(() => filtrados.reduce((s, l) => ({ orc: s.orc + l.orcado, real: s.real + l.realizado }), { orc: 0, real: 0 }), [filtrados])
  const sortClick = (col: string) => setOrdem(o => o.col === col ? { col, dir: (o.dir === 1 ? -1 : 1) } : { col, dir: 1 })
  const seta = (col: string) => ordem.col === col ? (ordem.dir === 1 ? ' ↓' : ' ↑') : ''
  const corDelta = (d: number) => Math.abs(d) < 0.005 ? 'var(--muted)' : d < 0 ? 'var(--red)' : 'var(--green)'
  const toggleGrupo = (k: string) => setFechados(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  const renderLinha = (l: Linha) => { const d = l.orcado - l.realizado; const open = aberto.has(l.key)
    const itensMerge = (() => {
      type VG = { cod: string; desc: string; orc: number; real: number }
      const items = new Map<string, { itemId: string | null; orc: number; real: number; verbas: Map<string, VG> }>()
      const add = (list: VerbaReal[], field: 'orc' | 'real') => { for (const v of list) {
        const ik = v.item_orc_id || '__sem'
        let it = items.get(ik); if (!it) { it = { itemId: v.item_orc_id, orc: 0, real: 0, verbas: new Map() }; items.set(ik, it) }
        it[field] += v.valor
        const vk = v.verba_cod || '—'; let vg = it.verbas.get(vk); if (!vg) { vg = { cod: vk, desc: v.verba_desc || '', orc: 0, real: 0 }; it.verbas.set(vk, vg) }
        vg[field] += v.valor; if (!vg.desc && v.verba_desc) vg.desc = v.verba_desc
      } }
      add(orcDet[l.key] || [], 'orc'); add(realDet[l.key] || [], 'real')
      return [...items.values()].sort((a, b) => !a.itemId ? 1 : !b.itemId ? -1 : (contaOrc[a.itemId]?.codigo || '').localeCompare(contaOrc[b.itemId]?.codigo || ''))
    })()
    return (
    <Fragment key={l.key}>
      <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(s => { const n = new Set(s); n.has(l.key) ? n.delete(l.key) : n.add(l.key); return n })}>
        <td style={{ ...S.td, ...S.mono }}>{open ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />} {l.codigo}</td>
        <td style={S.td}>{l.nome}
          {l.divergDims.length > 0 && <span onClick={e => { e.stopPropagation(); setModalDim(l) }}
            title={`Realizado em ${l.divergDims.join(' / ')} diferente da origem do posto. Clique para comparar empresa×filial×CC orçado × realizado.`}
            style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: 'var(--orange)', background: 'rgba(251,146,60,0.14)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', cursor: 'pointer' }}>≠ {l.divergDims.join('/')}</span>}
        </td>
        <td style={{ ...S.td, color: 'var(--muted)' }}>{l.empCod || '—'} · {l.filCod || '—'} · {l.ccCod || '—'}</td>
        <td style={{ ...S.td, textAlign: 'right' }}>{money(l.orcado)}</td>
        <td style={{ ...S.td, textAlign: 'right' }}>{money(l.realizado)}</td>
        <td style={{ ...S.td, textAlign: 'right', color: corDelta(d), fontWeight: 600 }}>{money(d)}</td>
        <td style={{ ...S.td, textAlign: 'right', color: corDelta(d) }}>{l.realizado ? `${(d / Math.abs(l.realizado) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : (l.orcado ? '—' : '')}</td>
      </tr>
      {open && <tr><td colSpan={7} style={{ background: 'var(--bg-soft)', padding: '4px 16px 12px 34px', borderBottom: '1px solid var(--panel-2)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>
            <th style={S.dh}>Item · verba</th>
            <th style={{ ...S.dh, textAlign: 'right' }}>Orçado</th>
            <th style={{ ...S.dh, textAlign: 'right' }}>Realizado</th>
            <th style={{ ...S.dh, textAlign: 'right' }}>Δ</th>
          </tr></thead>
          <tbody>
            {itensMerge.map((it, ii) => { const dItem = it.orc - it.real; return (
              <Fragment key={ii}>
                <tr>
                  <td style={{ ...S.dt, fontWeight: 600 }}>{it.itemId ? <><span style={S.mono}>{contaOrc[it.itemId]?.codigo || '—'}</span> {contaOrc[it.itemId]?.descricao || ''}</> : <span style={{ color: 'var(--orange)' }}>⚠ Sem item orçamentário</span>}</td>
                  <td style={{ ...S.dt, textAlign: 'right', fontWeight: 600 }}>{money(it.orc)}</td>
                  <td style={{ ...S.dt, textAlign: 'right', fontWeight: 600 }}>{money(it.real)}</td>
                  <td style={{ ...S.dt, textAlign: 'right', fontWeight: 600, color: corDelta(dItem) }}>{money(dItem)}</td>
                </tr>
                {[...it.verbas.values()].sort((a, b) => (b.orc + b.real) - (a.orc + a.real)).map((v, vi) => { const dv = v.orc - v.real; return (
                  <tr key={vi}>
                    <td style={{ ...S.dt, paddingLeft: 22, color: 'var(--muted)' }}><span style={S.mono}>{v.cod}</span> {v.desc}</td>
                    <td style={{ ...S.dt, textAlign: 'right', color: 'var(--muted)' }}>{v.orc ? money(v.orc) : '·'}</td>
                    <td style={{ ...S.dt, textAlign: 'right', color: 'var(--muted)' }}>{v.real ? money(v.real) : '·'}</td>
                    <td style={{ ...S.dt, textAlign: 'right', color: corDelta(dv) }}>{money(dv)}</td>
                  </tr>
                ) })}
              </Fragment>
            ) })}
          </tbody>
        </table>
      </td></tr>}
    </Fragment>
    )
  }

  return (
    <>
      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Orçado (postos)</div><div style={S.kpiV}>{milAno(tot.orc)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Realizado (folha)</div><div style={S.kpiV}>{milAno(tot.real)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Δ (orç − real)</div><div style={{ ...S.kpiV, color: corDelta(tot.orc - tot.real) }}>{milAno(tot.orc - tot.real)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Δ%</div><div style={{ ...S.kpiV, color: corDelta(tot.orc - tot.real) }}>{tot.real ? `${((tot.orc - tot.real) / Math.abs(tot.real) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</div></div>
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Modo</span>
          <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as any)} title="Por posto: headcount, filtra pela origem. Rateado: gerencial, orçado rateado, filtra pelo destino (empresa/filial/CC).">
            <option value="posto">Por posto (headcount)</option>
            <option value="rateado">Rateado (gerencial)</option>
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Buscar</span>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
            <input style={S.inp} placeholder="nome, matrícula, cargo, CC…" value={busca} onChange={e => setBusca(e.target.value)} />
            {busca && <X size={14} style={{ position: 'absolute', right: 8, top: 9, color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setBusca('')} />}
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Agrupar por</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select style={S.sel} value={agrupar} onChange={e => setAgrupar(e.target.value as any)}>
              <option value="nenhum">Sem agrupamento (ordenável)</option>
              <option value="cc">Centro de custo</option>
              <option value="cargo">Cargo</option>
            </select>
            {grupos && grupos.length > 0 && (() => { const abertoAlgum = grupos.some(g => !fechados.has(g.key)); return (
              <button style={{ ...S.sel, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-mid)' }}
                title={abertoAlgum ? 'Recolher todos os grupos' : 'Expandir todos os grupos'}
                onClick={() => setFechados(abertoAlgum ? new Set(grupos.map(g => g.key)) : new Set())}>
                {abertoAlgum ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{abertoAlgum ? 'Recolher' : 'Expandir'}
              </button>
            ) })()}
          </div>
        </div>
        {nDiverg > 0 && (
          <div style={S.fld}><span style={S.lbl}>Divergência</span>
            <button onClick={() => setSoDiverg(v => !v)}
              title="Postos com realizado lançado em empresa/filial/CC diferente da origem (onde está o orçado). Clique para mostrar só eles."
              style={{ ...S.sel, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap',
                color: soDiverg ? '#fff' : 'var(--orange)',
                background: soDiverg ? 'var(--orange)' : 'rgba(251,146,60,0.14)',
                border: '1px solid ' + (soDiverg ? 'var(--orange)' : 'rgba(251,146,60,0.4)') }}>
              ≠ Divergentes ({nDiverg})
            </button>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={S.cardT}>Por posto <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {filtrados.length} de {linhas.length} · {modo === 'rateado' ? 'orçado rateado, filtros pelo destino (empresa/filial/CC)' : 'headcount, filtros pela origem do posto'} · clique p/ ver verbas · Δ vermelho = realizado &gt; orçado · realizado = custo (descontos de funcionário fora)</span></div>
        <div style={{ maxHeight: 620, overflow: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th} onClick={() => sortClick('codigo')}>Posto{seta('codigo')}</th>
              <th style={{ ...S.th, cursor: 'default' }}>Ocupante</th>
              <th style={{ ...S.th, cursor: 'default' }}>Empresa · Filial · CC</th>
              <th style={{ ...S.th, textAlign: 'right' }} onClick={() => sortClick('orcado')}>Orçado{seta('orcado')}</th>
              <th style={{ ...S.th, textAlign: 'right' }} onClick={() => sortClick('realizado')}>Realizado{seta('realizado')}</th>
              <th style={{ ...S.th, textAlign: 'right' }} onClick={() => sortClick('delta')}>Δ{seta('delta')}</th>
              <th style={{ ...S.th, textAlign: 'right', cursor: 'default' }}>Δ%</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>Carregando…</td></tr>}
              {!loading && agrupar === 'nenhum' && linhasOrd.map(renderLinha)}
              {!loading && agrupar !== 'nenhum' && (grupos || []).map(g => { const gd = g.orc - g.real; const gopen = !fechados.has(g.key); return (
                <Fragment key={'g:' + g.key}>
                  <tr onClick={() => toggleGrupo(g.key)}>
                    <td colSpan={3} style={S.gh}>{gopen ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />} {g.label} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· {g.linhas.length} posto(s)</span></td>
                    <td style={{ ...S.gh, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(g.orc)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(g.real)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: corDelta(gd) }}>{money(gd)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', color: corDelta(gd) }}>{g.real ? `${(gd / Math.abs(g.real) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</td>
                  </tr>
                  {gopen && ordenar(g.linhas).map(renderLinha)}
                </Fragment>
              ) })}
              {!loading && !filtrados.length && <tr><td colSpan={7} style={S.empty}>{linhas.length ? 'Nenhum posto para a busca.' : 'Sem orçado-posto nem realizado-folha neste escopo/competência.'}</td></tr>}
            </tbody>
            {!loading && filtrados.length > 0 && <tfoot><tr>
              <td style={{ ...S.td, fontWeight: 700 }} colSpan={3}>Total</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{money(tot.orc)}</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{money(tot.real)}</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: corDelta(tot.orc - tot.real) }}>{money(tot.orc - tot.real)}</td>
              <td style={S.td} />
            </tr></tfoot>}
          </table>
        </div>
      </div>
      {modalDim && <DimModal linha={modalDim} cells={dimBreak[modalDim.key] || []} onClose={() => setModalDim(null)} />}
    </>
  )
}

// Modal comparativo empresa×filial×CC: onde está o ORÇADO × onde caiu o REALIZADO,
// para um posto. Resolve os códigos das dimensões sob demanda (só as usadas).
function DimModal({ linha, cells, onClose }: { linha: Linha; cells: DimCell[]; onClose: () => void }) {
  const [emp, setEmp] = useState<Record<string, string>>({})
  const [fil, setFil] = useState<Record<string, string>>({})
  const [cc, setCc] = useState<Record<string, string>>({})
  useEffect(() => {
    const uniq = (f: (c: DimCell) => string | null) => [...new Set(cells.map(f).filter(Boolean))] as string[]
    const eids = uniq(c => c.empId), fids = uniq(c => c.filId), cids = uniq(c => c.ccId)
    ;(async () => {
      if (eids.length) { const { data } = await supabase.from('empresa').select('id,codigo').in('id', eids); setEmp(Object.fromEntries((data || []).map((x: any) => [x.id, x.codigo]))) }
      if (fids.length) { const { data } = await supabase.from('filial').select('id,codigo').in('id', fids); setFil(Object.fromEntries((data || []).map((x: any) => [x.id, x.codigo]))) }
      if (cids.length) { const { data } = await supabase.from('centro_custo').select('id,codigo,descricao').in('id', cids); setCc(Object.fromEntries((data || []).map((x: any) => [x.id, `${x.codigo} · ${x.descricao}`]))) }
    })()
  }, [cells])
  const tot = cells.reduce((s, c) => ({ orc: s.orc + c.orc, real: s.real + c.real }), { orc: 0, real: 0 })
  const cor = (d: number) => Math.abs(d) < 0.005 ? 'var(--muted)' : d < 0 ? 'var(--red)' : 'var(--green)'
  const th: CSSProperties = { textAlign: 'left', padding: '7px 12px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td: CSSProperties = { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 20 }} onClick={onClose}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, width: 'min(720px, 96vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Orçado × Realizado por empresa · filial · CC</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{linha.codigo} · {linha.nome}</div>
          </div>
          <X size={18} style={{ cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }} onClick={onClose} />
        </div>
        <div style={{ padding: '4px 20px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              <th style={th}>Empresa</th><th style={th}>Filial</th><th style={th}>Centro de custo</th>
              <th style={{ ...th, textAlign: 'right' }}>Orçado</th><th style={{ ...th, textAlign: 'right' }}>Realizado</th><th style={{ ...th, textAlign: 'right' }}>Δ</th>
            </tr></thead>
            <tbody>
              {cells.map((c, i) => { const d = c.orc - c.real; const soUm = c.orc < 0.005 || c.real < 0.005; return (
                <tr key={i} style={soUm ? { background: 'rgba(251,146,60,0.08)' } : undefined}>
                  <td style={{ ...td, color: 'var(--text)' }}>{c.empId ? (emp[c.empId] || '…') : '—'}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{c.filId ? (fil[c.filId] || '…') : '—'}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{c.ccId ? (cc[c.ccId] || '…') : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{money(c.orc)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{money(c.real)}</td>
                  <td style={{ ...td, textAlign: 'right', color: cor(d), fontWeight: 600 }}>{money(d)}</td>
                </tr>
              ) })}
            </tbody>
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(tot.orc)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(tot.real)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: cor(tot.orc - tot.real) }}>{money(tot.orc - tot.real)}</td>
            </tr></tfoot>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>Linhas destacadas = dimensão com só um dos lados (orçado sem realizado, ou realizado que caiu fora do orçado).</div>
        </div>
      </div>
    </div>
  )
}
