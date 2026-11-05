import { useLocalPref } from './uiPrefs'

// ============================================================
// Ordenar uma tabela clicando no cabeçalho.
//
// Nasceu na grade de Postos e foi extraído quando a terceira tabela pediu o
// mesmo (Memória de cálculo e Folha realizada) — com três cópias, a quarta
// nasce diferente das outras e ninguém percebe.
//
// ⚠ O ciclo tem TRÊS paradas: asc → desc → **nenhuma**. Sem a terceira não há
// como voltar à ordem natural da tela (código do posto, ordem do grupo), e
// quem ordenou por engano fica preso numa vista que não é a de trabalho.
//
// A preferência é lembrada por tela (`chave`), porque ordenação é postura de
// quem analisa, não estado de uma visita.
// ============================================================

export type Ordem = { col: string | null; dir: 'asc' | 'desc' }

export function useOrdenacao(chave: string, opts: {
  /** estilo do <th> da tela — cada uma tem o seu objeto S */
  th?: any
  /** colunas que não podem ser ordenadas agora (ex.: dinheiro mascarado) */
  bloqueado?: (col: string) => boolean
  /** texto do title quando dá para clicar */
  dica?: string
} = {}) {
  const [ordem, setOrdem] = useLocalPref<Ordem>(chave, { col: null, dir: 'asc' })

  const clicar = (col: string) => setOrdem(o =>
    o.col !== col ? { col, dir: 'asc' }
    : o.dir === 'asc' ? { col, dir: 'desc' }
    : { col: null, dir: 'asc' })

  /** Ordena uma cópia. `valorDe` devolve número (compara numérico) ou texto. */
  function ordenar<T>(lista: T[], valorDe: (x: T, col: string) => any): T[] {
    if (!ordem.col) return lista
    const sinal = ordem.dir === 'asc' ? 1 : -1
    return [...lista].sort((a, b) => {
      const x = valorDe(a, ordem.col!), y = valorDe(b, ordem.col!)
      if (typeof x === 'number' && typeof y === 'number') return sinal * (x - y)
      return sinal * String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR')
    })
  }

  const Th = ({ col, children, right, style }: { col?: string; children?: any; right?: boolean; style?: any }) => {
    const ativo = !!col && ordem.col === col
    const pode = !!col && !(opts.bloqueado?.(col))
    return (
      <th style={{ ...(opts.th || {}), ...(right ? { textAlign: 'right' as const } : {}),
                   ...(pode ? { cursor: 'pointer', userSelect: 'none' as const } : {}),
                   ...(ativo ? { color: 'var(--violet)' } : {}), ...(style || {}) }}
          onClick={pode ? () => clicar(col!) : undefined}
          title={pode ? (opts.dica || 'Ordenar por esta coluna') : undefined}>
        {children}{ativo && <span style={{ marginLeft: 4 }}>{ordem.dir === 'asc' ? '▲' : '▼'}</span>}
      </th>
    )
  }

  return { ordem, clicar, ordenar, Th }
}
