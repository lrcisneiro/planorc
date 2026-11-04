# Planorc — Planejamento Orçamentário

Sistema de planejamento e controladoria orçamentária para grupos que operam sobre o ERP TOTVS. Permite estruturar relatórios gerenciais (DRE, Balanço), orçar por linha de relatório, importar o realizado do ERP (razão e balancete) e comparar Orçado × Realizado com dashboards, cubos e múltiplas visões.

> **Nota de manutenção (jun/2026):** este documento foi reescrito para refletir o schema e as telas **vivos** (linhagem v3). Versões anteriores descreviam um protótipo inicial (`plano_orcamentario` + `fat_lancamento` único) que já foi superado. Há ainda referências legadas a `fat_lancamento` no código em transição — ver seção "Legado em transição".

## Stack

- **Frontend**: React 19 + TypeScript + Vite, em `frontend/`. É onde está praticamente toda a lógica — os dados vão direto ao Supabase via SDK do cliente.
- **Backend**: FastAPI (Python), em `backend/` — incipiente, só `/health`. Raramente necessário.
- **Banco**: Supabase (PostgreSQL 15+) — credenciais em `frontend/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Multi-tenant com Row Level Security por `tenant_id`.
- **UI**: Tailwind CSS v4 + objetos de estilo inline (`S`) misturados. Sem biblioteca de componentes; ícones via `lucide-react`. Tema dark/light parametrizado por CSS variables (`lib/theme.ts`), com toggle persistido em `localStorage`.
- **Gráficos**: @nivo. As cores do tema são lidas em runtime das CSS variables via `lib/nivoTheme.ts` (`nivoTheme()`), porque o @nivo aplica cor como atributo SVG e não resolve `var()`.
- **Roteamento**: React Router v7.
- **Agregação pesada**: feita no banco via funções RPC (`relatorio_orcado_agg`, `relatorio_realizado_agg`, `relatorio_saldo_agg` e variantes `_anual`), chamadas com `supabase.rpc(...)`.

> Existe uma pasta duplicada `frontend/frontend/` — artefato de criação errada, ignorar.
> **Fonte única de verdade:** trabalhar sempre nesta pasta (`Documents/planorc`). Um clone antigo em `Documents/Claude/Projects/planorc` foi aposentado em jun/2026.

## Rotas / páginas (App.tsx)

| rota | página | função |
|------|--------|--------|
| `/dashboards` | `DashboardsHubPage` | hub de dashboards |
| `/dashboards/anual` | `ComparativoAnualPage` | comparativo anual |
| `/dashboards/cagr` | `CagrPage` | CAGR |
| `/dashboards/executivo` | `ExecutivoPage` | visão executiva |
| `/dashboards/indicadores` | `IndicadoresPage` | indicadores |
| `/dashboard` | `DashboardPage` | dashboard principal |
| `/balanco` | `BalancoDashboardPage` | Balanço (lê `fat_saldo`) |
| `/relatorios` | `RelatorioPage` | lista de relatórios |
| `/relatorios/:id` | `RelatorioEditorPage mode="consulta"` | **Consultar** — DRE Orçado × Realizado (leitura) |
| `/orcar/:id` | `RelatorioEditorPage mode="orcar"` | **Orçar** — edição dos valores de orçado |
| `/estrutura/:id` | `RelatorioEditorPage mode="estrutura"` | **Estrutura** — árvore/fórmulas/amarração (admin) |
| `/estruturas` | `RelatorioPage linkBase="/estrutura"` | hub que abre os relatórios em modo Estrutura (menu Orçamento) |
| `/orcamento` | `OrcadoDadosPage` | dados de orçado |
| `/realizado` | `RealizadoDadosPage` | dados de realizado — seção **Dados do ERP**, pill 1 |
| `/saldos` | `SaldoDadosPage` | saldos/balancete — pill 2 |
| `/amarracao` | `AmarracaoPage` | amarração conta → linha — pill 3 |
| `/cadastros` · `/cadastros/:aba` | `CadastrosPage` | cadastros (16, em trilho vertical agrupado) |
| `/config` | `ConfiguracoesPage` | configurações (usuários, acesso a dados e capacidades) |
| (login) | `LoginPage` | autenticação |

> **O nível é lembrado POR RELATÓRIO, não só no preset** (nov/2026). O preset só é aplicado ao
> entrar por `?card=<id>`; entrando pelo relatório direto, sair e voltar perdia a escolha — e
> remarcar "nível 1" a cada visita é o atrito que faz a pessoa desistir do controle.
> `useLocalPref('planorc_rel_<id>_vista')` guarda nível e recolhidas por relatório, restaura uma
> vez quando a árvore existe, e **só quando não se entrou por preset** — preset é escolha
> explícita e tem precedência.
>
> **Preset do relatório guarda a INTENÇÃO de nível, não só as linhas recolhidas** (nov/2026).
> `getFiltros` leva `nivel` (`1..n | 'tudo' | null`) **e** `collapsed` (ids). Ao aplicar, a
> intenção vem primeiro: *"até o nível 2"* se re-aplica sobre a árvore de hoje, então sintética
> criada depois do preset nasce recolhida como as outras. Salvar só os ids faria o "nível 2"
> deixar de ser nível 2 na primeira linha nova. Recolher uma linha **à mão** zera a intenção —
> dali em diante o conjunto exato é que manda, porque foi o que a pessoa escolheu.
> ⚠ O preset chega **antes** da árvore, então o nível fica pendente num estado e um efeito o
> aplica quando `tree` existir; sem isso `recolherAteNivel` rodaria sobre árvore vazia e o preset
> abriria tudo expandido, calado.

> **Orçar por LINHA (`/orcar-linha/:id`, nov/2026)** — a visão de quem analisa. A grade fixa UMA
> combinação empresa×filial×CC no cabeçalho: certa para digitar, errada para enxergar; um gerente
> com seis CCs via o número partido em seis. Aqui a linha vem inteira, somando o escopo, com
> `FiltrosButton` (o mesmo de 10 telas), Seções, ocultar zeradas e tudo lembrado **por relatório**.
>
> ⚠ **O consolidado NUNCA grava.** `fat_orcado` só existe no grão da combinação — digitar num
> total exigiria ratear (engana: digita 100, vira 37+41+22) ou gravar em filial/CC nulos, que é o
> que a grade faz em "— consolidado —" e é a origem das 15.613 linhas de grão consolidado. Edita-se
> no **drill** (combinações × 12 meses, com `»`/Ctrl+Enter para repetir até dezembro).
>
> ⚠ **Esta é a única tela onde o GRÃO MISTO aparece** — somando tudo, linha com consolidado *e*
> detalhe no mesmo mês infla. São **122 grupos** hoje. Ela denuncia (aviso no topo, ⚠ na linha, as
> duas pontas no drill) em vez de deixar o número mentir; na grade é invisível, porque cada grão
> fica atrás de um filtro diferente.

> **Cenário de ORÇAMENTO — o cenário É a versão (`v3_171..173`, nov/2026).** Desenho em
> `docs/DESIGN_orcamento_cenario.md`. Diferente dos postos — que precisaram de `posto_versao`
> porque o posto é único e atravessa versões — `fat_orcado` já tem `versao_id`, então **não há
> tabela de sobreposição**. `versao_orcamento.origem_versao_id` é o que torna a versão um cenário:
> sem origem é baseline, com origem é proposta. **Um cenário por área**, o que dissolve de graça o
> escopo da aprovação: a versão já é da área. O controle de acesso sai **zerado de código** — o
> RLS de `fat_orcado` recorta por versão desde a `v3_137`, então "liberar o orçamento para a área"
> é dar `ORCAR` na versão dela, em Configurações.
>
> ⚠ **Só admin semeia** (`copiar_versao`): a função é `SECURITY DEFINER` e copia a baseline
> inteira sem olhar escopo — na mão do gerente seria o caminho para materializar numa versão sua
> o orçado de áreas que ele não vê. **Semeia todas as origens**, embora o merge escreva só
> `MANUAL`: sem POSTO e FORMULARIO o cenário mostraria a área sem 70% do próprio custo e o Δ não
> significaria nada. **Cenário de cenário não** — empilhar Δ sobre Δ deixa o comparativo sem
> referência.
>
> **Veredito por LINHA** (`orcado_veredito`), não por célula: 82 linhas contra 89 mil células, e a
> conversa real é "esse aumento de viagens não passa". `linha_id` é `conta_orcamentaria` (o
> MASTER). Mecânica idêntica à dos postos, que já se provou: recusa exige motivo, `nota` é de quem
> propõe e `aprov_nota` de quem aprova, pendente trava e **recusada não** (recusar é decidir: a
> linha fica com a baseline). `cenario.aprovar` passou a reger **os dois** cenários — o rótulo
> dizia "de postos" e quem liberasse acharia estar liberando só aquilo.
>
> ⚠ **O conjunto que exige veredito é CALCULADO** (`cenario_orcado_diff`), não cadastrado:
> guardar a lista no momento da proposta a deixaria velha na primeira edição seguinte, e o
> carimbo passaria a certificar um conjunto que não existe mais. O `FULL JOIN` ali é porque
> **zerar também é alteração**.
>
> ⚠ **Gatilho de COMANDO, não de linha.** O que derruba o carimbo quando o orçado muda usa tabela
> de transição (`REFERENCING NEW TABLE`): por linha, semear 24 mil células emitiria 24 mil
> `UPDATE` em `versao_orcamento`. São três gatilhos porque INSERT só enxerga `NEW TABLE` e DELETE
> só `OLD TABLE`.
>
> ⚠⚠ **`fat_orcado.atualizado_em` NUNCA ERA ATUALIZADO** (consertado na `v3_173`): default `now()`
> e nenhum caminho de escrita a enviava no `update` — uma coluna chamada "atualizado_em" que só
> sabia a hora do INSERT (`formulario_valor` já tinha o gatilho de touch; esta não). O merge
> depende dela, e o gatilho é **só no UPDATE**, para o semear não pagar nada.
>
> ⚠⚠ **O merge grava o que o cenário MEXEU, nunca "o que difere".** `copiar_versao` cria a versão
> e semeia na mesma transação, então a célula semeada nasce com `atualizado_em = criado_em`, e
> `atualizado_em > criado_em` quer dizer "mexida depois do semear". O teste ingênuo devolve a
> célula errada: se a controladoria ajustou março da baseline depois do semear, março *difere* sem
> que o cenário o tenha tocado — e "o que difere" o devolveria ao valor antigo, apagando o ajuste
> em silêncio. Além disso o merge só escreve **linha aprovada** e **origem `MANUAL`**, apaga o que
> o cenário zerou **só se já existia no semear**, e **reporta sem deixar de gravar** dois casos:
> caiu sobre mudança posterior da controladoria, e caiu sobre valor gerado (que a próxima
> aplicação de posto/formulário regrava). `p_simular` é o **default** — a tela simula, não libera.

> ⚠ **A baseline SE MOVE, e o desenho não previa (`v3_176`).** Em 2027 ela estava em construção
> quando o primeiro cenário ia nascer. O **merge** não quebra — ele grava o que o cenário mexeu,
> nunca o que difere. O que quebra é **o Δ que o aprovador lê**: a célula que a área não tocou
> guarda o valor do dia do semear, então mudança da controladoria passa a aparecer como proposta
> de *reverter*, e ainda entra em `cenario_orcado_diff` exigindo veredito.
> **`ressincronizar_cenario`** traz da baseline só o que a área **não** tocou (atualiza, inclui o
> que nasceu depois, tira o que sumiu), preserva a proposta e **zera o veredito das linhas
> afetadas** — o ✓ anterior era sobre outro número (regra da v3_166).
> ⚠ Ela exigiu corrigir o gatilho de touch: ele carimbava `atualizado_em` **sempre**, então não
> havia como devolver a célula ao estado "veio do semear". Hoje só carimba quando o comando não
> escreveu a coluna — que é o padrão de todo touch e o que faltava.
> **`excluir_cenario`** é a saída grosseira: já funcionava por cascata e **sem guarda**, pela tela
> de Cadastros, ao lado da baseline — a linha errada ali leva 24 mil células. Agora recusa
> baseline, recusa cenário já liberado e exige o código digitado. Na tela ela vem **depois** de
> Ressincronizar, porque excluir perde o trabalho da área e a outra o preserva.
>
> ⚠⚠ **Ausência só é proposta de APAGAR em cenário semeado (`v3_175`).** O merge trata "célula na
> baseline sem par no cenário" como pedido de exclusão — certo, porque o drill **apaga a linha de
> fato** ao limpar a célula (`.delete()`, não `valor = null`). Mas desmarcar *Copiar o orçado*
> cria o cenário vazio, e aí **toda** célula manual de linha aprovada ficaria sem par: a baseline
> inteira daquela linha ia embora por um checkbox. Hoje `semeado_em` registra a cópia e a
> exclusão só é inferida quando ela existe — cenário vazio é **só aditivo**.
> ⚠ **É a mesma razão pela qual o semear ignora o filtro da tela** (pergunta certa do Ricardo ao
> criar o primeiro cenário, com o CSC filtrado): copiar só o recorte de quem cria faria toda
> célula fora dele parecer proposta de exclusão. O cenário é a **versão inteira**; quem vê e
> edita o quê é o escopo de acesso, que já vale no RLS por versão.
>
> ⚠⚠ **A autoridade de aprovar existia na FUNÇÃO e faltava na TABELA (`v3_174`).** Achado ao
> conferir a v3_172, e valia para os **postos desde a v3_165**: `pode_aprovar_cenario()` existe, as
> RPCs a chamam, e as tabelas aceitavam escrita direta de qualquer `member` pela API — um `PATCH`
> em `posto_versao` com `{"aprovado": true}` passava, porque a policy de escrita só exige
> `pode_escrever()`. O comentário da v3_165 dizia que sem a função "o controle vira teatro"; a
> função foi escrita e a porta ficou aberta do lado de fora. **ACS-02 de novo: `pg_proc`
> confirmava que a autoridade existia, e só o GRANT mostrou que ela não valia.**
> Fecham por caminhos diferentes porque as tabelas são diferentes: `orcado_veredito` **só** guarda
> veredito e nada legítimo a escreve direto, então some a escrita inteira (resta `SELECT`);
> `posto_versao` guarda a proposta **e** o veredito na mesma linha, e a proposta é escrita pela
> grade — logo o corte é **por coluna**, concedida **por regra** (lição da v3_148). `DELETE` fica:
> abandonar a decisão é ato de quem propõe. Prova em `prova_veredito_fechado.sql`, que confere
> também que a **proposta continua passando** — controle que impede o trabalho legítimo volta
> desligado amanhã.
> ⚠ **Ao criar tabela nova cujo valor seja uma DECISÃO** (aprovação, liberação, travamento), a
> RPC que a escreve não basta: conferir o `GRANT` da tabela no mesmo passo.

> **Split do editor (F1):** `RelatorioEditorPage` recebe a prop `mode ∈ consulta | orcar | estrutura`. É **um componente só** com três experiências — `consulta` (só leitura), `orcar` (edita só o orçado; realizado nunca é digitado, vem do ERP) e `estrutura` (edita a árvore/fórmulas, sem meses/visões/filtros). Não são três páginas separadas.

Páginas **não roteadas** (legado, manter cautela antes de reusar): `orcamento/OrcamentoPage.tsx`, `templates/TemplatePage.tsx`, `templates/TemplateEditorPage.tsx`, `lancamentos/LancamentosPage.tsx`. (`/dre` → `DrePage` está roteada mas é legado.)

## Modelo de dados (Supabase — linhagem v3)

Todas as tabelas têm `tenant_id` e RLS. Base SQL em `schema_v2.sql`; evoluções em `schema_v3_*.sql` (migrations numeradas até a 046+). Não há um `schema_atual.sql` consolidado nesta pasta — o estado vivo é a soma das migrations. Migrations recentes relevantes: `v3_044` (owner nos presets/`dashboard_card`), `v3_045` (escopo `VER`/`ORCAR` + `negados` em `user_acesso_regra`), `v3_046` (`user_acesso_funcao` — override de capacidade por usuário).

### Organização / dimensões fixas
- **`empresa`** — **agrupador / visão**, não é o CNPJ. Ex.: "Unidade Rio Preto". Usada para separar resultados por unidade de negócio.
- **`filial`** — o **CNPJ real do ERP TOTVS** (`empresa_id` FK → empresa). É o grão verdadeiro do dado. Várias filiais (CNPJs distintos) podem apontar para a mesma `empresa` (ex.: filiais `2107` e `2005` → "Rio Preto"). No TOTVS a filial é dimensão obrigatória.
- **`centro_custo`** — hierárquico (`pai_id`).

> **Atenção ao grão (filial × empresa):** como toda filial pertence a uma empresa, `empresa_id` é derivável de `filial_id`. Hoje `filial_id` é **nullable** nas tabelas de fato (relaxado na migration `v2_003` para permitir lançamento consolidado), com uniques usando `NULLS NOT DISTINCT` ou sentinela `COALESCE`. Riscos conhecidos: dupla contagem por mistura de grão (linha consolidada com `filial=NULL` convivendo com linhas por filial) e ausência de FK composta `(empresa_id, filial_id)`. Decisão pendente: tornar `filial_id NOT NULL` (ao menos no realizado, que sempre vem do ERP com filial) e tratar consolidação por view/soma. Ver memória do projeto.

### Plano de contas (multi-ERP)
- **`plano_contas`** — plano de contas por ERP (resolve colisão de códigos entre ERPs). `empresa` aponta para um plano.
- **`conta_contabil`** — conta do razão (`plano_id`). Origem do realizado.
- **`conta_orcamentaria`** — (renomeada de `linha_orcamentaria`) plano de contas orçamentário. Funciona como **chave-mestre** (`id`/`codigo`/`descricao`/`natureza`) que ancora o fato (`fat_orcado`/`fat_realizado` agregam por `linha_orc_id` → master) e a amarração (`conta_linha`). **Atenção:** as colunas `tipo_linha` e `pai_id` (hierarquia) do master são **vestigiais** — nenhum engine/RPC as consome; a estrutura/analítica-sintética que monta a DRE vive em `relatorio_linha`, por relatório. O cadastro em Cadastros → Estrutura foi **achatado** (lista por código, sem árvore nem tipo); as colunas continuam no banco só por compatibilidade.

### Estrutura de relatório (o "coração" — DRE/Balanço gerencial)
- **`categoria_relatorio`** — agrupa relatórios.
- **`relatorio`** — um relatório gerencial (uma DRE, um Balanço…). `categoria_id`.
- **`relatorio_linha`** — linhas hierárquicas do relatório (`relatorio_id`, `pai_id`, `ordem`, `nivel`). `tipo_linha ∈ ANALITICA | FORMULA | INDICADOR`; `expressao` guarda a fórmula (ex.: `=[P00001]*[P00002]`, `=ANTERIOR()`); `natureza ∈ RECEITA | DESPESA | NEUTRO`. **Substituiu** o antigo par `template`/`linha_template`.
- **`conta_linha`** — **amarração**: mapeia `conta_id` (conta contábil) → `linha_id` (linha de relatório). É o que resolve o realizado do ERP para as linhas da DRE (tela `/amarracao`).

### Orçamentação por formulário (drivers)
- **`formulario`**, **`formulario_linha`** (hierárquico, com `expressao`/`natureza`), **`formulario_valor`** — captura orçado por direcionadores (ex.: quantidade × preço × índice, fórmulas tipo `=ANTERIOR()*1,05`). Linhas de formulário podem alimentar `fat_orcado` (ver `origem_formulario_linha_id`).

### Tabelas de fato
- **`fat_orcado`** — ⚠ **`linha_id` é a `conta_orcamentaria` (o MASTER), não `relatorio_linha`** —
  este documento dizia o contrário e a correção custou uma tela que somava por id de linha de
  relatório e vinha **toda vazia, sem erro nenhum**, porque os dois lados são `uuid` e não casam.
  A ponte é `relatorio_linha.linha_orc_id`. Orçado por `versao_id` × `linha_id` × `empresa_id` × `filial_id` × `cc_id` × `ano`/`mes`. Tem `valor` **ou** `expressao` (célula calculada). `dims jsonb` para dimensões opcionais do tenant (funcionário, verba, projeto…). `origem ∈ MANUAL | FORMULARIO`. Unique por `(versao, linha, empresa, COALESCE(filial), COALESCE(cc), ano, mes, dims::text)`.
- **`fat_realizado`** — razão do ERP (fluxo/movimentação, com sinal). `conta_id`, `linha_id` (nullable — resolvida via `conta_linha` na consulta), `empresa_id`, `filial_id`, `cc_id`, `ano`/`mes`, `valor`, `dims`. `origem ∈ ERP | MANUAL | IMPORT`. Importado em lotes (`lote`/`sublote`).
- **`fat_saldo`** — balancete mensal do ERP (saldo final/estoque por conta/empresa/**filial**/ano/mês). O **Balanço** lê isto direto; a **DRE** usa `fat_realizado` (fluxo).

### Versões, dimensões, BI e operação
- **`versao_orcamento`** — versões/cenários de orçamento (ex.: `BASELINE_2026`).
- **`view_config`** — configuração de visão por relatório/formulário.
- **`dimensao`** / **`dimensao_valor`** + `dims jsonb` nos fatos — cubo de dimensões configuráveis.
- **`lote_contabil`** / **`lote_ignorado`** — controle de cargas do realizado (importação por lote, exclusão/ignorar lotes).
- **`dashboard_card`** — cards configuráveis dos dashboards.
- **snapshots** (`relatorio_snapshot`, RPCs `criar_snapshot`/`restaurar_snapshot`) — congelar estados.
- **`indice_economico`** / **`indice_valor`** — índices de correção.
- **Acesso**: `tenant`, `user_tenant` (papel `admin`/`member`/`viewer`), `user_acesso_regra` (escopo de dados por dimensão — colunas `escopo ∈ VER|ORCAR`, `valor_ids` = permitidos, `negados`), `user_acesso_funcao` (override de capacidade por usuário), `grupo_empresarial`. Ver seção **Permissões (F2)**.

### Agregação (RPC, no banco)
`relatorio_orcado_agg`, `relatorio_realizado_agg`, `relatorio_saldo_agg` e variantes `_anual`/`_empresa` consolidam os fatos por linha/empresa/período para alimentar relatórios e dashboards. `refresh_realizado_mensal` materializa o realizado.

> **Índice do agregado (v3_123):** a agregação do orçado dependia de `idx_fat_orcado_agg_cov` — chave `(tenant, versao, empresa, ano, mes, linha)` + `INCLUDE (valor, val_m2..m5, filial, cc, expressao)` — para virar **Index Only Scan**. Sem ele o planner pega o `uq_fat_orcado` (83 MB), o **único outro índice com `linha_id`**, cuja chave tem `filial`/`cc` no meio justo onde a consulta não filtra: o scan vira milhares de descidas na árvore (194 mil buffers para 53 mil linhas, 770 ms contra 16 ms). Ao mexer no predicado dessas RPCs, conferir se o índice ainda cobre todas as colunas — e rodar `VACUUM (ANALYZE) fat_orcado` depois de carga grande, senão o index-only ainda vai ao heap.
>
> **Ao medir, o `EXPLAIN` engana duas vezes:** o trabalho do nó é o **intervalo** do `actual time` (`fim − início`), não o total — um diagnóstico que monta parâmetros com `array_agg(DISTINCT …)` cria InitPlans que varrem a tabela e inflam o total; e `ANY((SELECT array_agg(...)))` sem cast `::uuid[]`/`::int[]` é lido como subconsulta e nem roda.

> **Preset compartilhado: duas camadas de recorte (v3_153, nov/2026).** Com 14 presets
> compartilhados, quem entra para validar a própria área recebia quatorze cartões.
> **1. O preset herda o escopo do RELATÓRIO que abre** — `relatorioDoCard()` em `escopoDados.ts`
> tira o id de `filtros.relId` (dashboards) ou da rota `/relatorios/<id>` (presets de relatório),
> e `filtrarCardsPorEscopo()` aplica a dimensão `relatorio` que já existe no cadastro de acesso.
> Quem não vê o Balanço não vê atalho para ele. Preset sem relatório identificável **passa**:
> recorta-se o que se sabe estar fora, nunca por suposição do que está dentro.
> **2. Compartilhamento dirigido a PESSOAS** — `dashboard_card_acesso`, semântica **aditiva**:
> sem linhas = comportamento antigo (owner nulo = todos · owner preenchido = só o dono); com
> linhas = dono + listados, e "todos" deixa de valer. Os cards existentes não mudam até alguém
> restringir um. ⚠ A visibilidade está na **política de `dashboard_card`**, não só na tela —
> esconder no frontend deixaria o preset, e os filtros que contam que áreas existem, a um
> `select` de distância (lição da ACS-02).
> ⚠ No hub, "Compartilhados" é `owner_id !== uid`, **não** `!owner_id`: card de outra pessoa
> dirigido a mim tem dono, e com o teste antigo não cairia em lista nenhuma e sumiria.
>
> ⚠ **Política que lê outra tabela com política pode RECURSAR** (v3_154). A escrita em
> `dashboard_card_acesso` perguntava "sou dono?" lendo `dashboard_card`, cuja leitura pergunta
> "é dirigido a mim?" lendo `dashboard_card_acesso`: *infinite recursion detected*. **Não é
> preciso que o ciclo se feche — basta a reentrada.** A saída é tirar uma ponta do RLS:
> `eh_dono_card()` é `SECURITY DEFINER`, responde o mesmo e não reentra. Vale para qualquer par
> de tabelas cujas políticas se consultem.
>
> ⚠ **Derivar a visibilidade dos filtros do preset NÃO funciona aqui** — era a ideia inicial e os
> dados a desmentiram: nenhum dos 14 filtra CC (`ccSel` vazio em todos); eles usam `empresaSel` e
> `areaSel`. O que separa "DRE Serviços" de "DRE Comercial" é a área, não o centro de custo.

> **Dados do ERP virou um item com pills (nov/2026).** Realizado, Saldos (BP) e Amarração
> ocupavam um **grupo inteiro** na lateral — três linhas permanentes para telas do mesmo assunto,
> em que quem orça não entra todo dia. Viraram um item em **Base**, com `pages/erp/ErpPills.tsx`
> no mesmo padrão de Posto de trabalho (passo sem capacidade some e a numeração se refaz sem
> buraco). ⚠ O item usa **`capAny`** no `NavItem`: aparece se a pessoa alcança **qualquer** das
> três e aponta para a **primeira que ela alcança** — destino fixo mandaria quem só tem Amarração
> para uma tela negada. As rotas não mudaram, então links antigos seguem valendo.
> Também saíram os itens **"em breve"** (e o mecanismo `soon` junto): promessa no menu é ruído em
> toda sessão, e o roadmap vive aqui, que é onde se decide o que vem depois.

> **Cadastros: trilho vertical, não abas (nov/2026).** Eram 16 abas horizontais com rolagem — e
> rolagem esconde. A orientação de padrão é consistente: acima de 7-8, vai para navegação
> vertical; agrupar reduz o primeiro nível a algo escaneável. Ficaram **6 grupos de no máximo 4**
> (Organização · Plano de contas · Pessoas e folha · Orçamento · Moeda · Operação), com a
> **contagem de registros** ao lado de cada nome — dá contexto antes de entrar e vira diagnóstico
> de graça (`count: 'exact', head: true`, 13 chamadas sem trazer linha; falha em silêncio, porque
> derrubar a tela por causa de um enfeite seria desproporcional).
> A aba virou **rota** (`/cadastros/:aba`) e é **lembrada** (`useLocalPref`): antes vivia só em
> memória, então sair de Cargos e voltar caía em Empresas, e não havia link direto. A URL manda
> sobre a memória. Abaixo de 860px o trilho vira um `<select>` agrupado.
> ⚠ **Conta contábil tem teto de render (300).** O plano da Bolívia tem 1.304 contas; desenhar
> tudo trava a aba e ninguém lê a milésima linha. O rodapé diz quantas ficaram de fora — corte
> silencioso é pior que lentidão.

## Permissões (F2)

> **ACS-02 fechado no banco (nov/2026) — `v3_129` a `v3_132`.** O escopo de dados deixou de
> existir só no frontend. Políticas de RLS em `fat_orcado`, `fat_realizado`, `fat_folha`, `posto`
> (empresa+filial+CC) e `fat_saldo`, `fat_apontamento` (empresa+filial — **não têm `cc_id`**, logo
> o Balanço não é recortável por centro de custo). **Leitura e escrita são políticas separadas**:
> `authenticated` tem `GRANT ALL`, então com a policy antiga `FOR ALL` um `viewer` apagava o
> orçado pela API.
>
> **Três armadilhas que custaram uma migration cada, nesta ordem:**
> 1. **`FOR ALL` inclui `SELECT`**, e políticas permissivas se combinam com **OU** — a policy de
>    escrita vazava a leitura inteira para `admin`/`member`. Escrita vai por comando
>    (`INSERT`/`UPDATE`/`DELETE`), nunca `FOR ALL`.
> 2. **Função `STABLE` em policy roda POR LINHA.** Só vira avaliação única dentro de subconsulta
>    escalar: `(SELECT escopo_cc())`. Sem isso, 1,07 mi de linhas × função PL/pgSQL = timeout.
> 3. **`ANY((SELECT f()))` precisa de `::uuid[]`** — sem o cast é lido como a forma de subconsulta
>    do `ANY` e dá `operator does not exist: uuid = uuid[]`.
>
> **Negar por padrão (`v3_132`):** ausência de linha em `user_acesso_regra` = **não vê nada**;
> linha com lista vazia = vê tudo (escolha explícita). `useUserAccess` segue o mesmo critério,
> mas **só nas dimensões que o banco enforça** — `DIMS_NO_BANCO`, exportada de
> `lib/escopoDados.ts` e importada pelo hook, **uma fonte só**: divergir ali enche o combo e
> esvazia a tela, que é o pior dos dois mundos, porque parece defeito.
> `AvisoSemAcesso` em `App.tsx` explica a tela vazia.
> Admin ignora todo o escopo, então sempre há quem conserte; o conserto é abrir
> **Configurações → acesso** e salvar.
>
> **`versao` entrou no RLS (`v3_137`)** — `fat_orcado` e `fat_folha` recortam por versão, provado
> por personificação em `prova_rls_escopo.sql`: quem marcou 1 versão enxerga 1, quem tem regra
> vazia enxerga 3. Fecha o furo de selecionar uma *visão* que aponta para versão fora do escopo —
> antes a tela escondia o combo e a consulta entregava o dado.
>
> ⚠ **`relatorio` fica de fora, de propósito:** `relatorio_linha` é lida para montar qualquer DRE,
> então RLS nela trancaria o próprio motor de cálculo. É recorte só de tela (`escopoDados.ts`) —
> limitação estrutural, não pendência. Dimensões configuráveis (`dimensao`/`dims jsonb`) idem.


> ⚠⚠ **Em política de RLS, pergunte se NULO é lacuna ou SIGNIFICADO — por tabela** (v3_163).
> O predicado `col IS NOT NULL AND col = ANY(escopo)` existe para que linha sem dimensão não
> escape do recorte: certo para empresa, filial e CC, onde nulo é cadastro faltando. Em
> `fat_folha.versao_id` nulo **é o significado** — `tipo='REALIZADO'` é o que a folha pagou, e o
> pago não pertence a versão de orçamento. Medido: REALIZADO 22.698 linhas, **todas** sem versão;
> ORCADO 42.827, **todas** com. Resultado: desde a v3_137, **todo não-admin com regra de versão
> via a tela Folha realizada vazia**, e a conciliação junto. Hoje nulo passa no recorte de versão
> (só nessa tabela; em `fat_orcado` a exigência fica, porque lá orçado sem versão seria defeito).
> Valia para `INSERT` também: importar folha realizada era **recusado** para quem tivesse recorte
> de versão.
> **Ficou meses invisível porque só morde quem não é admin, e quem desenvolve é admin.** Achado
> no primeiro uso real de um usuário de teste sem privilégio — que é para isso que ele serve.

> **Escopo por ASSUNTO: `PESSOAS` (v3_162, nov/2026).** O escopo era por *pessoa*; faltava por
> *assunto*. Uma gestora de RH orça o próprio centro de custo e responde pelas pessoas da empresa
> inteira — indizível com um recorte só. Terceiro valor em `user_acesso_regra.escopo`, alcançando
> `posto`, `posto_v`, `fat_folha` e `fat_apontamento`; `fat_orcado`/`fat_realizado`/`fat_saldo`
> ficam no `VER`/`ORCAR`, que é a separação inteira.
>
> ⚠ **A regra de convivência é o ponto.** Pela v3_132 ausência de regra NEGA — se `PESSOAS`
> seguisse isso, todo usuário perderia os postos no deploy. Então **sem regra `PESSOAS`, cai no
> `VER`** (leitura) e no `ORCAR→VER` (escrita), copiando o que `escopo_dim_edit` já fazia.
> `canSeePessoas`/`canEditPessoas` no hook repetem o critério — divergir faria a tela mostrar uma
> coisa e a consulta devolver outra.
>
> ⚠ **O interruptor em Configurações não é enfeite.** A tela grava TODAS as dimensões a cada
> salvamento; sem o *"Escopo próprio para Pessoas"*, salvar o cadastro de qualquer um criaria uma
> regra `PESSOAS` de lista vazia — que significa **vê a empresa inteira**. Desligar **apaga** as
> linhas, porque herdar exige que a linha não exista.
>
> ⚠ **A aba *Contábil × Folha* fica no `VER`, de propósito.** Ela compara folha contra o razão, e
> o razão é `VER`. Alargar só o lado da folha traria o contábil vazio e **tudo apareceria como
> divergência** — pior que não mostrar. *Orçado × Folha* e *Apontamento × Folha* vão em `PESSOAS`.
>
> **Salário mascarado chega NULO, e `Number(null) || 0` é ZERO.** A grade dizia "R$ 0" para quem
> não pode ver — num papel de conferência, número errado é pior que número ausente. Hoje mostra
> *sem permissão*, gateado por `can('posto.salario')`. A aresta estava anotada aqui e levou meses
> para ser consertada, porque só dói quando alguém confere.
>
> **Posto saiu de Orçamentação para o grupo `Pessoas`** — gente não é método de orçar. `Aplicar o
> quadro no orçado` **não** vem junto: é `posto.aplicar`, chave própria e só admin por padrão.
> A coordenadora de RH é **`viewer`**: a estrutura é mantida no **ERP** e o Planorc confere, então
> ela vê a empresa toda (regra `PESSOAS` vazia) e grava nada, porque `pode_escrever()` a barra
> antes. Ver salário exige liberar `posto.salario` — padrão de viewer é negado.

Três camadas independentes. A **1ª (dados) é enforçada no banco** desde `v3_129..137`; as outras
duas são de tela, e é o certo — dizem o que *aparece*, não o que a consulta entrega:

**1. Dados — quem vê/orça quais dimensões.** Hook `useUserAccess` (`hooks/useUserAccess.ts`) lê `user_acesso_regra` e expõe `canSee` (escopo `VER`), `canEdit` (escopo `ORCAR`, com fallback para `VER`), `filterList`/`filterEdit`, e `isAdmin`. Regra por dimensão = allow-list (`valor_ids`; vazio = tudo) menos `negados`. **Admin ignora todo o escopo de dados** (`canSee`/`canEdit` retornam `true`). O escopo é cruzado com os filtros de tela por interseção (`aplicaEscopo` no editor; `escopoFiltro` em `DashFiltros.tsx`, usado por todos os dashboards). Linhas INDICADOR com `filtro_escopo` próprio também são cruzadas com o escopo do usuário (no editor e em `lib/relatorioTotais.ts`, via `ccPermitidos`).

**2. Funções/menus — o que aparece.** Catálogo único em `lib/capacidades.ts` (`CAPACIDADES`: `key`, `label`, `categoria ∈ Funções|Menu`, `padrao` por papel). Hook `useCapacidades` resolve `can(key)` com precedência **override por usuário (`user_acesso_funcao`) > padrão do papel > liberado (se não catalogado)**. Menus (`NAV_GROUPS` em `App.tsx`) e botões de ação (`orcar`/`estrutura`) são gateados por `can(...)`. Blindagem: admin nunca perde `menu.config`.

**3. Funcionalidades do tenant — o que EXISTE nesta instalação.** Pergunta diferente das duas acima, que são sobre *quem pode*. `lib/tenantFlags.ts` lê colunas booleanas de `tenant` (hoje `usa_apontamento`) e o hook `useTenantFlags()` as entrega com cache em `localStorage`, para a navegação não piscar esperando um boolean. Ligadas em **Configurações → Funcionalidades**; mexer na flag exige `limparCacheFlags()`. Use para mecanismo específico de um negócio — apontar hora em projeto, p.ex. — que em outro tenant não deve nem aparecer como tela vazia.

> **Apagar o orçado de uma versão (v3_127).** A ação mais destrutiva do produto vive no menu *Importar Baseline* da tela de Orçar, atrás da capacidade `orcado.apagar` (só admin por padrão). Três proteções, e a ordem importa: `orcado_resumo_versao` mostra o que vai sumir (linhas, origens, valor, escopos) **antes** de qualquer confirmação; quem confirma digita o **código da versão**; e `apagar_orcado_versao` **confere a confirmação no servidor** e recusa versão `bloqueada`. Não é senha de propósito — senha prova identidade, e o risco aqui não é um estranho clicando, é a pessoa certa apagando a versão errada. Apaga `fat_orcado` da versão/ano (todas as origens) e os carimbos de `formulario_aplicacao`; **não** apaga `formulario_valor` — quem recomeça as cargas quer reaplicar os formulários, não redigitá-los.

> **Reabrir decisão recusada (v3_167/168).** Responder e reenviar são o **mesmo ato**: o editor da
> justificativa abre na própria linha, pré-preenchido, e o reenvio grava os dois juntos. Separá-los
> obrigava a sair do comparativo — onde está a recusa que se quer responder.
> **Dois lados, dois campos:** `nota` é de quem PROPÕE, `aprov_nota` de quem APROVA. É o que faz a
> linha contar a conversa inteira. ⚠ A v3_168 **derruba** a assinatura de 1 argumento antes de
> criar a de 2: duas conviventes tornariam a RPC ambígua no PostgREST, e o erro só apareceria no
> clique.
> **Reabrir decisão recusada (v3_167, detalhe).** A resposta a uma recusa costuma ser **texto, não número**
> — "justifique" se responde com justificativa, nenhum campo de decisão muda, o gatilho da v3_166
> não dispara, e o veredito ficaria recusado para sempre. `reabrir_decisao` devolve o posto a
> **pendente**, e só isso: a justificativa segue no campo `nota` do cenário, que já existia.
> ⚠ **Mantém `aprov_nota`** — apagar a recusa ao reabrir faria o aprovador reler a decisão sem
> lembrar o que ele mesmo objetou, que é justamente o que precisa conferir se foi respondido.
> Quem reabre é quem **propõe**: a guarda é `pode_escrever()`, não `pode_aprovar_cenario()`.
> **Duas saídas de uma recusa, as duas na linha do comparativo:** *reenviar para análise* e
> *voltar ao cadastro* (abandona a decisão, some em decisão já aprovada — aquilo virou acordo).

> ⚠ **O carimbo certifica o conjunto de VEREDITOS, não só as decisões (v3_170).** A v3_166 fez o
> gatilho ignorar mudanças de veredito — resolveu o auto-derrubamento e abriu outro furo, visível
> só **depois** do fechamento: trocar um ✓ por ✗ mudava o que seria aplicado e o carimbo continuava
> afirmando que aquele conjunto fora revisado. Hoje **qualquer** alteração em `posto_versao` o
> derruba. Não recria o problema da v3_166 porque o gatilho **só escreve quando já existe carimbo**
> — durante a revisão não há, então os cliques de veredito não custam nada.
> **Fechar é carimbo, não cadeado:** não congela, não aplica, só libera o `Aplicar`. Quem congela
> é `bloqueada`, manual e à parte. A tela diz isso no selo de aprovado.

> ⚠ **Recusada NÃO trava o fechamento (v3_169) — corrige a v3_166.** Recusar **é decidir**: decidir
> que o posto fica como está no cadastro. O que trava é o **pendente**, que significa "ninguém
> olhou". Exigir unanimidade bloqueava o aprovador à espera de ação de terceiro, e perder o
> registro (abandonando a decisão) apagaria a prova de que a área pediu e foi recusada.
> **Consequência que o frontend HONRA:** o `Aplicar` resolve a sobreposição **só onde
> `aprovado = true`** — posto recusado entra com o valor do cadastro. Usar o quadro resolvido ali
> gravaria o número do cenário ignorando a recusa, com o carimbo dizendo que foi revisado.
> ⚠ **Divergência deliberada e declarada em três lugares:** a grade mostra a **proposta** (é onde
> se trabalha) e marca `RECUSADA` na linha; o comparativo mostra o veredito; a confirmação do
> Aplicar diz quantas ficam de fora. Mudar um desses sem os outros reabre o furo.

> **Veredito por posto, carimbo por cenário (v3_166).** O veredito por posto é a **conversa** — o
> aprovador diz o que não passa e por quê, e o motivo aparece na linha, junto do que foi proposto.
> O carimbo da versão continua sendo a **trava**. ⚠ `aprovar_cenario` exige **unanimidade**: sem
> isso daria para carimbar um cenário contendo decisão recusada, e ela seria aplicada igual.
> Recusar **exige motivo** (a tela barra o vazio) e **não apaga a decisão** — quem propôs precisa
> ver o que propôs ao lado do "não". Decisão alterada **zera o veredito**, porque o "não" anterior
> era sobre outro número.
>
> ⚠⚠ **O gatilho da v3_165 disparava no próprio ato de aprovar.** Ele derrubava o carimbo a cada
> `UPDATE` em `posto_versao`, e gravar o veredito É um `UPDATE` — não doía enquanto a aprovação
> morava só em `versao_orcamento`, e passou a doer no instante em que os vereditos foram para a
> mesma tabela. Hoje os dois gatilhos comparam **só os campos de decisão** (`ROW() IS DISTINCT
> FROM ROW()`): veredito mudando não é decisão mudando. **Ao acrescentar campo em
> `CAMPOS_CENARIO`, acrescentar nas duas listas do SQL** — esquecer faz a alteração daquele campo
> deixar de derrubar a aprovação, em silêncio.

> **Aprovação do cenário de postos (v3_165, nov/2026).** O gerente decide, o controller aprova, e
> só então o `Aplicar no orçado` libera. Aprovação é da **versão**, não do posto: o cenário é a
> unidade de negociação, e aprovar linha a linha passaria ao aprovador a responsabilidade de quem
> propôs. Colunas em `versao_orcamento` (`aprovado_em`/`_por`/`aprovacao_nota`) + RPCs
> `aprovar_cenario`/`reprovar_cenario`.
>
> ⚠ **Qualquer alteração nas decisões DERRUBA o carimbo, por GATILHO em `posto_versao`.** Regra de
> tela não serviria: a tela não é a única coisa que escreve ali. Sem isso, aprova-se e altera-se
> depois, e o carimbo fica mentindo — defeito que ninguém descobre até precisar. O gatilho só
> escreve quando havia carimbo, então um lote de 50 decisões vira uma escrita, e anota o motivo
> na própria nota.
>
> ⚠ **`pode_aprovar_cenario()` é a SEGUNDA repetição deliberada do catálogo em SQL** (a primeira
> é `pode_ver_folha()`). Autoridade tem de valer no banco: sem ela um `member` aprova o próprio
> cenário pela API e o controle vira teatro. Custo aceito e declarado — mudar o padrão em
> `lib/capacidades.ts` exige mudar o SQL junto.
>
> ⚠ **Aprovação desatualizada NÃO é detectada, de propósito.** `posto` não tem carimbo de
> atualização, e mesmo com um: a importação mensal do RH toca os 570 postos e marcaria toda
> aprovação como velha, inclusive de quem o cenário não decide. Alarme que toca sempre ninguém lê.
> `aprovado_em` fica à vista e quem lê julga. `bloqueada` segue sendo outra coisa: aprovar
> **libera** o Aplicar, bloquear **congela** a versão depois.

> **Cadastro × cenário: dois privilégios, não um (nov/2026).** `posto.cadastro.editar` (só admin)
> e `posto.cenario.decidir` (admin+member) separam mexer no **mestre** de decidir na **versão**.
> ⚠ **O argumento mais forte não é governança:** o cadastro vem do ERP e a próxima importação do
> RH **sobrescreve** o que foi editado à mão — o upsert regrava `salario_base` do arquivo. Quem
> mexe no mestre sem saber disso faz um trabalho que evapora sem aviso. O cenário é o lugar certo:
> isolado por versão, comparável com o cadastro e sujeito a aprovação.
> `editavel` passou a depender do **modo** (`modoCenario ? podeCenario : podeCadastro`), com
> `orcar` como piso dos dois. O toggle **não some** para quem não pode editar o cadastro — ver o
> mestre é legítimo; uma faixa laranja explica que é leitura e por quê, porque grade travada sem
> explicação parece defeito. `+ Posto / vaga` segue `posto.cadastro.editar`: posto novo nasce no
> mestre. `cenario.aprovar` está no catálogo e ainda não tem uso — a aprovação é a fase 4.
>
> **O comparativo cadastro × cenário** (`CenarioDiffModal`) mostra, por posto, o que muda e o
> custo **dos dois lados pelo motor** — nunca `salário × 12`: corte em maio carrega aviso prévio,
> 13º, férias proporcionais e multa de FGTS. Agrupa por **tipo de decisão**, não por CC. O
> **escopo sai do dado, não do filtro** (filtro é vista e daria outro PDF amanhã) e diz o que foi
> **tocado**, não o que poderia ter sido. `posto_versao.nota` é a justificativa e aparece na linha.

> **Posto de trabalho — granularidade (out/2026).** Tudo ali morava sob `orcar`, então dar o
> quadro a um diretor de área dava junto o **Aplicar** (que *substitui* todo o `fat_orcado` de
> origem `POSTO` da versão) e os importadores. Quebrado em quatro funções — `posto.aplicar`,
> `posto.importar`, `folha.importar`, `apontamento.importar` (esta liberada por padrão) — e sete
> menus, um por pill (`menu.postos.quadro|memoria|folha|apontamento|conciliacao|estrutura|rateio`).
> Pill sem capacidade some da navegação e **a numeração se refaz sem buraco** (`PostosPills.tsx`
> cruza a capacidade com a flag do tenant: a flag diz se a funcionalidade *existe*, a capacidade
> se *esta pessoa* pode). As rotas de `/postos/*` são as primeiras com trava: `<Exige cap>` em
> `App.tsx` — esconder a pill tira o caminho, não a porta.

> **`versao` e `relatorio` são dimensões de DADOS** (out/2026), fixas em Configurações →
> acesso ao lado de empresa/filial/CC. Respondem "em QUAL orçamento" e "QUAL DRE" — perguntas
> diferentes da capacidade ("pode orçar?", "pode abrir relatórios?"). Sem migration:
> `useUserAccess` já era genérico e `user_acesso_regra.dimensao` é texto.
>
> **O recorte vive em `lib/escopoDados.ts`, não nas telas.** Versão é lida em ~15 telas e
> relatório em ~16; filtrar uma a uma é o jeito de esquecer uma, e **uma tela sem filtro anula o
> controle inteiro, em silêncio**. Use `carregarVersoes(cols, {ativa, ordem})` e
> `carregarRelatorios(cols, ordem)` — fazem a consulta **e** o recorte, então não existe caminho
> que devolva a lista crua. `filtrarPorEscopo(dim, rows)` serve para quem já tem as linhas (a
> lista de relatórios, o editor abrindo por id da URL). Regras lidas **uma vez por sessão**;
> salvar o acesso chama `limparCacheEscopo()`. Admin ignora o escopo, como no hook.
>
> ⚠ **O cache de regras tem PRAZO (60 s) e revalida ao focar a aba** — e isso é correção, não
> otimização. `limparCacheEscopo()` só alcança o navegador de **quem edita**; quem TEVE o acesso
> alterado seguia com as regras antigas em memória até recarregar, então *tirar* acesso não
> surtia efeito numa sessão longa. Vale para `relatorio`, que é recorte de tela; empresa, filial,
> CC e versão são barradas por RLS, onde cache nenhum alcança.
>
> ⚠ Ao escrever tela nova que liste versão ou relatório, chamar o helper — `supabase.from(
> 'versao_orcamento')` direto volta a furar o escopo.

> **Dashboards: uma capacidade por dashboard** (`dash.acompanhamento|orcamento|anual|balanco|
> executivo|cagr|indicadores`), além de `menu.dashboards` para a seção. Antes era tudo-ou-nada —
> a *Orçamento — análise*, que mostra o orçamento do grupo antes de aprovar, ia junto com o
> acompanhamento do mês. O hub filtra os cards e as rotas têm `<Exige cap>`.

> **Categoria `Importações` (out/2026).** Toda carga de arquivo do app tem chave própria —
> `orcado.importar` / `.full` / `.excel`, `realizado.importar`, `saldos.importar`,
> `amarracao.importar`, `cadastros.importar`, `relatorio.importar`, `formulario.importar`,
> `posto.importar`, `folha.importar`, `apontamento.importar`, `fornecedor.importar`,
> `verba.importar`. Importação é a classe de ação mais perigosa do produto: não é editar uma
> célula, é trocar uma base, e várias apagam antes de gravar. Por isso **nenhuma** herda de
> `orcar`/`estrutura` e o padrão é fechado para `member`, exceto onde a carga é rotina de quem
> usa a tela (apontamento, valores de formulário). Importação nova entra **nesta categoria**,
> nunca em `Funções`. O modo *substituir* do Baseline tem chave separada do *adicionar* e é
> conferido também dentro do `doImport` — o menu pode ser contornado, a função é que escreve.

> **Papel × capacidade — a divisão (nov/2026).** O **papel** é a trava grossa (lê × escreve) e
> vive no banco: `pode_escrever()` = `admin` ou `member`. A **capacidade** é o ajuste fino *entre*
> quem escreve (qual tela, qual importação) e vive no frontend. **Capacidade de escrita liberada a
> um `viewer` não tem efeito** — o banco barra pelo papel. Quem preenche orçamento é `member`;
> `viewer` só consulta.
>
> Não fazer o banco decidir por capacidade: os padrões por papel moram em `lib/capacidades.ts`, e
> só os *overrides* estão em `user_acesso_funcao`. Replicar o catálogo em SQL criaria duas fontes
> de verdade que divergem no primeiro deploy.
>
> Três guardas para o descasamento não voltar: telas de edição cruzam `can(...)` **e**
> `acesso.podeEscrever` (espelho de `pode_escrever()`, **mesmo nome de propósito**); o catálogo
> marca `escrita: true` e Configurações avisa ao liberá-las a um viewer; e **toda gravação confere
> o retorno** — ver abaixo.
>
> ⚠ **`UPDATE` barrado por RLS NÃO dá erro.** A política filtra as linhas, o comando afeta zero e
> volta sucesso — só o `INSERT` levanta `42501`. Em `OrcarGradePage` toda escrita passa por
> `gravar()`, que exige `.select('id')` e trata **erro E zero-linhas** como falha. Antes nenhum
> retorno era conferido: a célula *sempre* parecia salva, e falha de rede ou violação de unique
> sumiam no refresh. O RLS não criou isso, só o tornou frequente.

> **Segundo fator (TOTP) — nov/2026.** `lib/mfa.ts` + `/seguranca` (inscrição, sem capacidade
> gateando: é a conta da própria pessoa) + `MfaDesafio` entre a senha e o app.
> **Quem decide se o desafio aparece é o AAL, não um papel:** `nextLevel === 'aal2' && currentLevel
> === 'aal1'` só é verdade para quem TEM fator verificado e ainda não o provou. Por isso a adoção
> pode ser voluntária sem ser frouxa — **não existe estado em que alguém inscreva o fator e siga
> entrando só com a senha**, que seria a aparência da proteção sem a proteção.
>
> ⚠ **O Supabase NÃO tem códigos de recuperação.** Eu afirmei que teria e estava errado. A
> recuperação real é **um segundo fator inscrito**; sem ele, perder o aparelho exige alguém com
> acesso ao console para remover o fator. A tela diz isso **antes** de inscrever.
>
> ⚠ **É porta de INTERFACE, não de dado.** A verificação do AAL **falha aberta** de propósito: erro
> de rede trancaria todo mundo fora, o que é pior que a janela sem desafio. O enforcement real
> seria exigir `auth.jwt()->>'aal' = 'aal2'` nas políticas das tabelas sensíveis — enquanto isso
> não existir, isto protege a navegação, e quem tiver o token ainda alcança a API em `aal1`.
>
> ⚠ Fator **não verificado** (quem abre o QR e fecha a aba) não protege nada e aparece na lista
> como se protegesse — `limparPendentes()` os remove antes de cada nova inscrição.
> ⚠ `unenroll` exige sessão em **aal2**: só quem acabou de provar o fator pode removê-lo. É o que
> impede uma sessão roubada em aal1 de desativar a proteção.

> **Padrão de `member` = diretor de área (nov/2026).** Nasce **fechado** em importação de
> apontamento/formulário, metas de indicador, menus de Orçamento, Formulários, Realizado, Saldos,
> Amarração, Cadastros e nos dashboards Comparativo anual / CAGR / Indicadores — libera-se por
> pessoa. Virar um padrão **muda o acesso de quem herdava, em silêncio**, então a `v3_138`
> materializa o acesso de hoje como override explícito antes de o padrão novo valer, e a `v3_139`
> (⚠ **só depois do deploy**) limpa as negações que viraram redundantes. A ordem é o ponto: o
> padrão vive no código e só existe quando o build sobe.

> **Papel efetivo = `papelMaisAlto()`, nunca `linhas[0].role`.** Sete pontos liam a primeira
> linha de `user_tenant` sem `ORDER BY`. Hoje cada pessoa tem uma só — mas nada garantia isso:
> faltava o unique por (tenant, pessoa), que a `v3_140` criou. Sem ele, trocar papel por `INSERT`
> em vez de `UPDATE` deixa duas linhas e qual vale passa a ser escolha do plano, enquanto o banco
> responde pelo mais privilegiado (`eh_admin()` é `EXISTS`) — discordância sem erro. `papelMaisAlto()`
> (`lib/capacidades.ts`) devolve o mais privilegiado, concordando com o banco por construção.
> Ausência de linha devolve `''`: quem chama decide, e todos decidem pelo menor acesso.
>
> ⚠ **Ao diagnosticar usuário, usar o e-mail COMPLETO.** `split_part(email,'@',1)` fez eu ler três
> contas de teste (`@gmail`/`@totvs`/`@icloud`, `user_id` distintos) como três linhas de uma
> pessoa só, e desenhar uma migration para apagar duplicata que não existia. O domínio era a
> única coisa que distinguia, e foi o que o encurtamento cortou.

> **Coluna, não só linha — salário (v3_142).** RLS limita LINHA; quem alcançava um posto lia
> `salario_base` pela API, qualquer que fosse a tela (as telas já se comportavam: 5 das 7 leituras
> pediam colunas explícitas, nenhuma pedia salário — o furo era a API). Fechado em duas peças:
> `GRANT SELECT` em `posto` passou a ser **por coluna**, sem `salario_base`/`reajuste_pct`/
> `reajuste_valor` (pedir direto agora **dá erro**, não devolve nulo em silêncio), e a view
> **`posto_v`** devolve as três mascaradas por `pode_ver_folha()`. **Leitura vai na view, escrita
> na tabela** — 9 × `from('posto_v').select` contra 7 × `from('posto').update|insert|upsert|
> delete`. Gravar não é ler, então escrever salário continua podendo.
>
> ⚠ **Coluna nova em `posto` tem DUAS pontas:** o `GRANT` de coluna (o que pode ser lido na
> tabela) e a view (o que as telas enxergam). A `v3_148` resolveu a primeira **por regra** — nega
> as três de remuneração e concede o resto, re-executável, porque a lista fixa da `v3_143` fazia
> toda coluna nova cair no balde dos negados por omissão (foi o que houve com `area_func_id`:
> ninguém negou, ela só não estava na lista).
>
> ⚠ **Toda coluna nova em `posto` entra em `posto_v` na MESMA migration** — com `CREATE OR REPLACE
> VIEW` e a coluna **no fim**, que é o único jeito de acrescentar mantendo os GRANTs (sem janela
> sem permissão, sem reconceder). A `v3_146` esqueceu, e como as sete telas leem a view, o
> Organograma pedia coluna inexistente: consulta falhava, `Promise.all` rejeitava e a tela ficava
> em "Carregando…" **para sempre** com tudo zerado. Consertado na `v3_147` — e a carga agora tem
> `try/finally`, porque erro que vira tela travada é o mais caro de diagnosticar: não diz nada.
>
> ⚠ A view roda como **dono** (sem `security_invoker`) por necessidade: com ele herdaria o
> privilégio de coluna do chamador e mascararia para todo mundo, admin incluído. Rodando como
> dono o RLS de `posto` não se aplica, então **o recorte de linha vai explícito no `WHERE` da
> view**, com as mesmas funções da política (`escopo_empresa/filial/cc`). Repete-se a forma do
> predicado, não a regra — ela continua só em `escopo_dim()`. Ao mexer no escopo, conferir os dois.
> A view lista colunas uma a uma: coluna nova em `posto` não aparece nela e a tela quebra à vista,
> o que é melhor que vazar calada.
>
> ⚠ **Única repetição deliberada do catálogo:** o `padrao` de `posto.salario` (admin ✓, member ✓,
> viewer ✗) está também em `pode_ver_folha()`, em SQL. Decisão de segurança tem de ser tomada no
> banco, e o catálogo do frontend não existe lá. Mudar num lugar = mudar no outro.
>
> ⚠ **Aresta conhecida:** quem for *negado* e abrir Quadro/Memória vê salário e custo como zero,
> não como "sem permissão" — o servidor mascara, a tela não sabe. Só acontece com negação
> explícita (o padrão de member vê), mas o conserto é gatear a coluna com `can('posto.salario')`.

> ⚠ **As regras de rateio ficam com escopo só de TENANT, de propósito** (`posto_rateio`,
> `rateio_regra`, `rateio_destino`). É o que faz o **"onde caiu"** da conciliação funcionar: a aba
> Orçado × Folha monta o quadro de `fat_folha` (CC de **origem** do posto) + a cascata de rateio
> calculada no cliente, então o destino vem da **regra**, não de uma linha de fato sentada no CC
> da outra área. Quem alcança o posto vê o custo sair e vê para onde foi, mesmo em CC alheio —
> que é justamente o que se precisa mostrar ("o custo do meu posto caiu na área X").
> Recortar essas três por **destino** quebraria a função. Se um dia for preciso esconder regra
> alheia, recortar pela **origem**: lê a regra quem alcança o posto de origem.
> (Medido: Andrea, com 80 CCs, lê as 117 regras e os 25 destinos. O que encolhe é só a coluna
> *Orçado · DRE*, que lê `fat_orcado` no destino — e para isso a tela já tem `pctEscopo()`.)

> **Cadastros de fundação são admin (v3_141).** `tenant`, `dimensao`, `dimensao_config`,
> `grupo_empresarial` aceitavam escrita de `member` — folga da v3_135. Escrever em `dimensao` é
> criar dimensão de **dados**, isto é, definir por onde o escopo recorta: é mexer no controle de
> acesso. Leitura não mudou.

> **Cargos — lista única em Cadastros → Cargos** (v3_144 criou a árvore; nov/2026 a desfez).
> ⚠ **Deixou de ser árvore.** A hierarquia nasceu quando não existia estrutura funcional: amarrar
> cargo a cargo era o único jeito de dar contexto. Com `area_funcional` (v3_146), a árvore de
> cargos virou um **segundo lugar para dizer a mesma coisa**. O que sobra de carreira é `nivel`,
> comparável entre ramos e sem depender de alguém montar árvore. `cargo.pai_id` fica vestigial.
> ⚠ **Havia DUAS telas sobre `cargo`** — esta e uma lista em *Postos → Estrutura*, com código e
> salário de referência. Criei a segunda sem procurar a primeira. Ficou a de Cadastros (cargo é
> organização); a de Estrutura, que é sobre folha, perdeu a aba e cedeu os campos.
> **Código editável**, porque é o elo com o ERP.
>
> ⚠⚠ **A área/subárea do cargo é conceito DESTE tenant, não do produto** (decisão do dono da
> estrutura, nov/2026). Genericamente, **cargo tem um código e pronto** — o fato de cada step ser
> na prática outro cargo é particularidade desta instalação do plano. Por isso **não há cadastro
> de área/subárea** e não deve haver: `cargo_familia` fica como tabela semeada, editável por SQL
> se precisar. Ao generalizar para outros segmentos, este é o ponto a rever — não assumir que
> todo tenant decompõe código de cargo em área·subárea·sequencial.
>
> **Cargo é por (SUBÁREA, nome) — v3_161.** `AUXILIAR ADMINISTRATIVO` era UM cargo com 24 códigos
> de SEIS subáreas, e misturar áreas num cargo é não-conforme. O código do ERP lê-se **A·S·NNN**
> (`12073` = área 1, subárea 2, sequencial 073), então ele já carregava o eixo que faltava: 178 →
> **224 cargos**, `cargo.area_cod`/`sub_cod` derivados do step, nomes editáveis em `cargo_familia`
> (7 áreas + 30 subáreas; os de **44** e **47** são chute meu). `cargo.codigo` deixou de ser o slug
> do nome e virou o **código real do step 1** — nada o referencia além da tela, e um identificador
> que não concilia com nada não valia preservar.
> **`UNIQUE (cargo_id, step)` voltou**: a v3_158 teve de abandoná-la porque um cargo tinha seis
> step 1. Que a restrição natural volte a caber é o sinal de que o grão está certo — o banco já
> dizia isso e eu afrouxei a restrição em vez de ouvir.
>
> ⚠ **Área funcional NÃO serve de eixo do cargo** — medido, não suposto: o bloco 42 hospeda gente
> em SERVIÇOS DE IMPLANTAÇÃO (84), SUPORTE TÉCNICO (5) e FÁBRICA DE SOFTWARE (1). Área funcional é
> **onde a pessoa trabalha**, subárea é **a que família o cargo pertence**.
>
> ⚠⚠ **NOME DEIXOU DE IDENTIFICAR CARGO.** São quatro `ESPECIALISTA DE DESENVOLVIMENTO DE SOFTWARE
> I`. Todo `Map` por nome fica com o **último** e atribui subárea ao acaso, **sem erro** — mesma
> classe do `ON CONFLICT` da v3_157. Corrigido no importador do Quadro: só nomes **únicos** entram
> no mapa; nome ambíguo preserva o cargo que o posto já tem e, não havendo, fica **sem cargo** e é
> contado no resumo da importação. Todo seletor de cargo mostra a subárea ao lado. **Ao escrever
> código novo que resolva cargo por nome, não resolve — precisa do código do ERP.**
> Dos 59 postos em cargo multi-subárea, 32 foram repontados pelo mapa empírico (área funcional →
> subárea, tirado dos cargos de subárea única) e **27 ficaram onde estavam**, nomeados no SELECT da
> migration: quase todos de DESENVOLVIMENTO DE SOFTWARE, que existe em 42, 43, 44 e 71. Some quando
> `posto.cargo_step_id` vier do ERP.

> **STEP é filho do cargo (v3_158/160)** — `cargo_step` (cargo, step, código) e
> `posto.cargo_step_id` para a amarração por pessoa, que virá do ERP. A v3_156 descartou o STEP
> como "faixa salarial, não cargo": certo sobre o que ele É, **errado sobre o que ele SERVE** — o
> código completo é o identificador do ERP, e sem ele não há conciliação. Foi por isso que os
> códigos de `cargo` saíram do nome: não havia código de cargo para adotar.
>
> ⚠ **O código é (ÁREA, CARGO, STEP)** — descoberto por `duplicate key`, porque eu o havia lido
> como (cargo, step) e criado `UNIQUE (cargo_id, step)`. `AUXILIAR ADMINISTRATIVO` tem **seis**
> step 1, um por área (12 adm/fin · 13 contábil · 14 gente · 45 · 46 · 47); 26 dos 190 cargos se
> repetem assim. O prefixo de dois dígitos não é enfeite do número, é a terceira dimensão. A
> chave natural é o `codigo` inteiro; `grupo` é coluna **gerada** dele e ainda não liga a
> `area_funcional`.
>
> ⚠ **Carga por nome entre duas abas da MESMA planilha não casa** — 128 dos 923 ficaram de fora
> na primeira tentativa, por gênero (`ADMINISTRATIVA`×`ADMINISTRATIVO`), preposição (`ANALISTA
> FACILITIES`×`ANALISTA DE FACILITIES`), plural, espaço comido e typo. A v3_160 resolve com
> **tabela de alias explícita, em dois baldes** — `GRAFIA` (18 nomes, sem concorrente) e `APROX`
> (3, julgamento declarado e reversível pelos 12 códigos). Ficam 879 de 923. **Os 44 restantes
> são ausência real** (`ANALISTA FINANCEIRO I/II/III`, `ESPECIALISTA DE QUALIDADE I/II/III`…) e
> **não viram cargo inventado**: ou o plano os aposentou, ou esqueceu de listá-los — quem
> responde é o RH, junto com 17 códigos que a planilha repete em dois cargos (o rabo do bloco 43
> foi numerado com prefixo 44). **Código ambíguo não entra**: `ON CONFLICT DO NOTHING` faria o
> primeiro vencer em silêncio, que é a armadilha da v3_157 de novo.
>
> ⚠ O catálogo tem **223 cargos para 190 nomes de step** — duplicata interna herdada da planilha
> (`CONTAS A **A** RECEBER` × `A RECEBER`; `COORDENADOR` × `COORDENADORA ... E RMO`). Não fundida
> de propósito: cargo com gente apontada só o dono da estrutura funde, e Cadastros → Cargos edita.

> **Orçar por NATUREZA (nov/2026).** ⚠ Na grade, quem manda é **`orderedVis`** — a lista
> RENDERIZADA — e `active.r` indexa **ela**. Todo ponto que resolve a célula ativa (digitar,
> Delete, colar, navegar) usa `orderedVis`; com a lista filtrada e o índice da outra, digitar
> gravaria **na linha errada**, em silêncio e no dado. `folhas` só alimenta o contador. Quem orça só despesa não vê as receitas na grade:
> `orcar.receita` · `orcar.despesa` · `orcar.neutra` no catálogo (sem migration — `user_acesso_funcao`
> guarda por chave de texto). Por natureza e **não por linha**: são 169 linhas numa DRE, e `natEff()`
> na grade já devolve a natureza **herdada**, então esconder "Receitas" leva as filhas junto.
> **Neutra tem chave própria** porque esconder por omissão de cadastro faria sumir linha que
> ninguém decidiu esconder. A grade diz quantas linhas ficaram ocultas — sem isso ela parece
> incompleta e quem confere o total procura defeito.
> ⚠ **É conveniência de tela, não controle:** o banco restringe o orçado por empresa, filial e CC,
> **não por linha**. Para virar controle seria um predicado em `fat_orcado` juntando
> `relatorio_linha.natureza`, com prova por personificação — trabalho separado.
>
> ⚠ A **dimensão de dados não serve** para isto: `user_acesso_regra.valor_ids` é `uuid[]`, e
> natureza é um enum de três valores, não uma tabela.

> ⚠ **`ON CONFLICT` não sabe de `origem`** (v3_157). O upsert do plano de cargos usa `codigo`,
> derivado do NOME — e três cargos do plano têm nome idêntico a cargos vindos da folha. O INSERT
> caiu em cima deles e os atualizou, deixando-os com `origem = 'ERP'` e nível preenchido. **Upsert
> por chave derivada de nome atravessa a fronteira entre conjuntos que o modelo trata como
> separados, e em silêncio** — conflito resolvido não é erro. Ao carregar catálogo que convive com
> outro, conferir depois quem mudou de lado.

> **Convenção — incluir uma funcionalidade nova no controle de acesso:** (1) adicionar uma entrada em `CAPACIDADES` (chave + label + categoria + `padrao` por papel); (2) gatear o elemento na tela com `can('chave')`. A seção "Funções e menus" em Configurações itera o catálogo, então a nova capacidade aparece sozinha com os controles Herdar/Liberar/Negar; `user_acesso_funcao` guarda por chave de texto, sem migration. Enquanto não catalogada, `can()` devolve `true` (não esconde nada por engano). Dimensão de **dados** nova é outro caminho: cadastro de `dimensao`.

## Legado em transição

O frontend ainda referencia `fat_lancamento` (~10 pontos) — tabela fato única do modelo antigo (`tipo_lancamento ORCADO|REALIZADO`, ligada a `plano_orcamentario`). A linhagem v3 migrou para `fat_orcado` + `fat_realizado` + `fat_saldo`. Ao mexer em fluxo de dados, preferir as tabelas v3 e tratar referências a `fat_lancamento`/`plano_orcamentario` como legado a ser migrado, não como padrão.

## Redesign de UX v2 (implementado na branch `feat/v2-dark`)

O que era proposta já está **no código** (branch `feat/v2-dark`, ainda não mergeada na `main` no momento desta nota):

- **Tema dark/light** parametrizado por CSS variables com toggle persistido (ver Stack).
- **Navegação por modo de interação** (`NAV_GROUPS` em `App.tsx`): separa **escrita** (Orçar, importação, estrutura) de **leitura** (Dashboards, Consultar, análises). O **realizado sempre vem do ERP**, nunca é digitado.
- **Split do editor (F1)** por `mode` (consulta/orcar/estrutura) — ver seção de Rotas.
- **Permissões (F2)** — ver seção própria.

Os protótipos HTML standalone na raiz (`planorc-v2-*.html`) foram o rascunho dessa direção e podem ser tratados como histórico.

**Roadmap — fases:**
- **F3** — grade de Orçar dedicada (empresa×filial×CC, escopo ORÇAR) + Importar Baseline. ✅ **concluída**.
- **F4** — workflow / governança / aprovação. 🟢 **feita para o orçamento** (`v3_171..173`, nov/2026) — ver *Cenário de orçamento* abaixo. Falta: alçada por valor e mais de um aprovador.
- **F5** — métodos avançados de orçamentação: formulário de **drivers** (qtd×preço, `=ANTERIOR()`), posto de trabalho/folha, presets. 🟡 *(em andamento — jul/2026)*. Já feito: `formulario`/`formulario_linha`/`formulario_valor` (v3_049); editor split por `mode ∈ estrutura | preencher` (`/formularios/:id` e `/formularios/:id/estrutura`, mesmo padrão da F1 — a **estrutura é genérica**, sem empresa/filial; o preenchimento/Aplicar é por versão×empresa×filial); **premissas globais** (v3_050: `formulario_valor.empresa_id NULL` = vale para todas as empresas; grade da empresa herda em itálico e sobrescreve por célula, vazio volta a herdar; opção 🌐 no seletor de empresa; Aplicar desabilitado no escopo global).

  **Receitas (out/2026)** — três metas, **um formulário cada**, porque as metas comerciais são separadas: `MRR` (recorrente), `VENDAS_NR` (não recorrente), `SERVICO`. Estrutura, decisões e armadilhas em `docs/DESIGN_receitas.md`; os prompts do estudo em `docs/PROMPT_estudo_baseline_mrr.md` e `docs/PROMPT_estudo_nr_servicos.md`. A fronteira que evita contagem dupla: a conta **10201 recebe TODA comissão recorrente**, qualquer que seja a origem, então o `BASE` do MRR já contém a carteira histórica inteira — e o formulário de NR **não tem estoque inicial de propósito**, projetando só a mensalidade nova do ano. Dois vícios do motor moldaram o desenho: **`ANTERIOR()` não atravessa o ano** (daí os drivers `METADEZ` no MRR e `PARCANT` no NR, que o estudo preenche mês a mês) e **célula vazia vale ZERO, não "neutro"** (daí todo percentual precisar dos 12 meses, e o `NP = SE([NPARC] < 1; 6; [NPARC])` que impede um escopo esquecido de zerar a receita NR inteira).
- **F5.2 — Posto de trabalho (folha)** — planejado e aprovado (jul/2026): design completo em `docs/DESIGN_posto_trabalho.md` (grão híbrido funcionário+vaga, verba reestruturada como catálogo de regras, sindicato/dissídio, motor record-based, rateio CSC genérico, fat_folha paralela p/ conciliação; fases P1–P5) + mockup visual aprovado em `planorc-v2-postos-mockup.html`. 🟡 *(em andamento)*. **Conciliação da folha** (`/postos/conciliacao`, três abas): *Orçado × Folha* por posto, *Contábil × Folha* (v3_080/081/082) — que separa o razão em **três origens**: (1) o que a contabilização da folha lançou (histórico começa com código de verba da competência — concilia verba a verba e abre por funcionário), (2) **PJ** (v3_083: chega por NF em lote de contas a pagar; `posto_fornecedor` é o de-para participante×fornecedor, e `planorc_pj_casa` liga o histórico `<FORNECEDOR>-<PARTICIPANTE>` à matrícula — importado em Estrutura → Fornecedores (PJ), direto do export RD0×SA2, sem conversor), (3) o resíduo, que pede justificativa escrita (`conciliacao_folha_nota`). Tolerância configurável por tenant. **Referência do relatório** (`lib/refRelatorio.ts`): as duas abas compartilham um seletor de **relatório + linhas** (lembrado em `localStorage`); a seleção recorta o universo (masters da subárvore → contas) e traz a coluna "no relatório", calculada por `totaisRelatorio` — a mesma função do editor e dos Indicadores, com rollup de `SOMAR_FILHOS` e fórmulas. Os números não batem com a folha de propósito: o orçado da DRE está rateado no CC de destino e o da folha na origem do posto; o realizado da DRE vem do razão. ⚠ A extração do histórico é regra desta instalação do Protheus e está isolada em `planorc_pj_frag()` para ser trocada por perfil depois.
  **Apontamento × Folha** (3ª aba, v3_112/113/114 — set/2026): confere em **HORAS**, não em reais (o extrato traz o custo/hora congelado e a folha usa o valor-hora do cadastro, `RetValHr` — duas taxas para a mesma hora). `fat_apontamento` é alimentada pela pill `Apontamento` (`/postos/apontamento`), que lê o *Extrato de Horas Apontadas* .xlsx **direto, sem conversor Python** (a competência sai do nome do arquivo). Cada linha guarda **duas competências** (a do apontamento e a `comp_folha` correspondente, com a defasagem PJ +1 / CLT +2 já resolvida) e **duas filiais** (a do posto, que é a da chave, e a do projeto em `filial_apont_id`). Quem entra na conferência sai da **função** do extrato (`apontamento_funcao`, descoberta na importação), com `posto.recebe_hora` como exceção por pessoa — precedência `posto → função → confere`. O bloco **CLT não concilia**: mostra a *proporção* de horas por empresa · filial · CC, que é o rateio que hoje é feito à mão após a integração contábil. Correções medidas (o que NÃO funciona e por quê) em `docs/DESIGN_conciliacao_apontamento.md`, seção final.
  **Afastamento** (v3_117 — out/2026): janela no posto (`afast_ini_*`/`afast_fim_*`, fim nulo = sem previsão de retorno). O motor **zera a base** no mês afastado e a cascata inteira cai sozinha (INSS, FGTS, 13º, férias são % sobre ela); sobram os `VALOR_FIXO`, e aí a regra é verba a verba — `verba_folha.mantem_afastado`. O import do RH deriva de `RA_SITFOLH` (código de **uma letra**: `A`=afastado, `F`=férias **fica fora**, `D`=demitido) e grava o retorno em aberto, que é o pior caso, de propósito. Escopo estreito: maternidade (efeito de caixa) e absenteísmo (premissa %) **não** entram. Ver `docs/DESIGN_posto_trabalho.md` § Afastamento.
  **Rescisão / demissão futura** (v3_118 — out/2026): a *data* sempre foi a vigência fim (`fim_ano`/`fim_mes`); o que entrou é o **custo do evento** no mês da saída. Três `tipo_calculo` novos (`RESC_AVISO` aviso prévio 30d+3d/ano teto 90; `RESC_PROP` proporcional aos meses do ano — 13º fator 1, férias 1,3333; `RESC_SALDO_FGTS` multa 40% estimada por salário × tempo de casa, 3,2%), todos valendo **zero** fora do mês do fim — por isso o FGTS sobre as rescisórias é um `PCT_VERBA` comum. Recorte por **regime** (só `BR-CLT`). No mês da saída o motor roda a cascata **duas vezes** para que o "custo/mês" fique com o recorrente e a rescisão saia em `rescisaoAno`/categoria `Rescisão`. `posto.admissao` é coluna própria (a vigência é editável). ⚠ **dupla contagem** se o catálogo já provisionar rescisão mensalmente — a migration avisa. Ver `docs/DESIGN_posto_trabalho.md` § Rescisão.
  **Identidade da pessoa = CPF (v3_149).** `funcionario.cpf` (único por tenant, **`SELECT`
  revogado** — é chave, não informação de tela) + `posto.funcionario_id`, que existia e nunca fora
  preenchido. Casamento em **duas passadas**, no banco, via `importar_funcionarios(jsonb, simular)`:
  1ª por **(filial, matrícula)** — a matrícula **sozinha não identifica**, a `900008` pertence a 7
  CPFs; `filial.codigo` = código da empresa + da filial com zero à esquerda ("20"+"01"=`2001`);
  2ª por **nome**, só nos que sobraram (série `8000xx` é pró-labore e não existe no export do RH),
  e **só para nome que aponta a um único CPF** — errar identidade é pior que deixar em branco.
  Resultado medido: 561 de 570 postos casam por chave, 6 por nome, 1 sem (não está na relação).
  **`p_simular`** dá a prévia: importação sem prévia é importação que se descobre pelo estrago.
  ⚠ **Nenhum CPF em arquivo**: a carga vai da planilha ao banco pelo navegador. Gerar um `.sql`
  com os 513 CPFs os poria no histórico do git — era o caminho que eu ia tomar e foi barrado.

  ⚠ **`REVOKE` de coluna só vale depois de tirar o `GRANT` de tabela** (v3_150). A `v3_149`
  revogou `SELECT (cpf)` e **não teve efeito**: o `GRANT SELECT` da tabela inteira continuava
  cobrindo todas as colunas. Mesmo mecanismo que a `v3_143` já tratara em `posto` — revogar a
  tabela e conceder coluna a coluna. Consequência: **`select('*')` em `funcionario` passa a
  falhar**, e isso é recurso — quebra visível em vez de CPF vazando calado para quem pedisse tudo.

  ⚠ **`funcionario.matricula` é vestigial** (v3_151): tinha `NOT NULL` **e** `UNIQUE (tenant,
  matricula)`, isto é, a tabela acreditava que matrícula identifica pessoa. São **513 pessoas para
  238 matrículas** — preencher faria 275 colidirem. Quem identifica é o CPF; a matrícula é vínculo
  pessoa × empresa e vive em `posto`. O `NOT NULL` caiu; o `UNIQUE` fica (nulos são distintos
  entre si) para o cadastro manual. **Nada novo deve escrever nessa coluna.**

  **Importação como padrão, não como caso (nov/2026).** O alvo é receber de **mais de um ERP**, e
  nome de coluna é a primeira coisa que muda entre eles. Três partes separadas:
  `lerPlanilha` (`lib/planilha.ts`, ao lado do `downloadSheet` — ler e escrever planilha moram
  juntos) **não sabe do conteúdo**; **`lib/importPerfil.ts`** declara por campo os *nomes aceitos*
  (tolerante a acento/caixa/espaço, intolerante ao resto: adivinhar coluna é como se importa a
  errada); e o **casamento vai no banco**, atômico. Trocar de ERP = acrescentar um perfil, não
  editar tela. Convenção da instalação (concatenar empresa+filial) mora **no perfil**, perto das
  colunas, para o banco seguir genérico — mesma razão de `planorc_pj_frag()`.

  **Situação do posto** — regra e seletor em **`lib/situacaoPosto.tsx`**, usados por *Postos*,
  *Memória de cálculo* e *Organograma*. ⚠⚠ **Não usar em tela por COMPETÊNCIA** (Folha realizada,
  Apontamento, Conciliação): `sit_folha` é um retrato do momento da importação, sobrescrito na
  carga seguinte, e aplicá-lo lá esconderia linhas de **março** com a situação de **outubro** —
  quem foi demitido em outubro trabalhou e foi pago em março, e o número mudaria sem dizer por
  quê. Para servir ali, a situação teria de ser **histórica por competência**: outro desenho.
  O aviso está no topo do arquivo, para que "completar" as telas que faltam não introduza o erro.

  **A fonte da situação vem da FOLHA, com dedução como reserva** (v3_152). `RA_SITFOLH` — uma letra:
  `D` demitido, `A` afastado, `F` férias, vazio trabalhando — chega na *Relação de Funcionários* e
  a importação carimba em **`posto.sit_folha`**. Guardada no **posto** e não na pessoa porque a
  situação é por **vínculo**: a relação traz uma linha por (empresa, filial, matrícula), e alguém
  pode estar demitido numa empresa do grupo e ativo em outra. `situacaoPosto()` prefere a fonte e
  cai na janela `afast_ini`/`afast_fim` quando não há (posto criado à mão, ou que nunca casou).
  ⚠ **Férias não é dedutível** de nada — era por isso que afastado passava por ativo antes. O
  filtro da tela é por situação (4 estados, multi-seleção), não mais "só ativos / com demitidos".

  ⚠ **Headcount não é matrícula distinta** (`lib/pessoaChave.ts`, nov/2026). `matricula` é por
  **empresa**: quem tem pró-labore em mais de uma empresa do grupo ganha uma em cada, e contar
  matrícula transformava 2 diretores em "7 pessoas" no CC 411. O identificador certo seria
  `posto.funcionario_id` — que **existe e está vazio em 100% dos postos** — ou CPF, que não vem no
  export do RH. Então a chave é o **nome** normalizado, com fallback para matrícula e, por último,
  o id do posto (vaga conta sozinha). ⚠ O custo é que **homônimo conta como uma pessoa só** — erro
  menor e na direção oposta ao de inflar, mas erro; o conserto real é popular `funcionario_id` na
  importação, e aí a função passa a preferi-lo sem mudar mais nada. Grade e Organograma usam a
  **mesma função** de propósito: dois jeitos de contar gente dão dois números e ninguém sabe qual
  está certo.

  **Editor de árvore compartilhado** — `lib/ArvoreEditavel.tsx`. Nasceu em Cargos e foi extraído
  quando a segunda árvore apareceu (áreas funcionais); a terceira já se vê no horizonte (gestor).
  Sabe montar de `pai_id`, abrir/fechar, arrastar para reparentar, soltar na raiz, renomear no
  lugar e **recusar ciclo pintando o alvo de vermelho antes do drop**. Não sabe o que é cargo ou
  área: isso vem por `colunas`, `prefixo` e callbacks. ⚠ **Seções vivem dentro de UMA instância**
  (`secoes`), não em duas — em Cargos se arrasta *da* seção "folha" *para* a "plano", e duas
  instâncias teriam dois estados de arrasto, com o gesto morrendo na fronteira.
  **Cadastros → Áreas funcionais** edita a árvore do organograma (as 37 da `v3_146`, que até então
  só se mexia por SQL — fiz o motor e a atribuição e esqueci a manutenção). Escrita é **admin**.

  **Hierarquia de gestor — a quarta fonte** (`funcionario.gestor_id`, v3_155 + carga de 03/nov).
  ⚠ **A manutenção veio depois do motor, de novo** — `gestor_id` ficou um mês só com a carga SQL,
  lido num único ponto do frontend e sem nenhuma tela de atribuição; quem tentou corrigir um líder
  mexeu em *área funcional*, que é a que tem o modo Atribuir. Mesmo esquecimento das áreas
  funcionais (motor + atribuição, sem manutenção). Hoje é o **segundo modo do Organograma**
  (`Atribuir gestor`, ao lado de `Atribuir área`) — ali a árvore já está desenhada, então a
  alteração se vê na hora, que é justamente o que faltou para perceber que nada fora gravado.
  Três diferenças do modo de área, e nenhuma é detalhe: grava em **`funcionario`** (gestor é da
  pessoa — uma linha por pessoa, com a coluna *Postos* para a linha única não parecer posto
  faltando); o lote útil é **remanejar um time** (filtro por *gestor atual*), não por CC; e o
  **ciclo é barrado antes de gravar** — o trigger `funcionario_sem_ciclo` continua sendo a rede,
  mas a gravação vai em lotes por gestor e deixar o banco recusar o terceiro depois de os dois
  primeiros passarem é meio salvamento.
  O Organograma ganhou "Gestor (quem reporta a quem)" **sem reescrever nada**: o montador de
  árvore já era genérico e a fonte já era um seletor — era exatamente para isto. 298 de 299 com
  líder; o topo é um só. Entram na árvore apenas quem **tem posto ou lidera alguém**: `funcionario`
  guarda 513 pessoas, incluindo demitidas, e desenhar quem não está no quadro poluiria.
  ⚠ Veio de planilha do RH, por **e-mail** — e a origem traz a mesma pessoa com e-mail diferente
  quando é *líder* e quando é *pessoa* (`rodrigo.brito@` × `oliveira.rodrigo@`; `jp.marinho@` ×
  `joaopaulo.mariinho@gmail`). O conserto resolveu o **apontamento**, nunca o e-mail da pessoa:
  corrigir o cadastro a partir de um erro da origem propaga o erro e apaga o rastro que o RH
  precisa receber de volta.

  **Três estruturas, três perguntas** (nov/2026) — e confundi-las é o erro fácil:
  `centro_custo` = **onde o dinheiro cai** (nível 2 é Base × Novos, nível 3 é produto — recorte
  comercial, 84 nós); `cargo` = **o que a pessoa é** (carreira, `pai_id`+`nivel`, em reestruturação);
  **`area_funcional`** (v3_146) = **onde a pessoa trabalha** — o organograma funcional de out/26,
  37 nós, que não existia. Os dois primeiros se cruzam só em parte e cada um é mais detalhado onde
  o outro é cego: o CC tem 50+ nós de segmentação comercial que o organograma não tem, e o
  organograma separa Financeiro/Contabilidade/Facilities/Jurídico/Adm. de Gente, que no CC estão
  **todos dentro do 111 "Administrativo Geral"** (27 postos numa caixa). Por isso `posto.area_func_id`
  e **não** `centro_custo.area_func_id`: no 111 o CC não determina a área. Dois nomes repetem de
  propósito (DESENVOLVIMENTO em Serviços e TI; PROSPECÇÃO em Comercial e Marketing) — o código
  distingue e a tela mostra o caminho (`areaCaminho`). METODOLOGIA fica em Experiência do Cliente
  (decisão do dono da estrutura, contra o que o desenho mostrava).
  **Atribuição** — modo *Atribuir área* na própria tela: o gesto que resolve a maioria é filtrar por
  CC e aplicar ao lote; o 111 vai um a um. Toda gravação confere o retorno, porque `UPDATE` barrado
  por RLS **não dá erro** — afeta zero linhas e volta sucesso.

  **Organograma do quadro** (`/postos/organograma`, pill 2 — nov/2026): como o quadro se distribui
  pela estrutura, **dimensionado por pessoas**. ⚠ **Não é hierarquia de chefia**: `posto` não tem
  gestor/superior e `cargo` não tem nível, então "quem reporta a quem" não existe no dado *nem dá
  para inferir*. Por isso a **fonte da hierarquia é um seletor**: hoje a árvore de `centro_custo`
  (`pai_id`, real — 79 de 84 CCs com pai, 3 níveis) e, como agrupamento alternativo, os campos
  desnormalizados `area_nome`/`divisao_nome`/`bu_nome` (preenchidos só em parte — o seletor mostra
  quantos). Quando `posto.gestor_posto_id` existir, entra como mais uma opção **sem reescrever a
  tela**: vira cadastro, não código. Dimensionar por **custo** foi recusado de propósito — custo
  depende de `posto.salario` (v3_142), e para quem fosse negado a tela viria com caixas de área
  zero, um gráfico que mente por omissão. Headcount = matrículas distintas (posto sem matrícula é
  vaga e conta sozinho), **mesma definição da grade**, senão os dois números discordam. Postos sem
  CC entram num nó próprio: omiti-los mostraria um quadro menor que o real.
  A aba e a pill só aparecem com `tenant.usa_apontamento` ligado em Configurações → Funcionalidades (`lib/tenantFlags.ts`): apontar hora em projeto é específico de quem opera por projeto.
- **F6** — presets "Meus Relatórios" com `owner_id`. ⬜
- **F8 — Nível de detalhe por usuário — ❌ DESCARTADO (03/nov/2026), não reabrir sem motivo novo.**
  A ideia era uma coluna editorial na linha (`essencial | analítico | apoio`) + preferência no
  cadastro do usuário, para esconder apoio e indicadores de quem só confere a própria área.
  **O produto já resolve:** o botão **Seções** no editor marca/desmarca as linhas de topo (com
  *só esta* por linha), e a escolha **entra no preset**. Com o compartilhamento dirigido da
  `v3_153`, monta-se o preset limpo e compartilha-se com quem precisa — a pessoa abre no recorte
  certo, sem cadastro nenhum. Fazer F8 teria criado uma segunda forma de esconder linha, divergente
  da primeira e com cadastro por pessoa para manter.
  ⚠ Se voltar à mesa, o que muda a conta é **o usuário não ter um preset** e cair na visão cheia;
  a resposta aí é preset padrão por pessoa, não tag na linha.
- **F7 — Cenários** — planejado (out/2026), **não iniciado**: design em `docs/DESIGN_cenarios.md`. Área `/cenarios` (hub em árvore por ano + wizard de nova versão com semente: em branco / copiar versão completa / copiar + realizado até MM/AAAA / importar), ajustes por regra gravados como premissas, marcação de células ≠ origem, tela Comparar (até 4 cenários; resumo / detalhado / só diferenças) e ciclo de vida (promover/merge, arquivar). Schema: só colunas nullable em `versao_orcamento` (`origem_versao_id`, `papel`, `cor`, `inicio_projecao_ano/mes`, `premissas jsonb`) + RPCs `copiar_versao` (estende v3_007 p/ `formulario_valor`, `versao_taxa`, postos), `semear_realizado`, `aplicar_ajuste`. Cenário continua = `versao_orcamento`; nada muda em `fat_orcado`/`view_config`. Fases F7.1–F7.4 no doc. ⬜

**Dívidas técnicas:** hardening de RLS/RPC no banco (F2 hoje é só frontend — segurança mais sensível); grão filial×empresa (`filial_id` nullable, dupla contagem, sem FK composta — empresa é agrupadora, não matriz); legado `fat_lancamento`/`plano_orcamentario` (~10 pontos); colunas vestigiais `tipo_linha`/`pai_id` em `conta_orcamentaria`; artefatos residuais (`frontend/frontend/`, `planorc-v2-*.html`). Pendências da F2: esconder opções fora de escopo nos dropdowns.

## Convenções de código

- **Cor de variação = bom ou ruim, nunca o sinal do número.** Verde/vermelho num Δ é uma
  afirmação semântica, e o sinal sozinho erra metade das linhas: despesa que cai aparece
  negativa e é melhora. O critério sai do **mesmo lugar que a exibição** — `fatorExibicao`
  (`lib/refRelatorio.ts`) devolve `-1` para natureza `DESPESA` (própria ou herdada do pai),
  que é exatamente a linha mostrada com despesa positiva; nela `bom = Δ < 0`, nas demais
  `bom = Δ > 0`. Porque exibição e semântica saem da mesma natureza, o caso que engana se
  resolve sozinho: *Impostos s/ faturamento* aparece **negativo** (não é `DESPESA` na
  estrutura), não inverte, e o vermelho quando o imposto cresce continua certo. **Nunca**
  resolver isso por nome de linha ou lista de exceção — o produto atende segmentos
  diferentes. Exceção deliberada: a **ponte/cascata** usa o **sinal econômico cru** (sem
  `fatorExibicao`), senão uma despesa que cresce vira barra verde e o caminho não fecha.


- Estilos: mistura de objetos `S` inline e classes Tailwind. Seguir o padrão já presente em cada arquivo.
- Sem biblioteca de componentes — tudo à mão.
- Tipos TypeScript locais por arquivo (não há pasta `types/`).
- Sem testes automatizados.
- Dados: `supabase.from(...)` / `supabase.rpc(...)` direto nos componentes (sem React Query).
- **Migration termina em `SELECT`, nunca em `RAISE`.** O SQL Editor roda o script inteiro em
  **uma transação**, e `RAISE EXCEPTION` é erro: uma prova por exceção no fim **desfaz a própria
  migration** — ela roda dentro da transação, exibe o resultado correto, e o `COMMIT` nunca
  acontece. Aconteceu com `v3_133`, `v3_134` e `v3_136`, que reportaram sucesso e não aplicaram
  nada (consolidados em `v3_137`). **Prova vai em arquivo separado** (`prova_*.sql`), rodado
  depois. Ali a exceção é inofensiva — ou é recurso: em `prova_auditoria.sql` o rollback apaga a
  regra de teste e os registros de auditoria juntos. A diferença nunca é a exceção, é **o que mais
  está na transação com ela**. Corolário: ao ver erro no editor, presuma que **nada** foi aplicado.
- **Prova que ESCREVE é um `DO` só, terminando em `RAISE`.** O oposto da regra das migrations, e
  pela mesma razão: ali a exceção desfaz o que se quer manter, aqui ela desfaz o que se quer
  descartar. Um `DO` é **um comando** — a exceção aborta o bloco inteiro e a regra de teste some,
  inclusive quando a prova falha no meio (um `ROLLBACK` no fim do arquivo não roda se o script
  abortar antes). E a mensagem da exceção é **o único canal que o SQL Editor mostra com certeza**:
  `RAISE NOTICE` ele engole, e `SELECT` de tabela temporária criada em comando anterior falha com
  *relation does not exist* — ele **não garante sessão única entre comandos**. Por isso a prova
  sempre "dá erro", e a mensagem começa com `✅ PASSOU` ou `⛔ FALHOU`. Junte todas as falhas numa
  mensagem só: parar na primeira faz descobrir três defeitos em três rodadas.
  ⚠ Asserção de prova afirma o **mínimo** necessário. `prova_escopo_pessoas.sql` exigiu que uma
  dimensão de escopo abrisse tudo e levou 568 de 570 — o sistema estava certo, a asserção errada,
  e meia hora foi gasta investigando o código que funcionava.
- **Verificação mede efeito, não intenção.** `SELECT` sobre `pg_policy` confirma que a política
  existe; não confirma que ela filtra. Conferência de acesso **personifica e conta**:
  `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` — sem trocar de papel, o
  dono das tabelas ignora RLS e toda contagem volta cheia. Padrão em
  `seguranca_passo2_naoregressao.sql`.
- **Paginação obrigatória:** o PostgREST corta em **1000 linhas por chamada, sem erro**. Todo `.select()` numa tabela que cresce com o negócio (fatos `fat_*`, plano de contas `conta_contabil`/`conta_orcamentaria`, junções `posto_verba`/`posto_rateio`, dropdowns de competência distinct) DEVE usar o helper `pageAll()` de `frontend/src/lib/pageAll.ts`. Dispensam: `.single()`/`.maybeSingle()`, `.in(ids.slice(...))` já em lotes, e catálogos naturalmente pequenos (empresa, filial, versão, sindicato). Sintoma de esquecer: "sumiu gente/conta" que só aparece quando a base passa de 1000.

## Como rodar

```bash
# Frontend
cd frontend
npm install
npm run dev   # http://localhost:5173

# Backend (raramente necessário)
cd backend
source .venv/bin/activate
uvicorn main:app --reload
```
