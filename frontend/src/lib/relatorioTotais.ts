// Totais de um relatório (por linha) respeitando o ESCOPO de CC das linhas de apoio.
// Reaproveitado pelo editor e pelo dashboard de Indicadores — assim "Margem Serviço" etc.
// calculam igual em qualquer lugar (cenário escopado recarregado + fórmula recalculada no agregado).
import { supabase } from './supabase'
import { computeCenario, computeTotais } from './engine'
import type { LinhaCalc, RawValues, Periodo } from './engine'
import { effectiveCcFilter } from '../pages/dashboard/DashFiltros'
import type { CC } from '../pages/dashboard/DashFiltros'

export type EscopoCC = { cc?: string[]; area?: string[]; divisao?: string[]; bu?: string[] } | null
export type RLData = {
  id: string; pai_id: string | null; codigo: string; tipo_linha: any
  expressao: string | null; desativada: boolean; linha_orc_id: string | null
  nao_soma?: boolean; filtro_escopo?: EscopoCC
}

type Opts = {
  linhas: RLData[]; ccs: CC[]
  cen: 'REALIZADO' | string          // string = versaoId (orçado)
  empresas: string[]; anos: number[]; meses: number[]
  filialFilter: string[] | null; ccFilter: string[] | null
}

// Retorna { [lineId]: total } sobre anos×meses, com as linhas escopadas recalculadas no seu CC.
export async function totaisRelatorio(o: Opts): Promise<Record<string, number>> {
  const { linhas, ccs, cen, empresas, anos, meses, filialFilter, ccFilter } = o
  const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
  if (!masterIds.length || !empresas.length || !anos.length || !meses.length) return {}

  const rlOfMaster: Record<string, string> = {}
  linhas.forEach(l => { if (l.linha_orc_id && !l.nao_soma) rlOfMaster[l.linha_orc_id] = l.id })
  const masterToLines: Record<string, string[]> = {}
  for (const l of linhas) if (l.linha_orc_id) (masterToLines[l.linha_orc_id] ||= []).push(l.id)
  const calc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
  const periodos: Periodo[] = anos.flatMap(a => meses.map(m => ({ ano: a, mes: m })))

  // carrega o agregado por master e distribui às linhas (global = só linha normal; escopo = todas)
  const loadRaw = async (ccF: string[] | null, mapAll: boolean): Promise<RawValues> => {
    const raw: RawValues = {}
    const assign = (master: string, pk: string, cell: { valor?: number; expressao?: string }) => {
      if (mapAll) { for (const lid of (masterToLines[master] || [])) (raw[lid] ||= {})[pk] = cell }
      else { const rl = rlOfMaster[master]; if (rl) (raw[rl] ||= {})[pk] = cell }
    }
    if (cen === 'REALIZADO') {
      const { data, error } = await supabase.rpc('relatorio_realizado_agg', { p_empresas: empresas, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccF })
      if (error) throw new Error(error.message)
      for (const r of data || []) assign(r.linha_id, `${r.ano}-${r.mes}`, { valor: Number(r.valor) || 0 })
    } else {
      const { data, error } = await supabase.rpc('relatorio_orcado_agg', { p_versao: cen, p_empresas: empresas, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccF })
      if (error) throw new Error(error.message)
      for (const r of data || []) assign(r.linha_id, `${r.ano}-${r.mes}`, (Number(r.n) === 1 && r.expr) ? { expressao: r.expr } : { valor: Number(r.valor) || 0 })
    }
    return raw
  }

  // cenário GLOBAL (respeita o filtro de CC da tela)
  const rawG = await loadRaw(ccFilter, false)
  const totG = computeTotais(calc, computeCenario(calc, rawG, periodos), periodos)
  const out: Record<string, number> = { ...totG }

  // linhas de apoio escopadas → recalcula cada grupo no seu CC
  const grupos = new Map<string, { cc: string[]; ids: string[] }>()
  for (const l of linhas) {
    const indic = l.tipo_linha === 'INDICADOR' || l.nao_soma   // não soma → pode ter filtro próprio
    if (!(indic && l.filtro_escopo)) continue
    const e = l.filtro_escopo
    if (!Object.values(e).some(a => (a || []).length)) continue
    const cc = effectiveCcFilter(ccs, e.cc || [], e.area || [], e.divisao || [], e.bu || [])
    if (!cc) continue
    const sig = JSON.stringify([...cc].sort())
    let g = grupos.get(sig); if (!g) { g = { cc, ids: [] }; grupos.set(sig, g) }
    g.ids.push(l.id)
  }
  for (const g of grupos.values()) {
    const rawSc = await loadRaw(g.cc, true)
    const totSc = computeTotais(calc, computeCenario(calc, rawSc, periodos), periodos)
    for (const id of g.ids) out[id] = totSc[id]
  }
  return out
}
