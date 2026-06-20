import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { ResponsiveBar } from '@nivo/bar'
import { X, ChevronRight, Download, FileDown } from 'lucide-react'

declare const XLSX: any

type Props = {
  relId: string
  versaoId: string
  medida: 'Realizado' | 'Orçado'
  empIds: string[]
  anos: number[]
  meses: number[]
  filFilter: string[] | null
  ccFilter: string[] | null
  startNodeId: string
  onClose: () => void
}
type RL = { id: string; pai_id: string | null; tipo_linha: any; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null; desativada: boolean }

const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const fmt2 = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const cut = (s: string, n: number) => (s || '').length > n ? s.slice(0, n) + '…' : (s || '')

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

export default function DrillModal({ relId, versaoId, medida, empIds, anos, meses, filFilter, ccFilter, startNodeId, onClose }: Props) {
  const [tree, setTree] = useState<{ byId: Record<string, RL>; childrenByPai: Record<string, RL[]>; valByMaster: Record<string, number>; disabledMasters: Set<string> } | null>(null)
  const [stack, setStack] = useState<string[]>([startNodeId])
  const [razao, setRazao] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)
  const cur = stack[stack.length - 1]

  // carrega árvore + valores por master (do cubo, mesmos filtros do dash)
  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data: lr } = await supabase.from('relatorio_linha').select('id,pai_id,tipo_linha,natureza,linha_orc_id,descricao,ordem,desativada').eq('relatorio_id', relId)
      const linhas = (lr || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const childrenByPai: Record<string, RL[]> = {}
      linhas.forEach(l => { const k = l.pai_id || '__root'; (childrenByPai[k] = childrenByPai[k] || []).push(l) })
      Object.values(childrenByPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const disabledMasters = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabledMasters.add(l.linha_orc_id) })
      const r = medida === 'Orçado'
        ? await supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter })
        : await supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter })
      const valByMaster: Record<string, number> = {}
      for (const x of r.data || []) valByMaster[x.linha_id] = (valByMaster[x.linha_id] || 0) + (Number(x.valor) || 0)
      setTree({ byId, childrenByPai, valByMaster, disabledMasters })
      setLoading(false)
    })()
  }, [relId]) // eslint-disable-line

  if (!tree) return (
    <div style={S.overlay} onClick={onClose}><div style={S.modal} onClick={e => e.stopPropagation()}><div style={S.body}>Carregando…</div></div></div>
  )
  const { byId, childrenByPai, valByMaster, disabledMasters } = tree

  const natOf = (id: string | null): string | null => { if (!id) return null; const l = byId[id]; if (!l) return null; return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOf(l.pai_id) }
  const facOf = (id: string) => natOf(id) === 'DESPESA' ? -1 : 1
  const childrenOf = (id: string) => (childrenByPai[id] || []).filter(c => c.tipo_linha !== 'ESPACO')
  const subtreeMasters = (id: string): string[] => { const acc: string[] = [], st = [id]; while (st.length) { const n = st.pop()!; const m = byId[n]?.linha_orc_id; if (m && !disabledMasters.has(m)) acc.push(m); childrenOf(n).forEach(c => st.push(c.id)) } return acc }
  const nodeValue = (id: string) => facOf(id) * subtreeMasters(id).reduce((s, m) => s + (valByMaster[m] || 0), 0)

  const abrirRazao = async () => {
    setRazao([]); setLoading(true)
    const masters = subtreeMasters(cur)
    const f = facOf(cur)
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
        else agg.set(k, { conta: '—', contaDesc: '', empresa: empCod[r.empresa_id] || '', filial: filCod[r.filial_id] || '', historico: hist, valor: v })
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
          let q = supabase.from('fat_realizado').select('conta_id,empresa_id,filial_id,historico,valor,lote,sublote').in('conta_id', contaIds).in('empresa_id', empIds).in('ano', anos).in('mes', meses)
          if (filFilter) q = q.in('filial_id', filFilter)
          if (ccFilter) q = q.in('cc_id', ccFilter)
          return q
        })
      }
      for (const r of rows) {
        if (ignora(r)) continue
        const v = f * (Number(r.valor) || 0) * (sinalByConta[r.conta_id] ?? 1)
        const k = `${r.conta_id}|${r.empresa_id || ''}|${r.filial_id || ''}|${r.historico || ''}`
        const c = agg.get(k)
        if (c) c.valor += v
        else agg.set(k, { conta: contaInfo[r.conta_id]?.codigo || '—', contaDesc: contaInfo[r.conta_id]?.descricao || '', empresa: empCod[r.empresa_id] || '', filial: filCod[r.filial_id] || '', historico: r.historico || '', valor: v })
      }
    }
    setRazao(Array.from(agg.values()).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)))
    setLoading(false)
  }

  const exportRazao = () => {
    if (!razao) return
    const aoa = [['Conta', 'Descrição', 'Empresa', 'Filial', 'Histórico', 'Valor'], ...razao.map(r => [r.conta, r.contaDesc, r.empresa, r.filial, r.historico, r.valor])]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Razao'); XLSX.writeFile(wb, 'razao_drill.xlsx')
  }

  const goTo = (i: number) => { setStack(stack.slice(0, i + 1)); setRazao(null) }
  const push = (id: string) => { setStack([...stack, id]); setRazao(null) }

  const filhas = childrenOf(cur).map(c => ({ id: c.id, desc: c.descricao, valor: nodeValue(c.id), temFilhas: childrenOf(c.id).length > 0 })).filter(c => Math.abs(c.valor) > 0.005)
  const chartData = [...filhas].sort((a, b) => a.valor - b.valor).map(c => ({ id: c.id, filha: cut(c.desc, 26), valor: Math.round(c.valor) }))
  const ehFolha = filhas.length === 0
  const somaRazao = razao ? razao.reduce((s, r) => s + (r.valor || 0), 0) : 0

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: medida === 'Orçado' ? '#f1f3f5' : '#e7f5ff', color: medida === 'Orçado' ? '#868e96' : '#1971c2' }}>{medida}</span>
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

          {/* nível com filhas → composição clicável */}
          {!loading && !ehFolha && razao === null && (
            <>
              <div style={{ fontSize: 12, color: '#868e96', marginBottom: 8 }}>Clique numa filha para descer. Total: <strong>{fmt(nodeValue(cur))}</strong></div>
              <div style={{ height: Math.max(180, chartData.length * 30 + 40) }}>
                <ResponsiveBar data={chartData} keys={['valor']} indexBy="filha" layout="horizontal" margin={{ top: 6, right: 26, bottom: 26, left: 170 }}
                  padding={0.28} colors="#3b5bdb" enableGridX valueFormat={(v: any) => fmt(Number(v))} axisBottom={{ format: (v: any) => fmt(Number(v)) }}
                  labelSkipWidth={9999} onClick={(d: any) => { const id = d.data.id; if (childrenOf(id).length) push(id); else { push(id) } }}
                  tooltip={({ data }: any) => <div style={{ background: 'white', padding: '6px 10px', border: '1px solid #e9ecef', borderRadius: 6, fontSize: 12 }}>{data.filha}: <strong>{fmt(data.valor)}</strong> · clique para abrir</div>} />
              </div>
              <table style={S.table}>
                <thead><tr><th style={S.thL}>Filha</th><th style={S.th}>Realizado</th><th style={S.th}></th></tr></thead>
                <tbody>
                  {filhas.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).map(c => (
                    <tr key={c.id} style={S.rowBtn} onClick={() => push(c.id)}>
                      <td style={S.tdL}>{c.desc}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmt(c.valor)}</td>
                      <td style={S.td}><ChevronRight size={14} color="#adb5bd" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* nível folha (sem filhas) → botão para o razão */}
          {!loading && ehFolha && razao === null && (
            <div style={{ textAlign: 'center', padding: '30px 12px' }}>
              <div style={{ fontSize: 14, marginBottom: 6 }}>{byId[cur]?.descricao}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{fmt(nodeValue(cur))}</div>
              <button style={{ ...S.btn, margin: '0 auto', background: '#3b5bdb', color: 'white', borderColor: '#3b5bdb' }} onClick={abrirRazao}><FileDown size={14} /> Ver lançamentos (razão)</button>
            </div>
          )}

          {/* razão */}
          {!loading && razao !== null && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#868e96' }}>Razão de <strong style={{ color: '#212529' }}>{byId[cur]?.descricao}</strong> · {razao.length} item(s) · total <strong style={{ color: '#212529' }}>{fmt(somaRazao)}</strong></span>
                <div style={{ flex: 1 }} />
                <button style={S.btn} onClick={() => setRazao(null)}>Voltar</button>
                <button style={S.btn} onClick={exportRazao}><Download size={13} /> Exportar</button>
              </div>
              <table style={S.table}>
                <thead><tr><th style={S.thL}>Conta</th><th style={S.thL}>Empresa</th><th style={S.thL}>Filial</th><th style={S.thL}>Histórico</th><th style={S.th}>Valor</th></tr></thead>
                <tbody>
                  {razao.length === 0 && <tr><td colSpan={5} style={{ ...S.tdL, textAlign: 'center', color: '#aaa', padding: 24 }}>Sem lançamentos para os filtros.</td></tr>}
                  {razao.map((r, i) => (
                    <tr key={i}>
                      <td style={S.tdL} title={r.contaDesc}>{r.conta}</td>
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
