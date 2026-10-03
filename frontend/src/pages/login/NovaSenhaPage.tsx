import { useState } from 'react'
import { Building2, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Troca de senha depois do link de recuperação.
//
// Esta tela é OBRIGATÓRIA no estado de recuperação, e não um atalho opcional: o
// link do e-mail cria uma sessão válida no Supabase, então quem chega aqui já
// está tecnicamente autenticado. Sem forçar a troca, o link de "esqueci minha
// senha" funcionaria como login — e continuaria funcionando a cada clique, até
// expirar, para quem tivesse acesso à caixa de e-mail.
//
// Daí não haver "pular" nem navegação para fora: a única saída é definir a
// senha ou sair da conta.

const MIN = 8

export default function NovaSenhaPage({ email, primeiroAcesso }: { email?: string; primeiroAcesso?: boolean }) {
  const [senha, setSenha] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    if (senha.length < MIN) { setErro(`A senha precisa de pelo menos ${MIN} caracteres.`); return }
    if (senha !== conf) { setErro('As duas senhas não são iguais.'); return }
    setSalvando(true)
    // a marca do convite sai JUNTO com a senha, na mesma chamada: em duas
    // chamadas, uma falha no meio deixaria a pessoa com senha definida e ainda
    // presa nesta tela
    const { error } = await supabase.auth.updateUser({
      password: senha,
      data: { precisa_senha: false },
    })
    setSalvando(false)
    if (error) {
      // o caso comum aqui é link vencido: a sessão de recuperação expirou entre
      // abrir o e-mail e enviar o formulário
      setErro(error.message.toLowerCase().includes('session')
        ? 'O link expirou. Peça uma nova recuperação de senha na tela de entrada.'
        : error.message)
      return
    }
    setPronto(true)
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)',
    borderRadius: 8, fontSize: 14, color: 'var(--text)', background: 'var(--panel)',
    outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--panel)', borderRadius: 16, padding: '40px 36px', width: 380,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, background: '#1e2d5a', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Building2 size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Planorc</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Planejamento Orçamentário</div>
          </div>
        </div>

        {pronto ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              <Check size={20} color="var(--green)" /> {primeiroAcesso ? 'Senha criada' : 'Senha alterada'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
              {primeiroAcesso ? 'Sua senha foi criada. Entre com ela para começar.' : 'Sua senha foi trocada. Entre de novo para continuar.'}
            </div>
            <button onClick={() => supabase.auth.signOut()}
              style={{ width: '100%', padding: 11, background: 'var(--violet)', color: '#ffffff', border: 'none',
                borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Ir para a entrada
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              {primeiroAcesso ? 'Bem-vindo ao Planorc' : 'Definir nova senha'}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
              {email ? <>Para <b>{email}</b>. </> : null}
              {primeiroAcesso
                ? <>Este é o seu primeiro acesso: crie uma senha para entrar das próximas vezes. O link do convite
                    expira, a senha não.</>
                : <>Escolha uma senha de pelo menos {MIN} caracteres.</>}
            </div>

            <form onSubmit={salvar}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 }}>Nova senha</label>
                <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
                  autoFocus required autoComplete="new-password" style={inp} placeholder="••••••••" />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 }}>Repita a nova senha</label>
                <input type="password" value={conf} onChange={e => setConf(e.target.value)}
                  required autoComplete="new-password" style={inp} placeholder="••••••••" />
              </div>

              {erro && <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)',
                borderRadius: 8, fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>{erro}</div>}

              <button type="submit" disabled={salvando}
                style={{ width: '100%', padding: 11, background: 'var(--violet)', color: '#ffffff', border: 'none',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: salvando ? 'not-allowed' : 'pointer' }}>
                {salvando ? 'Salvando…' : 'Salvar nova senha'}
              </button>
            </form>

            {/* a única saída sem trocar a senha — e ela encerra a sessão de
                recuperação, em vez de deixar o usuário dentro do sistema */}
            <button onClick={() => supabase.auth.signOut()}
              style={{ width: '100%', marginTop: 12, padding: 8, background: 'none', border: 'none',
                color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
              Cancelar e voltar para a entrada
            </button>
          </>
        )}
      </div>
    </div>
  )
}
