import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { listarFatores, responderDesafio, erroLegivel, type Fator } from '../../lib/mfa'

// ============================================================
// Desafio do segundo fator, entre a senha e o aplicativo.
//
// ⚠ Quem decide se esta tela aparece é o **AAL**, não um papel: ela entra
// quando a sessão está em `aal1` e o alvo é `aal2` — isto é, quando a pessoa
// TEM fator verificado e ainda não o provou. Não há como inscrever e continuar
// entrando só com a senha, que seria a aparência da proteção sem a proteção.
//
// ⚠ "Sair" tem de estar aqui. Sem isso, quem perdeu o aparelho fica preso numa
// tela sem saída, com uma sessão aal1 que não serve para nada — e nem consegue
// tentar outra conta.
// ============================================================

export default function MfaDesafio({ email }: { email?: string }) {
  const [fatores, setFatores] = useState<Fator[]>([])
  const [sel, setSel] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    listarFatores()
      .then(({ verificados }) => { setFatores(verificados); setSel(verificados[0]?.id || '') })
      .catch(e => setErro(erroLegivel(e)))
  }, [])

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sel || codigo.length < 6) return
    setErro(''); setOcupado(true)
    try {
      await responderDesafio(sel, codigo)
      // `challengeAndVerify` troca a sessão por uma em aal2; o
      // onAuthStateChange do App recebe o TOKEN_REFRESHED e reavalia.
      const { data } = await supabase.auth.getSession()
      if (!data.session) setErro('Sessão perdida. Entre de novo.')
    } catch (err) { setErro(erroLegivel(err)); setCodigo('') } finally { setOcupado(false) }
  }

  const S = {
    tela: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)', fontFamily: 'system-ui, sans-serif', padding: 20 } as const,
    caixa: { width: '100%', maxWidth: 400, background: 'var(--panel)', border: '1px solid var(--border)',
             borderRadius: 14, padding: '30px 28px' } as const,
    inp: { width: '100%', padding: '12px', fontSize: 20, letterSpacing: 6, textAlign: 'center' as const,
           fontFamily: 'ui-monospace, monospace', background: 'var(--bg-soft)', color: 'var(--text)',
           border: '1px solid var(--border-strong)', borderRadius: 9, boxSizing: 'border-box' as const },
    btn: { width: '100%', marginTop: 14, padding: '11px', fontSize: 14, fontWeight: 600,
           background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer' } as const,
  }

  return (
    <div style={S.tela}>
      <form style={S.caixa} onSubmit={enviar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <ShieldCheck size={19} style={{ color: 'var(--violet)' }} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Verificação em duas etapas</h1>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.65, margin: '0 0 20px' }}>
          Digite o código de seis dígitos do seu aplicativo autenticador{email ? <> para <b style={{ color: 'var(--text-mid)' }}>{email}</b></> : ''}.
        </p>

        {erro && <div style={{ fontSize: 12.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)',
                               border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8,
                               padding: '9px 12px', marginBottom: 14 }}>{erro}</div>}

        {fatores.length > 1 && (
          <select style={{ width: '100%', padding: '9px 11px', fontSize: 13, marginBottom: 10,
                           background: 'var(--bg-soft)', color: 'var(--text)',
                           border: '1px solid var(--border-strong)', borderRadius: 8 }}
                  value={sel} onChange={e => setSel(e.target.value)}>
            {fatores.map(f => <option key={f.id} value={f.id}>{f.friendly_name || 'Autenticador'}</option>)}
          </select>
        )}

        <input style={S.inp} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
               placeholder="000000" value={codigo}
               onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} />

        <button style={{ ...S.btn, opacity: ocupado || codigo.length < 6 ? 0.5 : 1 }}
                disabled={ocupado || codigo.length < 6}>
          {ocupado ? 'Verificando…' : 'Entrar'}
        </button>

        <button type="button" onClick={() => supabase.auth.signOut()}
                style={{ width: '100%', marginTop: 10, padding: 8, fontSize: 12.5, background: 'none',
                         border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
          Sair e usar outra conta
        </button>

        <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, marginTop: 16, marginBottom: 0 }}>
          Sem acesso ao aparelho? Não há código de recuperação — peça a um administrador para
          remover o seu segundo fator pelo console do banco de dados.
        </p>
      </form>
    </div>
  )
}
