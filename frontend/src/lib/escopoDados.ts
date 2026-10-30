// ============================================================
// Escopo de dados em catálogos que a tela LISTA (versão, relatório)
//
// Por que existe: `useUserAccess` resolve o escopo dentro de um componente,
// mas versão e relatório são lidos em ~15 e ~16 telas. Filtrar uma a uma é o
// jeito de esquecer uma — e UMA tela sem filtro anula o controle inteiro, em
// silêncio e sem erro nenhum. Aqui a consulta e o recorte ficam no mesmo
// lugar: quem chama não tem como pegar a lista crua.
//
// A regra é a mesma do hook: allow-list (vazio = tudo) menos `negados`, e
// **admin ignora o escopo**. O escopo lido é o de VER — quem não pode ver uma
// versão também não a orça, e o inverso (ver sem orçar) é tratado pelas
// capacidades, não aqui.
// ============================================================
import { supabase } from './supabase'

type Regra = { allow: string[]; deny: string[] }

// Uma leitura por sessão. As regras de quem está logado não mudam no meio do
// uso; quando mudam (Configurações), `limparCacheEscopo()` derruba o cache.
let cache: Promise<{ isAdmin: boolean; regras: Record<string, Regra> }> | null = null

function carregarRegras() {
  cache ||= Promise.all([
    supabase.from('user_acesso_regra').select('dimensao,valor_ids,escopo,negados'),
    supabase.from('user_tenant').select('role'),
  ]).then(([{ data: rd }, { data: td }]) => {
    const regras: Record<string, Regra> = {}
    for (const r of (rd as any[]) || []) {
      if (r.escopo === 'ORCAR') continue        // aqui só interessa o VER
      regras[r.dimensao] = { allow: r.valor_ids || [], deny: r.negados || [] }
    }
    return { isAdmin: ((td?.[0]?.role as string) ?? '') === 'admin', regras }
  })
  return cache
}

export function limparCacheEscopo() { cache = null }

export async function filtrarPorEscopo<T extends { id: string }>(dimensao: string, rows: T[] | null | undefined): Promise<T[]> {
  const lista = rows || []
  const { isAdmin, regras } = await carregarRegras()
  if (isAdmin) return lista
  const r = regras[dimensao]
  if (!r) return lista                           // sem regra = sem restrição
  return lista.filter(x => !r.deny.includes(x.id) && (r.allow.length === 0 || r.allow.includes(x.id)))
}

// ── Versões do orçamento, já recortadas ──
// `ordem`: 'codigo' (o padrão histórico) ou 'ano_desc' (mais nova primeiro).
export async function carregarVersoes(
  cols = 'id,codigo',
  opts: { ativa?: boolean; ordem?: 'codigo' | 'ano_desc' } = {},
): Promise<any[]> {
  let q = supabase.from('versao_orcamento').select(cols)
  if (opts.ativa) q = q.eq('ativa', true)
  q = opts.ordem === 'ano_desc' ? q.order('ano', { ascending: false }).order('codigo') : q.order('codigo')
  const { data } = await q
  return filtrarPorEscopo('versao', data as any)
}

// ── Relatórios, já recortados ──
// Relatório é DADO (linha de `relatorio`), não tela: por isso dimensão e não
// capacidade. "Pode abrir relatórios" é capacidade; "pode abrir ESTA DRE" é
// escopo de dados, e muda sem deploy.
export async function carregarRelatorios(cols = 'id,nome', ordem: 'nome' | 'codigo' = 'nome'): Promise<any[]> {
  const { data } = await supabase.from('relatorio').select(cols).order(ordem)
  return filtrarPorEscopo('relatorio', data as any)
}
