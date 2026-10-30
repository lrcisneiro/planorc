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
/** Como preencher os meses depois do último fechado. Os mesmos do dashboard
 *  de Orçamento — mesma pergunta, mesmas palavras. */
export type MetodoCauda = 'VAZIO' | 'MEDIA3' | 'MEDIAPER' | 'ULTIMO'

/**
 * Completa a CAUDA do ano nos meses sem dado.
 *
 * `ultimoFechado` é dado de FORA, não deduzido do maior mês com dado — essa
 * dedução estava errada: o mês corrente aparece no realizado parcial, e tomá-lo
 * por fechado contamina duas vezes (ele entra menor E puxa a média para baixo).
 *
 * Preenche de `ultimoFechado + 1` até dezembro, e só para escopos que já têm
 * dado. Cada método responde a uma pergunta diferente:
 *   MEDIA3    o ritmo recente        (sensível a inflexão, cego a sazonalidade)
 *   MEDIAPER  o ritmo do ano todo    (estável, dilui pico e vale)
 *   ULTIMO    "daqui para frente é assim"  (o mais agressivo dos três)
 */
export function completarCauda(
  linhas: Leitura[], ultimoFechado: number, metodo: MetodoCauda = 'MEDIA3',
): { linhas: Leitura[]; estimados: number } {
  if (!linhas.length || ultimoFechado >= 12 || metodo === 'VAZIO') return { linhas, estimados: 0 }

  const grupos = new Map<string, Leitura[]>()
  for (const l of linhas) {
    const g = `${l.k ?? ''}|${l.e}|${l.f ?? ''}|${l.c ?? ''}`
    const arr = grupos.get(g) ?? []
    if (!grupos.has(g)) grupos.set(g, arr)
    arr.push(l)
  }
  const extra: Leitura[] = []
  for (const g of grupos.values()) {
    const porMes = [...g].sort((a, b) => b.m - a.m)
    const usa = metodo === 'MEDIA3' ? porMes.slice(0, 3)
              : metodo === 'ULTIMO' ? porMes.slice(0, 1)
              : porMes                                   // MEDIAPER
    if (!usa.length) continue
    const v = Math.round((usa.reduce((s, x) => s + x.v, 0) / usa.length) * 100) / 100
    if (!v) continue
    const tem = new Set(g.map(x => x.m))
    for (let m = ultimoFechado + 1; m <= 12; m++)
      if (!tem.has(m)) extra.push({ ...g[0], m, v })
  }
  return { linhas: [...linhas, ...extra], estimados: extra.length }
}
