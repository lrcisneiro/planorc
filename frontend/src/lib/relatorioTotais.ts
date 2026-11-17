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
  ccPermitidos?: string[] | null     // F2: escopo VER do usuário (null = sem restrição). Limita o filtro_escopo das linhas.
  slot?: number                      // multimoeda: slot em exibição (p_slot). 1 = base/BRL (default).
}

// Retorna { [lineId]: total } sobre anos×meses, com as linhas escopadas recalculadas no seu CC.
export async function totaisRelatorio(o: Opts): Promise<Record<string, number>> {
  return (await totaisRelatorioMes(o)).total
}

/** O mesmo cálculo, devolvendo TAMBÉM o valor de cada período separado.
 *
 *  ⚠⚠ EXISTE PARA MATAR N CHAMADAS. `relatorio_orcado_agg` já devolve `mes` na
 *  linha — o detalhe mensal SEMPRE esteve na resposta e era descartado aqui.
 *  O dashboard de Orçamento então pedia mês a mês: 10 invocações a mais, cada
 *  uma com 1 + 5 chamadas de RPC sob RLS a ~1 s. Era a maior parte dos 40 s de
 *  abertura da tela.
 *
 *  ⚠ O valor mensal não é idêntico ao de uma chamada com `meses: [m]`, e é
 *  MELHOR: as fórmulas são avaliadas com o período inteiro em mãos, então
 *  `=ANTERIOR()` resolve. Isolado num mês só, ela não tinha de onde resolver. */
export async function totaisRelatorioMes(o: Opts): Promise<{ total: Record<string, number>; mes: Record<string, number[]> }> {
  const { linhas, ccs, cen, empresas, anos, meses, filialFilter, ccFilter } = o
  const slot = o.slot ?? 1
  const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
  if (!masterIds.length || !empresas.length || !anos.length || !meses.length) return { total: {}, mes: {} }

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
      const { data, error } = await supabase.rpc('relatorio_realizado_agg', { p_empresas: empresas, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccF, p_slot: slot })
      if (error) throw new Error(error.message)
      for (const r of data || []) assign(r.linha_id, `${r.ano}-${r.mes}`, { valor: Number(r.valor) || 0 })
    } else {
      const { data, error } = await supabase.rpc('relatorio_orcado_agg', { p_versao: cen, p_empresas: empresas, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filialFilter, p_ccs: ccF, p_slot: slot })
      if (error) throw new Error(error.message)
      for (const r of data || []) assign(r.linha_id, `${r.ano}-${r.mes}`, (Number(r.n) === 1 && r.expr) ? { expressao: r.expr } : { valor: Number(r.valor) || 0 })
    }
    return raw
  }

  // ── linhas de apoio escopadas → um cenário próprio por escopo distinto ──
  // Precisa vir ANTES do cenário global: o valor escopado é injetado no raw
  // global, senão uma fórmula que referencia a linha escopada (ex.: dLER =
  // margem ÷ folha DIRETA) enxergaria o valor sem escopo — número plausível e
  // errado. É o mesmo desenho do editor (RelatorioEditorPage).
  const out: Record<string, number> = {}
  const grupos = new Map<string, { cc: string[]; ids: string[] }>()
  for (const l of linhas) {
    const indic = l.tipo_linha === 'INDICADOR' || l.nao_soma   // não soma → pode ter filtro próprio
    if (!(indic && l.filtro_escopo)) continue
    const e = l.filtro_escopo
    if (!Object.values(e).some(a => (a || []).length)) continue
    let cc = effectiveCcFilter(ccs, e.cc || [], e.area || [], e.divisao || [], e.bu || [])
    // F2: cruza o escopo próprio da linha com o que o usuário pode VER
    if (o.ccPermitidos) cc = cc === null ? [...o.ccPermitidos] : cc.filter(id => o.ccPermitidos!.includes(id))
    // ⚠⚠ E COM O FILTRO DA TELA. O escopo da linha existe para ESTREITÁ-LA
    // abaixo do que a tela mostra ("esta linha é só das áreas 1 e 4"), nunca
    // para alargá-la acima. Sem este cruzamento ele alargava: filtrando um CC
    // sem movimento, a DRE inteira zerava e a "Folha apoio" seguia exibindo o
    // consolidado da empresa, com "% Estrutura" 100% — um relatório filtrado
    // mostrando número não filtrado, e nada na tela dizendo isso.
    // ⚠ Reverte o "sobrepõe a tela" que estava escrito no editor. O caso que
    // parecia justificar a sobreposição — a fórmula `margem ÷ folha DIRETA` —
    // na verdade a desmente: sobrepondo, o numerador vem filtrado e o
    // denominador não, e a razão deixa de significar qualquer coisa. Cruzando,
    // os dois andam juntos e a razão continua de pé em qualquer recorte.
    if (ccFilter) cc = cc === null ? [...ccFilter] : cc.filter(id => ccFilter.includes(id))
    if (cc === null) continue                       // sem restrição → segue o global
    if (cc.length === 0) { out[l.id] = 0; continue } // usuário não acessa nenhum CC do escopo da linha
    const sig = JSON.stringify([...cc].sort())
    let g = grupos.get(sig); if (!g) { g = { cc, ids: [] }; grupos.set(sig, g) }
    g.ids.push(l.id)
  }

  const escopados = new Set<string>()
  const totEsc: Record<string, number> = {}   // total PRÓPRIO da linha, recalculado no escopo dela
  const valEsc: Record<string, Record<string, number>> = {}   // valor por período, p/ injetar no global
  // ⚠ AS LEITURAS VÃO JUNTAS. Eram sequenciais — um `await` por grupo e mais
  // um para o global —, e com os 5 grupos de escopo da DRE Gerencial isso é
  // SEIS idas ao banco em fila, a ~1 s cada sob RLS: 6 s de espera onde o
  // trabalho real é 1 s. Nenhuma depende da outra; só a FUSÃO delas tem ordem
  // (o valor escopado entra no raw global), e essa continua abaixo.
  const gruposArr = [...grupos.values()]
  const [rawsSc, rawGlobal] = await Promise.all([
    Promise.all(gruposArr.map(g => loadRaw(g.cc, true))),
    loadRaw(ccFilter, false),
  ])

  const mesEsc: Record<string, number[]> = {}
  for (let gi = 0; gi < gruposArr.length; gi++) {
    const g = gruposArr[gi]
    const rawSc = rawsSc[gi]
    const cenSc = computeCenario(calc, rawSc, periodos)
    const tSc = computeTotais(calc, cenSc, periodos)
    // Um total por período, no cenário da própria linha — em memória, sem ir
    // ao banco de novo: o cenário já tem todos os períodos calculados.
    const perSc = periodos.map(pp => computeTotais(calc, cenSc, [pp]))
    for (const id of g.ids) {
      escopados.add(id); totEsc[id] = tSc[id]; valEsc[id] = cenSc[id] || {}
      mesEsc[id] = perSc.map(t => t[id] ?? 0)
    }
  }

  // No cenário global a linha escopada entra como ANALÍTICA lendo o valor já
  // escopado — assim ela não é reavaliada fora do escopo e quem a referencia
  // recebe o número certo.
  const calcGlobal: LinhaCalc[] = escopados.size
    ? calc.map(l => escopados.has(l.id) ? { ...l, tipo_linha: 'ANALITICA' } : l)
    : calc

  const rawG = rawGlobal
  for (const id of escopados) {
    const porPeriodo = valEsc[id] || {}
    const dest = (rawG[id] ||= {})
    for (const pk in porPeriodo) dest[pk] = { valor: porPeriodo[pk] }
  }

  const cenG = computeCenario(calcGlobal, rawG, periodos)
  const totG = computeTotais(calcGlobal, cenG, periodos)

  const mesG: Record<string, number[]> = {}
  periodos.forEach((pp, i) => {
    const t = computeTotais(calcGlobal, cenG, [pp])
    for (const id in t) (mesG[id] ||= Array(periodos.length).fill(0))[i] = t[id]
  })
  for (const id in out) mesG[id] = Array(periodos.length).fill(0)   // escopo vazio = zero em todo mês

  // o total da própria linha escopada vem do cenário dela (percentual se recalcula, não se soma)
  return { total: { ...totG, ...totEsc, ...out }, mes: { ...mesG, ...mesEsc } }
}
