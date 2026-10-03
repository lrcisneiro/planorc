import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [loading, setLoading] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(''); setAviso('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setLoading(false)
    if (error) setErro('E-mail ou senha incorretos.')
  }

  const recuperar = async () => {
    setErro(''); setAviso('')
    if (!email.trim()) { setErro('Informe o e-mail para receber o link de recuperação.'); return }
    setEnviando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Precisa casar EXATAMENTE com uma entrada de Redirect URLs do Supabase —
      // sem correspondência ele descarta e manda para o Site URL, que é um
      // endereço de produção e não serve para quem está testando em dev.
      // O caminho também torna o link do e-mail legível para quem o recebe.
      redirectTo: `${window.location.origin}/nova-senha`,
    })
    setEnviando(false)

    // Conta inexistente NÃO gera erro aqui — o Supabase responde sucesso de
    // propósito. Então todo erro que chega é de infraestrutura (autorização do
    // remetente, limite, SMTP fora do ar) e pode ser mostrado sem revelar quem
    // tem cadastro. Engolir esses erros deixava a tela dizendo "enviado" quando
    // nada tinha saído.
    if (error) {
      const m = (error.message || '').toLowerCase()
      setErro(
        m.includes('not authorized') || m.includes('not allowed')
          ? 'O servidor de e-mail ainda não está configurado para enviar a endereços de fora da equipe do projeto. Avise o administrador do sistema.'
        : m.includes('rate') || (error as any).status === 429
          ? 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.'
          : `Não consegui enviar o e-mail: ${error.message}`)
      return
    }
    // resposta igual exista ou não a conta: dizer "e-mail não cadastrado" aqui
    // entregaria a quem tenta adivinhar a lista de quem tem acesso ao sistema
    setAviso('Se este e-mail tiver cadastro, o link de recuperação chega em instantes. Verifique também o lixo eletrônico.')
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

          {aviso && (
            <div style={{
              padding: '10px 14px', background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.35)',
              borderRadius: 8, fontSize: 13, color: 'var(--green)', marginBottom: 16, lineHeight: 1.5,
            }}>
              {aviso}
            </div>
          )}

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

          <button type="button" onClick={recuperar} disabled={enviando}
            style={{
              width: '100%', marginTop: 14, padding: 6, background: 'none', border: 'none',
              color: 'var(--muted)', fontSize: 12.5, cursor: enviando ? 'default' : 'pointer', textDecoration: 'underline',
            }}>
            {enviando ? 'Enviando…' : 'Esqueci minha senha'}
          </button>
        </form>
      </div>
    </div>
  )
}
