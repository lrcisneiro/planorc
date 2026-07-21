import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { calcularPosto, regimeAplica } from '../../lib/motorFolha'
import type { VerbaRegra, ResultadoPosto } from '../../lib/motorFolha'
import { Upload, Trash2, AlertCircle, CheckCircle2, Play, ChevronDown, ChevronRight, X, Search, Plus, Pencil } from 'lucide-react'
import { RateioModal } from './RateioModal'
import { cascataRateio } from '../../lib/rateioFolha'

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
const REGIMES = ['CLT', 'PRESTADOR', 'PROLABORE']
// sindicato por empresa (regra Ricardo): 06→MS, 08/YY/ZZ→PR, demais→SP. O import atribui (persiste no reimport).
const sindCodPorEmp = (empCod: string) => empCod === '06' ? 'SINDPDMS' : ['08', 'YY', 'ZZ'].includes(empCod) ? 'SINDPDPR' : 'SINDPDSP'
const abbrev = (nome: string) => {
  const ps = nome.trim().split(/\s+/); if (!ps.length) return nome
  const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return ps.length === 1 ? tc(ps[0]) : `${ps[0].charAt(0).toUpperCase()}. ${tc(ps[ps.length - 1])}`
}

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  top:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 720, lineHeight: 1.5 },
  pills: { display: 'flex', gap: 6 },
  pill:  (a: boolean, off?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: off ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : off ? 'var(--border-strong)' : 'var(--text-mid)', opacity: off ? 0.7 : 1 }),
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
const catCor: Record<string, string> = { 'Salário': 'var(--green)', Encargos: 'var(--orange)', 'Provisões': 'var(--blue)', 'Benefícios': 'var(--violet)' }
const tag = (bg: string, cor: string, brd: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: bg, color: cor, border: `1px solid ${brd}` })
const T = {
  ocup: tag('rgba(52,211,153,0.12)', 'var(--green)', 'rgba(52,211,153,0.35)'),
  vaga: tag('rgba(251,191,36,0.12)', 'var(--orange)', 'rgba(251,191,36,0.4)'),
  rateio: tag('rgba(34,211,238,0.12)', 'var(--blue)', 'rgba(34,211,238,0.4)'),
  sind: tag('var(--panel-2)', 'var(--muted)', 'var(--border)'),
}
const tagRegime = (r: string | null): CSSProperties =>
  r === 'CLT' ? tag('rgba(59,130,246,0.12)', 'var(--blue)', 'rgba(59,130,246,0.4)')
  : r === 'PRESTADOR' ? tag('rgba(251,146,60,0.12)', 'var(--orange)', 'rgba(251,146,60,0.4)')
  : r === 'PROLABORE' ? tag('rgba(139,92,246,0.12)', 'var(--violet)', 'rgba(139,92,246,0.4)')
  : T.sind
const REGIMES_LABEL: Record<string, string> = { CLT: 'CLT', PRESTADOR: 'Prestador', PROLABORE: 'Pró-labore' }

type Posto = {
  id: string; codigo: string; nome: string | null; matricula: string | null; regime: string | null; ativo?: boolean
  salario_base: number; fte: number; ini_ano: number | null; ini_mes: number | null; fim_ano: number | null; fim_mes: number | null
  empresa_id: string; filial_id: string | null; cc_id: string | null; cargo_id: string | null; sindicato_id: string | null
  cargo?: { nome: string } | null; empresa?: { codigo: string } | null; filial?: { codigo: string } | null
  centro_custo?: { codigo: string; descricao: string } | null; sindicato?: { codigo: string } | null
}

export default function PostosGradePage() {
  const acesso = useUserAccess()
  const cap = useCapacidades()
  const editavel = cap.can('orcar')

  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [cargos, setCargos] = useState<any[]>([])
  const [postos, setPostos] = useState<Posto[]>([])
  const [empresaSel, setEmpresaSel] = useState<string[]>([])
  const [filialSel, setFilialSel] = useState<string[]>([])
  const [ccSel, setCcSel] = useState<string[]>([])
  const [areaSel, setAreaSel] = useState<string[]>([])
  const [divisaoSel, setDivisaoSel] = useState<string[]>([])
  const [buSel, setBuSel] = useState<string[]>([])
  const [modo, setModo] = useState<'upsert' | 'substituir'>('upsert')
  const [agruparPor, setAgruparPor] = useState<'cc' | 'cargo'>('cc')
  const [regimeSel, setRegimeSel] = useState('')
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<{ gravados: number; apagados: number; modo: string; semEmp: string[]; semFil: string[]; semCc: string[]; cargosNovos: number; beneficios: number; benefColunas: number; rateioPostos: number; rateioCol: boolean; rateioNaoAchados: string[] } | null>(null)
  const [importando, setImportando] = useState(false)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  // motor de custo
  const [versoes, setVersoes] = useState<any[]>([])
  const [versaoSel, setVersaoSel] = useState('')
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
      supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
      supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      supabase.from('cargo').select('id,codigo,nome').order('nome'),
      supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
      supabase.from('verba_folha').select('id,codigo,descricao,tipo_calculo,parametro,verba_ref,conta_destino_id,incide_encargos,regime,ordem,categoria').eq('ativo', true).order('ordem', { nullsFirst: false }),
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
    if (vs.data?.length) setVersaoSel(prev => prev || vs.data[0].id)
  }
  useEffect(() => {
    if (!versaoSel) { setDissidio({}); return }
    supabase.from('premissa_dissidio').select('sindicato_id,pct').eq('versao_id', versaoSel)
      .then(r => setDissidio(Object.fromEntries((r.data || []).map((x: any) => [x.sindicato_id, Number(x.pct) || 0]))))
  }, [versaoSel])
  const loadPostos = async () => {
    const { data, error } = await supabase.from('posto')
      .select('*, cargo(nome), empresa(codigo), filial(codigo), centro_custo(codigo,descricao), sindicato(codigo)').order('codigo')
    if (error) { setErro(error.message); return }
    setPostos((data || []) as Posto[])
    const { data: pv } = await supabase.from('posto_verba').select('posto_id,verba_id,valor').eq('ativo', true)
    const m: Record<string, Record<string, number>> = {}
    for (const r of pv || []) (m[r.posto_id] ||= {})[r.verba_id] = Number(r.valor) || 0
    setPostoVerbas(m)
    const { data: pr } = await supabase.from('posto_rateio').select('posto_id,regra_id,ordem')
    const rm: Record<string, { regra_id: string; ordem: number }[]> = {}
    for (const r of pr || []) (rm[r.posto_id] ||= []).push({ regra_id: r.regra_id, ordem: Number(r.ordem) || 1 })
    for (const k in rm) rm[k].sort((a, b) => a.ordem - b.ordem)
    setPostoRateios(rm)
  }
  useEffect(() => { loadLookups(); loadPostos() }, [])

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
      const payload: any[] = []
      for (const r of rows) {
        if (!r.posto_codigo) continue
        const empresa_id = empByCod.get((r.empresa || '').trim())
        if (!empresa_id) { if (r.empresa) semEmp.add(r.empresa); continue }
        const filial_id = filByCod.get((r.filial || '').trim()) || null; if (!filial_id && r.filial) semFil.add(r.filial)
        const cc_id = ccByCod.get((r.cc || '').trim()) || null; if (!cc_id && r.cc) semCc.add(r.cc)
        const cargo_id = cargoByNome.get((r.cargo || '').trim().toUpperCase()) || null
        const [ay, am] = (r.admissao || '').split('-')
        payload.push({ tenant_id: TENANT_ID, codigo: r.posto_codigo, empresa_id, filial_id, cc_id, cargo_id,
          sindicato_id: sindByCod[sindCodPorEmp((r.empresa || '').trim())] || null,
          regime: (r.regime || '').trim() || null, salario_base: r.salario ? parseFloat(r.salario) : 0,
          nome: (r.nome || '').trim() || null, matricula: (r.matricula || '').trim() || null,
          ini_ano: ay ? parseInt(ay, 10) : null, ini_mes: am ? parseInt(am, 10) : null, fte: 1, ativo: (r.ativo || 'sim') !== 'nao' })
      }
      if (!payload.length) { setErro('Nenhuma linha resolvida — confira se os códigos de empresa existem nos cadastros.'); return }
      let apagados = 0
      if (modo === 'substituir') {
        const empIds = [...new Set(payload.map(p => p.empresa_id))]
        const cods = empIds.map(id => empresas.find(e => e.id === id)?.codigo || id)
        if (!confirm(`SUBSTITUIR ESCOPO: apaga todos os postos das empresas ${cods.join(', ')} e recarrega.\nAjustes manuais e vagas dessas empresas serão perdidos. Continuar?`)) return
        const { count, error: delErr } = await supabase.from('posto').delete({ count: 'exact' }).in('empresa_id', empIds)
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

      setImportInfo({ gravados: payload.length, apagados, modo, semEmp: [...semEmp], semFil: [...semFil], semCc: [...semCc], cargosNovos: nomesNovos.length, beneficios: benefCriados, benefColunas: benefCols.length, rateioPostos, rateioCol: !!rateioCol, rateioNaoAchados: [...rateioNaoAchados] })
      loadPostos()
    } finally { setImportando(false) }
  }
  const onFile = async (file: File) => {
    try { await importar(file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : await parseXlsxRows(file)) }
    catch (e: any) { setErro('Erro ao ler o arquivo: ' + (e?.message || e)) }
  }

  // ── Aplicar no orçado (step 5): grava fat_orcado (origem POSTO) do quadro ativo da versão ──
  const [aplicando, setAplicando] = useState(false)
  const [aplicarInfo, setAplicarInfo] = useState<{ linhas: number; postos: number; contas: number; ano: number; fundidas: number } | null>(null)
  const aplicarNoOrcado = async () => {
    setErro(null); setAplicarInfo(null)
    if (!versaoSel) { setErro('Selecione a versão do orçamento.'); return }
    if (!temMotor) { setErro('Sem verbas cadastradas — cadastre a Estrutura antes de aplicar.'); return }
    const ativos = postos.filter(p => p.ativo !== false)
    const versaoCod = versoes.find(v => v.id === versaoSel)?.codigo || String(anoCalc)
    if (!confirm(`Aplicar ${ativos.length} postos ativos no orçado da versão ${versaoCod} (ano ${anoCalc})?\n\nIsto SUBSTITUI todo o orçado de origem POSTO desta versão. Lançamentos manuais e de formulário não são afetados.`)) return
    setAplicando(true)
    try {
      const round2 = (n: number) => Math.round(n * 100) / 100
      const byKey = new Map<string, any>()   // dedup pela chave da uq_fat_orcado (soma colisões)
      const contasTocadas = new Set<string>(); let postosAplicados = 0; let gerados = 0
      for (const p of ativos) {
        const r = custos.get(p.id); if (!r) continue
        const { cells } = cascataRateio({ empresa_id: p.empresa_id, cc_id: p.cc_id || null }, postoRateios[p.id] || [], rateioCods, destByRegra)
        let algo = false
        for (const conta in r.porContaMes) {
          const mensal = r.porContaMes[conta]
          for (let mi = 0; mi < 12; mi++) {
            const base = mensal[mi]; if (!base) continue
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
              else byKey.set(key, { tenant_id: TENANT_ID, versao_id: versaoSel, linha_id: conta, empresa_id: cell.empresa_id, filial_id, cc_id, ano: anoCalc, mes: mi + 1, valor, expressao: null, origem: 'POSTO', dims })
              contasTocadas.add(conta); algo = true
            }
          }
        }
        if (algo) postosAplicados++
      }
      const rows = [...byKey.values()]
      // substitui o orçado origem POSTO da versão e reinsere
      const { error: delErr } = await supabase.from('fat_orcado').delete().eq('versao_id', versaoSel).eq('origem', 'POSTO')
      if (delErr) { setErro('Erro ao limpar o orçado POSTO: ' + delErr.message); return }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('fat_orcado').insert(rows.slice(i, i + 500))
        if (error) { setErro('Erro ao gravar o orçado (parcial): ' + error.message); return }
      }
      setAplicarInfo({ linhas: rows.length, postos: postosAplicados, contas: contasTocadas.size, ano: anoCalc, fundidas: gerados - rows.length })
    } finally { setAplicando(false) }
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
  const novoPosto = (pre?: { cc_id?: string; cargo_id?: string }) => setForm({ codigo: '', codigoAuto: true, nome: '', matricula: '', cargo_id: pre?.cargo_id || '', empresa_id: (empresas[0]?.id || ''), filial_id: '', cc_id: pre?.cc_id || '', sindicato_id: '', regime: 'CLT', salario_base: '', fte: '1', ini_ano: String(anoCalc), ini_mes: '1', fim_ano: '', fim_mes: '', rateios: [] })
  const editarPosto = (p: Posto) => setForm({ id: p.id, codigo: p.codigo, codigoAuto: false, nome: p.nome || '', matricula: p.matricula || '', cargo_id: p.cargo_id || '', empresa_id: p.empresa_id, filial_id: p.filial_id || '', cc_id: p.cc_id || '', sindicato_id: p.sindicato_id || '', regime: p.regime || '', salario_base: p.salario_base != null ? String(p.salario_base) : '', fte: p.fte != null ? String(p.fte) : '1', ini_ano: p.ini_ano ? String(p.ini_ano) : '', ini_mes: p.ini_mes ? String(p.ini_mes) : '', fim_ano: p.fim_ano ? String(p.fim_ano) : '', fim_mes: p.fim_mes ? String(p.fim_mes) : '', rateios: (postoRateios[p.id] || []).map(r => ({ ...r })) })
  const salvarPosto = async () => {
    if (!form) return
    if (!form.empresa_id) { setErro('Informe a empresa.'); return }
    if (!form.filial_id) { setErro('Informe a filial.'); return }
    const codigo = ((form.codigoAuto ? gerarCodigoPosto(form.filial_id, form.matricula) : form.codigo) || '').trim()
    if (!codigo) { setErro('Código não gerado — confira a filial.'); return }
    const empCod = empresas.find(e => e.id === form.empresa_id)?.codigo || ''
    const payload: any = {
      tenant_id: TENANT_ID, codigo,
      nome: (form.nome || '').trim() || null, matricula: (form.matricula || '').trim() || null,
      cargo_id: form.cargo_id || null, empresa_id: form.empresa_id, filial_id: form.filial_id || null, cc_id: form.cc_id || null,
      sindicato_id: form.sindicato_id || sindByCod[sindCodPorEmp(empCod)] || null,
      regime: form.regime || null, salario_base: parseNum(form.salario_base) || 0, fte: parseNum(form.fte) || 1,
      ini_ano: form.ini_ano ? parseInt(form.ini_ano, 10) : null, ini_mes: form.ini_mes ? parseInt(form.ini_mes, 10) : null,
      fim_ano: form.fim_ano ? parseInt(form.fim_ano, 10) : null, fim_mes: form.fim_mes ? parseInt(form.fim_mes, 10) : null,
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
    return postos.filter(p =>
      (mostrarInativos || p.ativo !== false) &&
      (!sEmp || sEmp.has(p.empresa_id)) &&
      (!sFil || (p.filial_id != null && sFil.has(p.filial_id))) &&
      (!sCc || (p.cc_id != null && sCc.has(p.cc_id))) &&
      (!regimeSel || p.regime === regimeSel) && match(p)
    )
  }, [postos, mostrarInativos, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, regimeSel, busca, empresas, filiais, ccs, acesso.loading]) // eslint-disable-line
  const nInativos = useMemo(() => postos.filter(p => p.ativo === false).length, [postos])

  // ── motor: custo por posto (com encargos/provisões/benefícios) ──
  const anoCalc = useMemo(() => {
    const m = (versoes.find(v => v.id === versaoSel)?.codigo || '').match(/(20\d{2})/)
    return m ? parseInt(m[1], 10) : new Date().getFullYear()
  }, [versoes, versaoSel])
  const temMotor = verbas.length > 0
  const custos = useMemo(() => {
    const map = new Map<string, ResultadoPosto>()
    if (!temMotor) return map
    for (const p of postos) map.set(p.id, calcularPosto(p as any, verbas, {
      dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
      mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
      ano: anoCalc,
      valoresFixos: postoVerbas[p.id] || {},
    }))
    return map
  }, [postos, verbas, dissidio, sindMesBase, anoCalc, temMotor, postoVerbas])
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
    const fte = filtrados.reduce((s, p) => s + (Number(p.fte) || 0), 0)
    const ano = filtrados.reduce((s, p) => s + custoAnoP(p), 0)
    const cat = { 'Salário': 0, Encargos: 0, 'Provisões': 0, 'Benefícios': 0 } as Record<string, number>
    for (const p of filtrados) { const r = custos.get(p.id); if (r) for (const k in r.porCategoria) cat[k] += (r.porCategoria as any)[k] }
    return { head, vagas, fte, ano, cat, medioFte: fte ? (ano / 12) / fte : 0 }
  }, [filtrados, custos]) // eslint-disable-line

  // janela de vigência DENTRO do ano da versão (bate com o motor)
  const vig = (p: Posto) => {
    const iniM = (p.ini_ano == null || p.ini_ano < anoCalc) ? 1 : (p.ini_ano === anoCalc ? (p.ini_mes || 1) : 13)
    const fimM = (p.fim_ano == null || p.fim_ano > anoCalc) ? 12 : (p.fim_ano === anoCalc ? (p.fim_mes || 12) : 0)
    if (iniM > 12 || fimM < 1 || iniM > fimM) return { txt: 'fora do ano', alerta: true }
    return { txt: `${MESES[iniM - 1]}–${MESES[fimM - 1]}`, alerta: iniM > 1 || fimM < 12 }
  }

  const linhaPosto = (p: Posto) => {
    const custoMes = custoMesP(p), custoAno = custoAnoP(p)
    const v = vig(p)
    return (
      <tr key={p.id} style={p.ativo === false ? { opacity: 0.55 } : undefined}>
        <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--muted)' }}>{p.codigo}
          {p.ativo === false && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5, color: 'var(--red)', border: '1px solid var(--red)55', background: 'rgba(248,113,113,0.12)' }}>DEMITIDO</span>}</td>
        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}
          title={`${p.empresa?.codigo || '?'} · ${p.filial?.codigo || '?'} · ${p.centro_custo?.codigo || '?'} ${p.centro_custo?.descricao || ''}`}>
          {p.empresa?.codigo || '—'}·{p.filial?.codigo || '—'}·{p.centro_custo?.codigo || '—'}</td>
        <td style={S.td}>{p.cargo?.nome || '—'}</td>
        <td style={S.td}>{p.nome
          ? <span style={T.ocup}>{abbrev(p.nome)}</span>
          : <span style={T.vaga}>VAGA{p.ini_mes ? ` · ${MESES[p.ini_mes - 1]}/${String(p.ini_ano || '').slice(2)}` : ''}</span>}</td>
        <td style={S.td}>{p.regime ? <span style={tagRegime(p.regime)}>{REGIMES_LABEL[p.regime] || p.regime}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
        <td style={S.td}>{p.sindicato?.codigo ? <span style={T.sind}>{p.sindicato.codigo}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
        <td style={{ ...S.td, textAlign: 'right' }}>
          {editavel
            ? <input style={S.inp} defaultValue={inp2(p.salario_base)} onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== p.salario_base) salvar(p.id, { salario_base: x }) }} />
            : money(Number(p.salario_base) || 0)}{!p.nome && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>(ref.)</span>}
        </td>
        <td style={{ ...S.td, textAlign: 'right' }}>
          {editavel
            ? <input style={{ ...S.inp, width: 50 }} defaultValue={inpNum(p.fte ?? 1)} onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== p.fte) salvar(p.id, { fte: x }) }} />
            : (Number(p.fte) || 1).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}
        </td>
        <td style={{ ...S.td, color: v.alerta ? 'var(--orange)' : 'var(--muted)' }}>{v.txt}</td>
        <td style={S.td}>{(() => {
          const rr = postoRateios[p.id] || []
          if (!rr.length) return <span style={{ color: 'var(--muted)' }}>—</span>
          const nomes = rr.map(x => rateioCods.find(c => c.id === x.regra_id)?.nome || '?').join(' → ')
          return <button title={`${nomes} — clique para ver a memória`} onClick={() => setRateModal(p)} style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.14)' }}>{rr.length} cód.</button>
        })()}</td>
        <td style={{ ...S.td, textAlign: 'right', cursor: 'pointer' }} title="Ver memória de cálculo" onClick={() => setDrill(p)}>{money(custoMes)}</td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, cursor: 'pointer' }} title="Ver memória de cálculo" onClick={() => setDrill(p)}>{money(custoAno)}</td>
        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{editavel && <>
          <button style={S.del} title="Editar posto" onClick={() => editarPosto(p)}><Pencil size={14} /></button>
          <button style={S.del} title="Excluir" onClick={() => excluir(p.id, p.codigo)}><Trash2 size={15} /></button>
        </>}</td>
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
        <div style={S.pills}>
          <span style={S.pill(true)}>1 · Postos</span>
          <Link to="/postos/regras" style={S.pill(false)}>2 · Estrutura</Link>
          <Link to="/postos/memoria" style={S.pill(false)}>3 · Memória de cálculo</Link>
          <Link to="/postos/rateio" style={S.pill(false)}>4 · Rateio</Link>
        </div>
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Versão</span>
          <select style={S.sel} value={versaoSel} onChange={e => setVersaoSel(e.target.value)} title="Versão do orçamento — define o dissídio aplicado ao custo">
            {!versoes.length && <option value="">—</option>}
            {versoes.map((v: any) => <option key={v.id} value={v.id}>{v.codigo}</option>)}
          </select>
        </div>
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
        {editavel && <button style={S.btn} onClick={() => novoPosto()}><Plus size={14} /> Posto / vaga</button>}
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
      {aplicarInfo && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div>Orçado aplicado na versão (ano {aplicarInfo.ano}): <b>{aplicarInfo.linhas.toLocaleString('pt-BR')} linhas</b> gravadas em <b>{aplicarInfo.postos} postos</b> e {aplicarInfo.contas} conta(s), origem POSTO.
            <div style={{ color: 'var(--muted)' }}>Substituiu o orçado POSTO anterior desta versão. Veja em Orçar / DRE (some com o manual/formulário na mesma célula).</div>
            {aplicarInfo.fundidas > 0 && <div style={{ color: 'var(--orange)' }}>⚠ {aplicarInfo.fundidas} lançamento(s) caíram na mesma célula e foram somados — pode indicar posto duplicado nos dados. Confira se há códigos de posto repetidos.</div>}
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
            {importInfo.rateioNaoAchados.length > 0 && <div style={{ color: 'var(--orange)' }}>Códigos de rateio não encontrados (ignorados): {importInfo.rateioNaoAchados.join(', ')} — confira os nomes em 4 · Rateio.</div>}
            {importInfo.semEmp.length > 0 && <div style={{ color: 'var(--red)' }}>⚠ Empresas não encontradas (postos ignorados): {importInfo.semEmp.join(', ')}</div>}
            {importInfo.semFil.length > 0 && <div style={{ color: 'var(--orange)' }}>Filiais não encontradas (posto sem filial): {importInfo.semFil.join(', ')}</div>}
            {importInfo.semCc.length > 0 && <div style={{ color: 'var(--orange)' }}>CCs não encontrados (posto sem CC): {importInfo.semCc.slice(0, 20).join(', ')}{importInfo.semCc.length > 20 ? '…' : ''}</div>}
          </div>
        </div>
      )}

      {(() => {
        const t = tot.cat['Salário'] + tot.cat.Encargos + tot.cat['Provisões'] + tot.cat['Benefícios']
        const pct = (v: number) => t ? Math.round(v / t * 100) : 0
        const comp = temMotor && t
          ? `salários ${pct(tot.cat['Salário'])}% · encargos ${pct(tot.cat.Encargos + tot.cat['Provisões'])}% · benef ${pct(tot.cat['Benefícios'])}%`
          : 'sem motor — cadastre verbas em Estrutura'
        return (
          <div style={S.kpis}>
            <div style={S.kpi}><div style={S.kpiL}>Headcount</div><div style={S.kpiV}>{tot.head}</div><div style={S.kpiH}>{tot.vagas} vaga{tot.vagas === 1 ? '' : 's'} planejada{tot.vagas === 1 ? '' : 's'}</div></div>
            <div style={S.kpi}><div style={S.kpiL}>FTE total</div><div style={S.kpiV}>{tot.fte.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div><div style={S.kpiH}>inclui ½ períodos</div></div>
            <div style={S.kpi}><div style={S.kpiL}>Custo anual {temMotor ? '(c/ encargos)' : '(base)'}</div><div style={S.kpiV}>{milAno(tot.ano)}</div><div style={S.kpiH}>{comp}</div></div>
            <div style={S.kpi}><div style={S.kpiL}>Custo médio / FTE</div><div style={S.kpiV}>R$ {money(tot.medioFte)}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>/mês</span></div><div style={S.kpiH}>{temMotor ? 'com encargos' : 'base'}</div></div>
          </div>
        )
      })()}

      <div style={S.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Posto</th><th style={S.th}>Empr·Fil·CC</th><th style={S.th}>Cargo</th><th style={S.th}>Ocupante</th><th style={S.th}>Modelo</th><th style={S.th}>Sind.</th>
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
                      <td colSpan={13} style={S.gh}>
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
              {!filtrados.length && <tr><td colSpan={13} style={S.empty}>
                {postos.length ? 'Nenhum posto para o filtro.' : 'Nenhum posto ainda. Use "Importar postos (RH)" para carregar do cadastro convertido.'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>¹ {temMotor ? 'Custo com encargos/provisões/benefícios pelo motor (clique no valor p/ ver a memória). Rateio entra no step 4.' : 'Custo base (salário × FTE) — cadastre as verbas em Estrutura para o custo com encargos.'}</p>

      {drill && (() => {
        const r = custos.get(drill.id)
        const dis = drill.sindicato_id ? (dissidio[drill.sindicato_id] || 0) : 0
        return (
          <div style={S.overlay} onClick={() => setDrill(null)}>
            <div style={S.modal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{drill.nome || 'Vaga'} <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{drill.codigo}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{drill.cargo?.nome || '—'} · {drill.regime || '—'} · {drill.sindicato?.codigo || 'sem sindicato'}{dis ? ` · dissídio ${dis}%` : ''} · base R$ {money((Number(drill.salario_base) || 0) * (Number(drill.fte) || 1))}/mês</div>
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
                {(['Salário', 'Encargos', 'Provisões', 'Benefícios'] as const).map(c => r.porCategoria[c] ? (
                  <span key={c} style={{ ...tag('var(--bg)', catCor[c], 'var(--border)'), fontSize: 11.5 }}>{c}: R$ {money(r.porCategoria[c])}/ano</span>
                ) : null)}
              </div>}

              {editavel && (() => {
                const benefVerbas = verbas.filter(v => v.tipo_calculo === 'VALOR_FIXO' && regimeAplica(v.regime, drill.regime))
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
              <div><span style={S.flbl}>Regime</span><select style={S.finp} value={form.regime} onChange={e => setForm((f: any) => ({ ...f, regime: e.target.value }))}><option value="">—</option>{REGIMES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
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
