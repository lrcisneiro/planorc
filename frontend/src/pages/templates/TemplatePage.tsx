import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'

type Tipo = 'DRE' | 'FORMULARIO' | 'DASHBOARD'

type Template = {
  id: string
  codigo: string
  nome: string
  tipo: Tipo
  descricao: string | null
  _nlinhas?: number
}

const S = {
  page:    { padding: 24 } as CSSProperties,
  header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 } as CSSProperties,
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as CSSProperties,
  sub:     { fontSize: 13, color: '#868e96', margin: '4px 0 0' } as CSSProperties,
  btnAdd:  { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 14, background: '#3b5bdb', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 500 } as CSSProperties,
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 } as CSSProperties,
  card:    { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: 20, cursor: 'pointer', transition: 'box-shadow 0.15s', display: 'flex', flexDirection: 'column' as const, gap: 12 } as CSSProperties,
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' } as CSSProperties,
  nome:    { fontSize: 15, fontWeight: 600, color: '#212529' } as CSSProperties,
  codigo:  { fontSize: 11, color: '#aaa', fontFamily: 'monospace' } as CSSProperties,
  desc:    { fontSize: 13, color: '#868e96', minHeight: 18 } as CSSProperties,
  footer:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 } as CSSProperties,
  actions: { display: 'flex', gap: 4 } as CSSProperties,
  btnIcon: { background: 'none', border: 'none', cursor: 'pointer', color: '#ced4da', padding: '4px 6px', borderRadius: 6, display: 'flex', alignItems: 'center' } as CSSProperties,
  empty:   { background: 'white', border: '1px solid #e9ecef', borderRadius: 12, padding: '60px 24px', textAlign: 'center' as const, color: '#aaa' } as CSSProperties,
  // Modal
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: 'white', borderRadius: 14, padding: 28, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' } as CSSProperties,
  mTitle:  { fontSize: 17, fontWeight: 600, marginBottom: 20, color: '#212529' } as CSSProperties,
  field:   { marginBottom: 16 } as CSSProperties,
  label:   { display: 'block', fontSize: 12, fontWeight: 500, color: '#495057', marginBottom: 6 } as CSSProperties,
  input:   { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ced4da', borderRadius: 8, outline: 'none', boxSizing: 'border-box' as const } as CSSProperties,
  select:  { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid #ced4da', borderRadius: 8, outline: 'none', background: 'white', boxSizing: 'border-box' as const } as CSSProperties,
  mFooter: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 } as CSSProperties,
  btnSec:  { padding: '8px 16px', fontSize: 14, background: 'none', border: '1px solid #dee2e6', borderRadius: 8, cursor: 'pointer', color: '#495057' } as CSSProperties,
  btnPri:  { padding: '8px 16px', fontSize: 14, background: '#3b5bdb', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 500 } as CSSProperties,
}

const TIPO_COLOR: Record<Tipo, { bg: string; color: string; label: string }> = {
  DRE:        { bg: '#e7f5ff', color: '#1971c2', label: 'DRE' },
  FORMULARIO: { bg: '#f3f0ff', color: '#6741d9', label: 'Formulário' },
  DASHBOARD:  { bg: '#ebfbee', color: '#2f9e44', label: 'Dashboard' },
}

function TipoBadge({ tipo }: { tipo: Tipo }) {
  const { bg, color, label } = TIPO_COLOR[tipo] ?? { bg: '#f1f3f5', color: '#868e96', label: tipo }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  )
}

type ModalState = { open: false } | { open: true; id?: string; codigo: string; nome: string; tipo: Tipo; descricao: string }

export default function TemplatePage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    setErro(null)
    const { data, error } = await supabase
      .from('template')
      .select('id, codigo, nome, tipo, descricao, linha_template!template_id(count)')
      .order('nome')
    if (error) { setErro(error.message); setLoading(false); return }
    setTemplates(
      (data || []).map((t: any) => ({
        ...t,
        _nlinhas: (t['linha_template!template_id'] ?? t.linha_template)?.[0]?.count ?? 0,
      }))
    )
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openCreate = () => setModal({ open: true, codigo: '', nome: '', tipo: 'DRE', descricao: '' })
  const openEdit = (t: Template, e: ReactMouseEvent) => {
    e.stopPropagation()
    setModal({ open: true, id: t.id, codigo: t.codigo, nome: t.nome, tipo: t.tipo, descricao: t.descricao ?? '' })
  }
  const closeModal = () => setModal({ open: false })

  const save = async () => {
    if (!modal.open || !modal.nome || !modal.codigo) return
    let error: any
    if (modal.id) {
      ;({ error } = await supabase.from('template').update({ codigo: modal.codigo, nome: modal.nome, tipo: modal.tipo, descricao: modal.descricao || null }).eq('id', modal.id))
    } else {
      ;({ error } = await supabase.from('template').insert({ tenant_id: TENANT_ID, codigo: modal.codigo, nome: modal.nome, tipo: modal.tipo, descricao: modal.descricao || null }))
    }
    if (error) { alert('Erro ao salvar: ' + error.message); return }
    closeModal(); load()
  }

  const del = async (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!confirm('Excluir template e todas as suas linhas?')) return
    const { error } = await supabase.from('template').delete().eq('id', id)
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    load()
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Templates</h1>
          <p style={S.sub}>Estrutura de relatórios — DRE, Formulários e Dashboards</p>
        </div>
        <button style={S.btnAdd} onClick={openCreate}><Plus size={15} /> Novo template</button>
      </div>

      {erro && (
        <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#c92a2a', fontSize: 13 }}>
          <strong>Erro ao carregar:</strong> {erro}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#aaa' }}>Carregando...</p>
      ) : templates.length === 0 ? (
        <div style={S.empty}>
          <p style={{ fontSize: 15, fontWeight: 500, color: '#495057' }}>Nenhum template criado ainda</p>
          <p style={{ fontSize: 13 }}>Crie um template DRE para começar a estruturar seu relatório.</p>
          <button style={{ ...S.btnAdd, margin: '16px auto 0', display: 'flex' }} onClick={openCreate}><Plus size={15} /> Criar template</button>
        </div>
      ) : (
        <div style={S.grid}>
          {templates.map(t => (
            <div key={t.id} style={S.card} onClick={() => navigate(`/templates/${t.id}`)}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={S.cardTop}>
                <div>
                  <div style={S.nome}>{t.nome}</div>
                  <div style={S.codigo}>{t.codigo}</div>
                </div>
                <TipoBadge tipo={t.tipo} />
              </div>
              <div style={S.desc}>{t.descricao || <span style={{ fontStyle: 'italic' }}>Sem descrição</span>}</div>
              <div style={S.footer}>
                <span style={{ fontSize: 12, color: '#aaa' }}>{t._nlinhas} linha{t._nlinhas !== 1 ? 's' : ''}</span>
                <div style={S.actions}>
                  <button style={S.btnIcon} title="Editar" onClick={e => openEdit(t, e)}><Pencil size={14} /></button>
                  <button style={S.btnIcon} title="Excluir" onClick={e => del(t.id, e)}><Trash2 size={14} /></button>
                  <button style={{ ...S.btnIcon, color: '#3b5bdb' }} title="Abrir editor"><ChevronRight size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {modal.open && (
        <div style={S.overlay} onClick={closeModal}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.mTitle}>{modal.id ? 'Editar template' : 'Novo template'}</div>
            <div style={S.field}>
              <label style={S.label}>Código *</label>
              <input style={S.input} placeholder="Ex: DRE_GERENCIAL" value={modal.codigo}
                onChange={e => setModal(p => p.open ? { ...p, codigo: e.target.value.toUpperCase() } : p)} />
            </div>
            <div style={S.field}>
              <label style={S.label}>Nome *</label>
              <input style={S.input} placeholder="Ex: DRE — Planejamento Estratégico" value={modal.nome}
                onChange={e => setModal(p => p.open ? { ...p, nome: e.target.value } : p)} />
            </div>
            <div style={S.field}>
              <label style={S.label}>Tipo</label>
              <select style={S.select} value={modal.tipo}
                onChange={e => setModal(p => p.open ? { ...p, tipo: e.target.value as Tipo } : p)}>
                <option value="DRE">DRE</option>
                <option value="FORMULARIO">Formulário</option>
                <option value="DASHBOARD">Dashboard</option>
              </select>
            </div>
            <div style={S.field}>
              <label style={S.label}>Descrição</label>
              <input style={S.input} placeholder="Descrição opcional" value={modal.descricao}
                onChange={e => setModal(p => p.open ? { ...p, descricao: e.target.value } : p)} />
            </div>
            <div style={S.mFooter}>
              <button style={S.btnSec} onClick={closeModal}>Cancelar</button>
              <button style={S.btnPri} onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
