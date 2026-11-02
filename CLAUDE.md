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
| `/realizado` | `RealizadoDadosPage` | dados de realizado (importado do ERP) |
| `/saldos` | `SaldoDadosPage` | saldos/balancete |
| `/amarracao` | `AmarracaoPage` | amarração conta contábil → linha de relatório |
| `/cadastros` · `/cadastros/:aba` | `CadastrosPage` | cadastros (16, em trilho vertical agrupado) |
| `/config` | `ConfiguracoesPage` | configurações (usuários, acesso a dados e capacidades) |
| (login) | `LoginPage` | autenticação |

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
- **`fat_orcado`** — orçado por `versao_id` × `linha_id` (relatorio_linha) × `empresa_id` × `filial_id` × `cc_id` × `ano`/`mes`. Tem `valor` **ou** `expressao` (célula calculada). `dims jsonb` para dimensões opcionais do tenant (funcionário, verba, projeto…). `origem ∈ MANUAL | FORMULARIO`. Unique por `(versao, linha, empresa, COALESCE(filial), COALESCE(cc), ano, mes, dims::text)`.
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


Três camadas independentes. A **1ª (dados) é enforçada no banco** desde `v3_129..137`; as outras
duas são de tela, e é o certo — dizem o que *aparece*, não o que a consulta entrega:

**1. Dados — quem vê/orça quais dimensões.** Hook `useUserAccess` (`hooks/useUserAccess.ts`) lê `user_acesso_regra` e expõe `canSee` (escopo `VER`), `canEdit` (escopo `ORCAR`, com fallback para `VER`), `filterList`/`filterEdit`, e `isAdmin`. Regra por dimensão = allow-list (`valor_ids`; vazio = tudo) menos `negados`. **Admin ignora todo o escopo de dados** (`canSee`/`canEdit` retornam `true`). O escopo é cruzado com os filtros de tela por interseção (`aplicaEscopo` no editor; `escopoFiltro` em `DashFiltros.tsx`, usado por todos os dashboards). Linhas INDICADOR com `filtro_escopo` próprio também são cruzadas com o escopo do usuário (no editor e em `lib/relatorioTotais.ts`, via `ccPermitidos`).

**2. Funções/menus — o que aparece.** Catálogo único em `lib/capacidades.ts` (`CAPACIDADES`: `key`, `label`, `categoria ∈ Funções|Menu`, `padrao` por papel). Hook `useCapacidades` resolve `can(key)` com precedência **override por usuário (`user_acesso_funcao`) > padrão do papel > liberado (se não catalogado)**. Menus (`NAV_GROUPS` em `App.tsx`) e botões de ação (`orcar`/`estrutura`) são gateados por `can(...)`. Blindagem: admin nunca perde `menu.config`.

**3. Funcionalidades do tenant — o que EXISTE nesta instalação.** Pergunta diferente das duas acima, que são sobre *quem pode*. `lib/tenantFlags.ts` lê colunas booleanas de `tenant` (hoje `usa_apontamento`) e o hook `useTenantFlags()` as entrega com cache em `localStorage`, para a navegação não piscar esperando um boolean. Ligadas em **Configurações → Funcionalidades**; mexer na flag exige `limparCacheFlags()`. Use para mecanismo específico de um negócio — apontar hora em projeto, p.ex. — que em outro tenant não deve nem aparecer como tela vazia.

> **Apagar o orçado de uma versão (v3_127).** A ação mais destrutiva do produto vive no menu *Importar Baseline* da tela de Orçar, atrás da capacidade `orcado.apagar` (só admin por padrão). Três proteções, e a ordem importa: `orcado_resumo_versao` mostra o que vai sumir (linhas, origens, valor, escopos) **antes** de qualquer confirmação; quem confirma digita o **código da versão**; e `apagar_orcado_versao` **confere a confirmação no servidor** e recusa versão `bloqueada`. Não é senha de propósito — senha prova identidade, e o risco aqui não é um estranho clicando, é a pessoa certa apagando a versão errada. Apaga `fat_orcado` da versão/ano (todas as origens) e os carimbos de `formulario_aplicacao`; **não** apaga `formulario_valor` — quem recomeça as cargas quer reaplicar os formulários, não redigitá-los.

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

> **Cargos — árvore de carreira (v3_144, Cadastros → Cargos).** `cargo` não tinha tela: nascia do
> import do RH (upsert por código) e só era lido em dropdown. Ganhou `pai_id` + `nivel` e uma aba
> com **arrastar e soltar** (HTML5 nativo, mesmo padrão dos cards do dashboard — sem biblioteca).
> `nivel` é **senioridade comparável entre ramos**, separado da profundidade de propósito: um
> "Analista III" de TI e um do Comercial são o mesmo nível em subárvores diferentes, e é o nível —
> não a profundidade — que torna a futura hierarquia de PESSOAS *conferível* em vez de só
> desenhável.
>
> ⚠ **Ciclo é o único defeito grave:** arrastar o pai para baixo do próprio filho faz a árvore
> virar laço, a tela recursa até travar e consulta recursiva nunca termina. Travado nos **dois
> lados** — a tela recusa no drop (`descendentes()`, e pinta o alvo de vermelho) e a `v3_144` põe
> gatilho no banco, porque a API é outro caminho. Gatilho e não `CHECK`: a verificação sobe a
> árvore, e `CHECK` não enxerga outras linhas. `ON DELETE SET NULL` promove os filhos à raiz em vez
> de apagar a subárvore.
>
> Por que **não** virou pill em Postos: cargo é catálogo, e catálogo mora em Cadastros, ao lado de
> Funcionários e Verbas. A hierarquia de **pessoas** (quando `posto.gestor_posto_id` existir) é o
> contrário — vai como *modo* na própria tela do Organograma, porque a árvore que se olha é a que
> se conserta; tela separada vira duas renderizações que divergem.

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
- **F4** — workflow / governança / aprovação (submeter, aprovar/rejeitar versão, travar). ⬜
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
