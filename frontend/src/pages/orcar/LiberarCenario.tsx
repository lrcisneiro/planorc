import { useState } from 'react'
import { Upload, X, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ============================================================
// Liberar o cenário na baseline — escreve no orçamento oficial.
//
// ⚠ A PRÉVIA NÃO É OPCIONAL. O botão não libera: ele simula. Só depois de ver
// o relatório — quantas células entram, quantas saem, quantas caem sobre
// mudança que a controladoria fez depois — é que aparece o confirmar. Mesma
// razão do resumo antes de apagar o orçado (v3_127) e do `p_simular` da
// importação de funcionários: ação que se descobre pelo estrago é cara demais.
//
// As duas linhas de aviso do relatório são as que importam, e por isso vêm
// destacadas: `conflito` (a baseline mudou desde o semear — está se
// sobrescrevendo trabalho de outra pessoa) e `sobre_gerada` (a proposta caiu
// em cima de valor de posto/formulário, que a próxima aplicação regrava).
// ============================================================

type Linha = { acao: string; celulas: number; valor: number; detalhe: string }

const ALERTA = new Set(['conflito', 'sobre_gerada', 'nao_apagada'])
const money = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function LiberarCenario({ versaoId, codigo, baselineCodigo, onLiberado }: {
  versaoId: string
  codigo?: string
  baselineCodigo?: string
  onLiberado: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [previa, setPrevia] = useState<Linha[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(false)

  async function simular() {
    setAberto(true); setBusy(true); setErro(''); setPrevia(null); setFeito(false)
    const { data, error } = await supabase.rpc('mesclar_cenario_orcado', { p_versao: versaoId, p_simular: true })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setPrevia((data || []) as Linha[])
  }

  async function liberar() {
    setBusy(true); setErro('')
    const { data, error } = await supabase.rpc('mesclar_cenario_orcado', { p_versao: versaoId, p_simular: false })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setPrevia((data || []) as Linha[]); setFeito(true); onLiberado()
  }

  const nada = previa && !previa.length

  return (<>
    <button onClick={simular}
      title="Ver o que seria escrito na baseline — ainda não grava nada"
      style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border-strong)',
               background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12.5, fontWeight: 600,
               cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <Upload size={14} /> Liberar na baseline
    </button>

    {aberto && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
           onClick={() => !busy && setAberto(false)}>
        <div onClick={e => e.stopPropagation()}
             style={{ width: 'min(680px, 100%)', background: 'var(--panel)', border: '1px solid var(--border-strong)',
                      borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            <Upload size={17} style={{ color: 'var(--violet)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>
                {feito ? 'Liberado' : 'Prévia da liberação'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {codigo} → {baselineCodigo || 'baseline'} · só as linhas aprovadas, só origem manual
              </div>
            </div>
            <button onClick={() => setAberto(false)} disabled={busy}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
              <X size={17} />
            </button>
          </div>

          <div style={{ padding: 18, display: 'grid', gap: 12 }}>
            {busy && !previa && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Calculando…</div>}
            {erro && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{erro}</div>}

            {nada && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Nada a liberar: nenhuma célula manual de linha aprovada foi alterada neste cenário.
              </div>
            )}

            {previa?.map(l => (
              <div key={l.acao} style={{ display: 'flex', gap: 11, alignItems: 'flex-start',
                        padding: '9px 11px', borderRadius: 9,
                        border: `1px solid ${ALERTA.has(l.acao) ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
                        background: ALERTA.has(l.acao) ? 'rgba(245,158,11,0.08)' : 'var(--panel-2)' }}>
                {ALERTA.has(l.acao) && <AlertTriangle size={15} style={{ color: 'var(--orange)', marginTop: 1, flexShrink: 0 }} />}
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5 }}>
                  <b>{l.celulas.toLocaleString('pt-BR')}</b> célula(s) · Δ {money(l.valor)}
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{l.detalhe}</div>
                </div>
              </div>
            ))}

            {!feito && previa && !nada && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
                A baseline <b>não tem volta automática</b> — não há desfazer. Confira os avisos acima antes.
              </div>
            )}

            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
              <button onClick={() => setAberto(false)} disabled={busy}
                style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border-strong)',
                         background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
                {feito ? 'Fechar' : 'Cancelar'}
              </button>
              {!feito && previa && !nada && (
                <button onClick={liberar} disabled={busy}
                  style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--violet)',
                           color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                           display: 'inline-flex', alignItems: 'center', gap: 7, opacity: busy ? 0.7 : 1 }}>
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  Gravar na baseline
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
  </>)
}
