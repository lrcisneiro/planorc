import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'
import { parseNum, numToInput, formatValor, computeCenario, pkey } from '../../lib/engine'
import type { LinhaCalc, RawValues, Periodo } from '../../lib/engine'
import { ChevronLeft, Lock, Upload, Download } from 'lucide-react'
import FormulaCellInput from '../relatorios/FormulaCellInput'
import { importBaseline, modeloBaseline, type ImportModo } from '../../lib/importOrcado'

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

  const [cells, setCells] = useState<Record<string, Record<number, Cell>>>({})  // master → mes → célula (SOMA dos lançamentos, com sinal, OU fórmula única)
  const [cellMeta, setCellMeta] = useState<Record<string, Record<number, { count: number; inline: boolean }>>>({})  // por célula: nº de lançamentos e se é editável inline
  const [lancModal, setLancModal] = useState<{ master: string; mes: number; linha: Linha } | null>(null)   // modal de lançamentos da célula composta
  const [hist, setHist] = useState<Record<string, string>>({})                  // master → histórico/comentário (nota por linha)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<{ r: number; c: number } | null>(null)   // célula ativa (linha em `ordered` × mês 0..11)
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [impMenu, setImpMenu] = useState(false)
  const [impMode, setImpMode] = useState<ImportModo>('full')
  const [refresh, setRefresh] = useState(0)   // bump para recarregar a grade após importar
  const [scopeRows, setScopeRows] = useState<{ empresa_id: string | null; filial_id: string | null; cc_id: string | null }[]>([])   // escopos com dados (marca ●)
  const [scopesRefresh, setScopesRefresh] = useState(0)

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
  const filiaisEd = useMemo(() => acesso.filterEdit('filial', filiais), [filiais, acesso.loading]) // eslint-disable-line — filiais pelos direitos do usuário, não pela empresa selecionada
  const ccsEd = useMemo(() => acesso.filterEdit('centro_custo', ccs), [ccs, acesso.loading]) // eslint-disable-line

  const versao = versoes.find(v => v.id === versaoId)
  const ano = versao?.ano || 0
  const bloqueada = !!versao?.bloqueada
  const pronto = !!versaoId && !!empresaId
  // escopo ORÇAR: usuário restrito numa dimensão NÃO pode lançar consolidado (nulo) nela
  const filialRestrito = filiais.length > 0 && acesso.filterEdit('filial', filiais).length < filiais.length
  const ccRestrito = ccs.length > 0 && ccsEd.length < ccs.length
  const escopoOk = pronto && acesso.canEdit('empresa', empresaId)
    && (filialId ? acesso.canEdit('filial', filialId) : !filialRestrito)
    && (ccId ? acesso.canEdit('centro_custo', ccId) : !ccRestrito)
  const readOnly = bloqueada || !escopoOk
  // usuário restrito não tem "consolidado": força uma seleção válida da dimensão
  useEffect(() => { if (filialRestrito && !filialId && filiaisEd.length) setFilialId(filiaisEd[0].id) }, [filialRestrito, filialId, filiaisEd])
  useEffect(() => { if (ccRestrito && !ccId && ccsEd.length) setCcId(ccsEd[0].id) }, [ccRestrito, ccId, ccsEd])

  useEffect(() => {
    if (!pronto) { setCells({}); setHist({}); return }
    (async () => {
      let q = supabase.from('fat_orcado').select('linha_id,mes,valor,expressao,dims,origem').eq('versao_id', versaoId).eq('empresa_id', empresaId).eq('ano', ano)
      q = filialId ? q.eq('filial_id', filialId) : q.is('filial_id', null)
      q = ccId ? q.eq('cc_id', ccId) : q.is('cc_id', null)
      const { data } = await q
      const v: Record<string, Record<number, Cell>> = {}
      const meta: Record<string, Record<number, { count: number; inline: boolean }>> = {}
      const byCell: Record<string, any[]> = {}   // `${linha}|${mes}` → lançamentos (exclui notas de linha)
      const h: Record<string, string> = {}
      for (const r of (data || []) as any[]) {
        const isNota = r.valor == null && r.expressao == null   // linha "fantasma" só com dims.historico = nota da linha
        if (isNota) { const hh = r.dims?.historico; if (hh && !h[r.linha_id]) h[r.linha_id] = String(hh); continue }
        ;(byCell[`${r.linha_id}|${r.mes}`] = byCell[`${r.linha_id}|${r.mes}`] || []).push(r)
      }
      for (const k in byCell) {
        const rows = byCell[k]; const sep = k.indexOf('|'); const linha = k.slice(0, sep); const mes = Number(k.slice(sep + 1))
        const soma = rows.reduce((s, r) => s + (Number(r.valor) || 0), 0)
        const loneExpr = rows.length === 1 && rows[0].expressao ? rows[0].expressao : null   // fórmula manual única
        ;(v[linha] = v[linha] || {})[mes] = { valor: soma, expressao: loneExpr }
        ;(meta[linha] = meta[linha] || {})[mes] = { count: rows.length, inline: rows.length === 1 && rows[0].origem === 'MANUAL' }
      }
      setCells(v); setHist(h); setCellMeta(meta)
    })()
  }, [versaoId, empresaId, filialId, ccId, ano, pronto, refresh])

  // marca ● nos seletores: quais empresa/filial/CC já têm orçado desta versão (contas deste relatório)
  useEffect(() => {
    const masterIds = linhas.map(l => l.linha_orc_id).filter(Boolean) as string[]
    if (!versaoId || !ano || !masterIds.length) { setScopeRows([]); return }
    (async () => {
      const { data } = await supabase.from('fat_orcado').select('empresa_id,filial_id,cc_id').eq('versao_id', versaoId).eq('ano', ano).in('linha_id', masterIds)
      setScopeRows((data || []) as any[])
    })()
  }, [versaoId, ano, linhas.length, scopesRefresh, refresh])
  const empresasComDados = useMemo(() => new Set(scopeRows.filter(r => r.empresa_id).map(r => r.empresa_id)), [scopeRows])
  const filiaisComDados = useMemo(() => new Set(scopeRows.filter(r => r.empresa_id === empresaId && r.filial_id).map(r => r.filial_id)), [scopeRows, empresaId])
  const ccsComDados = useMemo(() => new Set(scopeRows.filter(r => r.empresa_id === empresaId && (!filialId || r.filial_id === filialId) && r.cc_id).map(r => r.cc_id)), [scopeRows, empresaId, filialId])

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
  // grava o HISTÓRICO/comentário da linha (nota por linha, replicada nos 12 meses via dims.historico)
  const saveHistLinha = async (master: string, texto: string) => {
    if (!pronto || readOnly) return
    const t = texto.trim()
    setSaving(true)
    const base = () => {
      let s = supabase.from('fat_orcado').select('id,valor,expressao,dims').eq('versao_id', versaoId).eq('linha_id', master).eq('empresa_id', empresaId).eq('ano', ano)
      s = filialId ? s.eq('filial_id', filialId) : s.is('filial_id', null)
      s = ccId ? s.eq('cc_id', ccId) : s.is('cc_id', null)
      return s
    }
    await Promise.all(Array.from({ length: 12 }, (_, i) => i + 1).map(async mes => {
      const { data: ex } = await base().eq('mes', mes).maybeSingle()
      if (ex) {
        const row = ex as any
        const dims = { ...(row.dims || {}) }
        if (t) dims.historico = t; else delete dims.historico
        const phantom = row.valor == null && row.expressao == null && Object.keys(dims).length === 0
        if (phantom) await supabase.from('fat_orcado').delete().eq('id', row.id)
        else await supabase.from('fat_orcado').update({ dims }).eq('id', row.id)
      } else if (t) {
        await supabase.from('fat_orcado').insert({ tenant_id: TENANT_ID, versao_id: versaoId, linha_id: master, empresa_id: empresaId, filial_id: filialId || null, cc_id: ccId || null, ano, mes, valor: null, expressao: null, origem: 'MANUAL', dims: { historico: t } })
      }
    }))
    setHist(prev => { const n = { ...prev }; if (t) n[master] = t; else delete n[master]; return n })
    setSaving(false)
  }
  const parseCell = (l: Linha, t: string): { valor: number | null; expressao: string | null } => {
    const s = t.trim(); const isF = s.startsWith('=')
    return { valor: isF ? null : facOf(l) * parseNum(s), expressao: isF ? toStored(s) : null }
  }
  const salvar = async (l: Linha, mes: number) => {
    const master = l.linha_orc_id!
    if (!pronto || readOnly || !editavel(l)) { setEditing(false); return }
    setSaving(true)
    const { valor, expressao } = parseCell(l, editVal)
    await saveOne(master, mes, valor, expressao)
    setCells(prev => ({ ...prev, [master]: { ...(prev[master] || {}), [mes]: { valor: valor || 0, expressao } } }))
    setScopesRefresh(x => x + 1)
    setSaving(false)
  }

  // ── Importar Baseline (planilha larga por empresa/filial/CC) — mesma lógica do relatório,
  // porém com trava por permissão: só grava o que o usuário pode orçar (escopo ORÇAR).
  const canWriteScope = (eId: string, fId: string | null, cId: string | null) =>
    acesso.canEdit('empresa', eId)
    && (fId ? acesso.canEdit('filial', fId) : !filialRestrito)
    && (cId ? acesso.canEdit('centro_custo', cId) : !ccRestrito)
  const doImport = async (file: File, modo: ImportModo) => {
    if (!versaoId) { alert('Selecione a versão de destino.'); return }
    if (bloqueada) { alert('Versão bloqueada — não é possível importar.'); return }
    const verCod = versao?.codigo || ''
    const msgModo = modo === 'full'
      ? `SUBSTITUIR (full load): apaga o orçado manual (dentro do seu escopo) da versão "${verCod}" das empresas presentes no arquivo e importa de novo.`
      : `ADICIONAR: soma os valores ao orçado já existente da versão "${verCod}" (não apaga nada).`
    if (!confirm(`${msgModo}\n\nConfirmar importação?`)) return
    setSaving(true)
    try {
      const res = await importBaseline({ file, modo, versaoId, canWrite: canWriteScope })
      alert(res.message)
      if (res.ok) setRefresh(x => x + 1)
    } catch (e: any) {
      alert('Erro ao importar: ' + (e?.message ?? JSON.stringify(e)))
    }
    setSaving(false)
  }

  // ── Navegação tipo planilha (célula ativa + teclado) ──
  // célula "composta" = mais de um lançamento, ou um único que NÃO é manual (veio de formulário) → não edita inline
  const ehComposta = (master: string, mes: number) => { const m = cellMeta[master]?.[mes]; return !!m && !m.inline }
  const startEdit = (init: string | null) => {
    if (!active || readOnly) return
    const l = ordered[active.r]; if (!l || !editavel(l)) return
    const master = l.linha_orc_id!; const mes = active.c + 1
    if (ehComposta(master, mes)) { setLancModal({ master, mes, linha: l }); return }   // vários lançamentos → abre o modal
    const c = cells[master]?.[mes]
    const cur = c?.expressao ? toDisplay(c.expressao) : (c?.valor ? numToInput(facOf(l) * c.valor) : '')
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
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const l = ordered[active.r]; if (!readOnly && editavel(l)) { const m = l.linha_orc_id!; if (ehComposta(m, active.c + 1)) setLancModal({ master: m, mes: active.c + 1, linha: l }); else { setEditVal(''); setEditing(true) } } }
    else if (e.key.length === 1 && /[0-9=.,\-+]/.test(e.key)) { e.preventDefault(); startEdit(e.key) }
  }
  // Preencher à direita: replica o valor/fórmula em edição da célula atual até dezembro (Ctrl+Enter ou botão →|)
  const fillRight = async () => {
    if (!active || readOnly) return
    const l = ordered[active.r]; const master = l.linha_orc_id!; if (!editavel(l)) return
    const { valor, expressao } = parseCell(l, editVal)
    setSaving(true)
    const meses: number[] = []; for (let m = active.c + 1; m <= 12; m++) if (!ehComposta(master, m)) meses.push(m)   // pula compostas (edite pelo modal)
    await Promise.all(meses.map(m => saveOne(master, m, valor, expressao)))
    setCells(prev => { const cur = { ...(prev[master] || {}) }; meses.forEach(m => { cur[m] = { valor: valor || 0, expressao } }); return { ...prev, [master]: cur } })
    setScopesRefresh(x => x + 1)
    setEditing(false); setSaving(false); setTimeout(() => wrapRef.current?.focus(), 0)
  }
  // Colar do Excel: bloco TSV → preenche as analíticas a partir da célula ativa (pula sintéticas)
  // Colar bloco (TSV do Excel) a partir da célula ativa — reusado fora e DENTRO da edição (via onPasteBlock).
  const pasteBlock = async (text: string) => {
    if (!active || readOnly) return
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n')
    const editRows: number[] = []
    for (let r = active.r; r < ordered.length && editRows.length < rows.length; r++) if (editavel(ordered[r])) editRows.push(r)
    const ups: { master: string; mes: number; valor: number | null; expressao: string | null }[] = []
    rows.forEach((row, ri2) => {
      const tr = editRows[ri2]; if (tr == null) return
      const l = ordered[tr]; const master = l.linha_orc_id!
      row.split('\t').forEach((txt, ci2) => {
        const mes = active.c + 1 + ci2; if (mes > 12 || txt.trim() === '' || ehComposta(master, mes)) return
        const { valor, expressao } = parseCell(l, txt)
        ups.push({ master, mes, valor, expressao })
      })
    })
    if (!ups.length) return
    setSaving(true)
    await Promise.all(ups.map(u => saveOne(u.master, u.mes, u.valor, u.expressao)))
    setCells(prev => { const next = { ...prev }; for (const u of ups) next[u.master] = { ...(next[u.master] || {}), [u.mes]: { valor: u.valor || 0, expressao: u.expressao } }; return next })
    setScopesRefresh(x => x + 1)
    setSaving(false)
    setTimeout(() => wrapRef.current?.focus(), 0)
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (!active || editing || readOnly) return
    const text = e.clipboardData.getData('text'); if (!text) return
    e.preventDefault(); pasteBlock(text)
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
          <select style={S.sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
            <option value="">— selecione —</option>
            {empresasEd.map(e => <option key={e.id} value={e.id}>{empresasComDados.has(e.id) ? '● ' : ''}{e.codigo} · {e.descricao}</option>)}
          </select></div>
        <div><div style={S.lbl}>Filial</div>
          <select style={S.sel} value={filialId} onChange={e => setFilialId(e.target.value)}>
            {!filialRestrito && <option value="">— consolidado —</option>}
            {filiaisEd.map(f => <option key={f.id} value={f.id}>{filiaisComDados.has(f.id) ? '● ' : ''}{f.codigo} · {f.descricao}</option>)}
          </select></div>
        <div><div style={S.lbl}>Centro de custo</div>
          <select style={S.sel} value={ccId} onChange={e => setCcId(e.target.value)}>
            {!ccRestrito && <option value="">— consolidado —</option>}
            {ccsEd.map(c => <option key={c.id} value={c.id}>{ccsComDados.has(c.id) ? '● ' : ''}{c.codigo} · {c.descricao}</option>)}
          </select></div>
        {pronto && <div style={{ alignSelf: 'flex-end', fontSize: 12, color: 'var(--muted)' }}>{preenchidas} de {totalCelulas} células preenchidas</div>}
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', position: 'relative' }}>
          <button
            style={{ ...S.sel, display: 'flex', alignItems: 'center', gap: 6, cursor: versaoId && !bloqueada ? 'pointer' : 'not-allowed', opacity: versaoId && !bloqueada ? 1 : 0.5 }}
            disabled={!versaoId || bloqueada}
            onClick={() => setImpMenu(o => !o)}
            title={!versaoId ? 'Selecione a versão de destino' : (bloqueada ? 'Versão bloqueada' : 'Importar orçado de planilha (por empresa/filial/CC)')}>
            <Upload size={13} /> Importar Baseline ▾
          </button>
          {impMenu && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 1000, minWidth: 260 }}>
              {[
                { m: 'full' as ImportModo, label: 'Orçado Baseline — substituir (full)' },
                { m: 'add' as ImportModo, label: 'Orçado Baseline — adicionar' },
              ].map(o => (
                <div key={o.m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px', fontSize: 13, color: 'var(--text)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.14)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--panel)')}>
                  <span style={{ cursor: 'pointer', flex: 1 }} onClick={() => { setImpMode(o.m); setImpMenu(false); fileRef.current?.click() }}>{o.label}</span>
                  <span style={{ cursor: 'pointer', color: 'var(--violet)', fontSize: 11, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    onClick={e => { e.stopPropagation(); modeloBaseline(ano || new Date().getFullYear()) }} title="Baixar planilha modelo"><Download size={11} /> modelo</span>
                </div>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { doImport(f, impMode); e.target.value = '' } }} />
        </div>
      </div>

      {pronto && !bloqueada && !escopoOk && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--orange)', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '8px 12px' }}>
          Você não tem permissão de <strong>orçar</strong> a combinação de empresa/filial/CC selecionada. Escolha uma filial/centro de custo dentro do seu escopo — a grade fica em leitura.
        </div>
      )}

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
                <th style={{ ...S.th, textAlign: 'left' }}>Histórico</th>
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
                      const composta = ed && ehComposta(master, mes)
                      const isActive = active?.r === ri && active?.c === i
                      const isEditingCell = editing && isActive
                      if (espaco) return <td key={i} style={{ borderBottom: '1px solid var(--panel)' }} />
                      return (
                        <td key={i} title={composta ? `Célula com ${cellMeta[master]?.[mes]?.count} lançamentos (formulário/manual) — clique para ver e editar` : (isFx ? toDisplay(cells[master]?.[mes]?.expressao || null) : undefined)}
                          style={{ padding: '4px 10px', borderBottom: '1px solid var(--panel)', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap', cursor: ed && !readOnly ? 'cell' : 'default', color: disp < 0 ? 'var(--red)' : (isAgg ? 'var(--text-mid)' : 'var(--text)'), fontWeight: isAgg ? 600 : 400, fontStyle: isFx ? 'italic' : undefined, background: (isActive && !isEditingCell) ? 'rgba(59,130,246,0.16)' : (ed ? undefined : 'var(--bg-soft)'), outline: (isActive && !isEditingCell) ? '2px solid var(--blue)' : undefined, outlineOffset: -2 }}
                          onClick={() => { setActive({ r: ri, c: i }); wrapRef.current?.focus() }}
                          onDoubleClick={() => { if (!ed || readOnly) return; setActive({ r: ri, c: i }); if (ehComposta(master, mes)) { setLancModal({ master, mes, linha: l }); return } const c = cells[master]?.[mes]; setEditVal(c?.expressao ? toDisplay(c.expressao) : (disp ? numToInput(disp) : '')); setEditing(true) }}>
                          {isEditingCell ? (
                            <FormulaCellInput value={editVal} onChange={setEditVal}
                              onCommit={commitMove} onCancel={() => { setEditing(false); setTimeout(() => wrapRef.current?.focus(), 0) }} onFill={mes < 12 ? fillRight : undefined}
                              onPasteBlock={t => { setEditing(false); pasteBlock(t) }} linhas={refLinhas}
                              inputStyle={{ width: 100, textAlign: 'right', padding: '2px 4px', border: '1px solid var(--blue)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
                          ) : (disp !== 0 || composta ? (<>{composta && <span title="célula composta" style={{ color: 'var(--violet)', marginRight: 4, fontSize: 9, verticalAlign: 'middle' }}>●</span>}{disp !== 0 ? formatValor(disp, 'NUMERO', 0) : ''}</>) : <span style={{ color: 'var(--faint)' }}>{ed ? '—' : ''}</span>)}
                        </td>
                      )
                    })}
                    <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--panel)', textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--text-mid)' }}>{espaco ? '' : formatValor(f * totalLinha(l), 'NUMERO', 0)}</td>
                    <td style={{ padding: '3px 8px', borderBottom: '1px solid var(--panel)' }}>
                      {ed && !espaco ? (
                        <input
                          key={`${master}-${versaoId}-${empresaId}-${filialId}-${ccId}-${ano}`}
                          defaultValue={hist[master] || ''}
                          onBlur={e => { if ((hist[master] || '') !== e.target.value.trim()) saveHistLinha(master, e.target.value) }}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          onPaste={e => e.stopPropagation()}
                          disabled={readOnly}
                          placeholder="—"
                          title="Histórico / comentário da linha (replicado nos 12 meses)"
                          style={{ width: 220, fontSize: 12, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, background: readOnly ? 'var(--bg-soft)' : 'var(--bg)', color: 'var(--text)' }}
                        />
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {linhas.length === 0 && <tr><td colSpan={15} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Relatório sem linhas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {lancModal && (
        <LancamentosModal master={lancModal.master} mes={lancModal.mes} linhaDesc={lancModal.linha.descricao} fac={facOf(lancModal.linha)}
          versaoId={versaoId} empresaId={empresaId} filialId={filialId} ccId={ccId} ano={ano}
          onClose={() => setLancModal(null)} onChanged={() => setRefresh(x => x + 1)} />
      )}
    </div>
  )
}

// Modal enxuto: lançamentos de UMA célula (versão×linha×empresa×filial×CC×ano×mês). Manuais editáveis;
// os de formulário são só-leitura (mudam no formulário). Fecha e pede refresh da grade ao alterar.
function LancamentosModal({ master, mes, linhaDesc, fac, versaoId, empresaId, filialId, ccId, ano, onClose, onChanged }: {
  master: string; mes: number; linhaDesc: string; fac: number
  versaoId: string; empresaId: string; filialId: string; ccId: string; ano: number
  onClose: () => void; onChanged: () => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [addVal, setAddVal] = useState('')
  const [addHist, setAddHist] = useState('')
  const [busy, setBusy] = useState(false)
  const scope = (q: any) => {
    let s = q.eq('versao_id', versaoId).eq('linha_id', master).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes)
    s = filialId ? s.eq('filial_id', filialId) : s.is('filial_id', null)
    s = ccId ? s.eq('cc_id', ccId) : s.is('cc_id', null)
    return s
  }
  const load = async () => {
    setLoading(true)
    const { data } = await scope(supabase.from('fat_orcado').select('id,valor,expressao,origem,dims'))
    setRows(((data || []) as any[]).filter(r => r.valor != null || r.expressao != null))
    setLoading(false)
  }
  useEffect(() => { load() }, [])   // eslint-disable-line
  const total = rows.reduce((s, r) => s + (Number(r.valor) || 0), 0)
  const editarManual = async (id: string, txt: string) => {
    setBusy(true); await supabase.from('fat_orcado').update({ valor: fac * parseNum(txt), expressao: null, origem: 'MANUAL' }).eq('id', id)
    await load(); onChanged(); setBusy(false)
  }
  const excluir = async (id: string) => {
    if (!confirm('Excluir este lançamento manual?')) return
    setBusy(true); await supabase.from('fat_orcado').delete().eq('id', id)
    await load(); onChanged(); setBusy(false)
  }
  const adicionar = async () => {
    if (!addVal.trim()) return
    setBusy(true)
    const dims: any = addHist.trim() ? { historico: addHist.trim() } : {}
    const { error } = await supabase.from('fat_orcado').insert({ tenant_id: TENANT_ID, versao_id: versaoId, linha_id: master, empresa_id: empresaId, filial_id: filialId || null, cc_id: ccId || null, ano, mes, valor: fac * parseNum(addVal), expressao: null, origem: 'MANUAL', dims })
    setBusy(false)
    if (error) { alert('Erro ao adicionar: ' + error.message + (String(error.message).includes('uq_fat_orcado') ? '\n\nJá existe um lançamento com esse histórico nesta célula — informe um histórico diferente.' : '')); return }
    setAddVal(''); setAddHist(''); await load(); onChanged()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} onClick={onClose}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 'min(580px, calc(100vw - 40px))', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', flex: 1 }}>Lançamentos — {linhaDesc}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Mês {MESES[mes - 1]} · a célula soma todos abaixo. Edite/exclua os manuais; os de formulário são só-leitura (altere no formulário).</div>
        {loading ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>Carregando…</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Origem', 'Valor', ''].map((h, i) => <th key={i} style={{ textAlign: i === 1 ? 'right' : 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 600, padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => {
                const manual = r.origem === 'MANUAL'
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--panel)' }}>
                    <td style={{ padding: '5px 6px', color: 'var(--text-mid)' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, padding: '1px 6px', borderRadius: 99, marginRight: 6, color: manual ? 'var(--green)' : 'var(--violet)', background: manual ? 'rgba(52,211,153,0.14)' : 'rgba(139,92,246,0.14)' }}>{manual ? 'manual' : 'fórmula'}</span>
                      {r.dims?.historico || (manual ? '—' : 'Formulário')}
                    </td>
                    <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                      {manual
                        ? <input defaultValue={numToInput(fac * (Number(r.valor) || 0))} disabled={busy}
                            onBlur={e => { const t = e.target.value.trim(); if (t && parseNum(t) !== (fac * (Number(r.valor) || 0))) editarManual(r.id, t) }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            style={{ width: 120, textAlign: 'right', fontFamily: 'monospace', padding: '3px 6px', border: '1px solid var(--border-strong)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)' }} />
                        : <span style={{ fontFamily: 'monospace', color: 'var(--text-mid)' }}>{formatValor(fac * (Number(r.valor) || 0), 'NUMERO', 2)}</span>}
                    </td>
                    <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                      {manual && <button onClick={() => excluir(r.id)} disabled={busy} title="Excluir" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>🗑</button>}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={3} style={{ padding: 12, color: 'var(--muted)', textAlign: 'center' }}>Nenhum lançamento.</td></tr>}
            </tbody>
            <tfoot><tr><td style={{ padding: 6, fontWeight: 600, color: 'var(--text)' }}>Total</td><td style={{ padding: 6, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{formatValor(fac * total, 'NUMERO', 2)}</td><td /></tr></tfoot>
          </table>
        )}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-mid)', marginBottom: 8 }}>Adicionar lançamento manual</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={addVal} onChange={e => setAddVal(e.target.value)} placeholder="Valor" disabled={busy}
              style={{ width: 120, textAlign: 'right', fontFamily: 'monospace', padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
            <input value={addHist} onChange={e => setAddHist(e.target.value)} placeholder="Histórico (p/ distinguir)" disabled={busy}
              style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
            <button onClick={adicionar} disabled={busy || !addVal.trim()} style={{ padding: '6px 14px', background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 6, cursor: busy || !addVal.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: busy || !addVal.trim() ? 0.6 : 1 }}>Adicionar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
