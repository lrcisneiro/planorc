// Sobreposição do quadro de postos por versão/cenário (v3_120).
// Ref.: docs/DESIGN_cenarios.md §7.
//
// O posto MESTRE guarda a realidade (o que o RH manda). A sobreposição guarda
// as DECISÕES do cenário. Resolver é juntar os dois — e isso acontece ANTES do
// motor, de propósito: `calcularPosto` continua recebendo um posto comum, sem
// saber que cenário existe. Mantém a cascata de verbas testável e impede que a
// regra de cenário se espalhe por dentro dela.

// Campos que o cenário pode decidir. Tudo que não está aqui é FATO e mora só no
// mestre: nome, matrícula, admissão, cargo, regime, sindicato, empresa/filial/CC,
// recurso_cod, benefícios, rateio.
export const CAMPOS_CENARIO = [
  'salario_base', 'fte',
  'ini_ano', 'ini_mes', 'fim_ano', 'fim_mes',
  'reajuste_mes', 'reajuste_pct', 'reajuste_valor',
  'afast_ini_ano', 'afast_ini_mes', 'afast_fim_ano', 'afast_fim_mes',
  'ativo',
] as const
export type CampoCenario = typeof CAMPOS_CENARIO[number]

export type PostoVersao = {
  id?: string
  versao_id: string
  posto_id: string
  limpos?: string[] | null
  nota?: string | null
} & Partial<Record<CampoCenario, any>>

// Pares que só fazem sentido juntos: decidir "sai em maio" é gravar os DOIS
// campos. Resolver um sem o outro deixaria o ano da vigência do mestre com o mês
// do cenário — um fim de vigência que ninguém escolheu.
const PARES: CampoCenario[][] = [
  ['ini_ano', 'ini_mes'],
  ['fim_ano', 'fim_mes'],
  ['afast_ini_ano', 'afast_ini_mes'],
  ['afast_fim_ano', 'afast_fim_mes'],
]

const temValor = (v: any) => v !== null && v !== undefined && v !== ''

/** Campos que ESTE cenário muda de fato (ignora overlay gravado igual ao mestre). */
export function camposAlterados<T extends Record<string, any>>(mestre: T, ov: PostoVersao | null | undefined): CampoCenario[] {
  if (!ov) return []
  const limpos = new Set(ov.limpos || [])
  return CAMPOS_CENARIO.filter(c => {
    if (limpos.has(c)) return temValor((mestre as any)[c])   // limpar só é mudança se o mestre tinha algo
    if (!temValor(ov[c])) return false
    return ov[c] !== (mestre as any)[c]
  })
}

/**
 * Aplica a sobreposição sobre o mestre e devolve o posto EFETIVO do cenário.
 * Regra por campo: `limpos` > valor do overlay > valor do mestre.
 * Sem overlay, devolve o próprio mestre (mesma referência — a grade compara por
 * identidade para saber se há cenário).
 */
export function resolvePosto<T extends Record<string, any>>(mestre: T, ov: PostoVersao | null | undefined): T {
  if (!ov) return mestre
  const limpos = new Set(ov.limpos || [])
  const out: any = { ...mestre }
  for (const c of CAMPOS_CENARIO) {
    if (limpos.has(c)) { out[c] = null; continue }
    if (temValor(ov[c])) out[c] = ov[c]
  }
  // Um par meio preenchido viria do overlay com o outro lado do mestre. Quando o
  // cenário decide um dos dois, o par inteiro passa a ser do cenário.
  for (const [a, b] of PARES) {
    const ta = temValor(ov[a]) || limpos.has(a)
    const tb = temValor(ov[b]) || limpos.has(b)
    if (ta !== tb) {
      if (!ta) out[a] = temValor(ov[b]) ? (mestre as any)[a] ?? null : null
      if (!tb) out[b] = temValor(ov[a]) ? (mestre as any)[b] ?? null : null
    }
  }
  return out as T
}

/** O overlay ficou sem nenhuma decisão? Então a linha some — cenário não guarda "igual ao mestre". */
export function overlayVazio(ov: PostoVersao | null | undefined): boolean {
  if (!ov) return true
  if ((ov.limpos || []).length) return false
  if ((ov.nota || '').trim()) return false
  return !CAMPOS_CENARIO.some(c => temValor(ov[c]))
}
