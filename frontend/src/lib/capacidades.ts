// ============================================================
// Catálogo de capacidades — cruza MENUS × FUNÇÕES × ACESSO.
// Fonte única do que é "gateável" no app. Adicionar um menu/função
// novo no futuro = adicionar uma entrada aqui; o controle já passa a existir.
//
// Cada capacidade tem um padrão por papel (admin/member/viewer).
// (Próximo incremento: override por usuário em user_acesso_funcao.)
// ============================================================
export type Papel = 'admin' | 'member' | 'viewer'

export type Capacidade = {
  key: string
  label: string
  categoria: 'Funções' | 'Importações' | 'Menu'
  padrao: Record<Papel, boolean>
}

export const CAPACIDADES: Capacidade[] = [
  // ── Funções (capacidades de ação) ──
  { key: 'orcar',     label: 'Orçar (editar valores do orçado)', categoria: 'Funções', padrao: { admin: true,  member: true,  viewer: false } },
  { key: 'estrutura', label: 'Editar estrutura de relatórios',    categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },
  // A estrutura do FORMULÁRIO dividia a chave com a do relatório. São árvores
  // diferentes, com donos diferentes: a do relatório é a DRE do grupo, a do
  // formulário é a memória de cálculo de uma receita. Quem mexe numa não
  // precisa mexer na outra.
  { key: 'formulario.estrutura', label: 'Editar estrutura de formulários', categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },
  { key: 'exportar',  label: 'Exportar dashboards (imagem/PDF)',  categoria: 'Funções', padrao: { admin: true,  member: true,  viewer: true  } },
  { key: 'indicador.meta', label: 'Editar metas de indicadores',   categoria: 'Funções', padrao: { admin: true,  member: true,  viewer: false } },
  // A ação mais destrutiva do produto: apaga o orçado inteiro de uma versão/ano.
  // Só admin por padrão, e mesmo para ele há confirmação pelo código da versão,
  // conferida no servidor (v3_127).
  // Importar baseline vinha junto com `orcar`: liberar a grade a um diretor de
  // área dava a ele a carga em massa do orçamento. Dois níveis, porque os dois
  // modos não têm o mesmo risco — "adicionar" soma ao que existe, "substituir"
  // APAGA o escopo do arquivo antes de gravar.
  { key: 'orcado.apagar', label: 'Apagar todo o orçado de uma versão', categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },

  // ── Posto de trabalho (folha) ──
  // Quebradas em quatro porque o diretor de área precisa MEXER no quadro dele
  // sem poder gravar no orçado nem recarregar base. Antes tudo isto estava sob
  // `orcar`, então dar o quadro a alguém dava junto o Aplicar e os importadores
  // — e o Aplicar SUBSTITUI todo o orçado de origem POSTO da versão.
  { key: 'posto.aplicar',       label: 'Aplicar o quadro de postos no orçado',   categoria: 'Funções', padrao: { admin: true, member: false, viewer: false } },

  // ── Importações ──
  // TODA carga de arquivo do app tem chave própria, inclusive as que ficam
  // liberadas por padrão: o ponto de ser uma opção é poder negar. Importação é
  // a classe de ação mais perigosa do produto — não é editar uma célula, é
  // trocar uma base inteira, e várias delas apagam antes de gravar.
  //
  // O padrão é FECHADO para member em tudo que substitui base, e aberto só
  // onde a carga é rotina de quem usa a tela.
  { key: 'orcado.importar',       label: 'Orçado — Importar Baseline (adicionar)',   categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'orcado.importar.full',  label: 'Orçado — Importar Baseline (SUBSTITUIR)',  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'orcado.importar.excel', label: 'Orçado — Importar Excel (tela de dados)',  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'realizado.importar',    label: 'Realizado — importar razão do ERP',        categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'saldos.importar',       label: 'Saldos — importar balancete',              categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'amarracao.importar',    label: 'Amarração — importar DE-PARA',             categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'cadastros.importar',    label: 'Cadastros — importar Excel',               categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'relatorio.importar',    label: 'Relatório — importar estrutura e matriz',  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'formulario.importar',   label: 'Formulário — importar valores',            categoria: 'Importações', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'posto.importar',        label: 'Postos — importar do RH',                  categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'folha.importar',        label: 'Folha realizada — importar e excluir lote', categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'apontamento.importar',  label: 'Apontamento — importar e excluir extrato', categoria: 'Importações', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'fornecedor.importar',   label: 'Fornecedores (PJ) — importar de-para',     categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },
  { key: 'verba.importar',        label: 'Estrutura de folha — importar verbas/regras', categoria: 'Importações', padrao: { admin: true, member: false, viewer: false } },

  // ── Menu (itens de navegação) ──
  { key: 'menu.dashboards', label: 'Dashboards',              categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  // Um por dashboard. `menu.dashboards` continua sendo a seção; estas dizem
  // QUAIS. Sem isto era tudo-ou-nada, e a análise de Orçamento — que mostra o
  // orçamento do grupo inteiro antes de aprovar — ia junto com o acompanhamento
  // do mês para qualquer um que pudesse ver dashboards.
  { key: 'dash.acompanhamento', label: '· DRE — Acompanhamento',   categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'dash.orcamento',      label: '· Orçamento — análise',    categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'dash.anual',          label: '· DRE — Comparativo anual', categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'dash.balanco',        label: '· Balanço',                categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'dash.executivo',      label: '· Visão executiva',        categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'dash.cagr',           label: '· CAGR',                   categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'dash.indicadores',    label: '· Indicadores',            categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'menu.relatorios', label: 'Relatórios',              categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'menu.orcamento',  label: 'Orçamento',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  // Três telas do grupo Orçamento dividiam `menu.orcamento`: a de dados, a
  // grade de Orçar e o formulário de drivers. Liberar uma liberava as três, e
  // não dava para dar a grade a um diretor sem dar junto os drivers, que são
  // premissas do grupo. Cada uma com a sua; o padrão repete o que valia antes
  // para não tirar acesso de ninguém ao aplicar.
  { key: 'menu.orcar.grade', label: '· Orçar (grade)',          categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.formularios', label: '· Formulário de drivers',  categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.estruturas', label: 'Estruturas de relatórios', categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.postos',     label: 'Posto de trabalho (folha)', categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  // Os PASSOS de Posto de trabalho. Gateados um a um porque o diretor de área
  // acompanha o quadro e concilia, mas não mexe no catálogo de verbas nem nas
  // regras de rateio — que valem para o grupo inteiro, não para a área dele.
  // Passo sem capacidade some da navegação e a numeração se refaz sem buraco.
  { key: 'menu.postos.quadro',      label: '· Postos (quadro)',        categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.memoria',     label: '· Memória de cálculo',     categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.folha',       label: '· Folha realizada',        categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.apontamento', label: '· Apontamento',            categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.conciliacao', label: '· Conciliação',            categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.postos.estrutura',   label: '· Estrutura (verbas/regras)', categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.postos.rateio',      label: '· Rateio',                 categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.realizado',  label: 'Realizado',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.saldos',     label: 'Saldos (BP)',             categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.amarracao',  label: 'Amarração',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.cadastros',  label: 'Cadastros',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.config',     label: 'Configurações',           categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
]

export const CAP_BY_KEY: Record<string, Capacidade> = Object.fromEntries(CAPACIDADES.map(c => [c.key, c]))
