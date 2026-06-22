import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { ResponsiveBar } from '@nivo/bar'
import { X, ChevronRight, Download, FileDown } from 'lucide-react'

declare const XLSX: any

type Props = {
  relId: string
  versaoId: string
  empIds: string[]
  anos: number[]
  meses: number[]
  filFilter: string[] | null
  ccFilter: string[] | null
  startNodeId: string
  onClose: () => void
}
type Medida = 'Realizado' | 'Orçado'
type RL = { id: string; pai_id: string | null; tipo_linha: any; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null; desativada: boolean; visivel_dashboard?: boolean }

const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const fmt2 = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const cut = (s: string, n: number) => (s || '').length > n ? s.slice(0, n) + '…' : (s || '')
const fmtData = (s: string) => { if (!s) return '—'; const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s) }

async function fetchAll(build: () => any): Promise<any[]> {
  const out: any[] = []; const size = 1000; let from = 0
  for (;;) { const { data, error } = await build().range(from, from + size - 1); if (error || !data || !data.length) break; out.push(...data); if (data.length < size) break; from += size }
  return out
}

const S: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  modal: { background: 'white', borderRadius: 14, width: 820, maxWidth: '94vw', maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.3)' },
  head: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: '1px solid #eef0f2' },
  crumb: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 13, flex: 1 },
  body: { padding: 16, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'right', padding: '7px 10px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  thL: { textAlign: 'left', padding: '7px 10px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td: { textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid #f1f3f5', whiteSpace: 'nowrap' },
  tdL: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #f1f3f5' },
  rowBtn: { cursor: 'pointer' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
}
const crumbItem = (last: boolean): CSSProperties => ({ cursor: last ? 'default' : 'pointer', color: last ? '#212529' : '#3b5bdb', fontWeight: last ? 600 : 400 })

export default function DrillModal({ relId, versaoId, empIds, anos, meses, filFilter, ccFilter, startNodeId, onClose }: Props) {
  const [tree, setTree] = useState<{ byId: Record<string, RL>; childrenByPai: Record<string, RL[]>; valR: Record<string, number>; valO: Record<string, number>; disabledMasters: Set<string> } | null>(null)
  const [stack, setStack] = useState<string[]>([startNodeId])
  const [razao, setRazao] = useState<any[] | null>(null)
  const [razaoMed, setRazaoMed] = useState<Medida>('Realizado')
  const [razaoNode, setRazaoNode] = useState<string>(startNodeId)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'valor', dir: 'desc' })
  const cur = stack[stack.length - 1]
  const sortClick = (col: string) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'valor' ? 'desc' : 'asc' })
  const seta = (col: string) => sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  // carrega árvore + valores por master (orçado E realizado, mesmos filtros do dash)
  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data: lr } = await supabase.from('relatorio_linha').select('id,pai_id,tipo_linha,natureza,linha_orc_id,descricao,ordem,desativada,visivel_dashboard').eq('relatorio_id', relId)
      const linhas = (lr || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const childrenByPai: Record<string, RL[]> = {}
      linhas.forEach(l => { const k = l.pai_id || '__root'; (childrenByPai[k] = childrenByPai[k] || []).push(l) })
      Object.values(childrenByPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const disabledMasters = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabledMasters.add(l.linha_orc_id) })
      const [rR, rO] = await Promise.all([
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
        supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter }),
      ])
      const valR: Record<string, number> = {}, valO: Record<string, number> = {}
      for (const x of rR.data || []) valR[x.linha_id] = (valR[x.linha_id] || 0) + (Number(x.valor) || 0)
      for (const x of rO.data || []) valO[x.linha_id] = (valO[x.linha_id] || 0) + (Number(x.valor) || 0)
      setTree({ byId, childrenByPai, valR, valO, disabledMasters })
      setLoading(false)
    })()
  }, [relId]) // eslint-disable-line

  if (!tree) return (
    <div style={S.overlay} onClick={onClose}><div style={S.modal} onClick={e => e.stopPropagation()}><div style={S.body}>Carregando…</div></div></div>
  )
  const { byId, childrenByPai, valR, valO, disabledMasters } = tree

  const natOf = (id: string | null): string | null => { if (!id) return null; const l = byId[id]; if (!l) return null; return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id) }
  const facOf = (id: string) => natOf(id) === 'DESPESA' ? -1 : 1
  // childrenOf = travessia/totais (inclui ocultas, p/ o total bater com o relatório/EBITDA)
  const childrenOf = (id: string) => (childrenByPai[id] || []).filter(c => c.tipo_linha !== 'ESPACO')
  // childrenVis = exibição (esconde visivel_dashboard=false)
  const childrenVis = (id: string) => childrenOf(id).filter(c => c.visivel_dashboard !== false)
  const subtreeMasters = (id: string): string[] => { const acc: string[] = [], st = [id]; while (st.length) { const n = st.pop()!; const m = byId[n]?.linha_orc_id; if (m && !disabledMasters.has(m)) acc.push(m); childrenOf(n).forEach(c => st.push(c.id)) } return acc }
  const nodeVal = (id: string, vbm: Record<string, number>) => facOf(id) * subtreeMasters(id).reduce((s, m) => s + (vbm[m] || 0), 0)
  const nodeR = (id: string) => nodeVal(id, valR)
  const nodeO = (id: string) => nodeVal(id, valO)

  const abrirRazao = async (med: Medida, nodeId: string) => {
    setRazao([]); setRazaoMed(med); setRazaoNode(nodeId); setLoading(true)
    const masters = subtreeMasters(nodeId)
    const f = facOf(nodeId)
    const medida = med
    const [{ data: emps }, { data: fis }] = await Promise.all([
      supabase.from('empresa').select('id,codigo'), supabase.from('filial').select('id,codigo'),
    ])
    const empCod: Record<string, string> = {}; (emps || []).forEach((e: any) => { empCod[e.id] = e.codigo })
    const filCod: Record<string, string> = {}; (fis || []).forEach((x: any) => { filCod[x.id] = x.codigo })
    const agg = new Map<string, any>()

    if (medida === 'Orçado') {
      // orçado é por LINHA (fat_orcado.linha_id = master), sem conta
      const rows = await fetchAll(() => {
        let q = supabase.from('fat_orcado').select('empresa_id,filial_id,valor,dims').eq('versao_id', versaoId).in('linha_id', masters).in('empresa_id', empIds).in('ano', anos).in('mes', meses)
        if (filFilter) q = q.in('filial_id', filFilter)
        if (ccFilter) q = q.in('cc_id', ccFilter)
        return q
      })
      for (const r of rows) {
        const hist = (r.dims && (r.dims.historico || r.dims.hist)) || ''
        const v = f * (Number(r.valor) || 0)
        const k = `${r.empresa_id || ''}|${r.filial_id || ''}|${hist}`
        const c = agg.get(k)
        if (c) c.valor += v
        else agg.set(k, { conta: '—', contaDesc: '', empresa: empCod[r.empresa_id] || '', filial: filCod[r.filial_id] || '', data: '', documento: '', lote: '', sublote: '', historico: hist, valor: v })
      }
    } else {
      // realizado é por CONTA (resolve via conta_linha) + exclui lotes ignorados
      const links = await fetchAll(() => supabase.from('conta_linha').select('conta_id,sinal, conta_contabil(codigo,descricao)').in('linha_id', masters))
      const sinalByConta: Record<string, number> = {}, contaInfo: Record<string, any> = {}
      for (const l of links as any[]) { sinalByConta[l.conta_id] = l.sinal; contaInfo[l.conta_id] = l.conta_contabil }
      const contaIds = Object.keys(sinalByConta)
      const { data: regras } = await supabase.from('lote_ignorado').select('lote,sublote,empresa_id,por_prefixo').eq('ativo', true)
      const rs = (regras || []) as any[]
      const nl = (s: string) => (s || '').replace(/\s+/g, '').toUpperCase()
      const ignora = (r: any) => !!r.lote && rs.some(g => (g.por_prefixo ? nl(r.lote).startsWith(nl(g.lote)) : nl(g.lote) === nl(r.lote)) && (g.sublote == null || g.sublote === '' || nl(g.sublote) === nl(r.sublote)) && (g.empresa_id == null || g.empresa_id === r.empresa_id))
      let rows: any[] = []
      if (contaIds.length) {
        rows = await fetchAll(() => {
          let q = supabase.from('fat_realizado').select('conta_id,empresa_id,filial_id,historico,valor,lote,sublote,data,documento').in('conta_id', contaIds).in('empresa_id', empIds).in('ano', anos).in('mes', meses)
          if (filFilter) q = q.in('filial_id', filFilter)
          if (ccFilter) q = q.in('cc_id', ccFilter)
          return q
        })
      }
      for (const r of rows) {
        if (ignora(r)) continue
        const v = f * (Number(r.valor) || 0) * (sinalByConta[r.conta_id] ?? 1)
        const k = `${r.conta_id}|${r.empresa_id || ''}|${r.filial_id || ''}|${r.data || ''}|${r.documento || ''}|${r.lote || ''}|${r.sublote || ''}|${r.historico || ''}`
        const c = agg.get(k)
        if (c) c.valor += v
        else agg.set(k, { conta: contaInfo[r.conta_id]?.codigo || '—', contaDesc: contaInfo[r.conta_id]?.descricao || '', empresa: empCod[r.empresa_id] || '', filial: filCod[r.filial_id] || '', data: r.data || '', documento: r.documento || '', lote: r.lote || '', sublote: r.sublote || '', historico: r.historico || '', valor: v })
      }
    }
    setRazao(Array.from(agg.values()).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)))
    setLoading(false)
  }

  const exportRazao = () => {
    if (!razao) return
    const real = razaoMed === 'Realizado'
    const head = real
      ? ['Conta', 'Descrição', 'Data Lcto', 'NumDoc', 'Lote', 'Sublote', 'Empresa', 'Filial', 'Histórico', 'Valor']
      : ['Conta', 'Descrição', 'Empresa', 'Filial', 'Histórico', 'Valor']
    const aoa = [head, ...razao.map(r => real
      ? [r.conta, r.contaDesc, fmtData(r.data), r.documento, r.lote, r.sublote, r.empresa, r.filial, r.historico, r.valor]
      : [r.conta, r.contaDesc, r.empresa, r.filial, r.historico, r.valor])]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Razao'); XLSX.writeFile(wb, 'razao_drill.xlsx')
  }

  const goTo = (i: number) => { setStack(stack.slice(0, i + 1)); setRazao(null) }
  const push = (id: string) => { setStack([...stack, id]); setRazao(null) }

  const filhas = childrenVis(cur).map(c => ({ id: c.id, desc: c.descricao, R: nodeR(c.id), O: nodeO(c.id), temFilhas: childrenVis(c.id).length > 0 }))
    .filter(c => Math.abs(c.R) > 0.005 || Math.abs(c.O) > 0.005)
    .sort((a, b) => Math.abs(b.R) - Math.abs(a.R))   // do maior pro menor pelo Realizado
  const filhasOcultas = childrenOf(cur).length - childrenVis(cur).length
  // gráfico ascendente (barra horizontal cresce de baixo p/ cima)
  const chartData = [...filhas].reverse().map(c => ({ id: c.id, filha: cut(c.desc, 26), 'Orçado': Math.round(c.O), 'Realizado': Math.round(c.R) }))
  const ehFolha = filhas.length === 0
  const somaRazao = razao ? razao.reduce((s, r) => s + (r.valor || 0), 0) : 0

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <div style={S.crumb}>
            {stack.map((id, i) => (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <ChevronRight size={13} color="#adb5bd" />}
                <span style={crumbItem(i === stack.length - 1)} onClick={() => i < stack.length - 1 && goTo(i)}>{cut(byId[id]?.descricao || '—', 30)}</span>
              </span>
            ))}
          </div>
          <X size={18} style={{ cursor: 'pointer', color: '#adb5bd' }} onClick={onClose} />
        </div>

        <div style={S.body}>
          {loading && <div style={{ color: '#868e96', fontSize: 13 }}>Carregando…</div>}

          {/* nível com filhas → composição clicável (orçado × realizado) */}
          {!loading && !ehFolha && razao === null && (
            <>
              <div style={{ fontSize: 12, color: '#868e96', marginBottom: 8 }}>
                Clique no nome para descer; clique numa barra/valor para o razão. Total — Orçado: <strong>{fmt(nodeO(cur))}</strong> · Realizado: <strong>{fmt(nodeR(cur))}</strong>
                {filhasOcultas > 0 && <span title="Há linhas marcadas como não visíveis no dashboard. Elas continuam no total acima, por isso as filhas listadas podem não somar o total." style={{ marginLeft: 8, fontWeight: 600, color: '#7048e8', border: '1px solid #d0bfff', borderRadius: 4, padding: '1px 6px' }}>+{filhasOcultas} oculta{filhasOcultas > 1 ? 's' : ''}</span>}
              </div>
              <div style={{ height: Math.max(200, chartData.length * 40 + 50) }}>
                <ResponsiveBar data={chartData} keys={['Orçado', 'Realizado']} indexBy="filha" layout="horizontal" groupMode="grouped"
                  margin={{ top: 6, right: 26, bottom: 26, left: 180 }} padding={0.25} innerPadding={2} colors={['#adb5bd', '#3b5bdb']} enableGridX
                  valueFormat={(v: any) => fmt(Number(v))} axisBottom={{ format: (v: any) => fmt(Number(v)) }} labelSkipWidth={9999}
                  onClick={(d: any) => { const id = d.data.id; const med: Medida = d.id === 'Orçado' ? 'Orçado' : 'Realizado'; if (childrenVis(id).length) push(id); else abrirRazao(med, id) }}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]}
                  tooltip={({ id, value, data }: any) => <div style={{ background: 'white', padding: '6px 10px', border: '1px solid #e9ecef', borderRadius: 6, fontSize: 12 }}>{data.filha} · {id}: <strong>{fmt(Number(value))}</strong></div>} />
              </div>
              <table style={S.table}>
                <thead><tr><th style={S.thL}>Filha</th><th style={S.th}>Orçado</th><th style={S.th}>Realizado</th><th style={S.th}>Δ</th><th style={S.th}></th></tr></thead>
                <tbody>
                  {filhas.map(c => { const d = c.R - c.O; return (
                    <tr key={c.id}>
                      <td style={{ ...S.tdL, ...S.rowBtn }} title={c.temFilhas ? 'Descer' : 'Folha'} onClick={() => c.temFilhas && push(c.id)}>{c.temFilhas && <ChevronRight size={12} color="#adb5bd" style={{ verticalAlign: 'middle' }} />} {c.desc}</td>
                      <td style={{ ...S.td, ...S.rowBtn, color: '#868e96' }} title="Razão do orçado" onClick={() => abrirRazao('Orçado', c.id)}>{fmt(c.O)}</td>
                      <td style={{ ...S.td, ...S.rowBtn, fontWeight: 600, color: '#1971c2' }} title="Razão do realizado" onClick={() => abrirRazao('Realizado', c.id)}>{fmt(c.R)}</td>
                      <td style={{ ...S.td, fontWeight: 600, color: d >= 0 ? '#2f9e44' : '#e03131' }} title="Realizado − Orçado">{(d >= 0 ? '+' : '') + fmt(d)}</td>
                      <td style={{ ...S.td, ...S.rowBtn }} onClick={() => c.temFilhas ? push(c.id) : abrirRazao('Realizado', c.id)}><ChevronRight size={14} color="#adb5bd" /></td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </>
          )}

          {/* nível folha (sem filhas) → botões para o razão de cada medida */}
          {!loading && ehFolha && razao === null && (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              <div style={{ fontSize: 14, marginBottom: 10 }}>{byId[cur]?.descricao}</div>
              <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 18 }}>
                <div><div style={{ fontSize: 11, color: '#868e96' }}>Orçado</div><div style={{ fontSize: 20, fontWeight: 700, color: '#495057' }}>{fmt(nodeO(cur))}</div></div>
                <div><div style={{ fontSize: 11, color: '#868e96' }}>Realizado</div><div style={{ fontSize: 20, fontWeight: 700, color: '#1971c2' }}>{fmt(nodeR(cur))}</div></div>
                {(() => { const d = nodeR(cur) - nodeO(cur); return <div><div style={{ fontSize: 11, color: '#868e96' }}>Δ</div><div style={{ fontSize: 20, fontWeight: 700, color: d >= 0 ? '#2f9e44' : '#e03131' }}>{(d >= 0 ? '+' : '') + fmt(d)}</div></div> })()}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button style={S.btn} onClick={() => abrirRazao('Orçado', cur)}><FileDown size={14} /> Razão do orçado</button>
                <button style={{ ...S.btn, background: '#3b5bdb', color: 'white', borderColor: '#3b5bdb' }} onClick={() => abrirRazao('Realizado', cur)}><FileDown size={14} /> Razão do realizado</button>
              </div>
            </div>
          )}

          {/* razão */}
          {!loading && razao !== null && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: razaoMed === 'Orçado' ? '#f1f3f5' : '#e7f5ff', color: razaoMed === 'Orçado' ? '#868e96' : '#1971c2' }}>{razaoMed}</span>
                <span style={{ fontSize: 13, color: '#868e96' }}>Razão de <strong style={{ color: '#212529' }}>{byId[razaoNode]?.descricao}</strong> · {razao.length} item(s) · total <strong style={{ color: '#212529' }}>{fmt(somaRazao)}</strong></span>
                <div style={{ flex: 1 }} />
                <button style={S.btn} onClick={() => setRazao(null)}>Voltar</button>
                <button style={S.btn} onClick={exportRazao}><Download size={13} /> Exportar</button>
              </div>
              <table style={S.table}>
                <thead><tr>
                  <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('conta')}>Conta{seta('conta')}</th>
                  {razaoMed === 'Realizado' && <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('contaDesc')}>Descrição{seta('contaDesc')}</th>}
                  {razaoMed === 'Realizado' && <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('data')}>Data Lcto{seta('data')}</th>}
                  {razaoMed === 'Realizado' && <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('documento')}>NumDoc{seta('documento')}</th>}
                  {razaoMed === 'Realizado' && <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('lote')}>Lote{seta('lote')}</th>}
                  {razaoMed === 'Realizado' && <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('sublote')}>Sublote{seta('sublote')}</th>}
                  <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('empresa')}>Empresa{seta('empresa')}</th>
                  <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('filial')}>Filial{seta('filial')}</th>
                  <th style={{ ...S.thL, cursor: 'pointer' }} onClick={() => sortClick('historico')}>Histórico{seta('historico')}</th>
                  <th style={{ ...S.th, cursor: 'pointer' }} onClick={() => sortClick('valor')}>Valor{seta('valor')}</th>
                </tr></thead>
                <tbody>
                  {razao.length === 0 && <tr><td colSpan={razaoMed === 'Realizado' ? 10 : 5} style={{ ...S.tdL, textAlign: 'center', color: '#aaa', padding: 24 }}>Sem lançamentos para os filtros.</td></tr>}
                  {[...razao].sort((a, b) => { const s = sort.col === 'valor' ? (a.valor - b.valor) : String(a[sort.col] || '').localeCompare(String(b[sort.col] || ''), 'pt'); return sort.dir === 'asc' ? s : -s }).map((r, i) => (
                    <tr key={i}>
                      <td style={S.tdL} title={r.contaDesc}>{r.conta}</td>
                      {razaoMed === 'Realizado' && <td style={S.tdL} title={r.contaDesc}>{cut(r.contaDesc, 34) || '—'}</td>}
                      {razaoMed === 'Realizado' && <td style={S.tdL}>{fmtData(r.data)}</td>}
                      {razaoMed === 'Realizado' && <td style={S.tdL}>{r.documento || '—'}</td>}
                      {razaoMed === 'Realizado' && <td style={S.tdL}>{r.lote || '—'}</td>}
                      {razaoMed === 'Realizado' && <td style={S.tdL}>{r.sublote || '—'}</td>}
                      <td style={S.tdL}>{r.empresa || '—'}</td>
                      <td style={S.tdL}>{r.filial || '—'}</td>
                      <td style={S.tdL}>{cut(r.historico, 40) || '—'}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmt2(r.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
