import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

// Folha realizada (F5.2, pill 5) — importa fat_folha do folha_realizada.csv e lista
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
function parseXlsxRows(file: File): Promise<Row[]> {
  return new Promise((res, rej) => { const r = new FileReader()
    r.onload = e => { try { const wb = XLSX.read(e.target?.result, { type: 'binary' }); res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Row[]) } catch (err) { rej(err) } }
    r.readAsBinaryString(file) })
}

const pill = (a: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: a ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : 'var(--text-mid)' })

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

type FolhaRow = { posto_id: string | null; matricula: string; nome: string; empresa_id: string; cc_id: string | null; verba_cod: string; verba_desc: string; tipo_verba: string; valor: number }

export default function FolhaRealizadaPage() {
  const acesso = useUserAccess()
  const editavel = !acesso.loading
  const fileRef = useRef<HTMLInputElement>(null)
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [comps, setComps] = useState<string[]>([])   // 'YYYY-MM' disponíveis
  const [compSel, setCompSel] = useState('')
  const [rows, setRows] = useState<FolhaRow[]>([])
  const [empresaSel, setEmpresaSel] = useState<string[]>([])
  const [filialSel, setFilialSel] = useState<string[]>([])
  const [ccSel, setCcSel] = useState<string[]>([])
  const [areaSel, setAreaSel] = useState<string[]>([])
  const [divisaoSel, setDivisaoSel] = useState<string[]>([])
  const [buSel, setBuSel] = useState<string[]>([])
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<{ gravados: number; postos: number; semPosto: number; semConta: number; semItem: number; semItemDrop: number; semEmpresa: string[]; comp: string } | null>(null)

  const loadComps = async () => {
    const { data } = await supabase.from('fat_folha').select('ano,mes').eq('tipo', 'REALIZADO').order('ano', { ascending: false }).order('mes', { ascending: false })
    const uniq = [...new Set((data || []).map((r: any) => `${r.ano}-${String(r.mes).padStart(2, '0')}`))]
    setComps(uniq); setCompSel(prev => prev || uniq[0] || '')
  }
  useEffect(() => {
    (async () => {
      const [e, f, c] = await Promise.all([
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      ])
      setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || [])
    })()
    loadComps()
  }, [])
  useEffect(() => {
    if (!compSel) { setRows([]); return }
    const [a, m] = compSel.split('-').map(Number)
    supabase.from('fat_folha').select('posto_id,matricula,nome,empresa_id,cc_id,verba_cod,verba_desc,tipo_verba,valor').eq('tipo', 'REALIZADO').eq('ano', a).eq('mes', m)
      .then(({ data }) => setRows((data || []).map((r: any) => ({ ...r, valor: Number(r.valor) || 0 }))))
  }, [compSel, info])

  const filtrados = useMemo(() => {
    const empF = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const ccF = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    const sEmp = empF ? new Set(empF) : null, sCc = ccF ? new Set(ccF) : null
    return rows.filter(r => (!sEmp || sEmp.has(r.empresa_id)) && (!sCc || (r.cc_id != null && sCc.has(r.cc_id))))
  }, [rows, empresaSel, ccSel, areaSel, divisaoSel, buSel, empresas, ccs, acesso.loading]) // eslint-disable-line

  const empById = useMemo(() => new Map(empresas.map(e => [e.id, e])), [empresas])
  const ccById = useMemo(() => new Map(ccs.map(c => [c.id, c])), [ccs])

  // agrupa por posto (matrícula quando não resolveu)
  const grupos = useMemo(() => {
    const m = new Map<string, { key: string; nome: string; matricula: string; empresa_id: string; cc_id: string | null; prov: number; desc: number; verbas: FolhaRow[] }>()
    for (const r of filtrados) {
      const k = r.posto_id || `mat:${r.matricula}`
      if (!m.has(k)) m.set(k, { key: k, nome: r.nome, matricula: r.matricula, empresa_id: r.empresa_id, cc_id: r.cc_id, prov: 0, desc: 0, verbas: [] })
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
      const data = file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : await parseXlsxRows(file)
      if (!data.length) { setErro('Arquivo vazio.'); return }
      // mapas de resolução por código
      const empByCod = new Map(empresas.map(e => [String(e.codigo).trim(), e.id]))
      const filByCod = new Map(filiais.map(f => [String(f.codigo).trim(), f]))
      const ccByCod = new Map(ccs.map(c => [String(c.codigo).trim(), c.id]))
      const { data: pd } = await supabase.from('posto').select('id,codigo')
      const postoByCod = new Map((pd || []).map((p: any) => [String(p.codigo).trim(), p.id]))
      const { data: ct } = await supabase.from('conta_contabil').select('id,codigo')
      const contaByCod = new Map((ct || []).map((c: any) => [String(c.codigo).trim(), c.id]))
      const { data: co } = await supabase.from('conta_orcamentaria').select('id,codigo')
      const itemByCod = new Map((co || []).map((c: any) => [String(c.codigo).trim(), c.id]))

      // se a folha usa item orçamentário (IT_CONTAB_DB), as linhas SEM item são ativo/passivo
      // (IR/INSS retido, adiantamento…) — não entram no realizado (poluíam a conciliação).
      const usaItem = data.some(r => (r.item_orc || '').trim())
      const comps = new Set<string>()
      let semPosto = 0, semConta = 0, semItem = 0, semItemDrop = 0
      const semEmpresa = new Set<string>()   // códigos de empresa (ex.: redirect PY→XX) não cadastrados
      const payload: any[] = []
      for (const r of data) {
        const ano = parseInt(r.ano, 10), mes = parseInt(r.mes, 10)
        if (!ano || !mes) continue
        const item_orc_cod = (r.item_orc || '').trim()
        if (usaItem && !item_orc_cod) { semItemDrop++; continue }   // sem item na folha que usa item → não traz
        comps.add(`${ano}|${mes}`)
        const filial = (r.filial || '').trim()
        const fil = filByCod.get(filial)
        // empresa: se o CSV traz o código (sempre traz — de-para filial ou redirect ITEM_CONTABIL),
        // usa esse; NÃO cai de volta pra empresa da filial quando o código não resolve — isso
        // desfaria o redirect (ex.: PY→XX) silenciosamente. Só usa a filial se o código vier vazio.
        const empCod = (r.empresa || '').trim()
        const empresa_id = empCod ? (empByCod.get(empCod) || null) : (fil ? fil.empresa_id : null)
        if (empCod && !empresa_id) semEmpresa.add(empCod)
        const posto_id = postoByCod.get(`${filial}-${(r.matricula || '').trim()}`) || null
        if (!posto_id) semPosto++
        const conta_id = contaByCod.get((r.conta_deb || '').trim()) || null
        if (!conta_id) semConta++
        const item_orc_id = item_orc_cod ? (itemByCod.get(item_orc_cod) || null) : null
        if (item_orc_cod && !item_orc_id) semItem++
        payload.push({
          tenant_id: TENANT_ID, ano, mes, empresa_id, filial_id: fil ? fil.id : null, cc_id: ccByCod.get((r.cc || '').trim()) || null,
          matricula: (r.matricula || '').trim() || null, nome: (r.nome || '').trim() || null, posto_id,
          verba_cod: (r.verba_cod || '').trim() || null, verba_desc: (r.verba_desc || '').trim() || null, tipo_verba: (r.tipo_verba || '').trim() || null,
          valor: num(r.valor), conta_deb_cod: (r.conta_deb || '').trim() || null, conta_cred_cod: (r.conta_cred || '').trim() || null, conta_id,
          item_orc_cod: item_orc_cod || null, item_orc_desc: (r.item_orc_desc || '').trim() || null, item_orc_id,
          competencia: (r.competencia || '').trim() || null, origem: 'FOLHA', tipo: 'REALIZADO',
        })
      }
      if (!payload.length) { setErro('Nenhuma linha válida (confira o cabeçalho: ano,mes,empresa,filial,cc,matricula,...).'); return }
      // idempotente: substitui as competências presentes no arquivo
      for (const c of comps) { const [a, m] = c.split('|').map(Number); const { error } = await supabase.from('fat_folha').delete().eq('tipo', 'REALIZADO').eq('ano', a).eq('mes', m); if (error) { setErro('Erro ao limpar competência: ' + error.message); return } }
      for (let i = 0; i < payload.length; i += 500) { const { error } = await supabase.from('fat_folha').insert(payload.slice(i, i + 500)); if (error) { setErro('Erro ao gravar (parcial): ' + error.message); return } }
      const compLabel = [...comps].map(c => { const [a, m] = c.split('|'); return `${MESES[+m - 1]}/${a}` }).join(', ')
      const postosDistintos = new Set(payload.filter(p => p.posto_id).map(p => p.posto_id)).size
      setInfo({ gravados: payload.length, postos: postosDistintos, semPosto, semConta, semItem, semItemDrop, semEmpresa: [...semEmpresa], comp: compLabel })
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link to="/postos" style={pill(false)}>1 · Postos</Link>
          <Link to="/postos/regras" style={pill(false)}>2 · Estrutura</Link>
          <Link to="/postos/memoria" style={pill(false)}>3 · Memória</Link>
          <Link to="/postos/rateio" style={pill(false)}>4 · Rateio</Link>
          <span style={pill(true)}>5 · Folha realizada</span>
          <Link to="/postos/conciliacao" style={pill(false)}>6 · Conciliação</Link>
        </div>
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
        <div style={{ flex: 1 }} />
        {editavel && <button style={S.btn} disabled={importando} onClick={() => fileRef.current?.click()}><Upload size={14} /> {importando ? 'Importando…' : 'Importar folha (CSV)'}</button>}
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      </div>

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {info && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div><b>{info.gravados.toLocaleString('pt-BR')} lançamentos</b> de folha importados ({info.comp}) em <b>{info.postos} postos</b>.
            {info.semPosto > 0 && <div style={{ color: 'var(--orange)' }}>{info.semPosto} sem posto casado (matrícula sem posto cadastrado) — importe os postos antes, ou confira filial-matrícula.</div>}
            {info.semConta > 0 && <div style={{ color: 'var(--muted)' }}>{info.semConta} sem conta contábil resolvida (débito fora do plano) — não amarram à DRE.</div>}
            {info.semItemDrop > 0 && <div style={{ color: 'var(--muted)' }}>{info.semItemDrop} linha(s) sem item orçamentário (ativo/passivo) ignoradas — não entram na conciliação.</div>}
            {info.semItem > 0 && <div style={{ color: 'var(--orange)' }}>{info.semItem} com item orçamentário (IT_CONTAB_DB) que não existe em conta_orcamentaria — cadastre o código pra conciliar.</div>}
            {info.semEmpresa.length > 0 && <div style={{ color: 'var(--orange)' }}>Empresa não cadastrada (código do de-para/redirect): <b>{info.semEmpresa.join(', ')}</b> — essas linhas ficaram sem empresa. Cadastre a empresa com esse código pra que o redirect (ITEM_CONTABIL) valha.</div>}
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
              <th style={S.th}>Posto / matrícula</th><th style={S.th}>Ocupante</th><th style={S.th}>Empresa · CC</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Proventos</th><th style={{ ...S.th, textAlign: 'right' }}>Descontos</th><th style={{ ...S.th, textAlign: 'right' }}>Líquido</th>
            </tr></thead>
            <tbody>
              {grupos.map(g => {
                const open = aberto.has(g.key)
                return (
                  <Fragment key={g.key}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(s => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}>
                      <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--muted)' }}>{open ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />} {g.matricula}{!g.key.startsWith('mat:') ? '' : ' (sem posto)'}</td>
                      <td style={S.td}>{g.nome || '—'}</td>
                      <td style={{ ...S.td, color: 'var(--muted)' }}>{empById.get(g.empresa_id)?.codigo || '—'} · {ccById.get(g.cc_id || '')?.codigo || '—'}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{money(g.prov)}</td>
                      <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{money(g.desc)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{money(g.prov - g.desc)}</td>
                    </tr>
                    {open && g.verbas.map((v, i) => (
                      <tr key={g.key + i}>
                        <td style={S.sub2} colSpan={2}><span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{v.verba_cod}</span> {v.verba_desc}</td>
                        <td style={{ ...S.td, fontSize: 11.5, color: 'var(--muted)' }}>{v.tipo_verba}</td>
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
