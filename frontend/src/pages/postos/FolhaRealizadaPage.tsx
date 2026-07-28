import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { PostosPills } from './PostosPills'
import { usePostoCtx } from '../../lib/postoCtx'
import { useLocalPref } from '../../lib/uiPrefs'
import { pageAll } from '../../lib/pageAll'
import { cascataRateio } from '../../lib/rateioFolha'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Search, X, FileDown } from 'lucide-react'

// Folha realizada (F5.2, pill 3) — importa fat_folha do folha_realizada.csv e lista
// o realizado da FOLHA por posto/competência. Base da conciliação Orçado × Realizado.

declare const XLSX: any
type Row = Record<string, string>
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const milAno = (v: number) => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${money(v)}`
const num = (s: string): number => { const r = (s || '').trim(); return r.includes(',') ? parseFloat(r.replace(/\./g, '').replace(',', '.')) : parseFloat(r) || 0 }

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
// colunas esperadas no arquivo (saída do converter_folha_realizada.py) + 1 linha de exemplo
const COLS_FOLHA = ['ano', 'mes', 'empresa', 'filial', 'cc', 'matricula', 'nome', 'verba_cod', 'verba_desc', 'tipo_verba', 'valor', 'conta_deb', 'conta_cred', 'item_orc', 'item_orc_desc', 'competencia', 'posto_codigo', 'rateio']
//                    posto_codigo: opcional, amarra direto ao posto (precede filial+matrícula) · rateio: S = ratear na conciliação; branco/N = já rateado
const EXEMPLO_FOLHA = ['2027', '1', '01', '2102', '214', '000003', 'FULANO DE TAL', '001', 'SALARIO', 'Provento', '4470.00', '41011001', '21012001', '20101', 'SALARIOS', '202701', '2102-000003', 'N']
function baixarModeloFolha() {
  const ws = XLSX.utils.aoa_to_sheet([COLS_FOLHA, EXEMPLO_FOLHA])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'folha')
  XLSX.writeFile(wb, 'modelo_folha_realizada.xlsx')
}

function parseXlsxRows(file: File): Promise<Row[]> {
  return new Promise((res, rej) => { const r = new FileReader()
    // raw:false → toda célula vem como TEXTO (número digitado no Excel não quebra os .trim() do import)
    r.onload = e => { try { const wb = XLSX.read(e.target?.result, { type: 'binary' }); res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false }) as Row[]) } catch (err) { rej(err) } }
    r.readAsBinaryString(file) })
}



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
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  cardT: { padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap' },
  sub2:  { padding: '4px 12px 4px 30px', fontSize: 12, color: 'var(--muted)' },
  info:  { display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.30)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-mid)', fontSize: 13, margin: '0 0 14px' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 14px' },
  empty: { padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
}

type FolhaRow = { posto_id: string | null; matricula: string; nome: string; empresa_id: string; filial_id: string | null; cc_id: string | null; verba_cod: string; verba_desc: string; tipo_verba: string; valor: number }

export default function FolhaRealizadaPage() {
  const acesso = useUserAccess()
  const cap = useCapacidades()
  const editavel = cap.can('orcar')   // importar folha = ação de escrita (mesma capacidade do quadro/rateio)
  const fileRef = useRef<HTMLInputElement>(null)
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [comps, setComps] = useState<string[]>([])   // 'YYYY-MM' disponíveis
  const [compSel, setCompSel] = usePostoCtx('compSel', '')
  const [rows, setRows] = useState<FolhaRow[]>([])
  const [empresaSel, setEmpresaSel] = usePostoCtx('empresaSel', [])
  const [filialSel, setFilialSel] = usePostoCtx('filialSel', [])
  const [ccSel, setCcSel] = usePostoCtx('ccSel', [])
  const [areaSel, setAreaSel] = usePostoCtx('areaSel', [])
  const [divisaoSel, setDivisaoSel] = usePostoCtx('divisaoSel', [])
  const [buSel, setBuSel] = usePostoCtx('buSel', [])
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [postoDim, setPostoDim] = useState<Map<string, { codigo: string; nome: string | null; empresa_id: string; filial_id: string | null; cc_id: string | null }>>(new Map())
  const [busca, setBusca] = useState('')
  const [modoImport, setModoImport] = useLocalPref<'full' | 'incremental'>('planorc_folha_modo_import', 'full')
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<{ gravados: number; postos: number; semPosto: number; semConta: number; semItem: number; semItemDrop: number; semEmpresa: string[]; errosPosto: string[]; incoerentes: string[]; rateadas: number; modo: 'full' | 'incremental'; comp: string } | null>(null)

  const loadComps = async () => {
    // pagina: sem isto, uma competência grande enche as 1000 primeiras linhas e as
    // competências mais antigas nem apareceriam no seletor.
    const data = await pageAll(() => supabase.from('fat_folha').select('ano,mes').eq('tipo', 'REALIZADO').order('ano', { ascending: false }).order('mes', { ascending: false }))
    const uniq = [...new Set(data.map((r: any) => `${r.ano}-${String(r.mes).padStart(2, '0')}`))]
    setComps(uniq); setCompSel(prev => uniq.includes(prev) ? prev : (uniq[0] || ''))
  }
  useEffect(() => {
    (async () => {
      const [e, f, c] = await Promise.all([
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      ])
      setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || [])
      // dims do POSTO (cadastro) — para o cabeçalho aglutinado usar a empresa/CC do
      // posto, não a da 1ª linha da folha (que pode ser de outra empresa/CC no detalhe).
      const pd = await pageAll(() => supabase.from('posto').select('id,codigo,nome,empresa_id,filial_id,cc_id'))
      setPostoDim(new Map(pd.map((p: any) => [p.id, { codigo: p.codigo, nome: p.nome, empresa_id: p.empresa_id, filial_id: p.filial_id, cc_id: p.cc_id }])))
    })()
    loadComps()
  }, [])
  useEffect(() => {
    if (!compSel) { setRows([]); return }
    const [a, m] = compSel.split('-').map(Number)
    pageAll(() => supabase.from('fat_folha').select('posto_id,matricula,nome,empresa_id,filial_id,cc_id,verba_cod,verba_desc,tipo_verba,valor').eq('tipo', 'REALIZADO').eq('ano', a).eq('mes', m))
      .then(data => setRows(data.map((r: any) => ({ ...r, valor: Number(r.valor) || 0 }))))
      .catch(e => setErro('Erro ao carregar a folha: ' + (e?.message || e)))
  }, [compSel, info])

  const filtrados = useMemo(() => {
    const empF = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const ccF = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    const sEmp = empF ? new Set(empF) : null, sCc = ccF ? new Set(ccF) : null
    const q = busca.trim().toLowerCase()
    return rows.filter(r => (!sEmp || sEmp.has(r.empresa_id)) && (!sCc || (r.cc_id != null && sCc.has(r.cc_id)))
      && (!q || (r.nome || '').toLowerCase().includes(q) || (r.matricula || '').toLowerCase().includes(q)))
  }, [rows, busca, empresaSel, ccSel, areaSel, divisaoSel, buSel, empresas, ccs, acesso.loading]) // eslint-disable-line

  const empById = useMemo(() => new Map(empresas.map(e => [e.id, e])), [empresas])
  const filById = useMemo(() => new Map(filiais.map(f => [f.id, f])), [filiais])
  const ccById = useMemo(() => new Map(ccs.map(c => [c.id, c])), [ccs])

  // agrupa por posto (matrícula quando não resolveu)
  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; nome: string; matricula: string; empresa_id: string; filial_id: string | null; cc_id: string | null; prov: number; desc: number; verbas: FolhaRow[] }>()
    for (const r of filtrados) {
      const k = r.posto_id || `mat:${r.matricula}`
      if (!m.has(k)) m.set(k, { key: k, nome: r.nome, matricula: r.matricula, empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: r.cc_id, prov: 0, desc: 0, verbas: [] })
      const g = m.get(k)!
      if ((r.tipo_verba || '').startsWith('Desconto')) g.desc += r.valor; else g.prov += r.valor
      g.verbas.push(r)
    }
    return [...m.values()].sort((a, b) => (b.prov - b.desc) - (a.prov - a.desc))
  }, [filtrados])
  const tot = useMemo(() => grupos.reduce((s, g) => ({ prov: s.prov + g.prov, desc: s.desc + g.desc, n: s.n + 1 }), { prov: 0, desc: 0, n: 0 }), [grupos])

  const onFile = async (file: File) => {
    setErro(null); setInfo(null); setImportando(true)
    try {
      const bruto = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : await parseXlsxRows(file)
      if (!bruto.length) { setErro('Arquivo vazio.'); return }
      // normaliza TODA célula para string — XLSX devolve número/data em alguns casos e
      // o import faz .trim() em toda parte; assim CSV e XLSX seguem idênticos.
      const data = bruto.map((row: any) => { const o: Row = {}; for (const k in row) o[k] = row[k] == null ? '' : String(row[k]); return o })
      // mapas de resolução por código
      const empByCod = new Map(empresas.map(e => [String(e.codigo).trim(), e.id]))
      const filByCod = new Map(filiais.map(f => [String(f.codigo).trim(), f]))
      const ccByCod = new Map(ccs.map(c => [String(c.codigo).trim(), c.id]))
      // paginado: plano de contas e lista de postos passam de 1000 fácil — sem isto o
      // import deixaria de casar posto/conta em parte das linhas, sem avisar.
      // posto com campos p/ validar posto_codigo (existência, vigência, coerência) e origem do rateio
      const pd = await pageAll(() => supabase.from('posto').select('id,codigo,empresa_id,filial_id,cc_id,ini_ano,ini_mes,fim_ano,fim_mes'))
      const postoByCod = new Map(pd.map((p: any) => [String(p.codigo).trim(), p]))
      // regras de rateio p/ EXPANDIR linhas `rateio=S` no import (materializa o rateado)
      const [pr, rr, rd] = await Promise.all([
        pageAll(() => supabase.from('posto_rateio').select('posto_id,regra_id,ordem')),
        supabase.from('rateio_regra').select('id,nome,dimensao').eq('ativo', true).then(r => r.data || []),
        pageAll(() => supabase.from('rateio_destino').select('regra_id,empresa_id,cc_id,pct')),
      ])
      const anexosByPosto: Record<string, { regra_id: string; ordem: number }[]> = {}
      for (const r of pr) (anexosByPosto[r.posto_id] ||= []).push({ regra_id: r.regra_id, ordem: Number(r.ordem) || 1 })
      const destByRegra: Record<string, any[]> = {}
      for (const d of rd) (destByRegra[d.regra_id] ||= []).push({ empresa_id: d.empresa_id, cc_id: d.cc_id, pct: Number(d.pct) || 0 })
      const ct = await pageAll(() => supabase.from('conta_contabil').select('id,codigo'))
      const contaByCod = new Map(ct.map((c: any) => [String(c.codigo).trim(), c.id]))
      const co = await pageAll(() => supabase.from('conta_orcamentaria').select('id,codigo'))
      const itemByCod = new Map(co.map((c: any) => [String(c.codigo).trim(), c.id]))

      // se a folha usa item orçamentário (IT_CONTAB_DB), as linhas SEM item são ativo/passivo
      // (IR/INSS retido, adiantamento…) — não entram no realizado (poluíam a conciliação).
      const usaItem = data.some(r => (r.item_orc || '').trim())
      const comps = new Set<string>()
      let semPosto = 0, semConta = 0, semItem = 0, semItemDrop = 0, rateadas = 0
      const semEmpresa = new Set<string>()   // códigos de empresa (ex.: redirect PY→XX) não cadastrados
      const errosPosto: string[] = []        // posto_codigo inexistente / fora de vigência (linha rejeitada)
      const incoerentes = new Set<string>()  // posto_codigo com empresa/filial ≠ cadastro (aviso — redirect/rateio)
      const payload: any[] = []
      for (const r of data) {
        const ano = parseInt(r.ano, 10), mes = parseInt(r.mes, 10)
        if (!ano || !mes) continue
        const item_orc_cod = (r.item_orc || '').trim()
        if (usaItem && !item_orc_cod) { semItemDrop++; continue }   // sem item na folha que usa item → não traz
        const filial = (r.filial || '').trim()
        const fil = filByCod.get(filial)
        // empresa: se o CSV traz o código (sempre traz — de-para filial ou redirect ITEM_CONTABIL),
        // usa esse; NÃO cai de volta pra empresa da filial quando o código não resolve — isso
        // desfaria o redirect (ex.: PY→XX) silenciosamente. Só usa a filial se o código vier vazio.
        const empCod = (r.empresa || '').trim()
        const empresa_id = empCod ? (empByCod.get(empCod) || null) : (fil ? fil.empresa_id : null)
        const cc_id = ccByCod.get((r.cc || '').trim()) || null
        // posto: posto_codigo tem PRECEDÊNCIA (amarra direto); senão fallback filial+matrícula
        const postoCod = (r.posto_codigo || '').trim()
        let posto_id: string | null = null
        let po: any = null
        if (postoCod) {
          po = postoByCod.get(postoCod)
          if (!po) { errosPosto.push(`${postoCod}: posto não existe`); continue }        // rejeita a linha
          const ini = po.ini_ano ? po.ini_ano * 12 + (po.ini_mes || 1) : null
          const fim = po.fim_ano ? po.fim_ano * 12 + (po.fim_mes || 12) : null
          const per = ano * 12 + mes
          if ((ini && per < ini) || (fim && per > fim)) { errosPosto.push(`${postoCod}: fora de vigência em ${mes}/${ano}`); continue }
          // filial diverge → rejeita (filial é estável, não muda com redirect/rateio)
          if (fil && po.filial_id && fil.id !== po.filial_id) { errosPosto.push(`${postoCod}: filial ${filial} ≠ cadastro do posto`); continue }
          posto_id = po.id
          // empresa diverge → só aviso (redirect ITEM_CONTABIL / rateio no ERP mudam legitimamente)
          if (empresa_id && po.empresa_id && empresa_id !== po.empresa_id) incoerentes.add(postoCod)
        } else {
          po = postoByCod.get(`${filial}-${(r.matricula || '').trim()}`) || null
          posto_id = po?.id || null
          if (!posto_id) semPosto++
        }
        comps.add(`${ano}|${mes}`)
        if (empCod && !empresa_id) semEmpresa.add(empCod)
        const conta_id = contaByCod.get((r.conta_deb || '').trim()) || null
        if (!conta_id) semConta++
        const item_orc_id = item_orc_cod ? (itemByCod.get(item_orc_cod) || null) : null
        if (item_orc_cod && !item_orc_id) semItem++
        const baseRow = {
          tenant_id: TENANT_ID, ano, mes,
          matricula: (r.matricula || '').trim() || null, nome: (r.nome || '').trim() || null, posto_id,
          verba_cod: (r.verba_cod || '').trim() || null, verba_desc: (r.verba_desc || '').trim() || null, tipo_verba: (r.tipo_verba || '').trim() || null,
          conta_deb_cod: (r.conta_deb || '').trim() || null, conta_cred_cod: (r.conta_cred || '').trim() || null, conta_id,
          item_orc_cod: item_orc_cod || null, item_orc_desc: (r.item_orc_desc || '').trim() || null, item_orc_id,
          competencia: (r.competencia || '').trim() || null, origem: 'FOLHA', tipo: 'REALIZADO',
        }
        const valorNum = num(r.valor)
        const filId = fil ? fil.id : (po?.filial_id || null)
        // rateio=S → MATERIALIZA: expande a linha nos destinos do rateio do posto (valor × pct);
        // branco/N → entra como veio (o realizado do ERP já vem rateado via ITEM_CONTABIL).
        if ((r.rateio || '').trim().toUpperCase() === 'S' && po) {
          const cells = cascataRateio({ empresa_id: po.empresa_id || null, cc_id: po.cc_id || null }, anexosByPosto[po.id] || [], rr, destByRegra).cells
          for (const c of cells) payload.push({ ...baseRow, empresa_id: c.empresa_id, filial_id: filId, cc_id: c.cc_id, valor: valorNum * c.pct })
          rateadas++
        } else {
          payload.push({ ...baseRow, empresa_id, filial_id: filId, cc_id, valor: valorNum })
        }
      }
      if (!payload.length) { setErro('Nenhuma linha válida (confira o cabeçalho: ano,mes,empresa,filial,cc,matricula,...).'); return }
      // FULL: substitui a competência (apaga o realizado dela e recarrega). INCREMENTAL:
      // só empilha (não apaga) — p/ somar o confidencial sobre o export do ERP.
      if (modoImport === 'full') {
        for (const c of comps) { const [a, m] = c.split('|').map(Number); const { error } = await supabase.from('fat_folha').delete().eq('tipo', 'REALIZADO').eq('ano', a).eq('mes', m); if (error) { setErro('Erro ao limpar competência: ' + error.message); return } }
      }
      for (let i = 0; i < payload.length; i += 500) { const { error } = await supabase.from('fat_folha').insert(payload.slice(i, i + 500)); if (error) { setErro('Erro ao gravar (parcial): ' + error.message); return } }
      const compLabel = [...comps].map(c => { const [a, m] = c.split('|'); return `${MESES[+m - 1]}/${a}` }).join(', ')
      const postosDistintos = new Set(payload.filter(p => p.posto_id).map(p => p.posto_id)).size
      setInfo({ gravados: payload.length, postos: postosDistintos, semPosto, semConta, semItem, semItemDrop, semEmpresa: [...semEmpresa], errosPosto, incoerentes: [...incoerentes], rateadas, modo: modoImport, comp: compLabel })
      loadComps()
    } catch (e: any) { setErro('Erro ao ler o arquivo: ' + (e?.message || e)) }
    finally { setImportando(false) }
  }

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Folha realizada</h1>
          <p style={S.sub}>Realizado da folha por posto (paralelo ao razão): importado da folha analítica <code>prgper02</code> via <code>converter_folha_realizada.py</code>. Base da conciliação Orçado × Realizado por posto.</p>
        </div>
        <PostosPills />
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Competência</span>
          <select style={S.sel} value={compSel} onChange={e => setCompSel(e.target.value)}>
            {!comps.length && <option value="">—</option>}
            {comps.map(c => { const [a, m] = c.split('-'); return <option key={c} value={c}>{MESES[+m - 1]}/{a}</option> })}
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Filtros</span>
          <FiltrosButton empresas={acesso.filterList('empresa', empresas)} filiais={acesso.filterList('filial', filiais)} ccs={acesso.filterList('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        </div>
        <div style={S.fld}><span style={S.lbl}>Buscar</span>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)', pointerEvents: 'none' }} />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="ocupante ou matrícula"
              style={{ ...S.sel, padding: '7px 26px 7px 28px', width: 200 }} />
            {busca && <X size={14} style={{ position: 'absolute', right: 8, top: 9, color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setBusca('')} />}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={baixarModeloFolha} title="Baixar planilha modelo (cabeçalhos esperados + 1 exemplo)"><FileDown size={14} /> Modelo</button>
        {editavel && <select style={S.sel} value={modoImport} onChange={e => setModoImport(e.target.value as any)}
          title="Full: apaga o realizado da competência e recarrega. Incremental: só adiciona (empilha o confidencial sobre o export do ERP).">
          <option value="full">Substituir competência (full)</option>
          <option value="incremental">Adicionar (incremental)</option>
        </select>}
        {editavel && <button style={S.btn} disabled={importando} onClick={() => fileRef.current?.click()}><Upload size={14} /> {importando ? 'Importando…' : 'Importar folha (CSV/XLSX)'}</button>}
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      </div>

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {info && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div><b>{info.gravados.toLocaleString('pt-BR')} lançamentos</b> de folha {info.modo === 'incremental' ? <b style={{ color: 'var(--blue)' }}>adicionados (incremental)</b> : 'importados'} ({info.comp}) em <b>{info.postos} postos</b>.
            {info.semPosto > 0 && <div style={{ color: 'var(--orange)' }}>{info.semPosto} sem posto casado (matrícula sem posto cadastrado) — importe os postos antes, ou confira filial-matrícula.</div>}
            {info.semConta > 0 && <div style={{ color: 'var(--muted)' }}>{info.semConta} sem conta contábil resolvida (débito fora do plano) — não amarram à DRE.</div>}
            {info.semItemDrop > 0 && <div style={{ color: 'var(--muted)' }}>{info.semItemDrop} linha(s) sem item orçamentário (ativo/passivo) ignoradas — não entram na conciliação.</div>}
            {info.semItem > 0 && <div style={{ color: 'var(--orange)' }}>{info.semItem} com item orçamentário (IT_CONTAB_DB) que não existe em conta_orcamentaria — cadastre o código pra conciliar.</div>}
            {info.semEmpresa.length > 0 && <div style={{ color: 'var(--orange)' }}>Empresa não cadastrada (código do de-para/redirect): <b>{info.semEmpresa.join(', ')}</b> — essas linhas ficaram sem empresa. Cadastre a empresa com esse código pra que o redirect (ITEM_CONTABIL) valha.</div>}
            {info.errosPosto.length > 0 && <div style={{ color: 'var(--red)' }}>⚠ {info.errosPosto.length} linha(s) rejeitada(s) por posto_codigo inválido: {info.errosPosto.slice(0, 8).join(' · ')}{info.errosPosto.length > 8 ? '…' : ''}</div>}
            {info.incoerentes.length > 0 && <div style={{ color: 'var(--orange)' }}>posto_codigo com empresa/filial diferente do cadastro (ok se for redirect/rateio): <b>{info.incoerentes.slice(0, 12).join(', ')}</b>{info.incoerentes.length > 12 ? '…' : ''}</div>}
            {info.rateadas > 0 && <div style={{ color: 'var(--muted)' }}>{info.rateadas} linha(s) com <b>rateio=S</b> expandidas nos destinos do rateio do posto (materializadas no fat_folha).</div>}
          </div>
        </div>
      )}

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Postos com folha</div><div style={S.kpiV}>{tot.n}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Proventos</div><div style={S.kpiV}>{milAno(tot.prov)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Descontos</div><div style={S.kpiV}>{milAno(tot.desc)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Líquido (prov − desc)</div><div style={S.kpiV}>{milAno(tot.prov - tot.desc)}</div></div>
      </div>

      <div style={S.card}>
        <div style={S.cardT}>Realizado por posto <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— clique para ver as verbas</span></div>
        <div style={{ maxHeight: 640, overflow: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Posto / matrícula</th><th style={S.th}>Ocupante</th><th style={S.th}>Empresa · Filial · CC</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Proventos</th><th style={{ ...S.th, textAlign: 'right' }}>Descontos</th><th style={{ ...S.th, textAlign: 'right' }}>Líquido</th>
            </tr></thead>
            <tbody>
              {grupos.map(g => {
                const open = aberto.has(g.key)
                return (
                  <Fragment key={g.key}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}>
                      <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--muted)' }}>{open ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />} {g.key.startsWith('mat:') ? `${g.matricula} (sem posto)` : (postoDim.get(g.key)?.codigo || g.matricula)}</td>
                      <td style={S.td}>{postoDim.get(g.key)?.nome || g.nome || '—'}</td>
                      {(() => {
                        // empresa/filial/CC DO POSTO (cadastro); "sem posto" cai na 1ª linha da folha
                        const pd = g.key.startsWith('mat:') ? null : postoDim.get(g.key)
                        const empId = pd?.empresa_id ?? g.empresa_id, filId = pd?.filial_id ?? g.filial_id, ccId = pd?.cc_id ?? g.cc_id
                        return <td style={{ ...S.td, color: 'var(--muted)' }}>{empById.get(empId)?.codigo || '—'} · {filById.get(filId || '')?.codigo || '—'} · {ccById.get(ccId || '')?.codigo || '—'}</td>
                      })()}
                      <td style={{ ...S.td, textAlign: 'right' }}>{money(g.prov)}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{money(g.desc)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{money(g.prov - g.desc)}</td>
                    </tr>
                    {open && g.verbas.map((v, i) => (
                      <tr key={g.key + i}>
                        <td style={S.sub2} colSpan={2}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{v.verba_cod}</span> {v.verba_desc}
                          {v.tipo_verba && <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px' }}>{v.tipo_verba}</span>}
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: 'var(--muted)' }}>{empById.get(v.empresa_id)?.codigo || '—'} · {filById.get(v.filial_id || '')?.codigo || '—'} · {ccById.get(v.cc_id || '')?.codigo || '—'}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }} colSpan={3}>{money(v.valor)}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
              {!grupos.length && <tr><td colSpan={6} style={S.empty}>{comps.length ? 'Sem folha para o escopo/competência.' : 'Nenhuma folha importada. Rode o converter e importe o folha_realizada.csv.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
