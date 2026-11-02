import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { ModalPanel } from './DashFiltros'
import { Users, User, UserCheck } from 'lucide-react'

// ============================================================
// Com quem este preset é compartilhado.
//
// Era binário — só eu, ou o tenant inteiro —, e com 14 presets compartilhados
// quem entra para conferir a própria área recebe quatorze cartões. "Todos"
// deixou de ser o que a pessoa quer dizer na maioria das vezes.
//
// Três escolhas, e a do meio é a que faltava. A semântica é aditiva (v3_153):
// lista vazia devolve o comportamento antigo, então nada do que existe muda
// até alguém restringir.
//
// ⚠ A visibilidade é garantida pela POLÍTICA do banco, não por esta tela. Aqui
// só se edita a lista; esconder no frontend deixaria o preset a um `select` de
// distância — e os filtros dele contam que áreas existem.
// ============================================================

export type Alvo = { modo: 'eu' | 'pessoas' | 'todos'; users: string[] }

const opt = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', fontSize: 13,
    borderRadius: 9, cursor: 'pointer', fontWeight: 600, textAlign: 'left', width: '100%',
    border: '1px solid ' + (on ? 'var(--violet)' : 'var(--border-strong)'),
    background: on ? 'rgba(139,92,246,0.14)' : 'var(--panel)',
    color: on ? 'var(--violet)' : 'var(--text-mid)',
})

const S: Record<string, CSSProperties> = {
  dica: { fontSize: 11.5, color: 'var(--muted)', fontWeight: 400, marginLeft: 'auto' },
  lista: { maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginTop: 10 },
  pess: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 2px', cursor: 'pointer' },
}

export function CompartilharCard({ titulo, inicial, podeTodos, onFechar, onAplicar }: {
  titulo: string
  inicial: Alvo
  /** Só admin compartilha com o tenant inteiro — como já era. */
  podeTodos: boolean
  onFechar: () => void
  onAplicar: (a: Alvo) => void
}) {
  const [modo, setModo] = useState(inicial.modo)
  const [sel, setSel] = useState<string[]>(inicial.users)
  const [users, setUsers] = useState<{ user_id: string; email: string; role: string }[]>([])
  const [eu, setEu] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('get_tenant_users').then(r => setUsers((r.data || []) as any[]))
    supabase.auth.getUser().then(({ data: { user } }) => setEu(user?.id ?? null))
  }, [])

  const toggle = (id: string) => setSel(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id])
  const outros = users.filter(u => u.user_id !== eu)

  return (
    <ModalPanel titulo={`Compartilhar · ${titulo}`} onClose={onFechar} width="min(480px, calc(100vw - 40px))">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button style={opt(modo === 'eu')} onClick={() => setModo('eu')}>
          <User size={15} /> Só para mim <span style={S.dica}>ninguém mais vê</span>
        </button>
        <button style={opt(modo === 'pessoas')} onClick={() => setModo('pessoas')}>
          <UserCheck size={15} /> Escolher pessoas <span style={S.dica}>{sel.length || 'nenhuma'} selecionada(s)</span>
        </button>
        {podeTodos && (
          <button style={opt(modo === 'todos')} onClick={() => setModo('todos')}>
            <Users size={15} /> Todo o time <span style={S.dica}>aparece para qualquer um</span>
          </button>
        )}
      </div>

      {modo === 'pessoas' && (
        <div style={S.lista}>
          {outros.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: 6 }}>Nenhuma outra pessoa no tenant.</div>}
          {outros.map(u => (
            <label key={u.user_id} style={S.pess}>
              <input type="checkbox" checked={sel.includes(u.user_id)} onChange={() => toggle(u.user_id)} />
              <span style={{ color: 'var(--text)' }}>{u.email}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{u.role}</span>
            </label>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, margin: '12px 0 0' }}>
        Quem recebe também precisa ter acesso ao relatório e aos dados do painel — compartilhar
        o atalho não dá acesso ao que ele mostra.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button style={{ ...opt(true), width: 'auto', justifyContent: 'center' }}
                onClick={() => onAplicar({ modo, users: modo === 'pessoas' ? sel : [] })}>
          Aplicar
        </button>
        <button style={{ ...opt(false), width: 'auto', justifyContent: 'center' }} onClick={onFechar}>Cancelar</button>
      </div>
    </ModalPanel>
  )
}

/** Grava o alvo: `owner_id` diz "meu ou do time" e a lista diz "dirigido a quem".
 *  A lista é reescrita inteira — é pequena, e diferença incremental aqui só
 *  criaria estado meio-aplicado quando uma das chamadas falhasse. */
export async function gravarAlvo(cardId: string, alvo: Alvo, uid: string | null) {
  const owner_id = alvo.modo === 'todos' ? null : uid
  const { error: e1 } = await supabase.from('dashboard_card').update({ owner_id }).eq('id', cardId).select('id')
  if (e1) throw new Error(e1.message)
  const { error: e2 } = await supabase.from('dashboard_card_acesso').delete().eq('card_id', cardId)
  if (e2) throw new Error(e2.message)
  if (alvo.modo === 'pessoas' && alvo.users.length) {
    const { error: e3 } = await supabase.from('dashboard_card_acesso')
      .insert(alvo.users.map(u => ({ tenant_id: TENANT_ID, card_id: cardId, user_id: u })))
    if (e3) throw new Error(e3.message)
  }
}
