import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setLoading(false)
    if (error) setErro('E-mail ou senha incorretos.')
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--panel)', borderRadius: 16, padding: '40px 36px',
        width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid var(--border)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{
            width: 40, height: 40, background: '#1e2d5a', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Building2 size={20} color="var(--panel)" />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Planorc</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Planejamento Orçamentário</div>
          </div>
        </div>

        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Entrar</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
          Acesse com seu e-mail e senha
        </div>

        <form onSubmit={entrar}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)',
                borderRadius: 8, fontSize: 14, color: 'var(--text)', outline: 'none',
                boxSizing: 'border-box', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--violet)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border-strong)')}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 }}>
              Senha
            </label>
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)',
                borderRadius: 8, fontSize: 14, color: 'var(--text)', outline: 'none',
                boxSizing: 'border-box', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--violet)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border-strong)')}
            />
          </div>

          {erro && (
            <div style={{
              padding: '10px 14px', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)',
              borderRadius: 8, fontSize: 13, color: 'var(--red)', marginBottom: 16,
            }}>
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', background: loading ? 'var(--violet)' : 'var(--violet)',
              color: '#ffffff', border: 'none', borderRadius: 8, fontSize: 14,
              fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.15s',
            }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
