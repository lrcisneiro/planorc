// ============================================================
// MODO DISCRETO — esconde o GRÃO de centros de custo restritos.
//
// ⚠⚠ NÃO É CONTROLE DE ACESSO. Quem está na tela TEM direito ao dado; o que
// se protege é a SALA. Uma apresentação para gerentes e outras diretorias não
// pode mostrar o grão da Diretoria e o dos diretores, mas a mesma pessoa, numa
// reunião de conselho, precisa mostrar. Por isso é um interruptor de TELA:
// nenhuma política de RLS muda, e quem tiver o token alcança a API igual.
// Esconder de uma PESSOA é outra coisa — é o escopo de acesso, no banco desde
// a v3_129.
//
// A regra, em uma frase: **com o modo ligado, o CC restrito não existe como
// grão em lugar nenhum** — nem no eixo do gráfico, nem no drill, nem no razão,
// nem na lista de filtros. Só no total, que não muda.
//
// ⚠ O balde chama-se "Outros" e é o MESMO dos gráficos (top-N), nunca
// "restrito": nome próprio convida à subtração (`total − visíveis`), e
// misturado com os CCs pequenos legítimos a conta não fecha para quem assiste.
//
// ⚠⚠ GRUPO DE DIMENSÃO cujo valor venha TODO de CC restrito também é
// mascarado — medido: a área 4 "Diretoria" tem 4 CCs cadastrados e **todo o
// valor dela é do 411**. Conferir por CONTAGEM de CCs diria que ela "mistura"
// e a deixaria exposta; a medição é por VALOR.
//
// ⚠ Estado em módulo, não em `localStorage`: aba nova começa DESLIGADA
// (decisão do Ricardo, 24/nov — o modo é ato deliberado antes da reunião).
// Em módulo e não em estado de página porque ele atravessa rotas: ligar no
// acompanhamento e navegar para a análise não pode desligar sozinho.
// ============================================================
import { useSyncExternalStore } from 'react'

let ligado = false
const inscritos = new Set<() => void>()

export function setDiscreto(v: boolean) {
  if (ligado === v) return
  ligado = v
  inscritos.forEach(f => f())
}
export function discretoAtivo() { return ligado }

export function useDiscreto(): boolean {
  return useSyncExternalStore(
    (f: () => void) => { inscritos.add(f); return () => { inscritos.delete(f) } },
    () => ligado,
    () => false,
  )
}

export type CcRestr = { id: string; restrito?: boolean | null }

/** ids dos CCs marcados no cadastro. Vazio quando o modo está desligado — os
 *  chamadores então seguem o caminho normal sem nenhum `if` espalhado. */
export function idsRestritos(ccs: CcRestr[], on: boolean): Set<string> {
  if (!on) return new Set()
  return new Set(ccs.filter(c => c.restrito).map(c => c.id))
}

export const ROTULO_OUTROS = 'Outros'

/** Soma num único item "Outros" tudo o que cair em CC restrito.
 *  `ccsDe` devolve os CCs que compõem a linha — uma barra do gráfico por
 *  nível 2 agrega vários, e a linha só é mascarada quando **todos** são
 *  restritos (é a mesma regra do grupo de dimensão, um nível abaixo). */
export function mascararLinhas<T>(
  linhas: T[],
  ccsDe: (l: T) => string[],
  restritos: Set<string>,
  juntar: (acc: T | null, l: T) => T,
): { linhas: T[]; ocultadas: number } {
  if (!restritos.size) return { linhas, ocultadas: 0 }
  const fora: T[] = []
  let balde: T | null = null
  for (const l of linhas) {
    const cs = ccsDe(l)
    const todoRestrito = cs.length > 0 && cs.every(c => restritos.has(c))
    if (todoRestrito) balde = juntar(balde, l)
    else fora.push(l)
  }
  if (balde === null) return { linhas, ocultadas: 0 }
  const n = linhas.length - fora.length
  return { linhas: [...fora, balde], ocultadas: n }
}

/** Um grupo (área, divisão, BU, nível 2 do CC…) é mascarado quando **todo o
 *  valor dele** vem de CC restrito. Tolerância de 0,1% porque o que importa é
 *  "na prática é só isso", não a igualdade exata — um CC irrelevante junto não
 *  deixa de revelar o número.
 *  ⚠ `|valor|`: um grupo com +100 restrito e −100 livre soma zero e passaria. */
export function grupoTodoRestrito(
  porCc: Record<string, number>,
  restritos: Set<string>,
): boolean {
  if (!restritos.size) return false
  let tot = 0, rest = 0
  for (const id in porCc) {
    const v = Math.abs(porCc[id] || 0)
    tot += v
    if (restritos.has(id)) rest += v
  }
  return tot > 0 && rest >= tot * 0.999
}

/** A lista de CCs que o seletor de filtros deve oferecer.
 *  ⚠ Deixá-los no filtro seria oferecer justamente o caminho que o modo existe
 *  para fechar — e a tela ainda entregaria o total do recorte. */
export function ccVisiveis<T extends CcRestr>(ccs: T[], restritos: Set<string>): T[] {
  return restritos.size ? ccs.filter(c => !restritos.has(c.id)) : ccs
}

/** Cruza um filtro de CC com o modo: o que for restrito sai do recorte pedido
 *  ao banco. `null` (sem restrição) vira a lista do que NÃO é restrito. */
export function filtroSemRestritos(
  ccFilter: string[] | null,
  todos: { id: string }[],
  restritos: Set<string>,
): string[] | null {
  if (!restritos.size) return ccFilter
  const base = ccFilter ?? todos.map(c => c.id)
  return base.filter(id => !restritos.has(id))
}
