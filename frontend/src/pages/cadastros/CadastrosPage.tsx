import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Pencil, Trash2, Plus, Upload, Check, AlertTriangle, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── Download de xlsx genérico ─────────────────────────────
async function downloadXlsx(filename: string, headers: string[], rows: Record<string, string | number>[]) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [Object.fromEntries(headers.map(h => [h, '']))], { header: headers })
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, ...rows.map(r => String(r[h] ?? '').length + 2)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, filename)
}

// ── Tabela com colunas redimensionáveis ───────────────────
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
      const min = cols[idx].minWidth ?? 60
      setCols(prev => prev.map((c, i) => i === idx ? { ...c, width: Math.max(min, startW + delta) } : c))
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
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
    <th style={{
      ...S_TH, width: col.width, minWidth: col.minWidth ?? 60,
      position: 'relative', userSelect: 'none', ...style,
    }}>
      {children}
      <span
        onMouseDown={e => onMouseDown(idx, e)}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
          cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ width: 2, height: 14, background: '#dee2e6', borderRadius: 2 }} />
      </span>
    </th>
  )
}

// estilos de th/td extraídos para uso no componente resizável
const S_TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px', color: '#868e96',
  fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef',
}
const S_TD: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid #f1f3f5',
  color: '#343a40', verticalAlign: 'middle', textAlign: 'left',
}

type Aba = 'empresas' | 'filiais' | 'plano'

// ── Estilos ───────────────────────────────────────────────
const S = {
  page: { padding: 24, fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 } as React.CSSProperties,
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as React.CSSProperties,
  subtitle: { fontSize: 13, color: '#868e96', margin: '4px 0 0' } as React.CSSProperties,
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e9ecef', paddingBottom: 0 } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
    background: 'none', color: active ? '#3b5bdb' : '#868e96',
    borderBottom: active ? '2px solid #3b5bdb' : '2px solid transparent',
    marginBottom: -1, transition: 'all 0.15s',
  }),
  card: { background: 'white', borderRadius: 12, border: '1px solid #e9ecef', overflow: 'hidden' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: { textAlign: 'left' as const, padding: '10px 16px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td: { padding: '10px 16px', borderBottom: '1px solid #f1f3f5', color: '#343a40', verticalAlign: 'middle' as const, textAlign: 'left' as const },
  badge: (ativo: boolean): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 500,
    background: ativo ? '#ebfbee' : '#fff5f5', color: ativo ? '#2f9e44' : '#c92a2a',
  }),
  nivel: (n: number): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
    background: n === 1 ? '#e7f5ff' : n === 2 ? '#f3f0ff' : '#fff9db',
    color: n === 1 ? '#1971c2' : n === 2 ? '#6741d9' : '#e67700',
  }),
  indent: (n: number): React.CSSProperties => ({ paddingLeft: 16 + (n - 1) * 24 }),
  // Botões
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
    background: '#3b5bdb', color: 'white', border: 'none', borderRadius: 8,
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  } as React.CSSProperties,
  btnSecondary: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
    background: 'white', color: '#495057', border: '1px solid #dee2e6', borderRadius: 8,
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  } as React.CSSProperties,
  btnIcon: (color?: string): React.CSSProperties => ({
    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
    borderRadius: 6, color: color || '#868e96', display: 'inline-flex', alignItems: 'center',
  }),
  btnDanger: {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
    background: '#fa5252', color: 'white', border: 'none', borderRadius: 8,
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  } as React.CSSProperties,
  // Toolbar
  toolbar: { display: 'flex', gap: 8, marginBottom: 16 } as React.CSSProperties,
  // Modal
  overlay: {
    position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: (wide?: boolean): React.CSSProperties => ({
    background: 'white', borderRadius: 16, padding: 28, width: wide ? 680 : 420,
    maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  }),
  modalTitle: { fontSize: 17, fontWeight: 600, color: '#212529', marginBottom: 20 } as React.CSSProperties,
  label: { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 4 } as React.CSSProperties,
  input: {
    width: '100%', padding: '8px 12px', border: '1px solid #dee2e6', borderRadius: 8,
    fontSize: 14, color: '#212529', outline: 'none', boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  select: {
    width: '100%', padding: '8px 12px', border: '1px solid #dee2e6', borderRadius: 8,
    fontSize: 14, color: '#212529', outline: 'none', boxSizing: 'border-box' as const, background: 'white',
  } as React.CSSProperties,
  formRow: { marginBottom: 16 } as React.CSSProperties,
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 } as React.CSSProperties,
  // Importação
  dropzone: (over: boolean): React.CSSProperties => ({
    border: `2px dashed ${over ? '#3b5bdb' : '#dee2e6'}`,
    borderRadius: 12, padding: 32, textAlign: 'center',
    background: over ? '#edf2ff' : '#f8f9fa', cursor: 'pointer', marginBottom: 16,
  }),
  previewTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13, marginTop: 12 },
  previewTh: { padding: '8px 12px', background: '#f8f9fa', borderBottom: '1px solid #e9ecef', textAlign: 'left' as const, fontWeight: 500, fontSize: 12, color: '#868e96' },
  previewTd: { padding: '8px 12px', borderBottom: '1px solid #f1f3f5', color: '#343a40' },
  errorRow: { background: '#fff5f5' } as React.CSSProperties,
  infoBox: (type: 'info' | 'warn'): React.CSSProperties => ({
    padding: '10px 14px', borderRadius: 8, fontSize: 12,
    background: type === 'info' ? '#e7f5ff' : '#fff9db',
    color: type === 'info' ? '#1971c2' : '#e67700',
    marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start',
  }),
}

// ── Modal genérico ────────────────────────────────────────
function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal(wide)}>
        {children}
      </div>
    </div>
  )
}

// ── Confirmação de exclusão ───────────────────────────────
function ConfirmDelete({ msg, onConfirm, onCancel }: { msg: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal onClose={onCancel}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 20 }}>
        <AlertTriangle size={22} color="#fa5252" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Confirmar exclusão</div>
          <div style={{ fontSize: 14, color: '#495057' }}>{msg}</div>
        </div>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onCancel}>Cancelar</button>
        <button style={S.btnDanger} onClick={onConfirm}>Excluir</button>
      </div>
    </Modal>
  )
}

// ── Empresas ──────────────────────────────────────────────
type Empresa = { id: string; codigo: string; descricao: string; ativo: boolean }

function ModalEmpresa({ empresa, onSave, onClose }: {
  empresa?: Empresa | null
  onSave: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    codigo: empresa?.codigo || '',
    descricao: empresa?.descricao || '',
    ativo: empresa?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async () => {
    if (!form.codigo.trim() || !form.descricao.trim()) { setErro('Código e descrição são obrigatórios.'); return }
    setSaving(true)
    const payload = { codigo: form.codigo.trim(), descricao: form.descricao.trim(), ativo: form.ativo }
    const { error } = empresa
      ? await supabase.from('empresa').update(payload).eq('id', empresa.id)
      : await supabase.from('empresa').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }

  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{empresa ? 'Editar empresa' : 'Nova empresa'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={S.formRow}>
        <label style={S.label}>Código</label>
        <input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder="ex: 01" />
      </div>
      <div style={S.formRow}>
        <label style={S.label}>Descrição</label>
        <input style={S.input} value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder="Nome da empresa" />
      </div>
      <div style={S.formRow}>
        <label style={S.label}>Status</label>
        <select style={S.select} value={form.ativo ? '1' : '0'} onChange={e => setForm(f => ({ ...f, ativo: e.target.value === '1' }))}>
          <option value="1">Ativo</option>
          <option value="0">Inativo</option>
        </select>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}>
          <Check size={14} />{saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </Modal>
  )
}

// ── Modal importação empresas ─────────────────────────────
function ModalImportEmpresa({ dados, onSave, onClose }: { dados: Empresa[]; onSave: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<{ codigo: string; descricao: string; ativo: boolean; _erro?: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const parseFile = async (file: File) => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const parsed = json.map(r => {
      const codigo = String(r['codigo'] || r['Código'] || r['CODIGO'] || '').trim()
      const descricao = String(r['descricao'] || r['Descrição'] || r['DESCRICAO'] || '').trim()
      const ativoRaw = String(r['ativo'] || r['Ativo'] || r['ATIVO'] || '1').trim().toLowerCase()
      const ativo = ativoRaw === '1' || ativoRaw === 'sim' || ativoRaw === 'true' || ativoRaw === 's'
      const _erro = !codigo ? 'Código obrigatório' : !descricao ? 'Descrição obrigatória' : undefined
      return { codigo, descricao, ativo, _erro }
    })
    setRows(parsed)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) parseFile(f)
  }

  const importar = async () => {
    const validas = rows.filter(r => !r._erro)
    if (validas.length === 0) return
    setImporting(true)
    const payload = validas.map(({ codigo, descricao, ativo }) => ({ codigo, descricao, ativo }))
    await supabase.from('empresa').upsert(payload, { onConflict: 'codigo' })
    setImporting(false)
    onSave()
  }

  const validas = rows.filter(r => !r._erro)
  const invalidas = rows.filter(r => r._erro)

  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={S.modalTitle}>Importar empresas via planilha</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('template_empresas.xlsx', ['codigo', 'descricao', 'ativo'], [{ codigo: '01', descricao: 'Nome da Empresa', ativo: 1 }])}>
            <Download size={13} /> Baixar template
          </button>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('empresas.xlsx', ['codigo', 'descricao', 'ativo'], dados.map(e => ({ codigo: e.codigo, descricao: e.descricao, ativo: e.ativo ? 1 : 0 })))}>
            <Download size={13} /> Exportar dados
          </button>
        </div>
      </div>
      <div style={S.infoBox('info')}>
        A planilha deve ter colunas: <strong>codigo</strong>, <strong>descricao</strong>, <strong>ativo</strong> (1/0 ou sim/não). O campo ativo é opcional (padrão: ativo).
      </div>
      <div
        style={S.dropzone(dragOver)}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={24} color="#868e96" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo .xlsx aqui ou clique para selecionar</div>
        <div style={{ fontSize: 12, color: '#adb5bd', marginTop: 4 }}>Suporta .xlsx e .xls</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFile} />
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#2f9e44' }}>✓ {validas.length} válidas</span>
            {invalidas.length > 0 && <span style={{ color: '#fa5252' }}>✗ {invalidas.length} com erro</span>}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
            <table style={S.previewTable}>
              <thead>
                <tr>
                  <th style={S.previewTh}>Código</th>
                  <th style={S.previewTh}>Descrição</th>
                  <th style={S.previewTh}>Ativo</th>
                  <th style={S.previewTh}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r._erro ? S.errorRow : undefined}>
                    <td style={S.previewTd}>{r.codigo || '—'}</td>
                    <td style={S.previewTd}>{r.descricao || '—'}</td>
                    <td style={S.previewTd}>{r.ativo ? 'Sim' : 'Não'}</td>
                    <td style={S.previewTd}>
                      {r._erro
                        ? <span style={{ color: '#fa5252', fontSize: 12 }}>✗ {r._erro}</span>
                        : <span style={{ color: '#2f9e44', fontSize: 12 }}>✓ OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        {validas.length > 0 && (
          <button style={S.btnPrimary} onClick={importar} disabled={importing}>
            <Upload size={14} />{importing ? 'Importando...' : `Importar ${validas.length} empresa${validas.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>
    </Modal>
  )
}

function EmpresasTab() {
  const [data, setData] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novo' | 'editar' | 'excluir' | 'importar' | null>(null)
  const [selecionado, setSelecionado] = useState<Empresa | null>(null)
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 100, minWidth: 60 },
    { label: 'Descrição', width: 400, minWidth: 120 },
    { label: 'Status', width: 120, minWidth: 80 },
    { label: '', width: 80, minWidth: 60 },
  ])

  const carregar = () => {
    setLoading(true)
    supabase.from('empresa').select('*').order('codigo').then(({ data }) => {
      setData((data || []) as Empresa[])
      setLoading(false)
    })
  }

  useEffect(() => { carregar() }, [])

  const excluir = async () => {
    if (!selecionado) return
    await supabase.from('empresa').delete().eq('id', selecionado.id)
    setModal(null)
    carregar()
  }

  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>

  return (
    <>
      <div style={S.toolbar}>
        <button style={S.btnPrimary} onClick={() => setModal('novo')}>
          <Plus size={14} /> Nova empresa
        </button>
        <button style={S.btnSecondary} onClick={() => setModal('importar')}>
          <Upload size={14} /> Importar planilha
        </button>
      </div>

      <div style={S.card}>
        <table style={{ ...S.table, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={4} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 32 }}>Nenhuma empresa cadastrada.</td></tr>
            ) : data.map(e => (
              <tr key={e.id}
                onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')}
                onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{e.codigo}</td>
                <td style={S_TD}>{e.descricao}</td>
                <td style={S_TD}><span style={S.badge(e.ativo)}>{e.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td style={{ ...S_TD, textAlign: 'right' }}>
                  <button style={S.btnIcon('#3b5bdb')} title="Editar" onClick={() => { setSelecionado(e); setModal('editar') }}>
                    <Pencil size={14} />
                  </button>
                  <button style={S.btnIcon('#fa5252')} title="Excluir" onClick={() => { setSelecionado(e); setModal('excluir') }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === 'novo' && <ModalEmpresa onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'editar' && <ModalEmpresa empresa={selecionado} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'importar' && <ModalImportEmpresa dados={data} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'excluir' && selecionado && (
        <ConfirmDelete
          msg={`Deseja excluir a empresa "${selecionado.descricao}"? Esta ação não pode ser desfeita.`}
          onConfirm={excluir}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )
}

// ── Filiais ───────────────────────────────────────────────
type Filial = { id: string; codigo: string; descricao: string; empresa_id: string; imp_fat: number; empresa?: { descricao: string } }

function ModalFilial({ filial, empresas, onSave, onClose }: {
  filial?: Filial | null
  empresas: Empresa[]
  onSave: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    codigo: filial?.codigo || '',
    descricao: filial?.descricao || '',
    empresa_id: filial?.empresa_id || (empresas[0]?.id || ''),
    imp_fat: filial?.imp_fat?.toString() || '0',
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async () => {
    if (!form.codigo.trim() || !form.descricao.trim()) { setErro('Código e descrição são obrigatórios.'); return }
    if (!form.empresa_id) { setErro('Selecione uma empresa.'); return }
    setSaving(true)
    const payload = {
      codigo: form.codigo.trim(),
      descricao: form.descricao.trim(),
      empresa_id: form.empresa_id,
      imp_fat: parseFloat(form.imp_fat) || 0,
    }
    const { error } = filial
      ? await supabase.from('filial').update(payload).eq('id', filial.id)
      : await supabase.from('filial').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }

  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{filial ? 'Editar filial' : 'Nova filial'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={S.formRow}>
        <label style={S.label}>Código</label>
        <input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder="ex: 001" />
      </div>
      <div style={S.formRow}>
        <label style={S.label}>Descrição</label>
        <input style={S.input} value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} placeholder="Nome da filial" />
      </div>
      <div style={S.formRow}>
        <label style={S.label}>Empresa</label>
        <select style={S.select} value={form.empresa_id} onChange={e => setForm(f => ({ ...f, empresa_id: e.target.value }))}>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.descricao}</option>)}
        </select>
      </div>
      <div style={S.formRow}>
        <label style={S.label}>Alíquota ISS (%)</label>
        <input style={S.input} type="number" step="0.01" min="0" max="100" value={form.imp_fat} onChange={e => setForm(f => ({ ...f, imp_fat: e.target.value }))} />
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}>
          <Check size={14} />{saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </Modal>
  )
}

// ── Modal importação filiais ──────────────────────────────
function ModalImportFilial({ dados, empresas, onSave, onClose }: { dados: Filial[]; empresas: Empresa[]; onSave: () => void; onClose: () => void }) {
  type PreviewRow = { codigo: string; descricao: string; empresa_codigo: string; imp_fat: number; empresa_id?: string; _erro?: string }
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const parseFile = async (file: File) => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const parsed: PreviewRow[] = json.map(r => {
      const codigo = String(r['codigo'] || r['Código'] || '').trim()
      const descricao = String(r['descricao'] || r['Descrição'] || '').trim()
      const empresa_codigo = String(r['empresa_codigo'] || r['empresa'] || r['Empresa'] || '').trim()
      const imp_fat = parseFloat(String(r['imp_fat'] || r['ISS'] || r['iss'] || '0').replace(',', '.')) || 0
      const empresa = empresas.find(e => e.codigo === empresa_codigo)
      const _erro = !codigo ? 'Código obrigatório' : !descricao ? 'Descrição obrigatória' : !empresa ? `Empresa "${empresa_codigo}" não encontrada` : undefined
      return { codigo, descricao, empresa_codigo, imp_fat, empresa_id: empresa?.id, _erro }
    })
    setRows(parsed)
  }

  const importar = async () => {
    const validas = rows.filter(r => !r._erro)
    if (validas.length === 0) return
    setImporting(true)
    const payload = validas.map(({ codigo, descricao, empresa_id, imp_fat }) => ({ codigo, descricao, empresa_id, imp_fat }))
    await supabase.from('filial').upsert(payload, { onConflict: 'codigo' })
    setImporting(false)
    onSave()
  }

  const validas = rows.filter(r => !r._erro)
  const invalidas = rows.filter(r => r._erro)

  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={S.modalTitle}>Importar filiais via planilha</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('template_filiais.xlsx', ['codigo', 'descricao', 'empresa_codigo', 'imp_fat'], [{ codigo: '001', descricao: 'Nome da Filial', empresa_codigo: '01', imp_fat: 2.5 }])}>
            <Download size={13} /> Baixar template
          </button>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('filiais.xlsx', ['codigo', 'descricao', 'empresa_codigo', 'imp_fat'], dados.map(f => ({ codigo: f.codigo, descricao: f.descricao, empresa_codigo: (f.empresa as any)?.codigo || '', imp_fat: f.imp_fat })))}>
            <Download size={13} /> Exportar dados
          </button>
        </div>
      </div>
      <div style={S.infoBox('info')}>
        Colunas obrigatórias: <strong>codigo</strong>, <strong>descricao</strong>, <strong>empresa_codigo</strong>. Opcional: <strong>imp_fat</strong> (alíquota ISS %).
      </div>
      <div
        style={S.dropzone(dragOver)}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={24} color="#868e96" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo .xlsx aqui ou clique para selecionar</div>
        <div style={{ fontSize: 12, color: '#adb5bd', marginTop: 4 }}>Suporta .xlsx e .xls</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#2f9e44' }}>✓ {validas.length} válidas</span>
            {invalidas.length > 0 && <span style={{ color: '#fa5252' }}>✗ {invalidas.length} com erro</span>}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
            <table style={S.previewTable}>
              <thead>
                <tr>
                  <th style={S.previewTh}>Código</th>
                  <th style={S.previewTh}>Descrição</th>
                  <th style={S.previewTh}>Empresa</th>
                  <th style={S.previewTh}>ISS %</th>
                  <th style={S.previewTh}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r._erro ? S.errorRow : undefined}>
                    <td style={S.previewTd}>{r.codigo || '—'}</td>
                    <td style={S.previewTd}>{r.descricao || '—'}</td>
                    <td style={S.previewTd}>{r.empresa_codigo || '—'}</td>
                    <td style={S.previewTd}>{r.imp_fat}%</td>
                    <td style={S.previewTd}>
                      {r._erro
                        ? <span style={{ color: '#fa5252', fontSize: 12 }}>✗ {r._erro}</span>
                        : <span style={{ color: '#2f9e44', fontSize: 12 }}>✓ OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        {validas.length > 0 && (
          <button style={S.btnPrimary} onClick={importar} disabled={importing}>
            <Upload size={14} />{importing ? 'Importando...' : `Importar ${validas.length} filial${validas.length > 1 ? 'is' : ''}`}
          </button>
        )}
      </div>
    </Modal>
  )
}

function FiliaisTab() {
  const [data, setData] = useState<Filial[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novo' | 'editar' | 'excluir' | 'importar' | null>(null)
  const [selecionado, setSelecionado] = useState<Filial | null>(null)
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 100, minWidth: 60 },
    { label: 'Descrição', width: 300, minWidth: 120 },
    { label: 'Empresa', width: 220, minWidth: 100 },
    { label: 'ISS %', width: 100, minWidth: 60 },
    { label: '', width: 80, minWidth: 60 },
  ])

  const carregar = () => {
    setLoading(true)
    Promise.all([
      supabase.from('filial').select('*, empresa(id, codigo, descricao, ativo)').order('codigo'),
      supabase.from('empresa').select('*').order('codigo'),
    ]).then(([{ data: filiais }, { data: emps }]) => {
      setData((filiais || []) as Filial[])
      setEmpresas((emps || []) as Empresa[])
      setLoading(false)
    })
  }

  useEffect(() => { carregar() }, [])

  const excluir = async () => {
    if (!selecionado) return
    await supabase.from('filial').delete().eq('id', selecionado.id)
    setModal(null)
    carregar()
  }

  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>

  return (
    <>
      <div style={S.toolbar}>
        <button style={S.btnPrimary} onClick={() => setModal('novo')}>
          <Plus size={14} /> Nova filial
        </button>
        <button style={S.btnSecondary} onClick={() => setModal('importar')}>
          <Upload size={14} /> Importar planilha
        </button>
      </div>

      <div style={S.card}>
        <table style={{ ...S.table, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={5} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 32 }}>Nenhuma filial cadastrada.</td></tr>
            ) : data.map(f => (
              <tr key={f.id}
                onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')}
                onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{f.codigo}</td>
                <td style={S_TD}>{f.descricao}</td>
                <td style={S_TD}>{(f.empresa as any)?.descricao || '—'}</td>
                <td style={S_TD}>{f.imp_fat}%</td>
                <td style={{ ...S_TD, textAlign: 'right' }}>
                  <button style={S.btnIcon('#3b5bdb')} title="Editar" onClick={() => { setSelecionado(f); setModal('editar') }}>
                    <Pencil size={14} />
                  </button>
                  <button style={S.btnIcon('#fa5252')} title="Excluir" onClick={() => { setSelecionado(f); setModal('excluir') }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === 'novo' && <ModalFilial empresas={empresas} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'editar' && <ModalFilial filial={selecionado} empresas={empresas} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'importar' && <ModalImportFilial dados={data} empresas={empresas} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'excluir' && selecionado && (
        <ConfirmDelete
          msg={`Deseja excluir a filial "${selecionado.descricao}"? Esta ação não pode ser desfeita.`}
          onConfirm={excluir}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  )
}

// ── Plano Orçamentário ────────────────────────────────────
function PlanoTab() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase.from('plano_orcamentario').select('*').order('codigo').then(({ data }) => {
      setData(data || [])
      const n1ids = new Set((data || []).filter((x: any) => x.nivel === 1).map((x: any) => x.id))
      setExpandidos(n1ids)
      setLoading(false)
    })
  }, [])

  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>
  if (data.length === 0) return (
    <div style={{ ...S.card, padding: 32, textAlign: 'center', color: '#aaa' }}>
      Plano orçamentário vazio.<br />
      <small>Execute o arquivo <code>supabase_002_plano_orcamentario.sql</code> no Supabase.</small>
    </div>
  )

  const toggle = (id: string) => setExpandidos(prev => {
    const novo = new Set(prev); novo.has(id) ? novo.delete(id) : novo.add(id); return novo
  })

  const n1 = data.filter(x => x.nivel === 1)
  const n2por = (pai: string) => data.filter(x => x.nivel === 2 && x.pai_id === pai)
  const n3por = (pai: string) => data.filter(x => x.nivel === 3 && x.pai_id === pai)

  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 140, minWidth: 80 },
    { label: 'Descrição', width: 380, minWidth: 150 },
    { label: 'Nível', width: 80, minWidth: 60 },
    { label: 'Natureza', width: 120, minWidth: 80 },
    { label: 'Folha', width: 80, minWidth: 60 },
  ])

  return (
    <div style={S.card}>
      <table style={{ ...S.table, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>
            ))}
          </tr>
        </thead>
        <tbody>
          {n1.map(item1 => (
            <React.Fragment key={item1.id}>
              <tr style={{ background: '#f8f9fa', cursor: 'pointer' }} onClick={() => toggle(item1.id)}>
                <td style={{ ...S_TD, fontFamily: 'monospace', fontWeight: 700, color: '#1971c2' }}>
                  {expandidos.has(item1.id) ? '▾' : '▸'} {item1.codigo}
                </td>
                <td style={{ ...S_TD, fontWeight: 700, color: '#1971c2' }}>{item1.descricao}</td>
                <td style={S_TD}><span style={S.nivel(1)}>N1</span></td>
                <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{item1.natureza}</td>
                <td style={S_TD}>—</td>
              </tr>
              {expandidos.has(item1.id) && n2por(item1.id).map(item2 => (
                <React.Fragment key={item2.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => toggle(item2.id)}>
                    <td style={{ ...S_TD, ...S.indent(2), fontFamily: 'monospace', color: '#6741d9' }}>
                      {expandidos.has(item2.id) ? '▾' : '▸'} {item2.codigo}
                    </td>
                    <td style={{ ...S_TD, color: '#6741d9' }}>{item2.descricao}</td>
                    <td style={S_TD}><span style={S.nivel(2)}>N2</span></td>
                    <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{item2.natureza}</td>
                    <td style={S_TD}>—</td>
                  </tr>
                  {expandidos.has(item2.id) && n3por(item2.id).map(item3 => (
                    <tr key={item3.id} style={{ background: '#fffdf7' }}>
                      <td style={{ ...S_TD, ...S.indent(3), fontFamily: 'monospace', fontSize: 12, color: '#868e96' }}>{item3.codigo}</td>
                      <td style={{ ...S_TD, fontSize: 13 }}>{item3.descricao}</td>
                      <td style={S_TD}><span style={S.nivel(3)}>N3</span></td>
                      <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{item3.natureza}</td>
                      <td style={S_TD}>{item3.grupo_folha ? <span style={{ color: '#2f9e44', fontSize: 12 }}>✓ Sim</span> : '—'}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────
export default function CadastrosPage() {
  const [aba, setAba] = useState<Aba>('empresas')

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Cadastros</h1>
          <p style={S.subtitle}>Empresas · Filiais · Plano Orçamentário</p>
        </div>
      </div>

      <div style={S.tabs}>
        {(['empresas', 'filiais', 'plano'] as Aba[]).map(a => (
          <button key={a} style={S.tab(aba === a)} onClick={() => setAba(a)}>
            {a === 'empresas' ? 'Empresas' : a === 'filiais' ? 'Filiais' : 'Plano Orçamentário'}
          </button>
        ))}
      </div>

      {aba === 'empresas' && <EmpresasTab />}
      {aba === 'filiais' && <FiliaisTab />}
      {aba === 'plano' && <PlanoTab />}
    </div>
  )
}
