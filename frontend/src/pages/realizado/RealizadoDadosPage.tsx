import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { Upload, Download, FileDown, AlertCircle, RefreshCw } from 'lucide-react'

declare const XLSX: any

type Empresa = { id: string; codigo: string; descricao: string }

const ANOS = [2024, 2025, 2026, 2027, 2028]
const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Colunas do modelo de importação (razão / lançamentos)
const HEADERS = ['empresa_codigo', 'filial_codigo', 'cc_codigo', 'conta_codigo', 'data', 'ano', 'mes', 'documento', 'historico', 'debito', 'credito']
const EXEMPLO = [
  ['01', '2001', '111', '3.1.01.001', '15/01/2026', '', '', 'NF 123', 'Energia elétrica', 1500, 0],
  ['01', '2001', '', '4.1.01.001', '20/01/2026', '', '', 'NF 456', 'Receita de serviços', 0, 28000],
]

const S: Record<string, CSSProperties> = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' },
  header:  { marginBottom: 16 },
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 },
  sub:     { fontSize: 13, color: '#868e96', margin: '4px 0 0' },
  bar:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  sel:     { padding: '6px 10px', fontSize: 13, border: '1px solid #dee2e6', borderRadius: 6, background: 'white', color: '#495057' },
  spacer:  { flex: 1 },
  btn:     { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 6, cursor: 'pointer' },
  card:    { background: 'white', borderRadius: 10, border: '1px solid #e9ecef', overflow: 'hidden' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', padding: '9px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef', position: 'sticky', top: 0 },
  thR:     { textAlign: 'right', padding: '9px 12px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td:      { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', whiteSpace: 'nowrap' },
  tdR:     { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', textAlign: 'right' },
  mono:    { fontFamily: 'monospace', fontSize: 12, color: '#868e96' },
  empty:   { padding: '40px 24px', textAlign: 'center', color: '#aaa', fontSize: 13 },
  erro:    { display: 'flex', alignItems: 'center', gap: 8, background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#c92a2a', fontSize: 13 },
  info:    { display: 'flex', alignItems: 'center', gap: 8, background: '#e7f5ff', border: '1px solid #a5d8ff', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#1971c2', fontSize: 13 },
}

function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Realizado')
  XLSX.writeFile(wb, filename)
}
// Colunas que esperamos encontrar no cabeçalho (para detectar a linha de header)
const HEADER_HINTS = ['conta', 'debito', 'débito', 'credito', 'crédito', 'empresa', 'filial', 'historico', 'histórico', 'data', 'ano', 'mes', 'mês', 'cc', 'documento', 'valor']

// Converte uma aba em objetos, detectando a linha de cabeçalho (pula títulos acima dela)
function objectsFromSheet(ws: any): any[] {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as any[][]
  if (!aoa.length) return []
  const isHint = (s: string) => HEADER_HINTS.some(h => s.includes(h))
  let hr = -1
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const cells = (aoa[i] || []).map(c => String(c).trim().toLowerCase())
    const nonEmpty = cells.filter(Boolean).length
    if (nonEmpty >= 2 && cells.some(isHint)) { hr = i; break }
  }
  if (hr < 0) for (let i = 0; i < aoa.length; i++) { if ((aoa[i] || []).filter(c => String(c).trim()).length >= 2) { hr = i; break } }
  if (hr < 0) return []
  const headers = (aoa[hr] || []).map(c => String(c).trim())
  const out: any[] = []
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i] || []
    if (!row.some(c => String(c).trim() !== '')) continue
    const obj: any = {}
    headers.forEach((h, j) => { if (h) obj[h] = row[j] })
    out.push(obj)
  }
  return out
}

function readWorkbook(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = new Uint8Array(e.target?.result as ArrayBuffer)
        resolve(XLSX.read(buf, { type: 'array', cellDates: true, dense: true }))
      } catch (err) { reject(err) }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo (muito grande?). Tente dividir por mês.'))
    reader.readAsArrayBuffer(file)
  })
}

// Varre TODAS as abas e escolhe a que tem mais linhas de dados
async function parseXlsx(file: File): Promise<{ rows: any[]; sheet: string; sheets: string[] }> {
  const wb = await readWorkbook(file)
  const sheets: string[] = wb.SheetNames || []
  let best: any[] = [], bestName = ''
  for (const name of sheets) {
    const objs = objectsFromSheet(wb.Sheets[name])
    if (objs.length > best.length) { best = objs; bestName = name }
  }
  return { rows: best, sheet: bestName, sheets }
}
function rawCol(row: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return ''
}
function txt(row: any, ...keys: string[]): string {
  const v = rawCol(row, ...keys)
  return v === '' ? '' : String(v).trim()
}
function num(v: any): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  return parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0
}
// Competência: usa colunas ano+mes, senão deriva de uma data (Date, serial Excel ou texto dd/mm/aaaa).
function competencia(row: any): { ano: number; mes: number; dataISO: string | null } | null {
  const anoC = parseInt(txt(row, 'ano', 'ANO'), 10)
  const mesC = parseInt(txt(row, 'mes', 'MES'), 10)
  const raw = rawCol(row, 'data', 'Data', 'competencia', 'Competência', 'dt', 'DT')
  let d: Date | null = null
  if (raw instanceof Date) d = raw
  else if (typeof raw === 'number') d = new Date(Math.round((raw - 25569) * 86400 * 1000))
  else if (typeof raw === 'string') {
    let m = raw.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (m) { const yy = m[3].length === 2 ? 2000 + +m[3] : +m[3]; d = new Date(yy, +m[2] - 1, +m[1]) }
    else { m = raw.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if (m) d = new Date(+m[1], +m[2] - 1, +m[3]) }
  }
  const ano = anoC || (d ? d.getFullYear() : 0)
  const mes = mesC || (d ? d.getMonth() + 1 : 0)
  if (!ano || !mes || mes < 1 || mes > 12) return null
  const dataISO = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
  return { ano, mes, dataISO }
}

export default function RealizadoDadosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [ano, setAno] = useState(2026)
  const [mes, setMes] = useState(0) // 0 = todos
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [modo, setModo] = useState<'add' | 'full'>('add')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => {
      setEmpresas(r.data || []); if (r.data?.length) setEmpresaId(p => p || r.data![0].id)
    })
  }, [])

  const load = async () => {
    if (!empresaId) { setRows([]); return }
    setLoading(true); setErro(null)
    let q = supabase.from('fat_realizado')
      .select('id,ano,mes,data,documento,historico,debito,credito,dc,valor,origem, conta_contabil(codigo,descricao, plano_contas(codigo)), filial(codigo), centro_custo(codigo)')
      .eq('empresa_id', empresaId).eq('ano', ano)
      .order('mes').order('data', { nullsFirst: true }).limit(2000)
    if (mes) q = q.eq('mes', mes)
    const { data, error } = await q
    if (error) setErro(error.message)
    else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [empresaId, ano, mes]) // eslint-disable-line

  const exportar = () => {
    const empCod = empresas.find(e => e.id === empresaId)?.codigo || ''
    const aoa = [HEADERS, ...rows.map(r => [
      empCod, r.filial?.codigo || '', r.centro_custo?.codigo || '', r.conta_contabil?.codigo || '',
      r.data || '', r.ano, r.mes, r.documento || '', r.historico || '',
      r.debito ?? '', r.credito ?? '',
    ])]
    downloadSheet('realizado.xlsx', aoa)
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      setInfo('Lendo arquivo…')
      const { rows: raw, sheets } = await parseXlsx(file)
      if (!raw.length) {
        setErro(`Não encontrei linhas de dados no arquivo. Abas lidas: ${sheets.join(', ') || '(nenhuma)'}. Verifique se há uma aba com cabeçalho contendo colunas como conta_codigo, debito, credito (veja "Baixar modelo").`)
        setInfo(null); return
      }
      setInfo(`${raw.length.toLocaleString('pt-BR')} linhas lidas. Processando…`)
      if (raw.length > 200000 && !confirm(`O arquivo tem ${raw.length.toLocaleString('pt-BR')} linhas. Volumes muito grandes podem travar o navegador e a gravação é lenta. Recomendo dividir por mês/empresa. Continuar mesmo assim?`)) { setInfo(null); return }

      const [{ data: contas }, { data: emps }, { data: fis }, { data: cc }] = await Promise.all([
        supabase.from('conta_contabil').select('id,codigo,plano_id'),
        supabase.from('empresa').select('id,codigo,plano_id'),
        supabase.from('filial').select('id,codigo'),
        supabase.from('centro_custo').select('id,codigo'),
      ])
      const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()
      // conta resolvida por (plano, código) — multi-ERP: o mesmo código pode existir em planos diferentes
      const contaMap: Record<string, string> = {}; (contas || []).forEach((c: any) => { contaMap[`${c.plano_id}|${norm(c.codigo)}`] = c.id })
      const empMap: Record<string, string> = {}; (emps || []).forEach((e: any) => { empMap[norm(e.codigo)] = e.id })
      const empPlano: Record<string, string> = {}; (emps || []).forEach((e: any) => { empPlano[e.id] = e.plano_id })
      const filMap: Record<string, string> = {}; (fis || []).forEach((f: any) => { filMap[norm(f.codigo)] = f.id })
      const ccMap: Record<string, string> = {}; (cc || []).forEach((c: any) => { ccMap[norm(c.codigo)] = c.id })

      const empSelCod = empresas.find(e => e.id === empresaId)?.codigo || ''
      const inserts: any[] = []
      const anoSet = new Set<number>(), mesSet = new Set<number>(), empSet = new Set<string>()
      const comboEmp: Record<string, Set<string>> = {}   // `${ano}-${mes}` -> empresas (chaves exatas do arquivo)
      const faltaConta = new Set<string>(), faltaEmp = new Set<string>()
      let ignorados = 0, semData = 0

      for (const r of raw) {
        const contaCod = txt(r, 'conta_codigo', 'conta', 'CONTA', 'conta_contabil')
        const empCod = txt(r, 'empresa_codigo', 'empresa', 'EMPRESA') || empSelCod
        const empresa_id = empMap[norm(empCod)]
        const conta_id = empresa_id ? contaMap[`${empPlano[empresa_id]}|${norm(contaCod)}`] : undefined
        const comp = competencia(r)
        const deb = num(rawCol(r, 'debito', 'Débito', 'DEBITO'))
        const cre = num(rawCol(r, 'credito', 'Crédito', 'CREDITO'))
        if (!contaCod && !deb && !cre) { ignorados++; continue } // linha em branco
        if (!conta_id) { faltaConta.add(contaCod || '(vazio)'); ignorados++; continue }
        if (!empresa_id) { faltaEmp.add(empCod || '(vazio)'); ignorados++; continue }
        if (!comp) { semData++; ignorados++; continue }
        if (!deb && !cre) { ignorados++; continue }

        const filCod = txt(r, 'filial_codigo', 'filial', 'FILIAL')
        const ccCod = txt(r, 'cc_codigo', 'cc', 'centro_custo', 'CENTRO DE CUSTO')
        const valor = +(cre - deb).toFixed(2)
        inserts.push({
          tenant_id: TENANT_ID, linha_id: null, conta_id, empresa_id,
          filial_id: filCod ? (filMap[norm(filCod)] || null) : null,
          cc_id: ccCod ? (ccMap[norm(ccCod)] || null) : null,
          ano: comp.ano, mes: comp.mes, data: comp.dataISO,
          documento: txt(r, 'documento', 'doc', 'DOCUMENTO') || null,
          historico: txt(r, 'historico', 'Histórico', 'HISTORICO') || null,
          debito: deb || null, credito: cre || null, dc: cre >= deb ? 'C' : 'D',
          valor, dims: {}, origem: 'IMPORT',
        })
        anoSet.add(comp.ano); mesSet.add(comp.mes); empSet.add(empresa_id)
        const ck = `${comp.ano}-${comp.mes}`; (comboEmp[ck] ||= new Set()).add(empresa_id)
      }

      if (!inserts.length) {
        setErro(`Nenhuma linha válida. ${faltaConta.size ? `Contas não encontradas: ${[...faltaConta].slice(0, 10).join(', ')}. ` : ''}${faltaEmp.size ? `Empresas não encontradas: ${[...faltaEmp].slice(0, 10).join(', ')}. ` : ''}${semData ? `${semData} sem competência (data/ano/mês). ` : ''}`)
        setInfo(null); return
      }

      // Substituir (full load): apaga exatamente as chaves (empresa, ano, mês) do arquivo, mês a mês
      if (modo === 'full') {
        const combos = Object.keys(comboEmp)
        const resumo = combos.sort().map(c => `${c} (${comboEmp[c].size} empr.)`).join(', ')
        if (!confirm(`Substituir vai EXCLUIR o realizado já existente destas competências antes de inserir:\n\n${resumo}\n\nConfirmar?`)) { setInfo('Importação cancelada.'); return }
        for (const ck of combos) {
          const [a, m] = ck.split('-').map(Number)
          const { error: delErr } = await supabase.from('fat_realizado').delete()
            .eq('ano', a).eq('mes', m).in('empresa_id', [...comboEmp[ck]])
          if (delErr) throw delErr
        }
      }

      const LOTE = 1000
      for (let i = 0; i < inserts.length; i += LOTE) {
        const { error } = await supabase.from('fat_realizado').insert(inserts.slice(i, i + LOTE))
        if (error) throw new Error(`Falha no lote ${Math.floor(i / LOTE) + 1} (linha ~${i}): ${error.message}`)
        setInfo(`Gravando… ${Math.min(i + LOTE, inserts.length).toLocaleString('pt-BR')} / ${inserts.length.toLocaleString('pt-BR')}`)
      }

      const avisos: string[] = []
      if (faltaConta.size) avisos.push(`${faltaConta.size} conta(s) não encontrada(s): ${[...faltaConta].slice(0, 8).join(', ')}`)
      if (faltaEmp.size) avisos.push(`${faltaEmp.size} empresa(s) não encontrada(s): ${[...faltaEmp].slice(0, 8).join(', ')}`)
      if (semData) avisos.push(`${semData} sem competência`)
      setInfo(`${inserts.length} lançamento(s) importado(s)${modo === 'full' ? ' (escopo substituído)' : ''}${ignorados ? `, ${ignorados} ignorado(s)` : ''}.${avisos.length ? ' ⚠ ' + avisos.join(' · ') : ''}`)
      load()
    } catch (e: any) { setErro(e?.message ?? JSON.stringify(e)); setInfo(null) }
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.title}>Realizado — dados (fato)</h1>
        <p style={S.sub}>Lançamentos do realizado (fat_realizado), grão de razão. A conta contábil é resolvida para a linha do relatório pelo DE-PARA (conta → linha). Valor = crédito − débito; o sinal final na linha vem do conta_linha (+/−).</p>
      </div>

      <div style={S.bar}>
        <select style={S.sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
          <option value="">— Empresa —</option>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}
        </select>
        <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>
          {ANOS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select style={S.sel} value={mes} onChange={e => setMes(Number(e.target.value))}>
          <option value={0}>Todos os meses</option>
          {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <div style={S.spacer} />
        <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as 'add' | 'full')} title="Modo de importação">
          <option value="add">Adicionar</option>
          <option value="full">Substituir (escopo do arquivo)</option>
        </select>
        <button style={S.btn} onClick={exportar}><FileDown size={13} /> Exportar</button>
        <button style={S.btn} onClick={() => downloadSheet('modelo_realizado.xlsx', [HEADERS, ...EXEMPLO])}><Download size={13} /> Baixar modelo</button>
        <button style={S.btn} onClick={() => fileRef.current?.click()}><Upload size={13} /> Importar Excel</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { importar(f); e.target.value = '' } }} />
      </div>

      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.thR}>Mês</th>
            <th style={S.th}>Data</th>
            <th style={S.th}>Plano</th>
            <th style={S.th}>Conta</th>
            <th style={S.th}>Descrição conta</th>
            <th style={S.th}>Filial</th>
            <th style={S.th}>CC</th>
            <th style={S.th}>Documento</th>
            <th style={S.th}>Histórico</th>
            <th style={S.thR}>Débito</th>
            <th style={S.thR}>Crédito</th>
            <th style={S.thR}>Valor</th>
            <th style={S.th}>Origem</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={13} style={S.empty}>Carregando...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={13} style={S.empty}>Nenhum lançamento para os filtros selecionados.<br /><small>Use "Importar Excel" com o razão (débito/crédito).</small></td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.id}>
                <td style={S.tdR}>{MESES[r.mes]}</td>
                <td style={S.td}>{r.data ? String(r.data).split('-').reverse().join('/') : '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: '#1971c2' }}>{r.conta_contabil?.plano_contas?.codigo || '—'}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.conta_contabil?.codigo || '—'}</td>
                <td style={S.td}>{r.conta_contabil?.descricao || ''}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.filial?.codigo || '—'}</td>
                <td style={{ ...S.td, ...S.mono }}>{r.centro_custo?.codigo || '—'}</td>
                <td style={S.td}>{r.documento || '—'}</td>
                <td style={S.td}>{r.historico || '—'}</td>
                <td style={S.tdR}>{r.debito != null ? Number(r.debito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={S.tdR}>{r.credito != null ? Number(r.credito).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                <td style={{ ...S.tdR, fontWeight: 600, color: Number(r.valor) < 0 ? '#e03131' : '#2f9e44' }}>{Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td style={{ ...S.td, fontSize: 11, color: r.origem === 'ERP' ? '#0c8599' : r.origem === 'IMPORT' ? '#e67700' : '#868e96' }}>{r.origem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 2000 && <p style={S.sub}>Mostrando os primeiros 2000 lançamentos. Use os filtros (mês) para refinar.</p>}
    </div>
  )
}
