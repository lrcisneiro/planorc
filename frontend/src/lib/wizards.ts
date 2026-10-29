// ============================================================
// Catálogo de WIZARDS de formulário (desenho: docs/DESIGN_wizard_formularios.md)
//
// Um wizard gera um formulário a partir de dado que o sistema JÁ TEM — a
// receita orçada, um campo de cadastro — em vez de pedir que alguém redigite.
// O resultado é um formulário comum: edita-se, confere-se e aplica-se como
// qualquer outro, e uma célula pode ser corrigida à mão (orçamento sempre tem
// exceção).
//
// A RECEITA mora aqui, em código, como o catálogo CAPACIDADES; o RESULTADO é
// dado. Wizard novo = entrada nova neste arquivo, sem migration — a não ser
// que precise de uma fonte que ainda não existe.
// ============================================================

export type Fonte =
  // soma o orçado de uma versão/ano por escopo × mês
  | { tipo: 'ORCADO'; natureza?: 'RECEITA' | 'DESPESA' | 'NEUTRO'; excluirLinhas?: string[] }
  // lê um campo do cadastro e repete nos 12 meses do escopo
  | { tipo: 'CADASTRO'; tabela: 'filial'; campo: string }

export type WizardLinha = {
  codigo: string
  descricao: string
  tipo_linha: 'ANALITICA' | 'FORMULA'
  natureza: 'RECEITA' | 'DESPESA' | 'NEUTRO'
  formato: 'MOEDA' | 'PERCENTUAL' | 'NUMERO'
  casas?: number
  expressao?: string      // só FORMULA
  contaDestino?: string   // código da conta_orcamentaria que recebe o Aplicar
  fonte?: Fonte           // como preencher (só ANALITICA)
}

export type Wizard = {
  codigo: string
  nome: string
  descricao: string
  /** uma linha explicando o que ele faz, mostrada no passo de parâmetros */
  comoFunciona: string
  /** avisos que o usuário precisa ler ANTES de gerar */
  avisos?: string[]
  linhas: WizardLinha[]
}

// ── as contas de destino do próprio wizard, que a fonte ORCADO tem de excluir.
// É a invariante do mecanismo: UM WIZARD NUNCA LÊ O QUE ELE ESCREVE. Sem isso,
// o imposto entraria na própria base na segunda geração e cresceria a cada
// execução — erro que aparece devagar e parece premissa, não defeito.
export const contasDeDestino = (w: Wizard): string[] =>
  w.linhas.map(l => l.contaDestino).filter((c): c is string => !!c)

// ============================================================
export const WIZARDS: Wizard[] = [
  {
    codigo: 'IMPOSTO_FAT',
    nome: 'Impostos sobre faturamento',
    descricao: 'Lê a receita orçada e aplica a alíquota cadastrada em cada filial.',
    comoFunciona:
      'Soma a receita orçada da versão escolhida por empresa · filial · centro de custo, ' +
      'traz o percentual de cada filial do cadastro e calcula o imposto mês a mês. ' +
      'Gera um escopo para cada combinação que tiver receita.',
    avisos: [
      'A alíquota vem de Cadastros › Filiais (campo ISS %). Filial sem alíquota não entra.',
      'A inadimplência NÃO reduz a base: faturar e não receber não dispensa o imposto. ' +
      'A postergação reduz, e corretamente — venda postergada não foi faturada.',
      'Depois de mexer na receita, re-gere: o que o wizard escreveu é substituído, ' +
      'o que você corrigiu à mão permanece.',
    ],
    linhas: [
      {
        codigo: 'RECBASE',
        descricao: 'Receita faturada do mês (lida do orçado)',
        tipo_linha: 'ANALITICA', natureza: 'RECEITA', formato: 'MOEDA', casas: 2,
        fonte: { tipo: 'ORCADO', natureza: 'RECEITA', excluirLinhas: ['INADVL'] },
      },
      {
        codigo: 'ALIQ',
        descricao: '% de imposto sobre faturamento (do cadastro da filial)',
        tipo_linha: 'ANALITICA', natureza: 'NEUTRO', formato: 'PERCENTUAL', casas: 2,
        fonte: { tipo: 'CADASTRO', tabela: 'filial', campo: 'imp_fat' },
      },
      {
        codigo: 'IMPOSTO',
        descricao: 'Imposto sobre faturamento',
        tipo_linha: 'FORMULA', natureza: 'RECEITA', formato: 'MOEDA', casas: 2,
        // NEGATIVO: é redutora de receita, mesma convenção do POSTERGVL e do INADVL
        expressao: '=-[RECBASE] * [ALIQ] / 100',
        contaDestino: '13001',
      },
    ],
  },
]
