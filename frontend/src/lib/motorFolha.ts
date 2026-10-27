// Motor de folha (P1) — cascata de custo por posto a partir do catálogo de verbas.
// Record-based, puro (sem I/O): recebe posto + verbas + dissídio e devolve a memória de cálculo.
// Ref.: docs/DESIGN_posto_trabalho.md (motor de cálculo).

export type TipoCalculo = 'BASE' | 'PCT_BASE' | 'PCT_VERBA' | 'PROVISAO_1_12' | 'VALOR_FIXO' | 'INFORMATIVA'
  // Rescisão (v3_118) — disparam SÓ no mês do fim de vigência. Cada uma é uma
  // FORMA DE QUANTIDADE diferente, que é o motivo de serem tipos e não um
  // parâmetro: o aviso prévio cresce com o tempo de casa, o 13º/férias são
  // proporcionais aos meses do ano e a multa do FGTS é sobre o saldo acumulado.
  | 'RESC_AVISO' | 'RESC_PROP' | 'RESC_SALDO_FGTS'

export type VerbaRegra = {
  id: string
  codigo: string
  descricao: string
  tipo_calculo: TipoCalculo
  parametro: number | null          // % / fator / valor
  verba_ref: string | null          // p/ PCT_VERBA: CÓDIGOS separados por vírgula (a base é a soma deles)
  conta_destino_id: string | null
  incide_encargos: boolean          // entra na base de PCT_BASE/PROVISAO?
  mantem_afastado?: boolean         // VALOR_FIXO: continua devido no mês afastado? (v3_117)
  regime: string | null             // null = vale p/ todos os regimes
  pais?: string | null              // país da regra; null = compartilhada (vale p/ todos os países)
  ordem: number | null
  categoria?: string | null         // sobrescreve a categoria da composição (SALARIO/ENCARGOS/PROVISOES/BENEFICIOS); null = padrão do tipo
}

export type PostoCalc = {
  salario_base: number
  fte: number | null
  regime: string | null
  pais?: string | null              // país do posto (resolvido da empresa) — filtra as verbas aplicáveis
  ini_ano?: number | null; ini_mes?: number | null
  fim_ano?: number | null; fim_mes?: number | null
  // Reajuste INDIVIDUAL (promoção, mérito) — v3_116. Vale a partir de
  // reajuste_mes e COMPÕE com o dissídio do sindicato.
  reajuste_mes?: number | null
  reajuste_pct?: number | null      // em %, multiplica a base
  reajuste_valor?: number | null    // salário novo absoluto, substitui a base
  // Afastamento (v3_117) — pessoa já afastada que segue no ano orçado. Janela
  // em ano/mês; fim nulo = indeterminado (vai até dezembro).
  afast_ini_ano?: number | null; afast_ini_mes?: number | null
  afast_fim_ano?: number | null; afast_fim_mes?: number | null
  // Admissão (v3_118) — só para a rescisão: o aviso prévio cresce 3 dias por ano
  // e a multa do FGTS é sobre o saldo, que depende do tempo de casa. Separada da
  // vigência de propósito: `ini_*` descreve o ANO ORÇADO e alguém pode editá-la.
  // Sem ela, cai em `ini_*` (que o import do RH preenche com a admissão).
  admissao?: string | null          // 'AAAA-MM-DD'
}

export type LinhaMemoria = {
  verba: VerbaRegra
  categoria: Categoria
  valorMes: number   // mês cheio representativo (com dissídio se aplicável)
  valorAno: number   // soma precisa dos 12 meses (respeita vigência + dissídio)
}
export const CATEGORIAS = ['Salário', 'Encargos', 'Provisões', 'Benefícios', 'Rescisão'] as const
export type Categoria = typeof CATEGORIAS[number]

export type ResultadoPosto = {
  linhas: LinhaMemoria[]
  baseMes: number          // salário-base do mês representativo (× fte × dissídio)
  totalMes: number         // custo total do mês representativo
  totalAno: number         // custo total do ano
  mesesVigentes: number
  mesesAfastado: number    // dos vigentes, quantos a pessoa passa afastada
  rescisaoAno: number      // custo da rescisão no mês do fim de vigência (0 se não sai no ano)
  mesFimVigencia: number | null   // mês da saída dentro do ano, quando há
  porCategoria: Record<Categoria, number>   // anual
  porConta: Record<string, number>          // conta_destino_id -> anual
  porContaMes: Record<string, number[]>     // conta_destino_id -> [12] valor por mês (Jan=0), respeita vigência/dissídio
  porVerbaMes: Record<string, number[]>     // verba.id -> [12] valor por mês (p/ orçado por verba na conciliação)
}

const CATEGORIA: Record<TipoCalculo, Categoria> = {
  BASE: 'Salário', PCT_BASE: 'Encargos', PCT_VERBA: 'Encargos',
  PROVISAO_1_12: 'Provisões', VALOR_FIXO: 'Benefícios', INFORMATIVA: 'Salário',
  RESC_AVISO: 'Rescisão', RESC_PROP: 'Rescisão', RESC_SALDO_FGTS: 'Rescisão',
}
const CAT_COD: Record<string, Categoria> = { SALARIO: 'Salário', ENCARGOS: 'Encargos', PROVISOES: 'Provisões', BENEFICIOS: 'Benefícios', RESCISAO: 'Rescisão' }
const categoriaDe = (v: VerbaRegra): Categoria => (v.categoria && CAT_COD[v.categoria]) || CATEGORIA[v.tipo_calculo]

// `verba.regime` guarda uma LISTA separada por vírgula (ex.: 'CLT,PROLABORE'); vazio = todos os regimes.
export const regimeAplica = (verbaRegime: string | null | undefined, postoRegime: string | null): boolean => {
  const rs = (verbaRegime || '').split(',').map(s => s.trim()).filter(Boolean)
  return !rs.length || (postoRegime != null && rs.includes(postoRegime))
}

// `verba.pais` null/vazio = compartilhada (todos os países); senão só casa com o país do posto.
export const paisAplica = (verbaPais: string | null | undefined, postoPais: string | null | undefined): boolean => {
  const vp = (verbaPais || '').trim()
  return !vp || vp === (postoPais || '')
}

// verbas que se aplicam ao país × regime do posto, na ordem de cálculo (INFORMATIVA fora)
export function verbasDoRegime(verbas: VerbaRegra[], regime: string | null, pais: string | null = null): VerbaRegra[] {
  return verbas
    .filter(v => v.tipo_calculo !== 'INFORMATIVA' && paisAplica(v.pais, pais) && regimeAplica(v.regime, regime))
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
}

// janela de meses vigentes do posto dentro do ano
function vigencia(p: PostoCalc, ano: number): [number, number] {
  const ini = (p.ini_ano && p.ini_ano > ano) ? 13 : (p.ini_ano === ano ? (p.ini_mes || 1) : 1)
  const fim = (p.fim_ano && p.fim_ano < ano) ? 0 : (p.fim_ano === ano ? (p.fim_mes || 12) : 12)
  return [ini, fim]
}

// A pessoa está afastada neste mês do ano orçado?
// Janela aberta à esquerda (afastado desde antes do ano → vale desde janeiro) e
// à direita (sem alta prevista → vale até dezembro).
export function afastadoNoMes(p: PostoCalc, ano: number, mes: number): boolean {
  if (!p.afast_ini_ano) return false
  const ini = p.afast_ini_ano > ano ? 13 : (p.afast_ini_ano === ano ? (p.afast_ini_mes || 1) : 1)
  const fim = p.afast_fim_ano == null ? 12
    : (p.afast_fim_ano < ano ? 0 : (p.afast_fim_ano === ano ? (p.afast_fim_mes || 12) : 12))
  return mes >= ini && mes <= fim
}

// Contexto da rescisão, montado só no mês da saída.
// `base` é o salário CHEIO, não a base do mês: a rescisão é calculada sobre o
// salário mesmo que o mês esteja zerado por afastamento.
type RescCtx = { base: number; mesesAno: number; mesesCasa: number }

// custo de UM mês: aplica a cascata e devolve o valor por verba (id -> valor).
// `valoresFixos` = valores por posto das verbas VALOR_FIXO (benefícios); ausente = a pessoa não tem.
function custoMes(regVerbas: VerbaRegra[], base: number, valoresFixos: Record<string, number>, afastado = false, resc: RescCtx | null = null): Record<string, number> {
  const valores: Record<string, number> = {}
  const idPorCod: Record<string, string> = Object.fromEntries(regVerbas.map(v => [v.codigo, v.id]))
  const somaRefs = (ref: string | null) => (ref || '').split(',').map(s => s.trim()).filter(Boolean)
    .reduce((s, cod) => s + (valores[idPorCod[cod]] ?? 0), 0)   // soma das verbas referenciadas (já calculadas antes, pela ordem)
  let baseEncargos = 0
  for (const v of regVerbas) {
    const p = Number(v.parametro || 0)
    let val = 0
    switch (v.tipo_calculo) {
      case 'BASE': val = base; break
      case 'PCT_BASE': val = baseEncargos * p / 100; break
      case 'PROVISAO_1_12': val = baseEncargos * p / 12; break
      case 'PCT_VERBA': val = somaRefs(v.verba_ref) * p / 100; break
      // VALOR_FIXO é o único que não segue a base — no mês afastado ele só
      // continua se a verba disser que continua (plano de saúde sim, VT não).
      case 'VALOR_FIXO': val = (afastado && v.mantem_afastado === false) ? 0 : (valoresFixos[v.id] ?? 0); break
      // Rescisão: zero em todo mês que não é o da saída. É por isso que um
      // `PCT_VERBA` que referencie estas (FGTS sobre o aviso e o 13º) não precisa
      // saber nada de rescisão — ele rende 8% de zero nos outros meses.
      // Aviso prévio: 30 dias + 3 por ano completo, teto de 90 (Lei 12.506/11).
      // `parametro` é multiplicador, p/ simular acordo (0,5) ou aviso trabalhado (0).
      case 'RESC_AVISO': val = resc ? resc.base * Math.min(90, 30 + 3 * Math.floor(resc.mesesCasa / 12)) / 30 * p : 0; break
      // 13º e férias proporcionais: fator × meses do ano / 12 (férias = 1,3333, o +1/3).
      case 'RESC_PROP': val = resc ? resc.base * (resc.mesesAno / 12) * p : 0; break
      // Multa de 40% sobre o saldo do FGTS. O saldo real vem do extrato e o
      // orçamento não o tem, então ESTIMA por salário × meses de casa:
      // `parametro` em % (3,2 = 40% × 8%). Erra para quem teve salário muito
      // menor no passado — é estimativa, e o parâmetro é o lugar de calibrar.
      case 'RESC_SALDO_FGTS': val = resc ? resc.base * resc.mesesCasa * p / 100 : 0; break
      default: val = 0
    }
    valores[v.id] = val
    if (v.incide_encargos) baseEncargos += val
  }
  return valores
}

export function calcularPosto(
  posto: PostoCalc,
  verbas: VerbaRegra[],
  opts: { dissidioPct: number; mesBase: number; ano: number; valoresFixos?: Record<string, number> },
): ResultadoPosto {
  const valoresFixos = opts.valoresFixos || {}
  const regVerbas = verbasDoRegime(verbas, posto.regime, posto.pais ?? null)
  const fte = Number(posto.fte || 1)
  const salBase = Number(posto.salario_base || 0)
  const [ini, fim] = vigencia(posto, opts.ano)
  // Mês da saída DENTRO do ano: só quando o fim de vigência cai neste ano. Com
  // fim nulo ou em ano posterior não há demissão a orçar aqui.
  const mesFimVigencia = posto.fim_ano === opts.ano ? (posto.fim_mes || 12) : null
  // Tempo de casa até a saída. Usa `admissao`; sem ela, a vigência de início,
  // que é o que o import do RH grava. Zero (sem nenhuma das duas) = sem multa.
  const admAno = posto.admissao ? Number(posto.admissao.slice(0, 4)) : posto.ini_ano
  const admMes = posto.admissao ? Number(posto.admissao.slice(5, 7)) : (posto.ini_mes || 1)
  const mesesCasaAte = (mes: number) =>
    admAno ? Math.max(0, (opts.ano - admAno) * 12 + (mes - (admMes || 1))) : 0

  const contaPorVerba: Record<string, string | null> = Object.fromEntries(regVerbas.map(v => [v.id, v.conta_destino_id]))
  const anoMap = new Map<string, number>()   // verba.id -> soma anual
  const porContaMes: Record<string, number[]> = {}   // conta -> [12] por mês
  const porVerbaMes: Record<string, number[]> = {}   // verba.id -> [12] por mês
  let ultimo: Record<string, number> = {}    // valores do último mês vigente (mês representativo)
  let baseMes = 0, mesesVigentes = 0, mesesAfastado = 0, rescisaoAno = 0

  for (let mes = 1; mes <= 12; mes++) {
    if (mes < ini || mes > fim) continue
    mesesVigentes++
    // Reajuste individual: a partir do mês dele, ou o salário novo entra no lugar
    // da base, ou o percentual a multiplica. COMPÕE com o dissídio — promovido em
    // março e reajustado pelo sindicato em setembro leva os dois.
    const comReajuste = !!posto.reajuste_mes && mes >= posto.reajuste_mes
    const salMes = comReajuste && posto.reajuste_valor != null
      ? Number(posto.reajuste_valor)
      : salBase * (comReajuste && posto.reajuste_pct ? 1 + Number(posto.reajuste_pct) / 100 : 1)
    const comDissidio = opts.dissidioPct > 0 && mes >= opts.mesBase
    // Afastado: a empresa não paga o salário (do 16º dia é o INSS) e por isso
    // nada que incida sobre ele — INSS patronal, FGTS (suspenso em doença
    // comum), 13º e férias. Zerar a base derruba a cascata inteira de uma vez;
    // só os benefícios de valor fixo seguem, verba a verba.
    const afastado = afastadoNoMes(posto, opts.ano, mes)
    if (afastado) mesesAfastado++
    const baseSal = salMes * fte * (comDissidio ? 1 + opts.dissidioPct / 100 : 1)
    const base = afastado ? 0 : baseSal
    const resc = mes === mesFimVigencia
      ? { base: baseSal, mesesAno: mesesVigentes, mesesCasa: mesesCasaAte(mes) }
      : null
    const valores = custoMes(regVerbas, base, valoresFixos, afastado, resc)
    for (const id in valores) {
      if (!valores[id]) continue
      anoMap.set(id, (anoMap.get(id) || 0) + valores[id]);
      (porVerbaMes[id] ||= new Array(12).fill(0))[mes - 1] += valores[id]
      const conta = contaPorVerba[id]
      if (conta) { (porContaMes[conta] ||= new Array(12).fill(0))[mes - 1] += valores[id] }
    }
    // O mês representativo é o RECORRENTE: a rescisão é um evento único e
    // somá-la ao "custo/mês" daria a impressão de que a pessoa custa isso todo
    // mês. Ela sai no total do ano e no `rescisaoAno`, separada. Rodar a cascata
    // duas vezes no mês da saída resolve também o PCT_VERBA que a referencia.
    if (resc) {
      const semResc = custoMes(regVerbas, base, valoresFixos, afastado, null)
      const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
      rescisaoAno = soma(valores) - soma(semResc)
      ultimo = semResc
    } else ultimo = valores
    baseMes = base
  }

  const linhas: LinhaMemoria[] = regVerbas.map(v => ({
    verba: v, categoria: categoriaDe(v),
    valorMes: ultimo[v.id] || 0, valorAno: anoMap.get(v.id) || 0,
  })).filter(l => l.valorAno !== 0 || l.valorMes !== 0)

  const porCategoria = Object.fromEntries(CATEGORIAS.map(c => [c, 0])) as Record<Categoria, number>
  const porConta: Record<string, number> = {}
  for (const l of linhas) {
    porCategoria[l.categoria] += l.valorAno
    if (l.verba.conta_destino_id) porConta[l.verba.conta_destino_id] = (porConta[l.verba.conta_destino_id] || 0) + l.valorAno
  }
  const totalMes = Object.values(ultimo).reduce((s, x) => s + x, 0)
  const totalAno = [...anoMap.values()].reduce((s, x) => s + x, 0)
  return { linhas, baseMes, totalMes, totalAno, mesesVigentes, mesesAfastado, rescisaoAno, mesFimVigencia, porCategoria, porConta, porContaMes, porVerbaMes }
}
