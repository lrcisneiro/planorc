import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { ArrowRight, Link2, Trash2, Search, Check, Download, Upload, RefreshCw } from 'lucide-react'

declare const XLSX: any
function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'DE-PARA'); XLSX.writeFile(wb, filename)
}
function readWorkbook(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = e => { try { resolve(XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array', dense: true })) } catch (err) { reject(err) } }
    r.onerror = reject; r.readAsArrayBuffer(file)
  })
}
const normC = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

// rótulo de apoio por 1º dígito do código contábil (varia por ERP — é só uma dica visual)
const GRUPO_LABEL: Record<string, string> = { '1': 'Ativo', '2': 'Passivo', '3': 'Receita', '4': 'Despesa' }

type Rel = { id: string; nome: string }
type Plano = { id: string; codigo: string; nome: string }
type Conta = { id: string; codigo: string; descricao: string; tipo?: string; pai_id?: string | null }
type RL = { id: string; codigo: string; descricao: string; linha_orc_id: string | null; tipo_linha: string; pai_id: string | null; ordem: number | null }
type Link = { id: string; conta_id: string; linha_id: string; sinal: number; conta_contabil?: any }

// Monta a árvore na ordem do relatório (pai → filhos por 'ordem'), com profundidade p/ indentação.
function buildTree(all: RL[], paiId: string | null = null, depth = 0): { l: RL; depth: number }[] {
  return all.filter(x => (x.pai_id || null) === paiId)
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
    .flatMap(x => [{ l: x, depth }, ...buildTree(all, x.id, depth + 1)])
}

async function fetchAll(q: () => any): Promise<any[]> {
  const out: any[] = []; let from = 0; const size = 1000
  while (true) { const { data, error } = await q().range(from, from + size - 1); if (error) throw error; out.push(...(data || [])); if (!data || data.length < size) break; from += size }
  return out
}

const S: Record<string, CSSProperties> = {
  page:   { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)', fontFamily: 'system-ui, sans-serif' },
  bar:    { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 },
  title:  { fontSize: 16, fontWeight: 600, color: 'var(--text)', marginRight: 8, display: 'flex', alignItems: 'center', gap: 8 },
  sel:    { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', color: 'var(--text-mid)' },
  btn:    { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  body:   { flex: 1, display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 0, overflow: 'hidden' },
  pane:   { display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--panel)', margin: 12, borderRadius: 12, border: '1px solid var(--border)' },
  paneH:  { padding: '10px 14px', borderBottom: '1px solid var(--panel)', fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  list:   { flex: 1, overflowY: 'auto', padding: 6 },
  mid:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 },
  arrowB: { width: 48, height: 48, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' },
  search: { width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box', margin: '8px 0' },
  row:    { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, borderRadius: 6, cursor: 'pointer' },
  code:   { fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', minWidth: 96 },
  badge:  { fontSize: 10, color: 'var(--blue)', background: 'rgba(59,130,246,0.16)', borderRadius: 4, padding: '1px 5px' },
}

export default function AmarracaoPage() {
  const [rels, setRels] = useState<Rel[]>([])
  const [planos, setPlanos] = useState<Plano[]>([])
  const [relId, setRelId] = useState('')
  const [planoId, setPlanoId] = useState('')
  const [contas, setContas] = useState<Conta[]>([])
  const [linhas, setLinhas] = useState<RL[]>([])
  const [links, setLinks] = useState<Link[]>([])     // conta_linha do relatório (por master)
  const [amarradas, setAmarradas] = useState<Set<string>>(new Set())  // conta_id amarrado em qualquer lugar
  const [buscaC, setBuscaC] = useState('')
  const [buscaL, setBuscaL] = useState('')
  const [selContas, setSelContas] = useState<Set<string>>(new Set())
  const [selLinha, setSelLinha] = useState<string>('')  // relatorio_linha id (alvo)
  const [soNaoAmarradas, setSoNaoAmarradas] = useState(false)
  const [soComMov, setSoComMov] = useState(false)
  const [movSet, setMovSet] = useState<Set<string>>(new Set())   // contas com lançamento no realizado
  const [grupos, setGrupos] = useState<Set<string>>(new Set())   // 1º dígito do código selecionado(s)
  const [msg, setMsg] = useState('')
  const [modoImp, setModoImp] = useState<'add' | 'full'>('full')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('relatorio').select('id,nome').order('nome').then(r => { setRels(r.data || []); if (r.data?.length) setRelId(p => p || r.data![0].id) })
    supabase.from('plano_contas').select('id,codigo,nome').order('codigo').then(r => { setPlanos(r.data || []); if (r.data?.length) setPlanoId(p => p || r.data![0].id) })
    supabase.from('conta_linha').select('conta_id').then(r => setAmarradas(new Set((r.data || []).map((x: any) => x.conta_id))))
    supabase.rpc('contas_com_movimento').then((r: any) => { if (!r.error) setMovSet(new Set((r.data || []).map((x: any) => x.conta_id))) })
  }, [])

  useEffect(() => { if (planoId) fetchAll(() => supabase.from('conta_contabil').select('id,codigo,descricao,tipo,pai_id').eq('plano_id', planoId).order('codigo')).then(setContas) }, [planoId])

  const masters = () => linhas.filter(l => l.tipo_linha === 'ANALITICA' && l.linha_orc_id).map(l => l.linha_orc_id) as string[]
  const loadLinks = async () => {
    const ms = masters(); if (!ms.length) { setLinks([]); return }
    const rows = await fetchAll(() => supabase.from('conta_linha').select('id,conta_id,linha_id,sinal, conta_contabil(codigo,descricao)').in('linha_id', ms))
    setLinks(rows)
  }
  useEffect(() => {
    if (!relId) return
    fetchAll(() => supabase.from('relatorio_linha').select('id,codigo,descricao,linha_orc_id,tipo_linha,pai_id,ordem').eq('relatorio_id', relId).order('ordem', { nullsFirst: false }))
      .then(ls => setLinhas(ls))
  }, [relId])
  useEffect(() => { loadLinks() }, [linhas]) // eslint-disable-line

  const linksByMaster: Record<string, Link[]> = {}
  links.forEach(l => { (linksByMaster[l.linha_id] = linksByMaster[l.linha_id] || []).push(l) })
  const amarradasRel = new Set(links.map(l => l.conta_id))  // contas amarradas NESTE relatório
  const masterOfSel = linhas.find(l => l.id === selLinha)?.linha_orc_id || ''

  const cb = buscaC.trim().toLowerCase()
  const gruposDisp = [...new Set(contas.map(c => (c.codigo || '').trim().charAt(0)).filter(Boolean))].sort()
  const isSint = (c: Conta) => c.tipo === 'SINTETICA'
  // filtros de nível analítico (movimento/amarrada/grupo). Sintética só filtra por grupo.
  const passa = (c: Conta) => {
    if (grupos.size && !grupos.has((c.codigo || '').trim().charAt(0))) return false
    if (isSint(c)) return true
    if (soNaoAmarradas && amarradasRel.has(c.id)) return false
    if (soComMov && !movSet.has(c.id)) return false
    return true
  }
  const childrenByPai: Record<string, Conta[]> = {}; contas.forEach(c => { const p = c.pai_id || '_'; (childrenByPai[p] = childrenByPai[p] || []).push(c) })
  const descAnalit = (id: string): Conta[] => { const out: Conta[] = []; const st = [...(childrenByPai[id] || [])]; while (st.length) { const n = st.pop()!; if (isSint(n)) (childrenByPai[n.id] || []).forEach(x => st.push(x)); else out.push(n) } return out }
  const selecionaveis = (c: Conta) => descAnalit(c.id).filter(passa)   // analíticas filhas que passam nos filtros
  const contasF = contas.filter(c => passa(c) && (!cb || c.codigo.toLowerCase().includes(cb) || c.descricao.toLowerCase().includes(cb))).slice(0, 500)
  const toggleGrupo = (g: string) => setGrupos(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n })
  // clique numa conta: analítica alterna ela; sintética alterna todas as analíticas filhas
  const clickConta = (c: Conta) => {
    if (!isSint(c)) { toggleConta(c.id); return }
    const ds = selecionaveis(c).map(d => d.id)
    if (!ds.length) return
    setSelContas(prev => { const n = new Set(prev); const allOn = ds.every(id => n.has(id)); ds.forEach(id => allOn ? n.delete(id) : n.add(id)); return n })
  }
  const estadoSint = (c: Conta) => { const ds = selecionaveis(c).map(d => d.id); if (!ds.length) return 'none'; const on = ds.filter(id => selContas.has(id)).length; return on === 0 ? 'none' : on === ds.length ? 'all' : 'some' }
  const lb = buscaL.trim().toLowerCase()
  const ordered = buildTree(linhas)
  const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
  let visible = ordered
  if (lb) {
    const keep = new Set<string>()
    linhas.forEach(l => { if (`${l.codigo} ${l.descricao}`.toLowerCase().includes(lb)) { let cur: RL | undefined = l; while (cur) { keep.add(cur.id); cur = cur.pai_id ? byId[cur.pai_id] : undefined } } })
    visible = ordered.filter(o => keep.has(o.l.id))
  }

  const toggleConta = (id: string) => setSelContas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const amarrar = async () => {
    if (!masterOfSel || !selContas.size) return
    const ex = new Set((linksByMaster[masterOfSel] || []).map(l => l.conta_id))
    const novos = [...selContas].filter(c => !ex.has(c))
    if (!novos.length) { setMsg('Todas as contas marcadas já estavam amarradas a esta linha.'); return }
    const { error } = await supabase.from('conta_linha').insert(novos.map(c => ({ tenant_id: TENANT_ID, conta_id: c, linha_id: masterOfSel, sinal: 1 })))
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg(`${novos.length} conta(s) amarrada(s).`)
    setSelContas(new Set())
    setAmarradas(prev => { const n = new Set(prev); novos.forEach(c => n.add(c)); return n })
    loadLinks()
  }
  const removeLink = async (id: string) => { await supabase.from('conta_linha').delete().eq('id', id); loadLinks(); setAmarradas(new Set([...amarradas])) }
  const toggleSinal = async (id: string, sinal: number) => { await supabase.from('conta_linha').update({ sinal }).eq('id', id); loadLinks() }
  // o cubo do realizado depende do DE-PARA → recalcular após mudanças de amarração
  const recalcular = async () => {
    setMsg('Recalculando agregados…')
    const { error } = await supabase.rpc('refresh_realizado_mensal')
    setMsg(error ? 'Erro ao recalcular: ' + error.message : 'Agregados do realizado recalculados.')
  }

  // ── Exportar / Importar DE-PARA (conta contábil → conta orçamentária), independente de relatório
  const exportar = async () => {
    setMsg('Exportando…')
    const [links, contasAll, planosAll, orc] = await Promise.all([
      fetchAll(() => supabase.from('conta_linha').select('conta_id,linha_id,sinal')),
      fetchAll(() => supabase.from('conta_contabil').select('id,codigo,descricao,plano_id')),
      fetchAll(() => supabase.from('plano_contas').select('id,codigo')),
      fetchAll(() => supabase.from('conta_orcamentaria').select('id,codigo,descricao')),
    ])
    const cById: Record<string, any> = {}; contasAll.forEach((c: any) => { cById[c.id] = c })
    const pById: Record<string, string> = {}; planosAll.forEach((p: any) => { pById[p.id] = p.codigo })
    const oById: Record<string, any> = {}; orc.forEach((o: any) => { oById[o.id] = o })
    const aoa: any[][] = [['plano_codigo', 'conta_codigo', 'conta_descricao', 'conta_orc_codigo', 'conta_orc_descricao', 'sinal']]
    for (const l of links) {
      const c = cById[l.conta_id], o = oById[l.linha_id]
      aoa.push([pById[c?.plano_id] || '', c?.codigo || '', c?.descricao || '', o?.codigo || '', o?.descricao || '', l.sinal])
    }
    downloadSheet('de_para_amarracoes.xlsx', aoa)
    setMsg(`${links.length} amarração(ões) exportada(s).`)
  }
  const baixarModelo = () => downloadSheet('modelo_de_para.xlsx', [
    ['plano_codigo', 'conta_codigo', 'conta_orc_codigo', 'sinal'],
    ['TOTVS', '1.01.01.001', '11', 1],
    ['TOTVS', '2.01.01.001', '21', -1],
  ])
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) await importar(f); if (fileRef.current) fileRef.current.value = '' }
  const importar = async (file: File) => {
    setMsg('Importando…')
    try {
      const wb = await readWorkbook(file)
      const sn = wb.SheetNames.find((n: string) => /conta|de.?para|mapa|amarr/i.test(n)) || wb.SheetNames[0]
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }) as any[]
      if (!rows.length) { setMsg('Arquivo vazio.'); return }
      const get = (r: any, ...ks: string[]) => { for (const k of ks) { const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()]; if (v !== undefined && v !== '') return String(v).trim() } return '' }
      const [contasAll, planosAll, orc] = await Promise.all([
        fetchAll(() => supabase.from('conta_contabil').select('id,codigo,plano_id')),
        fetchAll(() => supabase.from('plano_contas').select('id,codigo')),
        fetchAll(() => supabase.from('conta_orcamentaria').select('id,codigo')),
      ])
      const planoIdByCod: Record<string, string> = {}, planoCodById: Record<string, string> = {}; planosAll.forEach((p: any) => { planoIdByCod[normC(p.codigo)] = p.id; planoCodById[p.id] = p.codigo })
      const planoUnico = planosAll.length === 1 ? planosAll[0].id : null
      const contaMap: Record<string, string> = {}; contasAll.forEach((c: any) => { contaMap[`${c.plano_id}|${normC(c.codigo)}`] = c.id })
      const orcMap: Record<string, string> = {}; orc.forEach((o: any) => { orcMap[normC(o.codigo)] = o.id })
      const dedup = new Map<string, any>(); const faltaC = new Set<string>(), faltaO = new Set<string>(); let ign = 0
      const planosPres = new Set<string>()
      for (const r of rows) {
        const planoCod = get(r, 'plano_codigo', 'plano', 'erp')
        const contaCod = get(r, 'conta_codigo', 'conta', 'conta_contabil')
        const orcCod = get(r, 'conta_orc_codigo', 'conta_orcamentaria', 'linha_codigo', 'linha', 'item')
        const sinalRaw = get(r, 'sinal', 'sin')
        if (!contaCod && !orcCod) continue
        const planoId = planoCod ? planoIdByCod[normC(planoCod)] : planoUnico
        const conta_id = planoId ? contaMap[`${planoId}|${normC(contaCod)}`] : undefined
        const linha_id = orcMap[normC(orcCod)]
        if (!conta_id) { faltaC.add(contaCod || '(vazio)'); ign++; continue }
        if (!linha_id) { faltaO.add(orcCod || '(vazio)'); ign++; continue }
        if (planoId) planosPres.add(planoId)
        const sinal = /^-|^−/.test(sinalRaw) || sinalRaw === '-1' ? -1 : 1
        dedup.set(`${conta_id}|${linha_id}`, { tenant_id: TENANT_ID, conta_id, linha_id, sinal })
      }
      const payload = [...dedup.values()]
      if (!payload.length) { setMsg(`Nenhuma amarração válida.${faltaC.size ? ` Contas: ${[...faltaC].slice(0, 6).join(', ')}.` : ''}${faltaO.size ? ` Contas orç.: ${[...faltaO].slice(0, 6).join(', ')}.` : ''}`); return }

      // FULL: substitui as amarrações dos PLANOS presentes no arquivo (remove as que não vieram)
      if (modoImp === 'full') {
        const planosLbl = [...planosPres].map(p => planoCodById[p] || p).join(', ')
        if (!confirm(`Substituir (full) vai APAGAR todas as amarrações das contas dos planos: ${planosLbl}\ne recriar a partir do arquivo (${payload.length} linhas).\n\nConfirmar?`)) { setMsg('Importação cancelada.'); return }
        const alvo = contasAll.filter((c: any) => planosPres.has(c.plano_id)).map((c: any) => c.id)
        for (let i = 0; i < alvo.length; i += 300) {
          const { error } = await supabase.from('conta_linha').delete().in('conta_id', alvo.slice(i, i + 300))
          if (error) throw error
        }
      }

      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from('conta_linha').upsert(payload.slice(i, i + 500), { onConflict: 'conta_id,linha_id' })
        if (error) throw error
      }
      // recarrega o conjunto global de amarradas (mudou no full)
      supabase.from('conta_linha').select('conta_id').then((r: any) => setAmarradas(new Set((r.data || []).map((x: any) => x.conta_id))))
      loadLinks()
      setMsg(`${payload.length} amarração(ões) importada(s)${modoImp === 'full' ? ' (substituição por plano)' : ''}${ign ? `, ${ign} ignorada(s)` : ''}.` + (faltaC.size ? ` ⚠ contas não encontradas: ${[...faltaC].slice(0, 6).join(', ')}` : '') + (faltaO.size ? ` ⚠ contas orç. não encontradas: ${[...faltaO].slice(0, 6).join(', ')}` : ''))
    } catch (e: any) { setMsg('Erro ao importar: ' + (e?.message ?? String(e))) }
  }

  return (
    <div style={S.page}>
      <div style={S.bar}>
        <span style={S.title}><Link2 size={18} /> Amarração de contas</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Plano (contas):</span>
        <select style={S.sel} value={planoId} onChange={e => { setPlanoId(e.target.value); setSelContas(new Set()) }}>
          {planos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Relatório (destino):</span>
        <select style={S.sel} value={relId} onChange={e => { setRelId(e.target.value); setSelLinha('') }}>
          {rels.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 12, color: 'var(--green)' }}>{msg}</span>}
        <button style={S.btn} onClick={recalcular} title="Recalcular os agregados do realizado (cubos) — necessário após mudar amarrações"><RefreshCw size={13} /> Recalcular</button>
        <button style={S.btn} onClick={baixarModelo} title="Baixar modelo do DE-PARA"><Download size={13} /> Modelo</button>
        <button style={S.btn} onClick={exportar} title="Exportar todas as amarrações"><Download size={13} /> Exportar</button>
        <select style={S.sel} value={modoImp} onChange={e => setModoImp(e.target.value as 'add' | 'full')} title="Modo de importação">
          <option value="full">Substituir (full por plano)</option>
          <option value="add">Adicionar/atualizar</option>
        </select>
        <button style={S.btn} onClick={() => fileRef.current?.click()} title="Importar amarrações (DE-PARA)"><Upload size={13} /> Importar</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
      </div>

      <div style={S.body}>
        {/* ESQUERDA: contas contábeis */}
        <div style={S.pane}>
          <div style={S.paneH}>
            <span>Contas contábeis ({contasF.length})</span>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 400 }}>
                <input type="checkbox" checked={soComMov} onChange={e => setSoComMov(e.target.checked)} /> com movimento
              </label>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 400 }}>
                <input type="checkbox" checked={soNaoAmarradas} onChange={e => setSoNaoAmarradas(e.target.checked)} /> só não amarradas
              </label>
            </div>
          </div>
          <div style={{ padding: '0 10px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: 17, color: 'var(--border-strong)' }} />
              <input style={{ ...S.search, paddingLeft: 26 }} placeholder="buscar conta..." value={buscaC} onChange={e => setBuscaC(e.target.value)} />
            </div>
            {gruposDisp.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {gruposDisp.map(g => { const on = grupos.has(g); return (
                  <button key={g} onClick={() => toggleGrupo(g)} title={GRUPO_LABEL[g] || ('Grupo ' + g)}
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, cursor: 'pointer', border: '1px solid ' + (on ? 'var(--violet)' : 'var(--border-strong)'), background: on ? 'var(--violet)' : 'var(--panel)', color: on ? 'var(--panel)' : 'var(--text-mid)' }}>
                    {g}{GRUPO_LABEL[g] ? ` · ${GRUPO_LABEL[g]}` : ''}
                  </button>) })}
                {grupos.size > 0 && <button onClick={() => setGrupos(new Set())} style={{ fontSize: 11, padding: '2px 8px', border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>limpar</button>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, fontSize: 12, marginBottom: 4 }}>
              <button onClick={() => setSelContas(prev => { const n = new Set(prev); contasF.filter(c => !isSint(c)).forEach(c => n.add(c.id)); return n })} style={{ background: 'none', border: 'none', color: 'var(--violet)', cursor: 'pointer', padding: 0 }}>Marcar visíveis</button>
              {selContas.size > 0 && <button onClick={() => setSelContas(new Set())} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}>Limpar ({selContas.size})</button>}
            </div>
          </div>
          <div style={S.list}>
            {contasF.map(c => {
              const sint = isSint(c)
              const est = sint ? estadoSint(c) : (selContas.has(c.id) ? 'all' : 'none')
              const on = est === 'all'; const am = amarradas.has(c.id)
              return (
                <div key={c.id} onClick={() => clickConta(c)} style={{ ...S.row, background: on ? 'rgba(139,92,246,0.14)' : est === 'some' ? 'rgba(139,92,246,0.08)' : 'transparent' }}>
                  <input type="checkbox" checked={on} ref={el => { if (el) el.indeterminate = est === 'some' }} readOnly />
                  <span style={S.code}>{c.codigo}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: sint ? 600 : 400, color: sint ? 'var(--blue)' : undefined }}>{c.descricao}</span>
                  {sint
                    ? <span title="sintética — marca as analíticas filhas" style={{ fontSize: 10, color: 'var(--blue)', background: 'rgba(59,130,246,0.16)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>sint · {selecionaveis(c).length}</span>
                    : (am ? <span title="já amarrada" style={{ color: 'var(--green)', display: 'flex' }}><Check size={14} /></span> : <span style={{ fontSize: 10, color: 'var(--border-strong)' }}>—</span>)}
                </div>)
            })}
            {!contasF.length && <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>Nenhuma conta.</div>}
          </div>
        </div>

        {/* MEIO: seta */}
        <div style={S.mid}>
          <button onClick={amarrar} disabled={!masterOfSel || !selContas.size}
            title={!masterOfSel ? 'Selecione uma linha à direita' : !selContas.size ? 'Marque contas à esquerda' : 'Amarrar'}
            style={{ ...S.arrowB, background: (masterOfSel && selContas.size) ? 'var(--violet)' : 'var(--border-strong)', cursor: (masterOfSel && selContas.size) ? 'pointer' : 'default' }}>
            <ArrowRight size={22} />
          </button>
          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', maxWidth: 60 }}>{selContas.size || 0} → linha</div>
        </div>

        {/* DIREITA: relatório */}
        <div style={S.pane}>
          <div style={S.paneH}><span>Estrutura do relatório ({visible.length})</span><span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>clique numa linha analítica</span></div>
          <div style={{ padding: '0 10px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: 17, color: 'var(--border-strong)' }} />
              <input style={{ ...S.search, paddingLeft: 26 }} placeholder="buscar linha..." value={buscaL} onChange={e => setBuscaL(e.target.value)} />
            </div>
          </div>
          <div style={S.list}>
            {visible.map(({ l, depth }) => {
              const analitica = l.tipo_linha === 'ANALITICA' && !!l.linha_orc_id
              const ind = 6 + depth * 16
              if (!analitica) {
                // linha de hierarquia / totalizador — só leitura
                return (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', paddingLeft: ind, fontSize: 13, fontWeight: 600, color: l.tipo_linha === 'ESPACO' ? 'var(--border-strong)' : 'var(--blue)' }}>
                    <span style={{ ...S.code, minWidth: 80 }}>{l.codigo}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.descricao}</span>
                  </div>
                )
              }
              const sel = l.id === selLinha
              const ls = linksByMaster[l.linha_orc_id || ''] || []
              return (
                <div key={l.id} style={{ marginLeft: ind, border: '1px solid ' + (sel ? 'var(--violet)' : 'var(--panel)'), borderRadius: 8, marginBottom: 4, overflow: 'hidden' }}>
                  <div onClick={() => setSelLinha(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 13, background: sel ? 'rgba(139,92,246,0.14)' : 'var(--panel)' }}>
                    <span style={{ ...S.code, minWidth: 80 }}>{l.codigo}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.descricao}</span>
                    <span style={{ fontSize: 11, color: ls.length ? 'var(--green)' : 'var(--border-strong)' }}>{ls.length ? `🔗 ${ls.length}` : 'sem contas'}</span>
                  </div>
                  {ls.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 22px', fontSize: 12, borderTop: '1px solid var(--bg)', background: 'var(--bg-soft)' }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--muted)', minWidth: 90 }}>{m.conta_contabil?.codigo}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.conta_contabil?.descricao}</span>
                      <button onClick={() => toggleSinal(m.id, m.sinal === 1 ? -1 : 1)} title="Inverter sinal"
                        style={{ width: 24, border: '1px solid var(--border-strong)', borderRadius: 5, cursor: 'pointer', background: m.sinal === 1 ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.10)', color: m.sinal === 1 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{m.sinal === 1 ? '+' : '−'}</button>
                      <button onClick={() => removeLink(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', display: 'flex' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )
            })}
            {!visible.length && <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>Selecione um relatório.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
