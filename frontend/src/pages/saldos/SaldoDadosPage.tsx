import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { Upload, FileDown, AlertCircle, RefreshCw } from 'lucide-react'

declare const XLSX: any

type Empresa = { id: string; codigo: string; descricao: string }
const ANOS = [2024, 2025, 2026, 2027, 2028]
const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const HEADERS = ['empresa_codigo', 'filial_codigo', 'conta_codigo', 'ano', 'mes', 'saldo']
const EXEMPLO = [['01', '2001', '1.01.01.001', 2026, 1, 125000], ['01', '2001', '2.01.01.001', 2026, 1, -48000]]
const HEADER_HINTS = ['empresa', 'filial', 'conta', 'saldo', 'ano', 'mes', 'mês', 'data', 'periodo', 'período']

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:   { fontSize: 13, color: '#868e96', margin: '4px 0 16px' },
  bar:   { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  sel:   { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  btn:   { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  card:  { background: 'white', borderRadius: 10, border: '1px solid #e9ecef', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '9px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  thR:   { textAlign: 'right', padding: '9px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td:    { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', whiteSpace: 'nowrap' },
  tdR:   { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', textAlign: 'right' },
  mono:  { fontFamily: 'monospace', fontSize: 12, color: '#868e96' },
  empty: { padding: '40px 24px', textAlign: 'center', color: '#aaa', fontSize: 13 },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#c92a2a', fontSize: 13 },
  info:  { display: 'flex', alignItems: 'center', gap: 8, background: '#e7f5ff', border: '1px solid #a5d8ff', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#1971c2', fontSize: 13 },
}

const norm = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
function parseNum(v: any): number {
  if (typeof v === 'number') return v
  let s = String(v ?? '').trim(); if (!s) return 0
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-') || s.startsWith('−')
  s = s.replace(/[()]/g, '').replace(/[−-]/g, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = parseFloat(s) || 0
  return neg ? -n : n
}
function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Saldos'); XLSX.writeFile(wb, filename)
}
function readWorkbook(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => { try { resolve(XLSX.read(new Uint8Array(e.target?.result as ArrayBuffer), { type: 'array', dense: true, cellDates: true })) } catch (err) { reject(err) } }
    reader.onerror = reject; reader.readAsArrayBuffer(file)
  })
}
function objectsFromSheet(ws: any): any[] {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as any[][]
  if (!aoa.length) return []
  const isHint = (s: string) => HEADER_HINTS.some(h => s.includes(h))
  let hr = -1
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const cells = (aoa[i] || []).map(c => String(c).trim().toLowerCase())
    if (cells.filter(Boolean).length >= 2 && cells.some(isHint)) { hr = i; break }
  }
  if (hr < 0) hr = 0
  const head = (aoa[hr] || []).map(c => String(c).trim())
  return aoa.slice(hr + 1).map(row => { const o: any = {}; head.forEach((h, i) => { if (h) o[h] = row[i] }); return o })
}
const txt = (r: any, ...ks: string[]) => { for (const k of ks) { const v = r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()]; if (v !== undefined && v !== '') return String(v).trim() } return '' }
function competencia(r: any): { ano: number; mes: number } | null {
  const a = parseInt(txt(r, 'ano', 'Ano', 'exercicio', 'exercício') || '0', 10)
  const m = parseInt(txt(r, 'mes', 'mês', 'Mes', 'Mês') || '0', 10)
  if (a && m >= 1 && m <= 12) return { ano: a, mes: m }
  const d = r['data'] ?? r['Data'] ?? r['competencia'] ?? r['Competência'] ?? r['periodo'] ?? r['período']
  if (d instanceof Date) return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
  const s = String(d ?? '').trim()
  let mm
  if ((mm = s.match(/^(\d{1,2})[\/.\-](\d{4})$/))) return { ano: +mm[2], mes: +mm[1] }            // mm/aaaa
  if ((mm = s.match(/^(\d{4})[\/.\-](\d{1,2})/))) return { ano: +mm[1], mes: +mm[2] }              // aaaa-mm
  if ((mm = s.match(/^\d{1,2}[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return { ano: +mm[2], mes: +mm[1] } // dd/mm/aaaa
  return null
}

export default function SaldoDadosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empId, setEmpId] = useState('')
  const [ano, setAno] = useState(2026)
  const [mes, setMes] = useState(0)   // 0 = todos
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [modo, setModo] = useState<'add' | 'full'>('add')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || [])) }, [])

  const loadView = async () => {
    setLoading(true); setErro(null)
    let q = supabase.from('fat_saldo').select('id,ano,mes,saldo,origem, conta_contabil(codigo,descricao, plano_contas(codigo)), empresa(codigo), filial(codigo)').eq('ano', ano).order('mes').limit(3000)
    if (empId) q = q.eq('empresa_id', empId)
    if (mes) q = q.eq('mes', mes)
    const { data, error } = await q
    if (error) setErro(error.message); else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { loadView() }, [empId, ano, mes]) // eslint-disable-line

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) await importar(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  const importar = async (file: File) => {
    setLoading(true); setErro(null); setInfo(null)
    try {
      const wb = await readWorkbook(file)
      let recs: any[] = []
      for (const sn of wb.SheetNames) { const r = objectsFromSheet(wb.Sheets[sn]); if (r.length > recs.length) recs = r }
      if (!recs.length) { setErro('Arquivo vazio ou sem cabeçalho reconhecível (esperado: empresa_codigo, conta_codigo, ano, mes, saldo).'); setLoading(false); return }

      const [{ data: contas }, { data: emps }, { data: fis }] = await Promise.all([
        supabase.from('conta_contabil').select('id,codigo,plano_id'),
        supabase.from('empresa').select('id,codigo,plano_id'),
        supabase.from('filial').select('id,codigo'),
      ])
      const contaMap: Record<string, string> = {}; (contas || []).forEach((c: any) => { contaMap[`${c.plano_id}|${norm(c.codigo)}`] = c.id })
      const empMap: Record<string, string> = {}; (emps || []).forEach((e: any) => { empMap[norm(e.codigo)] = e.id })
      const empPlano: Record<string, string> = {}; (emps || []).forEach((e: any) => { empPlano[e.id] = e.plano_id })
      const filMap: Record<string, string> = {}; (fis || []).forEach((f: any) => { filMap[norm(f.codigo)] = f.id })

      const agg = new Map<string, any>()
      const comboEmp: Record<string, Set<string>> = {}   // `${ano}-${mes}` -> empresas (chaves do arquivo)
      let semEmp = 0, semConta = 0, semComp = 0
      const faltEmp = new Set<string>(), faltConta = new Set<string>(), faltFil = new Set<string>()
      for (const r of recs) {
        const empCod = txt(r, 'empresa_codigo', 'empresa', 'EMPRESA')
        const filCod = txt(r, 'filial_codigo', 'filial', 'FILIAL')
        const contaCod = txt(r, 'conta_codigo', 'conta', 'CONTA', 'conta_contabil')
        const empresa_id = empMap[norm(empCod)]
        if (!empresa_id) { semEmp++; if (empCod) faltEmp.add(empCod); continue }
        const conta_id = contaMap[`${empPlano[empresa_id]}|${norm(contaCod)}`]
        if (!conta_id) { semConta++; if (contaCod) faltConta.add(contaCod); continue }
        const filial_id = filCod ? (filMap[norm(filCod)] || null) : null
        if (filCod && !filial_id) faltFil.add(filCod)
        const comp = competencia(r); if (!comp) { semComp++; continue }
        const saldo = parseNum(r['saldo'] ?? r['Saldo'] ?? r['saldo_atual'] ?? r['Saldo Atual'])
        const key = `${conta_id}|${empresa_id}|${filial_id || ''}|${comp.ano}|${comp.mes}`
        agg.set(key, { tenant_id: TENANT_ID, conta_id, empresa_id, filial_id, ano: comp.ano, mes: comp.mes, saldo, origem: 'IMPORT' })
        ;(comboEmp[`${comp.ano}-${comp.mes}`] ||= new Set()).add(empresa_id)
      }
      const lista = [...agg.values()]
      if (!lista.length) { setErro(`Nenhum saldo válido. ${semEmp} sem empresa, ${semConta} sem conta, ${semComp} sem competência.`); setLoading(false); return }

      // Substituir (full load): apaga as competências (empresa, ano, mês) do arquivo antes de inserir
      if (modo === 'full') {
        const combos = Object.keys(comboEmp).sort()
        const resumo = combos.map(c => `${c} (${comboEmp[c].size} empr.)`).join(', ')
        if (!confirm(`Substituir vai EXCLUIR os saldos já existentes destas competências antes de inserir:\n\n${resumo}\n\nConfirmar?`)) { setInfo('Importação cancelada.'); setLoading(false); return }
        for (const ck of combos) {
          const [a, m] = ck.split('-').map(Number)
          const { error: delErr } = await supabase.from('fat_saldo').delete().eq('ano', a).eq('mes', m).in('empresa_id', [...comboEmp[ck]])
          if (delErr) throw delErr
        }
      }
      const LOTE = 1000
      for (let i = 0; i < lista.length; i += LOTE) {
        const { error } = await supabase.from('fat_saldo').upsert(lista.slice(i, i + LOTE), { onConflict: 'tenant_id,conta_id,empresa_id,filial_id,ano,mes' })
        if (error) throw error
        setInfo(`Importando… ${Math.min(i + LOTE, lista.length)}/${lista.length}`)
      }
      const rej = semEmp + semConta + semComp
      setInfo(`${lista.length} saldos importados${rej ? ` · ${rej} ignorados` : ''}.`
        + (faltEmp.size ? ` Empresas não encontradas: ${[...faltEmp].slice(0, 8).join(', ')}.` : '')
        + (faltConta.size ? ` Contas não encontradas: ${[...faltConta].slice(0, 8).join(', ')}.` : ''))
      loadView()
    } catch (e: any) { setErro('Erro ao importar: ' + (e?.message ?? JSON.stringify(e))) }
    setLoading(false)
  }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Saldos (Balancete)</h1>
      <p style={S.sub}>Saldo final por conta contábil e mês — usado pelo Balanço. Reimportar o mesmo mês substitui o saldo (upsert).</p>

      <div style={S.bar}>
        <select style={S.sel} value={empId} onChange={e => setEmpId(e.target.value)}><option value="">Todas empresas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}</select>
        <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>{ANOS.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select style={S.sel} value={mes} onChange={e => setMes(Number(e.target.value))}><option value={0}>Todos meses</option>{MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => downloadSheet('modelo_saldos.xlsx', [HEADERS, ...EXEMPLO])}><FileDown size={14} /> Modelo</button>
        <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as 'add' | 'full')} title="Modo de importação">
          <option value="add">Adicionar/atualizar</option>
          <option value="full">Substituir (escopo do arquivo)</option>
        </select>
        <button style={S.btn} onClick={() => fileRef.current?.click()}><Upload size={14} /> Importar balancete</button>
        <button style={S.btn} onClick={loadView}><RefreshCw size={13} /></button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
      </div>

      {erro && <div style={S.erro}><AlertCircle size={15} /> {erro}</div>}
      {info && <div style={S.info}><AlertCircle size={15} /> {info}</div>}

      <div style={S.card}>
        <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Plano</th><th style={S.th}>Conta</th><th style={S.th}>Descrição</th><th style={S.th}>Empresa</th><th style={S.th}>Filial</th>
              <th style={S.th}>Ano</th><th style={S.th}>Mês</th><th style={S.thR}>Saldo</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ ...S.td, fontSize: 11, color: '#1971c2' }}>{r.conta_contabil?.plano_contas?.codigo || '—'}</td>
                  <td style={{ ...S.td, ...S.mono }}>{r.conta_contabil?.codigo || '—'}</td>
                  <td style={S.td}>{r.conta_contabil?.descricao || ''}</td>
                  <td style={S.td}>{r.empresa?.codigo || '—'}</td>
                  <td style={S.td}>{r.filial?.codigo || '—'}</td>
                  <td style={S.td}>{r.ano}</td>
                  <td style={S.td}>{MESES[r.mes] || r.mes}</td>
                  <td style={{ ...S.tdR, color: (r.saldo || 0) < 0 ? '#e03131' : '#343a40' }}>{(Number(r.saldo) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={S.empty}>{loading ? 'Carregando…' : 'Nenhum saldo. Importe um balancete.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
