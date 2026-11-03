import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { ShieldCheck, ShieldAlert, Trash2, Plus, X } from 'lucide-react'
import { listarFatores, nivel, inscrever, confirmarInscricao, remover, limparPendentes, erroLegivel, type Fator } from '../../lib/mfa'

// ============================================================
// Minha conta → Segurança. Fora de Configurações **de propósito**: aquela tela
// é de admin (`menu.config`), e o segundo fator tem de ser alcançável por
// qualquer pessoa, inclusive quem não administra nada.
//
// ⚠ Sem capacidade nenhuma gateando: é a própria conta da pessoa. Gatear o
// acesso de alguém à própria segurança seria negar a ela o controle que a
// protege.
// ============================================================

const S: Record<string, CSSProperties> = {
  page:  { padding: '26px 28px 60px', maxWidth: 760 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '6px 0 24px', lineHeight: 1.65 },
  card:  { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px', marginBottom: 16 },
  h2:    { fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 },
  p:     { fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.7, margin: '0 0 14px' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', fontSize: 13, fontWeight: 600, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  btnP:  { borderColor: 'var(--violet)', color: 'var(--violet)' },
  inp:   { width: '100%', padding: '10px 12px', fontSize: 16, letterSpacing: 3, textAlign: 'center' as const, fontFamily: 'ui-monospace, monospace', background: 'var(--bg-soft)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 8 },
  erro:  { fontSize: 12.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '11px 13px', lineHeight: 1.65 },
  ok:    { fontSize: 12.5, color: 'var(--green)', background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
  lin:   { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: '1px solid var(--border)' },
  seg:   { fontFamily: 'ui-monospace, monospace', fontSize: 12.5, letterSpacing: 1, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 11px', wordBreak: 'break-all' as const, color: 'var(--text-mid)' },
}

export default function SegurancaPage() {
  const [fatores, setFatores] = useState<Fator[]>([])
  const [aal, setAal] = useState<{ atual: string | null }>({ atual: null })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState('')
  // Inscrição em curso: enquanto houver `novo`, o QR está na tela.
  const [novo, setNovo] = useState<{ fatorId: string; qr: string; segredo: string } | null>(null)
  const [apelido, setApelido] = useState('')
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = async () => {
    try {
      const [f, n] = await Promise.all([listarFatores(), nivel()])
      setFatores(f.verificados); setAal({ atual: n.atual })
    } catch (e) { setErro(erroLegivel(e)) } finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [])

  const comecar = async () => {
    setErro(''); setFeito(''); setOcupado(true)
    try {
      // Tentativa abandonada deixa fator `unverified` para trás — ele não
      // protege nada e ainda ocupa o limite de fatores do projeto.
      await limparPendentes()
      const nome = apelido.trim() || `Autenticador ${new Date().toLocaleDateString('pt-BR')}`
      const r = await inscrever(nome)
      setNovo({ fatorId: r.fatorId, qr: r.qr, segredo: r.segredo })
    } catch (e) { setErro(erroLegivel(e)) } finally { setOcupado(false) }
  }

  const confirmar = async () => {
    if (!novo || codigo.trim().length < 6) return
    setErro(''); setOcupado(true)
    try {
      await confirmarInscricao(novo.fatorId, codigo)
      setNovo(null); setCodigo(''); setApelido('')
      setFeito('Segundo fator ativado. A partir do próximo acesso, o código será pedido depois da senha.')
      await carregar()
    } catch (e) { setErro(erroLegivel(e)) } finally { setOcupado(false) }
  }

  const cancelar = async () => {
    setNovo(null); setCodigo(''); setErro('')
    await limparPendentes()
  }

  const apagar = async (f: Fator) => {
    if (!window.confirm(`Remover "${f.friendly_name || 'autenticador'}"?\n\nSe for o único, sua conta volta a ser protegida só pela senha.`)) return
    setErro(''); setOcupado(true)
    try { await remover(f.id); setFeito('Fator removido.'); await carregar() }
    catch (e) { setErro(erroLegivel(e)) } finally { setOcupado(false) }
  }

  const protegido = fatores.length > 0

  return (
    <div style={S.page}>
      <h1 style={S.title}>Segurança da minha conta</h1>
      <p style={S.sub}>
        O segundo fator é um código de seis dígitos que muda a cada trinta segundos, gerado por um
        aplicativo no seu aparelho. Mesmo quem souber sua senha não entra sem ele.
      </p>

      {erro && <div style={S.erro}>{erro}</div>}
      {feito && <div style={S.ok}>{feito}</div>}

      <div style={S.card}>
        <h2 style={S.h2}>
          {protegido
            ? <><ShieldCheck size={17} style={{ color: 'var(--green)' }} /> Verificação em duas etapas ativa</>
            : <><ShieldAlert size={17} style={{ color: 'var(--orange)' }} /> Verificação em duas etapas desativada</>}
        </h2>
        <p style={S.p}>
          {protegido
            ? <>Sua conta pede o código depois da senha. Sessão atual: <b>{aal.atual || '—'}</b>.</>
            : <>Hoje sua conta é protegida <b>apenas pela senha</b>.</>}
        </p>

        {fatores.map(f => (
          <div key={f.id} style={S.lin}>
            <ShieldCheck size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, color: 'var(--text)' }}>{f.friendly_name || 'Autenticador'}</div>
              {f.created_at && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                desde {new Date(f.created_at).toLocaleDateString('pt-BR')}</div>}
            </div>
            <button style={{ ...S.btn, padding: '6px 10px' }} onClick={() => apagar(f)} disabled={ocupado}>
              <Trash2 size={13} /> Remover
            </button>
          </div>
        ))}

        {carregando ? <p style={S.p}>Carregando…</p> : !novo && (
          <div style={{ marginTop: fatores.length ? 16 : 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...S.inp, width: 220, fontSize: 13, letterSpacing: 0, textAlign: 'left' }}
                   placeholder={fatores.length ? 'apelido do 2º aparelho' : 'apelido (ex.: iPhone)'}
                   value={apelido} onChange={e => setApelido(e.target.value)} />
            <button style={{ ...S.btn, ...S.btnP }} onClick={comecar} disabled={ocupado}>
              <Plus size={14} /> {fatores.length ? 'Adicionar outro aparelho' : 'Ativar'}
            </button>
          </div>
        )}
      </div>

      {novo && (
        <div style={S.card}>
          <h2 style={S.h2}>Escaneie o código</h2>
          <p style={S.p}>
            Abra seu aplicativo autenticador (Google Authenticator, Authy, 1Password, Microsoft
            Authenticator) e aponte para a imagem. Depois digite o código que ele mostrar.
          </p>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ background: '#fff', padding: 12, borderRadius: 10, lineHeight: 0 }}
                 dangerouslySetInnerHTML={{ __html: novo.qr }} />
            <div style={{ flex: 1, minWidth: 230 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                Não consegue escanear? Digite esta chave no aplicativo:
              </div>
              <div style={S.seg}>{novo.segredo}</div>
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Código de seis dígitos</div>
                <input style={S.inp} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                       placeholder="000000" value={codigo}
                       onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
                       onKeyDown={e => { if (e.key === 'Enter') confirmar() }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button style={{ ...S.btn, ...S.btnP }} onClick={confirmar} disabled={ocupado || codigo.length < 6}>
                  {ocupado ? 'Confirmando…' : 'Confirmar'}
                </button>
                <button style={S.btn} onClick={cancelar} disabled={ocupado}><X size={14} /> Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={S.aviso}>
        <b>Antes de ativar, saiba como voltar.</b> Este sistema <b>não tem códigos de recuperação</b> —
        se você perder o aparelho, a única saída é alguém com acesso ao console do Supabase remover
        o seu fator. Por isso, a recuperação de verdade é <b>inscrever um segundo aparelho</b>: o
        autenticador do celular <i>e</i> o do seu gerenciador de senhas, por exemplo. Leva um minuto
        agora e evita um problema que, sozinho, você não resolve.
      </div>
    </div>
  )
}
