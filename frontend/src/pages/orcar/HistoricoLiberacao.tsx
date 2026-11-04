import { useEffect, useState } from 'react'
import { History, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ============================================================
// O que foi liberado na baseline — o registro de auditoria.
//
// ⚠ A liberação NÃO TEM DESFAZER. Sem este registro, "por que esta linha da
// baseline mudou?" não tinha resposta nem para quem aprovou: a versão guardava
// só `mesclado_em`, e a tabela `auditoria` não cobre — o gatilho de
// `fat_orcado` registra apenas DELETE em massa.
//
// Guarda-se o relatório por LINHA, não as células: são ~200 linhas por
// liberação em vez de milhares, e responde o que de fato se pergunta — quais
// linhas mudaram, quanto, e com qual aviso.
// ============================================================

type Cab = { id: string; quando: string; celulas: number; delta_total: number; baseline_codigo: string }
type Lin = { linha_id: string | null; acao: string; celulas: number; delta: number }

const ROTULO: Record<string, string> = {
  gravar: 'gravadas', conflito: 'gravadas sobre mudança da controladoria',
  sobre_gerada: 'gravadas sobre valor gerado', apagar: 'apagadas',
  nao_apagada: 'preservadas (baseline nova)',
}
const money = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

export default function HistoricoLiberacao({ versaoId, nomeLinha }: {
  versaoId: string
  nomeLinha: (masterId: string | null) => string
}) {
  const [aberto, setAberto] = useState(false)
  const [cabs, setCabs] = useState<Cab[]>([])
  const [lins, setLins] = useState<Lin[]>([])
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    setCarregando(true)
    ;(async () => {
      const { data: c } = await supabase.from('vw_cenario_liberacao')
        .select('id,quando,celulas,delta_total,baseline_codigo')
        .eq('versao_id', versaoId).order('quando', { ascending: false })
      if (!vivo) return
      setCabs((c || []) as Cab[])
      const ids = (c || []).map((x: any) => x.id)
      if (ids.length) {
        const { data: l } = await supabase.from('cenario_liberacao_linha')
          .select('linha_id,acao,celulas,delta').in('liberacao_id', ids)
        if (vivo) setLins((l || []) as Lin[])
      }
      if (vivo) setCarregando(false)
    })()
    return () => { vivo = false }
  }, [aberto, versaoId])

  return (<>
    <button onClick={() => setAberto(true)} title="O que esta liberação escreveu na baseline"
      style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)',
               background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer',
               display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <History size={13} /> O que foi liberado
    </button>

    {aberto && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
           onClick={() => setAberto(false)}>
        <div onClick={e => e.stopPropagation()}
             style={{ width: 'min(760px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
                      background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            <History size={17} style={{ color: 'var(--violet)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>O que foi liberado na baseline</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {cabs.length
                  ? `${new Date(cabs[0].quando).toLocaleString('pt-BR')} · ${cabs[0].celulas} célula(s) · Δ ${money(cabs[0].delta_total)} · para ${cabs[0].baseline_codigo}`
                  : 'Sem liberação registrada.'}
              </div>
            </div>
            <button onClick={() => setAberto(false)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
              <X size={17} />
            </button>
          </div>

          <div style={{ overflow: 'auto', padding: 18 }}>
            {carregando && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Carregando…</div>}
            {!carregando && !lins.length && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Nada registrado. Liberações feitas antes desta versão do sistema não deixaram histórico.
              </div>
            )}
            {!!lins.length && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>
                  {['Linha', 'O que houve', 'Células', 'Δ'].map((h, i) => (
                    <th key={h} style={{ textAlign: i >= 2 ? 'right' : 'left', padding: '6px 8px',
                                         borderBottom: '1px solid var(--border)', color: 'var(--muted)',
                                         fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {lins.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)' }}>
                        {nomeLinha(l.linha_id)}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel-2)',
                                   color: l.acao === 'gravar' ? 'var(--muted)' : 'var(--orange)' }}>
                        {ROTULO[l.acao] || l.acao}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel-2)', textAlign: 'right',
                                   color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums' }}>{l.celulas}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel-2)', textAlign: 'right',
                                   color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{money(l.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    )}
  </>)
}
