import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CAPACIDADES } from '../../lib/capacidades'
import type { Papel } from '../../lib/capacidades'

type TenantUser = { user_id: string; email: string; role: string }
type Empresa    = { id: string; codigo: string; descricao: string }
type Filial     = { id: string; codigo: string; descricao: string }
type Dimensao   = { id: string; codigo: string; label: string; tabela_ref: string | null }
type DimOpcao   = { id: string; label: string }
type DimConfig  = { key: string; label: string; opcoes: DimOpcao[]; selecionados: string[] }

const S = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  title:   { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' } as React.CSSProperties,
  sub:     { fontSize: 13, color: 'var(--muted)', margin: '0 0 20px' } as React.CSSProperties,
  tabs:    { display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 } as React.CSSProperties,
  tab: (a: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    border: 'none', background: 'none',
    color: a ? 'var(--violet)' : 'var(--muted)',
    borderBottom: a ? '2px solid var(--violet)' : '2px solid transparent',
    marginBottom: -1,
  }),
  card:    { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' } as React.CSSProperties,
  th:      { textAlign: 'left' as const, padding: '10px 16px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)' },
  td:      { padding: '10px 16px', borderBottom: '1px solid var(--panel)', color: 'var(--text)', fontSize: 13 },
  btn: (v: 'primary' | 'secondary'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
    borderRadius: 6, border: v === 'secondary' ? '1px solid var(--border-strong)' : 'none',
    background: v === 'primary' ? 'var(--violet)' : 'var(--panel)',
    color: v === 'primary' ? 'var(--panel)' : 'var(--text-mid)',
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
  }),
  badge: (r: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 500,
    background: r === 'admin' ? 'rgba(59,130,246,0.16)' : 'var(--panel)',
    color: r === 'admin' ? 'var(--blue)' : 'var(--text-mid)',
  }),
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:   { background: 'var(--panel)', borderRadius: 16, padding: 28, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
}

// ── Modal de configuração de acesso ──────────────────────
function ModalAcesso({ user, onClose }: { user: TenantUser; onClose: () => void }) {
  const [dims, setDims] = useState<DimConfig[]>([])
  const [ccRows, setCcRows] = useState<any[]>([])   // CCs com área/divisão/BU p/ os atalhos
  const [funcOv, setFuncOv] = useState<Record<string, boolean>>({})  // override de capacidade (só os explícitos)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')
  const papelUser = (user.role as Papel)

  useEffect(() => {
    carregarTudo()
  }, [])

  const carregarTudo = async () => {
    const [
      { data: empresas },
      { data: filiais },
      { data: ccsData },
      { data: dimensoes },
      { data: regrasExist },
      { data: funcExist },
    ] = await Promise.all([
      supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao').order('codigo'),
      supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      supabase.from('dimensao').select('id,codigo,label,tabela_ref').eq('ativo', true).order('ordem'),
      supabase.from('user_acesso_regra').select('dimensao,valor_ids').eq('user_id', user.user_id),
      supabase.from('user_acesso_funcao').select('capacidade,permitido').eq('user_id', user.user_id),
    ])

    const regraMap: Record<string, string[]> = {}
    for (const r of regrasExist || []) regraMap[r.dimensao] = r.valor_ids || []
    const fov: Record<string, boolean> = {}
    for (const r of (funcExist as any[]) || []) fov[r.capacidade] = r.permitido
    setFuncOv(fov)

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
      {
        key: 'centro_custo', label: 'Centro de Custo',
        opcoes: (ccsData || []).map((c: any) => ({ id: c.id, label: `${c.codigo} — ${c.descricao}` })),
        selecionados: regraMap['centro_custo'] || [],
      },
    ]

    // Dimensões dinâmicas (CC já é fixo acima — não duplicar)
    await Promise.all((dimensoes || []).filter((d: Dimensao) => d.tabela_ref !== 'centro_custo').map(async (dim: Dimensao) => {
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
    setCcRows(ccsData || [])
    setLoading(false)
  }

  // Atalhos de Centro de Custo: agrupam por área/divisão/BU
  const distinctAttr = (codeAttr: string, nameAttr: string) => {
    const m = new Map<string, string>()
    for (const c of ccRows) { const code = c[codeAttr]; if (code) m.set(code, c[nameAttr] || code) }
    return [...m.entries()].map(([code, nome]) => ({ code, nome })).sort((a, b) => a.nome.localeCompare(b.nome))
  }
  const toggleGrupoCC = (codeAttr: string, code: string) => {
    const ids = ccRows.filter(c => c[codeAttr] === code).map(c => c.id)
    const sel = dims.find(d => d.key === 'centro_custo')?.selecionados || []
    const allIn = ids.length > 0 && ids.every(id => sel.includes(id))
    setSelecionados('centro_custo', allIn ? sel.filter(id => !ids.includes(id)) : [...new Set([...sel, ...ids])])
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
      escopo: 'VER',          // F2: por ora a tela grava o escopo de consulta
      valor_ids: d.selecionados,
    }))
    const { error } = await supabase.from('user_acesso_regra').upsert(records, {
      onConflict: 'tenant_id,user_id,dimensao,escopo',
    })
    if (error) { setSaving(false); setErro(error.message); return }

    // Override de capacidade: regrava só os explícitos (ausência = herda o papel)
    await supabase.from('user_acesso_funcao').delete().eq('user_id', user.user_id)
    const funcRecords = Object.entries(funcOv).map(([capacidade, permitido]) => ({ user_id: user.user_id, capacidade, permitido }))
    if (funcRecords.length) {
      const { error: ef } = await supabase.from('user_acesso_funcao').insert(funcRecords)
      if (ef) { setSaving(false); setErro(ef.message); return }
    }

    setSaving(false)
    onClose()
  }

  const setFunc = (key: string, val: 'herda' | boolean) =>
    setFuncOv(prev => { const n = { ...prev }; if (val === 'herda') delete n[key]; else n[key] = val; return n })

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          Acesso: {user.email}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
          Sem restrição = acesso a todos os itens da dimensão.
        </div>

        {loading ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>Carregando...</p>
        ) : (
          <>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>Funções e menus</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              "Herdar" segue o padrão do perfil ({user.role}). Liberar/Negar sobrepõem só para este usuário.
            </div>
            {(['Funções', 'Menu'] as const).map(cat => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{cat}</div>
                {CAPACIDADES.filter(c => c.categoria === cat).map(c => {
                  const cur: 'herda' | boolean = c.key in funcOv ? funcOv[c.key] : 'herda'
                  const padrao = c.padrao[papelUser] ?? false
                  return (
                    <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '4px 0' }}>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{c.label}</span>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {([['herda', `Herdar (${padrao ? 'sim' : 'não'})`], [true, 'Liberar'], [false, 'Negar']] as const).map(([val, lbl]) => {
                          const active = cur === val
                          // admin não pode ser negado em Configurações (blindagem contra auto-lockout)
                          const travado = c.key === 'menu.config' && papelUser === 'admin' && val === false
                          const color = val === true ? 'var(--green)' : val === false ? 'var(--red)' : 'var(--text-mid)'
                          return (
                            <button key={String(val)} type="button" disabled={travado} onClick={() => !travado && setFunc(c.key, val)}
                              title={travado ? 'Admin sempre mantém acesso a Configurações' : undefined}
                              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: travado ? 'not-allowed' : 'pointer', opacity: travado ? 0.4 : 1,
                                border: '1px solid ' + (active ? color : 'var(--border-strong)'),
                                background: active ? (val === true ? 'rgba(52,211,153,0.15)' : val === false ? 'rgba(248,113,113,0.12)' : 'var(--bg)') : 'transparent',
                                color: active ? color : 'var(--muted)', fontWeight: active ? 700 : 500 }}>
                              {lbl}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {dims.map(dim => (
            <div key={dim.key} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{dim.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button type="button" onClick={() => setSelecionados(dim.key, dim.opcoes.map(o => o.id))}
                    style={{ background: 'none', border: 'none', color: 'var(--violet)', fontSize: 12, cursor: 'pointer', padding: 0 }}>Marcar todos</button>
                  <button type="button" onClick={() => setSelecionados(dim.key, [])}
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', padding: 0 }}>Desmarcar todos</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: dim.selecionados.length === 0 ? 'var(--muted)' : 'var(--text-mid)', marginBottom: 6 }}>
                {dim.selecionados.length === 0
                  ? 'Sem restrição — acesso a todos. Marque os itens permitidos para restringir.'
                  : `${dim.selecionados.length} de ${dim.opcoes.length} permitidos`}
              </div>
              {dim.key === 'centro_custo' && ccRows.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {([['area_cod', 'area_nome', 'Área'], ['divisao_cod', 'divisao_nome', 'Divisão'], ['bu_cod', 'bu_nome', 'BU']] as const).map(([ca, na, lbl]) => {
                    const grupos = distinctAttr(ca, na)
                    if (!grupos.length) return null
                    return (
                      <div key={ca} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', width: 56, flexShrink: 0 }}>{lbl}:</span>
                        {grupos.map(g => {
                          const ids = ccRows.filter(c => c[ca] === g.code).map(c => c.id)
                          const allIn = ids.length > 0 && ids.every(id => dim.selecionados.includes(id))
                          const someIn = ids.some(id => dim.selecionados.includes(id))
                          return (
                            <button key={g.code} type="button" onClick={() => toggleGrupoCC(ca, g.code)} title={`${ids.length} CC(s)`}
                              style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
                                border: '1px solid ' + (allIn ? 'var(--violet)' : someIn ? 'rgba(139,92,246,0.4)' : 'var(--border-strong)'),
                                background: allIn ? 'rgba(139,92,246,0.18)' : 'transparent',
                                color: allIn ? '#cbb8ff' : someIn ? 'var(--text-mid)' : 'var(--muted)' }}>
                              {g.nome}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0' }}>
                {dim.opcoes.length === 0 ? (
                  <div style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>Nenhum item cadastrado</div>
                ) : dim.opcoes.map(opt => (
                  <label key={opt.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}>
                    <input type="checkbox"
                      checked={dim.selecionados.includes(opt.id)}
                      onChange={() => toggleItem(dim.key, opt.id)}
                    />
                    <span style={{ color: dim.selecionados.includes(opt.id) ? 'var(--text)' : 'var(--muted)' }}>
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          </>
        )}

        {erro && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(248,113,113,0.10)', color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

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
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Convidar usuário</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
          Um email de convite será enviado com o link de acesso.
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Email</label>
          <input
            type="email" value={email} autoFocus
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && convidar()}
            placeholder="usuario@empresa.com"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 13, boxSizing: 'border-box' as const }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>Perfil</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 13 }}>
            <option value="viewer">Viewer — somente leitura</option>
            <option value="member">Member — leitura + edição</option>
            <option value="admin">Admin — acesso total + gestão</option>
          </select>
        </div>

        {erro && <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(248,113,113,0.10)', color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{erro}</div>}

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

  if (loading) return <p style={{ color: 'var(--muted)', padding: 16 }}>Carregando...</p>
  if (erroAcesso) return <p style={{ color: 'var(--red)', padding: 16 }}>{erroAcesso}</p>

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
              <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: 'var(--muted)', padding: 32 }}>Nenhum usuário encontrado.</td></tr>
            ) : users.map(u => (
              <tr key={u.user_id}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
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

  if (count === null) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  if (count === 0) return <span style={{ color: 'var(--green)', fontSize: 12 }}>Acesso total</span>
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
