import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Pencil, Trash2, Plus, Upload, Check, AlertTriangle, Download, Link, Settings } from 'lucide-react'
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

type Aba = 'empresas' | 'filiais' | 'plano' | 'centrocusto' | 'contacontabil' | 'verbas' | 'funcionarios' | 'dimensoes'

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
    await supabase.from('empresa').upsert(payload, { onConflict: 'tenant_id,codigo' })
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
    await supabase.from('filial').upsert(payload, { onConflict: 'tenant_id,codigo' })
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
function ModalAmarracaoContas({ item, onClose }: { item: any; onClose: () => void }) {
  const [vinculadas, setVinculadas] = useState<{ id: string; conta_id: string; conta: { codigo: string; descricao: string } }[]>([])
  const [todasContas, setTodasContas] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = () => {
    Promise.all([
      supabase.from('item_conta_contabil').select('id, conta_id, conta:conta_id(codigo,descricao)').eq('item_orc_id', item.id),
      supabase.from('conta_contabil').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
    ]).then(([{ data: v }, { data: c }]) => {
      setVinculadas((v || []) as any)
      setTodasContas((c || []) as { id: string; codigo: string; descricao: string }[])
      setLoading(false)
    })
  }
  useEffect(() => { carregar() }, [])

  const vincularIds = new Set(vinculadas.map(v => v.conta_id))
  const disponiveis = todasContas.filter(c =>
    !vincularIds.has(c.id) &&
    (busca ? c.codigo.includes(busca) || c.descricao.toLowerCase().includes(busca.toLowerCase()) : true)
  )

  const adicionar = async (contaId: string) => {
    await supabase.from('item_conta_contabil').insert({ item_orc_id: item.id, conta_id: contaId })
    carregar()
  }
  const remover = async (vinculoId: string) => {
    await supabase.from('item_conta_contabil').delete().eq('id', vinculoId)
    carregar()
  }

  return (
    <Modal onClose={onClose} wide>
      <div style={S.modalTitle}>Contas vinculadas — {item.codigo} · {item.descricao}</div>
      {loading ? <p style={{ color: '#aaa' }}>Carregando...</p> : (
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Contas já vinculadas */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#495057', marginBottom: 8 }}>VINCULADAS ({vinculadas.length})</div>
            {vinculadas.length === 0
              ? <div style={{ fontSize: 13, color: '#aaa', padding: '12px 0' }}>Nenhuma conta vinculada.</div>
              : <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {vinculadas.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f3f5' }}>
                    <span style={{ fontSize: 13 }}><span style={{ fontFamily: 'monospace', color: '#868e96', marginRight: 8 }}>{v.conta.codigo}</span>{v.conta.descricao}</span>
                    <button style={S.btnIcon('#fa5252')} onClick={() => remover(v.id)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            }
          </div>
          {/* Adicionar conta */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#495057', marginBottom: 8 }}>ADICIONAR CONTA</div>
            <input style={{ ...S.input, marginBottom: 8 }} placeholder="Buscar por código ou descrição…" value={busca} onChange={e => setBusca(e.target.value)} />
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
              {disponiveis.slice(0, 50).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', borderBottom: '1px solid #f8f9fa', cursor: 'pointer' }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = '#f0f2ff')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <span style={{ fontSize: 13 }}><span style={{ fontFamily: 'monospace', color: '#868e96', marginRight: 8 }}>{c.codigo}</span>{c.descricao}</span>
                  <button style={S.btnIcon('#3b5bdb')} onClick={() => adicionar(c.id)}><Plus size={13} /></button>
                </div>
              ))}
              {disponiveis.length === 0 && <div style={{ padding: 12, fontSize: 13, color: '#aaa' }}>{busca ? 'Nenhum resultado.' : 'Todas as contas já estão vinculadas.'}</div>}
            </div>
          </div>
        </div>
      )}
      <div style={S.modalFooter}>
        <button style={S.btnPrimary} onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  )
}

function PlanoTab() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [amarrItem, setAmarrItem] = useState<any | null>(null)

  // Hook ANTES dos early returns — Rules of Hooks
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 140, minWidth: 80 },
    { label: 'Descrição', width: 340, minWidth: 150 },
    { label: 'Nível', width: 70, minWidth: 60 },
    { label: 'Natureza', width: 110, minWidth: 80 },
    { label: 'Folha', width: 70, minWidth: 60 },
    { label: 'Contas', width: 80, minWidth: 60 },
  ])

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

  return (
    <>
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
                  <td style={S_TD} />
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
                      <td style={S_TD} />
                    </tr>
                    {expandidos.has(item2.id) && n3por(item2.id).map(item3 => (
                      <tr key={item3.id} style={{ background: '#fffdf7' }}>
                        <td style={{ ...S_TD, ...S.indent(3), fontFamily: 'monospace', fontSize: 12, color: '#868e96' }}>{item3.codigo}</td>
                        <td style={{ ...S_TD, fontSize: 13 }}>{item3.descricao}</td>
                        <td style={S_TD}><span style={S.nivel(3)}>N3</span></td>
                        <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{item3.natureza}</td>
                        <td style={S_TD}>{item3.grupo_folha ? <span style={{ color: '#2f9e44', fontSize: 12 }}>✓ Sim</span> : '—'}</td>
                        <td style={{ ...S_TD, textAlign: 'center' }}>
                          {!item3.grupo_folha && (
                            <button style={S.btnIcon('#3b5bdb')} title="Vincular contas contábeis" onClick={() => setAmarrItem(item3)}>
                              <Link size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {amarrItem && <ModalAmarracaoContas item={amarrItem} onClose={() => setAmarrItem(null)} />}
    </>
  )
}

// ── Centro de Custo ───────────────────────────────────────
type CentroCusto = { id: string; codigo: string; descricao: string; nivel: number; area: string; divisao: string; bu: string; ativo: boolean }

function ModalCentroCusto({ cc, onSave, onClose }: { cc?: CentroCusto | null; onSave: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ codigo: cc?.codigo || '', descricao: cc?.descricao || '', nivel: cc?.nivel ?? 3, area: cc?.area || '', divisao: cc?.divisao || '', bu: cc?.bu || '', ativo: cc?.ativo ?? true })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async () => {
    if (!form.codigo.trim() || !form.descricao.trim()) { setErro('Código e descrição são obrigatórios.'); return }
    setSaving(true)
    const payload = { codigo: form.codigo.trim(), descricao: form.descricao.trim(), nivel: form.nivel, area: form.area.trim() || null, divisao: form.divisao.trim() || null, bu: form.bu.trim() || null, ativo: form.ativo }
    const { error } = cc
      ? await supabase.from('centro_custo').update(payload).eq('id', cc.id)
      : await supabase.from('centro_custo').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }
  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{cc ? 'Editar centro de custo' : 'Novo centro de custo'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={S.formRow}><label style={S.label}>Código</label><input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Nível</label>
        <select style={S.select} value={form.nivel} onChange={e => setForm(f => ({ ...f, nivel: Number(e.target.value) }))}>
          <option value={1}>1 — Grupo</option>
          <option value={2}>2 — Subgrupo</option>
          <option value={3}>3 — Analítico</option>
        </select>
      </div>
      <div style={S.formRow}><label style={S.label}>Área</label><input style={S.input} value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Divisão</label><input style={S.input} value={form.divisao} onChange={e => setForm(f => ({ ...f, divisao: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>BU</label><input style={S.input} value={form.bu} onChange={e => setForm(f => ({ ...f, bu: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Status</label>
        <select style={S.select} value={form.ativo ? '1' : '0'} onChange={e => setForm(f => ({ ...f, ativo: e.target.value === '1' }))}>
          <option value="1">Ativo</option><option value="0">Inativo</option>
        </select>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}><Check size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

function ModalImportCentroCusto({ dados, onSave, onClose }: { dados: CentroCusto[]; onSave: () => void; onClose: () => void }) {
  type PreviewRow = { codigo: string; descricao: string; nivel: number; area: string; divisao: string; bu: string; _erro?: string }
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [erroImport, setErroImport] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parseFile = async (file: File) => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const isTOTVS = json.length > 0 && ('CTT_CUSTO_11' in json[0])
    const parsed: PreviewRow[] = json.map(r => {
      const codigo = isTOTVS
        ? String(r['CTT_CUSTO_11'] || '').trim()
        : String(r['codigo'] || '').trim()
      const descricao = isTOTVS
        ? String(r['CTT_DESC01_11'] || '').trim()
        : String(r['descricao'] || '').trim()
      const area = String(r['AREA'] || r['area'] || '').trim()
      const divisao = String(r['DIVISAO'] || r['divisao'] || '').trim()
      const bu = String(r['BU'] || r['bu'] || '').trim()
      // TOTVS CTT_CUSTO_11 = sempre analítico (nível 3); planilha simples lê coluna 'nivel' se existir
      const nivel = isTOTVS ? 3 : (Number(r['nivel'] || r['NIVEL'] || 3))
      const _erro = !codigo ? 'Código obrigatório' : !descricao ? 'Descrição obrigatória' : undefined
      return { codigo, descricao, area, divisao, bu, nivel, _erro }
    }).filter(r => r.codigo && r.codigo !== '01 - INDEFINIDO')
    setRows(parsed)
  }

  const importar = async () => {
    const validas = rows.filter(r => !r._erro)
    if (!validas.length) return
    setImporting(true)
    setErroImport('')
    const payload = validas.map(({ codigo, descricao, area, divisao, bu, nivel }) => ({ codigo, descricao, area: area || null, divisao: divisao || null, bu: bu || null, nivel }))
    const uniqPayload = [...new Map(payload.map(r => [r.codigo, r])).values()]
    const { error } = await supabase.from('centro_custo').upsert(uniqPayload, { onConflict: 'tenant_id,codigo' })
    setImporting(false)
    if (error) { setErroImport(error.message); return }
    onSave()
  }

  const validas = rows.filter(r => !r._erro)
  const invalidas = rows.filter(r => r._erro)
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={S.modalTitle}>Importar centros de custo via planilha</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('template_centrocusto.xlsx', ['codigo', 'descricao', 'nivel', 'area', 'divisao', 'bu'], [{ codigo: '314', descricao: 'BASE ERP TRADICIONAL', nivel: 3, area: '2-Serviços', divisao: 'Base', bu: 'Erp Tradicional' }])}><Download size={13} /> Baixar template</button>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('centrocusto.xlsx', ['codigo', 'descricao', 'nivel', 'area', 'divisao', 'bu'], dados.map(c => ({ codigo: c.codigo, descricao: c.descricao, nivel: c.nivel ?? 3, area: c.area || '', divisao: c.divisao || '', bu: c.bu || '' })))}><Download size={13} /> Exportar dados</button>
        </div>
      </div>
      <div style={S.infoBox('info')}>Aceita planilha simples (<strong>codigo, descricao, nivel, area, divisao, bu</strong>) ou exportação direta do TOTVS (<strong>CTT_CUSTO_11</strong>). Importação TOTVS define nivel=3 automaticamente.</div>
      <div style={S.dropzone(dragOver)} onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }} onClick={() => fileRef.current?.click()}>
        <Upload size={24} color="#868e96" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo .xlsx aqui ou clique para selecionar</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
      </div>
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#2f9e44' }}>✓ {validas.length} válidas</span>
            {invalidas.length > 0 && <span style={{ color: '#fa5252' }}>✗ {invalidas.length} com erro</span>}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
            <table style={S.previewTable}>
              <thead><tr><th style={S.previewTh}>Código</th><th style={S.previewTh}>Descrição</th><th style={S.previewTh}>Área</th><th style={S.previewTh}>Divisão</th><th style={S.previewTh}>BU</th><th style={S.previewTh}>Status</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} style={r._erro ? S.errorRow : undefined}>
                  <td style={S.previewTd}>{r.codigo || '—'}</td><td style={S.previewTd}>{r.descricao || '—'}</td>
                  <td style={S.previewTd}>{r.area || '—'}</td><td style={S.previewTd}>{r.divisao || '—'}</td><td style={S.previewTd}>{r.bu || '—'}</td>
                  <td style={S.previewTd}>{r._erro ? <span style={{ color: '#fa5252', fontSize: 12 }}>✗ {r._erro}</span> : <span style={{ color: '#2f9e44', fontSize: 12 }}>✓ OK</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {erroImport && <div style={{ ...S.infoBox('warn'), marginTop: 12 }}>{erroImport}</div>}
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        {validas.length > 0 && <button style={S.btnPrimary} onClick={importar} disabled={importing}><Upload size={14} />{importing ? 'Importando...' : `Importar ${validas.length} registro${validas.length > 1 ? 's' : ''}`}</button>}
      </div>
    </Modal>
  )
}

function CentroCustoTab() {
  const [data, setData] = useState<CentroCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novo' | 'editar' | 'excluir' | 'importar' | null>(null)
  const [selecionado, setSelecionado] = useState<CentroCusto | null>(null)
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 90, minWidth: 60 },
    { label: 'Descrição', width: 240, minWidth: 120 },
    { label: 'Área', width: 160, minWidth: 80 },
    { label: 'Divisão', width: 140, minWidth: 80 },
    { label: 'BU', width: 160, minWidth: 80 },
    { label: 'Status', width: 100, minWidth: 80 },
    { label: '', width: 80, minWidth: 60 },
  ])
  const carregar = () => {
    setLoading(true)
    supabase.from('centro_custo').select('*').order('codigo').then(({ data }) => { setData((data || []) as CentroCusto[]); setLoading(false) })
  }
  useEffect(() => { carregar() }, [])
  const excluir = async () => {
    if (!selecionado) return
    await supabase.from('centro_custo').delete().eq('id', selecionado.id)
    setModal(null); carregar()
  }
  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>
  return (
    <>
      <div style={S.toolbar}>
        <button style={S.btnPrimary} onClick={() => setModal('novo')}><Plus size={14} /> Novo CC</button>
        <button style={S.btnSecondary} onClick={() => setModal('importar')}><Upload size={14} /> Importar planilha</button>
      </div>
      <div style={S.card}>
        <table style={{ ...S.table, tableLayout: 'fixed' }}>
          <thead><tr>{cols.map((c, i) => <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>)}</tr></thead>
          <tbody>
            {data.length === 0
              ? <tr><td colSpan={7} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 32 }}>Nenhum centro de custo cadastrado.</td></tr>
              : data.map(c => (
                <tr key={c.id} onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{c.codigo}</td>
                  <td style={S_TD}>{c.descricao}</td>
                  <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{c.area || '—'}</td>
                  <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{c.divisao || '—'}</td>
                  <td style={{ ...S_TD, fontSize: 12, color: '#868e96' }}>{c.bu || '—'}</td>
                  <td style={S_TD}><span style={S.badge(c.ativo)}>{c.ativo ? 'Ativo' : 'Inativo'}</span></td>
                  <td style={{ ...S_TD, textAlign: 'right' }}>
                    <button style={S.btnIcon('#3b5bdb')} onClick={() => { setSelecionado(c); setModal('editar') }}><Pencil size={14} /></button>
                    <button style={S.btnIcon('#fa5252')} onClick={() => { setSelecionado(c); setModal('excluir') }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      {modal === 'novo' && <ModalCentroCusto onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'editar' && <ModalCentroCusto cc={selecionado} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'importar' && <ModalImportCentroCusto dados={data} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'excluir' && selecionado && <ConfirmDelete msg={`Excluir o CC "${selecionado.descricao}"?`} onConfirm={excluir} onCancel={() => setModal(null)} />}
    </>
  )
}

// ── Conta Contábil ────────────────────────────────────────
type ContaContabil = { id: string; codigo: string; descricao: string; ativo: boolean }

function ModalContaContabil({ conta, onSave, onClose }: { conta?: ContaContabil | null; onSave: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ codigo: conta?.codigo || '', descricao: conta?.descricao || '', ativo: conta?.ativo ?? true })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async () => {
    if (!form.codigo.trim() || !form.descricao.trim()) { setErro('Código e descrição são obrigatórios.'); return }
    setSaving(true)
    const payload = { codigo: form.codigo.trim(), descricao: form.descricao.trim(), ativo: form.ativo }
    const { error } = conta
      ? await supabase.from('conta_contabil').update(payload).eq('id', conta.id)
      : await supabase.from('conta_contabil').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }
  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{conta ? 'Editar conta contábil' : 'Nova conta contábil'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={S.formRow}><label style={S.label}>Código</label><input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder="ex: 41011001" /></div>
      <div style={S.formRow}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Status</label>
        <select style={S.select} value={form.ativo ? '1' : '0'} onChange={e => setForm(f => ({ ...f, ativo: e.target.value === '1' }))}>
          <option value="1">Ativo</option><option value="0">Inativo</option>
        </select>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}><Check size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

function ModalImportContaContabil({ dados, onSave, onClose }: { dados: ContaContabil[]; onSave: () => void; onClose: () => void }) {
  type PreviewRow = { codigo: string; descricao: string; _erro?: string }
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [erroImport, setErroImport] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parseFile = async (file: File) => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    // Detecta formato TOTVS (CT1_CONTA_11) ou simples (codigo)
    const isTOTVS = json.length > 0 && 'CT1_CONTA_11' in json[0]
    const parsed: PreviewRow[] = json
      .filter(r => isTOTVS ? String(r['CLASSE_CONTABIL'] || '') === '2' : true)
      .map(r => {
        const codigo = isTOTVS
          ? String(r['CT1_CONTA_11'] || '').trim()
          : String(r['codigo'] || '').trim()
        const descricao = isTOTVS
          ? String(r['CT1_DESC01_11'] || '').trim()
          : String(r['descricao'] || '').trim()
        const _erro = !codigo ? 'Código obrigatório' : !descricao ? 'Descrição obrigatória' : undefined
        return { codigo, descricao, _erro }
      }).filter(r => r.codigo && r.codigo !== '01 - INDEFINIDO')
    setRows(parsed)
  }

  const importar = async () => {
    const validas = rows.filter(r => !r._erro)
    if (!validas.length) return
    setImporting(true)
    setErroImport('')
    const uniq = [...new Map(validas.map(r => [r.codigo, r])).values()]
    const { error } = await supabase.from('conta_contabil').upsert(uniq.map(({ codigo, descricao }) => ({ codigo, descricao })), { onConflict: 'tenant_id,codigo' })
    setImporting(false)
    if (error) { setErroImport(error.message); return }
    onSave()
  }

  const validas = rows.filter(r => !r._erro)
  const invalidas = rows.filter(r => r._erro)
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={S.modalTitle}>Importar contas contábeis via planilha</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('template_contas.xlsx', ['codigo', 'descricao'], [{ codigo: '41011001', descricao: 'SALARIOS' }])}><Download size={13} /> Baixar template</button>
          <button style={S.btnSecondary} onClick={() => downloadXlsx('contas.xlsx', ['codigo', 'descricao'], dados.map(c => ({ codigo: c.codigo, descricao: c.descricao })))}><Download size={13} /> Exportar dados</button>
        </div>
      </div>
      <div style={S.infoBox('info')}>Aceita planilha simples (<strong>codigo, descricao</strong>) ou exportação TOTVS (<strong>CT1_CONTA_11</strong>, filtrando CLASSE_CONTABIL = 2 automaticamente).</div>
      <div style={S.dropzone(dragOver)} onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }} onClick={() => fileRef.current?.click()}>
        <Upload size={24} color="#868e96" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo .xlsx ou .csv aqui</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
      </div>
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#2f9e44' }}>✓ {validas.length} válidas</span>
            {invalidas.length > 0 && <span style={{ color: '#fa5252' }}>✗ {invalidas.length} com erro</span>}
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
            <table style={S.previewTable}>
              <thead><tr><th style={S.previewTh}>Código</th><th style={S.previewTh}>Descrição</th><th style={S.previewTh}>Status</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} style={r._erro ? S.errorRow : undefined}>
                  <td style={S.previewTd}>{r.codigo || '—'}</td>
                  <td style={S.previewTd}>{r.descricao || '—'}</td>
                  <td style={S.previewTd}>{r._erro ? <span style={{ color: '#fa5252', fontSize: 12 }}>✗ {r._erro}</span> : <span style={{ color: '#2f9e44', fontSize: 12 }}>✓ OK</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {erroImport && <div style={{ ...S.infoBox('warn'), marginTop: 12 }}>{erroImport}</div>}
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        {validas.length > 0 && <button style={S.btnPrimary} onClick={importar} disabled={importing}><Upload size={14} />{importing ? 'Importando...' : `Importar ${validas.length} conta${validas.length > 1 ? 's' : ''}`}</button>}
      </div>
    </Modal>
  )
}

function ContaContabilTab() {
  const [data, setData] = useState<ContaContabil[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novo' | 'editar' | 'excluir' | 'importar' | null>(null)
  const [selecionado, setSelecionado] = useState<ContaContabil | null>(null)
  const [busca, setBusca] = useState('')
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 120, minWidth: 80 },
    { label: 'Descrição', width: 400, minWidth: 150 },
    { label: 'Status', width: 100, minWidth: 80 },
    { label: '', width: 80, minWidth: 60 },
  ])
  const carregar = () => {
    setLoading(true)
    supabase.from('conta_contabil').select('*').order('codigo').then(({ data }) => { setData((data || []) as ContaContabil[]); setLoading(false) })
  }
  useEffect(() => { carregar() }, [])
  const excluir = async () => {
    if (!selecionado) return
    await supabase.from('conta_contabil').delete().eq('id', selecionado.id)
    setModal(null); carregar()
  }
  const filtrado = busca ? data.filter(c => c.codigo.includes(busca) || c.descricao.toLowerCase().includes(busca.toLowerCase())) : data
  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>
  return (
    <>
      <div style={S.toolbar}>
        <button style={S.btnPrimary} onClick={() => setModal('novo')}><Plus size={14} /> Nova conta</button>
        <button style={S.btnSecondary} onClick={() => setModal('importar')}><Upload size={14} /> Importar planilha</button>
        <input style={{ ...S.select, width: 240 }} placeholder="Buscar por código ou descrição…" value={busca} onChange={e => setBusca(e.target.value)} />
      </div>
      <div style={S.card}>
        <table style={{ ...S.table, tableLayout: 'fixed' }}>
          <thead><tr>{cols.map((c, i) => <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>)}</tr></thead>
          <tbody>
            {filtrado.length === 0
              ? <tr><td colSpan={4} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 32 }}>{busca ? 'Nenhum resultado.' : 'Nenhuma conta cadastrada.'}</td></tr>
              : filtrado.map(c => (
                <tr key={c.id} onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{c.codigo}</td>
                  <td style={S_TD}>{c.descricao}</td>
                  <td style={S_TD}><span style={S.badge(c.ativo)}>{c.ativo ? 'Ativo' : 'Inativo'}</span></td>
                  <td style={{ ...S_TD, textAlign: 'right' }}>
                    <button style={S.btnIcon('#3b5bdb')} onClick={() => { setSelecionado(c); setModal('editar') }}><Pencil size={14} /></button>
                    <button style={S.btnIcon('#fa5252')} onClick={() => { setSelecionado(c); setModal('excluir') }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      {modal === 'novo' && <ModalContaContabil onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'editar' && <ModalContaContabil conta={selecionado} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'importar' && <ModalImportContaContabil dados={data} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'excluir' && selecionado && <ConfirmDelete msg={`Excluir a conta "${selecionado.codigo} — ${selecionado.descricao}"?`} onConfirm={excluir} onCancel={() => setModal(null)} />}
    </>
  )
}

// ── Verbas de Folha ───────────────────────────────────────
type VerbaFolha = {
  id: string; codigo: string; descricao: string
  tipo: string | null; tipo_pdb: string | null
  conta_id: string | null; item_orc_id: string | null; ativo: boolean
  conta?: { codigo: string; descricao: string } | null
  item_orc?: { codigo: string; descricao: string } | null
}

function ModalVerbaFolha({ verba, contas, itens, onSave, onClose }: {
  verba?: VerbaFolha | null
  contas: { id: string; codigo: string; descricao: string }[]
  itens: { id: string; codigo: string; descricao: string }[]
  onSave: () => void; onClose: () => void
}) {
  const [form, setForm] = useState({
    codigo: verba?.codigo || '', descricao: verba?.descricao || '',
    tipo: verba?.tipo || '', tipo_pdb: verba?.tipo_pdb || '',
    conta_id: verba?.conta_id || '', item_orc_id: verba?.item_orc_id || '', ativo: verba?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async () => {
    if (!form.codigo.trim() || !form.descricao.trim()) { setErro('Código e descrição são obrigatórios.'); return }
    setSaving(true)
    const payload = {
      codigo: form.codigo.trim(), descricao: form.descricao.trim(),
      tipo: form.tipo || null, tipo_pdb: form.tipo_pdb || null,
      conta_id: form.conta_id || null, item_orc_id: form.item_orc_id || null, ativo: form.ativo,
    }
    const { error } = verba
      ? await supabase.from('verba_folha').update(payload).eq('id', verba.id)
      : await supabase.from('verba_folha').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }
  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{verba ? 'Editar verba' : 'Nova verba'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Código</label><input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} /></div>
        <div style={{ ...S.formRow, flex: 2 }}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Tipo</label>
          <select style={S.select} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
            <option value="">—</option><option value="D">D – Diário</option><option value="H">H – Horas</option><option value="V">V – Valor</option>
          </select>
        </div>
        <div style={{ ...S.formRow, flex: 2 }}><label style={S.label}>Tipo PDB</label>
          <select style={S.select} value={form.tipo_pdb} onChange={e => setForm(f => ({ ...f, tipo_pdb: e.target.value }))}>
            <option value="">—</option>
            <option value="PROVENTO">PROVENTO</option><option value="DESCONTO">DESCONTO</option>
            <option value="BASE PROVENTO">BASE PROVENTO</option><option value="BASE DESCONTO">BASE DESCONTO</option>
          </select>
        </div>
      </div>
      <div style={S.formRow}><label style={S.label}>Conta Contábil</label>
        <select style={S.select} value={form.conta_id} onChange={e => setForm(f => ({ ...f, conta_id: e.target.value }))}>
          <option value="">— sem vínculo —</option>
          {contas.map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>)}
        </select>
      </div>
      <div style={S.formRow}><label style={S.label}>Item Orçamentário</label>
        <select style={S.select} value={form.item_orc_id} onChange={e => setForm(f => ({ ...f, item_orc_id: e.target.value }))}>
          <option value="">— sem vínculo —</option>
          {itens.map(i => <option key={i.id} value={i.id}>{i.codigo} — {i.descricao}</option>)}
        </select>
      </div>
      <div style={S.formRow}><label style={S.label}>Status</label>
        <select style={S.select} value={form.ativo ? '1' : '0'} onChange={e => setForm(f => ({ ...f, ativo: e.target.value === '1' }))}>
          <option value="1">Ativo</option><option value="0">Inativo</option>
        </select>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}><Check size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

function ModalImportVerbaFolha({ dados, contas, itens, onSave, onClose }: {
  dados: VerbaFolha[]
  contas: { id: string; codigo: string }[]
  itens: { id: string; codigo: string }[]
  onSave: () => void; onClose: () => void
}) {
  type PreviewRow = { codigo: string; descricao: string; tipo: string; tipo_pdb: string; conta_id: string | null; item_orc_id: string | null; _erro?: string }
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [erroImport, setErroImport] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parseFile = async (file: File) => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const isTOTVS = json.length > 0 && ('BK_SRV' in json[0] || 'RV_COD' in json[0])
    const contaMap = Object.fromEntries(contas.map(c => [c.codigo.trim(), c.id]))
    const itemMap = Object.fromEntries(itens.map(i => [i.codigo.trim(), i.id]))
    const parsed: PreviewRow[] = json.map(r => {
      const codigo = isTOTVS ? String(r['RV_COD'] || '').trim() : String(r['codigo'] || '').trim()
      const descricao = isTOTVS ? String(r['RV_DESC'] || '').trim() : String(r['descricao'] || '').trim()
      const tipo = isTOTVS ? String(r['RV_TIPO'] || '').trim() : String(r['tipo'] || '').trim()
      const tipo_pdb = isTOTVS ? String(r['Tipo_PDB'] || '').trim() : String(r['tipo_pdb'] || '').trim()
      let conta_id: string | null = null
      let item_orc_id: string | null = null
      if (isTOTVS) {
        const bkConta = String(r['BK_CONTA'] || '')
        const bkItem = String(r['ID_ITEMORC'] || '')
        const contaCod = bkConta.includes('||') ? bkConta.split('||').pop()?.trim() || '' : ''
        const itemCod = bkItem.includes('||') ? bkItem.split('||').pop()?.trim() || '' : ''
        conta_id = contaMap[contaCod] || null
        item_orc_id = itemMap[itemCod] || null
      }
      const _erro = !codigo ? 'Código obrigatório' : !descricao ? 'Descrição obrigatória' : undefined
      return { codigo, descricao, tipo, tipo_pdb, conta_id, item_orc_id, _erro }
    }).filter(r => r.codigo)
    setRows(parsed)
  }

  const importar = async () => {
    const validas = rows.filter(r => !r._erro)
    if (!validas.length) return
    setImporting(true)
    setErroImport('')
    const uniqVerbas = [...new Map(validas.map(r => [r.codigo, r])).values()]
    const { error } = await supabase.from('verba_folha').upsert(
      uniqVerbas.map(({ codigo, descricao, tipo, tipo_pdb, conta_id, item_orc_id }) => ({ codigo, descricao, tipo: tipo || null, tipo_pdb: tipo_pdb || null, conta_id, item_orc_id })),
      { onConflict: 'tenant_id,codigo' }
    )
    setImporting(false)
    if (error) { setErroImport(error.message); return }
    onSave()
  }

  const validas = rows.filter(r => !r._erro)
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={S.modalTitle}>Importar verbas via planilha</div>
        <button style={S.btnSecondary} onClick={() => downloadXlsx('template_verbas.xlsx', ['codigo', 'descricao', 'tipo', 'tipo_pdb'], [{ codigo: '001', descricao: 'SALARIO', tipo: 'D', tipo_pdb: 'PROVENTO' }])}><Download size={13} /> Baixar template</button>
      </div>
      <div style={S.infoBox('info')}>Aceita planilha simples ou exportação TOTVS (<strong>srv.csv</strong> — resolve conta e item orçamentário automaticamente).</div>
      <div style={S.dropzone(dragOver)} onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }} onClick={() => fileRef.current?.click()}>
        <Upload size={24} color="#868e96" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo aqui</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
      </div>
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#2f9e44' }}>✓ {validas.length} válidas</span>
            <span style={{ color: '#868e96' }}>{rows.filter(r => r.conta_id).length} com conta · {rows.filter(r => r.item_orc_id).length} com item orc.</span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
            <table style={S.previewTable}>
              <thead><tr><th style={S.previewTh}>Código</th><th style={S.previewTh}>Descrição</th><th style={S.previewTh}>Tipo</th><th style={S.previewTh}>PDB</th><th style={S.previewTh}>Conta</th><th style={S.previewTh}>Item Orc.</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} style={r._erro ? S.errorRow : undefined}>
                  <td style={S.previewTd}>{r.codigo}</td><td style={S.previewTd}>{r.descricao}</td>
                  <td style={S.previewTd}>{r.tipo || '—'}</td><td style={S.previewTd}>{r.tipo_pdb || '—'}</td>
                  <td style={S.previewTd}>{r.conta_id ? '✓' : '—'}</td><td style={S.previewTd}>{r.item_orc_id ? '✓' : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {erroImport && <div style={{ ...S.infoBox('warn'), marginTop: 12 }}>{erroImport}</div>}
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        {validas.length > 0 && <button style={S.btnPrimary} onClick={importar} disabled={importing}><Upload size={14} />{importing ? 'Importando...' : `Importar ${validas.length} verba${validas.length > 1 ? 's' : ''}`}</button>}
      </div>
    </Modal>
  )
}

function VerbasFolhaTab() {
  const [data, setData] = useState<VerbaFolha[]>([])
  const [contas, setContas] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [itens, setItens] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novo' | 'editar' | 'excluir' | 'importar' | null>(null)
  const [selecionado, setSelecionado] = useState<VerbaFolha | null>(null)
  const [busca, setBusca] = useState('')
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Código', width: 80, minWidth: 60 },
    { label: 'Descrição', width: 220, minWidth: 120 },
    { label: 'Tipo', width: 60, minWidth: 50 },
    { label: 'PDB', width: 130, minWidth: 80 },
    { label: 'Conta Contábil', width: 220, minWidth: 100 },
    { label: 'Item Orçamentário', width: 220, minWidth: 100 },
    { label: 'Status', width: 90, minWidth: 70 },
    { label: '', width: 70, minWidth: 60 },
  ])
  const carregar = () => {
    setLoading(true)
    Promise.all([
      supabase.from('verba_folha').select('*, conta:conta_id(codigo,descricao), item_orc:item_orc_id(codigo,descricao)').order('codigo'),
      supabase.from('conta_contabil').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      supabase.from('plano_orcamentario').select('id,codigo,descricao').eq('aceita_lancamento', true).order('codigo'),
    ]).then(([{ data: v }, { data: c }, { data: i }]) => {
      setData((v || []) as VerbaFolha[])
      setContas((c || []) as { id: string; codigo: string; descricao: string }[])
      setItens((i || []) as { id: string; codigo: string; descricao: string }[])
      setLoading(false)
    })
  }
  useEffect(() => { carregar() }, [])
  const excluir = async () => {
    if (!selecionado) return
    await supabase.from('verba_folha').delete().eq('id', selecionado.id)
    setModal(null); carregar()
  }
  const filtrado = busca ? data.filter(v => v.codigo.includes(busca) || v.descricao.toLowerCase().includes(busca.toLowerCase())) : data
  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>
  return (
    <>
      <div style={S.toolbar}>
        <button style={S.btnPrimary} onClick={() => setModal('novo')}><Plus size={14} /> Nova verba</button>
        <button style={S.btnSecondary} onClick={() => setModal('importar')}><Upload size={14} /> Importar planilha</button>
        <input style={{ ...S.select, width: 220 }} placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)} />
      </div>
      <div style={S.card}>
        <table style={{ ...S.table, tableLayout: 'fixed' }}>
          <thead><tr>{cols.map((c, i) => <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>)}</tr></thead>
          <tbody>
            {filtrado.length === 0
              ? <tr><td colSpan={8} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 32 }}>{busca ? 'Nenhum resultado.' : 'Nenhuma verba cadastrada.'}</td></tr>
              : filtrado.map(v => (
                <tr key={v.id} onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{v.codigo}</td>
                  <td style={S_TD}>{v.descricao}</td>
                  <td style={{ ...S_TD, fontFamily: 'monospace', fontSize: 11 }}>{v.tipo || '—'}</td>
                  <td style={{ ...S_TD, fontSize: 11 }}>{v.tipo_pdb || '—'}</td>
                  <td style={{ ...S_TD, fontSize: 12 }}>{v.conta ? `${v.conta.codigo} — ${v.conta.descricao}` : '—'}</td>
                  <td style={{ ...S_TD, fontSize: 12 }}>{v.item_orc ? `${v.item_orc.codigo} — ${v.item_orc.descricao}` : '—'}</td>
                  <td style={S_TD}><span style={S.badge(v.ativo)}>{v.ativo ? 'Ativo' : 'Inativo'}</span></td>
                  <td style={{ ...S_TD, textAlign: 'right' }}>
                    <button style={S.btnIcon('#3b5bdb')} onClick={() => { setSelecionado(v); setModal('editar') }}><Pencil size={14} /></button>
                    <button style={S.btnIcon('#fa5252')} onClick={() => { setSelecionado(v); setModal('excluir') }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      {modal === 'novo' && <ModalVerbaFolha contas={contas} itens={itens} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'editar' && <ModalVerbaFolha verba={selecionado} contas={contas} itens={itens} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'importar' && <ModalImportVerbaFolha dados={data} contas={contas} itens={itens} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'excluir' && selecionado && <ConfirmDelete msg={`Excluir a verba "${selecionado.codigo} — ${selecionado.descricao}"?`} onConfirm={excluir} onCancel={() => setModal(null)} />}
    </>
  )
}

// ── Funcionários / Matrículas ─────────────────────────────
type Funcionario = {
  id: string; codigo: string; bk_funcionario: string | null
  nome: string; situacao: string
  data_admissao: string | null; data_demissao: string | null
  empresa_id: string | null; filial_id: string | null; centro_custo_id: string | null; ativo: boolean
  empresa?: { descricao: string } | null
  filial?: { descricao: string; codigo: string } | null
  centro_custo?: { codigo: string; descricao: string } | null
}

const SIT: Record<string, string> = { ' ': 'Ativo', 'D': 'Demitido', 'A': 'Afastado', 'F': 'Férias' }

function ModalFuncionario({ func, empresas, filiais, centros, onSave, onClose }: {
  func?: Funcionario | null
  empresas: { id: string; codigo: string; descricao: string }[]
  filiais: { id: string; codigo: string; descricao: string }[]
  centros: { id: string; codigo: string; descricao: string }[]
  onSave: () => void; onClose: () => void
}) {
  const [form, setForm] = useState({
    codigo: func?.codigo || '', nome: func?.nome || '', situacao: func?.situacao || ' ',
    data_admissao: func?.data_admissao?.slice(0, 10) || '', data_demissao: func?.data_demissao?.slice(0, 10) || '',
    empresa_id: func?.empresa_id || '', filial_id: func?.filial_id || '', centro_custo_id: func?.centro_custo_id || '', ativo: func?.ativo ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async () => {
    if (!form.codigo.trim() || !form.nome.trim()) { setErro('Matrícula e nome são obrigatórios.'); return }
    setSaving(true)
    const payload = {
      codigo: form.codigo.trim(), nome: form.nome.trim(), situacao: form.situacao,
      data_admissao: form.data_admissao || null, data_demissao: form.data_demissao || null,
      empresa_id: form.empresa_id || null, filial_id: form.filial_id || null, centro_custo_id: form.centro_custo_id || null, ativo: form.ativo,
    }
    const { error } = func
      ? await supabase.from('funcionario').update(payload).eq('id', func.id)
      : await supabase.from('funcionario').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }
  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{func ? 'Editar funcionário' : 'Novo funcionário'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Matrícula</label><input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} /></div>
        <div style={{ ...S.formRow, flex: 3 }}><label style={S.label}>Nome</label><input style={S.input} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} /></div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Situação</label>
          <select style={S.select} value={form.situacao} onChange={e => setForm(f => ({ ...f, situacao: e.target.value }))}>
            {Object.entries(SIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Admissão</label><input style={S.input} type="date" value={form.data_admissao} onChange={e => setForm(f => ({ ...f, data_admissao: e.target.value }))} /></div>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Demissão</label><input style={S.input} type="date" value={form.data_demissao} onChange={e => setForm(f => ({ ...f, data_demissao: e.target.value }))} /></div>
      </div>
      <div style={S.formRow}><label style={S.label}>Empresa</label>
        <select style={S.select} value={form.empresa_id} onChange={e => setForm(f => ({ ...f, empresa_id: e.target.value }))}>
          <option value="">—</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.descricao}</option>)}
        </select>
      </div>
      <div style={S.formRow}><label style={S.label}>Filial</label>
        <select style={S.select} value={form.filial_id} onChange={e => setForm(f => ({ ...f, filial_id: e.target.value }))}>
          <option value="">—</option>{filiais.map(f => <option key={f.id} value={f.id}>{f.codigo} — {f.descricao}</option>)}
        </select>
      </div>
      <div style={S.formRow}><label style={S.label}>Centro de Custo</label>
        <select style={S.select} value={form.centro_custo_id} onChange={e => setForm(f => ({ ...f, centro_custo_id: e.target.value }))}>
          <option value="">—</option>{centros.map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>)}
        </select>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}><Check size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

function ModalImportFuncionario({ filiais, centros, onSave, onClose }: {
  filiais: { id: string; codigo: string }[]
  centros: { id: string; codigo: string }[]
  onSave: () => void; onClose: () => void
}) {
  type PreviewRow = { codigo: string; bk_funcionario: string; nome: string; situacao: string; data_admissao: string | null; data_demissao: string | null; filial_id: string | null; centro_custo_id: string | null; ativo: boolean; _erro?: string }
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [erroImport, setErroImport] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parseDate = (s: string) => {
    const d = String(s || '').trim()
    if (d.length !== 8 || d === '        ' || d === '00000000') return null
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  }

  const parseFile = async (file: File) => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as any)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const filialMap = Object.fromEntries(filiais.map(f => [f.codigo.trim(), f.id]))
    const ccMap = Object.fromEntries(centros.map(c => [c.codigo.trim(), c.id]))
    const isTOTVS = json.length > 0 && 'MATRICULA_FUNC' in json[0]
    const parsed: PreviewRow[] = json
      .filter(r => String(r['MATRICULA_FUNC'] || r['codigo'] || '').trim() !== '000000')
      .map(r => {
        const codigo = String(r['MATRICULA_FUNC'] || r['codigo'] || '').trim()
        const bk_funcionario = isTOTVS ? String(r['BK_FUNCIONARIO'] || '').trim() : ''
        const nome = String(r['NOME_FUNC'] || r['nome'] || '').trim()
        const situacao = String(r['SITFOLHA'] || r['situacao'] || ' ').trim() || ' '
        const data_admissao = isTOTVS ? parseDate(String(r['RA_ADMISSA'] || '')) : String(r['data_admissao'] || '') || null
        const data_demissao = isTOTVS ? parseDate(String(r['RA_DEMISSA'] || '')) : String(r['data_demissao'] || '') || null
        const ativo = situacao !== 'D'
        let filial_id: string | null = null
        let centro_custo_id: string | null = null
        if (isTOTVS) {
          const bkFilial = String(r['BK_FILIAL'] || '')
          const filialCod = bkFilial.split('|').pop()?.trim() || ''
          filial_id = filialMap[filialCod] || null
          const bkCC = String(r['BK_CENTRO_CUSTO'] || '')
          const ccCod = bkCC.includes('||') ? bkCC.split('||').pop()?.trim() || '' : ''
          centro_custo_id = ccMap[ccCod] || null
        }
        const _erro = !codigo ? 'Matrícula obrigatória' : !nome ? 'Nome obrigatório' : undefined
        return { codigo, bk_funcionario, nome, situacao, data_admissao, data_demissao, filial_id, centro_custo_id, ativo, _erro }
      }).filter(r => r.codigo)
    setRows(parsed)
  }

  const importar = async () => {
    const validas = rows.filter(r => !r._erro)
    if (!validas.length) return
    setImporting(true)
    setErroImport('')
    const uniqFuncs = [...new Map(validas.map(r => [r.bk_funcionario || r.codigo, r])).values()]
    const { error } = await supabase.from('funcionario').upsert(
      uniqFuncs.map(({ codigo, bk_funcionario, nome, situacao, data_admissao, data_demissao, filial_id, centro_custo_id, ativo }) =>
        ({ codigo, bk_funcionario: bk_funcionario || null, nome, situacao, data_admissao, data_demissao, filial_id, centro_custo_id, ativo })),
      { onConflict: 'tenant_id,bk_funcionario' }
    )
    setImporting(false)
    if (error) { setErroImport(error.message); return }
    onSave()
  }

  const validas = rows.filter(r => !r._erro)
  const comFilial = rows.filter(r => r.filial_id).length
  const comCC = rows.filter(r => r.centro_custo_id).length
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={S.modalTitle}>Importar funcionários via planilha</div>
        <button style={S.btnSecondary} onClick={() => downloadXlsx('template_funcionarios.xlsx', ['codigo', 'nome', 'situacao', 'data_admissao', 'data_demissao'], [{ codigo: '900001', nome: 'FULANO DA SILVA', situacao: ' ', data_admissao: '2021-01-01', data_demissao: '' }])}><Download size={13} /> Baixar template</button>
      </div>
      <div style={S.infoBox('info')}>Aceita planilha simples ou exportação TOTVS (<strong>Funcionarios.csv</strong> — resolve filial e CC automaticamente se já importados).</div>
      <div style={S.dropzone(dragOver)} onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f) }} onClick={() => fileRef.current?.click()}>
        <Upload size={24} color="#868e96" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, color: '#495057', fontWeight: 500 }}>Arraste o arquivo aqui</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f) }} />
      </div>
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
            <span style={{ color: '#2f9e44' }}>✓ {validas.length} válidas</span>
            <span style={{ color: '#868e96' }}>{comFilial} com filial · {comCC} com CC</span>
            <span style={{ color: '#3b5bdb' }}>{rows.filter(r => r.ativo).length} ativos · {rows.filter(r => !r.ativo).length} demitidos</span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8 }}>
            <table style={S.previewTable}>
              <thead><tr><th style={S.previewTh}>Matrícula</th><th style={S.previewTh}>Nome</th><th style={S.previewTh}>Sit.</th><th style={S.previewTh}>Admissão</th><th style={S.previewTh}>Filial</th><th style={S.previewTh}>CC</th></tr></thead>
              <tbody>{rows.slice(0, 200).map((r, i) => (
                <tr key={i} style={r._erro ? S.errorRow : undefined}>
                  <td style={S.previewTd}>{r.codigo}</td><td style={S.previewTd}>{r.nome}</td>
                  <td style={S.previewTd}>{SIT[r.situacao] || r.situacao}</td><td style={S.previewTd}>{r.data_admissao || '—'}</td>
                  <td style={S.previewTd}>{r.filial_id ? '✓' : '—'}</td><td style={S.previewTd}>{r.centro_custo_id ? '✓' : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            {rows.length > 200 && <div style={{ padding: 8, fontSize: 12, color: '#868e96', textAlign: 'center' }}>… e mais {rows.length - 200} registros</div>}
          </div>
        </>
      )}
      {erroImport && <div style={{ ...S.infoBox('warn'), marginTop: 12 }}>{erroImport}</div>}
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        {validas.length > 0 && <button style={S.btnPrimary} onClick={importar} disabled={importing}><Upload size={14} />{importing ? 'Importando...' : `Importar ${validas.length} funcionário${validas.length > 1 ? 's' : ''}`}</button>}
      </div>
    </Modal>
  )
}

function FuncionariosTab() {
  const [data, setData] = useState<Funcionario[]>([])
  const [empresas, setEmpresas] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [filiais, setFiliais] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [centros, setCentros] = useState<{ id: string; codigo: string; descricao: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novo' | 'editar' | 'excluir' | 'importar' | null>(null)
  const [selecionado, setSelecionado] = useState<Funcionario | null>(null)
  const [busca, setBusca] = useState('')
  const [apenasAtivos, setApenasAtivos] = useState(true)
  const { cols, onMouseDown } = useResizableColumns([
    { label: 'Matrícula', width: 90, minWidth: 60 },
    { label: 'Nome', width: 260, minWidth: 120 },
    { label: 'Filial', width: 160, minWidth: 80 },
    { label: 'Centro de Custo', width: 180, minWidth: 80 },
    { label: 'Admissão', width: 100, minWidth: 80 },
    { label: 'Situação', width: 100, minWidth: 80 },
    { label: '', width: 70, minWidth: 60 },
  ])
  const carregar = () => {
    setLoading(true)
    Promise.all([
      supabase.from('funcionario').select('*, empresa:empresa_id(descricao), filial:filial_id(codigo,descricao), centro_custo:centro_custo_id(codigo,descricao)').order('nome'),
      supabase.from('empresa').select('id,codigo,descricao').order('codigo'),
      supabase.from('filial').select('id,codigo,descricao').order('codigo'),
      supabase.from('centro_custo').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
    ]).then(([{ data: f }, { data: e }, { data: fil }, { data: cc }]) => {
      setData((f || []) as Funcionario[])
      setEmpresas((e || []) as { id: string; codigo: string; descricao: string }[])
      setFiliais((fil || []) as { id: string; codigo: string; descricao: string }[])
      setCentros((cc || []) as { id: string; codigo: string; descricao: string }[])
      setLoading(false)
    })
  }
  useEffect(() => { carregar() }, [])
  const excluir = async () => {
    if (!selecionado) return
    await supabase.from('funcionario').delete().eq('id', selecionado.id)
    setModal(null); carregar()
  }
  const filtrado = data.filter(f => {
    if (apenasAtivos && !f.ativo) return false
    if (busca && !f.codigo.includes(busca) && !f.nome.toLowerCase().includes(busca.toLowerCase())) return false
    return true
  })
  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>
  return (
    <>
      <div style={S.toolbar}>
        <button style={S.btnPrimary} onClick={() => setModal('novo')}><Plus size={14} /> Novo funcionário</button>
        <button style={S.btnSecondary} onClick={() => setModal('importar')}><Upload size={14} /> Importar planilha</button>
        <input style={{ ...S.select, width: 220 }} placeholder="Buscar matrícula ou nome…" value={busca} onChange={e => setBusca(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#495057', cursor: 'pointer' }}>
          <input type="checkbox" checked={apenasAtivos} onChange={e => setApenasAtivos(e.target.checked)} />
          Somente ativos
        </label>
      </div>
      <div style={{ marginBottom: 8, fontSize: 12, color: '#868e96' }}>
        {filtrado.length} exibidos de {data.length} total
      </div>
      <div style={S.card}>
        <table style={{ ...S.table, tableLayout: 'fixed' }}>
          <thead><tr>{cols.map((c, i) => <ResizableTh key={i} col={c} idx={i} onMouseDown={onMouseDown}>{c.label}</ResizableTh>)}</tr></thead>
          <tbody>
            {filtrado.length === 0
              ? <tr><td colSpan={7} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 32 }}>{busca ? 'Nenhum resultado.' : 'Nenhum funcionário cadastrado.'}</td></tr>
              : filtrado.map(f => (
                <tr key={f.id} onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                  <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{f.codigo}</td>
                  <td style={S_TD}>{f.nome}</td>
                  <td style={{ ...S_TD, fontSize: 12 }}>{f.filial ? `${f.filial.codigo}` : '—'}</td>
                  <td style={{ ...S_TD, fontSize: 12 }}>{f.centro_custo ? `${f.centro_custo.codigo} — ${f.centro_custo.descricao}` : '—'}</td>
                  <td style={{ ...S_TD, fontSize: 12 }}>{f.data_admissao ? f.data_admissao.slice(0, 10) : '—'}</td>
                  <td style={S_TD}><span style={S.badge(f.ativo)}>{SIT[f.situacao] || f.situacao}</span></td>
                  <td style={{ ...S_TD, textAlign: 'right' }}>
                    <button style={S.btnIcon('#3b5bdb')} onClick={() => { setSelecionado(f); setModal('editar') }}><Pencil size={14} /></button>
                    <button style={S.btnIcon('#fa5252')} onClick={() => { setSelecionado(f); setModal('excluir') }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
      {modal === 'novo' && <ModalFuncionario empresas={empresas} filiais={filiais} centros={centros} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'editar' && <ModalFuncionario func={selecionado} empresas={empresas} filiais={filiais} centros={centros} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'importar' && <ModalImportFuncionario filiais={filiais} centros={centros} onSave={() => { setModal(null); carregar() }} onClose={() => setModal(null)} />}
      {modal === 'excluir' && selecionado && <ConfirmDelete msg={`Excluir "${selecionado.nome}"?`} onConfirm={excluir} onCancel={() => setModal(null)} />}
    </>
  )
}

// ── Dimensões Configuráveis ───────────────────────────────
type Dimensao = { id: string; codigo: string; label: string; tabela_ref: string | null; obrigatorio: boolean; ordem: number; ativo: boolean }
type DimensaoValor = { id: string; dimensao_id: string; codigo: string; descricao: string; ativo: boolean }

function ModalDimensao({ dim, onSave, onClose }: { dim?: Dimensao | null; onSave: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ codigo: dim?.codigo || '', label: dim?.label || '', tabela_ref: dim?.tabela_ref || '', ordem: dim?.ordem ?? 0, obrigatorio: dim?.obrigatorio ?? false, ativo: dim?.ativo ?? true })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async () => {
    if (!form.codigo.trim() || !form.label.trim()) { setErro('Código e rótulo são obrigatórios.'); return }
    setSaving(true)
    const payload = { codigo: form.codigo.trim(), label: form.label.trim(), tabela_ref: form.tabela_ref.trim() || null, ordem: form.ordem, obrigatorio: form.obrigatorio, ativo: form.ativo }
    const { error } = dim
      ? await supabase.from('dimensao').update(payload).eq('id', dim.id)
      : await supabase.from('dimensao').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }
  const TABELAS_REF = ['', 'verba_folha', 'funcionario', 'centro_custo', 'conta_contabil']
  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{dim ? 'Editar dimensão' : 'Nova dimensão'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Código (chave JSON)</label><input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder="ex: projeto" /></div>
        <div style={{ ...S.formRow, flex: 2 }}><label style={S.label}>Rótulo (UI)</label><input style={S.input} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="ex: Projeto" /></div>
      </div>
      <div style={S.formRow}><label style={S.label}>Tabela de referência</label>
        <select style={S.select} value={form.tabela_ref} onChange={e => setForm(f => ({ ...f, tabela_ref: e.target.value }))}>
          {TABELAS_REF.map(t => <option key={t} value={t}>{t || '— lista própria (dimensao_valor) —'}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...S.formRow, flex: 1 }}><label style={S.label}>Ordem</label><input style={S.input} type="number" value={form.ordem} onChange={e => setForm(f => ({ ...f, ordem: Number(e.target.value) }))} /></div>
        <div style={{ ...S.formRow, flex: 1, justifyContent: 'center', alignItems: 'center', display: 'flex', gap: 8, marginTop: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={form.obrigatorio} onChange={e => setForm(f => ({ ...f, obrigatorio: e.target.checked }))} /> Obrigatório</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={form.ativo} onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))} /> Ativo</label>
        </div>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}><Check size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

function ModalDimensaoValor({ val, dimensaoId, onSave, onClose }: { val?: DimensaoValor | null; dimensaoId: string; onSave: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ codigo: val?.codigo || '', descricao: val?.descricao || '', ativo: val?.ativo ?? true })
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const salvar = async () => {
    if (!form.codigo.trim() || !form.descricao.trim()) { setErro('Código e descrição são obrigatórios.'); return }
    setSaving(true)
    const payload = { codigo: form.codigo.trim(), descricao: form.descricao.trim(), ativo: form.ativo, dimensao_id: dimensaoId }
    const { error } = val
      ? await supabase.from('dimensao_valor').update(payload).eq('id', val.id)
      : await supabase.from('dimensao_valor').insert(payload)
    setSaving(false)
    if (error) { setErro(error.message); return }
    onSave()
  }
  return (
    <Modal onClose={onClose}>
      <div style={S.modalTitle}>{val ? 'Editar valor' : 'Novo valor'}</div>
      {erro && <div style={{ ...S.infoBox('warn'), marginBottom: 16 }}>{erro}</div>}
      <div style={S.formRow}><label style={S.label}>Código</label><input style={S.input} value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} /></div>
      <div style={S.formRow}><label style={S.label}>Status</label>
        <select style={S.select} value={form.ativo ? '1' : '0'} onChange={e => setForm(f => ({ ...f, ativo: e.target.value === '1' }))}>
          <option value="1">Ativo</option><option value="0">Inativo</option>
        </select>
      </div>
      <div style={S.modalFooter}>
        <button style={S.btnSecondary} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} onClick={salvar} disabled={saving}><Check size={14} />{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

function DimensoesTab() {
  const [dims, setDims] = useState<Dimensao[]>([])
  const [valores, setValores] = useState<DimensaoValor[]>([])
  const [selecionada, setSelecionada] = useState<Dimensao | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'novaDim' | 'editarDim' | 'excluirDim' | 'novoVal' | 'editarVal' | 'excluirVal' | null>(null)
  const [selDim, setSelDim] = useState<Dimensao | null>(null)
  const [selVal, setSelVal] = useState<DimensaoValor | null>(null)

  const carregarDims = () => {
    supabase.from('dimensao').select('*').order('ordem').then(({ data }) => { setDims((data || []) as Dimensao[]); setLoading(false) })
  }
  const carregarValores = (dimId: string) => {
    supabase.from('dimensao_valor').select('*').eq('dimensao_id', dimId).order('codigo').then(({ data }) => setValores((data || []) as DimensaoValor[]))
  }
  useEffect(() => { carregarDims() }, [])
  useEffect(() => { if (selecionada && !selecionada.tabela_ref) carregarValores(selecionada.id) }, [selecionada])

  const excluirDim = async () => {
    if (!selDim) return
    await supabase.from('dimensao').delete().eq('id', selDim.id)
    setModal(null); if (selecionada?.id === selDim.id) setSelecionada(null); carregarDims()
  }
  const excluirVal = async () => {
    if (!selVal) return
    await supabase.from('dimensao_valor').delete().eq('id', selVal.id)
    setModal(null); if (selecionada) carregarValores(selecionada.id)
  }

  if (loading) return <p style={{ padding: 16, color: '#aaa' }}>Carregando...</p>
  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Painel esquerdo — dimensões */}
        <div style={{ flex: '0 0 340px' }}>
          <div style={{ ...S.card, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e9ecef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#212529' }}>Dimensões</span>
              <button style={S.btnPrimary} onClick={() => setModal('novaDim')}><Plus size={13} /> Nova</button>
            </div>
            {dims.map(d => (
              <div key={d.id}
                onClick={() => setSelecionada(d)}
                style={{ padding: '10px 16px', borderBottom: '1px solid #f1f3f5', cursor: 'pointer', background: selecionada?.id === d.id ? '#edf2ff' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onMouseEnter={ev => { if (selecionada?.id !== d.id) ev.currentTarget.style.background = '#f8f9fa' }}
                onMouseLeave={ev => { if (selecionada?.id !== d.id) ev.currentTarget.style.background = '' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#212529' }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: '#868e96', fontFamily: 'monospace' }}>
                    {d.codigo} · {d.tabela_ref ? `↗ ${d.tabela_ref}` : 'lista própria'}
                    {d.obrigatorio && ' · obrigatório'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button style={S.btnIcon('#3b5bdb')} onClick={e => { e.stopPropagation(); setSelDim(d); setModal('editarDim') }}><Pencil size={12} /></button>
                  <button style={S.btnIcon('#fa5252')} onClick={e => { e.stopPropagation(); setSelDim(d); setModal('excluirDim') }}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            {dims.length === 0 && <div style={{ padding: 24, fontSize: 13, color: '#aaa', textAlign: 'center' }}>Nenhuma dimensão.</div>}
          </div>
        </div>

        {/* Painel direito — valores da dimensão selecionada */}
        <div style={{ flex: 1 }}>
          {!selecionada
            ? <div style={{ ...S.card, padding: 32, textAlign: 'center', color: '#aaa', fontSize: 13 }}><Settings size={24} style={{ display: 'block', margin: '0 auto 12px' }} />Selecione uma dimensão para ver detalhes.</div>
            : selecionada.tabela_ref
              ? <div style={S.card}>
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{selecionada.label}</div>
                    <div style={{ fontSize: 13, color: '#868e96' }}>
                      Esta dimensão usa a tabela <code style={{ background: '#f1f3f5', padding: '2px 6px', borderRadius: 4 }}>{selecionada.tabela_ref}</code> como fonte de valores.<br />
                      Gerencie os registros na aba correspondente.
                    </div>
                  </div>
                </div>
              : <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#212529' }}>Valores de "{selecionada.label}"</span>
                    <button style={S.btnPrimary} onClick={() => setModal('novoVal')}><Plus size={13} /> Novo valor</button>
                  </div>
                  <div style={S.card}>
                    <table style={{ ...S.table, tableLayout: 'fixed' }}>
                      <thead><tr>
                        <th style={{ ...S_TH, width: 120 }}>Código</th>
                        <th style={S_TH}>Descrição</th>
                        <th style={{ ...S_TH, width: 100 }}>Status</th>
                        <th style={{ ...S_TH, width: 80 }}></th>
                      </tr></thead>
                      <tbody>
                        {valores.length === 0
                          ? <tr><td colSpan={4} style={{ ...S_TD, textAlign: 'center', color: '#aaa', padding: 24 }}>Nenhum valor cadastrado.</td></tr>
                          : valores.map(v => (
                            <tr key={v.id} onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                              <td style={{ ...S_TD, fontFamily: 'monospace', color: '#868e96' }}>{v.codigo}</td>
                              <td style={S_TD}>{v.descricao}</td>
                              <td style={S_TD}><span style={S.badge(v.ativo)}>{v.ativo ? 'Ativo' : 'Inativo'}</span></td>
                              <td style={{ ...S_TD, textAlign: 'right' }}>
                                <button style={S.btnIcon('#3b5bdb')} onClick={() => { setSelVal(v); setModal('editarVal') }}><Pencil size={13} /></button>
                                <button style={S.btnIcon('#fa5252')} onClick={() => { setSelVal(v); setModal('excluirVal') }}><Trash2 size={13} /></button>
                              </td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </>
          }
        </div>
      </div>

      {modal === 'novaDim' && <ModalDimensao onSave={() => { setModal(null); carregarDims() }} onClose={() => setModal(null)} />}
      {modal === 'editarDim' && <ModalDimensao dim={selDim} onSave={() => { setModal(null); carregarDims() }} onClose={() => setModal(null)} />}
      {modal === 'excluirDim' && selDim && <ConfirmDelete msg={`Excluir a dimensão "${selDim.label}"? Isso remove também todos os seus valores.`} onConfirm={excluirDim} onCancel={() => setModal(null)} />}
      {modal === 'novoVal' && selecionada && <ModalDimensaoValor dimensaoId={selecionada.id} onSave={() => { setModal(null); carregarValores(selecionada.id) }} onClose={() => setModal(null)} />}
      {modal === 'editarVal' && selecionada && <ModalDimensaoValor val={selVal} dimensaoId={selecionada.id} onSave={() => { setModal(null); carregarValores(selecionada.id) }} onClose={() => setModal(null)} />}
      {modal === 'excluirVal' && selVal && <ConfirmDelete msg={`Excluir o valor "${selVal.descricao}"?`} onConfirm={excluirVal} onCancel={() => setModal(null)} />}
    </>
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
          <p style={S.subtitle}>Empresas · Filiais · Centro de Custo · Conta Contábil · Verbas · Funcionários · Plano Orçamentário</p>
        </div>
      </div>

      <div style={S.tabs}>
        {([
          ['empresas',     'Empresas'],
          ['filiais',      'Filiais'],
          ['centrocusto',  'Centro de Custo'],
          ['contacontabil','Conta Contábil'],
          ['verbas',       'Verbas'],
          ['funcionarios', 'Funcionários'],
          ['dimensoes',    'Dimensões'],
          ['plano',        'Plano Orçamentário'],
        ] as [Aba, string][]).map(([a, label]) => (
          <button key={a} style={S.tab(aba === a)} onClick={() => setAba(a)}>{label}</button>
        ))}
      </div>

      {aba === 'empresas'      && <EmpresasTab />}
      {aba === 'filiais'       && <FiliaisTab />}
      {aba === 'centrocusto'   && <CentroCustoTab />}
      {aba === 'contacontabil' && <ContaContabilTab />}
      {aba === 'verbas'        && <VerbasFolhaTab />}
      {aba === 'funcionarios'  && <FuncionariosTab />}
      {aba === 'dimensoes'     && <DimensoesTab />}
      {aba === 'plano'         && <PlanoTab />}
    </div>
  )
}
