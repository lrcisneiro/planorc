import { useState } from 'react'
import { RefreshCw, Trash2, X, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ============================================================
// Manutenção do cenário — ressincronizar e excluir.
//
// Existem porque a baseline **se move**: em 2027 ela estava em construção
// quando o primeiro cenário ia nascer. Sem ressincronizar, a célula que a área
// não tocou guarda o valor do dia do semear, e qualquer mudança da
// controladoria passa a aparecer como proposta de REVERTER — ruído que a área
// nunca pediu e que ainda exige veredito.
//
// ⚠ Ressincronizar vem ANTES de excluir na ordem da tela, de propósito:
// excluir perde o trabalho da área, ressincronizar o preserva. Quando as duas
// resolvem, a que preserva é a primeira que se oferece.
//
// ⚠ As duas simulam antes. Excluir pede ainda o CÓDIGO digitado — não é senha:
// o risco não é um estranho clicando, é a pessoa certa apagando o cenário
// errado (mesma razão de `apagar_orcado_versao`, v3_127).
// ============================================================

type Res = { acao: string; celulas: number; detalhe: string }

const bt: any = { height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)',
  background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6 }

export default function CenarioManutencao({ versaoId, codigo, onMudou }: {
  versaoId: string; codigo?: string; onMudou: () => void
}) {
  const [modo, setModo] = useState<'' | 'sync' | 'excluir'>('')
  const [res, setRes] = useState<Res[] | null>(null)
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState('')

  function abrir(m: 'sync' | 'excluir') {
    setModo(m); setRes(null); setConf(''); setErro(''); setFeito('')
    if (m === 'sync') simular()
  }

  async function simular() {
    setBusy(true)
    const { data, error } = await supabase.rpc('ressincronizar_cenario', { p_versao: versaoId, p_simular: true })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setRes((data || []) as Res[])
  }

  async function sincronizar() {
    setBusy(true); setErro('')
    const { data, error } = await supabase.rpc('ressincronizar_cenario', { p_versao: versaoId, p_simular: false })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setRes((data || []) as Res[]); setFeito('Cenário ressincronizado com a baseline.'); onMudou()
  }

  async function excluir() {
    setBusy(true); setErro('')
    const { error } = await supabase.rpc('excluir_cenario', { p_versao: versaoId, p_confirmacao: conf })
    setBusy(false)
    if (error) { setErro(error.message); return }
    setModo(''); onMudou()
  }

  return (<>
    <button onClick={() => abrir('sync')} style={bt}
      title="Trazer da baseline o que a área não tocou — a proposta é preservada">
      <RefreshCw size={13} /> Ressincronizar
    </button>
    <button onClick={() => abrir('excluir')} style={{ ...bt, color: 'var(--red)' }}
      title="Apagar este cenário e tudo que há nele">
      <Trash2 size={13} />
    </button>

    {modo && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
           onClick={() => !busy && setModo('')}>
        <div onClick={e => e.stopPropagation()}
             style={{ width: 'min(560px, 100%)', background: 'var(--panel)', border: '1px solid var(--border-strong)',
                      borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            {modo === 'sync' ? <RefreshCw size={17} style={{ color: 'var(--violet)' }} />
                             : <Trash2 size={17} style={{ color: 'var(--red)' }} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>
                {modo === 'sync' ? 'Ressincronizar com a baseline' : `Excluir o cenário ${codigo || ''}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {modo === 'sync'
                  ? 'As células que a área tocou ficam como estão.'
                  : 'Apaga o cenário, os valores e os vereditos. A baseline não é tocada.'}
              </div>
            </div>
            <button onClick={() => setModo('')} disabled={busy}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
              <X size={17} />
            </button>
          </div>

          <div style={{ padding: 18, display: 'grid', gap: 12 }}>
            {busy && !res && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Calculando…</div>}
            {erro && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{erro}</div>}
            {feito && <div style={{ fontSize: 12.5, color: 'var(--green)' }}>{feito}</div>}

            {modo === 'sync' && res?.map(r => (
              <div key={r.acao} style={{ padding: '9px 11px', borderRadius: 9, background: 'var(--panel-2)',
                                         border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text)' }}>
                <b>{r.celulas.toLocaleString('pt-BR')}</b> célula(s)
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.detalhe}</div>
              </div>
            ))}
            {modo === 'sync' && res && !res.length && (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                O cenário já está igual à baseline de hoje — nada a trazer.
              </div>
            )}
            {modo === 'sync' && res && !!res.length && !feito && (
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12, color: 'var(--orange)',
                            background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)',
                            borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
                <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>O veredito das linhas afetadas <b>volta a pendente</b>: o ✓ anterior era sobre outro número.</span>
              </div>
            )}

            {modo === 'excluir' && (<>
              <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
                Se a intenção é só <b>atualizar com a baseline de hoje</b>, prefira
                {' '}<b>Ressincronizar</b> — ela preserva o que a área já propôs. Excluir perde tudo.
              </div>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>
                  Digite <code>{codigo}</code> para confirmar
                </div>
                <input value={conf} onChange={e => setConf(e.target.value)} autoFocus
                  style={{ height: 34, padding: '0 10px', borderRadius: 8, width: '100%', boxSizing: 'border-box',
                           border: '1px solid var(--border-strong)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }} />
              </div>
            </>)}

            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
              <button onClick={() => setModo('')} disabled={busy}
                style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border-strong)',
                         background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
                {feito ? 'Fechar' : 'Cancelar'}
              </button>
              {modo === 'sync' && res && !!res.length && !feito && (
                <button onClick={sincronizar} disabled={busy}
                  style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--violet)',
                           color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                           display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  {busy && <Loader2 size={14} className="animate-spin" />} Ressincronizar
                </button>
              )}
              {modo === 'excluir' && (
                <button onClick={excluir} disabled={busy || conf.trim().toUpperCase() !== (codigo || '').toUpperCase()}
                  style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
                           background: conf.trim().toUpperCase() === (codigo || '').toUpperCase() ? 'var(--red)' : 'var(--panel-2)',
                           color: conf.trim().toUpperCase() === (codigo || '').toUpperCase() ? '#fff' : 'var(--muted)',
                           cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  {busy && <Loader2 size={14} className="animate-spin" />} Excluir
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
  </>)
}
