import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'
import { parseNum, formatValor, computeCenario, pkey } from '../../lib/engine'
import type { LinhaCalc, RawValues, Periodo } from '../../lib/engine'
import { ChevronLeft, Lock } from 'lucide-react'
import FormulaCellInput from '../relatorios/FormulaCellInput'

// Grade de Orçar dedicada (F3.1): escrita do orçado por empresa × filial × CC, escopada pelos
// direitos ORÇAR. Mostra a ESTRUTURA INTEIRA na ordem (DFS) do relatório; sintéticas/fórmulas e
// células com fórmula (=ANTERIOR(), =[conta]*…) são calculadas pela MESMA engine (computeCenario).
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

type Linha = { id: string; pai_id: string | null; codigo: string; descricao: string; tipo_linha: any; expressao: string | null; natureza: string | null; linha_orc_id: string | null; desativada: boolean; nao_soma: boolean; ordem: number | null }
type Opt = { id: string; codigo: string; descricao: string }
type Fil = Opt & { empresa_id: string | null }
type Versao = { id: string; codigo: string; descricao: string; ano: number; bloqueada: boolean }
type Cell = { valor: number; expressao: string | null }

const S = {
  sel: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--panel)', color: 'var(--text)', fontSize: 13 } as React.CSSProperties,
  lbl: { fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 4 },
  th: { padding: '8px 10px', fontSize: 12, color: 'var(--muted)', fontWeight: 600, background: 'var(--bg)', borderBottom: '1px solid var(--border)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const },
}

export default function OrcarGradePage() {
  const { id: relId } = useParams()
  const navigate = useNavigate()
  const acesso = useUserAccess()
  const cap = useCapacidades()

  const [relNome, setRelNome] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Opt[]>([])
  const [filiais, setFiliais] = useState<Fil[]>([])
  const [ccs, setCcs] = useState<Opt[]>([])
  const [loading, setLoading] = useState(true)

  const [versaoId, setVersaoId] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [filialId, setFilialId] = useState('')   // '' = consolidado
  const [ccId, setCcId] = useState('')            // '' = consolidado

  const [cells, setCells] = useState<Record<string, Record<number, Cell>>>({})  // master → mes → célula (valor com sinal OU fórmula)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<{ r: number; c: number } | null>(null)   // célula ativa (linha em `ordered` × mês 0..11)
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const [rel, lr, vs, emp, fil, cc] = await Promise.all([
        supabase.from('relatorio').select('nome').eq('id', relId).maybeSingle(),
        supabase.from('relatorio_linha').select('id,pai_id,codigo,descricao,tipo_linha,expressao,natureza,linha_orc_id,desativada,nao_soma,ordem').eq('relatorio_id', relId).order('ordem', { nullsFirst: false }),
        supabase.from('versao_orcamento').select('id,codigo,descricao,ano,bloqueada').eq('ativa', true).order('ano', { ascending: false }).order('codigo'),
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      ])
      setRelNome(rel.data?.nome || '')
      setLinhas((lr.data || []) as Linha[])
      setVersoes((vs.data || []) as Versao[])
      setEmpresas((emp.data || []) as Opt[])
      setFiliais((fil.data || []) as Fil[])
      setCcs((cc.data || []) as Opt[])
      setLoading(false)
    })()
  }, [relId])

  const byId = useMemo(() => { const m: Record<string, Linha> = {}; linhas.forEach(l => { m[l.id] = l }); return m }, [linhas])
  // conversão descrição↔código nas referências [..] da fórmula (igual ao editor)
  const { codeToDesc, descToCode } = useMemo(() => {
    const c2d: Record<string, string> = {}, d2c: Record<string, string> = {}
    linhas.forEach(l => { c2d[l.codigo] = l.descricao; d2c[l.descricao] = l.codigo }); return { codeToDesc: c2d, descToCode: d2c }
  }, [linhas])
  const toDisplay = (e: string | null) => e ? e.replace(/\[([^\]]+)\]/g, (_m, c) => `[${codeToDesc[c] ?? c}]`) : ''
  const toStored = (e: string) => e ? e.replace(/\[([^\]]+)\]/g, (_m, c) => `[${descToCode[c] ?? c}]`) : ''

  const natEff = (id: string | null): string => { let c = id ? byId[id] : undefined, g = 0; while (c && g++ < 60) { if (c.natureza === 'RECEITA' || c.natureza === 'DESPESA') return c.natureza; c = c.pai_id ? byId[c.pai_id] : undefined } return '' }
  const facOf = (l: Linha) => natEff(l.id) === 'DESPESA' ? -1 : 1
  const depthOf = (l: Linha) => { let d = 0, c: Linha | undefined = l; while (c?.pai_id && byId[c.pai_id] && d < 60) { d++; c = byId[c.pai_id] } return d }
  const editavel = (l: Linha) => l.tipo_linha === 'ANALITICA' && !!l.linha_orc_id && !l.nao_soma && !l.desativada
  const rlOfMaster = useMemo(() => { const m: Record<string, string> = {}; linhas.forEach(l => { if (l.linha_orc_id && !l.nao_soma) m[l.linha_orc_id] = l.id }); return m }, [linhas])
  const refLinhas = useMemo(() => linhas.map(l => ({ codigo: l.codigo, descricao: l.descricao })), [linhas])   // sugestões de fórmula
  // ordem de exibição = DFS da árvore (pai → filhos por ordem)
  const ordered = useMemo(() => {
    const byPai: Record<string, Linha[]> = {}
    linhas.forEach(l => { const k = l.pai_id || '__root'; (byPai[k] = byPai[k] || []).push(l) })
    Object.values(byPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
    const out: Linha[] = []; const seen = new Set<string>()
    const walk = (pid: string) => { for (const n of byPai[pid] || []) { if (seen.has(n.id)) continue; seen.add(n.id); out.push(n); walk(n.id) } }
    walk('__root')
    for (const l of linhas) if (!seen.has(l.id)) { seen.add(l.id); out.push(l) }
    return out
  }, [linhas])

  const empresasEd = useMemo(() => acesso.filterEdit('empresa', empresas), [empresas, acesso.loading]) // eslint-disable-line
  const filiaisEd = useMemo(() => acesso.filterEdit('filial', filiais).filter(f => !empresaId || f.empresa_id === empresaId), [filiais, empresaId, acesso.loading]) // eslint-disable-line
  const ccsEd = useMemo(() => acesso.filterEdit('centro_custo', ccs), [ccs, acesso.loading]) // eslint-disable-line

  const versao = versoes.find(v => v.id === versaoId)
  const ano = versao?.ano || 0
  const bloqueada = !!versao?.bloqueada
  const pronto = !!versaoId && !!empresaId

  useEffect(() => {
    if (!pronto) { setCells({}); return }
    (async () => {
      let q = supabase.from('fat_orcado').select('linha_id,mes,valor,expressao').eq('versao_id', versaoId).eq('empresa_id', empresaId).eq('ano', ano)
      q = filialId ? q.eq('filial_id', filialId) : q.is('filial_id', null)
      q = ccId ? q.eq('cc_id', ccId) : q.is('cc_id', null)
      const { data } = await q
      const v: Record<string, Record<number, Cell>> = {}
      for (const r of (data || []) as any[]) (v[r.linha_id] = v[r.linha_id] || {})[r.mes] = { valor: Number(r.valor) || 0, expressao: r.expressao || null }
      setCells(v)
    })()
  }, [versaoId, empresaId, filialId, ccId, ano, pronto])

  // ── ENGINE: estrutura inteira a partir das células (valor OU fórmula) ──
  const periodos = useMemo<Periodo[]>(() => ano ? MESES.map((_, i) => ({ ano, mes: i + 1 })) : [], [ano])
  const linhasCalc = useMemo<LinhaCalc[]>(() => linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma })), [linhas])
  const computed = useMemo(() => {
    const raw: RawValues = {}
    for (const [master, mm] of Object.entries(cells)) { const rl = rlOfMaster[master]; if (!rl) continue; for (const [mes, c] of Object.entries(mm)) (raw[rl] = raw[rl] || {})[`${ano}-${mes}`] = c.expressao ? { expressao: c.expressao } : { valor: c.valor } }
    return computeCenario(linhasCalc, raw, periodos)
  }, [cells, linhasCalc, periodos, rlOfMaster, ano])
  const valDe = (l: Linha, mes: number) => computed[l.id]?.[`${ano}-${mes}`] || 0
  const totalLinha = (l: Linha) => periodos.reduce((s, p) => s + (computed[l.id]?.[pkey(p)] || 0), 0)

  // grava UMA célula no fat_orcado (select-then-upsert por causa do filial/cc NULL)
  const saveOne = async (master: string, mes: number, valor: number | null, expressao: string | null) => {
    let sel = supabase.from('fat_orcado').select('id').eq('versao_id', versaoId).eq('linha_id', master).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes)
    sel = filialId ? sel.eq('filial_id', filialId) : sel.is('filial_id', null)
    sel = ccId ? sel.eq('cc_id', ccId) : sel.is('cc_id', null)
    const { data: ex } = await sel.maybeSingle()
    if (ex) await supabase.from('fat_orcado').update({ valor, expressao, origem: 'MANUAL' }).eq('id', (ex as any).id)
    else await supabase.from('fat_orcado').insert({ tenant_id: TENANT_ID, versao_id: versaoId, linha_id: master, empresa_id: empresaId, filial_id: filialId || null, cc_id: ccId || null, ano, mes, valor, expressao, origem: 'MANUAL', dims: {} })
  }
  const parseCell = (l: Linha, t: string): { valor: number | null; expressao: string | null } => {
    const s = t.trim(); const isF = s.startsWith('=')
    return { valor: isF ? null : facOf(l) * parseNum(s), expressao: isF ? toStored(s) : null }
  }
  const salvar = async (l: Linha, mes: number) => {
    const master = l.linha_orc_id!
    if (!pronto || bloqueada || !editavel(l)) { setEditing(false); return }
    setSaving(true)
    const { valor, expressao } = parseCell(l, editVal)
    await saveOne(master, mes, valor, expressao)
    setCells(prev => ({ ...prev, [master]: { ...(prev[master] || {}), [mes]: { valor: valor || 0, expressao } } }))
    setSaving(false)
  }

  // ── Navegação tipo planilha (célula ativa + teclado) ──
  const startEdit = (init: string | null) => {
    if (!active || bloqueada) return
    const l = ordered[active.r]; if (!l || !editavel(l)) return
    const c = cells[l.linha_orc_id!]?.[active.c + 1]
    const cur = c?.expressao ? toDisplay(c.expressao) : (c?.valor ? String(facOf(l) * c.valor) : '')
    setEditVal(init != null ? init : cur); setEditing(true)
  }
  const commitMove = async () => {
    if (!active) return
    await salvar(ordered[active.r], active.c + 1)
    setEditing(false)
    setActive(a => a ? { r: Math.min(ordered.length - 1, a.r + 1), c: a.c } : a)
    setTimeout(() => wrapRef.current?.focus(), 0)
  }
  const onGridKey = (e: React.KeyboardEvent) => {
    if (!active || editing) return
    const mv = (dr: number, dc: number) => { e.preventDefault(); setActive(a => a ? { r: Math.min(ordered.length - 1, Math.max(0, a.r + dr)), c: Math.min(11, Math.max(0, a.c + dc)) } : a) }
    if (e.key === 'ArrowUp') mv(-1, 0)
    else if (e.key === 'ArrowDown') mv(1, 0)
    else if (e.key === 'ArrowLeft') mv(0, -1)
    else if (e.key === 'ArrowRight') mv(0, 1)
    else if (e.key === 'Tab') mv(0, e.shiftKey ? -1 : 1)
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(null) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const l = ordered[active.r]; if (editavel(l)) { setEditVal(''); setEditing(true) } }
    else if (e.key.length === 1 && /[0-9=.,\-+]/.test(e.key)) { e.preventDefault(); startEdit(e.key) }
  }
  // Preencher à direita: replica o valor/fórmula em edição da célula atual até dezembro (Ctrl+Enter ou botão →|)
  const fillRight = async () => {
    if (!active || bloqueada) return
    const l = ordered[active.r]; const master = l.linha_orc_id!; if (!editavel(l)) return
    const { valor, expressao } = parseCell(l, editVal)
    setSaving(true)
    const meses: number[] = []; for (let m = active.c + 1; m <= 12; m++) meses.push(m)
    await Promise.all(meses.map(m => saveOne(master, m, valor, expressao)))
    setCells(prev => { const cur = { ...(prev[master] || {}) }; meses.forEach(m => { cur[m] = { valor: valor || 0, expressao } }); return { ...prev, [master]: cur } })
    setEditing(false); setSaving(false); setTimeout(() => wrapRef.current?.focus(), 0)
  }
  // Colar do Excel: bloco TSV → preenche as analíticas a partir da célula ativa (pula sintéticas)
  const onPaste = async (e: React.ClipboardEvent) => {
    if (!active || editing || bloqueada) return
    const text = e.clipboardData.getData('text'); if (!text) return
    e.preventDefault()
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n')
    const editRows: number[] = []
    for (let r = active.r; r < ordered.length && editRows.length < rows.length; r++) if (editavel(ordered[r])) editRows.push(r)
    const ups: { master: string; mes: number; valor: number | null; expressao: string | null }[] = []
    rows.forEach((row, ri2) => {
      const tr = editRows[ri2]; if (tr == null) return
      const l = ordered[tr]; const master = l.linha_orc_id!
      row.split('\t').forEach((txt, ci2) => {
        const mes = active.c + 1 + ci2; if (mes > 12 || txt.trim() === '') return
        const { valor, expressao } = parseCell(l, txt)
        ups.push({ master, mes, valor, expressao })
      })
    })
    if (!ups.length) return
    setSaving(true)
    await Promise.all(ups.map(u => saveOne(u.master, u.mes, u.valor, u.expressao)))
    setCells(prev => { const next = { ...prev }; for (const u of ups) next[u.master] = { ...(next[u.master] || {}), [u.mes]: { valor: u.valor || 0, expressao: u.expressao } }; return next })
    setSaving(false)
  }

  if (loading || acesso.loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>Carregando…</div>
  if (!cap.can('orcar')) return <div style={{ padding: 24, color: 'var(--red)' }}>Você não tem permissão para orçar (capacidade «orcar»).</div>

  const folhas = linhas.filter(editavel)
  const preenchidas = folhas.reduce((s, l) => s + Object.values(cells[l.linha_orc_id!] || {}).filter(c => c.valor !== 0 || c.expressao).length, 0)
  const totalCelulas = folhas.length * 12

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button onClick={() => navigate(-1)} style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><ChevronLeft size={15} /> Voltar</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Orçar — {relNome}</h1>
        {bloqueada && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--orange)', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 99, padding: '2px 8px' }}><Lock size={12} /> versão bloqueada</span>}
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>Estrutura completa; sintéticas calculadas. Nas <strong>analíticas</strong> digite valor ou fórmula (<code>=ANTERIOR()*1,05</code>, <code>=[conta]…</code>). Despesa exibida positiva. {saving && <span style={{ color: 'var(--blue)' }}>· salvando…</span>}</p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div><div style={S.lbl}>Versão</div>
          <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
            <option value="">— selecione —</option>
            {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo} · {v.ano}{v.bloqueada ? ' 🔒' : ''}</option>)}
          </select></div>
        <div><div style={S.lbl}>Empresa</div>
          <select style={S.sel} value={empresaId} onChange={e => { setEmpresaId(e.target.value); setFilialId('') }}>
            <option value="">— selecione —</option>
            {empresasEd.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}
          </select></div>
        <div><div style={S.lbl}>Filial</div>
          <select style={S.sel} value={filialId} onChange={e => setFilialId(e.target.value)}>
            <option value="">— consolidado —</option>
            {filiaisEd.map(f => <option key={f.id} value={f.id}>{f.codigo} · {f.descricao}</option>)}
          </select></div>
        <div><div style={S.lbl}>Centro de custo</div>
          <select style={S.sel} value={ccId} onChange={e => setCcId(e.target.value)}>
            <option value="">— consolidado —</option>
            {ccsEd.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.descricao}</option>)}
          </select></div>
        {pronto && <div style={{ alignSelf: 'flex-end', fontSize: 12, color: 'var(--muted)' }}>{preenchidas} de {totalCelulas} células preenchidas</div>}
      </div>

      {!pronto ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 14, background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)' }}>
          Selecione <strong>versão</strong> e <strong>empresa</strong> para começar a orçar.
        </div>
      ) : (
        <div ref={wrapRef} tabIndex={0} onKeyDown={onGridKey} onPaste={onPaste} style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, outline: 'none' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 2, width: 300, minWidth: 300, maxWidth: 300 }}>Linha</th>
                {MESES.map((m, i) => <th key={i} style={S.th}>{m}</th>)}
                <th style={{ ...S.th, color: 'var(--text-mid)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((l, ri) => {
                const ed = editavel(l); const f = facOf(l); const depth = depthOf(l)
                const isAgg = l.tipo_linha === 'SOMAR_FILHOS' || l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR'
                const espaco = l.tipo_linha === 'ESPACO'
                const master = l.linha_orc_id || ''
                return (
                  <tr key={l.id} style={{ background: isAgg ? 'rgba(139,92,246,0.05)' : undefined }}>
                    <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--panel)', position: 'sticky', left: 0, background: isAgg ? 'var(--bg-soft)' : 'var(--panel)', zIndex: 1, fontSize: 13, color: 'var(--text)', width: 300, minWidth: 300, maxWidth: 300, fontWeight: isAgg ? 600 : 400 }}>
                      <div title={l.descricao} style={{ paddingLeft: depth * 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.descricao}</div>
                    </td>
                    {MESES.map((_, i) => {
                      const mes = i + 1; const disp = f * valDe(l, mes)
                      const isFx = ed && !!cells[master]?.[mes]?.expressao
                      const isActive = active?.r === ri && active?.c === i
                      const isEditingCell = editing && isActive
                      if (espaco) return <td key={i} style={{ borderBottom: '1px solid var(--panel)' }} />
                      return (
                        <td key={i} title={isFx ? toDisplay(cells[master]?.[mes]?.expressao || null) : undefined}
                          style={{ padding: '4px 10px', borderBottom: '1px solid var(--panel)', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap', cursor: ed && !bloqueada ? 'cell' : 'default', color: disp < 0 ? 'var(--red)' : (isAgg ? 'var(--text-mid)' : 'var(--text)'), fontWeight: isAgg ? 600 : 400, fontStyle: isFx ? 'italic' : undefined, background: (isActive && !isEditingCell) ? 'rgba(59,130,246,0.16)' : (ed ? undefined : 'var(--bg-soft)'), outline: (isActive && !isEditingCell) ? '2px solid var(--blue)' : undefined, outlineOffset: -2 }}
                          onClick={() => { setActive({ r: ri, c: i }); wrapRef.current?.focus() }}
                          onDoubleClick={() => { if (!ed || bloqueada) return; setActive({ r: ri, c: i }); const c = cells[master]?.[mes]; setEditVal(c?.expressao ? toDisplay(c.expressao) : (disp ? String(disp) : '')); setEditing(true) }}>
                          {isEditingCell ? (
                            <FormulaCellInput value={editVal} onChange={setEditVal}
                              onCommit={commitMove} onCancel={() => { setEditing(false); setTimeout(() => wrapRef.current?.focus(), 0) }} onFill={mes < 12 ? fillRight : undefined} linhas={refLinhas}
                              inputStyle={{ width: 100, textAlign: 'right', padding: '2px 4px', border: '1px solid var(--blue)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
                          ) : (disp !== 0 ? formatValor(disp, 'NUMERO', 0) : <span style={{ color: 'var(--faint)' }}>{ed ? '—' : ''}</span>)}
                        </td>
                      )
                    })}
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--panel)', textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text-mid)' }}>{espaco ? '' : formatValor(f * totalLinha(l), 'NUMERO', 0)}</td>
                  </tr>
                )
              })}
              {linhas.length === 0 && <tr><td colSpan={14} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Relatório sem linhas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
