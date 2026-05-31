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
  XLSX.utils.book_append_sheet(wb, ws, 'Orçamento')
  XLSX.writeFile(wb, filename)
}

// ── Colunas redimensionáveis ──────────────────────────────
type ColDef = { label: string; width: number; minWidth?: number }

function useResizableColumns(initial: ColDef[]) {
  const [cols, setCols] = useState(initial)
  const dragging = useRef<{ idx: number; startX: number; startW: number } | null>(null)
  const onMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { idx, startX: e.clientX, startW: cols[idx].width }
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const { idx, startX, startW } = dragging.current
      const delta = ev.clientX - startX
      const min = cols[idx].minWidth ?? 55
      setCols(prev => prev.map((c, i) => i === idx ? { ...c, width: Math.max(min, startW + delta) } : c))
    }
    const onUp = () => { dragging.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [cols])
  return { cols, onMouseDown }
}

function ResizableTh({ col, idx, onMouseDown, children, style }: {
  col: ColDef; idx: number; onMouseDown: (idx: number, e: React.MouseEvent) => void
  children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <th style={{ width: col.width, minWidth: col.minWidth ?? 55, position: 'relative', userSelect: 'none', ...style }}>
      {children}
      <span onMouseDown={e => onMouseDown(idx, e)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 2, height: 14, background: 'rgba(255,255,255,0.25)', borderRadius: 2 }} />
      </span>
    </th>
  )
}

const S = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } as React.CSSProperties,
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as React.CSSProperties,
  subtitle:{ fontSize: 13, color: '#868e96', margin: '4px 0 0' } as React.CSSProperties,
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 } as React.CSSProperties,
  select:  { padding: '6px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, color: '#343a40', background: 'white' } as React.CSSProperties,
  btn: (v: 'primary' | 'secondary'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
    borderRadius: 6, border: v === 'secondary' ? '1px solid #dee2e6' : 'none',
    background: v === 'primary' ? '#3b5bdb' : 'white',
    color: v === 'primary' ? 'white' : '#495057',
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  }),
  wrap:    { overflowX: 'auto' as const },
  table:   { borderCollapse: 'collapse' as const, fontSize: 13, tableLayout: 'fixed' as const },
  thFix:   { textAlign: 'left' as const, padding: '8px 12px', background: '#1e2d5a', color: 'white', fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap' as const, position: 'sticky' as const, left: 0, zIndex: 2, boxShadow: '2px 0 6px rgba(0,0,0,0.25)' },
  thMes:   { textAlign: 'right' as const, padding: '8px 8px', background: '#1e2d5a', color: '#a5b4fc', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' as const },
  thTotal: { textAlign: 'right' as const, padding: '8px 10px', background: '#152247', color: '#c7d2fe', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' as const },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: 'white', borderRadius: 16, padding: 28, width: 680, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  dropzone:(over: boolean): React.CSSProperties => ({ border: `2px dashed ${over ? '#3b5bdb' : '#dee2e6'}`, borderRadius: 12, padding: 28, textAlign: 'center', background: over ? '#edf2ff' : '#f8f9fa', cursor: 'pointer', marginBottom: 12 }),
  infoBox: { padding: '10px 14px', borderRadius: 8, fontSize: 12, background: '#e7f5ff', color: '#1971c2', marginBottom: 12 } as React.CSSProperties,
  warnBox: { padding: '10px 14px', borderRadius: 8, fontSize: 12, background: '#fff9db', color: '#e67700', marginBottom: 12 } as React.CSSProperties,
  errBox:  { padding: '10px 14px', borderRadius: 8, fontSize: 12, background: '#fff5f5', color: '#c92a2a', marginBottom: 12 } as React.CSSProperties,
}

type Item      = { id: string; codigo: string; descricao: string; nivel: number; pai_id: string | null; aceita_lancamento: boolean }
type Empresa   = { id: string; codigo: string; descricao: string }
type Filial    = { id: string; codigo: string; descricao: string; empresa_id: string }
type Versao    = { id: string; codigo: string }
type Dim       = { codigo: string; label: string }
type Dimensao  = { id: string; codigo: string; label: string; tabela_ref: string | null }
type DimValor  = { id: string; label: string }
type Valores   = Record<string, Record<number, number>>

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
    ? (opcoes.find(o => o.id === selecionados[0])?.label.split(' — ')[0] ?? '1 selecionada')
    : `${selecionados.length} selecionadas`

  const toggle = (id: string) =>
    onChange(selecionados.includes(id) ? selecionados.filter(x => x !== id) : [...selecionados, id])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ ...S.select, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 150 }}>
        <span style={{ flex: 1, textAlign: 'left' }}>{texto}</span>
        <span style={{ fontSize: 10, color: '#868e96', lineHeight: 1 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200, background: 'white', border: '1px solid #dee2e6', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 230, maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
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
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Modal de Importação ───────────────────────────────────
function ModalImportOrcamento({ itens, empresas, filiais, versaoId, empresaId, filialId, ano, onImported, onClose }: {
  itens: Item[]; empresas: Empresa[]; filiais: Filial[]
  versaoId: string; empresaId: string; filialId: string | null; ano: number
  onImported: () => void; onClose: () => void
}) {
  type PreviewItem = { item: Item; empresa: Empresa; filial: Filial | null; totais: number[]; total: number }

  const [preview, setPreview] = useState<PreviewItem[]>([])
  const [dims, setDims] = useState<Dim[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [erro, setErro] = useState('')
  const [naoEncontrados, setNaoEncontrados] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('dimensao').select('codigo,label').eq('ativo', true).order('ordem')
      .then(({ data }) => setDims((data || []) as Dim[]))
  }, [])

  const empPadrao = empresas.find(e => e.id === empresaId)
  const filialPadrao = filiais.find(f => f.id === filialId) || null
  const empresaMap = Object.fromEntries(empresas.map(e => [e.codigo.trim(), e]))
  const filialMap  = Object.fromEntries(filiais.map(f => [f.codigo.trim(), f]))
  const itensByCode = Object.fromEntries(itens.filter(x => x.aceita_lancamento).map(x => [x.codigo.trim(), x]))

  const downloadTemplate = async () => {
    const n3 = itens.filter(x => x.aceita_lancamento)
    const dimCols = dims.map(d => d.label)
    const rows = n3.map(item => ({
      codigo: item.codigo,
      descricao: item.descricao,
      empresa: empPadrao?.codigo || '',
      filial: filialPadrao?.codigo || '',
      ...Object.fromEntries(dimCols.map(d => [d, ''])),
      ...Object.fromEntries(MESES.map(m => [m, 0])),
    }))
    await downloadXlsx(
      `template_orcamento_${ano}.xlsx`,
      ['codigo', 'descricao', 'empresa', 'filial', ...dimCols, ...MESES],
      rows
    )
  }

  const parseFile = async (file: File) => {
    setErro(''); setNaoEncontrados([]); setPreview([])
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: 0 })

    // Agregar: chave = itemId || empresaId → somar meses
    const agg = new Map<string, PreviewItem>()
    const naoCod: string[] = []

    for (const r of json) {
      const codigo = String(r['codigo'] || r['Código'] || r['CODIGO'] || '').trim()
      if (!codigo) continue
      const item = itensByCode[codigo]
      if (!item) { if (!naoCod.includes(codigo)) naoCod.push(codigo); continue }

      // Resolve empresa: da coluna "empresa" da linha ou usa filtro ativo
      const empRaw = String(r['empresa'] || r['Empresa'] || r['EMPRESA'] || '').trim()
      const emp = (empRaw && empresaMap[empRaw]) || empPadrao
      if (!emp) continue

      // Resolve filial: da coluna "filial" da linha ou usa filtro ativo
      const filRaw = String(r['filial'] || r['Filial'] || r['FILIAL'] || '').trim()
      const fil = (filRaw && filialMap[filRaw]) || filialPadrao

      const key = `${item.id}||${emp.id}||${fil?.id || ''}`
      if (!agg.has(key)) {
        agg.set(key, { item, empresa: emp, filial: fil, totais: new Array(12).fill(0), total: 0 })
      }
      const entry = agg.get(key)!
      MESES.forEach((m, i) => {
        const raw = r[m] ?? r[m.toUpperCase()] ?? r[m.toLowerCase()] ?? 0
        const v = parseFloat(String(raw).replace(/\s/g, '').replace('.', '').replace(',', '.')) || 0
        entry.totais[i] += v
      })
    }

    // Recalcula total e filtra itens com pelo menos 1 valor
    const result: PreviewItem[] = []
    for (const entry of agg.values()) {
      entry.total = entry.totais.reduce((s, v) => s + v, 0)
      if (entry.total !== 0 || entry.totais.some(v => v !== 0)) result.push(entry)
    }

    setPreview(result)
    setNaoEncontrados(naoCod)
  }

  const importar = async () => {
    if (!preview.length) return
    setImporting(true); setErro('')

    const records = preview.flatMap(({ item, empresa, filial, totais }) =>
      totais.map((valor, i) => ({
        versao_id: versaoId,
        item_orc_id: item.id,
        empresa_id: empresa.id,
        filial_id: filial?.id || null,
        ano, mes: i + 1, valor,
        tipo_lancamento: 'ORCADO',
        dim_values: {},
      }))
    )

    const { error } = await supabase.from('fat_lancamento').upsert(records, {
      onConflict: 'tenant_id,versao_id,item_orc_id,empresa_id,filial_id,ano,mes,tipo_lancamento',
    })

    setImporting(false)
    if (error) { setErro(error.message); return }
    onImported()
    onClose()
  }

  const totalGeral = preview.reduce((s, p) => s + p.total, 0)
  const multiEmpresa = new Set(preview.map(p => p.empresa.id)).size > 1
  const multiFilial  = new Set(preview.map(p => p.filial?.id || '')).size > 1

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#212529', marginBottom: 16 }}>Importar Orçamento</div>

        <div style={S.infoBox}>
          <strong>Colunas do template:</strong> <code>codigo</code> · <code>descricao</code> · <code>empresa</code> · <code>filial</code>
          {dims.length > 0 && <> · {dims.map(d => <code key={d.codigo} style={{ marginLeft: 4 }}>{d.label}</code>)}</>}
          {' '}· <code>Jan</code> … <code>Dez</code>
          <br />
          Linhas com o mesmo item + empresa serão <strong>somadas</strong>. A coluna <code>empresa</code> permite importar múltiplas empresas de uma vez.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button style={S.btn('secondary')} onClick={downloadTemplate}>⬇ Baixar template</button>
        </div>

        <div style={S.dropzone(dragOver)}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }}
          onClick={() => fileRef.current?.click()}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo .xlsx aqui ou clique para selecionar</div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
        </div>

        {naoEncontrados.length > 0 && (
          <div style={S.warnBox}>
            ⚠️ {naoEncontrados.length} código(s) não encontrado(s) no plano: {naoEncontrados.slice(0, 8).join(', ')}{naoEncontrados.length > 8 ? `… (+${naoEncontrados.length - 8})` : ''}
          </div>
        )}
        {erro && <div style={S.errBox}>{erro}</div>}

        {preview.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 13, color: '#495057' }}>
              <span><strong>{preview.length}</strong> itens</span>
              {multiEmpresa && <span><strong>{new Set(preview.map(p => p.empresa.id)).size}</strong> empresas</span>}
              {multiFilial  && <span><strong>{new Set(preview.map(p => p.filial?.id || '')).size}</strong> filiais</span>}
              <span>Total: <strong>{fmt(totalGeral)}</strong></span>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8, marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    <th style={{ padding: '6px 12px', textAlign: 'left', color: '#868e96', borderBottom: '1px solid #e9ecef' }}>Código</th>
                    <th style={{ padding: '6px 12px', textAlign: 'left', color: '#868e96', borderBottom: '1px solid #e9ecef' }}>Descrição</th>
                    {multiEmpresa && <th style={{ padding: '6px 12px', textAlign: 'left', color: '#868e96', borderBottom: '1px solid #e9ecef' }}>Empresa</th>}
                    {multiFilial  && <th style={{ padding: '6px 12px', textAlign: 'left', color: '#868e96', borderBottom: '1px solid #e9ecef' }}>Filial</th>}
                    <th style={{ padding: '6px 12px', textAlign: 'right', color: '#868e96', borderBottom: '1px solid #e9ecef' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f3f5' }}>
                      <td style={{ padding: '5px 12px', fontFamily: 'monospace', color: '#868e96' }}>{p.item.codigo}</td>
                      <td style={{ padding: '5px 12px' }}>{p.item.descricao}</td>
                      {multiEmpresa && <td style={{ padding: '5px 12px', fontSize: 11 }}>{p.empresa.codigo}</td>}
                      {multiFilial  && <td style={{ padding: '5px 12px', fontSize: 11 }}>{p.filial?.codigo || '—'}</td>}
                      <td style={{ padding: '5px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{fmt(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={S.btn('secondary')} onClick={onClose}>Cancelar</button>
          {preview.length > 0 && (
            <button style={S.btn('primary')} onClick={importar} disabled={importing}>
              {importing ? 'Importando...' : `⬆ Importar ${preview.length} item${preview.length > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────
export default function OrcamentoPage() {
  const [itens,    setItens]    = useState<Item[]>([])
  const [valores,  setValores]  = useState<Valores>({})
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [editando, setEditando] = useState<{ id: string; mes: number } | null>(null)
  const [inputVal, setInputVal] = useState('')
  const [loading,  setLoading]  = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  // Filtros — arrays vazios = "Todas"
  const [ano, setAno] = useState(2026)
  const [versoes,    setVersoes]    = useState<Versao[]>([])
  const [empresas,   setEmpresas]   = useState<Empresa[]>([])
  const [filiais,    setFiliais]    = useState<Filial[]>([])
  const [versaoId,   setVersaoId]   = useState<string | null>(null)
  const [empresaIds, setEmpresaIds] = useState<string[]>([])
  const [filialIds,  setFilialIds]  = useState<string[]>([])

  // Dimensões dinâmicas
  const [dimensoes,  setDimensoes]  = useState<Dimensao[]>([])
  const [dimOpcoes,  setDimOpcoes]  = useState<Record<string, DimValor[]>>({})
  const [dimFiltros, setDimFiltros] = useState<Record<string, string[]>>({})

  // Controle de acesso do usuário logado
  const userAccess = useUserAccess()

  // Opções visíveis (filtradas pelas regras de acesso do usuário)
  const empresasVisiveis = userAccess.filterList('empresa', empresas)
  const filialOpcoes = userAccess.filterList('filial',
    empresaIds.length > 0
      ? filiais.filter(f => empresaIds.includes(f.empresa_id))
      : filiais
  )

  // Modo agregado: somente leitura
  const modoAgregado = empresaIds.length !== 1 || filialIds.length !== 1

  // Quando as regras de acesso carregam, remove seleções fora do permitido
  useEffect(() => {
    if (userAccess.loading) return
    setEmpresaIds(prev => prev.filter(id => userAccess.canSee('empresa', id)))
    setFilialIds(prev => prev.filter(id => userAccess.canSee('filial', id)))
    setDimFiltros(prev => {
      const next: Record<string, string[]> = {}
      for (const [codigo, ids] of Object.entries(prev)) {
        next[codigo] = ids.filter(id => userAccess.canSee(codigo, id))
      }
      return next
    })
  }, [userAccess.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega valores de cada dimensão conforme tabela_ref
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

  // 1. Carrega estrutura + listas de filtro (uma vez)
  useEffect(() => {
    Promise.all([
      supabase.from('plano_orcamentario').select('id,codigo,descricao,nivel,pai_id,aceita_lancamento').order('codigo'),
      supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
      supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
      supabase.from('dimensao').select('id,codigo,label,tabela_ref').eq('ativo', true).order('ordem'),
    ]).then(([{ data: iData }, { data: vData }, { data: eData }, { data: fData }, { data: dData }]) => {
      setItens(iData || [])
      const vs = (vData || []) as Versao[]
      setVersoes(vs)
      setEmpresas((eData || []) as Empresa[])
      setFiliais((fData || []) as Filial[])
      const dims = (dData || []) as Dimensao[]
      setDimensoes(dims)
      carregarDimOpcoes(dims)
      if (vs.length) setVersaoId(vs[0].id)
      const n1ids = new Set((iData || []).filter((x: any) => x.nivel === 1).map((x: any) => x.id as string))
      setExpandidos(n1ids)
    })
  }, [carregarDimOpcoes])

  // Quando empresas mudam, remove filiais que não pertencem às selecionadas
  useEffect(() => {
    if (empresaIds.length === 0) return
    const validos = new Set(filiais.filter(f => empresaIds.includes(f.empresa_id)).map(f => f.id))
    setFilialIds(prev => prev.filter(id => validos.has(id)))
  }, [empresaIds, filiais])

  // 2. Carrega fat_lancamento quando filtros mudam
  const carregarLancamentos = useCallback(async () => {
    if (!versaoId) return
    setLoading(true)
    let query = supabase
      .from('fat_lancamento')
      .select('item_orc_id,mes,valor')
      .eq('versao_id', versaoId)
      .eq('ano', ano)
      .eq('tipo_lancamento', 'ORCADO')
    if (empresaIds.length === 1)    query = query.eq('empresa_id', empresaIds[0])
    else if (empresaIds.length > 1) query = query.in('empresa_id', empresaIds)
    if (filialIds.length === 1)     query = query.eq('filial_id', filialIds[0])
    else if (filialIds.length > 1)  query = query.in('filial_id', filialIds)
    for (const [codigo, ids] of Object.entries(dimFiltros)) {
      if (ids.length === 0) continue
      if (ids.length === 1) {
        query = query.contains('dim_values', { [codigo]: ids[0] })
      } else {
        query = query.or(ids.map(id => `dim_values.cs.${JSON.stringify({ [codigo]: id })}`).join(','))
      }
    }
    const { data: lData } = await query
    const mapa: Valores = {}
    for (const l of lData || []) {
      if (!mapa[l.item_orc_id]) mapa[l.item_orc_id] = {}
      mapa[l.item_orc_id][l.mes] = (mapa[l.item_orc_id][l.mes] || 0) + l.valor
    }
    setValores(mapa)
    setLoading(false)
  }, [versaoId, empresaIds, filialIds, dimFiltros, ano])

  useEffect(() => { carregarLancamentos() }, [carregarLancamentos])

  const toggle = (id: string) => setExpandidos(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })
  const expandirTudo = () => setExpandidos(new Set(itens.map(x => x.id)))
  const recolherTudo = () => setExpandidos(new Set(itens.filter(x => x.nivel === 1).map(x => x.id)))

  const totalItem = (id: string, mes?: number): number => {
    const direto = mes
      ? (valores[id]?.[mes] || 0)
      : MESES.reduce((s, _, i) => s + (valores[id]?.[i + 1] || 0), 0)
    const filhos = itens.filter(x => x.pai_id === id)
    return direto + filhos.reduce((s, f) => s + totalItem(f.id, mes), 0)
  }

  const iniciarEdicao = (id: string, mes: number) => {
    if (modoAgregado) return
    setEditando({ id, mes }); setInputVal(String(valores[id]?.[mes] || ''))
  }

  const salvarEdicao = async () => {
    if (!editando || !versaoId || modoAgregado) return
    const { id, mes } = editando
    const novoValor = parseFloat(inputVal.replace(',', '.')) || 0
    setSalvando(true); setErroSalvar(null)
    const dim_values = Object.fromEntries(
      Object.entries(dimFiltros).filter(([, ids]) => ids.length === 1).map(([k, ids]) => [k, ids[0]])
    )
    const { error } = await supabase.from('fat_lancamento').upsert({
      versao_id: versaoId,
      item_orc_id: id,
      empresa_id: empresaIds[0],
      filial_id: filialIds[0],
      ano, mes, valor: novoValor, tipo_lancamento: 'ORCADO', dim_values,
    }, { onConflict: 'tenant_id,versao_id,item_orc_id,empresa_id,filial_id,ano,mes,tipo_lancamento' })
    if (error) { setErroSalvar(error.message) }
    else { setValores(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [mes]: novoValor } })) }
    setEditando(null); setSalvando(false)
  }

  const exportar = async () => {
    const versaoCod = versoes.find(v => v.id === versaoId)?.codigo || 'orcamento'
    const empLabel = empresaIds.length === 0 ? 'todas-emp'
      : empresaIds.length === 1 ? (empresas.find(e => e.id === empresaIds[0])?.codigo || '') : `${empresaIds.length}emp`
    const filLabel = filialIds.length === 0 ? ''
      : filialIds.length === 1 ? (filiais.find(f => f.id === filialIds[0])?.codigo || '') : `${filialIds.length}fil`
    const n3 = itens.filter(x => x.aceita_lancamento)
    const rows = n3.map(item => ({
      codigo: item.codigo, descricao: item.descricao, empresa: empLabel, filial: filLabel,
      ...Object.fromEntries(MESES.map((m, i) => [m, valores[item.id]?.[i + 1] || 0])),
      Total: MESES.reduce((s, _, i) => s + (valores[item.id]?.[i + 1] || 0), 0),
    }))
    const parts = [versaoCod, empLabel, filLabel, String(ano)].filter(Boolean)
    await downloadXlsx(`${parts.join('_')}.xlsx`, ['codigo', 'descricao', 'empresa', 'filial', ...MESES, 'Total'], rows)
  }

  const n1 = itens.filter(x => x.nivel === 1)
  const n2por = (pai: string) => itens.filter(x => x.nivel === 2 && x.pai_id === pai)
  const n3por = (pai: string) => itens.filter(x => x.nivel === 3 && x.pai_id === pai)

  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Item Orçamentário', width: 320, minWidth: 200 },
    ...MESES.map(m => ({ label: m, width: 72, minWidth: 55 })),
    { label: 'Total', width: 90, minWidth: 70 },
  ])

  const TBTN: React.CSSProperties = {
    width: 18, height: 18, flexShrink: 0, padding: 0, lineHeight: 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 3, cursor: 'pointer', fontSize: 12, fontWeight: 700, border: '1px solid',
  }

  const rowN1 = (item: Item) => (
    <tr key={item.id} style={{ background: '#1e2d5a', cursor: 'pointer' }} onClick={() => toggle(item.id)}>
      <td style={{ padding: '7px 8px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <button onClick={e => { e.stopPropagation(); toggle(item.id) }}
            style={{ ...TBTN, background: 'transparent', borderColor: 'rgba(255,255,255,0.4)', color: 'white' }}>
            {expandidos.has(item.id) ? '−' : '+'}
          </button>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.codigo} — {item.descricao}
          </span>
        </div>
      </td>
      {MESES.map((_, i) => (
        <td key={i} style={{ textAlign: 'right', padding: '8px 8px', color: '#a5b4fc', fontWeight: 600, fontFamily: 'monospace' }}>
          {fmt(totalItem(item.id, i + 1))}
        </td>
      ))}
      <td style={{ textAlign: 'right', padding: '8px 10px', color: 'white', fontWeight: 700, fontFamily: 'monospace', background: '#152247' }}>
        {fmt(totalItem(item.id))}
      </td>
    </tr>
  )

  const rowN2 = (item: Item) => {
    const temFilhos = itens.some(x => x.nivel === 3 && x.pai_id === item.id)
    return (
      <tr key={item.id} style={{ background: '#f0f2ff', cursor: temFilhos ? 'pointer' : 'default' }}
        onClick={() => temFilhos && toggle(item.id)}>
        <td style={{ padding: '6px 8px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ width: 24, flexShrink: 0 }} />
            {temFilhos ? (
              <button onClick={e => { e.stopPropagation(); toggle(item.id) }}
                style={{ ...TBTN, background: 'transparent', borderColor: '#bac8ff', color: '#3b5bdb' }}>
                {expandidos.has(item.id) ? '−' : '+'}
              </button>
            ) : <span style={{ width: 18, flexShrink: 0 }} />}
            <span style={{ color: '#3b5bdb', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.codigo} — {item.descricao}
            </span>
          </div>
        </td>
        {MESES.map((_, i) => (
          <td key={i} style={{ textAlign: 'right', padding: '7px 8px', color: '#3b5bdb', fontFamily: 'monospace', fontWeight: 600 }}>
            {fmt(totalItem(item.id, i + 1))}
          </td>
        ))}
        <td style={{ textAlign: 'right', padding: '7px 10px', color: '#3b5bdb', fontWeight: 700, fontFamily: 'monospace', background: '#e0e7ff' }}>
          {fmt(totalItem(item.id))}
        </td>
      </tr>
    )
  }

  const rowN3 = (item: Item) => (
    <tr key={item.id} style={{ borderBottom: '1px solid #f1f3f5' }}>
      <td style={{ padding: '5px 8px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ width: 48, flexShrink: 0 }} />
          <span style={{ color: '#495057', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.codigo} — {item.descricao}
          </span>
        </div>
      </td>
      {MESES.map((_, i) => {
        const mes = i + 1
        const isEdit = editando?.id === item.id && editando?.mes === mes
        const val = valores[item.id]?.[mes] || 0
        return (
          <td key={i} style={{ textAlign: 'right', padding: '4px 4px' }}>
            {isEdit ? (
              <input autoFocus value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onBlur={salvarEdicao}
                onKeyDown={e => { if (e.key === 'Enter') salvarEdicao(); if (e.key === 'Escape') setEditando(null) }}
                style={{ width: 70, textAlign: 'right', padding: '2px 4px', border: '2px solid #3b5bdb', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }}
              />
            ) : (
              <span
                onClick={() => iniciarEdicao(item.id, mes)}
                style={{ display: 'block', textAlign: 'right', padding: '2px 6px', fontFamily: 'monospace', color: val ? '#212529' : '#dee2e6', cursor: modoAgregado ? 'default' : 'pointer', borderRadius: 4, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!modoAgregado) e.currentTarget.style.background = '#e7f5ff' }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {fmt(val)}
              </span>
            )}
          </td>
        )
      })}
      <td style={{ textAlign: 'right', padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600, color: '#495057', background: '#f8f9fa' }}>
        {fmt(totalItem(item.id))}
      </td>
    </tr>
  )

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Editor de Orçamento</h1>
          <p style={S.subtitle}>
            {modoAgregado
              ? 'Visão agregada (somente leitura) · Selecione 1 empresa + 1 filial para editar'
              : 'Clique em um valor para editar · Enter para salvar'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {modoAgregado && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: '#fff9db', color: '#e67700', fontWeight: 500 }}>Agregado</span>}
          {salvando   && <span style={{ fontSize: 12, color: '#3b5bdb' }}>Salvando...</span>}
          {erroSalvar && <span style={{ fontSize: 12, color: '#c92a2a' }}>Erro: {erroSalvar}</span>}
        </div>
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
          Empresa:
          <MultiSelectDropdown
            opcoes={empresasVisiveis.map(e => ({ id: e.id, label: `${e.codigo} — ${e.descricao}` }))}
            selecionados={empresaIds}
            onChange={setEmpresaIds}
            placeholder="Todas"
          />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
          Filial:
          <MultiSelectDropdown
            opcoes={filialOpcoes.map(f => ({ id: f.id, label: `${f.codigo} — ${f.descricao}` }))}
            selecionados={filialIds}
            onChange={setFilialIds}
            placeholder="Todas"
          />
        </span>

        {dimensoes.map(dim => (
          <span key={dim.codigo} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057' }}>
            {dim.label}:
            <MultiSelectDropdown
              opcoes={userAccess.filterList(dim.codigo, dimOpcoes[dim.codigo] || [])}
              selecionados={dimFiltros[dim.codigo] || []}
              onChange={ids => setDimFiltros(prev => ({ ...prev, [dim.codigo]: ids }))}
              placeholder="Todos"
            />
          </span>
        ))}

        <div style={{ width: 1, height: 24, background: '#dee2e6', margin: '0 4px' }} />

        <button style={S.btn('secondary')} onClick={expandirTudo}>⊞ Expandir</button>
        <button style={S.btn('secondary')} onClick={recolherTudo}>⊟ Recolher</button>
        <button style={S.btn('secondary')} onClick={exportar}>⬇ Exportar xlsx</button>
        <button style={S.btn('primary')} onClick={() => setShowImport(true)}>⬆ Importar xlsx</button>
      </div>

      {loading ? (
        <p style={{ color: '#aaa' }}>Carregando...</p>
      ) : (
        <div style={S.wrap}>
          <table style={{ ...S.table, width: cols.reduce((s, c) => s + c.width, 0) }}>
            <thead>
              <tr>
                <ResizableTh col={cols[0]} idx={0} onMouseDown={onMouseDown} style={S.thFix}>
                  Item Orçamentário
                </ResizableTh>
                {MESES.map((m, i) => (
                  <ResizableTh key={m} col={cols[i + 1]} idx={i + 1} onMouseDown={onMouseDown} style={S.thMes}>
                    {m}
                  </ResizableTh>
                ))}
                <ResizableTh col={cols[13]} idx={13} onMouseDown={onMouseDown} style={S.thTotal}>
                  Total
                </ResizableTh>
              </tr>
            </thead>
            <tbody>
              {n1.map(item1 => (<React.Fragment key={item1.id}>
                {rowN1(item1)}
                {expandidos.has(item1.id) && n2por(item1.id).map(item2 => (<React.Fragment key={item2.id}>
                  {rowN2(item2)}
                  {expandidos.has(item2.id) && n3por(item2.id).map(item3 => rowN3(item3))}
                </React.Fragment>))}
              </React.Fragment>))}
            </tbody>
          </table>
        </div>
      )}

      {showImport && versaoId && (
        <ModalImportOrcamento
          itens={itens}
          empresas={empresas}
          filiais={filiais}
          versaoId={versaoId}
          empresaId={empresaIds[0] || empresas[0]?.id || ''}
          filialId={filialIds[0] || null}
          ano={ano}
          onImported={carregarLancamentos}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
