import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { Upload, Download, FileDown, AlertCircle, RefreshCw } from 'lucide-react'

declare const XLSX: any

type Empresa = { id: string; codigo: string; descricao: string }
type Versao  = { id: string; codigo: string }

const ANOS = [2024, 2025, 2026, 2027, 2028]
const HEADERS = ['conta_orc_codigo', 'empresa_codigo', 'versao_codigo', 'ano', 'mes', 'valor']
const EXEMPLO = ['11011002', '01', 'ORCADO_2026', 2026, 1, 15000]

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
  td:      { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40' },
  tdR:     { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40', textAlign: 'right' },
  mono:    { fontFamily: 'monospace', fontSize: 12, color: '#868e96' },
  empty:   { padding: '40px 24px', textAlign: 'center', color: '#aaa', fontSize: 13 },
  erro:    { display: 'flex', alignItems: 'center', gap: 8, background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#c92a2a', fontSize: 13 },
  info:    { display: 'flex', alignItems: 'center', gap: 8, background: '#e7f5ff', border: '1px solid #a5d8ff', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#1971c2', fontSize: 13 },
}

const MESES = ['', 'Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function downloadSheet(filename: string, aoa: any[][]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orcado')
  XLSX.writeFile(wb, filename)
}
function parseXlsx(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[])
      } catch (err) { reject(err) }
    }
    reader.readAsBinaryString(file)
  })
}
function col(row: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v !== undefined && v !== null && v !== '') return String(v).trim()
  }
  return ''
}

export default function OrcadoDadosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [versoes, setVersoes]   = useState<Versao[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [versaoId, setVersaoId]   = useState('')
  const [ano, setAno] = useState(2026)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => {
      setEmpresas(r.data || []); if (r.data?.length) setEmpresaId(p => p || r.data![0].id)
    })
    supabase.from('versao_orcamento').select('id,codigo').order('codigo').then(r => {
      setVersoes(r.data || []); if (r.data?.length) setVersaoId(p => p || r.data![0].id)
    })
  }, [])

  const load = async () => {
    if (!empresaId || !versaoId) { setRows([]); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.from('fat_orcado')
      .select('id,ano,mes,valor,expressao,origem, conta_orcamentaria(codigo,descricao), versao_orcamento(codigo)')
      .eq('empresa_id', empresaId).eq('versao_id', versaoId).eq('ano', ano)
      .order('mes')
    if (error) setErro(error.message)
    else setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [empresaId, versaoId, ano]) // eslint-disable-line

  const exportar = () => {
    const aoa = [HEADERS, ...rows.map(r => [
      r.conta_orcamentaria?.codigo || '',
      empresas.find(e => e.id === empresaId)?.codigo || '', r.versao_orcamento?.codigo || '',
      r.ano, r.mes, r.expressao || r.valor,
    ])]
    downloadSheet('orcado.xlsx', aoa)
  }

  const importar = async (file: File) => {
    setErro(null); setInfo('Importando...')
    try {
      const raw = await parseXlsx(file)
      if (!raw.length) { setErro('Arquivo vazio'); setInfo(null); return }

      // Mapas de resolução (F2: linha resolve na estrutura compartilhada por código)
      const [{ data: ls }, { data: emps }, { data: vers }] = await Promise.all([
        supabase.from('conta_orcamentaria').select('id,codigo'),
        supabase.from('empresa').select('id,codigo'),
        supabase.from('versao_orcamento').select('id,codigo'),
      ])
      const linhaMap: Record<string, string> = {}
      ;(ls || []).forEach((l: any) => { linhaMap[String(l.codigo)] = l.id })
      const empMap: Record<string, string> = {}; (emps || []).forEach((e: any) => { empMap[e.codigo] = e.id })
      const verMap: Record<string, string> = {}; (vers || []).forEach((v: any) => { verMap[v.codigo] = v.id })

      let ok = 0, ignorados = 0
      for (const r of raw) {
        const linCod = col(r, 'conta_orc_codigo', 'conta_orcamentaria', 'linha_codigo', 'linha', 'LINHA')
        const empCod = col(r, 'empresa_codigo', 'empresa', 'EMPRESA')
        const verCod = col(r, 'versao_codigo', 'versao', 'VERSAO')
        const anoV = parseInt(col(r, 'ano', 'ANO'), 10)
        const mesV = parseInt(col(r, 'mes', 'MES'), 10)
        const valTxt = col(r, 'valor', 'VALOR')
        const linha_id = linhaMap[String(linCod)]
        const empresa_id = empMap[empCod]
        const versao_id = verMap[verCod]
        if (!linha_id || !empresa_id || !versao_id || !anoV || !mesV || mesV < 1 || mesV > 12 || !valTxt) { ignorados++; continue }
        const isFormula = valTxt.startsWith('=')
        const valor = isFormula ? null : (parseFloat(valTxt.replace(/\./g, '').replace(',', '.')) || 0)
        const expressao = isFormula ? valTxt : null

        const { data: ex } = await supabase.from('fat_orcado').select('id')
          .eq('versao_id', versao_id).eq('linha_id', linha_id).eq('empresa_id', empresa_id)
          .eq('ano', anoV).eq('mes', mesV).is('filial_id', null).is('cc_id', null).maybeSingle()
        if (ex) { const { error } = await supabase.from('fat_orcado').update({ valor, expressao, origem: 'MANUAL' }).eq('id', ex.id); if (error) throw error }
        else { const { error } = await supabase.from('fat_orcado').insert({
          tenant_id: TENANT_ID, versao_id, linha_id, empresa_id, filial_id: null, cc_id: null,
          ano: anoV, mes: mesV, valor, expressao, origem: 'MANUAL', dims: {},
        }); if (error) throw error }
        ok++
      }
      setInfo(`${ok} lançamentos importados${ignorados ? `, ${ignorados} ignorados (códigos não encontrados)` : ''}.`)
      load()
    } catch (e: any) { setErro(e?.message ?? JSON.stringify(e)); setInfo(null) }
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.title}>Orçamento — dados (fato)</h1>
        <p style={S.sub}>Lançamentos do orçado (fat_orcado). Visualize, exporte e importe de planilha.</p>
      </div>

      <div style={S.bar}>
        <select style={S.sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
          <option value="">— Empresa —</option>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}
        </select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
          <option value="">— Versão —</option>
          {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
        </select>
        <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>
          {ANOS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <div style={S.spacer} />
        <button style={S.btn} onClick={exportar}><FileDown size={13} /> Exportar</button>
        <button style={S.btn} onClick={() => downloadSheet('modelo_orcado.xlsx', [HEADERS, EXEMPLO])}><Download size={13} /> Baixar modelo</button>
        <button style={S.btn} onClick={() => fileRef.current?.click()}><Upload size={13} /> Importar Excel</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { importar(f); e.target.value = '' } }} />
      </div>

      {erro && <div style={S.erro}><AlertCircle size={15} />{erro}</div>}
      {info && <div style={S.info}>{info}</div>}

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Conta Orçamentária</th>
            <th style={S.th}>Descrição</th>
            <th style={S.thR}>Mês</th>
            <th style={S.thR}>Valor</th>
            <th style={S.th}>Fórmula</th>
            <th style={S.th}>Origem</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={S.empty}>Carregando...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} style={S.empty}>Nenhum lançamento para os filtros selecionados.<br /><small>Lance valores no relatório ou use "Importar Excel".</small></td></tr>}
            {!loading && rows.map(r => (
              <tr key={r.id}>
                <td style={{ ...S.td, ...S.mono }}>{r.conta_orcamentaria?.codigo}</td>
                <td style={S.td}>{r.conta_orcamentaria?.descricao}</td>
                <td style={S.tdR}>{MESES[r.mes]}</td>
                <td style={S.tdR}>{r.valor != null ? Number(r.valor).toLocaleString('pt-BR') : '—'}</td>
                <td style={{ ...S.td, ...S.mono, color: r.expressao ? '#6741d9' : '#ced4da' }}>{r.expressao || '—'}</td>
                <td style={{ ...S.td, fontSize: 11, color: r.origem === 'FORMULARIO' ? '#0c8599' : r.origem === 'IMPORT' ? '#e67700' : '#868e96' }}>{r.origem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
