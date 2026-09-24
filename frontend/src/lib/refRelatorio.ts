// Referência do RELATÓRIO para as telas de conciliação.
//
// A conciliação sempre teve de dizer "e na DRE isto dá quanto?", e até agora
// respondia com agregação própria: soma o razão por master, aplica o sinal.
// Acerta no caso simples e erra em três — linha Σ (SOMAR_FILHOS) que agrega
// várias filhas, conta amarrada em duas linhas, e linha com filtro de escopo
// próprio. Nenhum deles é exótico: o primeiro é a estrutura normal de uma DRE.
//
// Aqui o número vem de `totaisRelatorio`, a MESMA função que o editor do
// relatório e o dashboard de Indicadores usam. Assim a referência é o
// relatório, não uma segunda opinião sobre ele — e acompanha sozinha qualquer
// mudança de estrutura.
//
// Atenção ao que isto NÃO faz: não torna os números iguais. O orçado da DRE
// está rateado no CC de destino e o da folha na origem do posto; o realizado da
// DRE vem do razão e o da conciliação, da folha. A referência certa serve para
// a diferença virar uma linha nomeada em vez de um mistério.
import { supabase } from './supabase'
import { totaisRelatorio } from './relatorioTotais'
import type { RLData } from './relatorioTotais'
import type { CC } from '../pages/dashboard/DashFiltros'

export type LinhaRel = RLData & { descricao: string; ordem: number | null }

export type RefRelatorio = {
  relatorioNome: string
  linhas: { id: string; codigo: string; descricao: string; orc: number; real: number }[]
  masterToLine: Record<string, string>   // master (conta_orcamentaria) → linha selecionada
}

export const COLS_LINHA = 'id,pai_id,codigo,descricao,tipo_linha,expressao,desativada,linha_orc_id,nao_soma,filtro_escopo,ordem'

// Masters da SUBÁRVORE de cada linha escolhida. É o que resolve o Σ: a linha da
// DRE não tem master próprio, quem tem são as filhas dela.
export function mastersDaSelecao(linhas: LinhaRel[], sel: string[]) {
  const byId: Record<string, LinhaRel> = {}
  const filhos: Record<string, string[]> = {}
  for (const l of linhas) { byId[l.id] = l; if (l.pai_id) (filhos[l.pai_id] ||= []).push(l.id) }
  const masterToLine: Record<string, string> = {}
  const desce = (id: string, raiz: string) => {
    const m = byId[id]?.linha_orc_id
    // primeiro a ganhar: linha escolhida dentro de outra escolhida fica com a mais funda
    if (m && !masterToLine[m]) masterToLine[m] = raiz
    for (const f of filhos[id] || []) desce(f, raiz)
  }
  for (const id of sel) if (byId[id]) desce(id, id)
  return { masters: Object.keys(masterToLine), masterToLine, byId }
}

// Só faz sentido oferecer linha que tenha master na subárvore: linha de fórmula
// ou indicador tem total, mas não tem folha a conciliar contra.
export function linhasConciliaveis(linhas: LinhaRel[]) {
  const { byId } = mastersDaSelecao(linhas, [])
  const filhos: Record<string, string[]> = {}
  for (const l of linhas) if (l.pai_id) (filhos[l.pai_id] ||= []).push(l.id)
  const tem = (id: string): boolean =>
    !!byId[id]?.linha_orc_id || (filhos[id] || []).some(tem)
  return linhas.filter(l => !l.desativada && tem(l.id))
}

type Opts = {
  relatorioNome: string
  linhas: LinhaRel[]; sel: string[]; ccs: CC[]
  versaoId: string; empresas: string[]; anos: number[]; meses: number[]
  filialFilter: string[] | null; ccFilter: string[] | null
  ccPermitidos?: string[] | null; slot?: number
}

// Orçado e realizado de cada linha escolhida, exatamente como o relatório os mostra.
export async function refDoRelatorio(o: Opts): Promise<RefRelatorio | null> {
  const { masters, masterToLine, byId } = mastersDaSelecao(o.linhas, o.sel)
  // empresas é obrigatório no relatorio_orcado_agg (empresa_id = ANY(...)):
  // lista vazia devolveria zero em silêncio, que é pior do que não mostrar nada
  if (!masters.length || !o.empresas.length) return null
  const base = {
    linhas: o.linhas, ccs: o.ccs, empresas: o.empresas, anos: o.anos, meses: o.meses,
    filialFilter: o.filialFilter, ccFilter: o.ccFilter, ccPermitidos: o.ccPermitidos, slot: o.slot,
  }
  const [orc, real] = await Promise.all([
    o.versaoId ? totaisRelatorio({ ...base, cen: o.versaoId }) : Promise.resolve({} as Record<string, number>),
    totaisRelatorio({ ...base, cen: 'REALIZADO' }),
  ])
  return {
    relatorioNome: o.relatorioNome,
    masterToLine,
    linhas: o.sel.filter(id => byId[id]).map(id => ({
      id, codigo: byId[id].codigo, descricao: byId[id].descricao,
      orc: orc[id] || 0, real: real[id] || 0,
    })),
  }
}

// contas contábeis amarradas aos masters — recorta o universo das duas abas
export async function contasDosMasters(masters: string[]) {
  const contaToItem: Record<string, string> = {}
  for (let i = 0; i < masters.length; i += 200) {
    const { data } = await supabase.from('conta_linha').select('conta_id,linha_id').in('linha_id', masters.slice(i, i + 200))
    for (const r of (data || []) as any[]) if (r.conta_id && r.linha_id) contaToItem[r.conta_id] = r.linha_id
  }
  return { contaIds: Object.keys(contaToItem), contaToItem }
}
