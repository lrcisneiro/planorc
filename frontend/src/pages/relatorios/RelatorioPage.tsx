import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { T } from '../../lib/theme'
import { Plus, Pencil, Trash2, ChevronRight, Copy } from 'lucide-react'

async function fetchAll(build: () => any): Promise<any[]> {
  const out: any[] = []; const size = 1000; let from = 0
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error || !data || !data.length) break
    out.push(...data); if (data.length < size) break; from += size
  }
  return out
}

type Categoria = { id: string; codigo: string; nome: string }
type Relatorio = {
  id: string
  codigo: string
  nome: string
  categoria_id: string | null
  descricao: string | null
  _nlinhas?: number
}

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

type ModalState =
  | { open: false }
  | { open: true; id?: string; codigo: string; nome: string; categoria_id: string; descricao: string }

export default function RelatorioPage({ linkBase = '/relatorios', titulo = 'Relatórios', subtitulo = 'Demonstrações financeiras — DRE, BP, DFC e outras' }: { linkBase?: string; titulo?: string; subtitulo?: string } = {}) {
  const [rels, setRels] = useState<Relatorio[]>([])
  const [cats, setCats] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })
  const navigate = useNavigate()

  const catNome = (id: string | null) => cats.find(c => c.id === id)?.nome ?? '—'

  const load = async () => {
    setLoading(true); setErro(null)
    const [{ data: cs }, { data, error }] = await Promise.all([
      supabase.from('categoria_relatorio').select('id,codigo,nome').order('ordem'),
      supabase.from('relatorio').select('id, codigo, nome, categoria_id, descricao, relatorio_linha(count)').order('nome'),
    ])
    setCats(cs || [])
    if (error) { setErro(error.message); setLoading(false); return }
    setRels((data || []).map((r: any) => ({ ...r, _nlinhas: r.relatorio_linha?.[0]?.count ?? 0 })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const openCreate = () => setModal({ open: true, codigo: '', nome: '', categoria_id: cats[0]?.id ?? '', descricao: '' })
  const openEdit = (r: Relatorio, e: ReactMouseEvent) => {
    e.stopPropagation()
    setModal({ open: true, id: r.id, codigo: r.codigo, nome: r.nome, categoria_id: r.categoria_id ?? '', descricao: r.descricao ?? '' })
  }
  const close = () => setModal({ open: false })

  const save = async () => {
    if (!modal.open || !modal.nome || !modal.codigo) return
    const payload = { codigo: modal.codigo, nome: modal.nome, categoria_id: modal.categoria_id || null, descricao: modal.descricao || null }
    const { error } = modal.id
      ? await supabase.from('relatorio').update(payload).eq('id', modal.id)
      : await supabase.from('relatorio').insert({ tenant_id: TENANT_ID, ...payload })
    if (error) { alert('Erro ao salvar: ' + error.message); return }
    close(); load()
  }

  const del = async (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!confirm('Excluir relatório e todas as linhas?')) return
    const { error } = await supabase.from('relatorio').delete().eq('id', id)
    if (error) { alert('Erro ao excluir: ' + error.message); return }
    load()
  }

  const [dupId, setDupId] = useState<string | null>(null)
  const duplicar = async (r: Relatorio, e: ReactMouseEvent) => {
    e.stopPropagation()
    const novoCod = prompt('Código do novo relatório:', r.codigo + '_COPIA')
    if (!novoCod) return
    const novoNome = prompt('Nome do novo relatório:', r.nome + ' (cópia)')
    if (!novoNome) return
    setDupId(r.id)
    try {
      // 1) novo relatório
      const { data: nr, error: e1 } = await supabase.from('relatorio')
        .insert({ tenant_id: TENANT_ID, codigo: novoCod.trim(), nome: novoNome.trim(), categoria_id: r.categoria_id, descricao: r.descricao })
        .select('id').single()
      if (e1 || !nr) throw e1 || new Error('Falha ao criar relatório')

      // 2) copia linhas (preserva código; pai_id resolvido depois)
      const src = await fetchAll(() => supabase.from('relatorio_linha').select('*').eq('relatorio_id', r.id))
      const oldIdToCode: Record<string, string> = {}
      src.forEach((l: any) => { oldIdToCode[l.id] = l.codigo })
      if (src.length) {
        const ins = src.map((l: any) => { const { id, relatorio_id, pai_id, ...rest } = l; return { ...rest, relatorio_id: nr.id, pai_id: null } })
        const novos = await fetchAll(() => supabase.from('relatorio_linha').insert(ins).select('id,codigo'))
        const codeToNew: Record<string, string> = {}
        novos.forEach((l: any) => { codeToNew[l.codigo] = l.id })
        // resolve hierarquia (pai_id) pelo código
        for (const l of src) {
          if (!l.pai_id) continue
          const novoId = codeToNew[l.codigo]; const novoPai = codeToNew[oldIdToCode[l.pai_id]]
          if (novoId && novoPai) await supabase.from('relatorio_linha').update({ pai_id: novoPai }).eq('id', novoId)
        }
        // F2: as linhas copiadas preservam linha_orc_id (referenciam a MESMA estrutura
        // compartilhada), então DE-PARA (conta_linha) e dados do orçado já são compartilhados.
        // Não se copia conta_linha (duplicaria na mesma linha mestre).
        // copia visões
        const vs = await fetchAll(() => supabase.from('view_config').select('*').eq('relatorio_id', r.id))
        if (vs.length) {
          const vIns = vs.map((v: any) => { const { id, relatorio_id, ...rest } = v; return { ...rest, relatorio_id: nr.id } })
          await supabase.from('view_config').insert(vIns)
        }
        alert(`Relatório duplicado: ${src.length} linhas (compartilham a mesma estrutura — DE-PARA e orçado vêm juntos).`)
      }
      load()
      navigate(`${linkBase}/${nr.id}`)
    } catch (err: any) {
      alert('Erro ao duplicar: ' + (err?.message ?? JSON.stringify(err)))
    } finally { setDupId(null) }
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>{titulo}</h1>
          <p style={S.sub}>{subtitulo}</p>
        </div>
        <button style={S.btnAdd} onClick={openCreate}><Plus size={15} /> Novo relatório</button>
      </div>

      {erro && (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: `1px solid ${T.red}`, borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: T.red, fontSize: 13 }}>
          <strong>Erro:</strong> {erro}
        </div>
      )}

      {loading ? (
        <p style={{ color: T.muted }}>Carregando...</p>
      ) : rels.length === 0 ? (
        <div style={S.empty}>
          <p style={{ fontSize: 15, fontWeight: 500, color: T.textMid }}>Nenhum relatório criado ainda</p>
          <button style={{ ...S.btnAdd, margin: '16px auto 0' }} onClick={openCreate}><Plus size={15} /> Criar relatório</button>
        </div>
      ) : (
        <div style={S.grid}>
          {rels.map(r => (
            <div key={r.id} style={S.card} onClick={() => navigate(`${linkBase}/${r.id}`)}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.45)'; e.currentTarget.style.borderColor = T.borderS }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = T.border }}>
              <div style={S.cardTop}>
                <div>
                  <div style={S.nome}>{r.nome}</div>
                  <div style={S.codigo}>{r.codigo}</div>
                </div>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: 'rgba(59,130,246,0.15)', color: T.blue }}>
                  {catNome(r.categoria_id)}
                </span>
              </div>
              <div style={S.desc}>{r.descricao || <span style={{ fontStyle: 'italic' }}>Sem descrição</span>}</div>
              <div style={S.footer}>
                <span style={{ fontSize: 12, color: T.muted }}>{r._nlinhas} linha{r._nlinhas !== 1 ? 's' : ''}</span>
                <div style={S.actions}>
                  <button style={S.btnIcon} title="Duplicar (copia linhas e amarrações de conta)" disabled={dupId === r.id}
                    onClick={e => duplicar(r, e)}>{dupId === r.id ? <span style={{ fontSize: 11 }}>…</span> : <Copy size={14} />}</button>
                  <button style={S.btnIcon} title="Editar" onClick={e => openEdit(r, e)}><Pencil size={14} /></button>
                  <button style={S.btnIcon} title="Excluir" onClick={e => del(r.id, e)}><Trash2 size={14} /></button>
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
            <div style={S.mTitle}>{modal.id ? 'Editar relatório' : 'Novo relatório'}</div>
            <div style={S.field}>
              <label style={S.label}>Código *</label>
              <input style={S.input} placeholder="Ex: DRE_GERENCIAL" value={modal.codigo}
                onChange={e => setModal(p => p.open ? { ...p, codigo: e.target.value.toUpperCase() } : p)} />
            </div>
            <div style={S.field}>
              <label style={S.label}>Nome *</label>
              <input style={S.input} placeholder="Ex: DRE — Gerencial" value={modal.nome}
                onChange={e => setModal(p => p.open ? { ...p, nome: e.target.value } : p)} />
            </div>
            <div style={S.field}>
              <label style={S.label}>Categoria</label>
              <select style={S.input} value={modal.categoria_id}
                onChange={e => setModal(p => p.open ? { ...p, categoria_id: e.target.value } : p)}>
                <option value="">— sem categoria —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
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
