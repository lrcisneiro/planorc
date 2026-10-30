// ============================================================
// Catálogo de WIZARDS de formulário (desenho: docs/DESIGN_wizard_formularios.md)
//
// Um wizard gera um formulário a partir de dado que o sistema JÁ TEM — a
// receita orçada, o realizado de um ano, um campo de cadastro — em vez de
// pedir que alguém redigite. O resultado é um formulário comum: edita-se,
// confere-se e aplica-se como qualquer outro, e uma célula pode ser corrigida
// à mão (orçamento sempre tem exceção).
//
// A RECEITA mora aqui, em código, como o catálogo CAPACIDADES; o RESULTADO é
// dado. Cada wizard declara seus PARÂMETROS (a tela os desenha sozinha) e
// implementa `preparar`, que devolve a estrutura e os valores.
//
// `preparar` devolve a estrutura porque ela pode ser DINÂMICA: a réplica de
// uma linha que agrupa quatro contas gera um par de linhas por conta, e isso
// só se sabe depois de resolver os parâmetros.
// ============================================================
import { supabase } from './supabase'
import { COLS_LINHA, mastersDaSelecao, type LinhaRel } from './refRelatorio'
import { completarCauda, lerCampoFilial, lerOrcadoPorConta, lerOrcadoTotal, lerRealizadoPorConta } from './wizardFontes'
import type { MetodoCauda } from './wizardFontes'

// ── parâmetros: a tela desenha a partir daqui ──
export type ParamDef = ParamVisivel & (
  | { key: string; tipo: 'versao';     label: string; ajuda?: string }
  | { key: string; tipo: 'ano';        label: string; ajuda?: string }
  | { key: string; tipo: 'mes';        label: string; ajuda?: string }
  | { key: string; tipo: 'relatorio';  label: string; ajuda?: string }
  | { key: string; tipo: 'linhas';     label: string; de: string; ajuda?: string }
  | { key: string; tipo: 'percentual'; label: string; padrao?: number; ajuda?: string }
  | { key: string; tipo: 'escolha';    label: string; padrao?: string; ajuda?: string
      opcoes: { valor: string; rotulo: string }[] })

/** Todo wizard recebe, além dos seus, `versaoAlvo` e `anoAlvo`: onde os valores
 *  são gravados. O de impostos lê da mesma versão em que grava; o de réplica
 *  tem origem própria. `visivelSe` esconde um parâmetro que só faz sentido
 *  junto de outro — versão de origem só importa se a fonte for o orçado. */
export type ParamVisivel = { visivelSe?: { key: string; valor: string } }

export type WizardLinha = {
  codigo: string
  descricao: string
  tipo_linha: 'ANALITICA' | 'FORMULA'
  natureza: 'RECEITA' | 'DESPESA' | 'NEUTRO'
  formato: 'MOEDA' | 'PERCENTUAL' | 'NUMERO'
  casas?: number
  expressao?: string
  contaDestino?: string     // código da conta_orcamentaria (o executor resolve)
  contaDestinoId?: string   // id direto, quando a estrutura é dinâmica
}

/** Valor a gravar. `escopoGlobal` grava como premissa 🌐 (vale para todas as empresas). */
export type ValorGerado = {
  linha: string
  e: string | null; f: string | null; c: string | null
  m: number; v: number
  escopoGlobal?: boolean
}

export type Preparado = {
  linhas: WizardLinha[]
  valores: ValorGerado[]
  avisos: string[]
  escopos: number
  /** sugestão de nome/código, quando o wizard sabe melhor que o padrão */
  sugestao?: { codigo?: string; nome?: string }
}

export type Wizard = {
  codigo: string
  nome: string
  descricao: string
  comoFunciona: string
  avisos?: string[]
  params: ParamDef[]
  preparar: (p: Record<string, any>) => Promise<Preparado>
}

// ── utilitários ──
const ESCOPO = (v: { e: string; f: string | null; c: string | null }) => `${v.e}|${v.f ?? ''}|${v.c ?? ''}`
/** código de linha a partir do código da conta: só A-Z 0-9, com teto de tamanho */
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'X'

// ============================================================
// 1 · IMPOSTOS SOBRE FATURAMENTO
// ============================================================
const CONTA_IMPOSTO = '13001'

const impostos: Wizard = {
  codigo: 'IMPOSTO_FAT',
  nome: 'Impostos sobre faturamento',
  descricao: 'Lê a receita orçada e aplica a alíquota cadastrada em cada filial.',
  comoFunciona:
    'Soma a receita orçada da versão escolhida por empresa · filial · centro de custo, ' +
    'traz o percentual de cada filial do cadastro e calcula o imposto mês a mês. ' +
    'Gera um escopo para cada combinação que tiver receita.',
  avisos: [
    'A alíquota vem de Cadastros › Filiais. Filial sem alíquota não entra.',
    'A inadimplência NÃO reduz a base: faturar e não receber não dispensa o imposto. ' +
    'A postergação reduz, e corretamente — venda postergada não foi faturada.',
    'Depois de mexer na receita, re-gere: o que o wizard escreveu é substituído, ' +
    'o que você corrigiu à mão permanece.',
  ],
  // sem parâmetros próprios: lê da MESMA versão/ano em que grava
  params: [],
  async preparar(p) {
    const avisos: string[] = []
    // A INVARIANTE: um wizard nunca lê o que ele escreve. Sem excluir a conta
    // de destino, o imposto entraria na própria base na 2ª geração e cresceria
    // a cada execução — erro que aparece devagar e parece premissa.
    const dados = await lerOrcadoTotal(p.versaoAlvo, Number(p.anoAlvo), {
      natureza: 'RECEITA', excluirContas: [CONTA_IMPOSTO], excluirLinhas: ['INADVL'],
    })
    const escopos = new Map(dados.map(d => [ESCOPO(d as any), d]))
    if (!escopos.size) {
      throw new Error('Nenhum escopo com receita nessa versão e ano — nada a gerar. ' +
                      'Confira se o orçado já foi aplicado na versão escolhida.')
    }

    // ZERO é alíquota real (exterior, compartilhadas); NULO é cadastro faltando.
    // Tratar igual acusaria quem está certo e esconderia quem não está.
    const filiais = await lerCampoFilial('imp_fat')
    const comEscopo = new Set(Array.from(escopos.values()).map(x => x.f).filter(Boolean) as string[])
    const pct: Record<string, number> = {}
    const semValor: string[] = [], zerados: string[] = []
    for (const fi of filiais) {
      if (fi.imp_fat == null) { if (comEscopo.has(fi.id)) semValor.push(`${fi.codigo} · ${fi.descricao}`); continue }
      pct[fi.id] = Number(fi.imp_fat)
      if (Number(fi.imp_fat) === 0 && comEscopo.has(fi.id)) zerados.push(`${fi.codigo} · ${fi.descricao}`)
    }
    if (semValor.length) avisos.push(`${semValor.length} filial(is) têm receita e estão SEM alíquota no cadastro, então saem zero: ${semValor.join(' · ')}.`)
    if (zerados.length)  avisos.push(`${zerados.length} filial(is) estão com alíquota 0 e têm receita: ${zerados.join(' · ')}. Se for zero mesmo (exterior, compartilhada), está certo — o aviso é para o zero ser decisão, não esquecimento.`)
    const semFilial = Array.from(escopos.values()).filter(x => !x.f).length
    if (semFilial) avisos.push(`${semFilial} escopo(s) têm receita lançada SEM filial. Como a alíquota vem da filial, esses ficam sem percentual.`)

    const valores: ValorGerado[] = []
    for (const d of dados) valores.push({ linha: 'RECBASE', e: d.e, f: d.f, c: d.c, m: d.m, v: d.v })
    for (const x of escopos.values()) {
      const a = x.f ? pct[x.f] : undefined
      if (a == null) continue
      // nos DOZE meses: se depois alguém digitar receita num mês vazio, a
      // alíquota já está lá para calcular
      for (let m = 1; m <= 12; m++) valores.push({ linha: 'ALIQ', e: x.e, f: x.f, c: x.c, m, v: a })
    }

    return {
      avisos, escopos: escopos.size, valores,
      linhas: [
        { codigo: 'RECBASE', descricao: 'Receita faturada do mês (lida do orçado)', tipo_linha: 'ANALITICA', natureza: 'RECEITA', formato: 'MOEDA', casas: 2 },
        { codigo: 'ALIQ',    descricao: '% de imposto sobre faturamento (do cadastro da filial)', tipo_linha: 'ANALITICA', natureza: 'NEUTRO', formato: 'PERCENTUAL', casas: 2 },
        // NEGATIVO: é redutora de receita, mesma convenção do POSTERGVL e do INADVL
        { codigo: 'IMPOSTO', descricao: 'Imposto sobre faturamento', tipo_linha: 'FORMULA', natureza: 'RECEITA', formato: 'MOEDA', casas: 2,
          expressao: '=-[RECBASE] * [ALIQ] / 100', contaDestino: CONTA_IMPOSTO },
      ],
    }
  },
}

// ============================================================
// 2 · RÉPLICA DE LINHA ORÇAMENTÁRIA
// ============================================================
const replica: Wizard = {
  codigo: 'REPLICA_LINHA',
  nome: 'Réplica de linha orçamentária',
  descricao: 'Repete uma linha do relatório de um ano para o outro, com acréscimo ou decréscimo.',
  comoFunciona:
    'Você escolhe um relatório e uma linha dele. O wizard descobre as contas da subárvore, ' +
    'lê o valor de cada uma por empresa · filial · centro de custo e gera um par de linhas por conta — ' +
    'o valor de origem e o resultado ajustado. Assim o orçado volta para a MESMA conta de onde veio, ' +
    'e Orçado × Realizado continua fechando conta a conta.',
  avisos: [
    'O ajuste entra como premissa global 🌐: um percentual vale para todos os escopos, ' +
    'e você pode sobrescrever a célula de um deles depois.',
    'Linha de fórmula ou indicador não serve de origem — ela tem total, mas não tem conta por trás.',
  ],
  params: [
    { key: 'relatorio', tipo: 'relatorio', label: 'Relatório de origem' },
    { key: 'linhas', tipo: 'linhas', de: 'relatorio', label: 'Linhas a replicar',
      ajuda: 'Marque quantas quiser. Marcar um bloco inclui tudo abaixo dele — não precisa marcar as filhas.' },
    { key: 'fonte', tipo: 'escolha', label: 'Replicar a partir de', padrao: 'REALIZADO',
      opcoes: [{ valor: 'REALIZADO', rotulo: 'Realizado de um ano' }, { valor: 'ORCADO', rotulo: 'Orçado de uma versão' }] },
    // o ano do orçado sai da própria versão (versao_orcamento.ano é NOT NULL);
    // perguntá-lo de novo só convidaria a escolher um par inconsistente
    { key: 'versaoOrigem', tipo: 'versao', label: 'Versão de origem', visivelSe: { key: 'fonte', valor: 'ORCADO' } },
    { key: 'anoOrigem', tipo: 'ano', label: 'Ano do realizado', visivelSe: { key: 'fonte', valor: 'REALIZADO' } },
    { key: 'mesCorte', tipo: 'mes', label: 'Usar o realizado até o mês', visivelSe: { key: 'fonte', valor: 'REALIZADO' },
      ajuda: 'O último mês FECHADO. Um mês parcial no fim contamina duas vezes: entra menor e ainda puxa a média da projeção para baixo.' },
    { key: 'ajuste', tipo: 'percentual', label: '% de acréscimo (negativo para reduzir)', padrao: 0 },
    // Mesmos métodos do dashboard de Orçamento: é a mesma pergunta — "e se o
    // resto do ano seguir este ritmo?" — e duas telas respondendo igual com
    // palavras diferentes é como se divergem.
    { key: 'cauda', tipo: 'escolha', label: 'Meses seguintes, até dezembro', padrao: 'MEDIA3',
      ajuda: 'O realizado do ano em curso para no mês de corte; daí até dezembro é projeção.',
      opcoes: [
        { valor: 'VAZIO',    rotulo: 'não projetar — ficam vazios (viram zero no orçado)' },
        { valor: 'MEDIA3',   rotulo: 'projetar pela média dos 3 últimos meses' },
        { valor: 'MEDIAPER', rotulo: 'projetar pela média de todo o período' },
        { valor: 'ULTIMO',   rotulo: 'projetar repetindo o último mês' },
      ] },
  ],
  async preparar(p) {
    const avisos: string[] = []
    const sel: string[] = Array.isArray(p.linhas) ? p.linhas : (p.linhas ? [p.linhas] : [])
    if (!p.relatorio || !sel.length) throw new Error('Escolha o relatório e ao menos uma linha de origem.')

    // 1 · linha → masters (a mesma resolução que a conciliação usa)
    const { data: rl, error } = await supabase.from('relatorio_linha').select(COLS_LINHA).eq('relatorio_id', p.relatorio)
    if (error) throw new Error('Erro ao ler as linhas do relatório: ' + error.message)
    // mastersDaSelecao já desce a subárvore de cada linha marcada e resolve
    // sobreposição (bloco + filha marcados juntos não duplicam o master)
    const { masters } = mastersDaSelecao((rl || []) as LinhaRel[], sel)
    if (!masters.length) {
      throw new Error('Nenhuma das linhas marcadas tem conta por trás — são fórmula, indicador ou bloco vazio. ' +
                      'Marque uma linha analítica, ou um bloco que contenha alguma.')
    }

    // 2 · ler a origem. O ano do orçado vem da VERSÃO, não de um campo à parte.
    let ano: number, corte: number
    if (p.fonte === 'ORCADO') {
      const { data: v } = await supabase.from('versao_orcamento').select('ano,codigo').eq('id', p.versaoOrigem).maybeSingle()
      if (!v) throw new Error('Escolha a versão de origem.')
      ano = Number(v.ano); corte = 12          // versão orçada é ano inteiro
    } else {
      ano = Number(p.anoOrigem); corte = Number(p.mesCorte ?? 12)
    }
    let dados = p.fonte === 'ORCADO'
      ? await lerOrcadoPorConta(p.versaoOrigem, ano, masters)
      : await lerRealizadoPorConta(ano, masters)
    if (!dados.length) {
      throw new Error(p.fonte === 'ORCADO'
        ? 'Nenhum valor orçado nessa versão para a linha escolhida.'
        : `Nenhum realizado em ${ano} para a linha escolhida.`)
    }

    // 3 · corte: o que vem DEPOIS do último mês fechado é descartado.
    // Outubro parcial, se entrasse, viria menor E puxaria a média para baixo.
    const antes = dados.length
    dados = dados.filter(d => d.m <= corte)
    if (!dados.length) throw new Error(`Nenhum valor até o mês ${corte} — confira o mês de corte.`)
    if (dados.length < antes) avisos.push(
      `${antes - dados.length} célula(s) depois do mês ${corte} foram descartadas, por serem de mês não fechado.`)

    // 4 · cauda do ano
    const metodo = (p.cauda ?? 'MEDIA3') as MetodoCauda
    if (metodo !== 'VAZIO') {
      const r = completarCauda(dados, corte, metodo)
      dados = r.linhas
      const como = metodo === 'MEDIA3' ? 'pela média dos 3 últimos meses'
                 : metodo === 'MEDIAPER' ? 'pela média de todo o período'
                 : 'repetindo o último mês'
      if (r.estimados) avisos.push(
        `${r.estimados} célula(s) dos meses ${corte + 1}–12 foram ESTIMADAS ${como} de cada escopo — ` +
        'projeção não é fato, confira antes de aplicar.')
    } else if (corte < 12) {
      avisos.push(
        `Os meses ${corte + 1}–12 ficam VAZIOS, e célula vazia vale zero no orçado.`)
    }

    // 5 · contas presentes → um par de linhas por conta
    const presentes = Array.from(new Set(dados.map(d => d.k!).filter(Boolean)))
    const { data: contas, error: e2 } = await supabase.from('conta_orcamentaria')
      .select('id,codigo,descricao,natureza').in('id', presentes)
    if (e2) throw new Error('Erro ao ler as contas: ' + e2.message)

    const linhas: WizardLinha[] = [{
      codigo: 'AJUSTE', descricao: '% de acréscimo sobre a origem (negativo reduz)',
      tipo_linha: 'ANALITICA', natureza: 'NEUTRO', formato: 'PERCENTUAL', casas: 2,
    }]
    const codDe: Record<string, string> = {}
    const usados = new Set(['AJUSTE'])
    for (const c of (contas || []) as any[]) {
      let base = slug(c.codigo); let n = 1
      while (usados.has('ORIG' + base)) base = slug(c.codigo) + (++n)
      usados.add('ORIG' + base)
      codDe[c.id] = base
      const nat = (c.natureza === 'DESPESA' ? 'DESPESA' : c.natureza === 'RECEITA' ? 'RECEITA' : 'NEUTRO') as any
      linhas.push({
        codigo: `ORIG${base}`, descricao: `${c.codigo} · ${c.descricao} — origem`,
        tipo_linha: 'ANALITICA', natureza: nat, formato: 'MOEDA', casas: 2,
      })
      linhas.push({
        codigo: `VAL${base}`, descricao: `${c.codigo} · ${c.descricao}`,
        tipo_linha: 'FORMULA', natureza: nat, formato: 'MOEDA', casas: 2,
        expressao: `=[ORIG${base}] * (1 + [AJUSTE] / 100)`,
        contaDestinoId: c.id,
      })
    }

    // 6 · valores
    const valores: ValorGerado[] = []
    for (const d of dados) {
      const b = codDe[d.k!]
      if (b) valores.push({ linha: `ORIG${b}`, e: d.e, f: d.f, c: d.c, m: d.m, v: d.v })
    }
    // O ajuste vai como premissa GLOBAL 🌐 — doze células no lugar de doze por
    // escopo. A grade de cada empresa herda em itálico, e sobrescrever uma
    // continua possível.
    const aj = Number(p.ajuste ?? 0)
    for (let m = 1; m <= 12; m++) valores.push({ linha: 'AJUSTE', e: null, f: null, c: null, m, v: aj, escopoGlobal: true })

    const escopos = new Set(dados.map(d => ESCOPO(d as any))).size
    const descs = sel.map(id => ((rl || []) as any[]).find(l => l.id === id)?.descricao).filter(Boolean)
    const nomeLinha = descs.length === 1 ? descs[0] : `${descs.length} linhas`
    return {
      linhas, valores, avisos, escopos,
      sugestao: { codigo: 'REPL_' + slug(descs[0] ?? 'linha'), nome: `Réplica — ${nomeLinha}` },
    }
  },
}

export const WIZARDS: Wizard[] = [impostos, replica]
