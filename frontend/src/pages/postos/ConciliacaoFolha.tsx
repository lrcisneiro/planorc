import { useEffect, useMemo, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

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
type Linha = { key: string; posto_id: string | null; codigo: string; nome: string; orcado: number; realizado: number }
type VerbaReal = { verba_cod: string; verba_desc: string; conta_id: string | null; item_orc_id: string | null; valor: number }

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
}

// pagina todos os registros (PostgREST devolve no máx. 1000 por chamada)
async function pageAll(makeQuery: () => any): Promise<any[]> {
  const out: any[] = []; let from = 0; const size = 1000
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + size - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < size) break
    from += size
  }
  return out
}

export function ConciliacaoFolha({ params: p }: { params: ConcilParams }) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [orcDet, setOrcDet] = useState<Record<string, VerbaReal[]>>({})
  const [realDet, setRealDet] = useState<Record<string, VerbaReal[]>>({})
  const [contaOrc, setContaOrc] = useState<Record<string, any>>({})
  const [contaCtb, setContaCtb] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ordem, setOrdem] = useState<{ col: string; dir: 1 | -1 }>({ col: 'delta', dir: 1 })
  const [aberto, setAberto] = useState<Set<string>>(new Set())

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
        const escopo = (r: any) => (!sEmp || sEmp.has(r.empresa_id)) && (!sFil || (r.filial_id && sFil.has(r.filial_id))) && (!sCc || (r.cc_id && sCc.has(r.cc_id))) && anosMeses.has(`${r.ano}-${r.mes}`)

        // ORÇADO por posto (fat_folha tipo ORCADO — por verba, não rateado) + detalhe por verba
        const orcById: Record<string, number> = {}, orcTmp: Record<string, Record<string, VerbaReal>> = {}
        const orcRows = await pageAll(() => {
          let q = supabase.from('fat_folha').select('posto_id,empresa_id,filial_id,cc_id,ano,mes,valor,verba_cod,verba_desc,item_orc_id').eq('tipo', 'ORCADO').eq('versao_id', p.versaoId).in('ano', anos).in('mes', mesesNums)
          if (p.masterIds) q = q.in('item_orc_id', p.masterIds)
          return q
        })
        for (const r of orcRows) {
          if (!escopo(r)) continue
          const pid = r.posto_id || '(sem posto)'
          const v = Number(r.valor) || 0
          orcById[pid] = (orcById[pid] || 0) + v
          const t = (orcTmp[pid] ||= {}); const k = `${r.verba_cod}|${r.item_orc_id}`
          if (t[k]) t[k].valor += v; else t[k] = { verba_cod: r.verba_cod || '', verba_desc: r.verba_desc || '', conta_id: null, item_orc_id: r.item_orc_id || null, valor: v }
        }
        const orcDetail: Record<string, VerbaReal[]> = {}
        for (const pid in orcTmp) orcDetail[pid] = Object.values(orcTmp[pid]).sort((a, b) => b.valor - a.valor)
        // REALIZADO por posto (fat_folha) + detalhe por verba. Item orçamentário:
        // 1º) AUTORITATIVO da folha (fat_folha.item_orc_id = IT_CONTAB_DB, mesma codificação
        //     do orçado) — sem ambiguidade; 2º) FALLBACK por conta_linha (conta→conta_orcamentaria)
        //     quando a folha não traz o item — preferindo o master do orçado se houver várias.
        const realById: Record<string, number> = {}, realTmp: Record<string, Record<string, VerbaReal>> = {}
        const realRows = await pageAll(() => {
          let q = supabase.from('fat_folha').select('posto_id,empresa_id,filial_id,cc_id,ano,mes,valor,verba_cod,verba_desc,conta_id,item_orc_id').in('ano', anos).in('mes', mesesNums)
          if (p.contaIds) q = q.in('conta_id', p.contaIds)
          return q
        })
        // fallback só para as contas cujas linhas NÃO têm item_orc_id na folha
        const fallbackItem: Record<string, string> = { ...(p.contaToItem || {}) }
        if (!p.contaToItem) {
          const semItem = [...new Set(realRows.filter((r: any) => !r.item_orc_id && r.conta_id).map((r: any) => r.conta_id))] as string[]
          if (semItem.length) {
            const orcMasters = new Set<string>()
            for (const pid in orcDetail) for (const x of orcDetail[pid]) if (x.item_orc_id) orcMasters.add(x.item_orc_id)
            const clByConta: Record<string, string[]> = {}
            for (let i = 0; i < semItem.length; i += 300) {
              const { data, error } = await supabase.from('conta_linha').select('conta_id,linha_id').in('conta_id', semItem.slice(i, i + 300))
              if (error) throw error
              for (const r of (data || []) as any[]) { if (r.linha_id) (clByConta[r.conta_id] ||= []).push(r.linha_id) }
            }
            for (const cid in clByConta) { const opts = clByConta[cid]; fallbackItem[cid] = opts.find(o => orcMasters.has(o)) || opts[0] }
          }
        }
        for (const r of realRows) {
          if (!escopo(r)) continue
          const pid = r.posto_id || '(sem posto)'
          const v = Number(r.valor) || 0
          realById[pid] = (realById[pid] || 0) + v
          const t = (realTmp[pid] ||= {}); const k = `${r.verba_cod}|${r.conta_id}`
          if (t[k]) t[k].valor += v; else t[k] = { verba_cod: r.verba_cod || '', verba_desc: r.verba_desc || '', conta_id: r.conta_id || null, item_orc_id: r.item_orc_id || fallbackItem[r.conta_id] || null, valor: v }
        }
        const realDetail: Record<string, VerbaReal[]> = {}
        for (const pid in realTmp) realDetail[pid] = Object.values(realTmp[pid]).sort((a, b) => b.valor - a.valor)

        // lookups: postos + nomes das contas efetivamente usadas
        const ids = [...new Set([...Object.keys(orcById), ...Object.keys(realById)].filter(k => k !== '(sem posto)'))]
        const postoById: Record<string, any> = {}
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await supabase.from('posto').select('id,codigo,nome').in('id', ids.slice(i, i + 300))
          for (const x of data || []) postoById[x.id] = x
        }
        const itemsUsed = [...new Set([
          ...Object.values(orcDetail).flatMap(l => l.map(x => x.item_orc_id).filter(Boolean)),
          ...Object.values(realDetail).flatMap(l => l.map(x => x.item_orc_id).filter(Boolean)),
        ])] as string[]
        const contaUsed = [...new Set(Object.values(realDetail).flatMap(l => l.map(x => x.conta_id).filter(Boolean)))] as string[]
        if (itemsUsed.length) { const { data } = await supabase.from('conta_orcamentaria').select('id,codigo,descricao').in('id', itemsUsed); setContaOrc(Object.fromEntries((data || []).map((c: any) => [c.id, c]))) } else setContaOrc({})
        if (contaUsed.length) { const { data } = await supabase.from('conta_contabil').select('id,codigo,descricao').in('id', contaUsed); setContaCtb(Object.fromEntries((data || []).map((c: any) => [c.id, c]))) } else setContaCtb({})

        const merge: Linha[] = [...new Set([...Object.keys(orcById), ...Object.keys(realById)])].map(pid => {
          const q = postoById[pid]
          return { key: pid, posto_id: pid === '(sem posto)' ? null : pid, codigo: q?.codigo || (pid === '(sem posto)' ? '—' : '?'), nome: q?.nome || (pid === '(sem posto)' ? 'Sem posto (matrícula não casada)' : 'Vaga'), orcado: orcById[pid] || 0, realizado: realById[pid] || 0 }
        })
        setLinhas(merge); setOrcDet(orcDetail); setRealDet(realDetail)
      } catch (e: any) { setErro(e?.message || String(e)) }
      finally { setLoading(false) }
    })()
  }, [p.versaoId, JSON.stringify(p.meses), JSON.stringify(p.masterIds), JSON.stringify(p.contaIds), JSON.stringify(p.empresaSel), JSON.stringify(p.filialFilter), JSON.stringify(p.ccFilter), JSON.stringify(p.contaToItem)]) // eslint-disable-line

  const linhasOrd = useMemo(() => {
    const val = (l: Linha) => ordem.col === 'orcado' ? l.orcado : ordem.col === 'realizado' ? l.realizado : ordem.col === 'codigo' ? l.codigo : (l.orcado - l.realizado)
    return [...linhas].sort((a, b) => { const va = val(a) as any, vb = val(b) as any; return (typeof va === 'string' ? va.localeCompare(vb) : (Math.abs(vb) - Math.abs(va))) * ordem.dir })
  }, [linhas, ordem])
  const tot = useMemo(() => linhas.reduce((s, l) => ({ orc: s.orc + l.orcado, real: s.real + l.realizado }), { orc: 0, real: 0 }), [linhas])
  const sortClick = (col: string) => setOrdem(o => o.col === col ? { col, dir: (o.dir === 1 ? -1 : 1) } : { col, dir: 1 })
  const seta = (col: string) => ordem.col === col ? (ordem.dir === 1 ? ' ↓' : ' ↑') : ''
  const corDelta = (d: number) => Math.abs(d) < 0.005 ? 'var(--muted)' : d < 0 ? 'var(--red)' : 'var(--green)'

  return (
    <>
      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Orçado (postos)</div><div style={S.kpiV}>{milAno(tot.orc)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Realizado (folha)</div><div style={S.kpiV}>{milAno(tot.real)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Δ (orç − real)</div><div style={{ ...S.kpiV, color: corDelta(tot.orc - tot.real) }}>{milAno(tot.orc - tot.real)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Δ%</div><div style={{ ...S.kpiV, color: corDelta(tot.orc - tot.real) }}>{tot.real ? `${((tot.orc - tot.real) / Math.abs(tot.real) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</div></div>
      </div>

      <div style={S.card}>
        <div style={S.cardT}>Por posto <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {linhas.length} posto(s) · clique p/ ver verbas · Δ negativo (vermelho) = realizado acima do orçado</span></div>
        <div style={{ maxHeight: 620, overflow: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th} onClick={() => sortClick('codigo')}>Posto{seta('codigo')}</th>
              <th style={{ ...S.th, cursor: 'default' }}>Ocupante</th>
              <th style={{ ...S.th, textAlign: 'right' }} onClick={() => sortClick('orcado')}>Orçado{seta('orcado')}</th>
              <th style={{ ...S.th, textAlign: 'right' }} onClick={() => sortClick('realizado')}>Realizado{seta('realizado')}</th>
              <th style={{ ...S.th, textAlign: 'right' }} onClick={() => sortClick('delta')}>Δ{seta('delta')}</th>
              <th style={{ ...S.th, textAlign: 'right', cursor: 'default' }}>Δ%</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>Carregando…</td></tr>}
              {!loading && linhasOrd.map(l => { const d = l.orcado - l.realizado; const open = aberto.has(l.key)
                const grupos = (verbas: VerbaReal[]) => {
                  const m = new Map<string, { itemId: string | null; total: number; verbas: VerbaReal[] }>()
                  for (const v of verbas) { const key = v.item_orc_id || '__sem'; const g = m.get(key) || { itemId: v.item_orc_id, total: 0, verbas: [] }; g.total += v.valor; g.verbas.push(v); m.set(key, g) }
                  return [...m.values()].sort((a, b) => !a.itemId ? 1 : !b.itemId ? -1 : (contaOrc[a.itemId]?.codigo || '').localeCompare(contaOrc[b.itemId]?.codigo || ''))
                }
                const col = (gs: ReturnType<typeof grupos>, showConta: boolean) => gs.length ? gs.map((g, gi) => (
                  <div key={gi} style={{ marginBottom: 5 }}>
                    <div style={{ ...S.detRow, fontWeight: 600 }}>
                      <span>{g.itemId ? <><span style={S.mono}>{contaOrc[g.itemId]?.codigo || '—'}</span> {contaOrc[g.itemId]?.descricao || ''}</> : <span style={{ color: 'var(--orange)' }}>⚠ Sem item orçamentário</span>}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(g.total)}</span>
                    </div>
                    {g.verbas.map((v, i) => (<div key={i} style={{ ...S.detRow, paddingLeft: 14, color: 'var(--muted)' }}><span><span style={S.mono}>{v.verba_cod}</span> {v.verba_desc}{showConta && v.conta_id ? <span> · {contaCtb[v.conta_id]?.codigo || '?'}</span> : null}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v.valor)}</span></div>))}
                  </div>
                )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sem lançamento neste escopo.</div>
                return (
                <Fragment key={l.key}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(s => { const n = new Set(s); n.has(l.key) ? n.delete(l.key) : n.add(l.key); return n })}>
                  <td style={{ ...S.td, ...S.mono }}>{open ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />} {l.codigo}</td>
                  <td style={S.td}>{l.nome}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{money(l.orcado)}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{money(l.realizado)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: corDelta(d), fontWeight: 600 }}>{money(d)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: corDelta(d) }}>{l.realizado ? `${(d / Math.abs(l.realizado) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : (l.orcado ? '—' : '')}</td>
                </tr>
                {open && <tr><td colSpan={6} style={{ background: 'var(--bg-soft)', padding: '6px 16px 12px 30px', borderBottom: '1px solid var(--panel-2)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <div>
                      <div style={S.detLbl}>Orçado por item · verba (motor)</div>
                      {col(grupos(orcDet[l.key] || []), false)}
                    </div>
                    <div>
                      <div style={S.detLbl}>Realizado por item · verba (folha)</div>
                      {col(grupos(realDet[l.key] || []), true)}
                    </div>
                  </div>
                </td></tr>}
                </Fragment>
              ) })}
              {!loading && !linhas.length && <tr><td colSpan={6} style={S.empty}>Sem orçado-posto nem realizado-folha neste escopo/competência.</td></tr>}
            </tbody>
            {!loading && linhas.length > 0 && <tfoot><tr>
              <td style={{ ...S.td, fontWeight: 700 }} colSpan={2}>Total</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{money(tot.orc)}</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{money(tot.real)}</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: corDelta(tot.orc - tot.real) }}>{money(tot.orc - tot.real)}</td>
              <td style={S.td} />
            </tr></tfoot>}
          </table>
        </div>
      </div>
    </>
  )
}
