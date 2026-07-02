import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { T } from '../../lib/theme'
import { Plus, Pencil, Trash2, ChevronRight, SlidersHorizontal } from 'lucide-react'

// Hub de Formulários de drivers (F5). Lista/cria formulários; cada um abre no editor.
type Formulario = { id: string; codigo: string; nome: string; descricao: string | null; _nlinhas?: number }

const S: Record<string, CSSProperties> = {
  page:    { padding: 24 },
  header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title:   { fontSize: 22, fontWeight: 700, color: T.text, margin: 0 },
  sub:     { fontSize: 13, color: T.muted, margin: '4px 0 0' },
  btnAdd:  { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 14, background: T.violet, color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600, boxShadow: '0 4px 14px rgba(109,63,240,0.35)' },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card:    { background: `linear-gradient(180deg, ${T.panel}, ${T.bgSoft})`, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color .15s, box-shadow .15s' },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  nome:    { fontSize: 15, fontWeight: 600, color: T.text },
  codigo:  { fontSize: 11, color: T.faint, fontFamily: 'monospace' },
  desc:    { fontSize: 13, color: T.muted, minHeight: 18 },
  footer:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  actions: { display: 'flex', gap: 4 },
  btnIcon: { background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: '4px 6px', borderRadius: 6, display: 'flex', alignItems: 'center' },
  empty:   { background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: '60px 24px', textAlign: 'center', color: T.muted },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: T.panel, border: `1px solid ${T.borderS}`, borderRadius: 16, padding: 28, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
  mTitle:  { fontSize: 17, fontWeight: 600, marginBottom: 20, color: T.text },
  field:   { marginBottom: 16 },
  label:   { display: 'block', fontSize: 12, fontWeight: 500, color: T.textMid, marginBottom: 6 },
  input:   { width: '100%', padding: '8px 10px', fontSize: 14, border: `1px solid ${T.borderS}`, borderRadius: 8, outline: 'none', boxSizing: 'border-box', background: T.bgSoft, color: T.text },
  mFooter: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 },
  btnSec:  { padding: '8px 16px', fontSize: 14, background: 'none', border: `1px solid ${T.borderS}`, borderRadius: 8, cursor: 'pointer', color: T.textMid },
  btnPri:  { padding: '8px 16px', fontSize: 14, background: T.violet, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
}

type ModalState = { open: false } | { open: true; id?: string; codigo: string; nome: string; descricao: string }

export default function FormulariosPage() {
  const [forms, setForms] = useState<Formulario[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true); setErro(null)
    const { data, error } = await supabase.from('formulario').select('id,codigo,nome,descricao,formulario_linha(count)').order('nome')
    if (error) { setErro(error.message); setLoading(false); return }
    setForms((data || []).map((f: any) => ({ ...f, _nlinhas: f.formulario_linha?.[0]?.count ?? 0 })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openCreate = () => setModal({ open: true, codigo: '', nome: '', descricao: '' })
  const openEdit = (f: Formulario, e: ReactMouseEvent) => { e.stopPropagation(); setModal({ open: true, id: f.id, codigo: f.codigo, nome: f.nome, descricao: f.descricao ?? '' }) }
  const close = () => setModal({ open: false })

  const save = async () => {
    if (!modal.open || !modal.nome || !modal.codigo) return
    const payload = { codigo: modal.codigo, nome: modal.nome, descricao: modal.descricao || null }
    const { error } = modal.id
      ? await supabase.from('formulario').update(payload).eq('id', modal.id)
      : await supabase.from('formulario').insert({ tenant_id: TENANT_ID, ...payload })
    if (error) { alert('Erro ao salvar: ' + error.message); return }
    close(); load()
  }
  const del = async (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!confirm('Excluir formulário e todas as linhas/valores?')) return
    const { error } = await supabase.from('formulario').delete().eq('id', id)
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    load()
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Formulários de drivers</h1>
          <p style={S.sub}>Memória de cálculo do orçado — quantidade × preço, índices, fórmulas. O resultado é aplicado no orçado.</p>
        </div>
        <button style={S.btnAdd} onClick={openCreate}><Plus size={15} /> Novo formulário</button>
      </div>

      {erro && (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: `1px solid ${T.red}`, borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: T.red, fontSize: 13 }}>
          <strong>Erro:</strong> {erro}
        </div>
      )}

      {loading ? (
        <p style={{ color: T.muted }}>Carregando...</p>
      ) : forms.length === 0 ? (
        <div style={S.empty}>
          <SlidersHorizontal size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <p style={{ fontSize: 15, fontWeight: 500, color: T.textMid }}>Nenhum formulário criado ainda</p>
          <button style={{ ...S.btnAdd, margin: '16px auto 0' }} onClick={openCreate}><Plus size={15} /> Criar formulário</button>
        </div>
      ) : (
        <div style={S.grid}>
          {forms.map(f => (
            <div key={f.id} style={S.card} onClick={() => navigate(`/formularios/${f.id}`)}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.45)'; e.currentTarget.style.borderColor = T.borderS }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = T.border }}>
              <div style={S.cardTop}>
                <div>
                  <div style={S.nome}>{f.nome}</div>
                  <div style={S.codigo}>{f.codigo}</div>
                </div>
                <SlidersHorizontal size={18} style={{ color: T.violet, opacity: 0.7 }} />
              </div>
              <div style={S.desc}>{f.descricao || <span style={{ fontStyle: 'italic' }}>Sem descrição</span>}</div>
              <div style={S.footer}>
                <span style={{ fontSize: 12, color: T.muted }}>{f._nlinhas} linha{f._nlinhas !== 1 ? 's' : ''}</span>
                <div style={S.actions}>
                  <button style={S.btnIcon} title="Editar" onClick={e => openEdit(f, e)}><Pencil size={14} /></button>
                  <button style={S.btnIcon} title="Excluir" onClick={e => del(f.id, e)}><Trash2 size={14} /></button>
                  <button style={{ ...S.btnIcon, color: T.violet }} title="Abrir"><ChevronRight size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <div style={S.overlay} onClick={close}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.mTitle}>{modal.id ? 'Editar formulário' : 'Novo formulário'}</div>
            <div style={S.field}>
              <label style={S.label}>Código *</label>
              <input style={S.input} placeholder="Ex: FOLHA_2026" value={modal.codigo}
                onChange={e => setModal(p => p.open ? { ...p, codigo: e.target.value.toUpperCase() } : p)} />
            </div>
            <div style={S.field}>
              <label style={S.label}>Nome *</label>
              <input style={S.input} placeholder="Ex: Folha de pagamento" value={modal.nome}
                onChange={e => setModal(p => p.open ? { ...p, nome: e.target.value } : p)} />
            </div>
            <div style={S.field}>
              <label style={S.label}>Descrição</label>
              <input style={S.input} placeholder="Opcional" value={modal.descricao}
                onChange={e => setModal(p => p.open ? { ...p, descricao: e.target.value } : p)} />
            </div>
            <div style={S.mFooter}>
              <button style={S.btnSec} onClick={close}>Cancelar</button>
              <button style={S.btnPri} onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
