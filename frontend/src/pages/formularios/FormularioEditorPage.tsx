import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useCapacidades } from '../../hooks/useCapacidades'
import { parseNum, numToInput, formatValor, computeCenario, pkey } from '../../lib/engine'
import type { LinhaCalc, RawValues, Periodo } from '../../lib/engine'
import { ChevronLeft, Lock, Plus, Trash2, ArrowUp, ArrowDown, Settings2, Play, Globe, Table } from 'lucide-react'
import FormulaCellInput from '../relatorios/FormulaCellInput'

// Editor de Formulário de drivers (F5) — SPLIT por modo (mesmo padrão da F1 do relatório):
//  · mode="estrutura"  → desenho GENÉRICO do formulário (formulario_linha): drivers,
//    fórmulas e conta de destino. Sem versão/empresa/filial — o formulário não é
//    amarrado a nenhuma unidade. Gate: capacidade «estrutura».
//  · mode="preencher"  → aplicação dos dados (formulario_valor) por versão × empresa ×
//    filial, com a MESMA engine (computeCenario). O "Aplicar" materializa as linhas com
//    conta de destino em fat_orcado. Gate: capacidade «orcar».
// Premissas GLOBAIS (v3_050): empresa_id NULL em formulario_valor = valor que vale para
// todas as empresas; a grade da empresa HERDA (itálico) e pode sobrescrever por célula.
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const GLOBAL = '__global'

type Mode = 'estrutura' | 'preencher'
type FLinha = { id: string; pai_id: string | null; codigo: string; descricao: string; tipo_linha: any; expressao: string | null; natureza: string | null; conta_destino_id: string | null; ordem: number | null; casas_decimais: number; formato: string }
type Opt = { id: string; codigo: string; descricao: string }
type Fil = Opt & { empresa_id: string | null }
type Versao = { id: string; codigo: string; descricao: string; ano: number; bloqueada: boolean }
type Cell = { valor: number; expressao: string | null }
type CellMap = Record<string, Record<number, Cell>>

const S = {
  sel: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--panel)', color: 'var(--text)', fontSize: 13 } as React.CSSProperties,
  lbl: { fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 4 },
  th: { padding: '8px 10px', fontSize: 12, color: 'var(--muted)', fontWeight: 600, background: 'var(--bg)', borderBottom: '1px solid var(--border)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const },
  input: { padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 } as React.CSSProperties,
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 3, display: 'inline-flex', alignItems: 'center' } as React.CSSProperties,
}

export default function FormularioEditorPage({ mode = 'preencher' }: { mode?: Mode }) {
  const { id: formId } = useParams()
  const navigate = useNavigate()
  const cap = useCapacidades()
  const isEstrutura = mode === 'estrutura'

  const [nome, setNome] = useState('')
  const [linhas, setLinhas] = useState<FLinha[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Opt[]>([])
  const [filiais, setFiliais] = useState<Fil[]>([])
  const [contasOrc, setContasOrc] = useState<Opt[]>([])
  const [loading, setLoading] = useState(true)

  const [versaoId, setVersaoId] = useState('')
  const [empresaId, setEmpresaId] = useState('')   // GLOBAL = premissas globais (todas as empresas)
  const [filialId, setFilialId] = useState('')     // '' = consolidado

  const [cells, setCells] = useState<CellMap>({})   // escopo atual (empresa selecionada, ou global se GLOBAL)
  const [gcells, setGcells] = useState<CellMap>({}) // premissas globais (herança na grade da empresa)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [fxEdit, setFxEdit] = useState<Record<string, string>>({})   // fórmula em edição (forma exibida) por linha da estrutura

  const loadLinhas = async () => {
    const { data } = await supabase.from('formulario_linha')
      .select('id,pai_id,codigo,descricao,tipo_linha,expressao,natureza,conta_destino_id,ordem,casas_decimais,formato')
      .eq('formulario_id', formId).order('ordem', { nullsFirst: false })
    setLinhas((data || []) as FLinha[])
  }
  useEffect(() => {
    (async () => {
      const [f, co] = await Promise.all([
        supabase.from('formulario').select('nome').eq('id', formId).maybeSingle(),
        supabase.from('conta_orcamentaria').select('id,codigo,descricao').order('codigo'),
      ])
      setNome(f.data?.nome || '')
      setContasOrc((co.data || []) as Opt[])
      if (!isEstrutura) {
        const [vs, emp, fil] = await Promise.all([
          supabase.from('versao_orcamento').select('id,codigo,descricao,ano,bloqueada').eq('ativa', true).order('ano', { ascending: false }).order('codigo'),
          supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
          supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        ])
        setVersoes((vs.data || []) as Versao[])
        setEmpresas((emp.data || []) as Opt[])
        setFiliais((fil.data || []) as Fil[])
      }
      await loadLinhas()
      setLoading(false)
    })()
  }, [formId, isEstrutura])

  const byId = useMemo(() => { const m: Record<string, FLinha> = {}; linhas.forEach(l => { m[l.id] = l }); return m }, [linhas])
  const { codeToDesc, descToCode } = useMemo(() => {
    const c2d: Record<string, string> = {}, d2c: Record<string, string> = {}
    linhas.forEach(l => { c2d[l.codigo] = l.descricao; d2c[l.descricao] = l.codigo }); return { codeToDesc: c2d, descToCode: d2c }
  }, [linhas])
  const toDisplay = (e: string | null) => e ? e.replace(/\[([^\]]+)\]/g, (_m, c) => `[${codeToDesc[c] ?? c}]`) : ''
  const toStored = (e: string) => e ? e.replace(/\[([^\]]+)\]/g, (_m, c) => `[${descToCode[c] ?? c}]`) : ''
  const natEff = (id: string | null): string => { let c = id ? byId[id] : undefined, g = 0; while (c && g++ < 60) { if (c.natureza === 'RECEITA' || c.natureza === 'DESPESA') return c.natureza; c = c.pai_id ? byId[c.pai_id] : undefined } return '' }
  const facOf = (l: FLinha) => natEff(l.id) === 'DESPESA' ? -1 : 1
  const depthOf = (l: FLinha) => { let d = 0, c: FLinha | undefined = l; while (c?.pai_id && byId[c.pai_id] && d < 60) { d++; c = byId[c.pai_id] } return d }
  const editavel = (l: FLinha) => l.tipo_linha === 'ANALITICA'
  const refLinhas = useMemo(() => linhas.map(l => ({ codigo: l.codigo, descricao: l.descricao })), [linhas])
  const ordered = useMemo(() => {
    const byPai: Record<string, FLinha[]> = {}
    linhas.forEach(l => { const k = l.pai_id || '__root'; (byPai[k] = byPai[k] || []).push(l) })
    Object.values(byPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
    const out: FLinha[] = []; const seen = new Set<string>()
    const walk = (pid: string) => { for (const n of byPai[pid] || []) { if (seen.has(n.id)) continue; seen.add(n.id); out.push(n); walk(n.id) } }
    walk('__root')
    for (const l of linhas) if (!seen.has(l.id)) { seen.add(l.id); out.push(l) }
    return out
  }, [linhas])

  const isGlobal = empresaId === GLOBAL
  const versao = versoes.find(v => v.id === versaoId)
  const ano = versao?.ano || 0
  const bloqueada = !!versao?.bloqueada
  const pronto = !!versaoId && !!empresaId
  const readOnly = bloqueada
  const filiaisDaEmp = useMemo(() => filiais.filter(f => !empresaId || f.empresa_id === empresaId), [filiais, empresaId])

  const toMap = (rows: any[] | null): CellMap => {
    const v: CellMap = {}
    for (const r of (rows || []) as any[]) {
      if (r.valor != null || r.expressao != null) (v[r.linha_id] = v[r.linha_id] || {})[r.mes] = { valor: Number(r.valor) || 0, expressao: r.expressao || null }
    }
    return v
  }
  useEffect(() => {
    if (isEstrutura) return
    if (!pronto) { setCells({}); setGcells({}); return }
    (async () => {
      const base = () => supabase.from('formulario_valor').select('linha_id,mes,valor,expressao').eq('formulario_id', formId).eq('versao_id', versaoId).eq('ano', ano)
      const { data: gd } = await base().is('empresa_id', null)
      const gm = toMap(gd)
      setGcells(gm)
      if (isGlobal) { setCells(gm); return }
      let q = base().eq('empresa_id', empresaId)
      q = filialId ? q.eq('filial_id', filialId) : q.is('filial_id', null)
      const { data } = await q
      setCells(toMap(data))
    })()
  }, [versaoId, empresaId, filialId, ano, pronto, isGlobal, isEstrutura, linhas.length])

  // célula EFETIVA: valor do escopo atual, senão herda a premissa global
  const cellOf = (lid: string, mes: number): { cell: Cell | null; herdado: boolean } => {
    const own = cells[lid]?.[mes]
    if (own) return { cell: own, herdado: false }
    if (!isGlobal) { const g = gcells[lid]?.[mes]; if (g) return { cell: g, herdado: true } }
    return { cell: null, herdado: false }
  }

  // ── ENGINE ──
  const periodos = useMemo<Periodo[]>(() => ano ? MESES.map((_, i) => ({ ano, mes: i + 1 })) : [], [ano])
  const linhasCalc = useMemo<LinhaCalc[]>(() => linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: false, nao_soma: false })), [linhas])
  const computed = useMemo(() => {
    const raw: RawValues = {}
    for (const l of linhas) for (let mes = 1; mes <= 12; mes++) {
      const { cell } = cellOf(l.id, mes)
      if (cell) (raw[l.id] = raw[l.id] || {})[`${ano}-${mes}`] = cell.expressao ? { expressao: cell.expressao } : { valor: cell.valor }
    }
    return computeCenario(linhasCalc, raw, periodos)
  }, [cells, gcells, isGlobal, linhasCalc, periodos, ano])
  const valDe = (l: FLinha, mes: number) => computed[l.id]?.[`${ano}-${mes}`] || 0
  const totalLinha = (l: FLinha) => periodos.reduce((s, p) => s + (computed[l.id]?.[pkey(p)] || 0), 0)

  // ── grava/remove UMA célula em formulario_valor (escopo atual: empresa ou GLOBAL) ──
  const scopeSel = (q: any, lid: string, mes: number) => {
    let sel = q.eq('formulario_id', formId).eq('versao_id', versaoId).eq('linha_id', lid).eq('ano', ano).eq('mes', mes)
    sel = isGlobal ? sel.is('empresa_id', null) : sel.eq('empresa_id', empresaId)
    sel = (!isGlobal && filialId) ? sel.eq('filial_id', filialId) : sel.is('filial_id', null)
    return sel
  }
  const saveOne = async (lid: string, mes: number, valor: number | null, expressao: string | null) => {
    const { data: ex } = await scopeSel(supabase.from('formulario_valor').select('id'), lid, mes).maybeSingle()
    if (ex) await supabase.from('formulario_valor').update({ valor, expressao }).eq('id', (ex as any).id)
    else await supabase.from('formulario_valor').insert({ tenant_id: TENANT_ID, formulario_id: formId, versao_id: versaoId, linha_id: lid, empresa_id: isGlobal ? null : empresaId, filial_id: isGlobal ? null : (filialId || null), ano, mes, valor, expressao, dims: {} })
  }
  const deleteOne = async (lid: string, mes: number) => {
    await scopeSel(supabase.from('formulario_valor').delete(), lid, mes)
  }
  const setCellState = (lid: string, mes: number, cell: Cell | null) => {
    const upd = (prev: CellMap): CellMap => {
      const cur = { ...(prev[lid] || {}) }
      if (cell) cur[mes] = cell; else delete cur[mes]
      return { ...prev, [lid]: cur }
    }
    setCells(upd)
    if (isGlobal) setGcells(upd)
  }
  const parseCell = (l: FLinha, t: string): { valor: number | null; expressao: string | null } => {
    const s = t.trim(); const isF = s.startsWith('=')
    return { valor: isF ? null : facOf(l) * parseNum(s), expressao: isF ? toStored(s) : null }
  }
  const salvar = async (l: FLinha, mes: number) => {
    if (!pronto || readOnly || !editavel(l)) { setEditing(false); return }
    setSaving(true)
    if (editVal.trim() === '') {
      // vazio = remove do escopo atual (na empresa, volta a herdar a premissa global)
      await deleteOne(l.id, mes)
      setCellState(l.id, mes, null)
    } else {
      const { valor, expressao } = parseCell(l, editVal)
      await saveOne(l.id, mes, valor, expressao)
      setCellState(l.id, mes, { valor: valor || 0, expressao })
    }
    setSaving(false)
  }

  // ── Navegação tipo planilha ──
  const startEdit = (init: string | null) => {
    if (!active || readOnly) return
    const l = ordered[active.r]; if (!l || !editavel(l)) return
    const { cell } = cellOf(l.id, active.c + 1)
    const cur = cell?.expressao ? toDisplay(cell.expressao) : (cell?.valor ? numToInput(facOf(l) * cell.valor) : '')
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
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const l = ordered[active.r]; if (!readOnly && editavel(l)) { setEditVal(''); setEditing(true) } }
    else if (e.key.length === 1 && /[0-9=.,\-+]/.test(e.key)) { e.preventDefault(); startEdit(e.key) }
  }
  const fillRight = async () => {
    if (!active || readOnly) return
    const l = ordered[active.r]; if (!editavel(l)) return
    const { valor, expressao } = parseCell(l, editVal)
    setSaving(true)
    const meses: number[] = []; for (let m = active.c + 1; m <= 12; m++) meses.push(m)
    await Promise.all(meses.map(m => saveOne(l.id, m, valor, expressao)))
    meses.forEach(m => setCellState(l.id, m, { valor: valor || 0, expressao }))
    setEditing(false); setSaving(false); setTimeout(() => wrapRef.current?.focus(), 0)
  }
  const onPaste = async (e: React.ClipboardEvent) => {
    if (!active || editing || readOnly) return
    const text = e.clipboardData.getData('text'); if (!text) return
    e.preventDefault()
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n')
    const editRows: number[] = []
    for (let r = active.r; r < ordered.length && editRows.length < rows.length; r++) if (editavel(ordered[r])) editRows.push(r)
    const ups: { lid: string; mes: number; valor: number | null; expressao: string | null }[] = []
    rows.forEach((row, ri2) => {
      const tr = editRows[ri2]; if (tr == null) return
      const l = ordered[tr]
      row.split('\t').forEach((txt, ci2) => {
        const mes = active.c + 1 + ci2; if (mes > 12 || txt.trim() === '') return
        const { valor, expressao } = parseCell(l, txt)
        ups.push({ lid: l.id, mes, valor, expressao })
      })
    })
    if (!ups.length) return
    setSaving(true)
    await Promise.all(ups.map(u => saveOne(u.lid, u.mes, u.valor, u.expressao)))
    ups.forEach(u => setCellState(u.lid, u.mes, { valor: u.valor || 0, expressao: u.expressao }))
    setSaving(false)
  }

  // ── ESTRUTURA (CRUD de linhas — só no mode="estrutura") ──
  const addLinha = async () => {
    const maxOrd = linhas.reduce((m, l) => Math.max(m, l.ordem ?? 0), 0)
    const n = linhas.length + 1
    const { error } = await supabase.from('formulario_linha').insert({ formulario_id: formId, codigo: `L${n}`, descricao: 'Nova linha', tipo_linha: 'ANALITICA', natureza: 'NEUTRO', ordem: maxOrd + 10, nivel: 1, casas_decimais: 2 })
    if (error) { alert('Erro: ' + error.message); return }
    await loadLinhas()
  }
  const updateLinha = async (id: string, patch: Partial<FLinha>) => {
    setLinhas(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    const { error } = await supabase.from('formulario_linha').update(patch).eq('id', id)
    if (error) alert('Erro: ' + error.message)
  }
  const commitFx = (l: FLinha) => {
    const disp = fxEdit[l.id]
    if (disp === undefined) return
    updateLinha(l.id, { expressao: disp.trim() ? toStored(disp.trim()) : null })
    setFxEdit(p => { const n = { ...p }; delete n[l.id]; return n })
  }
  const delLinha = async (id: string) => {
    if (!confirm('Excluir esta linha e seus valores?')) return
    await supabase.from('formulario_linha').delete().eq('id', id)
    await loadLinhas()
  }
  const moveLinha = async (l: FLinha, dir: -1 | 1) => {
    const sib = ordered.filter(x => (x.pai_id || null) === (l.pai_id || null))
    const i = sib.findIndex(x => x.id === l.id); const j = i + dir
    if (j < 0 || j >= sib.length) return
    const a = sib[i], b = sib[j]
    await Promise.all([
      supabase.from('formulario_linha').update({ ordem: b.ordem }).eq('id', a.id),
      supabase.from('formulario_linha').update({ ordem: a.ordem }).eq('id', b.id),
    ])
    await loadLinhas()
  }

  // ── APLICAR: materializa o resultado calculado em fat_orcado (origem FORMULARIO) ──
  const aplicar = async () => {
    if (!pronto || readOnly || isGlobal) return
    const destinos = linhas.filter(l => l.conta_destino_id)
    if (!destinos.length) { alert('Nenhuma linha tem conta de destino. Defina o destino nas linhas-resultado (Estrutura) antes de aplicar.'); return }
    const escopo = filialId ? `filial selecionada` : 'consolidado (sem filial)'
    if (!confirm(`Aplicar ${destinos.length} linha(s)-resultado no orçado da versão "${versao?.codigo}", empresa selecionada, ${escopo}?\n\nIsto substitui o que este formulário já havia aplicado nesse escopo.`)) return
    setAplicando(true)
    try {
      const lineIds = linhas.map(l => l.id)
      // limpa o que este formulário já aplicou nesse escopo (versão × empresa × filial)
      let del = supabase.from('fat_orcado').delete().eq('versao_id', versaoId).eq('empresa_id', empresaId).eq('origem', 'FORMULARIO').in('origem_formulario_linha_id', lineIds)
      del = filialId ? del.eq('filial_id', filialId) : del.is('filial_id', null)
      const { error: eDel } = await del; if (eDel) throw eDel
      // monta os registros calculados (só meses com valor ≠ 0)
      const recs: any[] = []
      for (const l of destinos) for (let mes = 1; mes <= 12; mes++) {
        const v = computed[l.id]?.[`${ano}-${mes}`] || 0
        if (!v) continue
        recs.push({ tenant_id: TENANT_ID, versao_id: versaoId, linha_id: l.conta_destino_id, empresa_id: empresaId, filial_id: filialId || null, cc_id: null, ano, mes, valor: v, expressao: null, origem: 'FORMULARIO', origem_formulario_linha_id: l.id, dims: {} })
      }
      for (let i = 0; i < recs.length; i += 500) { const { error } = await supabase.from('fat_orcado').insert(recs.slice(i, i + 500)); if (error) throw error }
      alert(`Aplicado: ${recs.length} célula(s) de ${destinos.length} linha(s)-resultado no orçado.`)
    } catch (e: any) { alert('Erro ao aplicar: ' + (e?.message ?? JSON.stringify(e))) }
    setAplicando(false)
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>Carregando…</div>
  if (isEstrutura && !cap.can('estrutura')) return <div style={{ padding: 24, color: 'var(--red)' }}>Você não tem permissão para editar estruturas (capacidade «estrutura»).</div>
  if (!isEstrutura && !cap.can('orcar')) return <div style={{ padding: 24, color: 'var(--red)' }}>Você não tem permissão para orçar (capacidade «orcar»).</div>

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button onClick={() => navigate('/formularios')} style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><ChevronLeft size={15} /> Voltar</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{isEstrutura ? 'Estrutura' : 'Formulário'} — {nome}</h1>
        {!isEstrutura && bloqueada && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--orange)', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 99, padding: '2px 8px' }}><Lock size={12} /> versão bloqueada</span>}
        {!isEstrutura && isGlobal && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--blue)', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 99, padding: '2px 8px' }}><Globe size={12} /> premissas globais</span>}
        <span style={{ flex: 1 }} />
        {isEstrutura
          ? <button onClick={() => navigate(`/formularios/${formId}`)} style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><Table size={14} /> Preencher</button>
          : (cap.can('estrutura') && <button onClick={() => navigate(`/formularios/${formId}/estrutura`)} style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><Settings2 size={14} /> Estrutura</button>)}
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
        {isEstrutura
          ? <>Desenho genérico do formulário: drivers (entrada), fórmulas e conta de destino. O formulário <strong>não</strong> é amarrado a empresa/filial — o preenchimento e a aplicação por unidade acontecem em <strong>Preencher</strong>.</>
          : <>Selecione versão e empresa e preencha os drivers. <strong>Premissas globais</strong> (opção 🌐 no seletor de empresa) valem para todas as unidades; na grade da empresa aparecem <em>em itálico</em> e podem ser sobrescritas por célula (vazio volta a herdar). {saving && <span style={{ color: 'var(--blue)' }}>· salvando…</span>}</>}
      </p>

      {!isEstrutura && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
          <div><div style={S.lbl}>Versão</div>
            <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
              <option value="">— selecione —</option>
              {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo} · {v.ano}{v.bloqueada ? ' 🔒' : ''}</option>)}
            </select></div>
          <div><div style={S.lbl}>Empresa</div>
            <select style={S.sel} value={empresaId} onChange={e => { setEmpresaId(e.target.value); setFilialId('') }}>
              <option value="">— selecione —</option>
              <option value={GLOBAL}>🌐 Premissas globais (todas)</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}
            </select></div>
          <div><div style={S.lbl}>Filial</div>
            <select style={S.sel} value={filialId} onChange={e => setFilialId(e.target.value)} disabled={isGlobal}>
              <option value="">— consolidado —</option>
              {!isGlobal && filiaisDaEmp.map(f => <option key={f.id} value={f.id}>{f.codigo} · {f.descricao}</option>)}
            </select></div>
          <button
            style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--violet)', color: '#fff', border: 'none', cursor: pronto && !readOnly && !isGlobal ? 'pointer' : 'not-allowed', opacity: pronto && !readOnly && !isGlobal ? 1 : 0.5 }}
            disabled={!pronto || readOnly || aplicando || isGlobal} onClick={aplicar}
            title={!pronto ? 'Selecione versão e empresa' : (isGlobal ? 'Premissas globais não vão ao orçado — selecione uma empresa para aplicar' : (readOnly ? 'Versão bloqueada' : 'Materializar o resultado no orçado (fat_orcado)'))}>
            <Play size={14} /> {aplicando ? 'Aplicando…' : 'Aplicar no orçado'}
          </button>
        </div>
      )}

      {isEstrutura ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 13, color: 'var(--text)' }}>Estrutura do formulário</strong>
            <button style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }} onClick={addLinha}><Plus size={13} /> Linha</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              {['', 'Descrição', 'Tipo', 'Natureza', 'Casas', 'Fórmula (se cálculo)', 'Conta de destino (orçado)', ''].map((h, i) => <th key={i} style={{ ...S.th, textAlign: 'left' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {ordered.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--panel)' }}>
                  <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    <button style={S.iconBtn} onClick={() => moveLinha(l, -1)} title="Subir"><ArrowUp size={13} /></button>
                    <button style={S.iconBtn} onClick={() => moveLinha(l, 1)} title="Descer"><ArrowDown size={13} /></button>
                  </td>
                  <td style={{ padding: '4px 6px' }}><input style={{ ...S.input, width: 220 }} value={l.descricao} onChange={e => setLinhas(p => p.map(x => x.id === l.id ? { ...x, descricao: e.target.value } : x))} onBlur={e => updateLinha(l.id, { descricao: e.target.value })} /></td>
                  <td style={{ padding: '4px 6px' }}>
                    <select style={S.input} value={l.tipo_linha} onChange={e => updateLinha(l.id, { tipo_linha: e.target.value })}>
                      <option value="ANALITICA">Analítica (entrada)</option>
                      <option value="FORMULA">Fórmula (cálculo)</option>
                      <option value="SOMAR_FILHOS">Soma dos filhos</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select style={S.input} value={l.natureza || 'NEUTRO'} onChange={e => updateLinha(l.id, { natureza: e.target.value })}>
                      <option value="NEUTRO">Neutro</option>
                      <option value="RECEITA">Receita (+)</option>
                      <option value="DESPESA">Despesa (−)</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <input type="number" min={0} max={4} style={{ ...S.input, width: 48, textAlign: 'center' }} value={l.casas_decimais ?? 0}
                      onChange={e => setLinhas(p => p.map(x => x.id === l.id ? { ...x, casas_decimais: Number(e.target.value) } : x))}
                      onBlur={e => updateLinha(l.id, { casas_decimais: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} />
                  </td>
                  <td style={{ padding: '4px 6px', minWidth: 210 }}>
                    {l.tipo_linha === 'FORMULA' ? (
                      <FormulaCellInput
                        value={fxEdit[l.id] ?? toDisplay(l.expressao)}
                        onChange={v => setFxEdit(p => ({ ...p, [l.id]: v }))}
                        onCommit={() => commitFx(l)}
                        onCancel={() => setFxEdit(p => { const n = { ...p }; delete n[l.id]; return n })}
                        linhas={refLinhas}
                        inputStyle={{ ...S.input, fontFamily: 'monospace' }}
                        fullWidth />
                    ) : <span style={{ color: 'var(--faint)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select style={{ ...S.input, width: 200 }} value={l.conta_destino_id || ''} onChange={e => updateLinha(l.id, { conta_destino_id: e.target.value || null })}>
                      <option value="">— não vai ao orçado —</option>
                      {contasOrc.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.descricao}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}><button style={{ ...S.iconBtn, color: 'var(--red)' }} onClick={() => delLinha(l.id)} title="Excluir"><Trash2 size={13} /></button></td>
                </tr>
              ))}
              {linhas.length === 0 && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>Sem linhas. Clique “+ Linha” para começar.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : !pronto ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 14, background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)' }}>
          Selecione <strong>versão</strong> e <strong>empresa</strong> (ou 🌐 premissas globais) para preencher os valores.
        </div>
      ) : (
        <div ref={wrapRef} tabIndex={0} onKeyDown={onGridKey} onPaste={onPaste} style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12, outline: 'none' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 2, width: 300, minWidth: 300 }}>Linha</th>
                {MESES.map((m, i) => <th key={i} style={S.th}>{m}</th>)}
                <th style={{ ...S.th, color: 'var(--text-mid)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((l, ri) => {
                const ed = editavel(l); const f = facOf(l); const depth = depthOf(l)
                const isAgg = l.tipo_linha === 'SOMAR_FILHOS' || l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR'
                const espaco = l.tipo_linha === 'ESPACO'
                return (
                  <tr key={l.id} style={{ background: isAgg ? 'rgba(139,92,246,0.05)' : undefined }}>
                    <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--panel)', position: 'sticky', left: 0, background: isAgg ? 'var(--bg-soft)' : 'var(--panel)', zIndex: 1, fontSize: 13, color: 'var(--text)', width: 300, minWidth: 300, fontWeight: isAgg ? 600 : 400 }}>
                      <div title={l.descricao} style={{ paddingLeft: depth * 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.descricao}
                        {l.conta_destino_id && <span title="vai ao orçado" style={{ marginLeft: 6, fontSize: 10, color: 'var(--violet)' }}>▸ orçado</span>}
                      </div>
                    </td>
                    {MESES.map((_, i) => {
                      const mes = i + 1; const disp = f * valDe(l, mes)
                      const eff = ed ? cellOf(l.id, mes) : { cell: null, herdado: false }
                      const isFx = ed && !!eff.cell?.expressao
                      const herdado = ed && eff.herdado
                      const isActive = active?.r === ri && active?.c === i
                      const isEditingCell = editing && isActive
                      if (espaco) return <td key={i} style={{ borderBottom: '1px solid var(--panel)' }} />
                      return (
                        <td key={i} title={isFx ? `${herdado ? '🌐 global · ' : ''}${toDisplay(eff.cell?.expressao || null)}` : (herdado ? '🌐 premissa global (herdada) — edite para sobrescrever, vazio volta a herdar' : undefined)}
                          style={{ padding: '4px 10px', borderBottom: '1px solid var(--panel)', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap', cursor: ed && !readOnly ? 'cell' : 'default', color: disp < 0 ? 'var(--red)' : (herdado ? 'var(--muted)' : (isAgg ? 'var(--text-mid)' : 'var(--text)')), fontWeight: isAgg ? 600 : 400, fontStyle: (isFx || herdado) ? 'italic' : undefined, background: (isActive && !isEditingCell) ? 'rgba(59,130,246,0.16)' : (ed ? undefined : 'var(--bg-soft)'), outline: (isActive && !isEditingCell) ? '2px solid var(--blue)' : undefined, outlineOffset: -2 }}
                          onClick={() => { setActive({ r: ri, c: i }); wrapRef.current?.focus() }}
                          onDoubleClick={() => { if (!ed || readOnly) return; setActive({ r: ri, c: i }); const c = eff.cell; setEditVal(c?.expressao ? toDisplay(c.expressao) : (disp ? numToInput(disp) : '')); setEditing(true) }}>
                          {isEditingCell ? (
                            <FormulaCellInput value={editVal} onChange={setEditVal}
                              onCommit={commitMove} onCancel={() => { setEditing(false); setTimeout(() => wrapRef.current?.focus(), 0) }} onFill={mes < 12 ? fillRight : undefined} linhas={refLinhas}
                              inputStyle={{ width: 100, textAlign: 'right', padding: '2px 4px', border: '1px solid var(--blue)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
                          ) : (disp !== 0 ? formatValor(disp, (l.formato as any) || 'NUMERO', l.casas_decimais ?? 0) : <span style={{ color: 'var(--faint)' }}>{ed ? '—' : ''}</span>)}
                        </td>
                      )
                    })}
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--panel)', textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text-mid)' }}>{espaco ? '' : formatValor(f * totalLinha(l), (l.formato as any) || 'NUMERO', l.casas_decimais ?? 0)}</td>
                  </tr>
                )
              })}
              {linhas.length === 0 && <tr><td colSpan={14} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Sem linhas — {cap.can('estrutura') ? 'abra a Estrutura e adicione drivers.' : 'peça a um administrador para montar a estrutura.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
