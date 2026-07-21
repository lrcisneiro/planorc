// Motor de folha (P1) — cascata de custo por posto a partir do catálogo de verbas.
// Record-based, puro (sem I/O): recebe posto + verbas + dissídio e devolve a memória de cálculo.
// Ref.: docs/DESIGN_posto_trabalho.md (motor de cálculo).

export type TipoCalculo = 'BASE' | 'PCT_BASE' | 'PCT_VERBA' | 'PROVISAO_1_12' | 'VALOR_FIXO' | 'INFORMATIVA'

export type VerbaRegra = {
  id: string
  codigo: string
  descricao: string
  tipo_calculo: TipoCalculo
  parametro: number | null          // % / fator / valor
  verba_ref: string | null          // p/ PCT_VERBA: CÓDIGOS separados por vírgula (a base é a soma deles)
  conta_destino_id: string | null
  incide_encargos: boolean          // entra na base de PCT_BASE/PROVISAO?
  regime: string | null             // null = vale p/ todos os regimes
  ordem: number | null
  categoria?: string | null         // sobrescreve a categoria da composição (SALARIO/ENCARGOS/PROVISOES/BENEFICIOS); null = padrão do tipo
}

export type PostoCalc = {
  salario_base: number
  fte: number | null
  regime: string | null
  ini_ano?: number | null; ini_mes?: number | null
  fim_ano?: number | null; fim_mes?: number | null
}

export type LinhaMemoria = {
  verba: VerbaRegra
  categoria: Categoria
  valorMes: number   // mês cheio representativo (com dissídio se aplicável)
  valorAno: number   // soma precisa dos 12 meses (respeita vigência + dissídio)
}
export type Categoria = 'Salário' | 'Encargos' | 'Provisões' | 'Benefícios'

export type ResultadoPosto = {
  linhas: LinhaMemoria[]
  baseMes: number          // salário-base do mês representativo (× fte × dissídio)
  totalMes: number         // custo total do mês representativo
  totalAno: number         // custo total do ano
  mesesVigentes: number
  porCategoria: Record<Categoria, number>   // anual
  porConta: Record<string, number>          // conta_destino_id -> anual
  porContaMes: Record<string, number[]>     // conta_destino_id -> [12] valor por mês (Jan=0), respeita vigência/dissídio
}

const CATEGORIA: Record<TipoCalculo, Categoria> = {
  BASE: 'Salário', PCT_BASE: 'Encargos', PCT_VERBA: 'Encargos',
  PROVISAO_1_12: 'Provisões', VALOR_FIXO: 'Benefícios', INFORMATIVA: 'Salário',
}
const CAT_COD: Record<string, Categoria> = { SALARIO: 'Salário', ENCARGOS: 'Encargos', PROVISOES: 'Provisões', BENEFICIOS: 'Benefícios' }
const categoriaDe = (v: VerbaRegra): Categoria => (v.categoria && CAT_COD[v.categoria]) || CATEGORIA[v.tipo_calculo]

// `verba.regime` guarda uma LISTA separada por vírgula (ex.: 'CLT,PROLABORE'); vazio = todos os regimes.
export const regimeAplica = (verbaRegime: string | null | undefined, postoRegime: string | null): boolean => {
  const rs = (verbaRegime || '').split(',').map(s => s.trim()).filter(Boolean)
  return !rs.length || (postoRegime != null && rs.includes(postoRegime))
}

// verbas que se aplicam ao regime do posto, na ordem de cálculo (INFORMATIVA fora)
export function verbasDoRegime(verbas: VerbaRegra[], regime: string | null): VerbaRegra[] {
  return verbas
    .filter(v => v.tipo_calculo !== 'INFORMATIVA' && regimeAplica(v.regime, regime))
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999))
}

// janela de meses vigentes do posto dentro do ano
function vigencia(p: PostoCalc, ano: number): [number, number] {
  const ini = (p.ini_ano && p.ini_ano > ano) ? 13 : (p.ini_ano === ano ? (p.ini_mes || 1) : 1)
  const fim = (p.fim_ano && p.fim_ano < ano) ? 0 : (p.fim_ano === ano ? (p.fim_mes || 12) : 12)
  return [ini, fim]
}

// custo de UM mês: aplica a cascata e devolve o valor por verba (id -> valor).
// `valoresFixos` = valores por posto das verbas VALOR_FIXO (benefícios); ausente = a pessoa não tem.
function custoMes(regVerbas: VerbaRegra[], base: number, valoresFixos: Record<string, number>): Record<string, number> {
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
      case 'VALOR_FIXO': val = valoresFixos[v.id] ?? 0; break   // por posto, não do catálogo
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
  const regVerbas = verbasDoRegime(verbas, posto.regime)
  const fte = Number(posto.fte || 1)
  const salBase = Number(posto.salario_base || 0)
  const [ini, fim] = vigencia(posto, opts.ano)

  const contaPorVerba: Record<string, string | null> = Object.fromEntries(regVerbas.map(v => [v.id, v.conta_destino_id]))
  const anoMap = new Map<string, number>()   // verba.id -> soma anual
  const porContaMes: Record<string, number[]> = {}   // conta -> [12] por mês
  let ultimo: Record<string, number> = {}    // valores do último mês vigente (mês representativo)
  let baseMes = 0, mesesVigentes = 0

  for (let mes = 1; mes <= 12; mes++) {
    if (mes < ini || mes > fim) continue
    mesesVigentes++
    const comDissidio = opts.dissidioPct > 0 && mes >= opts.mesBase
    const base = salBase * fte * (comDissidio ? 1 + opts.dissidioPct / 100 : 1)
    const valores = custoMes(regVerbas, base, valoresFixos)
    for (const id in valores) {
      anoMap.set(id, (anoMap.get(id) || 0) + valores[id])
      const conta = contaPorVerba[id]
      if (conta) { (porContaMes[conta] ||= new Array(12).fill(0))[mes - 1] += valores[id] }
    }
    ultimo = valores; baseMes = base
  }

  const linhas: LinhaMemoria[] = regVerbas.map(v => ({
    verba: v, categoria: categoriaDe(v),
    valorMes: ultimo[v.id] || 0, valorAno: anoMap.get(v.id) || 0,
  })).filter(l => l.valorAno !== 0 || l.valorMes !== 0)

  const porCategoria = { 'Salário': 0, 'Encargos': 0, 'Provisões': 0, 'Benefícios': 0 } as Record<Categoria, number>
  const porConta: Record<string, number> = {}
  for (const l of linhas) {
    porCategoria[l.categoria] += l.valorAno
    if (l.verba.conta_destino_id) porConta[l.verba.conta_destino_id] = (porConta[l.verba.conta_destino_id] || 0) + l.valorAno
  }
  const totalMes = Object.values(ultimo).reduce((s, x) => s + x, 0)
  const totalAno = [...anoMap.values()].reduce((s, x) => s + x, 0)
  return { linhas, baseMes, totalMes, totalAno, mesesVigentes, porCategoria, porConta, porContaMes }
}
