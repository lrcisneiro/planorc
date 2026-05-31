import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

type TenantUser = { user_id: string; email: string; role: string }
type Empresa    = { id: string; codigo: string; descricao: string }
type Filial     = { id: string; codigo: string; descricao: string }
type Dimensao   = { id: string; codigo: string; label: string; tabela_ref: string | null }
type DimOpcao   = { id: string; label: string }
type DimConfig  = { key: string; label: string; opcoes: DimOpcao[]; selecionados: string[] }

const S = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: '0 0 4px' } as React.CSSProperties,
  sub:     { fontSize: 13, color: '#868e96', margin: '0 0 20px' } as React.CSSProperties,
  tabs:    { display: 'flex', gap: 4, borderBottom: '1px solid #e9ecef', marginBottom: 20 } as React.CSSProperties,
  tab: (a: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    border: 'none', background: 'none',
    color: a ? '#3b5bdb' : '#868e96',
    borderBottom: a ? '2px solid #3b5bdb' : '2px solid transparent',
    marginBottom: -1,
  }),
  card:    { background: 'white', borderRadius: 12, border: '1px solid #e9ecef', overflow: 'hidden' } as React.CSSProperties,
  th:      { textAlign: 'left' as const, padding: '10px 16px', color: '#868e96', fontWeight: 500, fontSize: 12, background: '#f8f9fa', borderBottom: '1px solid #e9ecef' },
  td:      { padding: '10px 16px', borderBottom: '1px solid #f1f3f5', color: '#343a40', fontSize: 13 },
  btn: (v: 'primary' | 'secondary'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
    borderRadius: 6, border: v === 'secondary' ? '1px solid #dee2e6' : 'none',
    background: v === 'primary' ? '#3b5bdb' : 'white',
    color: v === 'primary' ? 'white' : '#495057',
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  }),
  badge: (r: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 500,
    background: r === 'admin' ? '#e7f5ff' : '#f1f3f5',
    color: r === 'admin' ? '#1971c2' : '#495057',
  }),
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: 'white', borderRadius: 16, padding: 28, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
}

// ── Modal de configuração de acesso ──────────────────────
function ModalAcesso({ user, onClose }: { user: TenantUser; onClose: () => void }) {
  const [dims, setDims] = useState<DimConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    carregarTudo()
  }, [])

  const carregarTudo = async () => {
    const [
      { data: empresas },
      { data: filiais },
      { data: dimensoes },
      { data: regrasExist },
    ] = await Promise.all([
      supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao').order('codigo'),
      supabase.from('dimensao').select('id,codigo,label,tabela_ref').eq('ativo', true).order('ordem'),
      supabase.from('user_acesso_regra').select('dimensao,valor_ids').eq('user_id', user.user_id),
    ])

    const regraMap: Record<string, string[]> = {}
    for (const r of regrasExist || []) regraMap[r.dimensao] = r.valor_ids || []

    // Carrega opções de cada dimensão
    const dimConfigs: DimConfig[] = [
      {
        key: 'empresa', label: 'Empresa',
        opcoes: (empresas || []).map((e: Empresa) => ({ id: e.id, label: `${e.codigo} — ${e.descricao}` })),
        selecionados: regraMap['empresa'] || [],
      },
      {
        key: 'filial', label: 'Filial',
        opcoes: (filiais || []).map((f: Filial) => ({ id: f.id, label: `${f.codigo} — ${f.descricao}` })),
        selecionados: regraMap['filial'] || [],
      },
    ]

    // Dimensões dinâmicas
    await Promise.all((dimensoes || []).map(async (dim: Dimensao) => {
      let opcoes: DimOpcao[] = []
      if (dim.tabela_ref === 'centro_custo') {
        const { data } = await supabase.from('centro_custo').select('id,codigo,descricao').eq('ativo', true).order('codigo')
        opcoes = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      } else if (dim.tabela_ref === 'funcionario') {
        const { data } = await supabase.from('funcionario').select('id,codigo,nome').eq('ativo', true).order('nome')
        opcoes = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.nome}` }))
      } else if (dim.tabela_ref === 'verba_folha') {
        const { data } = await supabase.from('verba_folha').select('id,codigo,descricao').order('codigo')
        opcoes = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      } else if (dim.tabela_ref === 'conta_contabil') {
        const { data } = await supabase.from('conta_contabil').select('id,codigo,descricao').order('codigo')
        opcoes = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      } else {
        const { data } = await supabase.from('dimensao_valor').select('id,codigo,descricao').eq('dimensao_id', dim.id).eq('ativo', true).order('codigo')
        opcoes = (data || []).map((v: any) => ({ id: v.id, label: `${v.codigo} — ${v.descricao}` }))
      }
      dimConfigs.push({ key: dim.codigo, label: dim.label, opcoes, selecionados: regraMap[dim.codigo] || [] })
    }))

    setDims(dimConfigs)
    setLoading(false)
  }

  const setSelecionados = (key: string, ids: string[]) =>
    setDims(prev => prev.map(d => d.key === key ? { ...d, selecionados: ids } : d))

  const toggleItem = (key: string, id: string) => {
    const dim = dims.find(d => d.key === key)!
    const next = dim.selecionados.includes(id)
      ? dim.selecionados.filter(x => x !== id)
      : [...dim.selecionados, id]
    setSelecionados(key, next)
  }

  const salvar = async () => {
    setSaving(true); setErro('')
    const records = dims.map(d => ({
      user_id: user.user_id,
      dimensao: d.key,
      valor_ids: d.selecionados,
    }))
    const { error } = await supabase.from('user_acesso_regra').upsert(records, {
      onConflict: 'tenant_id,user_id,dimensao',
    })
    setSaving(false)
    if (error) { setErro(error.message); return }
    onClose()
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#212529', marginBottom: 4 }}>
          Acesso: {user.email}
        </div>
        <div style={{ fontSize: 12, color: '#868e96', marginBottom: 20 }}>
          Sem restrição = acesso a todos os itens da dimensão.
        </div>

        {loading ? (
          <p style={{ color: '#aaa', textAlign: 'center', padding: 24 }}>Carregando...</p>
        ) : (
          dims.map(dim => (
            <div key={dim.key} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#343a40' }}>{dim.label}</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#868e96', cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={dim.selecionados.length === 0}
                    onChange={() => setSelecionados(dim.key, [])}
                  />
                  Sem restrição
                </label>
              </div>
              {dim.selecionados.length > 0 && (
                <div style={{ fontSize: 12, color: '#495057', marginBottom: 6 }}>
                  {dim.selecionados.length} de {dim.opcoes.length} selecionados
                </div>
              )}
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: 8, padding: '4px 0' }}>
                {dim.opcoes.length === 0 ? (
                  <div style={{ padding: '8px 12px', color: '#aaa', fontSize: 12 }}>Nenhum item cadastrado</div>
                ) : dim.opcoes.map(opt => (
                  <label key={opt.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fa')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <input type="checkbox"
                      checked={dim.selecionados.length === 0 || dim.selecionados.includes(opt.id)}
                      disabled={dim.selecionados.length === 0}
                      onChange={() => {
                        if (dim.selecionados.length === 0) {
                          // Primeira seleção específica: marca todos exceto este
                          setSelecionados(dim.key, dim.opcoes.map(o => o.id).filter(id => id !== opt.id))
                        } else {
                          toggleItem(dim.key, opt.id)
                        }
                      }}
                    />
                    <span style={{ color: dim.selecionados.length > 0 && !dim.selecionados.includes(opt.id) ? '#aaa' : '#343a40' }}>
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}

        {erro && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fff5f5', color: '#c92a2a', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button style={S.btn('secondary')} onClick={onClose}>Cancelar</button>
          <button style={S.btn('primary')} onClick={salvar} disabled={saving || loading}>
            {saving ? 'Salvando...' : 'Salvar acesso'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal de convite ─────────────────────────────────────
function ModalConvidarUsuario({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const convidar = async () => {
    if (!email.trim()) { setErro('Informe o email.'); return }
    setLoading(true); setErro('')
    const { error } = await supabase.functions.invoke('criar-usuario', {
      body: {
        email: email.trim(),
        role,
        redirectTo: `${window.location.origin}/login`,
      },
    })
    setLoading(false)
    if (error) {
      // Extrai mensagem real da Edge Function (não o genérico "non-2xx")
      let msg = error.message
      try {
        const body = await (error as any).context?.json?.()
        if (body?.error) msg = body.error
      } catch {}
      setErro(msg)
      return
    }
    onSuccess()
    onClose()
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...S.modal, width: 420 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#212529', marginBottom: 4 }}>Convidar usuário</div>
        <div style={{ fontSize: 12, color: '#868e96', marginBottom: 20 }}>
          Um email de convite será enviado com o link de acesso.
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#343a40', marginBottom: 6 }}>Email</label>
          <input
            type="email" value={email} autoFocus
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && convidar()}
            placeholder="usuario@empresa.com"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, boxSizing: 'border-box' as const }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#343a40', marginBottom: 6 }}>Perfil</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13 }}>
            <option value="viewer">Viewer — somente leitura</option>
            <option value="member">Member — leitura + edição</option>
            <option value="admin">Admin — acesso total + gestão</option>
          </select>
        </div>

        {erro && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fff5f5', color: '#c92a2a', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={S.btn('secondary')} onClick={onClose}>Cancelar</button>
          <button style={S.btn('primary')} onClick={convidar} disabled={loading || !email.trim()}>
            {loading ? 'Enviando...' : 'Enviar convite'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Aba de usuários ───────────────────────────────────────
function UsuariosTab() {
  const [users, setUsers] = useState<TenantUser[]>([])
  const [loading, setLoading] = useState(true)
  const [selecionado, setSelecionado] = useState<TenantUser | null>(null)
  const [showConvidar, setShowConvidar] = useState(false)
  const [erroAcesso, setErroAcesso] = useState('')

  const carregar = async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('get_tenant_users')
    if (error) {
      setErroAcesso(error.message.includes('admin') || error.message.includes('negado')
        ? 'Somente administradores podem gerenciar usuários.'
        : `Erro ao carregar usuários: ${error.message}`
      )
    } else {
      setUsers((data || []) as TenantUser[])
    }
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  if (loading) return <p style={{ color: '#aaa', padding: 16 }}>Carregando...</p>
  if (erroAcesso) return <p style={{ color: '#c92a2a', padding: 16 }}>{erroAcesso}</p>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button style={S.btn('primary')} onClick={() => setShowConvidar(true)}>
          + Convidar usuário
        </button>
      </div>

      <div style={S.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={S.th}>Email</th>
              <th style={S.th}>Perfil</th>
              <th style={S.th}>Acesso</th>
              <th style={{ ...S.th, width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: '#aaa', padding: 32 }}>Nenhum usuário encontrado.</td></tr>
            ) : users.map(u => (
              <tr key={u.user_id}
                onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fa')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={S.td}>{u.email}</td>
                <td style={S.td}><span style={S.badge(u.role)}>{u.role}</span></td>
                <td style={S.td}>
                  <AccessSummary userId={u.user_id} />
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  <button style={S.btn('secondary')} onClick={() => setSelecionado(u)}>
                    Editar acesso
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selecionado && (
        <ModalAcesso user={selecionado} onClose={() => { setSelecionado(null); carregar() }} />
      )}
      {showConvidar && (
        <ModalConvidarUsuario
          onClose={() => setShowConvidar(false)}
          onSuccess={() => { setShowConvidar(false); carregar() }}
        />
      )}
    </>
  )
}

// Mini-resumo das restrições do usuário
function AccessSummary({ userId }: { userId: string }) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    supabase.from('user_acesso_regra')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('valor_ids', '{}')
      .then(({ count: c }) => setCount(c ?? 0))
  }, [userId])

  if (count === null) return <span style={{ color: '#aaa', fontSize: 12 }}>—</span>
  if (count === 0) return <span style={{ color: '#2f9e44', fontSize: 12 }}>Acesso total</span>
  return <span style={{ color: '#e67700', fontSize: 12 }}>{count} dimensão(ões) restrita(s)</span>
}

// ── Página principal ──────────────────────────────────────
export default function ConfiguracoesPage() {
  const [aba, setAba] = useState<'usuarios'>('usuarios')

  return (
    <div style={S.page}>
      <h1 style={S.title}>Configurações</h1>
      <p style={S.sub}>Gerencie usuários e permissões do tenant</p>

      <div style={S.tabs}>
        <button style={S.tab(aba === 'usuarios')} onClick={() => setAba('usuarios')}>
          Usuários
        </button>
      </div>

      {aba === 'usuarios' && <UsuariosTab />}
    </div>
  )
}
