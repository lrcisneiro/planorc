// ============================================================
// Catálogo de capacidades — cruza MENUS × FUNÇÕES × ACESSO.
// Fonte única do que é "gateável" no app. Adicionar um menu/função
// novo no futuro = adicionar uma entrada aqui; o controle já passa a existir.
//
// Cada capacidade tem um padrão por papel (admin/member/viewer), e o padrão de
// `member` é o de um DIRETOR DE ÁREA: acompanha e orça a área dele, não opera o
// sistema. Fechado por padrão em importação, cadastro, amarração, realizado,
// saldos e nos dashboards do grupo — libera-se por pessoa, na tela de acesso.
// O padrão vive aqui (código) e só o OVERRIDE em `user_acesso_funcao` (banco):
// uma verdade só, ao custo de que mudar padrão exige deploy.
// ============================================================
export type Papel = 'admin' | 'member' | 'viewer'

export type Capacidade = {
  key: string
  label: string
  categoria: 'Funções' | 'Importações' | 'Menu'
  /** Capacidade que GRAVA no banco. Em perfil `viewer` ela não tem efeito: a
   *  política de RLS (v3_130) barra escrita por PAPEL, não por capacidade.
   *  Serve para a tela de acesso avisar em vez de prometer o que não cumpre. */
  escrita?: boolean
  padrao: Record<Papel, boolean>
}

const RANK: Record<Papel, number> = { admin: 3, member: 2, viewer: 1 }

/** Papel efetivo de quem está logado = **o mais privilegiado** das linhas de
 *  `user_tenant`.
 *
 *  Por que não `linhas[0].role`: hoje cada pessoa tem uma linha, mas nada no
 *  banco garantia isso — faltava o unique por (tenant, pessoa), que a `v3_140`
 *  criou. Sem ele, trocar papel por INSERT em vez de UPDATE deixaria duas
 *  linhas, e aí qual vale seria escolha do plano de execução: a pessoa abriria
 *  como admin numa sessão e viewer na outra, enquanto o banco responde pelo
 *  mais privilegiado (`eh_admin()` é EXISTS). Discordância sem erro nenhum.
 *
 *  Escolher o mais privilegiado é o que o banco já pratica, então o frontend
 *  concorda com ele por construção, e não só porque o unique está lá.
 *
 *  Sem nenhuma linha devolve `''` — ausência não é viewer: quem chama decide,
 *  e todos decidem pelo menor acesso. */
export function papelMaisAlto(linhas: { role?: string | null }[] | null | undefined): Papel | '' {
  let melhor: Papel | '' = ''
  for (const l of linhas || []) {
    const r = l?.role as Papel | undefined
    if (r && RANK[r] && (melhor === '' || RANK[r] > RANK[melhor])) melhor = r
  }
  return melhor
}

export const CAPACIDADES: Capacidade[] = [
  // ── Funções (capacidades de ação) ──
  { escrita: true, key: 'orcar',     label: 'Orçar (editar valores do orçado)', categoria: 'Funções', padrao: { admin: true,  member: true,  viewer: false } },
  // Por NATUREZA, e não por linha: são 169 linhas numa DRE, e a natureza já
  // está na linha e já é herdada pelos filhos (`natEff` na grade) — marcar uma
  // a uma viraria cadastro a refazer toda vez que a estrutura mudasse.
  // Quem só orça despesa não vê as receitas na grade: ali se digita, e linha
  // que a pessoa não preenche é só ruído entre as que ela preenche.
  // ⚠ É CONVENIÊNCIA DE TELA, não controle: o banco restringe o orçado por
  // empresa, filial e CC — não por linha. Para virar controle seria preciso um
  // predicado em `fat_orcado` juntando `relatorio_linha.natureza`.
  { key: 'orcar.receita', label: '· Orçar linhas de RECEITA',  categoria: 'Funções', padrao: { admin: true, member: true, viewer: false } },
  { key: 'orcar.despesa', label: '· Orçar linhas de DESPESA',  categoria: 'Funções', padrao: { admin: true, member: true, viewer: false } },
  // Linha sem natureza própria nem herdada. Separada porque esconder por
  // omissão de cadastro faria sumir linha que ninguém decidiu esconder.
  { key: 'orcar.neutra',  label: '· Orçar linhas NEUTRAS',     categoria: 'Funções', padrao: { admin: true, member: true, viewer: false } },
  // Ver a estrutura e MEXER nela são coisas diferentes. A árvore, as fórmulas
  // e a amarração explicam de onde vem cada número da DRE — é material de
  // consulta legítimo para quem analisa. Mudar ali muda o resultado de todo
  // mundo. Com `estrutura.ver` sozinha a tela abre em leitura: sem mover,
  // indentar, excluir, e o modal de linha com os campos travados.
  { key: 'estrutura.ver', label: 'Abrir estrutura de relatórios (só leitura)', categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },
  { escrita: true, key: 'estrutura', label: 'Editar estrutura de relatórios',    categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },
  // A estrutura do FORMULÁRIO dividia a chave com a do relatório. São árvores
  // diferentes, com donos diferentes: a do relatório é a DRE do grupo, a do
  // formulário é a memória de cálculo de uma receita. Quem mexe numa não
  // precisa mexer na outra.
  { escrita: true, key: 'formulario.estrutura', label: 'Editar estrutura de formulários', categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },
  { key: 'exportar',  label: 'Exportar dashboards (imagem/PDF)',  categoria: 'Funções', padrao: { admin: true,  member: true,  viewer: true  } },
  { escrita: true, key: 'indicador.meta', label: 'Editar metas de indicadores',   categoria: 'Funções', padrao: { admin: true,  member: false,  viewer: false } },
  // A ação mais destrutiva do produto: apaga o orçado inteiro de uma versão/ano.
  // Só admin por padrão, e mesmo para ele há confirmação pelo código da versão,
  // conferida no servidor (v3_127).
  // Importar baseline vinha junto com `orcar`: liberar a grade a um diretor de
  // área dava a ele a carga em massa do orçamento. Dois níveis, porque os dois
  // modos não têm o mesmo risco — "adicionar" soma ao que existe, "substituir"
  // APAGA o escopo do arquivo antes de gravar.
  { escrita: true, key: 'orcado.apagar', label: 'Apagar todo o orçado de uma versão', categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },

  // ── Posto de trabalho (folha) ──
  // Quebradas em quatro porque o diretor de área precisa MEXER no quadro dele
  // sem poder gravar no orçado nem recarregar base. Antes tudo isto estava sob
  // `orcar`, então dar o quadro a alguém dava junto o Aplicar e os importadores
  // — e o Aplicar SUBSTITUI todo o orçado de origem POSTO da versão.
  // Ver o VALOR da folha é separado de ver o posto. RLS limita linha, não
  // coluna: quem alcançava um posto lia o salário dele pela API, qualquer que
  // fosse a tela. A v3_142 fecha isso por privilégio de coluna + a view
  // `posto_v`, e esta chave é quem decide lá — `pode_ver_folha()` no banco lê
  // o override por esta mesma chave. O `padrao` abaixo está REPETIDO em SQL
  // (única repetição do catálogo, e deliberada: decisão de segurança tem de
  // ser tomada no banco, e o catálogo não existe lá). Mudar aqui = mudar lá.
  { key: 'posto.salario', label: 'Ver salário e reajuste dos postos', categoria: 'Funções', padrao: { admin: true, member: true, viewer: false } },
  { escrita: true, key: 'posto.aplicar',       label: 'Aplicar o quadro de postos no orçado',   categoria: 'Funções', padrao: { admin: true, member: false, viewer: false } },
  // ⚠ Editar o CADASTRO é diferente de decidir no CENÁRIO, e a separação não é
  // só governança: o cadastro vem do ERP, e a próxima importação do RH
  // SOBRESCREVE o que foi editado à mão (o upsert regrava `salario_base` do
  // arquivo). Quem mexe no mestre sem saber disso faz um trabalho que evapora.
  // O cenário é o lugar certo para decisão de planejamento — fica isolado por
  // versão, é comparável com o cadastro e passa por aprovação.
  { escrita: true, key: 'posto.cadastro.editar', label: 'Editar o cadastro de postos (dado do ERP)', categoria: 'Funções', padrao: { admin: true, member: false, viewer: false } },
  { escrita: true, key: 'posto.cenario.decidir', label: 'Decidir no cenário (cortes, reajustes)',     categoria: 'Funções', padrao: { admin: true, member: true,  viewer: false } },
  { escrita: true, key: 'cenario.aprovar',       label: 'Aprovar cenário de postos',                  categoria: 'Funções', padrao: { admin: true, member: false, viewer: false } },

  // ── Importações ──
  // TODA carga de arquivo do app tem chave própria, inclusive as que ficam
  // liberadas por padrão: o ponto de ser uma opção é poder negar. Importação é
  // a classe de ação mais perigosa do produto — não é editar uma célula, é
  // trocar uma base inteira, e várias delas apagam antes de gravar.
  //
  // O padrão é FECHADO para member em tudo que substitui base, e aberto só
  // onde a carga é rotina de quem usa a tela.
  { key: 'orcado.importar', escrita: true,       label: 'Orçado — Importar Baseline (adicionar)',   categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'orcado.importar.full', escrita: true,  label: 'Orçado — Importar Baseline (SUBSTITUIR)',  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'orcado.importar.excel', escrita: true, label: 'Orçado — Importar Excel (tela de dados)',  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'realizado.importar', escrita: true,    label: 'Realizado — importar razão do ERP',        categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'saldos.importar', escrita: true,       label: 'Saldos — importar balancete',              categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'amarracao.importar', escrita: true,    label: 'Amarração — importar DE-PARA',             categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'cadastros.importar', escrita: true,    label: 'Cadastros — importar Excel',               categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'relatorio.importar', escrita: true,    label: 'Relatório — importar estrutura e matriz',  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'formulario.importar', escrita: true,   label: 'Formulário — importar valores',            categoria: 'Importações', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'posto.importar', escrita: true,        label: 'Postos — importar do RH',                  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'folha.importar', escrita: true,        label: 'Folha realizada — importar e excluir lote', categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'apontamento.importar', escrita: true,  label: 'Apontamento — importar e excluir extrato', categoria: 'Importações', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'fornecedor.importar', escrita: true,   label: 'Fornecedores (PJ) — importar de-para',     categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'verba.importar', escrita: true,        label: 'Estrutura de folha — importar verbas/regras', categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },

  // ── Menu (itens de navegação) ──
  { key: 'menu.dashboards', label: 'Dashboards',              categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  // Um por dashboard. `menu.dashboards` continua sendo a seção; estas dizem
  // QUAIS. Sem isto era tudo-ou-nada, e a análise de Orçamento — que mostra o
  // orçamento do grupo inteiro antes de aprovar — ia junto com o acompanhamento
  // do mês para qualquer um que pudesse ver dashboards.
  { key: 'dash.acompanhamento', label: '· DRE — Acompanhamento',   categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'dash.orcamento',      label: '· Orçamento — análise',    categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'dash.anual',          label: '· DRE — Comparativo anual', categoria: 'Menu', padrao: { admin: true, member: false,  viewer: true  } },
  { key: 'dash.balanco',        label: '· Balanço',                categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'dash.executivo',      label: '· Visão executiva',        categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'dash.cagr',           label: '· CAGR',                   categoria: 'Menu', padrao: { admin: true, member: false,  viewer: true  } },
  { key: 'dash.indicadores',    label: '· Indicadores',            categoria: 'Menu', padrao: { admin: true, member: false,  viewer: true  } },
  { key: 'menu.relatorios', label: 'Relatórios',              categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'menu.orcamento',  label: 'Orçamento',               categoria: 'Menu', padrao: { admin: true, member: false,  viewer: false } },
  // Três telas do grupo Orçamento dividiam `menu.orcamento`: a de dados, a
  // grade de Orçar e o formulário de drivers. Liberar uma liberava as três, e
  // não dava para dar a grade a um diretor sem dar junto os drivers, que são
  // premissas do grupo. Cada uma com a sua; o padrão repete o que valia antes
  // para não tirar acesso de ninguém ao aplicar.
  // A grade é para DIGITAR (fixa uma combinação); a visão por linha é para
  // ANALISAR (soma o escopo inteiro, edita no drill). Chaves separadas porque
  // são públicos diferentes: o gerente quase sempre quer só a segunda.
  { key: 'menu.orcar.linha', label: 'Orçar — por linha (consolidado)', categoria: 'Menu', padrao: { admin: true, member: true, viewer: false } },
  { key: 'menu.orcar.grade', label: '· Orçar (grade)',          categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.formularios', label: '· Formulário de drivers',  categoria: 'Menu', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'menu.estruturas', label: 'Estruturas de relatórios', categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.postos',     label: 'Posto de trabalho (folha)', categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  // Os PASSOS de Posto de trabalho. Gateados um a um porque o diretor de área
  // acompanha o quadro e concilia, mas não mexe no catálogo de verbas nem nas
  // regras de rateio — que valem para o grupo inteiro, não para a área dele.
  // Passo sem capacidade some da navegação e a numeração se refaz sem buraco.
  { key: 'menu.postos.quadro',      label: '· Postos (quadro)',        categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.organograma', label: '· Organograma',            categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.memoria',     label: '· Memória de cálculo',     categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.folha',       label: '· Folha realizada',        categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.apontamento', label: '· Apontamento',            categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.conciliacao', label: '· Conciliação',            categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.estrutura',   label: '· Estrutura (verbas/regras)', categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.postos.rateio',      label: '· Rateio',                 categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.realizado',  label: 'Realizado',               categoria: 'Menu', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'menu.saldos',     label: 'Saldos (BP)',             categoria: 'Menu', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'menu.amarracao',  label: 'Amarração',               categoria: 'Menu', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'menu.cadastros',  label: 'Cadastros',               categoria: 'Menu', padrao: { admin: true, member: false,  viewer: false } },
  { key: 'menu.config',     label: 'Configurações',           categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
]

export const CAP_BY_KEY: Record<string, Capacidade> = Object.fromEntries(CAPACIDADES.map(c => [c.key, c]))
