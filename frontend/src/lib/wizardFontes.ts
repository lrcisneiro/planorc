// ============================================================
// Fontes dos wizards: de onde vem o valor que preenche um driver.
//
// Cada leitor devolve o mesmo formato achatado — {k?, e, f, c, m, v} — para o
// executor não precisar saber de onde veio. As RPCs devolvem jsonb e não SETOF
// de propósito: o PostgREST corta em 1000 linhas SEM ERRO, e aqui são escopos
// × contas × meses.
// ============================================================
import { supabase } from './supabase'

/** k = conta mestre (só nos leitores por conta) · e/f/c = escopo · m = mês · v = valor */
export type Leitura = { k?: string; e: string; f: string | null; c: string | null; m: number; v: number }

const ok = (data: any, erro: any, oque: string): Leitura[] => {
  if (erro) throw new Error(`Erro ao ler ${oque}: ${erro.message}`)
  return (data || []) as Leitura[]
}

/** Orçado somado por escopo × mês, sem quebrar por conta (serve ao imposto). */
export async function lerOrcadoTotal(versaoId: string, ano: number, opts: {
  natureza?: string | null
  /** A INVARIANTE: as contas que o próprio formulário escreve. */
  excluirContas: string[]
  excluirLinhas?: string[]
}) {
  const { data, error } = await supabase.rpc('wizard_orcado_por_escopo', {
    p_versao: versaoId, p_ano: ano,
    p_natureza: opts.natureza ?? null,
    p_excluir_contas: opts.excluirContas,
    p_excluir_linhas: opts.excluirLinhas ?? [],
  })
  return ok(data, error, 'o orçado')
}

/** Orçado por escopo × CONTA × mês (serve à réplica, que devolve cada conta ao seu lugar). */
export async function lerOrcadoPorConta(versaoId: string, ano: number, masters: string[]) {
  const { data, error } = await supabase.rpc('wizard_orcado_por_conta', {
    p_versao: versaoId, p_ano: ano, p_masters: masters,
  })
  return ok(data, error, 'o orçado')
}

/** Realizado por escopo × CONTA × mês. Honra lote_ignorado e o sinal da amarração. */
export async function lerRealizadoPorConta(ano: number, masters: string[]) {
  const { data, error } = await supabase.rpc('wizard_realizado_por_conta', {
    p_ano: ano, p_masters: masters,
  })
  return ok(data, error, 'o realizado')
}

/** Um campo do cadastro de filiais. NULL = não cadastrado; 0 = valor real. */
export async function lerCampoFilial(campo: string) {
  const { data, error } = await supabase.from('filial').select(`id,codigo,descricao,${campo}`)
  if (error) throw new Error('Erro ao ler o cadastro de filiais: ' + error.message)
  return (data || []) as any[]
}

// ============================================================
/**
 * Completa a CAUDA do ano nos meses sem dado, com a média dos últimos `n`
 * meses de cada escopo.
 *
 * Só preenche de `ultimoMes + 1` até dezembro, e `ultimoMes` é o maior mês com
 * dado em TODO o conjunto — não por escopo. A diferença importa: um escopo que
 * parou em agosto porque a operação fechou não deve ganhar quatro meses
 * inventados; já o ano inteiro parado em outubro é só o ano em curso.
 */
export function completarCauda(linhas: Leitura[], n = 3): { linhas: Leitura[]; ultimoMes: number; estimados: number } {
  if (!linhas.length) return { linhas, ultimoMes: 0, estimados: 0 }
  const ultimoMes = Math.max(...linhas.map(l => l.m))
  if (ultimoMes >= 12) return { linhas, ultimoMes, estimados: 0 }

  const grupos = new Map<string, Leitura[]>()
  for (const l of linhas) {
    const g = `${l.k ?? ''}|${l.e}|${l.f ?? ''}|${l.c ?? ''}`
    ;(grupos.get(g) ?? grupos.set(g, []).get(g)!).push(l)
  }
  const extra: Leitura[] = []
  for (const g of grupos.values()) {
    const ult = [...g].sort((a, b) => b.m - a.m).slice(0, n)
    if (!ult.length) continue
    const media = Math.round((ult.reduce((s, x) => s + x.v, 0) / ult.length) * 100) / 100
    if (!media) continue
    const tem = new Set(g.map(x => x.m))
    for (let m = ultimoMes + 1; m <= 12; m++)
      if (!tem.has(m)) extra.push({ ...g[0], m, v: media })
  }
  return { linhas: [...linhas, ...extra], ultimoMes, estimados: extra.length }
}
