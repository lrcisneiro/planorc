import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { PostosPills, usePassoLabel } from './PostosPills'
import { useTenantFlags } from '../../lib/tenantFlags'
import { nomeCurto } from '../../lib/nomePessoa'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { calcularPosto, regimeAplica, paisAplica, verbasDoRegime, CATEGORIAS } from '../../lib/motorFolha'
import type { VerbaRegra, ResultadoPosto } from '../../lib/motorFolha'
import { Upload, Trash2, AlertCircle, CheckCircle2, Play, ChevronDown, ChevronRight, X, Search, Plus, Pencil, Undo2 } from 'lucide-react'
import { RateioModal } from './RateioModal'
import { cascataRateio } from '../../lib/rateioFolha'
import { usePostoCtx } from '../../lib/postoCtx'
import { useLocalPref } from '../../lib/uiPrefs'
import { pageAll } from '../../lib/pageAll'
import { resolvePosto, camposAlterados, overlayVazio, CAMPOS_CENARIO } from '../../lib/postoVersao'
import type { PostoVersao, CampoCenario } from '../../lib/postoVersao'
import { taxaOrcada, materializa } from '../../lib/cambio'

// Grade de Postos (P1 step 3) — orçamento de folha por posto, agrupado por CC.
// Custo c/ encargos, rateio, sindicato e "Aplicar" vêm dos steps 4-5 (placeholder por ora).

declare const XLSX: any
type Row = Record<string, string>
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function parseCsv(text: string): Row[] {
  text = text.replace(/^﻿/, '')
  const linhas = text.split(/\r?\n/).filter(l => l.trim().length)
  if (!linhas.length) return []
  const pl = (l: string): string[] => {
    const out: string[] = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) { const c = l[i]
      if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
      else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c }
    out.push(cur); return out
  }
  const hdr = pl(linhas[0]).map(h => h.trim())
  return linhas.slice(1).map(l => { const f = pl(l); const o: Row = {}; hdr.forEach((h, i) => o[h] = (f[i] ?? '').trim()); return o })
}
function parseXlsxRows(file: File): Promise<Row[]> {
  return new Promise((res, rej) => { const r = new FileReader()
    r.onload = e => { try { const wb = XLSX.read(e.target?.result, { type: 'binary' }); res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Row[]) } catch (err) { rej(err) } }
    r.readAsBinaryString(file) })
}
const slug = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28) || 'CARGO'
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inpNum = (v: any) => String(v ?? '').replace('.', ',')   // p/ inputs: vírgula decimal, sem separador de milhar
const inp2 = (v: any) => Number(v ?? 0).toFixed(2).replace('.', ',')   // 2 casas, vírgula (ex.: 6000 -> "6000,00")
// aceita "3908,71", "3.908,71" (vírgula = decimal) e "3908.71" (ponto = decimal quando não há vírgula)
const parseNum = (s: string): number => { const r = (s || '').trim(); return r.includes(',') ? parseFloat(r.replace(/\./g, '').replace(',', '.')) : parseFloat(r) }
const milAno = (v: number) => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${money(v)}`
const REGIMES = ['BR-CLT', 'BR-PRESTADOR', 'BR-PROLABORE', 'PY-IPS', 'PY-CONTRATO']
// sindicato por empresa (regra Ricardo): 06→MS, 08/YY/ZZ→PR, demais→SP. O import atribui (persiste no reimport).
const sindCodPorEmp = (empCod: string) => empCod === '06' ? 'SINDPDMS' : ['08', 'YY', 'ZZ'].includes(empCod) ? 'SINDPDPR' : 'SINDPDSP'
// nome curto do ocupante: ver lib/nomePessoa.ts

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  top:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 720, lineHeight: 1.5 },
  bar:   { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '20px 0 16px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  btnPri:{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiH:  { fontSize: 11.5, color: 'var(--muted)' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '9px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  gh:    { padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' },
  td:    { padding: '7px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap' },
  inp:   { padding: '3px 6px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)', width: 80, textAlign: 'right', boxSizing: 'border-box' },
  selCel:{ padding: '3px 6px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' },
  del:   { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-strong)', padding: 3 },
  info:  { display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.30)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-mid)', fontSize: 12.5, margin: '0 0 14px', lineHeight: 1.5 },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 14px' },
  empty: { padding: '44px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  overlay:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 },
  modal:  { background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 'min(680px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' },
  mth:    { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)' },
  mtd:    { padding: '5px 8px', fontSize: 12.5, borderBottom: '1px solid var(--panel-2)', color: 'var(--text)' },
  finp:   { padding: '7px 9px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' },
  flbl:   { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 },
  btnPri2:{ padding: '8px 16px', fontSize: 13, background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
}
const MESES_NUM = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const catCor: Record<string, string> = { 'Rescisão': 'var(--red)', 'Salário': 'var(--green)', Encargos: 'var(--orange)', 'Provisões': 'var(--blue)', 'Benefícios': 'var(--violet)' }
const tag = (bg: string, cor: string, brd: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: bg, color: cor, border: `1px solid ${brd}` })
const T = {
  ocup: tag('rgba(52,211,153,0.12)', 'var(--green)', 'rgba(52,211,153,0.35)'),
  vaga: tag('rgba(251,191,36,0.12)', 'var(--orange)', 'rgba(251,191,36,0.4)'),
  rateio: tag('rgba(34,211,238,0.12)', 'var(--blue)', 'rgba(34,211,238,0.4)'),
  sind: tag('var(--panel-2)', 'var(--muted)', 'var(--border)'),
}
const tagRegime = (r: string | null): CSSProperties =>
  r === 'BR-CLT' ? tag('rgba(59,130,246,0.12)', 'var(--blue)', 'rgba(59,130,246,0.4)')
  : r === 'BR-PRESTADOR' ? tag('rgba(251,146,60,0.12)', 'var(--orange)', 'rgba(251,146,60,0.4)')
  : r === 'BR-PROLABORE' ? tag('rgba(139,92,246,0.12)', 'var(--violet)', 'rgba(139,92,246,0.4)')
  : r === 'PY-IPS' ? tag('rgba(52,211,153,0.12)', 'var(--green)', 'rgba(52,211,153,0.4)')
  : r === 'PY-CONTRATO' ? tag('rgba(34,211,238,0.12)', 'var(--cyan)', 'rgba(34,211,238,0.4)')
  : T.sind
const REGIMES_LABEL: Record<string, string> = { 'BR-CLT': 'BR · CLT', 'BR-PRESTADOR': 'BR · Prestador', 'BR-PROLABORE': 'BR · Pró-labore', 'PY-IPS': 'PY · IPS', 'PY-CONTRATO': 'PY · Contrato' }

type Posto = {
  id: string; codigo: string; nome: string | null; matricula: string | null; regime: string | null; ativo?: boolean
  salario_base: number; fte: number; ini_ano: number | null; ini_mes: number | null; fim_ano: number | null; fim_mes: number | null
  reajuste_mes: number | null; reajuste_pct: number | null; reajuste_valor: number | null   // v3_116
  afast_ini_ano: number | null; afast_ini_mes: number | null                                 // v3_117
  afast_fim_ano: number | null; afast_fim_mes: number | null; afast_motivo: string | null
  admissao: string | null                                                                    // v3_118 (rescisão)
  empresa_id: string; filial_id: string | null; cc_id: string | null; cargo_id: string | null; sindicato_id: string | null
  recurso_cod?: string | null                  // SRA.RA_X_RECUR — liga ao apontamento
  recebe_hora?: boolean | null                 // exceção sobre a função; null = segue a função
  cargo?: { nome: string } | null; empresa?: { codigo: string } | null; filial?: { codigo: string } | null
  centro_custo?: { codigo: string; descricao: string } | null; sindicato?: { codigo: string } | null
}

export default function PostosGradePage() {
  const acesso = useUserAccess()
  const cap = useCapacidades()
  const passoLabel = usePassoLabel()
  const flags = useTenantFlags()
  // a coluna "recebe por hora" só existe onde se aponta hora em projeto
  const nCols = flags.usa_apontamento ? 14 : 13
  const editavel = cap.can('orcar')

  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [cargos, setCargos] = useState<any[]>([])
  const [postos, setPostos] = useState<Posto[]>([])
  const [empresaSel, setEmpresaSel] = usePostoCtx('empresaSel', [])
  const [filialSel, setFilialSel] = usePostoCtx('filialSel', [])
  const [ccSel, setCcSel] = usePostoCtx('ccSel', [])
  const [areaSel, setAreaSel] = usePostoCtx('areaSel', [])
  const [divisaoSel, setDivisaoSel] = usePostoCtx('divisaoSel', [])
  const [buSel, setBuSel] = usePostoCtx('buSel', [])
  const [modo, setModo] = useState<'upsert' | 'substituir'>('upsert')
  const [agruparPor, setAgruparPor] = useLocalPref<'cc' | 'cargo'>('planorc_postos_grade_agrupar', 'cc')
  const [regimeSel, setRegimeSel] = useState('')
  const [busca, setBusca] = useState('')
  // CENÁRIO (v3_120). O quadro mestre é a realidade; a sobreposição por versão
  // guarda as DECISÕES. O modo é explícito de propósito: sem ele, corrigir um
  // salário errado viraria "decisão do cenário" sem ninguém perceber.
  const [modoCenario, setModoCenario] = useState(false)
  const [overlays, setOverlays] = useState<Map<string, PostoVersao>>(new Map())
  const [soAlteradas, setSoAlteradas] = useState(false)
  const [cenForm, setCenForm] = useState<{ posto: Posto; ov: PostoVersao | null } | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [editHora, setEditHora] = useState<string | null>(null)   // posto com o seletor de hora aberto
  const [erro, setErro] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<{ gravados: number; apagados: number; modo: string; semEmp: string[]; semFil: string[]; semCc: string[]; foraEscopo: number; cargosNovos: number; beneficios: number; benefColunas: number; rateioPostos: number; rateioCol: boolean; rateioNaoAchados: string[]; afastados: number } | null>(null)
  const [importando, setImportando] = useState(false)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  // motor de custo
  const [versoes, setVersoes] = useState<any[]>([])
  const [versaoSel, setVersaoSel] = usePostoCtx('versaoId', '')
  const [verbas, setVerbas] = useState<VerbaRegra[]>([])
  const [sindMesBase, setSindMesBase] = useState<Record<string, number>>({})
  const [sindByCod, setSindByCod] = useState<Record<string, string>>({})   // codigo → sindicato_id
  const [sindicatos, setSindicatos] = useState<any[]>([])
  const [dissidio, setDissidio] = useState<Record<string, number>>({})   // sindicato_id → pct (da versão)
  const [form, setForm] = useState<any | null>(null)   // modal novo/editar posto
  const [postoVerbas, setPostoVerbas] = useState<Record<string, Record<string, number>>>({})  // posto_id → { verba_id: valor }
  const [rateioCods, setRateioCods] = useState<any[]>([])   // catálogo de códigos de rateio
  const [destByRegra, setDestByRegra] = useState<Record<string, any[]>>({})   // regra_id → destinos
  const [postoRateios, setPostoRateios] = useState<Record<string, { regra_id: string; ordem: number }[]>>({})  // posto_id → códigos anexados
  const [rateModal, setRateModal] = useState<Posto | null>(null)
  const [drill, setDrill] = useState<Posto | null>(null)

  const loadLookups = async () => {
    const [e, f, c, cg, vs, vb, si, rr, rd] = await Promise.all([
      supabase.from('empresa').select('id,codigo,descricao,pais').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
      supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      supabase.from('cargo').select('id,codigo,nome').order('nome'),
      supabase.from('versao_orcamento').select('id,codigo,bloqueada').order('codigo'),
      supabase.from('verba_folha').select('id,codigo,descricao,tipo_calculo,parametro,verba_ref,conta_destino_id,incide_encargos,mantem_afastado,regime,pais,ordem,categoria').eq('ativo', true).order('ordem', { nullsFirst: false }),
      supabase.from('sindicato').select('id,codigo,mes_database'),
      supabase.from('rateio_regra').select('id,nome,dimensao').eq('ativo', true).order('nome'),
      supabase.from('rateio_destino').select('regra_id,empresa_id,cc_id,pct'),
    ])
    setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || []); setCargos(cg.data || [])
    setRateioCods(rr.data || [])
    const dbr: Record<string, any[]> = {}
    for (const d of rd.data || []) (dbr[d.regra_id] ||= []).push({ empresa_id: d.empresa_id, cc_id: d.cc_id, pct: Number(d.pct) || 0 })
    setDestByRegra(dbr)
    setVersoes(vs.data || []); setVerbas((vb.data || []) as VerbaRegra[])
    setSindMesBase(Object.fromEntries((si.data || []).map((s: any) => [s.id, s.mes_database || 1])))
    setSindByCod(Object.fromEntries((si.data || []).map((s: any) => [String(s.codigo), s.id])))
    setSindicatos(si.data || [])
    if (vs.data?.length) setVersaoSel(prev => vs.data.some((x: any) => x.id === prev) ? prev : vs.data[0].id)
  }
  useEffect(() => {
    if (!versaoSel) { setDissidio({}); return }
    supabase.from('premissa_dissidio').select('sindicato_id,pct').eq('versao_id', versaoSel)
      .then(r => setDissidio(Object.fromEntries((r.data || []).map((x: any) => [x.sindicato_id, Number(x.pct) || 0]))))
  }, [versaoSel])
  const loadPostos = async () => {
    // paginado: posto/posto_verba/posto_rateio escalam com o quadro (postos × verbas/
    // rateios) e passam de 1000 fácil — sem isto a grade cortaria overrides/rateios de
    // parte dos postos e calcularia o custo errado, sem avisar.
    let data: any[]
    try { data = await pageAll(() => supabase.from('posto').select('*, cargo(nome), empresa(codigo), filial(codigo), centro_custo(codigo,descricao), sindicato(codigo)').order('codigo')) }
    catch (e: any) { setErro(e?.message || String(e)); return }
    setPostos((data || []) as Posto[])
    const pv = await pageAll(() => supabase.from('posto_verba').select('posto_id,verba_id,valor').eq('ativo', true))
    const m: Record<string, Record<string, number>> = {}
    for (const r of pv || []) (m[r.posto_id] ||= {})[r.verba_id] = Number(r.valor) || 0
    setPostoVerbas(m)
    const pr = await pageAll(() => supabase.from('posto_rateio').select('posto_id,regra_id,ordem'))
    const rm: Record<string, { regra_id: string; ordem: number }[]> = {}
    for (const r of pr || []) (rm[r.posto_id] ||= []).push({ regra_id: r.regra_id, ordem: Number(r.ordem) || 1 })
    for (const k in rm) rm[k].sort((a, b) => a.ordem - b.ordem)
    setPostoRateios(rm)
  }
  useEffect(() => { loadLookups(); loadPostos() }, [])

  // sobreposição da versão selecionada (paginado: um por posto, 571 e subindo)
  const loadOverlays = async (versaoId: string) => {
    if (!versaoId) { setOverlays(new Map()); return }
    try {
      const rows = await pageAll(() => supabase.from('posto_versao').select('*').eq('versao_id', versaoId))
      setOverlays(new Map((rows || []).map((r: any) => [r.posto_id, r as PostoVersao])))
    } catch (e: any) { setErro('Cenário: ' + (e?.message || e)) }
  }
  useEffect(() => { loadOverlays(versaoSel) }, [versaoSel])   // eslint-disable-line

  const mestreById = useMemo(() => new Map(postos.map(p => [p.id, p])), [postos])
  // O quadro EFETIVO do cenário. Fora do modo cenário é o mestre, pela mesma
  // referência — nada muda para quem só cuida do cadastro.
  const postosEf = useMemo(() =>
    modoCenario ? postos.map(p => resolvePosto(p, overlays.get(p.id))) : postos,
    [postos, overlays, modoCenario])
  const alterados = useMemo(() => {
    const m = new Map<string, CampoCenario[]>()
    if (!modoCenario) return m
    for (const p of postos) {
      const c = camposAlterados(p, overlays.get(p.id))
      if (c.length) m.set(p.id, c)
    }
    return m
  }, [postos, overlays, modoCenario])

  const importar = async (rows: Row[]) => {
    setErro(null); setImportInfo(null)
    if (!rows.length) { setErro('Arquivo vazio.'); return }
    setImportando(true)
    try {
      const empByCod = new Map(empresas.map(e => [String(e.codigo).trim(), e.id]))
      const filByCod = new Map(filiais.map(f => [String(f.codigo).trim(), f.id]))
      const ccByCod = new Map(ccs.map(c => [String(c.codigo).trim(), c.id]))
      let cargoByNome = new Map(cargos.map(c => [String(c.nome).trim().toUpperCase(), c.id]))
      const nomesNovos = [...new Set(rows.map(r => (r.cargo || '').trim()).filter(n => n && !cargoByNome.has(n.toUpperCase())))]
      if (nomesNovos.length) {
        const novos = nomesNovos.map(nome => ({ tenant_id: TENANT_ID, codigo: slug(nome), nome, ativo: true }))
        const { error } = await supabase.from('cargo').upsert(novos, { onConflict: 'tenant_id,codigo', ignoreDuplicates: true })
        if (error) { setErro('Erro criando cargos: ' + error.message); return }
        const { data } = await supabase.from('cargo').select('id,nome')
        cargoByNome = new Map((data || []).map((c: any) => [String(c.nome).trim().toUpperCase(), c.id])); setCargos(data || [])
      }
      const semEmp = new Set<string>(), semFil = new Set<string>(), semCc = new Set<string>()
      const foraEscopo = new Set<string>()   // linhas fora do que o usuário pode orçar (empresa/filial/CC)
      // A coluna `recebe_hora` entra no upsert TUDO ou NADA. Incluí-la só em
      // algumas linhas deixaria o resultado por conta de como o PostgREST une as
      // chaves do lote — e o efeito seria apagar em silêncio a marcação de quem
      // o export não classificou. Com o arquivo trazendo a categoria, o cadastro
      // da folha manda em todo mundo; sem ela, a coluna nem é tocada.
      const temCatFunc = rows.some(r => (r.recebe_hora || '').trim())
      // Mesma regra para o afastamento: sem a coluna no arquivo, o import não
      // toca na janela — senão uma carga de um export antigo apagaria o retorno
      // que alguém já previu na grade.
      const temAfast = rows.some(r => 'afastado_desde' in r)
      let nAfast = 0
      const payload: any[] = []
      for (const r of rows) {
        if (!r.posto_codigo) continue
        const empresa_id = empByCod.get((r.empresa || '').trim())
        if (!empresa_id) { if (r.empresa) semEmp.add(r.empresa); continue }
        const filial_id = filByCod.get((r.filial || '').trim()) || null; if (!filial_id && r.filial) semFil.add(r.filial)
        const cc_id = ccByCod.get((r.cc || '').trim()) || null; if (!cc_id && r.cc) semCc.add(r.cc)
        // escopo de EDIÇÃO: não importa nada fora do que o usuário pode orçar (admin passa tudo)
        if (!acesso.canEdit('empresa', empresa_id) || (filial_id && !acesso.canEdit('filial', filial_id)) || (cc_id && !acesso.canEdit('centro_custo', cc_id))) {
          foraEscopo.add(r.posto_codigo); continue
        }
        const cargo_id = cargoByNome.get((r.cargo || '').trim().toUpperCase()) || null
        const [ay, am] = (r.admissao || '').split('-')
        payload.push({ tenant_id: TENANT_ID, codigo: r.posto_codigo, empresa_id, filial_id, cc_id, cargo_id,
          sindicato_id: sindByCod[sindCodPorEmp((r.empresa || '').trim())] || null,
          regime: (() => { const s = (r.regime || '').trim(); return s ? (s.includes('-') ? s : 'BR-' + s) : null })(), salario_base: r.salario ? parseFloat(r.salario) : 0,
          nome: (r.nome || '').trim() || null, matricula: (r.matricula || '').trim() || null,
          // código do recurso no apontamento de horas (SRA.RA_X_RECUR). É o que liga o
          // posto ao Extrato de Horas Apontadas — lá a pessoa é identificada por recurso,
          // não por matrícula. Vazio em vaga planejada e em quem não aponta.
          recurso_cod: (r.recurso || '').trim() || null,
          // roteiro AUT (RA_CATFUNC='A'): quem o integrador do apontamento paga
          // POR HORA. Quem não é aponta para dizer onde o custo cai, e some da
          // conferência Apontamento × Folha.
          ...(temCatFunc ? { recebe_hora: (() => { const s = (r.recebe_hora || '').trim().toLowerCase(); return s ? s !== 'nao' : null })() } : {}),
          // afastado_desde = 'AAAA-MM' do export. O ERP não sabe o retorno, então
          // ele entra em aberto (motor zera os 12 meses) e a grade marca a linha
          // com o chip AFASTADO para ser conferida.
          ...(temAfast ? (() => {
            const [fy, fm] = (r.afastado_desde || '').trim().split('-')
            if (!fy || !fm) return { afast_ini_ano: null, afast_ini_mes: null, afast_fim_ano: null, afast_fim_mes: null, afast_motivo: null }
            nAfast++
            return { afast_ini_ano: parseInt(fy, 10), afast_ini_mes: parseInt(fm, 10), afast_fim_ano: null, afast_fim_mes: null,
              afast_motivo: `${(r.situacao || 'afastado').trim()} (do RH em ${r.afastado_desde}) — confirmar retorno` }
          })() : {}),
          // a admissão alimenta DUAS coisas: a vigência de início (o posto começa
          // a custar quando a pessoa entrou) e o tempo de casa da rescisão. A
          // segunda fica na sua própria coluna porque a vigência é editável.
          admissao: (r.admissao || '').trim() || null,
          ini_ano: ay ? parseInt(ay, 10) : null, ini_mes: am ? parseInt(am, 10) : null, fte: 1, ativo: (r.ativo || 'sim') !== 'nao' })
      }
      if (!payload.length) {
        setErro(foraEscopo.size ? `Nenhuma linha dentro do seu escopo de edição (${foraEscopo.size} fora). Você só importa postos das empresas/filiais/CCs que pode orçar.`
          : 'Nenhuma linha resolvida — confira se os códigos de empresa existem nos cadastros.'); return
      }
      let apagados = 0
      if (modo === 'substituir') {
        const empIds = [...new Set(payload.map(p => p.empresa_id))]
        const cods = empIds.map(id => empresas.find(e => e.id === id)?.codigo || id)
        // "substituir" só apaga DENTRO do escopo editável do usuário: se ele é limitado
        // por filial/CC, o delete é restrito a essas filiais/CCs (não toca no que ele não
        // pode editar). Admin/irrestrito: apaga por empresa como antes.
        const editFil = filiais.filter(f => acesso.canEdit('filial', f.id)).map(f => f.id)
        const editCc = ccs.filter(c => acesso.canEdit('centro_custo', c.id)).map(c => c.id)
        const scopedFil = editFil.length < filiais.length, scopedCc = editCc.length < ccs.length
        const alvo = scopedFil || scopedCc ? 'os postos do seu escopo' : 'TODOS os postos'
        if (!confirm(`SUBSTITUIR: apaga ${alvo} nas empresas ${cods.join(', ')} e recarrega do arquivo.\nAjustes manuais e vagas desse escopo serão perdidos. Continuar?`)) return
        let dq = supabase.from('posto').delete({ count: 'exact' }).in('empresa_id', empIds)
        if (scopedFil) dq = dq.in('filial_id', editFil)
        if (scopedCc) dq = dq.in('cc_id', editCc)
        const { count, error: delErr } = await dq
        if (delErr) { setErro('Erro ao limpar o escopo: ' + delErr.message); return }
        apagados = count || 0
      }
      const { error } = await supabase.from('posto').upsert(payload, { onConflict: 'tenant_id,codigo' })
      if (error) { setErro('Erro no import: ' + error.message); return }

      // ids dos postos gravados (reusado por benefícios e rateio)
      const codigos = payload.map(p => p.codigo)
      const idByCod = new Map<string, string>()
      for (let i = 0; i < codigos.length; i += 150) {
        const { data } = await supabase.from('posto').select('id,codigo').in('codigo', codigos.slice(i, i + 150))
        for (const x of data || []) idByCod.set(x.codigo, x.id)
      }

      // benefícios por posto: colunas do arquivo que casam com códigos de verba (VALOR_FIXO) → posto_verba
      const verbaByCod = new Map(verbas.map(v => [String(v.codigo).trim().toUpperCase(), v.id]))
      const benefCols = Object.keys(rows[0] || {}).filter(c => verbaByCod.has(c.trim().toUpperCase()))
      let benefCriados = 0
      if (benefCols.length) {
        const pvRows: any[] = []
        for (const r of rows) {
          const pid = idByCod.get(r.posto_codigo); if (!pid) continue
          for (const col of benefCols) {
            const raw = (r[col] || '').trim(); if (!raw) continue
            const val = parseFloat(raw.replace(',', '.')); if (!val || isNaN(val)) continue
            pvRows.push({ tenant_id: TENANT_ID, posto_id: pid, verba_id: verbaByCod.get(col.trim().toUpperCase()), valor: val })
          }
        }
        const pids = [...idByCod.values()]
        if (pids.length) await supabase.from('posto_verba').delete().in('posto_id', pids)   // re-sincroniza os benefícios dos postos do arquivo
        if (pvRows.length) { const { error: pvErr } = await supabase.from('posto_verba').upsert(pvRows, { onConflict: 'posto_id,verba_id' }); if (pvErr) setErro('Aviso — benefícios: ' + pvErr.message) }
        benefCriados = pvRows.length
      }

      // rateio por posto: coluna RATEIO com códigos (nome) separados por ; em ordem de cascata → posto_rateio
      const rateioCol = Object.keys(rows[0] || {}).find(c => c.trim().toUpperCase() === 'RATEIO')
      let rateioPostos = 0; const rateioNaoAchados = new Set<string>()
      if (rateioCol) {
        const regraByNome = new Map(rateioCods.map(c => [String(c.nome).trim().toUpperCase(), c.id]))
        const prRows: any[] = []
        for (const r of rows) {
          const pid = idByCod.get(r.posto_codigo); if (!pid) continue
          const toks = String(r[rateioCol] || '').split(/[;,]/).map(t => t.trim()).filter(Boolean)
          if (!toks.length) continue
          let ordem = 0; let anexou = false
          for (const t of toks) {
            const rid = regraByNome.get(t.toUpperCase())
            if (!rid) { rateioNaoAchados.add(t); continue }
            ordem++; prRows.push({ tenant_id: TENANT_ID, posto_id: pid, regra_id: rid, ordem }); anexou = true
          }
          if (anexou) rateioPostos++
        }
        const pids2 = [...idByCod.values()]
        if (pids2.length) await supabase.from('posto_rateio').delete().in('posto_id', pids2)   // re-sincroniza o rateio dos postos do arquivo
        if (prRows.length) { const { error: prErr } = await supabase.from('posto_rateio').upsert(prRows, { onConflict: 'tenant_id,posto_id,regra_id' }); if (prErr) setErro('Aviso — rateio: ' + prErr.message) }
      }

      setImportInfo({ gravados: payload.length, apagados, modo, semEmp: [...semEmp], semFil: [...semFil], semCc: [...semCc], foraEscopo: foraEscopo.size, cargosNovos: nomesNovos.length, beneficios: benefCriados, benefColunas: benefCols.length, rateioPostos, rateioCol: !!rateioCol, rateioNaoAchados: [...rateioNaoAchados], afastados: nAfast })
      loadPostos()
    } finally { setImportando(false) }
  }
  const onFile = async (file: File) => {
    try { await importar(file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : await parseXlsxRows(file)) }
    catch (e: any) { setErro('Erro ao ler o arquivo: ' + (e?.message || e)) }
  }

  // ── Aplicar no orçado (step 5): grava fat_orcado (origem POSTO) do quadro ativo da versão ──
  const [aplicando, setAplicando] = useState(false)
  const [aplicarInfo, setAplicarInfo] = useState<{ linhas: number; postos: number; contas: number; ano: number; fundidas: number; semTaxa: number; semConta: string[]; natEstranha: string[] } | null>(null)
  const aplicarNoOrcado = async () => {
    setErro(null); setAplicarInfo(null)
    if (!versaoSel) { setErro('Selecione a versão do orçamento.'); return }
    // Versão bloqueada é versão aprovada: o Aplicar APAGA todo o orçado POSTO dela e
    // regrava do quadro ATUAL — que pode já estar noutra hipótese. O editor de
    // formulário sempre respeitou `bloqueada`; a folha não, e é justamente o maior
    // bloco de custo. Guarda do P0 (docs/DESIGN_cenarios.md §7.6).
    const vSel = versoes.find(v => v.id === versaoSel)
    if (vSel?.bloqueada) {
      setErro(`A versão ${vSel.codigo} está BLOQUEADA (aprovada) — o Aplicar apagaria e regravaria o orçado de folha dela a partir do quadro de postos de hoje. Desbloqueie em Cadastros → Versões se for mesmo para refazer, ou escolha outra versão.`)
      return
    }
    if (!temMotor) { setErro('Sem verbas cadastradas — cadastre a Estrutura antes de aplicar.'); return }
    // O Aplicar grava o quadro EFETIVO: no modo cenário são as decisões da versão,
    // fora dele é o mestre. Sem isto o cenário existiria só na tela.
    const ativos = postosEf.filter(p => p.ativo !== false)
    const versaoCod = versoes.find(v => v.id === versaoSel)?.codigo || String(anoCalc)
    if (!confirm(`Aplicar ${ativos.length} postos ativos no orçado da versão ${versaoCod} (ano ${anoCalc})?\n\nIsto SUBSTITUI todo o orçado de origem POSTO desta versão. Lançamentos manuais e de formulário não são afetados.\n\nDespesa é gravada com sinal NEGATIVO, como o orçado manual e o realizado.`)) return
    setAplicando(true)
    try {
      const round2 = (n: number) => Math.round(n * 100) / 100
      // MULTIMOEDA: moeda_origem = moeda funcional da empresa do POSTO (fonte do custo);
      // converte pela taxa ORÇADA da versão. BR (slot 1) = valor fica base, só preenche val_m2.
      const [{ data: moedasD }, { data: empMoedaD }, vtaxas, contasNat] = await Promise.all([
        supabase.from('moeda').select('slot').eq('ativo', true).order('slot'),
        supabase.from('empresa').select('id,moeda_slot'),
        pageAll(() => supabase.from('versao_taxa').select('moeda_slot,ano,mes,taxa').eq('versao_id', versaoSel)),
        pageAll(() => supabase.from('conta_orcamentaria').select('id,codigo,natureza')),
      ])
      // SINAL: fat_orcado guarda despesa NEGATIVA — é a convenção do orçado
      // MANUAL e do realizado. O motor gravava positivo, e na DRE as duas
      // origens se cancelavam em vez de somar (EBITDA inflado em 517% quando
      // medimos). Decide pela `natureza` da conta, não por "folha é despesa":
      // se amanhã o motor escrever numa conta de outra natureza, acerta sozinho.
      // Não vale para a `fat_folha`: lá o lado realizado vem da folha do ERP,
      // que é positiva, e a conciliação compara os dois crus.
      const natConta = new Map<string, string | null>((contasNat || []).map((c: any) => [c.id, c.natureza]))
      const codConta = new Map<string, string>((contasNat || []).map((c: any) => [c.id, c.codigo]))
      const sinalDe = (conta: string) => natConta.get(conta) === 'DESPESA' ? -1 : 1
      const natEstranha = new Set<string>()   // conta que o motor escreve e não é DESPESA
      const slotsAtivos = (moedasD?.length ? moedasD.map((m: any) => m.slot) : [1]) as number[]
      const empMoeda = new Map<string, number>((empMoedaD || []).map((e: any) => [e.id, e.moeda_slot || 1]))
      let semTaxaOrc = 0
      const matOrc = (row: any) => {   // row.valor em moeda de origem → base + slots
        const orig = row.moeda_origem || 1
        if (orig === 1 && slotsAtivos.every(s => s === 1)) return true
        const { vals } = materializa(row.valor, orig, slotsAtivos, (slot) => taxaOrcada(slot, row.ano, row.mes, vtaxas as any))
        if (vals[1] == null) { semTaxaOrc++; return false }   // origem estrangeira sem taxa orçada
        row.valor = vals[1]; row.val_m2 = vals[2] ?? null; row.val_m3 = vals[3] ?? null; row.val_m4 = vals[4] ?? null; row.val_m5 = vals[5] ?? null; return true
      }
      const byKey = new Map<string, any>()   // dedup pela chave da uq_fat_orcado (soma colisões)
      const contasTocadas = new Set<string>(); let postosAplicados = 0; let gerados = 0
      // Verba COM valor e SEM conta destino não entra no fat_orcado: porContaMes
      // só indexa quem tem conta. O número aparece na grade e não chega à DRE —
      // perda silenciosa, e a rescisão nasce justamente sem conta amarrada.
      const semConta = new Set<string>()
      const verbaById = new Map(verbas.map(v => [v.id, v]))   // p/ orçado por verba (fat_folha ORCADO)
      const folhaRows: any[] = []            // orçado por posto × verba × mês (NÃO rateado)
      for (const p of ativos) {
        const r = custos.get(p.id); if (!r) continue
        const { cells } = cascataRateio({ empresa_id: p.empresa_id, cc_id: p.cc_id || null }, postoRateios[p.id] || [], rateioCods, destByRegra)
        let algo = false
        for (const conta in r.porContaMes) {
          const mensal = r.porContaMes[conta]
          const sin = sinalDe(conta)
          if (sin > 0) natEstranha.add(`${codConta.get(conta) || conta} (${natConta.get(conta) || 'sem natureza'})`)
          for (let mi = 0; mi < 12; mi++) {
            const base = mensal[mi] * sin; if (!base) continue
            for (const cell of cells) {
              const valor = round2(base * cell.pct); if (!valor) continue
              const mudouEmpresa = cell.empresa_id !== p.empresa_id
              const filial_id = mudouEmpresa ? null : (p.filial_id || null)
              const cc_id = cell.cc_id || null
              const dims: any = { posto: p.codigo, posto_id: p.id, nome: p.nome || null, matricula: p.matricula || null, cc_origem: p.cc_id || null, ...(cell.pct < 0.999999 ? { rateio_pct: round2(cell.pct * 100) } : {}) }
              const dk = JSON.stringify(Object.keys(dims).sort().reduce((o: any, k) => (o[k] = dims[k], o), {}))
              const key = `${conta}|${cell.empresa_id}|${filial_id || '-'}|${cc_id || '-'}|${mi + 1}|${dk}`
              gerados++
              const ex = byKey.get(key)
              if (ex) ex.valor = round2(ex.valor + valor)
              else byKey.set(key, { tenant_id: TENANT_ID, versao_id: versaoSel, linha_id: conta, empresa_id: cell.empresa_id, filial_id, cc_id, ano: anoCalc, mes: mi + 1, valor, expressao: null, origem: 'POSTO', dims, moeda_origem: empMoeda.get(p.empresa_id) || 1 })
              contasTocadas.add(conta); algo = true
            }
          }
        }
        if (algo) postosAplicados++
        // orçado POR VERBA (paralelo, não rateado) — na empresa/CC do próprio posto
        for (const vid in r.porVerbaMes) {
          const mensal = r.porVerbaMes[vid]; const vinfo = verbaById.get(vid)
          if (!vinfo?.conta_destino_id && mensal.some(x => x)) semConta.add(vinfo?.codigo || vid)
          for (let mi = 0; mi < 12; mi++) {
            const valor = round2(mensal[mi]); if (!valor) continue
            folhaRows.push({
              tenant_id: TENANT_ID, versao_id: versaoSel, ano: anoCalc, mes: mi + 1, tipo: 'ORCADO', origem: 'POSTO',
              empresa_id: p.empresa_id, filial_id: p.filial_id || null, cc_id: p.cc_id || null,
              matricula: p.matricula || null, nome: p.nome || null, posto_id: p.id,
              verba_cod: vinfo?.codigo || null, verba_desc: vinfo?.descricao || null,
              item_orc_id: vinfo?.conta_destino_id || null, valor, moeda_origem: empMoeda.get(p.empresa_id) || 1,
            })
          }
        }
      }
      // materializa moedas (converte valor→base + val_m2/val_m3 pela taxa orçada); descarta o que não tem base
      const rows = [...byKey.values()].filter(matOrc)
      const folhaOk = folhaRows.filter(matOrc)
      // substitui o orçado origem POSTO da versão e reinsere
      const { error: delErr } = await supabase.from('fat_orcado').delete().eq('versao_id', versaoSel).eq('origem', 'POSTO')
      if (delErr) { setErro('Erro ao limpar o orçado POSTO: ' + delErr.message); return }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('fat_orcado').insert(rows.slice(i, i + 500))
        if (error) { setErro('Erro ao gravar o orçado (parcial): ' + error.message); return }
      }
      // paralelo: orçado por verba na fat_folha (tipo ORCADO) — p/ conciliação por verba
      const delF = await supabase.from('fat_folha').delete().eq('tipo', 'ORCADO').eq('versao_id', versaoSel)
      if (delF.error) { setErro('Aviso — orçado por verba (limpeza): ' + delF.error.message) }
      else for (let i = 0; i < folhaOk.length; i += 500) {
        const { error } = await supabase.from('fat_folha').insert(folhaOk.slice(i, i + 500))
        if (error) { setErro('Aviso — orçado por verba (gravação): ' + error.message); break }
      }
      setAplicarInfo({ linhas: rows.length, postos: postosAplicados, contas: contasTocadas.size, ano: anoCalc, fundidas: gerados - rows.length, semTaxa: semTaxaOrc, semConta: [...semConta], natEstranha: [...natEstranha] })
    } finally { setAplicando(false) }
  }
  // Grava a DECISÃO na versão, não no cadastro. `limpar` marca campos
  // explicitamente vazios no cenário (o mestre demite em maio, o cenário mantém).
  // Overlay que ficou sem nenhuma decisão é APAGADO: cenário não guarda "igual
  // ao mestre" — senão o filtro "só alteradas" encheria de linhas sem mudança.
  const salvarCenario = async (postoId: string, patch: Partial<PostoVersao>, limpar: CampoCenario[] = []) => {
    if (!versaoSel) { setErro('Selecione a versão para editar o cenário.'); return }
    const atual = overlays.get(postoId)
    const limpos = new Set([...(atual?.limpos || [])])
    for (const c of limpar) limpos.add(c)
    for (const k of Object.keys(patch)) if ((patch as any)[k] != null) limpos.delete(k)
    const novo: PostoVersao = { ...(atual || { versao_id: versaoSel, posto_id: postoId }), ...patch, limpos: [...limpos] }
    if (overlayVazio(novo)) {
      if (atual?.id) {
        const { error } = await supabase.from('posto_versao').delete().eq('id', atual.id)
        if (error) { setErro(error.message); return }
      }
      setOverlays(m => { const n = new Map(m); n.delete(postoId); return n })
      return
    }
    const row: any = { tenant_id: TENANT_ID, versao_id: versaoSel, posto_id: postoId, limpos: novo.limpos, nota: novo.nota ?? null }
    for (const c of CAMPOS_CENARIO) row[c] = (novo as any)[c] ?? null
    const { data, error } = await supabase.from('posto_versao')
      .upsert(row, { onConflict: 'versao_id,posto_id' }).select('*').single()
    if (error) { setErro(error.message); return }
    setOverlays(m => new Map(m).set(postoId, data as PostoVersao))
  }

  // Roteador: no modo cenário a edição vira DECISÃO da versão; fora dele, cadastro.
  const grava = (id: string, patch: any) => modoCenario ? salvarCenario(id, patch) : salvar(id, patch)

  // Some com a sobreposição inteira: a linha volta a herdar o cadastro.
  const limparCenario = async (postoId: string) => {
    const ov = overlays.get(postoId)
    if (ov?.id) { const { error } = await supabase.from('posto_versao').delete().eq('id', ov.id); if (error) { setErro(error.message); return } }
    setOverlays(m => { const n = new Map(m); n.delete(postoId); return n })
  }

  const salvar = async (id: string, patch: Partial<Posto>) => {
    const { error } = await supabase.from('posto').update(patch).eq('id', id)
    if (error) { setErro(error.message); return }
    setPostos(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
  }
  const excluir = async (id: string, cod: string) => {
    if (!confirm(`Excluir o posto ${cod}?`)) return
    const { error } = await supabase.from('posto').delete().eq('id', id)
    if (error) { setErro(error.message); return }
    setPostos(ps => ps.filter(p => p.id !== id))
  }
  // novo posto / vaga ou edição (código, ocupante, cargo, local, regime, salário, vigência)
  const novoPosto = (pre?: { cc_id?: string; cargo_id?: string }) => setForm({ codigo: '', codigoAuto: true, nome: '', matricula: '', cargo_id: pre?.cargo_id || '', empresa_id: (empresas[0]?.id || ''), filial_id: '', cc_id: pre?.cc_id || '', sindicato_id: '', regime: 'BR-CLT', salario_base: '', fte: '1', ini_ano: String(anoCalc), ini_mes: '1', fim_ano: '', fim_mes: '', reajuste_mes: '', reajuste_pct: '', reajuste_valor: '', admissao: '', afast_ini_ano: '', afast_ini_mes: '', afast_fim_ano: '', afast_fim_mes: '', afast_motivo: '', rateios: [] })
  const editarPosto = (p: Posto) => setForm({ id: p.id, codigo: p.codigo, codigoAuto: false, nome: p.nome || '', matricula: p.matricula || '', cargo_id: p.cargo_id || '', empresa_id: p.empresa_id, filial_id: p.filial_id || '', cc_id: p.cc_id || '', sindicato_id: p.sindicato_id || '', regime: p.regime || '', salario_base: p.salario_base != null ? String(p.salario_base) : '', fte: p.fte != null ? String(p.fte) : '1', ini_ano: p.ini_ano ? String(p.ini_ano) : '', ini_mes: p.ini_mes ? String(p.ini_mes) : '', fim_ano: p.fim_ano ? String(p.fim_ano) : '', fim_mes: p.fim_mes ? String(p.fim_mes) : '', reajuste_mes: p.reajuste_mes ? String(p.reajuste_mes) : '', reajuste_pct: p.reajuste_pct != null ? String(p.reajuste_pct) : '', reajuste_valor: p.reajuste_valor != null ? String(p.reajuste_valor) : '', afast_ini_ano: p.afast_ini_ano ? String(p.afast_ini_ano) : '', afast_ini_mes: p.afast_ini_mes ? String(p.afast_ini_mes) : '', afast_fim_ano: p.afast_fim_ano ? String(p.afast_fim_ano) : '', afast_fim_mes: p.afast_fim_mes ? String(p.afast_fim_mes) : '', afast_motivo: p.afast_motivo || '', admissao: p.admissao || '', rateios: (postoRateios[p.id] || []).map(r => ({ ...r })) })
  const salvarPosto = async () => {
    if (!form) return
    if (!form.empresa_id) { setErro('Informe a empresa.'); return }
    if (!form.filial_id) { setErro('Informe a filial.'); return }
    const codigo = ((form.codigoAuto ? gerarCodigoPosto(form.filial_id, form.matricula) : form.codigo) || '').trim()
    if (!codigo) { setErro('Código não gerado — confira a filial.'); return }
    const empCod = empresas.find(e => e.id === form.empresa_id)?.codigo || ''
    const afastOn = !!(form.afast_ini_ano && form.afast_ini_mes)
    const payload: any = {
      tenant_id: TENANT_ID, codigo,
      nome: (form.nome || '').trim() || null, matricula: (form.matricula || '').trim() || null,
      cargo_id: form.cargo_id || null, empresa_id: form.empresa_id, filial_id: form.filial_id || null, cc_id: form.cc_id || null,
      sindicato_id: form.sindicato_id || sindByCod[sindCodPorEmp(empCod)] || null,
      regime: form.regime || null, salario_base: parseNum(form.salario_base) || 0, fte: parseNum(form.fte) || 1,
      ini_ano: form.ini_ano ? parseInt(form.ini_ano, 10) : null, ini_mes: form.ini_mes ? parseInt(form.ini_mes, 10) : null,
      fim_ano: form.fim_ano ? parseInt(form.fim_ano, 10) : null, fim_mes: form.fim_mes ? parseInt(form.fim_mes, 10) : null,
      // o CHECK da v3_116 exige mês quando há pct OU valor, e os dois são
      // alternativos — limpar o par inteiro quando não há mês evita gravar um
      // reajuste sem data, que o motor ignoraria em silêncio
      reajuste_mes: form.reajuste_mes ? parseInt(form.reajuste_mes, 10) : null,
      reajuste_pct: form.reajuste_mes && form.reajuste_pct && !form.reajuste_valor ? parseNum(form.reajuste_pct) : null,
      reajuste_valor: form.reajuste_mes && form.reajuste_valor ? parseNum(form.reajuste_valor) : null,
      // Afastamento: o CHECK da v3_117 exige ano E mês no início. Sem início não
      // há janela, e aí o fim e o motivo não querem dizer nada — por isso o
      // trio é limpo junto, como no reajuste.
      afast_ini_ano: afastOn ? parseInt(form.afast_ini_ano, 10) : null,
      afast_ini_mes: afastOn ? parseInt(form.afast_ini_mes, 10) : null,
      afast_fim_ano: afastOn && form.afast_fim_ano && form.afast_fim_mes ? parseInt(form.afast_fim_ano, 10) : null,
      afast_fim_mes: afastOn && form.afast_fim_ano && form.afast_fim_mes ? parseInt(form.afast_fim_mes, 10) : null,
      afast_motivo: afastOn ? ((form.afast_motivo || '').trim() || null) : null,
      admissao: (form.admissao || '').trim() || null,   // só a rescisão usa (tempo de casa)
      ativo: true,
    }
    const saved = form.id
      ? await supabase.from('posto').update(payload).eq('id', form.id).select('id').single()
      : await supabase.from('posto').insert(payload).select('id').single()
    if (saved.error) { setErro(saved.error.message); return }
    const postoId = saved.data?.id || form.id
    // sincroniza rateios anexados (posto_rateio)
    if (postoId) {
      await supabase.from('posto_rateio').delete().eq('posto_id', postoId)
      const vistos = new Set<string>()
      const rrows = (form.rateios || []).filter((r: any) => r.regra_id && !vistos.has(r.regra_id) && vistos.add(r.regra_id))
        .map((r: any) => ({ tenant_id: TENANT_ID, posto_id: postoId, regra_id: r.regra_id, ordem: r.ordem || 1 }))
      if (rrows.length) { const { error: rErr } = await supabase.from('posto_rateio').insert(rrows); if (rErr) { setErro('Aviso — rateio: ' + rErr.message) } }
    }
    setForm(null); loadPostos()
  }

  // edita o valor de uma verba (benefício) deste posto: >0 grava, 0/vazio remove
  const salvarBenef = async (postoId: string, verbaId: string, valor: number) => {
    if (valor > 0) {
      const { error } = await supabase.from('posto_verba').upsert({ tenant_id: TENANT_ID, posto_id: postoId, verba_id: verbaId, valor, ativo: true }, { onConflict: 'posto_id,verba_id' })
      if (error) { setErro(error.message); return }
      setPostoVerbas(pv => ({ ...pv, [postoId]: { ...(pv[postoId] || {}), [verbaId]: valor } }))
    } else {
      const { error } = await supabase.from('posto_verba').delete().eq('posto_id', postoId).eq('verba_id', verbaId)
      if (error) { setErro(error.message); return }
      setPostoVerbas(pv => { const p = { ...(pv[postoId] || {}) }; delete p[verbaId]; return { ...pv, [postoId]: p } })
    }
  }

  // filtro compartilhado (empresa/filial/CC/área/divisão/BU) cruzado com o escopo de dados do usuário (F2)
  const filtrados = useMemo(() => {
    const empF = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const filF = escopoFiltro((filialSel.length && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee)
    const ccF = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    const sEmp = empF ? new Set(empF) : null, sFil = filF ? new Set(filF) : null, sCc = ccF ? new Set(ccF) : null
    const q = busca.trim().toLowerCase()
    const match = (p: Posto) => !q || [p.nome, p.matricula, p.cargo?.nome, p.codigo, p.centro_custo?.descricao, p.centro_custo?.codigo]
      .some(x => (x || '').toString().toLowerCase().includes(q))
    return postosEf.filter(p =>
      (!soAlteradas || alterados.has(p.id)) &&
      (mostrarInativos || p.ativo !== false) &&
      (!sEmp || sEmp.has(p.empresa_id)) &&
      (!sFil || (p.filial_id != null && sFil.has(p.filial_id))) &&
      (!sCc || (p.cc_id != null && sCc.has(p.cc_id))) &&
      (!regimeSel || p.regime === regimeSel) && match(p)
    )
  }, [postosEf, soAlteradas, alterados, mostrarInativos, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, regimeSel, busca, empresas, filiais, ccs, acesso.loading]) // eslint-disable-line
  const nInativos = useMemo(() => postosEf.filter(p => p.ativo === false).length, [postosEf])

  // ── motor: custo por posto (com encargos/provisões/benefícios) ──
  const anoCalc = useMemo(() => {
    const m = (versoes.find(v => v.id === versaoSel)?.codigo || '').match(/(20\d{2})/)
    return m ? parseInt(m[1], 10) : new Date().getFullYear()
  }, [versoes, versaoSel])
  const temMotor = verbas.length > 0
  const empPais = useMemo(() => new Map((empresas as any[]).map(e => [e.id, e.pais ?? null])), [empresas])
  const custos = useMemo(() => {
    const map = new Map<string, ResultadoPosto>()
    if (!temMotor) return map
    for (const p of postosEf) map.set(p.id, calcularPosto({ ...(p as any), pais: empPais.get(p.empresa_id) ?? null }, verbas, {
      dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
      mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
      ano: anoCalc,
      valoresFixos: postoVerbas[p.id] || {},
    }))
    return map
  }, [postosEf, verbas, dissidio, sindMesBase, anoCalc, temMotor, postoVerbas, empPais])
  // Custo do quadro MESTRE, só no modo cenário: é o que dá o "quanto este
  // cenário muda" sem sair da tela. O EBITDA inteiro continua no relatório —
  // aqui é só a folha.
  const custoBaseAno = useMemo(() => {
    if (!modoCenario || !temMotor) return null
    let t = 0
    for (const p of postos) {
      if (p.ativo === false) continue
      t += calcularPosto({ ...(p as any), pais: empPais.get(p.empresa_id) ?? null }, verbas, {
        dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
        mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
        ano: anoCalc, valoresFixos: postoVerbas[p.id] || {},
      }).totalAno
    }
    return t
  }, [modoCenario, postos, verbas, dissidio, sindMesBase, anoCalc, temMotor, postoVerbas, empPais])

  const custoAnoP = (p: Posto) => custos.get(p.id)?.totalAno ?? (Number(p.salario_base) || 0) * (Number(p.fte) || 1) * 12
  const custoMesP = (p: Posto) => custos.get(p.id)?.totalMes ?? (Number(p.salario_base) || 0) * (Number(p.fte) || 1)
  const empById = useMemo(() => new Map(empresas.map((e: any) => [e.id, e])), [empresas])
  const ccById = useMemo(() => new Map(ccs.map((c: any) => [c.id, c])), [ccs])
  // código automático do posto: {filial}-{matrícula} ou, sem matrícula (vaga), {filial}-VG{seq}
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const proxVagaSeq = (filialCod: string) => {
    const re = new RegExp(`^${escapeRe(filialCod)}-VG(\\d+)$`, 'i')
    let max = 0
    for (const p of postos) { const m = (p.codigo || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
    return max + 1
  }
  const gerarCodigoPosto = (filial_id: string, matricula: string) => {
    const fc = filiais.find((f: any) => f.id === filial_id)?.codigo
    if (!fc) return ''
    const mat = (matricula || '').trim()
    return mat ? `${fc}-${mat}` : `${fc}-VG${String(proxVagaSeq(fc)).padStart(2, '0')}`
  }

  // agrupa por centro de custo OU cargo (seletor)
  const grupos = useMemo(() => {
    const porCc = agruparPor === 'cc'
    const custo = (ps: Posto[]) => ps.reduce((s, p) => s + custoAnoP(p), 0)
    const m = new Map<string, { key: string; cod: string; desc: string; postos: Posto[] }>()
    for (const p of filtrados) {
      const k = (porCc ? p.cc_id : p.cargo_id) || '__sem'
      if (!m.has(k)) m.set(k, {
        key: k, cod: porCc ? (p.centro_custo?.codigo || '') : '',
        desc: (porCc ? p.centro_custo?.descricao : p.cargo?.nome) || (porCc ? 'Sem centro de custo' : 'Sem cargo'),
        postos: [],
      })
      m.get(k)!.postos.push(p)
    }
    return [...m.values()].map(g => ({ ...g, custoAno: custo(g.postos) }))
      .sort((a, b) => (a.cod || a.desc || 'zzz').localeCompare(b.cod || b.desc || 'zzz'))
  }, [filtrados, agruparPor, custos]) // eslint-disable-line
  const toggle = (k: string) => setFechados(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const gruposKeys = useMemo(() => grupos.map(g => 'a:' + g.key), [grupos])
  const algumAberto = gruposKeys.some(k => !fechados.has(k))
  const toggleTodos = () => setFechados(algumAberto ? new Set(gruposKeys) : new Set())

  const tot = useMemo(() => {
    const head = filtrados.length, vagas = filtrados.filter(p => !p.nome).length
    // Headcount ≠ postos: a mesma pessoa pode ter mais de um posto (sócio com
    // prestação de serviço E pró-labore, por exemplo). Para CUSTO os dois contam,
    // são pagamentos reais; para QUADRO, não — "45 pessoas" seria falso se
    // algumas aparecem duas vezes. Conta por matrícula; sem matrícula (vaga
    // planejada ou cadastro incompleto) cada posto é um, que é o mais seguro.
    const pessoas = new Set(filtrados.map(p => (p.matricula || '').trim() || `__posto_${p.id}`)).size
    const fte = filtrados.reduce((s, p) => s + (Number(p.fte) || 0), 0)
    const ano = filtrados.reduce((s, p) => s + custoAnoP(p), 0)
    const cat = Object.fromEntries(CATEGORIAS.map(c => [c, 0])) as Record<string, number>
    for (const p of filtrados) { const r = custos.get(p.id); if (r) for (const k in r.porCategoria) cat[k] += (r.porCategoria as any)[k] }
    // Rescisão é EVENTO, não custo corrente: entra no custo anual (é desembolso
    // do ano) mas sai do custo médio/FTE, que responde "quanto custa manter uma
    // pessoa por mês" — somá-la ali inflaria o unitário de todo o quadro.
    const resc = filtrados.reduce((s, p) => s + (custos.get(p.id)?.rescisaoAno || 0), 0)
    const saindo = filtrados.filter(p => (custos.get(p.id)?.rescisaoAno || 0) > 0).length
    return { head, vagas, pessoas, fte, ano, cat, resc, saindo, medioFte: fte ? ((ano - resc) / 12) / fte : 0 }
  }, [filtrados, custos]) // eslint-disable-line

  // janela de vigência DENTRO do ano da versão (bate com o motor)
  const vig = (p: Posto) => {
    const iniM = (p.ini_ano == null || p.ini_ano < anoCalc) ? 1 : (p.ini_ano === anoCalc ? (p.ini_mes || 1) : 13)
    const fimM = (p.fim_ano == null || p.fim_ano > anoCalc) ? 12 : (p.fim_ano === anoCalc ? (p.fim_mes || 12) : 0)
    if (iniM > 12 || fimM < 1 || iniM > fimM) return { txt: 'fora do ano', alerta: true }
    return { txt: `${MESES[iniM - 1]}–${MESES[fimM - 1]}`, alerta: iniM > 1 || fimM < 12 }
  }

  // janela de afastamento recortada no ano da versão (bate com afastadoNoMes do motor)
  const afast = (p: Posto) => {
    if (!p.afast_ini_ano) return null
    const ini = p.afast_ini_ano > anoCalc ? 13 : (p.afast_ini_ano === anoCalc ? (p.afast_ini_mes || 1) : 1)
    const fim = p.afast_fim_ano == null ? 12
      : (p.afast_fim_ano < anoCalc ? 0 : (p.afast_fim_ano === anoCalc ? (p.afast_fim_mes || 12) : 12))
    if (ini > 12 || fim < 1 || ini > fim) return null   // afastamento fora do ano orçado
    return { ini, fim, txt: `${MESES[ini - 1]}–${MESES[fim - 1]}`, aberto: p.afast_fim_ano == null }
  }

  const linhaPosto = (p: Posto) => {
    const custoMes = custoMesP(p), custoAno = custoAnoP(p)
    // CUSTO/MÊS é o mês REPRESENTATIVO (o último vigente), não a média: ele
    // responde "quanto essa pessoa custa daqui em diante". Quando há reajuste no
    // meio do ano, custoMes × 12 ≠ custoAno — e sem avisar isso parece erro de
    // conta. O motor já guarda a base do último mês; aqui só marcamos a linha.
    const rc = custos.get(p.id)
    const mesesVig = rc?.mesesVigentes ?? 12
    const mesesAfast = rc?.mesesAfastado ?? 0
    const rescAno = rc?.rescisaoAno || 0
    // Afastamento parcial e rescisão fazem o custo mudar no meio do ano igual ao
    // reajuste, e pelo mesmo motivo merecem o asterisco. Afastada o ano todo não
    // entra: aí custoMes × meses volta a bater com o anual.
    const mudaNoAno = !!custoMes && (!!p.reajuste_mes || mesesAfast > 0 || rescAno > 0)
      && Math.abs(custoMes * mesesVig - custoAno) > 0.01
    const fa = afast(p)
    const v = vig(p)
    // No modo cenário `p` já é o posto RESOLVIDO; o mestre serve para dizer, no
    // title, de onde a célula saiu. Decisão em violeta, herdado normal — mesma
    // convenção da premissa global do formulário.
    const alt = alterados.get(p.id)
    const mestre = mestreById.get(p.id)
    const mud = (c: CampoCenario) => !!alt?.includes(c)
    const cel = (c: CampoCenario): CSSProperties | undefined =>
      mud(c) ? { color: 'var(--violet)', fontWeight: 700 } : undefined
    const titCen = (c: CampoCenario, fmt: (x: any) => string = String) =>
      mud(c) ? `Decisão deste cenário. No cadastro: ${(mestre as any)?.[c] == null ? '—' : fmt((mestre as any)[c])}` : undefined
    return (
      <tr key={p.id} style={p.ativo === false ? { opacity: 0.55 } : undefined}>
        <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--muted)' }}>{p.codigo}
          {p.ativo === false && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
            color: mud('ativo') ? 'var(--violet)' : 'var(--red)',
            border: '1px solid ' + (mud('ativo') ? 'var(--violet)55' : 'var(--red)55'),
            background: mud('ativo') ? 'rgba(139,92,246,0.14)' : 'rgba(248,113,113,0.12)' }}
            title={mud('ativo') ? 'Cortado por decisão deste cenário — no cadastro continua ativo' : undefined}>
            {mud('ativo') ? 'CORTADO' : 'DEMITIDO'}</span>}</td>
        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}
          title={`${p.empresa?.codigo || '?'} · ${p.filial?.codigo || '?'} · ${p.centro_custo?.codigo || '?'} ${p.centro_custo?.descricao || ''}`}>
          {p.empresa?.codigo || '—'}·{p.filial?.codigo || '—'}·{p.centro_custo?.codigo || '—'}</td>
        <td style={S.td}>{p.cargo?.nome || '—'}</td>
        <td style={S.td}>{p.nome
          ? <span style={T.ocup}>{nomeCurto(p.nome)}</span>
          : <span style={T.vaga}>VAGA{p.ini_mes ? ` · ${MESES[p.ini_mes - 1]}/${String(p.ini_ano || '').slice(2)}` : ''}</span>}
          {fa && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5, color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.14)' }}
            title={`Afastado ${fa.txt}${fa.aberto ? ' (sem previsão de retorno)' : ''}${p.afast_motivo ? ` — ${p.afast_motivo}` : ''}. Nesses meses o orçamento não leva salário, INSS, FGTS nem provisões; só os benefícios marcados como devidos no afastamento.`}>
            AFASTADO {fa.txt}</span>}</td>
        <td style={S.td}>{p.regime ? <span style={tagRegime(p.regime)}>{REGIMES_LABEL[p.regime] || p.regime}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
        <td style={S.td}>{p.sindicato?.codigo ? <span style={T.sind}>{p.sindicato.codigo}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
        {/* Recebe por hora: só aparece onde há apontamento, e só é EXCEÇÃO.
            O normal é a função decidir (Apontamento → Funções); esta coluna
            existe para quem foge do padrão da própria função. Herdado em
            itálico, exceção em destaque — mesma convenção das premissas
            globais do formulário. */}
        {flags.usa_apontamento && <td style={S.td}>{!p.recurso_cod
          ? <span style={{ color: 'var(--faint)' }} title="Este posto não aponta horas (sem código de recurso)">—</span>
          : (editavel && editHora === p.id)
            ? <select autoFocus style={{ ...S.inp, width: 116 }}
                value={p.recebe_hora == null ? '' : (p.recebe_hora ? 'sim' : 'nao')}
                title="Vazio = segue a função do apontamento. Use só para quem foge do padrão da função."
                onBlur={() => setEditHora(null)}
                onChange={e => { salvar(p.id, { recebe_hora: e.target.value === '' ? null : e.target.value === 'sim' }); setEditHora(null) }}>
                <option value="">segue a função</option>
                <option value="sim">recebe por hora</option>
                <option value="nao">só aponta</option>
              </select>
            : p.recebe_hora == null
              // O padrão é "segue a função", e ele é a maioria esmagadora das
              // linhas: um combo em cada uma domina a coluna com a informação
              // menos relevante da tela. Em repouso vira um traço discreto, como
              // quem não aponta; o seletor abre no clique.
              ? <span onClick={() => editavel && setEditHora(p.id)}
                  title="Segue a função do apontamento. Clique para definir uma exceção para esta pessoa."
                  style={{ color: 'var(--faint)', cursor: editavel ? 'pointer' : 'default' }}>·</span>
              : <span onClick={() => editavel && setEditHora(p.id)}
                  title={`Exceção: ${p.recebe_hora ? 'recebe por hora' : 'só aponta'} (clique para mudar)`}
                  style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, cursor: editavel ? 'pointer' : 'default',
                    color: p.recebe_hora ? 'var(--green)' : 'var(--orange)',
                    background: p.recebe_hora ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                    border: '1px solid ' + (p.recebe_hora ? 'rgba(52,211,153,0.30)' : 'rgba(251,191,36,0.30)') }}>
                  {p.recebe_hora ? 'por hora' : 'só aponta'}</span>}
        </td>}
        <td style={{ ...S.td, textAlign: 'right', ...cel('salario_base') }} title={titCen('salario_base', x => money(Number(x)))}>
          {editavel
            ? <input style={{ ...S.inp, ...cel('salario_base') }} defaultValue={inp2(p.salario_base)}
                onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== p.salario_base) grava(p.id, { salario_base: x }) }} />
            : money(Number(p.salario_base) || 0)}{!p.nome && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>(ref.)</span>}
        </td>
        <td style={{ ...S.td, textAlign: 'right', ...cel('fte') }} title={titCen('fte')}>
          {editavel
            ? <input style={{ ...S.inp, width: 50, ...cel('fte') }} defaultValue={inpNum(p.fte ?? 1)}
                onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== p.fte) grava(p.id, { fte: x }) }} />
            : (Number(p.fte) || 1).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}
        </td>
        {/* A saída já aparecia aqui ("jan–mai"); o que faltava era dizer quanto
            ela custa. O ✂ marca a demissão e o título abre a estimativa. */}
        <td style={{ ...S.td, fontWeight: (mud('fim_ano') || mud('fim_mes') || mud('ini_ano') || mud('ini_mes')) ? 700 : undefined,
          color: (mud('fim_ano') || mud('fim_mes') || mud('ini_ano') || mud('ini_mes')) ? 'var(--violet)' : (v.alerta ? 'var(--orange)' : 'var(--muted)') }}
          title={rescAno ? `Sai em ${MESES_NUM[(rc?.mesFimVigencia || 1) - 1]}/${anoCalc} · rescisão estimada ${money(rescAno)} (${(rescAno / Math.max(1, Number(p.salario_base) || 1)).toFixed(1)} salários). Clique no custo/mês para a memória.` : undefined}>
          {v.txt}{rescAno > 0 && <span style={{ color: 'var(--red)', marginLeft: 4, fontWeight: 700 }}>✂</span>}</td>
        <td style={S.td}>{(() => {
          const rr = postoRateios[p.id] || []
          if (!rr.length) return <span style={{ color: 'var(--muted)' }}>—</span>
          const nomes = rr.map(x => rateioCods.find(c => c.id === x.regra_id)?.nome || '?').join(' → ')
          return <button title={`${nomes} — clique para ver a memória`} onClick={() => setRateModal(p)} style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.14)' }}>{rr.length} cód.</button>
        })()}</td>
        <td style={{ ...S.td, textAlign: 'right', cursor: 'pointer' }} onClick={() => setDrill(p)}
          title={mudaNoAno
            ? `Custo recorrente do último mês vigente (${[p.reajuste_mes ? `reajuste em ${MESES_NUM[p.reajuste_mes - 1]}` : '', mesesAfast ? `${mesesAfast} ${mesesAfast > 1 ? 'meses' : 'mês'} de afastamento` : '', rescAno ? `rescisão de ${money(rescAno)} em ${MESES_NUM[(rc?.mesFimVigencia || 1) - 1]}, fora desta coluna` : ''].filter(Boolean).join('; ')}). O anual de ${money(custoAno)} soma mês a mês. Clique para a memória.`
            : 'Ver memória de cálculo'}>
          {money(custoMes)}
          {mudaNoAno && <span style={{ color: 'var(--orange)', marginLeft: 3 }}>*</span>}
        </td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, cursor: 'pointer' }} title="Ver memória de cálculo" onClick={() => setDrill(p)}>{money(custoAno)}</td>
        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{editavel && (modoCenario ? <>
          <button style={{ ...S.del, color: alt ? 'var(--violet)' : undefined }} title="Decisões deste cenário para este posto"
            onClick={() => setCenForm({ posto: mestre as Posto, ov: overlays.get(p.id) || null })}><Pencil size={14} /></button>
          {alt && <button style={S.del} title="Voltar a herdar do cadastro (desfaz as decisões deste cenário)"
            onClick={() => { if (confirm(`Desfazer as decisões do cenário para ${p.nome || p.codigo}?`)) limparCenario(p.id) }}><Undo2 size={15} /></button>}
        </> : <>
          <button style={S.del} title="Editar posto" onClick={() => editarPosto(p)}><Pencil size={14} /></button>
          <button style={S.del} title="Excluir" onClick={() => excluir(p.id, p.codigo)}><Trash2 size={15} /></button>
        </>)}</td>
      </tr>
    )
  }

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Posto de Trabalho</h1>
          <p style={S.sub}>Quadro de pessoal orçado por posto — funcionários nominais + vagas planejadas. O custo com encargos/provisões e o rateio são calculados no <b>Aplicar</b> (motor).</p>
        </div>
        <PostosPills />
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Versão</span>
          <select style={S.sel} value={versaoSel} onChange={e => setVersaoSel(e.target.value)} title="Versão do orçamento — define o dissídio aplicado ao custo">
            {!versoes.length && <option value="">—</option>}
            {versoes.map((v: any) => <option key={v.id} value={v.id}>{v.codigo}{v.bloqueada ? ' 🔒' : ''}</option>)}
          </select>
        </div>
        {/* Cadastro × Cenário. Explícito de propósito: no modo Cadastro você
            corrige a REALIDADE (vale em todas as versões); no Cenário você
            decide hipóteses (valem só nesta). Misturar os dois faria uma
            correção de salário virar decisão de cenário sem ninguém notar. */}
        <div style={S.fld}><span style={S.lbl}>Editando</span>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
            {([[false, 'Cadastro', 'O quadro real, válido em todas as versões'],
               [true, 'Cenário', 'Decisões desta versão (demitir, adiar, promover) — o cadastro não muda']] as const).map(([v, lbl, tit]) => (
              <button key={String(v)} title={tit} onClick={() => { setModoCenario(v); if (!v) setSoAlteradas(false) }}
                style={{ padding: '7px 11px', fontSize: 12.5, fontWeight: modoCenario === v ? 700 : 500, cursor: 'pointer', border: 'none',
                  background: modoCenario === v ? (v ? 'rgba(139,92,246,0.18)' : 'var(--panel-2)') : 'transparent',
                  color: modoCenario === v ? (v ? 'var(--violet)' : 'var(--text)') : 'var(--muted)' }}>{lbl}</button>
            ))}
          </div>
        </div>
        {modoCenario && <div style={S.fld}><span style={S.lbl}>Decisões</span>
          <button onClick={() => setSoAlteradas(x => !x)}
            title="Mostra só os postos que ESTE cenário muda — é o diff que se apresenta junto com o EBITDA"
            style={{ ...S.sel, cursor: 'pointer', fontWeight: soAlteradas ? 700 : 500, width: 'auto',
              color: soAlteradas ? 'var(--violet)' : 'var(--text)',
              borderColor: soAlteradas ? 'var(--violet)' : 'var(--border)' }}>
            {soAlteradas ? '✓ ' : ''}só as alteradas ({alterados.size})
          </button>
        </div>}
        <div style={S.fld}><span style={S.lbl}>Buscar</span>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
            <input style={{ ...S.sel, paddingLeft: 28, width: 210 }} placeholder="nome, matrícula, cargo…" value={busca} onChange={e => setBusca(e.target.value)} />
            {busca && <X size={14} style={{ position: 'absolute', right: 8, top: 9, color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setBusca('')} />}
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Filtros</span>
          <FiltrosButton
            empresas={acesso.filterList('empresa', empresas)} filiais={acesso.filterList('filial', filiais)} ccs={acesso.filterList('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        </div>
        <div style={S.fld}><span style={S.lbl}>Agrupar por</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select style={S.sel} value={agruparPor} onChange={e => setAgruparPor(e.target.value as 'cc' | 'cargo')}>
              <option value="cc">Centro de custo</option>
              <option value="cargo">Cargo</option>
            </select>
            <button style={{ ...S.sel, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-mid)' }} onClick={toggleTodos}
              title={algumAberto ? 'Recolher todos os grupos' : 'Expandir todos os grupos'}>
              {algumAberto ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{algumAberto ? 'Recolher' : 'Expandir'}
            </button>
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Modelo</span>
          <select style={S.sel} value={regimeSel} onChange={e => setRegimeSel(e.target.value)}>
            <option value="">Todos</option>
            <option value="CLT">CLT</option><option value="PRESTADOR">Prestador</option><option value="PROLABORE">Pró-labore</option>
          </select>
        </div>
        {nInativos > 0 && <div style={S.fld}><span style={S.lbl}>Demitidos</span>
          <button style={{ ...S.sel, cursor: 'pointer', color: mostrarInativos ? 'var(--orange)' : 'var(--muted)', borderColor: mostrarInativos ? 'var(--orange)' : 'var(--border-strong)' }}
            title="Demitidos (posto inativo) ficam fora do headcount, FTE e custo. Ative para revê-los." onClick={() => setMostrarInativos(v => !v)}>
            {mostrarInativos ? `Mostrando ${nInativos}` : `Ocultos (${nInativos})`}</button>
        </div>}
        <div style={{ flex: 1 }} />
        {editavel && <button style={{ ...S.btn, opacity: modoCenario ? 0.45 : 1, cursor: modoCenario ? 'not-allowed' : 'pointer' }}
          title={modoCenario ? 'Posto novo entra no CADASTRO, não no cenário — vaga que existe só numa versão ainda não é suportada (P3). Troque para Cadastro.' : undefined}
          onClick={() => { if (modoCenario) { setErro('Posto novo entra no cadastro, não no cenário. Troque para "Cadastro" — vaga que existe só numa versão ainda não é suportada.'); return } novoPosto() }}><Plus size={14} /> Posto / vaga</button>}
        {editavel && <button style={S.btnPri} disabled={aplicando || !versaoSel || !temMotor} onClick={aplicarNoOrcado}
          title="Grava o custo do quadro ativo desta versão no orçado (origem POSTO), aplicando o rateio.">
          <Play size={13} /> {aplicando ? 'Aplicando…' : 'Aplicar no orçado'}</button>}
      </div>

      {editavel && (
        <div style={{ ...S.bar, margin: '0 0 16px' }}>
          <div style={S.fld}><span style={S.lbl}>Importar do RH</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as any)} title="Adicionar/atualizar: upsert (não apaga). Substituir escopo: apaga os postos das empresas do arquivo e recarrega.">
                <option value="upsert">Adicionar/atualizar</option>
                <option value="substituir">Substituir escopo</option>
              </select>
              <button style={S.btn} disabled={importando} onClick={() => fileRef.current?.click()}><Upload size={14} /> {importando ? 'Importando…' : 'Importar postos (RH)'}</button>
            </div>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {/* No modo cenário a tela inteira passa a falar de hipótese, e isso precisa
          ficar óbvio: a edição aqui NÃO muda o cadastro. */}
      {modoCenario && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 12px', padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.10)', fontSize: 12.5, color: 'var(--text-mid)' }}>
          <b style={{ color: 'var(--violet)' }}>Cenário {versoes.find((v: any) => v.id === versaoSel)?.codigo || '—'}</b>
          <span>o que você editar vale <b>só nesta versão</b> — o cadastro não muda. {alterados.size
            ? <>Este cenário decide <b>{alterados.size} posto(s)</b>.</>
            : <>Nenhuma decisão ainda: tudo herdado do cadastro.</>}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--muted)' }}>O EBITDA do cenário sai no relatório, comparando as versões. Aqui é só a folha.</span>
        </div>
      )}

      {aplicarInfo && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div>Orçado aplicado na versão (ano {aplicarInfo.ano}): <b>{aplicarInfo.linhas.toLocaleString('pt-BR')} linhas</b> gravadas em <b>{aplicarInfo.postos} postos</b> e {aplicarInfo.contas} conta(s), origem POSTO.
            <div style={{ color: 'var(--muted)' }}>Substituiu o orçado POSTO anterior desta versão. Veja em Orçar / DRE (some com o manual/formulário na mesma célula).</div>
            {aplicarInfo.fundidas > 0 && <div style={{ color: 'var(--orange)' }}>⚠ {aplicarInfo.fundidas} lançamento(s) caíram na mesma célula e foram somados — pode indicar posto duplicado nos dados. Confira se há códigos de posto repetidos.</div>}
            {aplicarInfo.natEstranha.length > 0 && <div style={{ color: 'var(--orange)' }}>⚠ {aplicarInfo.natEstranha.length} conta(s) de destino não são de natureza DESPESA, então foram gravadas com sinal <b>positivo</b>: {aplicarInfo.natEstranha.join(', ')}. Confira a natureza em Cadastros → Estrutura — custo de folha deveria ser despesa.</div>}
            {aplicarInfo.semConta.length > 0 && <div style={{ color: 'var(--red)', fontWeight: 600 }}>⚠ {aplicarInfo.semConta.length} verba(s) com valor e <b>sem conta destino</b> — ficaram FORA do orçado (aparecem na grade, não na DRE): {aplicarInfo.semConta.join(', ')}. Amarre a conta em {passoLabel('/postos/regras')} e reaplique.</div>}
            {aplicarInfo.semTaxa > 0 && <div style={{ color: 'var(--red)', fontWeight: 600 }}>⚠ {aplicarInfo.semTaxa} linha(s) DESCARTADA(S) por falta de taxa orçada da moeda de origem (empresa em moeda estrangeira). Cadastre a taxa em Cadastros → Taxa orçada para esta versão e reaplique.</div>}
          </div>
        </div>
      )}
      {importInfo && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div><b>{importInfo.gravados} postos</b> importados{importInfo.cargosNovos ? ` · ${importInfo.cargosNovos} cargos criados` : ''}{importInfo.modo === 'substituir' ? ` · ${importInfo.apagados} apagados (substituir escopo)` : ''}.
            <div style={{ color: importInfo.benefColunas ? 'var(--text-mid)' : 'var(--orange)' }}>{importInfo.benefColunas
              ? `${importInfo.beneficios} valores de benefício por posto (posto_verba) atualizados, em ${importInfo.benefColunas} verba(s) da folha.`
              : '⚠ Nenhuma coluna do arquivo casou com verba do catálogo — benefícios NÃO atualizados. Cadastre as verbas (D49, A76, D50, A15, A51…) em Estrutura → Verbas e reimporte.'}</div>
            {importInfo.rateioCol && <div style={{ color: 'var(--text-mid)' }}>{importInfo.rateioPostos} posto(s) com rateio anexado (posto_rateio) pela coluna RATEIO.</div>}
            {importInfo.afastados > 0 && <div style={{ color: 'var(--violet)' }}>{importInfo.afastados} posto(s) marcados como <b>afastados</b> pela coluna <code>afastado_desde</code>, <b>sem previsão de retorno</b> — assim o motor zera salário, encargos e provisões os 12 meses. Procure o chip AFASTADO na grade e informe o retorno de quem voltar.</div>}
            {importInfo.rateioNaoAchados.length > 0 && <div style={{ color: 'var(--orange)' }}>Códigos de rateio não encontrados (ignorados): {importInfo.rateioNaoAchados.join(', ')} — confira os nomes em {passoLabel('/postos/rateio')}.</div>}
            {importInfo.foraEscopo > 0 && <div style={{ color: 'var(--orange)' }}>{importInfo.foraEscopo} posto(s) fora do seu escopo de edição (empresa/filial/CC) — ignorados.</div>}
            {importInfo.semEmp.length > 0 && <div style={{ color: 'var(--red)' }}>⚠ Empresas não encontradas (postos ignorados): {importInfo.semEmp.join(', ')}</div>}
            {importInfo.semFil.length > 0 && <div style={{ color: 'var(--orange)' }}>Filiais não encontradas (posto sem filial): {importInfo.semFil.join(', ')}</div>}
            {importInfo.semCc.length > 0 && <div style={{ color: 'var(--orange)' }}>CCs não encontrados (posto sem CC): {importInfo.semCc.slice(0, 20).join(', ')}{importInfo.semCc.length > 20 ? '…' : ''}</div>}
          </div>
        </div>
      )}

      {(() => {
        const t = CATEGORIAS.reduce((s, c) => s + tot.cat[c], 0)
        const pct = (v: number) => t ? Math.round(v / t * 100) : 0
        const comp = temMotor && t
          ? `salários ${pct(tot.cat['Salário'])}% · encargos ${pct(tot.cat.Encargos + tot.cat['Provisões'])}% · benef ${pct(tot.cat['Benefícios'])}%${tot.cat['Rescisão'] ? ` · rescisão ${pct(tot.cat['Rescisão'])}%` : ''}`
          : 'sem motor — cadastre verbas em Estrutura'
        return (
          <div style={S.kpis}>
            <div style={S.kpi}><div style={S.kpiL}>Postos</div><div style={S.kpiV}>{tot.head}</div><div style={S.kpiH}>{tot.vagas} vaga{tot.vagas === 1 ? '' : 's'} planejada{tot.vagas === 1 ? '' : 's'}</div></div>
            <div style={S.kpi}><div style={S.kpiL}>Headcount</div><div style={S.kpiV}>{tot.pessoas}</div>
              <div style={S.kpiH}>{tot.head > tot.pessoas ? `${tot.head - tot.pessoas} posto(s) a mais que pessoas` : 'uma pessoa por posto'}</div></div>
            <div style={S.kpi}><div style={S.kpiL}>FTE total</div><div style={S.kpiV}>{tot.fte.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div><div style={S.kpiH}>inclui ½ períodos</div></div>
            <div style={S.kpi}><div style={S.kpiL}>Custo anual {temMotor ? '(c/ encargos)' : '(base)'}</div><div style={S.kpiV}>{milAno(tot.ano)}</div>
              {/* Só com filtro limpo o delta é comparável: `tot.ano` respeita os
                  filtros da tela e o base é o quadro inteiro. */}
              {modoCenario && custoBaseAno != null && filtrados.length === postosEf.filter(x => mostrarInativos || x.ativo !== false).length
                ? <div style={{ ...S.kpiH, color: tot.ano < custoBaseAno ? 'var(--green)' : tot.ano > custoBaseAno ? 'var(--red)' : 'var(--muted)' }}>
                    {tot.ano === custoBaseAno ? 'igual ao cadastro' : `${tot.ano < custoBaseAno ? '−' : '+'}${milAno(Math.abs(tot.ano - custoBaseAno))} vs cadastro`}
                  </div>
                : <div style={S.kpiH}>{comp}</div>}
            </div>
            {/* só aparece quando há demissão no ano: o card vazio vira ruído */}
            {tot.resc > 0 && <div style={S.kpi}><div style={S.kpiL}>Rescisões</div><div style={{ ...S.kpiV, color: 'var(--red)' }}>{milAno(tot.resc)}</div>
              <div style={S.kpiH}>{tot.saindo} saída{tot.saindo === 1 ? '' : 's'} no ano · fora do custo médio</div></div>}
            <div style={S.kpi}><div style={S.kpiL}>Custo médio / FTE</div><div style={S.kpiV}>R$ {money(tot.medioFte)}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>/mês</span></div><div style={S.kpiH}>{temMotor ? 'com encargos' : 'base'}</div></div>
          </div>
        )
      })()}

      <div style={S.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Posto</th><th style={S.th}>Empr·Fil·CC</th><th style={S.th}>Cargo</th><th style={S.th}>Ocupante</th><th style={S.th}>Modelo</th><th style={S.th}>Sind.</th>
              {flags.usa_apontamento && <th style={S.th} title="Exceção sobre a função do apontamento. O normal é decidir pela função, em Apontamento → Funções.">Recebe por hora</th>}
              <th style={{ ...S.th, textAlign: 'right' }}>Salário</th><th style={{ ...S.th, textAlign: 'right' }}>FTE</th>
              <th style={S.th}>Vigência</th><th style={S.th}>Rateio</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Custo/mês¹</th><th style={{ ...S.th, textAlign: 'right' }}>Custo ano</th><th style={S.th} />
            </tr></thead>
            <tbody>
              {grupos.map(g => {
                const k1 = 'a:' + g.key, aberto = !!busca.trim() || !fechados.has(k1)
                return (
                  <Fragment key={g.key}>
                    <tr onClick={() => toggle(k1)}>
                      <td colSpan={nCols} style={S.gh}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1 }}>
                            {aberto ? <ChevronDown size={14} style={{ verticalAlign: -2 }} /> : <ChevronRight size={14} style={{ verticalAlign: -2 }} />}{' '}
                            {g.cod && <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{g.cod} · </span>}{g.desc}
                            <span style={{ color: 'var(--muted)', fontWeight: 400 }}> — {g.postos.length} posto{g.postos.length === 1 ? '' : 's'} · {milAno(g.custoAno)}/ano</span>
                          </span>
                          {editavel && g.key !== '__sem' && <button title={`Novo posto ${agruparPor === 'cc' ? 'neste centro de custo' : 'neste cargo'}`}
                            onClick={ev => { ev.stopPropagation(); novoPosto(agruparPor === 'cc' ? { cc_id: g.key } : { cargo_id: g.key }) }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11.5, fontWeight: 600, borderRadius: 6, cursor: 'pointer', color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.12)' }}>
                            <Plus size={12} /> Posto</button>}
                        </div>
                      </td>
                    </tr>
                    {aberto && g.postos.map(linhaPosto)}
                  </Fragment>
                )
              })}
              {!filtrados.length && <tr><td colSpan={nCols} style={S.empty}>
                {postos.length ? 'Nenhum posto para o filtro.' : 'Nenhum posto ainda. Use "Importar postos (RH)" para carregar do cadastro convertido.'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>¹ {temMotor ? 'Custo com encargos/provisões/benefícios pelo motor (clique no valor p/ ver a memória). Rateio entra no step 4.' : 'Custo base (salário × FTE) — cadastre as verbas em Estrutura para o custo com encargos.'}
        <br /><span style={{ color: 'var(--orange)' }}>*</span> o custo mudou durante o ano (reajuste ou afastamento): a coluna mostra o <b>último mês</b>, não a média — por isso ela × 12 não dá o custo ano, que já soma mês a mês.</p>

      {drill && (() => {
        const r = custos.get(drill.id)
        const dis = drill.sindicato_id ? (dissidio[drill.sindicato_id] || 0) : 0
        const fAfast = afast(drill)
        return (
          <div style={S.overlay} onClick={() => setDrill(null)}>
            <div style={S.modal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{drill.nome || 'Vaga'} <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{drill.codigo}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{drill.cargo?.nome || '—'} · {drill.regime || '—'} · {drill.sindicato?.codigo || 'sem sindicato'}{dis ? ` · dissídio ${dis}%` : ''} · base R$ {money((Number(drill.salario_base) || 0) * (Number(drill.fte) || 1))}/mês</div>
                  {/* Sem esta linha, a coluna "Mês" zerada no salário parece erro
                      de cadastro — o mês representativo é um mês de afastamento. */}
                  {!!r?.rescisaoAno && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
                    Sai em {MESES_NUM[(r.mesFimVigencia || 1) - 1]}/{anoCalc} · rescisão estimada <b>R$ {money(r.rescisaoAno)}</b>.
                    Ela está no total do <b>ano</b>, não no mês — a coluna "Mês" é o custo recorrente.
                  </div>}
                  {fAfast && <div style={{ fontSize: 12, color: 'var(--violet)', marginTop: 4 }}>
                    Afastado {fAfast.txt}{fAfast.aberto ? ' (sem previsão de retorno)' : ''}{drill.afast_motivo ? ` — ${drill.afast_motivo}` : ''}.
                    Nesses {r?.mesesAfastado || 0} {(r?.mesesAfastado || 0) > 1 ? 'meses' : 'mês'} o orçamento leva só os benefícios devidos no afastamento.
                  </div>}
                </div>
                <button onClick={() => setDrill(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
              </div>
              {!r || !r.linhas.length ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Sem verbas aplicáveis (cadastre em Estrutura ou confira o regime).</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={S.mth}>Verba</th><th style={S.mth}>Categoria</th><th style={{ ...S.mth, textAlign: 'right' }}>Mês</th><th style={{ ...S.mth, textAlign: 'right' }}>Ano</th></tr></thead>
                  <tbody>
                    {r.linhas.map(l => (
                      <tr key={l.verba.id}>
                        <td style={S.mtd}><span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{l.verba.codigo}</span> {l.verba.descricao}</td>
                        <td style={{ ...S.mtd, color: catCor[l.categoria] || 'var(--muted)' }}>{l.categoria}</td>
                        <td style={{ ...S.mtd, textAlign: 'right' }}>{money(l.valorMes)}</td>
                        <td style={{ ...S.mtd, textAlign: 'right' }}>{money(l.valorAno)}</td>
                      </tr>
                    ))}
                    <tr><td style={{ ...S.mtd, fontWeight: 700 }} colSpan={2}>Total</td><td style={{ ...S.mtd, textAlign: 'right', fontWeight: 700 }}>{money(r.totalMes)}</td><td style={{ ...S.mtd, textAlign: 'right', fontWeight: 700 }}>{money(r.totalAno)}</td></tr>
                  </tbody>
                </table>
              )}
              {r && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                {CATEGORIAS.map(c => r.porCategoria[c] ? (
                  <span key={c} style={{ ...tag('var(--bg)', catCor[c], 'var(--border)'), fontSize: 11.5 }}>{c}: R$ {money(r.porCategoria[c])}/ano</span>
                ) : null)}
              </div>}

              {editavel && (() => {
                const benefVerbas = verbas.filter(v => v.tipo_calculo === 'VALOR_FIXO' && paisAplica(v.pais, empPais.get(drill.empresa_id) ?? null) && regimeAplica(v.regime, drill.regime))
                if (!benefVerbas.length) return null
                return (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Benefícios deste posto <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— valor mensal por pessoa (vazio = não tem)</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '4px 12px', alignItems: 'center' }}>
                      {benefVerbas.map(v => (
                        <Fragment key={v.id}>
                          <span style={{ fontSize: 12.5 }}><span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{v.codigo}</span> {v.descricao}</span>
                          <input style={{ ...S.inp, width: '100%' }} placeholder="0,00"
                            defaultValue={postoVerbas[drill.id]?.[v.id] ? inp2(postoVerbas[drill.id][v.id]) : ''}
                            onBlur={e => { const x = parseNum(e.target.value); salvarBenef(drill.id, v.id, isNaN(x) ? 0 : x) }} />
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {/* ── Decisões do cenário ──────────────────────────────────────────
          Modal PRÓPRIO, não o do cadastro: aqui só entram campos de DECISÃO, e
          cada um mostra o que herda. O do cadastro gera código, sincroniza
          rateio e grava fatos — nada disso faz sentido num cenário. */}
      {cenForm && (() => {
        const m: any = cenForm.posto, ov: any = cenForm.ov || {}
        const limpos = new Set<string>(ov.limpos || [])
        const efet: any = resolvePosto(m, cenForm.ov)
        const decidido = (c: string) => limpos.has(c) || (ov[c] != null && ov[c] !== '')
        const set = (patch: any, limpar: CampoCenario[] = []) => {
          salvarCenario(m.id, patch, limpar)
          setCenForm(f => f && ({ ...f, ov: { ...(f.ov || { versao_id: versaoSel, posto_id: m.id }), ...patch,
            limpos: [...new Set([...(f.ov?.limpos || []), ...limpar])].filter(x => !(x in patch) || patch[x] == null) } as PostoVersao }))
        }
        // "voltar a herdar" de um par (ano+mês): se o mestre tem valor, LIMPAR é
        // uma decisão (ficar); se não tem, é só apagar o que o cenário pôs.
        const herda = (campos: CampoCenario[]) => {
          const mestreTem = campos.some(c => m[c] != null)
          set(Object.fromEntries(campos.map(c => [c, null])), mestreTem ? campos : [])
        }
        const lbl = (c: string) => decidido(c)
          ? { color: 'var(--violet)', fontWeight: 700 }
          : { color: 'var(--muted)', fontStyle: 'italic' as const }
        const parMes = (campoMes: CampoCenario, campoAno: CampoCenario, titulo: string) => (
          <div><span style={{ ...S.flbl, ...lbl(campoAno) }}>{titulo}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select style={{ ...S.finp, width: 92 }} value={efet[campoMes] ?? ''}
                onChange={e => set({ [campoMes]: e.target.value ? parseInt(e.target.value, 10) : null,
                                     [campoAno]: e.target.value ? (efet[campoAno] ?? anoCalc) : null })}>
                <option value="">—</option>
                {MESES_NUM.map((x, i) => <option key={i} value={i + 1}>{x}</option>)}
              </select>
              <input style={{ ...S.finp, width: 70 }} placeholder="ano" value={efet[campoAno] ?? ''}
                onChange={e => set({ [campoAno]: e.target.value ? parseInt(e.target.value, 10) : null })} />
              {decidido(campoAno) || decidido(campoMes)
                ? <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar do cadastro" onClick={() => herda([campoAno, campoMes])}><Undo2 size={14} /></button>
                : null}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>cadastro: {m[campoMes] ? `${MESES[m[campoMes] - 1]}/${m[campoAno] ?? '?'}` : '—'}</div>
          </div>
        )
        const alt = camposAlterados(m, cenForm.ov)
        return (
          <div style={S.overlay} onClick={() => setCenForm(null)}>
            <div style={S.modal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{m.nome || 'Vaga'} <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{m.codigo}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--violet)', marginTop: 3 }}>
                    Decisões do cenário <b>{versoes.find((v: any) => v.id === versaoSel)?.codigo || '—'}</b> · {alt.length ? `${alt.length} campo(s) decidido(s)` : 'herda tudo do cadastro'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>O cadastro não muda. Em itálico, o que é herdado; em violeta, o que este cenário decide.</div>
                </div>
                <button onClick={() => setCenForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
                <div><span style={{ ...S.flbl, ...lbl('salario_base') }}>Salário base</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={{ ...S.finp, flex: 1 }} defaultValue={inp2(efet.salario_base)} key={`s${ov.salario_base}`}
                      onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== efet.salario_base) set({ salario_base: x }) }} />
                    {decidido('salario_base') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['salario_base'])}><Undo2 size={14} /></button>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>cadastro: {money(Number(m.salario_base) || 0)}</div>
                </div>
                <div><span style={{ ...S.flbl, ...lbl('fte') }}>FTE</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={{ ...S.finp, flex: 1 }} defaultValue={inpNum(efet.fte ?? 1)} key={`f${ov.fte}`}
                      onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== efet.fte) set({ fte: x }) }} />
                    {decidido('fte') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['fte'])}><Undo2 size={14} /></button>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>cadastro: {m.fte ?? 1}</div>
                </div>
                {parMes('ini_mes', 'ini_ano', 'Entrada (adiar/antecipar)')}
                {parMes('fim_mes', 'fim_ano', 'Saída (demissão simulada)')}
                {parMes('afast_ini_mes', 'afast_ini_ano', 'Afastado desde')}
                {parMes('afast_fim_mes', 'afast_fim_ano', 'Retorno previsto')}
                <div><span style={{ ...S.flbl, ...lbl('reajuste_mes') }}>Reajuste — a partir de</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, flex: 1 }} value={efet.reajuste_mes ?? ''}
                      onChange={e => set({ reajuste_mes: e.target.value ? parseInt(e.target.value, 10) : null })}>
                      <option value="">sem reajuste</option>
                      {MESES_NUM.map((x, i) => <option key={i} value={i + 1}>{x}</option>)}
                    </select>
                    {decidido('reajuste_mes') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['reajuste_mes', 'reajuste_pct', 'reajuste_valor'])}><Undo2 size={14} /></button>}
                  </div>
                </div>
                <div><span style={{ ...S.flbl, ...lbl('reajuste_pct') }}>Reajuste %</span>
                  <input style={S.finp} defaultValue={efet.reajuste_pct ?? ''} key={`r${ov.reajuste_pct}`} placeholder="ex.: 8"
                    onBlur={e => set({ reajuste_pct: e.target.value ? parseNum(e.target.value) : null })} />
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: decidido('ativo') ? 'var(--violet)' : 'var(--text)' }}>
                  <input type="checkbox" checked={efet.ativo === false}
                    onChange={e => set({ ativo: e.target.checked ? false : null })} />
                  <b>Cortar neste cenário</b> <span style={{ color: 'var(--muted)' }}>(sai do quadro só aqui; o cadastro continua ativo)</span>
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <span style={S.flbl}>Por quê <span style={{ color: 'var(--muted)' }}>(vai junto quando você apresentar o cenário)</span></span>
                <input style={{ ...S.finp, width: '100%' }} defaultValue={ov.nota || ''} placeholder="ex.: corte estrutural 2027 · contratação adiada p/ jul"
                  onBlur={e => set({ nota: e.target.value.trim() || null })} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <button style={S.btn} disabled={!alt.length}
                  onClick={() => { limparCenario(m.id); setCenForm(null) }}>
                  <Undo2 size={14} /> Voltar a herdar tudo
                </button>
                <button style={S.btnP} onClick={() => setCenForm(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}

      {form && (
        <div style={S.overlay} onClick={() => setForm(null)}>
          <div style={{ ...S.modal, width: 'min(580px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{form.id ? `Editar posto ${form.codigo}` : 'Novo posto / vaga'}</div>
              <button onClick={() => setForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
              <div style={{ gridColumn: '1 / -1' }}><span style={S.flbl}>Ocupante <span style={{ color: 'var(--muted)' }}>(vazio = vaga planejada)</span></span>
                <input style={S.finp} value={form.nome} placeholder="Nome do funcionário; deixe vazio p/ vaga" onChange={e => setForm((f: any) => ({ ...f, nome: e.target.value }))} /></div>
              <div><span style={S.flbl}>Empresa *</span><select style={S.finp} value={form.empresa_id} onChange={e => setForm((f: any) => ({ ...f, empresa_id: e.target.value, filial_id: '', codigo: f.codigoAuto ? '' : f.codigo }))}><option value="">—</option>{acesso.filterList('empresa', empresas).map((e: any) => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}</select></div>
              <div><span style={S.flbl}>Filial *</span><select style={S.finp} value={form.filial_id} onChange={e => setForm((f: any) => ({ ...f, filial_id: e.target.value, codigo: f.codigoAuto ? gerarCodigoPosto(e.target.value, f.matricula) : f.codigo }))}><option value="">—</option>{filiais.filter((f: any) => !form.empresa_id || f.empresa_id === form.empresa_id).map((f: any) => <option key={f.id} value={f.id}>{f.codigo}{f.descricao ? ' · ' + f.descricao : ''}</option>)}</select></div>
              <div><span style={S.flbl}>Centro de custo</span><select style={S.finp} value={form.cc_id} onChange={e => setForm((f: any) => ({ ...f, cc_id: e.target.value }))}><option value="">—</option>{ccs.map((c: any) => <option key={c.id} value={c.id}>{c.codigo} · {c.descricao}</option>)}</select></div>
              <div><span style={S.flbl}>Matrícula</span><input style={S.finp} value={form.matricula} onChange={e => setForm((f: any) => ({ ...f, matricula: e.target.value, codigo: f.codigoAuto ? gerarCodigoPosto(f.filial_id, e.target.value) : f.codigo }))} /></div>
              <div><span style={S.flbl}>Código * <span style={{ color: 'var(--muted)' }}>{form.codigoAuto ? '(automático)' : '(manual)'}</span></span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...S.finp, flex: 1, ...(form.codigoAuto ? { background: 'var(--bg-soft)', color: 'var(--text-mid)' } : {}) }} value={form.codigo} readOnly={form.codigoAuto}
                    placeholder={form.codigoAuto ? (form.filial_id ? '' : 'escolha a filial') : ''} onChange={e => setForm((f: any) => ({ ...f, codigo: e.target.value }))} />
                  {form.codigoAuto
                    ? <button type="button" title="Editar código manualmente" style={{ padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setForm((f: any) => ({ ...f, codigoAuto: false }))}><Pencil size={14} /></button>
                    : <button type="button" title="Voltar ao código automático" style={{ padding: '0 10px', fontSize: 11, fontWeight: 600, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer' }} onClick={() => setForm((f: any) => ({ ...f, codigoAuto: true, codigo: gerarCodigoPosto(f.filial_id, f.matricula) }))}>auto</button>}
                </div></div>
              <div><span style={S.flbl}>Cargo</span><select style={S.finp} value={form.cargo_id} onChange={e => setForm((f: any) => ({ ...f, cargo_id: e.target.value }))}><option value="">—</option>{cargos.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
              <div><span style={S.flbl}>Regime</span><select style={S.finp} value={form.regime} onChange={e => setForm((f: any) => ({ ...f, regime: e.target.value }))}><option value="">—</option>{REGIMES.map(r => <option key={r} value={r}>{REGIMES_LABEL[r] || r}</option>)}</select></div>
              <div><span style={S.flbl}>Sindicato <span style={{ color: 'var(--muted)' }}>(vazio = pela empresa)</span></span><select style={S.finp} value={form.sindicato_id} onChange={e => setForm((f: any) => ({ ...f, sindicato_id: e.target.value }))}><option value="">— automático —</option>{sindicatos.map((s: any) => <option key={s.id} value={s.id}>{s.codigo}</option>)}</select></div>
              <div><span style={S.flbl}>Salário base</span><input style={S.finp} value={form.salario_base} placeholder="0,00" onChange={e => setForm((f: any) => ({ ...f, salario_base: e.target.value }))} /></div>
              <div><span style={S.flbl}>FTE</span><input style={S.finp} value={form.fte} placeholder="1" onChange={e => setForm((f: any) => ({ ...f, fte: e.target.value }))} /></div>
              <div><span style={S.flbl}>Vigência início</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.finp, flex: 1 }} value={form.ini_mes} onChange={e => setForm((f: any) => ({ ...f, ini_mes: e.target.value }))}><option value="">mês</option>{MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
                  <input style={{ ...S.finp, width: 76 }} value={form.ini_ano} placeholder="ano" onChange={e => setForm((f: any) => ({ ...f, ini_ano: e.target.value }))} />
                </div>
              </div>
              <div><span style={S.flbl}>Vigência fim <span style={{ color: 'var(--muted)' }}>(vazio = dez)</span></span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.finp, flex: 1 }} value={form.fim_mes} onChange={e => setForm((f: any) => ({ ...f, fim_mes: e.target.value }))}><option value="">mês</option>{MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
                  <input style={{ ...S.finp, width: 76 }} value={form.fim_ano} placeholder="ano" onChange={e => setForm((f: any) => ({ ...f, fim_ano: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Saída (v3_118). A DATA é a vigência fim, logo acima — aqui fica só o
                que a rescisão precisa e não dava para derivar: a admissão (aviso
                prévio progressivo + saldo do FGTS) e a prévia do que isso custa.
                Prestador/pró-labore não aparecem: o filtro por regime das verbas
                já os deixa de fora, e contrato que acaba não gera rescisão. */}
            {form.fim_ano && Number(form.fim_ano) === anoCalc && (() => {
              const regCLT = (form.regime || '').includes('CLT')
              const prev = regCLT ? calcularPosto({
                salario_base: parseNum(form.salario_base) || 0, fte: parseNum(form.fte) || 1,
                regime: form.regime || null, pais: empPais.get(form.empresa_id) ?? null,
                ini_ano: form.ini_ano ? parseInt(form.ini_ano, 10) : null, ini_mes: form.ini_mes ? parseInt(form.ini_mes, 10) : null,
                fim_ano: parseInt(form.fim_ano, 10), fim_mes: form.fim_mes ? parseInt(form.fim_mes, 10) : 12,
                admissao: (form.admissao || '').trim() || null,
                reajuste_mes: form.reajuste_mes ? parseInt(form.reajuste_mes, 10) : null,
                reajuste_pct: form.reajuste_pct ? parseNum(form.reajuste_pct) : null,
                reajuste_valor: form.reajuste_valor ? parseNum(form.reajuste_valor) : null,
              }, verbas, {
                dissidioPct: form.sindicato_id ? (dissidio[form.sindicato_id] || 0) : 0,
                mesBase: form.sindicato_id ? (sindMesBase[form.sindicato_id] || 1) : 1,
                ano: anoCalc, valoresFixos: form.id ? (postoVerbas[form.id] || {}) : {},
              }) : null
              const sal = parseNum(form.salario_base) || 0
              // Rescisão zerada tem DUAS causas e elas pedem conserto diferente:
              // não existir verba no catálogo, ou existir e o filtro de
              // país/regime do motor tirá-la do posto. Dizer só "sem verbas"
              // manda procurar no lugar errado.
              const ehResc = (t: string) => t === 'RESC_AVISO' || t === 'RESC_PROP' || t === 'RESC_SALDO_FGTS'
              const noCat = verbas.filter(v => ehResc(v.tipo_calculo))
              const aplicaveis = verbasDoRegime(verbas, form.regime || null, empPais.get(form.empresa_id) ?? null).filter(v => ehResc(v.tipo_calculo))
              return (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <span style={{ ...S.flbl, display: 'block', marginBottom: 6 }}>
                    Saída em {MESES_NUM[(form.fim_mes ? Number(form.fim_mes) : 12) - 1]}/{form.fim_ano} <span style={{ color: 'var(--muted)' }}>(a data é a vigência fim, acima)</span>
                  </span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div><span style={S.flbl}>Admissão <span style={{ color: 'var(--muted)' }}>(tempo de casa)</span></span>
                      <input type="date" style={{ ...S.finp, width: 150 }} value={form.admissao}
                        onChange={e => setForm((f: any) => ({ ...f, admissao: e.target.value }))} />
                    </div>
                    {prev && <div style={{ fontSize: 12.5, paddingBottom: 6 }}>
                      <div style={{ color: 'var(--red)', fontWeight: 600 }}>Rescisão estimada: R$ {money(prev.rescisaoAno)}{sal ? ` (${(prev.rescisaoAno / sal).toFixed(1)} salários)` : ''}</div>
                      <div style={{ color: aplicaveis.length ? 'var(--muted)' : 'var(--orange)' }}>
                        {prev.linhas.filter(l => l.categoria === 'Rescisão').map(l => `${l.verba.codigo} ${money(l.valorAno)}`).join(' · ')
                          || (!noCat.length
                            ? 'Nenhuma verba de rescisão no catálogo — rode a migration v3_118.'
                            : !aplicaveis.length
                              ? `As ${noCat.length} verbas de rescisão existem (${noCat.map(v => v.codigo).join(', ')}) mas NÃO se aplicam a este posto. O motor filtra por país e regime: confira o país da empresa contra o país da verba, e o regime "${form.regime || '—'}" contra o regime da verba, em Postos → Regras.`
                              : 'As verbas se aplicam mas deram zero — confira os parâmetros em Postos → Regras.')}
                      </div>
                    </div>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    {regCLT
                      ? <>Sem a admissão o aviso prévio vai a 30 dias e a multa do FGTS a zero — o motor cai na vigência de início. A multa é <b>estimada</b> por salário × tempo de casa; o saldo real está no extrato do FGTS. Os fatores ficam em <b>Postos → Regras</b> (<code>RESC_*</code>).</>
                      : <>Regime <b>{form.regime || '—'}</b>: contrato que termina, sem rescisão. Só <code>BR-CLT</code> tem as verbas <code>RESC_*</code>.</>}
                  </div>
                </div>
              )
            })()}

            {/* Reajuste individual (v3_116): promoção/mérito com data. Sem isto,
                planejar um aumento em março obrigava a escolher entre errar o ano
                todo (salário novo desde janeiro) ou o resto dele (velho até
                dezembro). Compõe com o dissídio do sindicato. */}
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ ...S.flbl, display: 'block', marginBottom: 6 }}>
                Reajuste individual <span style={{ color: 'var(--muted)' }}>(promoção/mérito — soma ao dissídio do sindicato)</span>
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><span style={S.flbl}>A partir de</span>
                  <select style={{ ...S.finp, width: 128 }} value={form.reajuste_mes}
                    onChange={e => setForm((f: any) => ({ ...f, reajuste_mes: e.target.value }))}>
                    <option value="">sem reajuste</option>
                    {MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div><span style={S.flbl}>%</span>
                  <input style={{ ...S.finp, width: 90 }} value={form.reajuste_pct} placeholder="ex.: 8"
                    disabled={!form.reajuste_mes || !!form.reajuste_valor}
                    onChange={e => setForm((f: any) => ({ ...f, reajuste_pct: e.target.value }))} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>ou</span>
                <div><span style={S.flbl}>Salário novo</span>
                  <input style={{ ...S.finp, width: 120 }} value={form.reajuste_valor} placeholder="ex.: 17600"
                    disabled={!form.reajuste_mes || !!form.reajuste_pct}
                    onChange={e => setForm((f: any) => ({ ...f, reajuste_valor: e.target.value }))} />
                </div>
                {form.reajuste_mes && (form.reajuste_pct || form.reajuste_valor) && (
                  <span style={{ fontSize: 11.5, color: 'var(--green)', paddingBottom: 8 }}>
                    {MESES_NUM[Number(form.reajuste_mes) - 1]}–dez: {form.reajuste_valor
                      ? `R$ ${parseNum(form.reajuste_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                      : `R$ ${(parseNum(form.salario_base) * (1 + parseNum(form.reajuste_pct) / 100)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                Vale só para o salário — encargos e provisões acompanham por serem % sobre ele; benefício de valor fixo (VR, plano) não muda.
              </div>
            </div>

            {/* Afastamento (v3_117). Escopo: quem JÁ está afastado e segue no ano
                orçado. Do 16º dia o salário é do INSS, então a empresa não paga
                salário nem nada que incida sobre ele — o motor zera a base
                nesses meses. Só sobram os benefícios marcados como devidos no
                afastamento (Postos → Regras). Absenteísmo esperado é premissa
                percentual, não cadastro por pessoa, e não entra aqui. */}
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ ...S.flbl, display: 'block', marginBottom: 6 }}>
                Afastamento <span style={{ color: 'var(--muted)' }}>(INSS, licença — a empresa não paga o salário nesses meses)</span>
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><span style={S.flbl}>Afastado desde</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, width: 100 }} value={form.afast_ini_mes}
                      onChange={e => setForm((f: any) => ({ ...f, afast_ini_mes: e.target.value, afast_ini_ano: f.afast_ini_ano || (e.target.value ? String(anoCalc) : '') }))}>
                      <option value="">não afastado</option>
                      {MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                    <input style={{ ...S.finp, width: 76 }} value={form.afast_ini_ano} placeholder="ano"
                      onChange={e => setForm((f: any) => ({ ...f, afast_ini_ano: e.target.value }))} />
                  </div>
                </div>
                <div><span style={S.flbl}>Retorno previsto <span style={{ color: 'var(--muted)' }}>(vazio = sem previsão)</span></span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, width: 100 }} value={form.afast_fim_mes} disabled={!form.afast_ini_mes}
                      onChange={e => setForm((f: any) => ({ ...f, afast_fim_mes: e.target.value, afast_fim_ano: f.afast_fim_ano || (e.target.value ? String(anoCalc) : '') }))}>
                      <option value="">—</option>
                      {MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                    <input style={{ ...S.finp, width: 76 }} value={form.afast_fim_ano} placeholder="ano" disabled={!form.afast_ini_mes}
                      onChange={e => setForm((f: any) => ({ ...f, afast_fim_ano: e.target.value }))} />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}><span style={S.flbl}>Motivo</span>
                  <input style={{ ...S.finp, width: '100%' }} value={form.afast_motivo} disabled={!form.afast_ini_mes}
                    placeholder="ex.: auxílio-doença desde 08/2026, sem alta prevista"
                    onChange={e => setForm((f: any) => ({ ...f, afast_motivo: e.target.value }))} />
                </div>
              </div>
              {form.afast_ini_mes && form.afast_ini_ano && (() => {
                const ia = parseInt(form.afast_ini_ano, 10), im = parseInt(form.afast_ini_mes, 10)
                const fa2 = form.afast_fim_ano ? parseInt(form.afast_fim_ano, 10) : null
                const fm = form.afast_fim_mes ? parseInt(form.afast_fim_mes, 10) : null
                const ini = ia > anoCalc ? 13 : (ia === anoCalc ? im : 1)
                const fim = fa2 == null ? 12 : (fa2 < anoCalc ? 0 : (fa2 === anoCalc ? (fm || 12) : 12))
                const n = Math.max(0, Math.min(12, fim) - Math.max(1, ini) + 1)
                return <div style={{ fontSize: 11.5, color: n ? 'var(--violet)' : 'var(--muted)', marginTop: 6 }}>
                  {n === 0
                    ? `O afastamento não alcança ${anoCalc} — o orçamento deste ano sai cheio.`
                    : `Em ${anoCalc}: ${MESES_NUM[Math.max(1, ini) - 1]}–${MESES_NUM[Math.min(12, fim) - 1]} (${n} ${n > 1 ? 'meses' : 'mês'}) sem salário, INSS, FGTS e provisões.`}
                </div>
              })()}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                Quais benefícios continuam devidos (plano de saúde sim, vale-transporte não) é regra da verba — marca-se em <b>Postos → Regras</b>.
              </div>
            </div>

            {/* Rateio: códigos anexados ao posto, em cascata (ordem). Origem = empresa/CC deste posto. */}
            <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Rateio <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(distribui o custo deste posto; aplicado na ordem)</span></span>
                <button style={{ ...S.btn, padding: '5px 9px', fontSize: 12 }} onClick={() => setForm((f: any) => ({ ...f, rateios: [...(f.rateios || []), { regra_id: '', ordem: (f.rateios?.length || 0) + 1 }] }))}><Plus size={13} /> Código</button>
              </div>
              {(!form.rateios || !form.rateios.length) && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sem rateio — 100% na empresa/CC do posto.</div>}
              {(form.rateios || []).map((r: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <select style={{ ...S.finp, flex: 1 }} value={r.regra_id} onChange={e => setForm((f: any) => ({ ...f, rateios: f.rateios.map((x: any, j: number) => j === i ? { ...x, regra_id: e.target.value } : x) }))}>
                    <option value="">— código —</option>
                    {rateioCods.map((c: any) => <option key={c.id} value={c.id}>{c.nome} ({c.dimensao === 'CC' ? 'CC' : 'Empresa'})</option>)}
                  </select>
                  <input style={{ ...S.finp, width: 64 }} title="Ordem da cascata" value={r.ordem} onChange={e => setForm((f: any) => ({ ...f, rateios: f.rateios.map((x: any, j: number) => j === i ? { ...x, ordem: parseInt(e.target.value, 10) || 1 } : x) }))} />
                  <button style={S.del} onClick={() => setForm((f: any) => ({ ...f, rateios: f.rateios.filter((_: any, j: number) => j !== i) }))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button style={S.btn} onClick={() => setForm(null)}>Cancelar</button>
              <button style={S.btnPri2} onClick={salvarPosto}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {rateModal && (
        <RateioModal posto={rateModal} totMes={custoMesP(rateModal)} totAno={custoAnoP(rateModal)}
          anexos={postoRateios[rateModal.id] || []} rateioCods={rateioCods} destByRegra={destByRegra}
          empById={empById} ccById={ccById} onClose={() => setRateModal(null)} />
      )}
    </div>
  )
}
