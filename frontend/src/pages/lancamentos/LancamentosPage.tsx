import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const fmt = (v: number) =>
  v === 0 ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

async function downloadXlsx(filename: string, headers: string[], rows: Record<string, string | number>[]) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [Object.fromEntries(headers.map((h: string) => [h, '']))], { header: headers })
  ws['!cols'] = headers.map((h: string) => ({ wch: Math.max(h.length + 4, ...rows.map(r => String(r[h] ?? '').length + 2)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Lançamentos')
  XLSX.writeFile(wb, filename)
}

const parseNumero = (raw: any): number => {
  if (typeof raw === 'number') return raw
  const s = String(raw).trim()
  if (!s) return 0
  // Formato BR com separador de milhar: 1.500,75 → remove pontos, troca vírgula por ponto
  if (s.includes(',') && s.includes('.')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
  // Formato BR sem milhar: 1500,75 → troca vírgula por ponto
  if (s.includes(',')) return parseFloat(s.replace(',', '.')) || 0
  // Formato EN ou inteiro: 1500.75 / 1500 → usa direto
  return parseFloat(s.replace(/[^\d.]/g, '')) || 0
}

const parseMes = (raw: string | number): number => {
  if (typeof raw === 'number') return raw >= 1 && raw <= 12 ? raw : 0
  const idx = MESES.findIndex(m => m.toLowerCase() === String(raw).toLowerCase())
  if (idx >= 0) return idx + 1
  const n = parseInt(String(raw))
  return n >= 1 && n <= 12 ? n : 0
}

// ── Tipos ─────────────────────────────────────────────────
type Grupo     = { id: string; codigo: string; descricao: string }
type Empresa   = { id: string; codigo: string; descricao: string; grupo_id: string | null }
type Filial    = { id: string; codigo: string; descricao: string; empresa_id: string }
type Versao    = { id: string; codigo: string }
type ItemOrc   = { id: string; codigo: string; descricao: string; aceita_lancamento: boolean; grupo_folha: boolean }
type Dimensao  = { id: string; codigo: string; label: string; tabela_ref: string | null }
type DimValor  = { id: string; label: string }

type Lancamento = {
  id: string
  versao_id: string; item_orc_id: string; empresa_id: string; filial_id: string | null
  ano: number; mes: number; valor: number
  tipo_lancamento: string; dim_values: Record<string, string>; historico: string | null
  empresa: any; filial: any; item: any; versao: any
}

// ── Estilos ───────────────────────────────────────────────
const S = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } as React.CSSProperties,
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as React.CSSProperties,
  sub:     { fontSize: 13, color: '#868e96', margin: '4px 0 0' } as React.CSSProperties,
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 } as React.CSSProperties,
  select:  { padding: '6px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, color: '#343a40', background: 'white' } as React.CSSProperties,
  btn: (v: 'primary' | 'secondary' | 'danger'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
    borderRadius: 6,
    border: v === 'secondary' ? '1px solid #dee2e6' : v === 'danger' ? '1px solid #ffc9c9' : 'none',
    background: v === 'primary' ? '#3b5bdb' : v === 'danger' ? '#fff5f5' : 'white',
    color: v === 'primary' ? 'white' : v === 'danger' ? '#c92a2a' : '#495057',
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  }),
  wrap:    { overflowX: 'auto' as const, borderRadius: 12, border: '1px solid #e9ecef', overflow: 'hidden' },
  table:   { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th:      { textAlign: 'left' as const, padding: '8px 12px', background: '#1e2d5a', color: 'white', fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap' as const },
  td:      { padding: '7px 12px', borderBottom: '1px solid #f1f3f5', verticalAlign: 'middle' as const },
  badge: (t: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 7px', borderRadius: 99, fontSize: 11, fontWeight: 500,
    background: t === 'ORCADO' ? '#e7f5ff' : t === 'REALIZADO' ? '#ebfbee' : '#f1f3f5',
    color:      t === 'ORCADO' ? '#1971c2' : t === 'REALIZADO' ? '#2f9e44' : '#495057',
  }),
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: 'white', borderRadius: 16, padding: 28, width: 580, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  label:   { display: 'block', fontSize: 13, fontWeight: 500, color: '#343a40', marginBottom: 4 } as React.CSSProperties,
  input:   { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, boxSizing: 'border-box' as const },
  row:     { marginBottom: 14 } as React.CSSProperties,
}

// ── Multi-select com checkboxes ───────────────────────────
function MultiSelectDropdown({ opcoes, selecionados, onChange, placeholder = 'Todas' }: {
  opcoes: { id: string; label: string }[]
  selecionados: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const todas = selecionados.length === 0
  const texto = todas
    ? placeholder
    : selecionados.length === 1
    ? (opcoes.find(o => o.id === selecionados[0])?.label.split(' — ')[0] ?? '1')
    : `${selecionados.length} selecionadas`

  const toggle = (id: string) =>
    onChange(selecionados.includes(id) ? selecionados.filter(x => x !== id) : [...selecionados, id])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ ...S.select, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 180 }}>
        <span style={{ flex: 1, textAlign: 'left' }}>{texto}</span>
        <span style={{ fontSize: 10, color: '#868e96' }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200, background: 'white', border: '1px solid #dee2e6', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 280, maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 600, borderBottom: '1px solid #f1f3f5', fontSize: 13, color: '#495057' }}>
            <input type="checkbox" checked={todas} onChange={() => onChange([])} />
            {placeholder}
          </label>
          {opcoes.map(opt => (
            <label key={opt.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, color: '#495057' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fa')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <input type="checkbox" checked={selecionados.includes(opt.id)} onChange={() => toggle(opt.id)} />
              <span style={{ flex: 1 }}>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Modal de importação ───────────────────────────────────
function ModalImportLancamentos({ versaoId, ano, itens, empresas, filiais, dimensoes, dimOpcoes, onImported, onClose }: {
  versaoId: string; ano: number
  itens: ItemOrc[]; empresas: Empresa[]; filiais: Filial[]
  dimensoes: Dimensao[]; dimOpcoes: Record<string, DimValor[]>
  onImported: () => void; onClose: () => void
}) {
  type PreviewRow = {
    item: ItemOrc; empresa: Empresa; filial: Filial | null
    ano: number; mes: number; tipo: string; valor: number; historico: string
    dim_values: Record<string, string>
    _erro?: string
  }

  const [preview,   setPreview]   = useState<PreviewRow[]>([])
  const [arquivos,  setArquivos]  = useState<string[]>([])
  const [dragOver,  setDragOver]  = useState(false)
  const [importing, setImporting] = useState(false)
  const [fullLoad,  setFullLoad]  = useState(false)
  const [erro,      setErro]      = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const itensByCode  = Object.fromEntries(itens.filter(x => x.aceita_lancamento).map(x => [x.codigo.trim(), x]))
  const empresaMap   = Object.fromEntries(empresas.map(e => [e.codigo.trim(), e]))
  const filialMap    = Object.fromEntries(filiais.map(f => [f.codigo.trim(), f]))

  // mapa reverso: dim.codigo → { codigoDoItem (uppercase) → id }
  const dimCodigoMap: Record<string, Record<string, string>> = {}
  for (const dim of dimensoes) {
    dimCodigoMap[dim.codigo] = {}
    for (const opc of dimOpcoes[dim.codigo] || []) {
      const cod = opc.label.split(' — ')[0].trim().toUpperCase()
      dimCodigoMap[dim.codigo][cod] = opc.id
    }
  }

  const downloadTemplate = async () => {
    const dimCols = dimensoes.map(d => d.label)
    const rows = itens.filter(x => x.aceita_lancamento).slice(0, 2).map(item => ({
      item_codigo: item.codigo, empresa: empresas[0]?.codigo || '',
      filial: '', ano, mes: 1, tipo: 'ORCADO', valor: 0, historico: '',
      ...Object.fromEntries(dimCols.map(d => [d, ''])),
    }))
    await downloadXlsx('template_lancamentos.xlsx',
      ['item_codigo', 'empresa', 'filial', 'ano', 'mes', 'tipo', 'valor', 'historico', ...dimCols],
      rows
    )
  }

  const parseFiles = async (files: FileList | File[]) => {
    setErro(''); setPreview([]); setArquivos([])
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const allRows: PreviewRow[] = []
    const nomes: string[] = []

    for (const file of Array.from(files)) {
      nomes.push(file.name)
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

      for (const [idx, r] of json.entries()) {
        const ref = `${file.name} L${idx + 2}`
        const itemCod = String(r['item_codigo'] || r['codigo'] || '').trim()
        const item = itensByCode[itemCod]
        if (!item) { allRows.push({ ...r, _erro: `${ref}: item "${itemCod}" não encontrado` } as any); continue }

        const emp = empresaMap[String(r['empresa'] || '').trim()]
        if (!emp) { allRows.push({ ...r, _erro: `${ref}: empresa "${r['empresa']}" não encontrada` } as any); continue }

        const filCod = String(r['filial'] || '').trim()
        const fil = filCod ? (filialMap[filCod] || null) : null

        const mes = parseMes(r['mes'])
        if (!mes) { allRows.push({ ...r, _erro: `${ref}: mês inválido "${r['mes']}"` } as any); continue }

        const anoRow = r['ano'] ? parseInt(String(r['ano'])) : ano
        if (!anoRow || anoRow < 2000 || anoRow > 2100) { allRows.push({ ...r, _erro: `${ref}: ano inválido "${r['ano']}"` } as any); continue }

        const tipo = String(r['tipo'] || 'ORCADO').toUpperCase().trim()
        if (!['ORCADO', 'REALIZADO'].includes(tipo)) { allRows.push({ ...r, _erro: `${ref}: tipo "${tipo}" inválido` } as any); continue }

        const dim_values: Record<string, string> = {}
        for (const dim of dimensoes) {
          const raw = String(r[dim.label] || r[dim.codigo] || '').trim()
          if (raw) { const id = dimCodigoMap[dim.codigo]?.[raw.toUpperCase()]; if (id) dim_values[dim.codigo] = id }
        }

        allRows.push({ item, empresa: emp, filial: fil, ano: anoRow, mes, tipo, valor: parseNumero(r['valor']), historico: String(r['historico'] || '').trim(), dim_values })
      }
    }

    setArquivos(nomes)
    setPreview(allRows)
  }

  const importar = async () => {
    const validas = preview.filter(p => !p._erro)
    if (!validas.length) return
    setImporting(true); setErro('')

    const raw = validas.map(({ item, empresa, filial, ano: anoRow, mes, tipo, valor, historico, dim_values }) => ({
      versao_id: versaoId, item_orc_id: item.id, empresa_id: empresa.id,
      filial_id: filial?.id || null, ano: anoRow, mes, tipo_lancamento: tipo,
      valor, dim_values, historico: historico || null,
    }))

    // Deduplica por chave completa incluindo dim_values — linhas com as mesmas dimensões
    // são somadas (duplicata real); dimensões diferentes ficam como linhas separadas.
    const dimKey = (dv: Record<string, string>) =>
      JSON.stringify(Object.fromEntries(Object.entries(dv).sort(([a], [b]) => a.localeCompare(b))))

    const grouped = new Map<string, typeof raw[0]>()
    for (const rec of raw) {
      const key = `${rec.item_orc_id}|${rec.empresa_id}|${rec.filial_id ?? ''}|${rec.ano}|${rec.mes}|${rec.tipo_lancamento}|${dimKey(rec.dim_values)}`
      if (grouped.has(key)) {
        grouped.get(key)!.valor += rec.valor
        if (rec.historico) grouped.get(key)!.historico = rec.historico
      } else {
        grouped.set(key, { ...rec, dim_values: { ...rec.dim_values } })
      }
    }
    const records = Array.from(grouped.values())

    if (fullLoad) {
      // Full load: exclui todos os registros existentes para o escopo desta importação
      const anosImport  = [...new Set(records.map(r => r.ano))]
      const empImport   = [...new Set(records.map(r => r.empresa_id))]
      const tiposImport = [...new Set(records.map(r => r.tipo_lancamento))]
      const { error: delErr } = await supabase.from('fat_lancamento')
        .delete()
        .eq('versao_id', versaoId)
        .in('ano', anosImport)
        .in('empresa_id', empImport)
        .in('tipo_lancamento', tiposImport)
      if (delErr) { setErro(delErr.message); setImporting(false); return }
    }

    const { error } = await supabase.from('fat_lancamento').upsert(records, {
      onConflict: 'tenant_id,versao_id,item_orc_id,empresa_id,filial_id,ano,mes,tipo_lancamento,dim_hash',
    })
    setImporting(false)
    if (error) { setErro(error.message); return }
    onImported(); onClose()
  }

  const validas   = preview.filter(p => !p._erro)
  const invalidas = preview.filter(p => p._erro)

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#212529', marginBottom: 8 }}>Importar lançamentos</div>
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 12, background: '#e7f5ff', color: '#1971c2', marginBottom: 12 }}>
          <strong>Colunas:</strong> <code>item_codigo</code> · <code>empresa</code> · <code>filial</code> · <code>ano</code> · <code>mes</code> (1–12) · <code>tipo</code> (ORCADO/REALIZADO) · <code>valor</code> · <code>historico</code>
          <br/>Se <code>ano</code> for omitido, usa o filtro ativo ({ano}) como padrão.
          {dimensoes.length > 0 && <> · {dimensoes.map(d => <code key={d.codigo} style={{ marginLeft: 4 }}>{d.label}</code>)}</>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button style={S.btn('secondary')} onClick={downloadTemplate}>⬇ Baixar template</button>
        </div>

        <div
          style={{ border: `2px dashed ${dragOver ? '#3b5bdb' : '#dee2e6'}`, borderRadius: 12, padding: 24, textAlign: 'center', background: dragOver ? '#edf2ff' : '#f8f9fa', cursor: 'pointer', marginBottom: arquivos.length ? 8 : 12 }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) parseFiles(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}>
          <div style={{ fontSize: 24, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 13, color: '#495057' }}>Arraste um ou mais arquivos .xlsx ou clique para selecionar</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) parseFiles(e.target.files) }} />
        </div>

        {arquivos.length > 0 && (
          <div style={{ fontSize: 12, color: '#495057', marginBottom: 12, padding: '6px 10px', background: '#f8f9fa', borderRadius: 6 }}>
            {arquivos.length === 1 ? '📎 ' : `📎 ${arquivos.length} arquivos: `}
            {arquivos.join(' · ')}
          </div>
        )}

        {invalidas.length > 0 && (
          <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, background: '#fff9db', color: '#e67700', marginBottom: 10 }}>
            ⚠️ {invalidas.length} linha(s) com erro serão ignoradas: {invalidas.slice(0, 3).map(p => (p as any)._erro).join(' · ')}{invalidas.length > 3 ? ` (+${invalidas.length - 3})` : ''}
          </div>
        )}
        {erro && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, background: '#fff5f5', color: '#c92a2a', marginBottom: 10 }}>{erro}</div>}

        {validas.length > 0 && (
          <div style={{ fontSize: 13, color: '#495057', marginBottom: 12 }}>
            <strong>{validas.length}</strong> lançamento(s) válidos · Total: <strong>{fmt(validas.reduce((s, p) => s + p.valor, 0))}</strong>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#495057', marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={fullLoad} onChange={e => setFullLoad(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            <strong>Full load</strong> — exclui todos os lançamentos existentes desta versão/ano/empresa antes de importar.
            <span style={{ display: 'block', fontSize: 11, color: '#868e96', marginTop: 2 }}>
              Use para reimportar do zero. Sem esta opção, novos registros são adicionados e os existentes atualizados.
            </span>
          </span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={S.btn('secondary')} onClick={onClose}>Cancelar</button>
          {validas.length > 0 && (
            <button style={S.btn('primary')} onClick={importar} disabled={importing}>
              {importing ? 'Importando...' : `⬆ Importar ${validas.length} registro${validas.length > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal novo lançamento ─────────────────────────────────
function ModalNovoLancamento({ versoes, itens, empresas, filiais, dimensoes, dimOpcoes, onSave, onClose }: {
  versoes: Versao[]; itens: ItemOrc[]; empresas: Empresa[]; filiais: Filial[]
  dimensoes: Dimensao[]; dimOpcoes: Record<string, DimValor[]>
  onSave: () => void; onClose: () => void
}) {
  const [form, setForm] = useState({
    versao_id: versoes[0]?.id || '',
    item_orc_id: '',
    empresa_id: empresas[0]?.id || '',
    filial_id: '',
    ano: new Date().getFullYear(),
    mes: 1,
    tipo_lancamento: 'ORCADO',
    valor: '',
    historico: '',
  })
  const [dimValues, setDimValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const filiaisEmpresa = filiais.filter(f => f.empresa_id === form.empresa_id)
  const n3 = itens.filter(x => x.aceita_lancamento)

  const salvar = async () => {
    if (!form.versao_id || !form.item_orc_id || !form.empresa_id) {
      setErro('Versão, item e empresa são obrigatórios.'); return
    }
    setSaving(true); setErro('')
    const dim_values = Object.fromEntries(Object.entries(dimValues).filter(([, v]) => v))
    const { error } = await supabase.from('fat_lancamento').upsert({
      versao_id: form.versao_id,
      item_orc_id: form.item_orc_id,
      empresa_id: form.empresa_id,
      filial_id: form.filial_id || null,
      ano: form.ano, mes: form.mes,
      tipo_lancamento: form.tipo_lancamento,
      valor: parseFloat(form.valor.replace(',', '.')) || 0,
      dim_values,
      historico: form.historico || null,
    }, { onConflict: 'tenant_id,versao_id,item_orc_id,empresa_id,filial_id,ano,mes,tipo_lancamento,dim_hash' })
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave(); onClose()
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#212529', marginBottom: 20 }}>Novo lançamento</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div><label style={S.label}>Versão</label>
            <select style={S.input} value={form.versao_id} onChange={e => setForm(f => ({ ...f, versao_id: e.target.value }))}>
              {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
            </select></div>
          <div><label style={S.label}>Tipo</label>
            <select style={S.input} value={form.tipo_lancamento} onChange={e => setForm(f => ({ ...f, tipo_lancamento: e.target.value }))}>
              <option value="ORCADO">Orçado</option>
              <option value="REALIZADO">Realizado</option>
            </select></div>
        </div>

        <div style={S.row}><label style={S.label}>Item orçamentário (N3)</label>
          <select style={S.input} value={form.item_orc_id} onChange={e => setForm(f => ({ ...f, item_orc_id: e.target.value }))}>
            <option value="">Selecione...</option>
            {n3.map(i => <option key={i.id} value={i.id}>{i.codigo} — {i.descricao}</option>)}
          </select></div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div><label style={S.label}>Empresa</label>
            <select style={S.input} value={form.empresa_id} onChange={e => setForm(f => ({ ...f, empresa_id: e.target.value, filial_id: '' }))}>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.descricao}</option>)}
            </select></div>
          <div><label style={S.label}>Filial</label>
            <select style={S.input} value={form.filial_id} onChange={e => setForm(f => ({ ...f, filial_id: e.target.value }))}>
              <option value="">— Sem filial —</option>
              {filiaisEmpresa.map(f => <option key={f.id} value={f.id}>{f.codigo} — {f.descricao}</option>)}
            </select></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div><label style={S.label}>Ano</label>
            <input type="number" style={S.input} value={form.ano} onChange={e => setForm(f => ({ ...f, ano: Number(e.target.value) }))} min={2020} max={2040} /></div>
          <div><label style={S.label}>Mês</label>
            <select style={S.input} value={form.mes} onChange={e => setForm(f => ({ ...f, mes: Number(e.target.value) }))}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select></div>
          <div><label style={S.label}>Valor</label>
            <input style={S.input} value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} placeholder="0" /></div>
        </div>

        {dimensoes.map(dim => (
          <div key={dim.codigo} style={S.row}>
            <label style={S.label}>{dim.label}</label>
            <select style={S.input} value={dimValues[dim.codigo] || ''} onChange={e => setDimValues(p => ({ ...p, [dim.codigo]: e.target.value }))}>
              <option value="">— Sem valor —</option>
              {(dimOpcoes[dim.codigo] || []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        ))}

        <div style={S.row}><label style={S.label}>Histórico</label>
          <textarea style={{ ...S.input, minHeight: 72, resize: 'vertical' as const }}
            value={form.historico} onChange={e => setForm(f => ({ ...f, historico: e.target.value }))}
            placeholder="Justificativa ou observação..." /></div>

        {erro && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fff5f5', color: '#c92a2a', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={S.btn('secondary')} onClick={onClose}>Cancelar</button>
          <button style={S.btn('primary')} onClick={salvar} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar lançamento'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────
export default function LancamentosPage() {
  const [rows,    setRows]    = useState<Lancamento[]>([])
  const [loading, setLoading] = useState(false)
  const [total,   setTotal]   = useState<number | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showImport, setShowImport] = useState(false)

  // Listas de filtro
  const [versoes,   setVersoes]   = useState<Versao[]>([])
  const [empresas,  setEmpresas]  = useState<Empresa[]>([])
  const [filiais,   setFiliais]   = useState<Filial[]>([])
  const [itens,     setItens]     = useState<ItemOrc[]>([])
  const [dimensoes, setDimensoes] = useState<Dimensao[]>([])
  const [dimOpcoes, setDimOpcoes] = useState<Record<string, DimValor[]>>({})

  // Filtros ativos
  const [versaoId,   setVersaoId]   = useState<string | null>(null)
  const [ano,        setAno]        = useState(new Date().getFullYear())
  const [empresaIds, setEmpresaIds] = useState<string[]>([])
  const [filialIds,  setFilialIds]  = useState<string[]>([])
  const [tipos,      setTipos]      = useState<string[]>([])
  const [dimFiltros, setDimFiltros] = useState<Record<string, string[]>>({})
  const [itemIds,    setItemIds]    = useState<string[]>([])
  const [grupos,     setGrupos]     = useState<Grupo[]>([])
  const [grupoIds,   setGrupoIds]   = useState<string[]>([])

  // Edição inline
  const [editCell, setEditCell] = useState<{ id: string; field: 'valor' | 'historico'; value: string } | null>(null)

  const userAccess = useUserAccess()
  const empresasDoGrupo = grupoIds.length > 0
    ? empresas.filter(e => e.grupo_id && grupoIds.includes(e.grupo_id))
    : empresas
  const empresasVisiveis = userAccess.filterList('empresa', empresasDoGrupo)
  const filialOpcoes = userAccess.filterList('filial',
    empresaIds.length > 0 ? filiais.filter(f => empresaIds.includes(f.empresa_id)) : filiais
  )

  useEffect(() => {
    if (userAccess.loading) return
    setEmpresaIds(prev => prev.filter(id => userAccess.canSee('empresa', id)))
    setFilialIds(prev => prev.filter(id => userAccess.canSee('filial', id)))
  }, [userAccess.loading]) // eslint-disable-line

  // Mapa de labels para dim_values
  const dimLabelMap = React.useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const dim of dimensoes) {
      map[dim.codigo] = Object.fromEntries((dimOpcoes[dim.codigo] || []).map(o => [o.id, o.label]))
    }
    return map
  }, [dimensoes, dimOpcoes])

  const carregarDimOpcoes = useCallback(async (dims: Dimensao[]) => {
    const opcoes: Record<string, DimValor[]> = {}
    await Promise.all(dims.map(async dim => {
      if (dim.tabela_ref === 'centro_custo') {
        const { data } = await supabase.from('centro_custo').select('id,codigo,descricao').eq('ativo', true).order('codigo')
        opcoes[dim.codigo] = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      } else if (dim.tabela_ref === 'funcionario') {
        const { data } = await supabase.from('funcionario').select('id,codigo,nome').eq('ativo', true).order('nome')
        opcoes[dim.codigo] = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.nome}` }))
      } else if (dim.tabela_ref === 'verba_folha') {
        const { data } = await supabase.from('verba_folha').select('id,codigo,descricao').order('codigo')
        opcoes[dim.codigo] = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      } else if (dim.tabela_ref === 'conta_contabil') {
        const { data } = await supabase.from('conta_contabil').select('id,codigo,descricao').order('codigo')
        opcoes[dim.codigo] = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      } else {
        const { data } = await supabase.from('dimensao_valor').select('id,codigo,descricao').eq('dimensao_id', dim.id).eq('ativo', true).order('codigo')
        opcoes[dim.codigo] = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      }
    }))
    setDimOpcoes(opcoes)
  }, [])

  // Carga inicial das listas
  useEffect(() => {
    Promise.all([
      supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
      supabase.from('empresa').select('id,codigo,descricao,grupo_id').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
      supabase.from('plano_orcamentario').select('id,codigo,descricao,aceita_lancamento,grupo_folha').order('codigo'),
      supabase.from('dimensao').select('id,codigo,label,tabela_ref').eq('ativo', true).order('ordem'),
      supabase.from('grupo_empresarial').select('id,codigo,descricao').order('codigo'),
    ]).then(([{ data: vData }, { data: eData }, { data: fData }, { data: iData }, { data: dData }, { data: gData }]) => {
      const vs = (vData || []) as Versao[]
      setVersoes(vs)
      setEmpresas((eData || []) as Empresa[])
      setFiliais((fData || []) as Filial[])
      setItens((iData || []) as ItemOrc[])
      const dims = (dData || []) as Dimensao[]
      setDimensoes(dims)
      carregarDimOpcoes(dims)
      setGrupos((gData || []) as Grupo[])
      if (vs.length) setVersaoId(vs[0].id)
    })
  }, [carregarDimOpcoes])

  // Quando grupo muda, auto-seleciona todas as empresas do grupo
  useEffect(() => {
    if (grupoIds.length === 0) { setEmpresaIds([]); return }
    const doGrupo = empresas
      .filter(e => e.grupo_id && grupoIds.includes(e.grupo_id))
      .map(e => e.id)
    setEmpresaIds(doGrupo)
  }, [grupoIds, empresas])

  // Quando empresas mudam, ajusta filiais disponíveis
  useEffect(() => {
    if (empresaIds.length === 0) { setFilialIds([]); return }
    const validos = new Set(filiais.filter(f => empresaIds.includes(f.empresa_id)).map(f => f.id))
    setFilialIds(prev => prev.filter(id => validos.has(id)))
  }, [empresaIds, filiais])

  // Carrega lançamentos quando filtros mudam
  const carregarRows = useCallback(async () => {
    if (!versaoId) return
    setLoading(true)
    let query = supabase
      .from('fat_lancamento')
      .select(`id, versao_id, item_orc_id, empresa_id, filial_id, ano, mes, valor,
               tipo_lancamento, dim_values, historico,
               empresa:empresa_id(codigo,descricao),
               filial:filial_id(codigo,descricao),
               item:item_orc_id(codigo,descricao,grupo_folha),
               versao:versao_id(codigo)`, { count: 'exact' })
      .eq('versao_id', versaoId)
      .eq('ano', ano)
      .order('item_orc_id').order('mes')
      .limit(500)

    if (itemIds.length === 1)       query = query.eq('item_orc_id', itemIds[0])
    else if (itemIds.length > 1)    query = query.in('item_orc_id', itemIds)
    if (empresaIds.length === 1)    query = query.eq('empresa_id', empresaIds[0])
    else if (empresaIds.length > 1) query = query.in('empresa_id', empresaIds)
    if (filialIds.length === 1)     query = query.eq('filial_id', filialIds[0])
    else if (filialIds.length > 1)  query = query.in('filial_id', filialIds)
    if (tipos.length === 1)         query = query.eq('tipo_lancamento', tipos[0])
    else if (tipos.length > 1)      query = query.in('tipo_lancamento', tipos)
    for (const [codigo, ids] of Object.entries(dimFiltros)) {
      if (ids.length === 0) continue
      if (ids.length === 1) query = query.contains('dim_values', { [codigo]: ids[0] })
      else query = query.or(ids.map(id => `dim_values.cs.${JSON.stringify({ [codigo]: id })}`).join(','))
    }

    const { data, count } = await query
    setRows((data || []) as unknown as Lancamento[])
    setTotal(count ?? null)
    setLoading(false)
  }, [versaoId, ano, itemIds, empresaIds, filialIds, tipos, dimFiltros])

  useEffect(() => { carregarRows() }, [carregarRows])

  const exportarLancamentos = useCallback(async () => {
    if (!versaoId) return

    const buildQuery = (from: number, to: number) => {
      let q = supabase
        .from('fat_lancamento')
        .select(`id, ano, mes, valor, tipo_lancamento, dim_values, historico,
                 empresa:empresa_id(codigo,descricao),
                 filial:filial_id(codigo,descricao),
                 item:item_orc_id(codigo,descricao)`)
        .eq('versao_id', versaoId)
        .eq('ano', ano)
        .order('item_orc_id').order('mes')
        .range(from, to)

      if (itemIds.length === 1)       q = q.eq('item_orc_id', itemIds[0])
      else if (itemIds.length > 1)    q = q.in('item_orc_id', itemIds)
      if (empresaIds.length === 1)    q = q.eq('empresa_id', empresaIds[0])
      else if (empresaIds.length > 1) q = q.in('empresa_id', empresaIds)
      if (filialIds.length === 1)     q = q.eq('filial_id', filialIds[0])
      else if (filialIds.length > 1)  q = q.in('filial_id', filialIds)
      if (tipos.length === 1)         q = q.eq('tipo_lancamento', tipos[0])
      else if (tipos.length > 1)      q = q.in('tipo_lancamento', tipos)
      for (const [codigo, ids] of Object.entries(dimFiltros)) {
        if (ids.length === 0) continue
        if (ids.length === 1) q = q.contains('dim_values', { [codigo]: ids[0] })
        else q = q.or(ids.map(id => `dim_values.cs.${JSON.stringify({ [codigo]: id })}`).join(','))
      }
      return q
    }

    // Pagina em blocos de 1000 até esgotar todos os registros
    const PAGE = 1000
    let allData: any[] = []
    let from = 0
    while (true) {
      const { data, error } = await buildQuery(from, from + PAGE - 1)
      if (error || !data?.length) break
      allData = allData.concat(data)
      if (data.length < PAGE) break
      from += PAGE
    }

    if (!allData.length) return

    const dimCols = dimensoes.map(d => d.label)
    const headers = ['item_codigo', 'item_descricao', 'empresa', 'filial', 'ano', 'mes', 'tipo', 'valor', 'historico', ...dimCols]
    const xlsxRows = allData.map(r => {
      const base: Record<string, string | number> = {
        item_codigo:    r.item?.codigo ?? '',
        item_descricao: r.item?.descricao ?? '',
        empresa:        r.empresa?.codigo ?? '',
        filial:         r.filial?.codigo ?? '',
        ano:            r.ano,
        mes:            r.mes,
        tipo:           r.tipo_lancamento,
        valor:          r.valor,
        historico:      r.historico ?? '',
      }
      for (const dim of dimensoes) {
        const uid = r.dim_values?.[dim.codigo]
        base[dim.label] = uid ? (dimLabelMap[dim.codigo]?.[uid]?.split(' — ')[0] ?? uid) : ''
      }
      return base
    })

    const versaoCod = versoes.find(v => v.id === versaoId)?.codigo || 'lancamentos'
    await downloadXlsx(`${versaoCod}_${ano}_lancamentos.xlsx`, headers, xlsxRows)
  }, [versaoId, ano, itemIds, empresaIds, filialIds, tipos, dimFiltros, dimensoes, dimLabelMap, versoes])

  const startEdit = (id: string, field: 'valor' | 'historico', current: any) =>
    setEditCell({ id, field, value: field === 'valor' ? String(current || '') : (current || '') })

  const saveEdit = async () => {
    if (!editCell) return
    const { id, field, value } = editCell
    const payload = field === 'valor'
      ? { valor: parseFloat(value.replace(',', '.')) || 0 }
      : { historico: value || null }
    const { error } = await supabase.from('fat_lancamento').update(payload).eq('id', id)
    if (!error) setRows(prev => prev.map(r => r.id === id ? { ...r, ...payload } : r))
    setEditCell(null)
  }

  const excluir = async (id: string) => {
    if (!confirm('Excluir este lançamento?')) return
    await supabase.from('fat_lancamento').delete().eq('id', id)
    setRows(prev => prev.filter(r => r.id !== id))
    if (total !== null) setTotal(total - 1)
  }

  const totalValor = rows.reduce((s, r) => s + (r.valor || 0), 0)

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Lançamentos</h1>
          <p style={S.sub}>Dados no nível mais granular · Clique em Valor ou Histórico para editar</p>
        </div>
        {total !== null && (
          <span style={{ fontSize: 12, color: '#868e96', alignSelf: 'center' }}>
            {rows.length < (total || 0) ? `${rows.length} de ${total}` : total} registro(s)
            {' · '}Total: <strong>{fmt(totalValor)}</strong>
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div style={S.toolbar}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Ano:
          <input type="number" style={{ ...S.select, width: 80 }} value={ano}
            onChange={e => setAno(Number(e.target.value))} min={2020} max={2040} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Versão:
          <select style={S.select} value={versaoId || ''} onChange={e => setVersaoId(e.target.value)}>
            {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
          </select>
        </label>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Grupo:
          <MultiSelectDropdown
            opcoes={grupos.map(g => ({ id: g.id, label: `${g.codigo} — ${g.descricao}` }))}
            selecionados={grupoIds} onChange={setGrupoIds} placeholder="Todos" />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Item:
          <MultiSelectDropdown
            opcoes={itens.filter(x => x.aceita_lancamento).map(i => ({ id: i.id, label: `${i.codigo} — ${i.descricao}` }))}
            selecionados={itemIds} onChange={setItemIds} placeholder="Todos" />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Empresa:
          <MultiSelectDropdown opcoes={empresasVisiveis.map(e => ({ id: e.id, label: `${e.codigo} — ${e.descricao}` }))}
            selecionados={empresaIds} onChange={setEmpresaIds} placeholder="Todas" />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Filial:
          <MultiSelectDropdown opcoes={filialOpcoes.map(f => ({ id: f.id, label: `${f.codigo} — ${f.descricao}` }))}
            selecionados={filialIds} onChange={setFilialIds} placeholder="Todas" />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Tipo:
          <MultiSelectDropdown opcoes={[{ id: 'ORCADO', label: 'Orçado' }, { id: 'REALIZADO', label: 'Realizado' }]}
            selecionados={tipos} onChange={setTipos} placeholder="Todos" />
        </span>
        {dimensoes.map(dim => (
          <span key={dim.codigo} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
            {dim.label}:
            <MultiSelectDropdown
              opcoes={userAccess.filterList(dim.codigo, dimOpcoes[dim.codigo] || [])}
              selecionados={dimFiltros[dim.codigo] || []}
              onChange={ids => setDimFiltros(prev => ({ ...prev, [dim.codigo]: ids }))}
              placeholder="Todos" />
          </span>
        ))}

        <div style={{ width: 1, height: 24, background: '#dee2e6', margin: '0 4px' }} />
        <button style={S.btn('secondary')} onClick={exportarLancamentos}>⬇ Exportar xlsx</button>
        <button style={S.btn('secondary')} onClick={() => setShowImport(true)}>⬆ Importar xlsx</button>
        <button style={S.btn('primary')} onClick={() => setShowAdd(true)}>+ Novo lançamento</button>
      </div>

      {/* Tabela */}
      {loading ? (
        <p style={{ color: '#aaa' }}>Carregando...</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#aaa' }}>Nenhum lançamento encontrado. Ajuste os filtros ou adicione um novo.</p>
      ) : (
        <div style={S.wrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Item</th>
                <th style={S.th}>Empresa</th>
                <th style={S.th}>Filial</th>
                <th style={S.th}>Data</th>
                <th style={S.th}>Tipo</th>
                <th style={S.th}>Dimensões</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Valor</th>
                <th style={{ ...S.th, minWidth: 200 }}>Histórico</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isEditValor = editCell?.id === row.id && editCell.field === 'valor'
                const isEditHist  = editCell?.id === row.id && editCell.field === 'historico'
                const dims = Object.entries(row.dim_values || {})
                return (
                  <tr key={row.id}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fa')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>

                    {/* Item */}
                    <td style={{ ...S.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'monospace', color: '#868e96', fontSize: 11 }}>{row.item?.codigo}</span>
                      {' '}<span style={{ fontSize: 12 }}>{row.item?.descricao}</span>
                    </td>

                    {/* Empresa / Filial / Mês / Tipo */}
                    <td style={{ ...S.td, fontSize: 12 }}>{row.empresa?.codigo}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{row.filial?.codigo || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap' }}>{MESES[row.mes - 1]}/{row.ano}</td>
                    <td style={S.td}><span style={S.badge(row.tipo_lancamento)}>{row.tipo_lancamento}</span></td>

                    {/* Dimensões */}
                    <td style={{ ...S.td, maxWidth: 220 }}>
                      {dims.length === 0
                        ? <span style={{ color: '#dee2e6', fontSize: 12 }}>—</span>
                        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {dims.map(([cod, uid]) => {
                              const dimLabel = dimensoes.find(d => d.codigo === cod)?.label || cod
                              const valLabel = (dimLabelMap[cod]?.[uid] || uid).split(' — ')[0]
                              return (
                                <span key={cod} style={{ background: '#f1f3f5', borderRadius: 4, padding: '1px 6px', fontSize: 11, color: '#495057' }}>
                                  {dimLabel}: {valLabel}
                                </span>
                              )
                            })}
                          </div>
                      }
                    </td>

                    {/* Valor (editável) */}
                    <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace' }}>
                      {isEditValor ? (
                        <input autoFocus value={editCell!.value}
                          onChange={e => setEditCell(p => p ? { ...p, value: e.target.value } : null)}
                          onBlur={saveEdit}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                          style={{ width: 90, textAlign: 'right', padding: '2px 6px', border: '2px solid #3b5bdb', borderRadius: 4, fontFamily: 'monospace', fontSize: 13 }}
                        />
                      ) : (
                        <span onClick={() => startEdit(row.id, 'valor', row.valor)}
                          style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#e7f5ff')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}>
                          {fmt(row.valor)}
                        </span>
                      )}
                    </td>

                    {/* Histórico (editável) */}
                    <td style={{ ...S.td, maxWidth: 280 }}>
                      {isEditHist ? (
                        <input autoFocus value={editCell!.value}
                          onChange={e => setEditCell(p => p ? { ...p, value: e.target.value } : null)}
                          onBlur={saveEdit}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                          style={{ width: '100%', padding: '2px 6px', border: '2px solid #3b5bdb', borderRadius: 4, fontSize: 13 }}
                        />
                      ) : (
                        <span onClick={() => startEdit(row.id, 'historico', row.historico)}
                          style={{ cursor: 'pointer', fontSize: 12, color: row.historico ? '#495057' : '#adb5bd', display: 'block', padding: '2px 4px', borderRadius: 4 }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#e7f5ff')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}>
                          {row.historico || 'Adicionar histórico...'}
                        </span>
                      )}
                    </td>

                    {/* Excluir */}
                    <td style={S.td}>
                      <button onClick={() => excluir(row.id)}
                        style={{ ...S.btn('danger'), padding: '3px 8px', fontSize: 12 }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {total !== null && total > 500 && (
            <div style={{ padding: '10px 16px', textAlign: 'center', color: '#e67700', fontSize: 13, background: '#fff9db', borderTop: '1px solid #ffe8cc' }}>
              ⚠️ Exibindo os primeiros 500 de {total} registros. Use os filtros para refinar a busca.
            </div>
          )}
        </div>
      )}

      {showImport && versaoId && (
        <ModalImportLancamentos
          versaoId={versaoId} ano={ano}
          itens={itens} empresas={empresas} filiais={filiais}
          dimensoes={dimensoes} dimOpcoes={dimOpcoes}
          onImported={carregarRows} onClose={() => setShowImport(false)}
        />
      )}

      {showAdd && (
        <ModalNovoLancamento
          versoes={versoes} itens={itens} empresas={empresas} filiais={filiais}
          dimensoes={dimensoes} dimOpcoes={dimOpcoes}
          onSave={carregarRows} onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
