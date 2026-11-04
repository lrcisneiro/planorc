import { useState } from 'react'
import { Check, X, MessageSquare, RotateCcw } from 'lucide-react'

// ============================================================
// O veredito de UMA linha do cenário de orçamento.
//
// Mesma mecânica do comparativo de postos, que já se provou em uso: ✓/✗ na
// própria linha, recusa com motivo visível ali mesmo, e a resposta de quem
// propôs no mesmo lugar — sair da tela para responder é sair de onde está a
// recusa que se quer responder.
//
// ⚠ Recusar EXIGE motivo, e o editor abre INLINE. A primeira versão disto nos
// postos usava `window.prompt` e ficou feio; mais que feio, o texto some se a
// pessoa fecha a caixa sem querer. Aqui o rascunho vive no estado.
//
// ⚠ Dois campos, dois lados: `aprov_nota` é a objeção de quem aprova, `nota` é
// a resposta de quem propõe. Guardar num só faria a segunda apagar a primeira,
// e é a primeira que o aprovador precisa reler para conferir se foi atendida.
// ============================================================

export type Veredito = { aprovado: boolean | null; nota: string | null; aprov_nota: string | null }

const btn = (cor: string, ativo: boolean): any => ({
  width: 24, height: 24, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: `1px solid ${ativo ? cor : 'var(--border-strong)'}`, background: ativo ? cor : 'transparent',
  color: ativo ? '#fff' : 'var(--muted)', cursor: 'pointer', padding: 0,
})

export default function VereditoLinha({ v, podeAprovar, podeResponder, onDecidir, onReabrir }: {
  v: Veredito | undefined
  podeAprovar: boolean
  podeResponder: boolean
  onDecidir: (aprovado: boolean, nota?: string) => Promise<void>
  onReabrir: (nota: string) => Promise<void>
}) {
  const [modo, setModo] = useState<'' | 'recusar' | 'responder'>('')
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const ap = v?.aprovado ?? null

  async function enviar() {
    if (!texto.trim()) return
    setSalvando(true)
    try {
      if (modo === 'recusar') await onDecidir(false, texto.trim())
      else await onReabrir(texto.trim())
      setModo(''); setTexto('')
    } finally { setSalvando(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {podeAprovar ? (<>
          <button title="Aprovar esta linha" style={btn('var(--green)', ap === true)}
            onClick={() => onDecidir(true)} disabled={salvando}><Check size={14} /></button>
          <button title="Recusar — exige motivo" style={btn('var(--red)', ap === false)}
            onClick={() => { setModo(m => m === 'recusar' ? '' : 'recusar'); setTexto(v?.aprov_nota || '') }}
            disabled={salvando}><X size={14} /></button>
        </>) : (
          <span style={{ fontSize: 11.5, fontWeight: 600,
                         color: ap === true ? 'var(--green)' : ap === false ? 'var(--red)' : 'var(--muted)' }}>
            {ap === true ? 'aprovada' : ap === false ? 'recusada' : 'pendente'}
          </span>
        )}
        {/* Quem propôs responde aqui mesmo — e responder reabre: a resposta a
            uma recusa é texto, nenhum número muda, e sem isso o veredito
            ficaria recusado para sempre. */}
        {ap === false && podeResponder && (
          <button title="Responder e reenviar para análise"
            onClick={() => { setModo(m => m === 'responder' ? '' : 'responder'); setTexto(v?.nota || '') }}
            style={{ ...btn('var(--violet)', false), width: 'auto', padding: '0 7px', gap: 4, fontSize: 11 }}>
            <RotateCcw size={12} /> responder
          </button>
        )}
      </div>

      {/* A objeção fica à vista na linha, junto do número que ela recusa. */}
      {ap === false && v?.aprov_nota && !modo && (
        <div style={{ fontSize: 11.5, color: 'var(--red)', textAlign: 'left', maxWidth: 260, lineHeight: 1.45 }}>
          <MessageSquare size={10} style={{ verticalAlign: -1, marginRight: 4 }} />{v.aprov_nota}
        </div>
      )}
      {v?.nota && !modo && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', maxWidth: 260, lineHeight: 1.45 }}>
          resposta: {v.nota}
        </div>
      )}

      {modo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 260 }}>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} autoFocus
            placeholder={modo === 'recusar' ? 'Por que não passa?' : 'O que respondeu à objeção?'}
            style={{ fontSize: 12, padding: '6px 8px', borderRadius: 7, resize: 'vertical',
                     border: '1px solid var(--border-strong)', background: 'var(--panel-2)', color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={enviar} disabled={salvando || !texto.trim()}
              style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 6, border: 'none', color: '#fff',
                       background: modo === 'recusar' ? 'var(--red)' : 'var(--violet)',
                       cursor: texto.trim() ? 'pointer' : 'default', opacity: texto.trim() ? 1 : 0.6 }}>
              {modo === 'recusar' ? 'Recusar' : 'Reenviar'}
            </button>
            <button onClick={() => { setModo(''); setTexto('') }}
              style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-strong)',
                       background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
