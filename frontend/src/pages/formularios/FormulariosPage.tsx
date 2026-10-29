import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useCapacidades } from '../../hooks/useCapacidades'
import { T } from '../../lib/theme'
import { Plus, Pencil, Trash2, ChevronRight, SlidersHorizontal, Settings2, Wand2, FileText, ChevronDown, AlertTriangle } from 'lucide-react'
import { WIZARDS, type Wizard } from '../../lib/wizards'
import { executarWizard } from '../../lib/wizardRun'

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
  // cascata do "Novo formulário"
  menuWrap: { position: 'relative' },
  menu:    { position: 'absolute', top: 'calc(100% + 6px)', right: 0, minWidth: 300, background: T.panel, border: `1px solid ${T.borderS}`, borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.45)', padding: 6, zIndex: 900 },
  menuIt:  { display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', padding: '10px 12px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: T.text },
  menuNm:  { fontSize: 13, fontWeight: 600 },
  menuDs:  { fontSize: 11, color: T.muted, marginTop: 2, lineHeight: 1.45 },
  menuSep: { fontSize: 10, textTransform: 'uppercase', letterSpacing: .6, color: T.faint, padding: '8px 12px 4px' },
  // modal do wizard
  como:    { fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 16 },
  aviso:   { display: 'flex', gap: 8, fontSize: 12, color: T.textMid, lineHeight: 1.5, background: T.bgSoft, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
  row2:    { display: 'grid', gridTemplateColumns: '1fr 110px', gap: 12 },
  okBox:   { fontSize: 13, color: T.text, lineHeight: 1.6 },
}

type ModalState = { open: false } | { open: true; id?: string; codigo: string; nome: string; descricao: string }
type WzState =
  | { open: false }
  | { open: true; w: Wizard; codigo: string; nome: string; versaoId: string; ano: number
      rodando?: boolean; erro?: string | null
      feito?: { formularioId: string; escopos: number; celulas: number; avisos: string[] } }

export default function FormulariosPage() {
  const [forms, setForms] = useState<Formulario[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })
  const [menu, setMenu] = useState(false)
  const [wz, setWz] = useState<WzState>({ open: false })
  const [versoes, setVersoes] = useState<any[]>([])
  const navigate = useNavigate()
  const cap = useCapacidades()

  const load = async () => {
    setLoading(true); setErro(null)
    const { data, error } = await supabase.from('formulario').select('id,codigo,nome,descricao,formulario_linha(count)').order('nome')
    if (error) { setErro(error.message); setLoading(false); return }
    setForms((data || []).map((f: any) => ({ ...f, _nlinhas: f.formulario_linha?.[0]?.count ?? 0 })))
    setLoading(false)
  }
  useEffect(() => {
    load()
    // catálogo pequeno: dispensa pageAll
    supabase.from('versao_orcamento').select('id,codigo,ano').order('codigo').then(r => setVersoes(r.data || []))
  }, [])

  const openCreate = () => setModal({ open: true, codigo: '', nome: '', descricao: '' })
  const openEdit = (f: Formulario, e: ReactMouseEvent) => { e.stopPropagation(); setModal({ open: true, id: f.id, codigo: f.codigo, nome: f.nome, descricao: f.descricao ?? '' }) }
  const close = () => setModal({ open: false })

  const abrirWizard = (w: Wizard) => {
    setMenu(false)
    const anoPadrao = versoes[0]?.ano ?? new Date().getFullYear() + 1
    setWz({ open: true, w, codigo: w.codigo, nome: w.nome, versaoId: versoes[0]?.id ?? '', ano: anoPadrao })
  }
  const gerar = async () => {
    if (!wz.open || wz.rodando) return
    if (!wz.codigo.trim() || !wz.nome.trim()) { setWz({ ...wz, erro: 'Código e nome são obrigatórios.' }); return }
    if (!wz.versaoId) { setWz({ ...wz, erro: 'Escolha a versão de onde ler o orçado.' }); return }
    setWz({ ...wz, rodando: true, erro: null })
    try {
      const r = await executarWizard(wz.w, {
        codigo: wz.codigo.trim(), nome: wz.nome.trim(), versaoId: wz.versaoId, ano: Number(wz.ano),
      })
      setWz({ ...wz, rodando: false, feito: r })
      load()
    } catch (e: any) {
      setWz({ ...wz, rodando: false, erro: e?.message ?? String(e) })
    }
  }

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
        <div style={S.menuWrap}>
          <button style={S.btnAdd} onClick={() => setMenu(m => !m)}>
            <Plus size={15} /> Novo formulário <ChevronDown size={14} style={{ opacity: .8 }} />
          </button>
          {menu && (
            <>
              {/* clique fora fecha; fica ATRÁS do menu (z-index menor) */}
              <div style={{ position: 'fixed', inset: 0, zIndex: 890 }} onClick={() => setMenu(false)} />
              <div style={S.menu}>
                <button style={S.menuIt} onClick={() => { setMenu(false); openCreate() }}
                        onMouseEnter={e => (e.currentTarget.style.background = T.bgSoft)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <FileText size={15} style={{ color: T.muted, marginTop: 1, flexShrink: 0 }} />
                  <span>
                    <div style={S.menuNm}>Em branco</div>
                    <div style={S.menuDs}>Estrutura vazia — você desenha as linhas e preenche.</div>
                  </span>
                </button>
                {WIZARDS.length > 0 && <div style={S.menuSep}>A partir de dados que já existem</div>}
                {WIZARDS.map(w => (
                  <button key={w.codigo} style={S.menuIt} onClick={() => abrirWizard(w)}
                          onMouseEnter={e => (e.currentTarget.style.background = T.bgSoft)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    <Wand2 size={15} style={{ color: T.violet, marginTop: 1, flexShrink: 0 }} />
                    <span>
                      <div style={S.menuNm}>{w.nome}</div>
                      <div style={S.menuDs}>{w.descricao}</div>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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
                  {cap.can('estrutura') && <button style={S.btnIcon} title="Estrutura (desenho do formulário)" onClick={e => { e.stopPropagation(); navigate(`/formularios/${f.id}/estrutura`) }}><Settings2 size={14} /></button>}
                  <button style={S.btnIcon} title="Renomear" onClick={e => openEdit(f, e)}><Pencil size={14} /></button>
                  <button style={S.btnIcon} title="Excluir" onClick={e => del(f.id, e)}><Trash2 size={14} /></button>
                  <button style={{ ...S.btnIcon, color: T.violet }} title="Preencher"><ChevronRight size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {wz.open && (
        <div style={S.overlay} onClick={() => !wz.rodando && setWz({ open: false })}>
          <div style={{ ...S.modal, width: 520 }} onClick={e => e.stopPropagation()}>
            <div style={S.mTitle}><Wand2 size={16} style={{ color: T.violet, verticalAlign: -2, marginRight: 8 }} />{wz.w.nome}</div>

            {wz.feito ? (
              <div style={S.okBox}>
                <p style={{ margin: '0 0 12px' }}>
                  Gerado: <strong>{wz.feito.escopos}</strong> escopo(s) e <strong>{wz.feito.celulas}</strong> células.
                </p>
                {wz.feito.avisos.map((a, i) => (
                  <div key={i} style={S.aviso}>
                    <AlertTriangle size={14} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
                    <span>{a}</span>
                  </div>
                ))}
                <p style={{ margin: '12px 0 0', color: T.muted, fontSize: 12 }}>
                  Confira os números no formulário e use o <strong>Aplicar</strong> para levar ao orçado —
                  gerar não grava nada no orçamento.
                </p>
                <div style={S.mFooter}>
                  <button style={S.btnSec} onClick={() => setWz({ open: false })}>Fechar</button>
                  <button style={S.btnPri} onClick={() => navigate(`/formularios/${wz.feito!.formularioId}`)}>Abrir formulário</button>
                </div>
              </div>
            ) : (
              <>
                <div style={S.como}>{wz.w.comoFunciona}</div>
                {(wz.w.avisos ?? []).map((a, i) => (
                  <div key={i} style={S.aviso}>
                    <AlertTriangle size={14} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
                    <span>{a}</span>
                  </div>
                ))}
                <div style={{ ...S.field, marginTop: 16 }}>
                  <label style={S.label}>Ler o orçado de qual versão?</label>
                  <select style={S.input} value={wz.versaoId} onChange={e => setWz({ ...wz, versaoId: e.target.value })}>
                    <option value="">— escolha —</option>
                    {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}{v.ano ? ` · ${v.ano}` : ''}</option>)}
                  </select>
                </div>
                <div style={S.row2}>
                  <div style={S.field}>
                    <label style={S.label}>Nome do formulário</label>
                    <input style={S.input} value={wz.nome} onChange={e => setWz({ ...wz, nome: e.target.value })} />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Ano</label>
                    <input style={S.input} type="number" value={wz.ano} onChange={e => setWz({ ...wz, ano: Number(e.target.value) })} />
                  </div>
                </div>
                <div style={S.field}>
                  <label style={S.label}>Código</label>
                  <input style={S.input} value={wz.codigo} onChange={e => setWz({ ...wz, codigo: e.target.value.toUpperCase() })} />
                </div>
                {wz.erro && <div style={{ ...S.aviso, borderColor: 'var(--red)', color: 'var(--red)' }}>{wz.erro}</div>}
                <div style={S.mFooter}>
                  <button style={S.btnSec} onClick={() => setWz({ open: false })} disabled={wz.rodando}>Cancelar</button>
                  <button style={{ ...S.btnPri, opacity: wz.rodando ? .6 : 1 }} onClick={gerar} disabled={wz.rodando}>
                    {wz.rodando ? 'Gerando…' : 'Gerar formulário'}
                  </button>
                </div>
              </>
            )}
          </div>
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
