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
import { papelMaisAlto } from './capacidades'

type Regra = { allow: string[]; deny: string[] }

/** Dimensões que o **banco** recorta por RLS (`escopo_dim`, v3_132/137). Nelas,
 *  ausência de regra = **não vê nada**, aqui e lá — se divergir, o combo vem
 *  cheio e a tela vem vazia, que é o pior dos dois mundos: parece defeito.
 *  `relatorio` fica fora de propósito: `relatorio_linha` é lida para montar
 *  qualquer DRE, então RLS nela trancaria o motor. É recorte só de tela. */
export const DIMS_NO_BANCO = ['empresa', 'filial', 'centro_custo', 'versao']

// Uma leitura por sessão. As regras de quem está logado não mudam no meio do
// uso; quando mudam (Configurações), `limparCacheEscopo()` derruba o cache.
let cache: Promise<{ isAdmin: boolean; regras: Record<string, Regra> }> | null = null
let lido = 0

// O cache tem PRAZO, e isso não é otimização — é correção. `limparCacheEscopo()`
// só alcança o navegador de quem edita; quem TEVE o acesso alterado continua
// com as regras antigas em memória até recarregar a página. Numa sessão longa,
// tirar o acesso de alguém não surtia efeito.
//
// Um minuto: curto o bastante para que uma mudança de acesso apareça sozinha,
// longo o bastante para a leitura (duas consultas pequenas) não virar tráfego.
// ⚠ Vale só para `relatorio`, que é recorte de TELA. Empresa, filial, CC e
// versão são barradas por RLS no banco, onde cache nenhum alcança.
const TTL = 60_000

// Voltar para a aba revalida na hora: é quando a pessoa foi avisada de que o
// acesso mudou e vem conferir, e esperar o minuto ali é o pior momento.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { lido = 0 })
}

function carregarRegras() {
  if (cache && Date.now() - lido < TTL) return cache
  lido = Date.now()
  cache = Promise.all([
    supabase.from('user_acesso_regra').select('dimensao,valor_ids,escopo,negados'),
    supabase.from('user_tenant').select('role'),
  ]).then(([{ data: rd }, { data: td }]) => {
    const regras: Record<string, Regra> = {}
    for (const r of (rd as any[]) || []) {
      if (r.escopo === 'ORCAR') continue        // aqui só interessa o VER
      regras[r.dimensao] = { allow: r.valor_ids || [], deny: r.negados || [] }
    }
    return { isAdmin: papelMaisAlto(td) === 'admin', regras }
  })
  return cache
}

export function limparCacheEscopo() { cache = null; lido = 0 }

export async function filtrarPorEscopo<T extends { id: string }>(dimensao: string, rows: T[] | null | undefined): Promise<T[]> {
  const lista = rows || []
  const { isAdmin, regras } = await carregarRegras()
  if (isAdmin) return lista
  const r = regras[dimensao]
  // Sem regra: nega onde o banco nega, libera onde ele não chega.
  if (!r) return DIMS_NO_BANCO.includes(dimensao) ? [] : lista
  return lista.filter(x => !r.deny.includes(x.id) && (r.allow.length === 0 || r.allow.includes(x.id)))
}

// ── Presets (dashboard_card) recortados pelo RELATÓRIO que usam ──
//
// Todo preset está amarrado a um relatório: os de dashboard guardam `relId` nos
// filtros, os de relatório trazem o id na própria rota (`/relatorios/<id>`).
// Quem não pode ver o Balanço não deveria ver, no hub, um atalho para ele.
//
// Preset sem relatório identificável passa: o recorte é por exclusão do que se
// sabe estar fora, nunca por suposição do que está dentro — esconder por falta
// de informação viraria sumiço inexplicável.
export function relatorioDoCard(c: { base?: string | null; filtros?: any }): string | null {
  const m = /^\/relatorios\/([0-9a-f-]{36})/.exec(c.base || '')
  if (m) return m[1]
  const r = c.filtros?.relId ?? c.filtros?.relatorioId
  return typeof r === 'string' && r ? r : null
}

export async function filtrarCardsPorEscopo<T extends { base?: string | null; filtros?: any }>(cards: T[]): Promise<T[]> {
  const { isAdmin, regras } = await carregarRegras()
  if (isAdmin) return cards
  const r = regras['relatorio']
  if (!r) return cards                              // sem regra de relatório = sem restrição
  const ok = (id: string) => !r.deny.includes(id) && (r.allow.length === 0 || r.allow.includes(id))
  return cards.filter(c => { const id = relatorioDoCard(c); return !id || ok(id) })
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
  const { data, error } = await q
  // ⚠ ERRO AQUI VIRAVA LISTA VAZIA, e lista vazia é ambígua: pode ser "não há
  // versão no seu escopo" ou "a consulta falhou". Foi o que aconteceu ao pedir
  // `origem_versao_id` antes de rodar a v3_171 — o combo ficou só com
  // "— selecione —" e a tela não disse nada. Quem chama decide o que mostrar;
  // aqui, no mínimo, a causa fica no console em vez de sumir.
  if (error) console.error('[carregarVersoes] consulta falhou — lista virá vazia:', error.message, '| colunas:', cols)
  return filtrarPorEscopo('versao', data as any)
}

// ── Relatórios, já recortados ──
// Relatório é DADO (linha de `relatorio`), não tela: por isso dimensão e não
// capacidade. "Pode abrir relatórios" é capacidade; "pode abrir ESTA DRE" é
// escopo de dados, e muda sem deploy.
export async function carregarRelatorios(cols = 'id,nome', ordem: 'nome' | 'codigo' = 'nome'): Promise<any[]> {
  const { data, error } = await supabase.from('relatorio').select(cols).order(ordem)
  if (error) console.error('[carregarRelatorios] consulta falhou — lista virá vazia:', error.message, '| colunas:', cols)
  return filtrarPorEscopo('relatorio', data as any)
}
