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
> ⚠⚠ **Célula de origem GERADA não se edita no drill** (nov/2026). Digitar numa célula de posto
> convertia aquele lançamento para `MANUAL` **mantendo o `dims`** — e o próximo *Aplicar* não o
> apagava (já não era da origem dele) e inseria outro com a mesma chave única: **o Aplicar passava
> a falhar**. São 13.140 células de posto em 2027, **uma por pessoa por mês**, nas contas 20101 ·
> 20201 · 20301; o formulário alimenta outras 23 contas.
> ⚠ E o drill mostrava **o valor de UMA pessoa como se fosse o da célula**, porque guardava o
> último lançamento lido — discordando do total da linha acima, que estava certo. Hoje soma.
> **Quem precisa corrigir valor gerado lança um AJUSTE à parte** (`MANUAL` com `dims` vazio), que
> soma ao motor: `dims` vazio é o que o distingue na chave única, então ele **convive** em vez de
> colidir, e o *Aplicar* da origem continua apagando só o que é dela. A composição da célula abre
> no clique e mostra cada lançamento com seu rótulo (nome do posto, histórico do formulário).
> ⚠ **Não criar capacidade para "poder editar o gerado"** — seria reintroduzir exatamente o
> caminho que quebra o Aplicar. O que separa quem pode é o *mecanismo*, não um interruptor.

> ⚠ **Zerar em lote é APAGAR em lote** (nov/2026). A borracha (uma combinação) e *Zerar células*
> (todas as listadas) existem porque limpar uma linha residual custava dezenas de células uma a
> uma — mas `fat_orcado` não guarda zero, guarda **ausência**, então não há desfazer. Por isso a
> conta vem **antes** (quantas células, quanto somam) e o que fica de fora é **nomeado**: célula
> de posto/formulário (mesma regra de `editavelCel` — apagar só o ajuste manual dela deixaria a
> tela dizendo "zerado" sobre célula com valor) e célula fora do escopo. E, com filtro ativo,
> "todas" quer dizer **menos do que parece** — o aviso diz isso.
> ⚠ **`DELETE` barrado por RLS também não dá erro** — como o `UPDATE`: filtra as linhas, apaga
> zero e volta sucesso. O lote compara o que voltou com o que pediu; divergiu, para e avisa **o
> que já foi apagado continua apagado**, porque é o estado real.

> **Ratear do drill, pelos códigos já cadastrados (nov/2026).** Lançar um valor e distribuí-lo
> era digitar a mão em N combinações com a regra de três feita por fora. O botão ao lado da
> borracha abre os mesmos códigos de *Postos → Rateio* (16, todos somando 100: 8 por CC, 8 por
> empresa) e **reaproveita `cascataRateio`** — reimplementar a cascata faria o mesmo cadastro
> render dois resultados. Um código de CC troca o CC e mantém a empresa, um de empresa o
> contrário; escolher os dois é a cascata (CC, depois EMPRESA), como em `posto_rateio.ordem`.
> ⚠⚠ **A filial NÃO acompanha o rateio** — fica a da origem mesmo quando a empresa muda. É o
> precedente medido do Aplicar do posto: anulá-la deixou 8.064 células (R$ 8,4 mi) invisíveis
> para quem tem escopo de filial, porque a policy de leitura exige `filial_id IS NOT NULL`.
> ⚠ **Arredondar cada cota e somar NÃO fecha** (100 em três = 99,99). O resíduo vai para a maior
> cota, mês a mês — determinístico e o total do ano não muda. Provado nos 5 casos, inclusive com
> valor negativo (despesa) e nos 12 meses acumulados.
> ⚠ **O que já existe no destino é lido do BANCO, não da tela:** com filtro ativo o drill nem
> carregou as combinações de destino, e inserir por cima violaria a chave única — com metade do
> rateio já gravada. Destino com valor manual **recebe a soma**.
> ⚠ **A empresa de ORIGEM entra nessa consulta mesmo não sendo destino.** Rateando só por empresa
> para fora, ela some da lista de destinos, e sem ela as linhas de origem não seriam lidas nem
> apagadas: o valor ficaria nos dois lados, dobrando a linha.
> **Hoje é ATÔMICO (`ratear_orcado`, v3_195).** Era uma sequência de escritas do navegador: lia o
> estado dos destinos, apagava a origem, gravava um a um. A ordem fora escolhida para **duplicar**
> em vez de sumir — errado e visível é melhor que errado e calado, mas continuava errado. Agora é
> uma chamada, uma transação: ou acontece inteiro ou não acontece.
> ⚠⚠ **A RPC NÃO recalcula a cascata.** Os destinos chegam prontos de `cascataRateio` — a mesma
> função do Aplicar do posto. Reimplementá-la em SQL faria o mesmo cadastro render dois
> resultados conforme a tela. **A função é a transação, não a matemática**; o que ela faz é
> **conferir o total ao centavo** e recusar a instrução inteira se não bater, que é a invariante
> que importa (dinheiro não nasce nem some num rateio).
> ⚠ `SECURITY INVOKER`, para o RLS continuar recortando — DEFINER por conveniência daria o orçado
> inteiro a qualquer um. E como `UPDATE`/`DELETE` barrados por RLS **não dão erro**, cada comando
> confere `ROW_COUNT` e levanta exceção, que numa função desfaz tudo.
> ⚠ A origem com célula de POSTO/FORMULÁRIO é recusada **no banco** também, não só na tela: mover
> valor gerado faria o próximo Aplicar reinseri-lo na origem.
> Prova em `prova_ratear_orcado.sql` — escreve em **ano 2099** e desfaz tudo no RAISE final;
> trabalhar sobre o ano real seria apostar no rollback que se está testando.
> ⚠⚠ **`disabled` NÃO trava clique repetido, e aqui isso DOBROU o valor** (17/nov, medido:
> 19:48 gravou 144 células somando 2.400 de uma origem de 1.200; 19:49 o rateio só por empresa
> gravou os 1.200 certos). `setAplicando(true)` só vale no render seguinte — o segundo clique vê
> o botão ainda liberado. A trava é um **`useRef` síncrono**. E a causa do segundo clique foi a
> própria tela: rateando para fora do filtro, **todo destino some e o drill recarrega vazio**,
> indistinguível de falha. Por isso o modal devolve um **resumo** que o drill exibe — dizer o que
> foi feito é parte da operação, não enfeite. ⚠ Somar no destino que já tem valor continua certo
> para um rateio deliberado; o que estava errado era deixar o acidente acontecer.
> ⚠ `0 × -1` é **−0**, e o pt-BR escreve "−0,00" — total zerado parecia defeito. `|| 0` resolve.

> ⚠ Só combinação **puramente manual** rateia — mover célula de posto/formulário faria o próximo
> Aplicar reinseri-la na origem, e o valor passaria a existir duas vezes.

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

> ⚠ **Fechar é reversível; liberar não (`v3_178`).** A tela escondia Ressincronizar, excluir e
> qualquer volta atrás assim que o cenário fechava — mas o carimbo é carimbo, não cadeado.
> `reprovar_cenario` existia desde a v3_165 e **nunca tivera botão**: hoje é *Reabrir*, e os
> vereditos ficam (o que volta a ser possível é revê-los). O único passo sem desfazer é a
> liberação.
> ⚠ **E ela não deixava rastro do QUE escreveu** — a versão guardava só `mesclado_em`, e a tabela
> `auditoria` não cobre, porque o gatilho de `fat_orcado` registra apenas DELETE em massa. Numa
> ação sem desfazer, "por que esta linha da baseline mudou?" ficava sem resposta até para quem
> aprovou. `cenario_liberacao` + `cenario_liberacao_linha` guardam o relatório **por linha** (~200
> por liberação, não as 24 mil células) com a ação e o Δ. **Escrita só pela RPC** (lição da
> v3_174): registro que o auditado pode editar não é registro.
>
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

> **DIRETOR × GERENTE: a diferença é o `PESSOAS` (decisão do Ricardo, 18/nov).**
> **Diretor** recebe os CCs no `VER` e **nenhuma regra `PESSOAS`** — então ela herda o `VER` e
> ele enxerga o quadro inteiro das áreas liberadas, **salário incluído** (`posto.salario` é
> padrão `member = SIM`). Medido na conta de teste: **266 dos 574 postos, R$ 2,95 mi/mês de
> massa salarial, nenhum valor mascarado**. Foi decidido assim de propósito; os CCs de Diretoria
> e Adm ficaram de fora.
> **Gerente** será o oposto e exige o passo que o diretor dispensa: ligar *"Escopo próprio para
> Pessoas"* e marcar só os CCs do time. ⚠ **Sem esse passo a regra não existe e herda o `VER`** —
> alargar o `VER` para o DRE abriria as pessoas junto, em silêncio.
> ⚠ **Tirar o CC do escopo NÃO esconde a existência de quem rateia para dentro dele.** Um posto
> da Diretoria que rateia para um CC visível aparece em *"Chegam por rateio"* com nome e valor —
> sem cargo nem salário, porque o cadastro está fora. É a degradação projetada funcionando, mas
> quem esconde um CC esperando sumir com as pessoas vai se surpreender.

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

> ⚠⚠ **`filtro_escopo` de linha ESTREITA, nunca alarga (nov/2026).** O editor
> documentava "sobrepõe a tela", e sobrepor significava *ignorar o filtro de CC*:
> filtrando um CC sem movimento, a DRE inteira zerava e a *Folha apoio* seguia
> exibindo o consolidado da empresa, com "% Estrutura" 100%. Relatório filtrado
> mostrando número não filtrado, calado. Achado na homologação do gerente de TI
> (item A-04), que só enxergava o CC 141.
> O caso que parecia justificar a sobreposição — a fórmula `margem ÷ folha
> DIRETA` — na verdade a **desmente**: sobrepondo, o numerador vem filtrado e o
> denominador não, e a razão não significa mais nada. Hoje o escopo da linha é
> cruzado com `ccPermitidos` **e** com o `ccFilter` da tela, nos dois lugares que
> repetem a lógica (`lib/relatorioTotais.ts` e `RelatorioEditorPage`); os quatro
> dashboards herdam de graça, porque já passavam `ccFilter`.
> ⚠ Interseção vazia é **linha zerada**, não "sem filtro" — e sai sem chamar a
> RPC, porque `p_ccs: []` dependeria de o SQL ler array vazio como "nenhum" e
> não como "todos". ⚠ Empresa e filial **nunca** tiveram o defeito: as duas
> cargas sempre passaram `p_empresas`/`p_filiais`. Era só o CC.

**2. Funções/menus — o que aparece.** Catálogo único em `lib/capacidades.ts` (`CAPACIDADES`: `key`, `label`, `categoria ∈ Funções|Menu`, `padrao` por papel). Hook `useCapacidades` resolve `can(key)` com precedência **override por usuário (`user_acesso_funcao`) > padrão do papel > liberado (se não catalogado)**. Menus (`NAV_GROUPS` em `App.tsx`) e botões de ação (`orcar`/`estrutura`) são gateados por `can(...)`. Blindagem: admin nunca perde `menu.config`.

**3. Funcionalidades do tenant — o que EXISTE nesta instalação.** Pergunta diferente das duas acima, que são sobre *quem pode*. `lib/tenantFlags.ts` lê colunas booleanas de `tenant` (hoje `usa_apontamento`) e o hook `useTenantFlags()` as entrega com cache em `localStorage`, para a navegação não piscar esperando um boolean. Ligadas em **Configurações → Funcionalidades**; mexer na flag exige `limparCacheFlags()`. Use para mecanismo específico de um negócio — apontar hora em projeto, p.ex. — que em outro tenant não deve nem aparecer como tela vazia.

> ⚠⚠ **Fechar a versão é o que transforma o orçado em META (v3_190).** Decisão do Ricardo em
> 17/nov: aplicado o orçamento final, a versão **fecha** e o realizado passa a ser medido contra
> ela; simulação vai em outra versão (o `_B` que a tela de duplicar já cria).
> **O produto tinha a coluna `bloqueada` e nada para ligá-la** — nenhuma tela escrevia `true`,
> só `false` na criação. E ela **não trancava nada**: as 4 políticas de `fat_orcado` não a citam,
> e o `UPDATE` em `versao_orcamento` só exigia `pode_escrever()` (admin **ou member**). Qualquer
> member fechava, reabria e escrevia numa versão fechada pela API; as telas respeitavam, o banco
> não. **ACS-02 e v3_174 de novo.**
> Fechado em quatro camadas, porque o furo tinha quatro: `pode_bloquear_versao()` (a autoridade),
> `bloquear_versao`/`reabrir_versao` (os atos), `versao_bloqueio` (o histórico, escrito só pelas
> RPCs) e **três gatilhos de COMANDO em `fat_orcado`** — de linha, um Aplicar de 16.500 linhas
> faria 16.500 consultas.
> ⚠ **Admin por padrão, member por liberação:** `pode_bloquear_versao()` é `eh_admin() OR
> override`, lendo `user_acesso_funcao` — então liberar em Configurações vale **no banco**. É a
> **terceira repetição deliberada** do catálogo em SQL (depois de `pode_ver_folha` e
> `pode_aprovar_cenario`): mudar o `padrao` de `versao.bloquear` exige mudar o SQL junto.
> ⚠⚠ **Reabrir exige motivo, fechar não.** Fechar é "não mexo mais"; reabrir é mexer no alvo
> **depois que o ano começou a ser medido contra ele** — sem o motivo, o desvio de março vira
> outro número em abril sem explicação.
> ⚠ **A RPC não fechava a porta sozinha:** `REVOKE UPDATE` na tabela e `GRANT` coluna a coluna,
> deixando `bloqueada`, `aprovado_*`, `mesclado_*` e `semeado_em` de fora — todas são carimbo de
> decisão, e decisão se escreve por RPC, nunca por PATCH. (Revoke de coluna só vale depois de
> tirar o GRANT da tabela — lição da v3_150.)

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

> ⚠⚠ **DECIDIR e VER o cenário eram a mesma coisa — e não são** (18/nov). O botão `Cenário` era
> renderizado sempre: negar `posto.cenario.decidir` deixava em **leitura**, não escondia. Para o
> **RH**, que edita o cadastro mas não participa da negociação, é justamente o que não pode — a
> lista de quem a empresa pretende cortar. Hoje o modo só aparece para quem **decide** ou
> **aprova** (`veCenario = podeCenario || can('cenario.aprovar')`), com rede para capacidade
> revogada no meio da sessão. **Sem capacidade nova:** as duas chaves já diziam isso.
> ⚠ **É esconder a TELA, não o dado** (camada 2 do F2, por desenho): `posto_versao` segue
> legível pela API para quem tiver o token. Para o RH não alcançar a decisão de jeito nenhum,
> seria RLS em `posto_versao` — trabalho à parte.
> **Receita do perfil "RH edita cadastro, não vê cenário":** papel **`member`** (viewer não
> escreve, `pode_escrever()` barra no banco) · `orcar` herdado (é o **piso** de `podeCadastro`) ·
> `posto.cadastro.editar` **Liberar** · `posto.cenario.decidir` **Negar** · `cenario.aprovar` e
> `posto.aplicar` negados · `posto.salario` herdado · escopo de dados `PESSOAS`.

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

> ⚠⚠ **Auditoria das importações (nov/2026) — 1 de 15 estava solta.** Varri os 15 arquivos com
> `type="file"` contra as 14 capacidades da categoria *Importações*. Resultado: 13 gateados,
> 1 legado não roteado (`LancamentosPage`) e **um furo real — `ImportarFuncionarios`**, o
> importador de CPF, renderizado **logo abaixo** da barra genérica que já exigia
> `cadastros.importar` e **fora** dela. Visível e funcional para quem não pode importar — e é o
> mais sensível dos dois: traz CPF (coluna com `SELECT` revogado na v3_150) e reescreve
> `posto.funcionario_id` em lote.
> **A lição é o padrão do erro:** importador novo herda o LUGAR na tela, nunca a permissão.
> Toda vez que um nasce ao lado de outro, o gate tem de ser repetido.
> ⚠ **O padrão correto do app é gatear o BOTÃO, não o `<input type="file">`** — o input fica
> escondido e sem gatilho. Vale conferir junto que o modal de importação não abre por outro
> caminho: em `RealizadoDadosPage` e `FormularioEditorPage` o `setImportOpen(true)`/`setImp({…})`
> aparece **uma vez só**, dentro da porta. Auditoria que olha só a proximidade do `can()` no
> arquivo não prova nada.

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

  ⚠⚠ **O RAZÃO ENTRA PELO ZIP, NA TELA (22/nov/2026).** Até aqui o realizado só subia assim:
  alguém com o repositório na máquina rodava `scripts/realizado.sh`, que quebrava o razão em um
  xlsx por mês, e só então alguém arrastava os xlsx para `/realizado`. O passo do meio existia
  **porque a tela não sabia abrir o zip** — e prendia a carga mensal a uma pessoa.
  `lib/razaoZip.ts` abre o zip no navegador e entrega as linhas ao `importarLote` que já existia:
  resolver conta/empresa/filial/CC, câmbio, lote ignorado, modo *substituir* e log continuam
  sendo o mesmo caminho provado. **Nada de xlsx intermediário.**
  ⚠ **O PERFIL É UM SÓ.** Os JSONs saíram de `scripts/perfis/` para **`frontend/src/lib/perfis/`**
  e o Python passou a ler de lá. Duas cópias da regra divergiriam no primeiro ajuste, e o sintoma
  seria o lote do script e o da tela deixando de bater **sem nada acusar**. A tela os descobre com
  `import.meta.glob`, então outro ERP segue sendo "acrescentar um perfil", nunca "editar a tela".
  ⚠ **DUAS PASSADAS, de propósito.** A 1ª só **conta** por competência e a tela mostra o que o
  arquivo tem (o razão traz desde 2022); a 2ª extrai só os meses marcados. Guardar o ano inteiro
  para filtrar depois seriam 375 mil linhas em objetos — centenas de MB no navegador de quem
  importa. Reler o zip, que está em memória, é barato perto de travar a aba.
  ⚠ **A entrada que não interessa é descartada SEM INFLAR** (`fflate`: só se chama `.start()` no
  arquivo escolhido). O `PLANORC.zip` tem 2 entradas e 368 MB; o zip do ERP inteiro tem 60 e 1 GB.
  ⚠⚠ **`split(',')` não serve**: o histórico do razão tem vírgula dentro de aspas
  ("SERV ENTREGA, UNIMED"), e partir na vírgula crua desloca as colunas seguintes **sem dar erro**
  — vira lançamento com conta errada. O parser é incremental e com estado, porque o chunk corta no
  meio do campo. ⚠ E o arquivo é **latin-1**: decodificar como UTF-8 não falha, só entrega
  histórico corrompido.
  **Medido (22/nov, `PLANORC.zip` da área de stage do GoodData):** 25 MB comprimidos,
  `LancamentoContabil.csv` com **367 MB e 1.155.566 linhas** (2022→2026); inventário em **7,5 s**,
  extração de um mês em **7,0 s**, **heap de 17 MB**. A contagem por competência bate **mês a mês**
  com a do script Python, e no mês extraído **débito = crédito** (diferença 0,00).
  ⚠ **Sem CORS no GoodData** — o navegador não busca o arquivo sozinho, e isso é recurso: o
  usuário baixa o zip pelo link e solta na tela, então **nenhuma credencial entra no Planorc**.
  ⚠ O `scripts/realizado.sh` **continua funcionando** e é a contingência.
  **Primeiro uso real (22/nov):** out/26 + nov/26 pelo caminho novo, **47.499 lançamentos**
  (32.563 + 14.936), 3 ignorados. E o **recorte por moeda do modo Substituir foi exercitado pela
  primeira vez por aqui**: out/26 ficou com 32.563 linhas em BRL e **183 em USD da empresa XX
  intactas** — o razão paraguaio não foi apagado pela reimportação do brasileiro, que é
  exatamente para isso que o recorte existe.

  ⚠⚠ **FONTE DE ERP: a credencial NUNCA toca o navegador (`v3_196`, 22/nov).** Fechado o último
  passo manual — a tela busca o arquivo no ponto de entrega do cliente (hoje a área de stage do
  GoodData) e segue para o mesmo inventário/importação.
  **Duas coisas tornavam o desenho óbvio impossível:** (1) o Planorc fala com o banco pelo cliente
  JS, então **uma coluna `senha` numa tabela seria publicá-la** para todo mundo que alcança a tela
  — RLS decide *quem* lê, não impede quem pode ler de ver; e (2) **o servidor do ERP não tem
  CORS** (medido), então o `fetch` do navegador morre antes de sair. As duas se resolvem com o
  mesmo remédio: a Edge Function **`erp-fonte`** fala com o ERP, com service role.
  ⚠ `erp_fonte` guarda `secret_id`, nunca a senha; o segredo vive no **`vault`**.
  ⚠⚠ **O schema `vault` não é exposto pelo PostgREST**, daí as pontes `erp_segredo_gravar` /
  `erp_segredo_ler` em `public`. **`erp_segredo_ler` devolve a senha em claro — é a função mais
  perigosa do banco** e só `service_role` a executa: o `REVOKE` de `PUBLIC` vem **antes** do
  `GRANT`, porque toda função nasce com EXECUTE para `PUBLIC` e é por aí que um privilégio vaza
  sem ninguém conceder nada.
  ⚠ **A senha não entra por RPC**: parâmetro de função atravessa o PostgREST e pode cair em log
  de erro. Cadastro vai por RPC (`erp_fonte_salvar`), segredo vai direto à Edge Function. Dois
  caminhos de propósito. E a senha **nunca volta** — o campo abre vazio, em branco mantém a atual.
  ⚠ **Escrita da tabela fechada no GRANT**, não só na RPC (v3_174/v3_190): trocar a `url_base` por
  `PATCH` seria apontar o Planorc para outro lugar. `https://` é exigido — Basic em claro entrega
  a credencial a quem estiver no caminho.
  ⚠ **Download é passthrough de stream**, nunca `arrayBuffer()` na função: 25 MB bufferizados é
  descobrir o limite de memória em produção, no dia do fechamento.
  ⚠ O recorte por tenant vai **explícito** no código da função: service role ignora RLS, então
  sem a linha ela entregaria a fonte de outro cliente a quem soubesse o uuid.
  ⚠⚠ **A DATA DO ARQUIVO É A DO SERVIDOR, e ela diz se o job do ERP rodou.** Sem repassar o
  `Last-Modified` da origem, o `File` criado a partir do download nasce com **a hora de agora** —
  e a tela afirmaria que o arquivo é de hoje mesmo quando a carga do ERP não roda há três dias.
  A Edge Function repassa o header (ele é CORS-safelisted, mas vai em `Expose-Headers` por
  garantia) e a tela mostra ao lado do tamanho, em **laranja acima de 2 dias** — só quando é o
  caso, porque aviso que acende sempre ninguém lê.
  ⚠ **Fuso FIXO em `America/Sao_Paulo`**, não o da máquina: `Last-Modified` chega em GMT e o
  `toLocaleString` sozinho converte para o fuso de quem olha, fazendo a MESMA carga aparecer com
  horas diferentes no Brasil, no Paraguai e na Bolívia — que é onde este grupo opera. A carga
  roda aqui, então a hora é a daqui, e o `title` diz isso por extenso.

  ⚠⚠ **"A ÚLTIMA COMPETÊNCIA DO ARQUIVO" NÃO É O MÊS CORRENTE, e o atalho apontava para o
  resíduo.** O razão traz **provisão adiantada**: medido no `PLANORC.zip` de 22/nov, jan/27 a
  jul/27 têm 14 · 14 · 10 · 4 · 4 · 4 · 4 lançamentos. O botão oferecia *"ano de 2027"* — o que
  ninguém importa. Hoje o atalho sai do **calendário** (o mês de hoje, caindo para a última do
  arquivo quando ele não está lá, porque importar fechamento antigo é legítimo).
  ⚠ E **inverter a lista não resolve, piora**: decrescente abre com as sete competências de
  resíduo. A lista fica **cronológica** — a ordem natural de uma série — e quem resolve é a tela,
  que **rola até o mês corrente** e o deixa em negrito. Achado no primeiro uso real: o arquivo
  tem 67 competências e nov/26 estava depois de 60 pílulas.

  ⚠⚠ **O PERFIL NÃO TEM DEFAULT quando há mais de um.** Eles diferem no mapa de empresa por item
  contábil: ler o razão brasileiro com o perfil da Bolívia **passa na conferência de colunas**
  (são as mesmas) e distribui tudo para as empresas erradas — importação que termina "com
  sucesso" e põe o ano inteiro no lugar errado. Adivinhar coluna já era proibido aqui; adivinhar
  perfil é pior. Com um perfil só, escolher não é escolha: seleciona sozinho.
  ⚠⚠ **O formulário tem canal de erro PRÓPRIO.** A primeira versão escrevia a falha do cadastro
  em `zipProg`, e essa mensagem só é desenhada **dentro do painel do zip** — sem arquivo
  carregado, o erro ia para um estado invisível e o *Salvar* parecia não fazer nada (aconteceu
  no primeiro uso, 22/nov, com a migration ainda não aplicada). Gravação que falha calada é o
  defeito que este projeto mais persegue; a mensagem de "função não existe" agora diz, em
  português, que falta rodar a migration.
  ⚠ **A manutenção mora junto do uso** — o cadastro está no próprio modal de importar, não numa
  tela distante. O projeto já pagou duas vezes por motor sem tela de manutenção (áreas
  funcionais, gestor), e quem precisa trocar a senha está ali no dia em que a carga falhou.

  **Importação como padrão, não como caso (nov/2026).** O alvo é receber de **mais de um ERP**, e
  nome de coluna é a primeira coisa que muda entre eles. Três partes separadas:
  `lerPlanilha` (`lib/planilha.ts`, ao lado do `downloadSheet` — ler e escrever planilha moram
  juntos) **não sabe do conteúdo**; **`lib/importPerfil.ts`** declara por campo os *nomes aceitos*
  (tolerante a acento/caixa/espaço, intolerante ao resto: adivinhar coluna é como se importa a
  errada); e o **casamento vai no banco**, atômico. Trocar de ERP = acrescentar um perfil, não
  editar tela. Convenção da instalação (concatenar empresa+filial) mora **no perfil**, perto das
  colunas, para o banco seguir genérico — mesma razão de `planorc_pj_frag()`.

  ⚠⚠ **"Substituir escopo" APAGA e recria, e isso corta os ponteiros** (05/nov/2026). Uma carga
  de rotina nesse modo apagou 568 postos e recriou 564 do arquivo: **ids novos**. Como
  `fat_folha.posto_id` e `fat_apontamento.posto_id` são `ON DELETE SET NULL`, 27.865 linhas de
  folha e 14.309 de apontamento ficaram **sem vínculo, em silêncio** — nenhum valor se perdeu, só
  o ponteiro, e a conciliação por posto parou de enxergar. `posto_versao` é `ON DELETE CASCADE`:
  as decisões de cenário de posto **foram embora**. E o que o arquivo do RH não traz não volta:
  `area_func_id` (350 → 2) e os 6 postos de sócios (`matricula 8000xx`), que são cadastro só do
  Planorc.
  **Religado na `v3_188`** por `(filial_id, matrícula)`, que é único em `posto`: 45.009 linhas de
  folha e 13.908 de apontamento, **zero ambíguas**. Sobraram 15 do pró-labore cujo posto não
  voltou do arquivo e 401 de terceiros, que não têm posto nem devem ter.
  **E o modo deixou de apagar (nov/2026).** *Substituir escopo* virou **Sincronizar com o
  arquivo**: o upsert vem primeiro (o id sobrevive, e com ele a área funcional e os ajustes de
  grade, porque o upsert só escreve as colunas do payload) e só depois removem-se os postos do
  escopo **ausentes do arquivo**.
  ⚠ **Vaga sem matrícula nunca é removida**: o arquivo do RH não pode contê-la, então "não está
  no arquivo" não é evidência sobre ela. ⚠ E a confirmação **lista os ausentes pelo nome** — os
  6 sócios (matrícula `8000xx`) caem ali todo mês, e com o nome à vista a pessoa reconhece e
  cancela; com "12 postos serão removidos" ela confirma e descobre depois.

  ⚠⚠ **`UPSERT` com `salario_base` é negado; `UPDATE` não** (v3_179). `INSERT` e `UPDATE` na
  coluna estão concedidos — falta o **`SELECT`**, revogado na v3_143 — e
  `ON CONFLICT DO UPDATE SET x = excluded.x` **lê** `excluded.x`, então o Postgres recusa a
  instrução inteira com *permission denied for table posto*. Medido:
  `has_column_privilege(...,'salario_base','UPDATE')=true`, `...,'SELECT')=false`. A v3_142
  anotou "gravar não é ler, então escrever salário continua podendo" — verdade para `UPDATE`,
  **falsa para `UPSERT`**, e a diferença ficou sem registro até a importação de nov/26 bater nela
  (estava quebrada desde a v3_143; ninguém reimportou postos no intervalo).
  Hoje o upsert não manda a coluna e o valor entra por `atualizar_salario_postos(jsonb)`, que faz
  `UPDATE` puro. ⚠ Sendo `SECURITY DEFINER`, ela **repete o predicado de escopo** da política
  `posto_upd` no `WHERE` — mesma solução e mesmo custo de `posto_v`: ao mexer no escopo de
  pessoas, conferir os dois.

  ⚠⚠ **Salário vazio no arquivo NÃO é zero** (nov/2026). O importador do Quadro fazia
  `salario_base: r.salario ? parseFloat(r.salario) : 0` — e o `Funcionarios.csv` do RH **não traz
  salário**. Uma importação de rotina zeraria os **339 postos com valor (R$ 3,5 mi)**, sem erro e
  sem aviso, levando junto memória de cálculo, custo do quadro e o orçado de origem POSTO. Hoje o
  upsert vai em **dois lotes** (com e sem salário) — um só não serve, porque o PostgREST monta um
  comando com as colunas do payload — e `salario_base` é `NOT NULL DEFAULT 0`, então omiti-lo
  **preserva no UPDATE** e dá zero só no INSERT. O resumo da importação diz quantos foram
  preservados: sem essa linha, "preservei" e "zerei" parecem iguais. Mesma família do
  `Number(null) || 0` da grade.
  **Preencher o salário é o 2º passo** (`scripts/preencher_salario_folha.py`): CLT e pró-labore
  saem do **último B39 por pessoa** no `srd.csv` do RH.zip; prestador sai de **222+228 da folha do
  mês**; demitido fica em branco. ⚠ O B39 **não está no `prgper02`** (é verba de referência, não
  gera contabilização) — a versão antiga do script lia de lá e devolvia zero de 243 CLT.
  ⚠ E **o último por pessoa, não o do mês**: o `srd` de out/26 veio com 16 pessoas no B39 contra
  124 em setembro (a folha CLT ainda não estava nele), então "o B39 do mês" deixaria 96 de 97 CLT
  sem salário. Salário-base é contratual e muda pouco; o script imprime de que competência cada
  valor veio, para a defasagem não ficar implícita. Medido em out/26: o pagamento PJ oscila
  **1% na mediana** entre meses (só 15 de 194 passam de 20%), então usar o mês é estável.

  ⚠⚠ **O MOTOR IGNORAVA `ativo` E O APLICAR NÃO — a tela de aprovar mostrava Δ 0,00** (18/nov).
  `calcularPosto` só olhava vigência; o Aplicar sempre filtrou `p.ativo !== false`. Quem cortava
  pela caixinha **Cortar neste cenário** (que grava só `ativo`) via o comparativo dizer *cadastro
  24.626,23 × cenário 24.626,23 · Δ 0,00*, enquanto o Aplicar tirava o custo de verdade —
  **R$ 91.023 em dois postos de pró-labore**, com o aprovador lendo "não muda nada".
  ⚠ Cortar pela **data de saída** já funcionava: é por isso que, na mesma tela, a Maria Fernanda
  zerava e o Aderson não. **Mesma intenção, dois caminhos, um deles mudo** — o pior formato de
  defeito, porque o contraste fica à vista e parece regra.
  Hoje `vigencia()` devolve janela **vazia** (`[13, 0]`) para `ativo = false`, e o laço mensal
  pula tudo: zeros por construção, sem caso especial, e o motor passa a concordar com o Aplicar
  em toda tela (grade, memória, comparativo).
  ⚠ Medido antes: dos 574 postos, **243 têm `ativo = false`, TODOS com `sit_folha = 'D'`, salário
  zero e nenhuma célula no orçado de 2027** — a equivalência `ativo=false ⟺ demitido` é exata
  (zero postos ativos com `sit_folha='D'`). Risco de regressão: nenhum.
  **Qual dos dois usar** (decisão do Ricardo, 18/nov): a **caixinha** é para quem **não é CLT** —
  prestador e pró-labore, que encerram contrato sem verba rescisória. A **vigência** é para CLT,
  onde a saída tem custo: aviso prévio, 13º e férias proporcionais, multa de FGTS.
  ⚠ **Corte por caixinha não gera rescisão**, e está certo: ele diz "este posto não existe neste
  cenário", não "esta pessoa é desligada em junho".
  ⚠ E isso **não é regra nova**: as verbas `RESC_*` já são recortadas por regime (**só
  `BR-CLT`**, v3_118), então cortar um prestador pela vigência também não geraria rescisão. Os
  dois caminhos concordam — o que mudava era só o motor enxergar ou não o corte.

  ⚠⚠ **CORTADO NO CENÁRIO NÃO É DEMITIDO — e a conflação tirava a volta atrás** (nov/2026).
  *Cortar neste cenário* grava `ativo = false` no overlay, e `situacaoPosto()` lê `ativo === false`
  como **demitido**: o posto caía no balde *Demitidos*, que vem **desmarcado**, sumia da grade e
  **não havia como descortar**. Quem acabara de decidir o corte procurava a pessoa entre 245
  demitidos de verdade (o contador foi de 243 → 245, que eram exatamente os dois cortados).
  Hoje há o estado **`cortado`**, com `soCenario: true` — o botão só aparece onde existe alguém
  assim, então o modo Cadastro não ganha pílula permanentemente zerada.
  ⚠ `situacaoPosto` **não** sabe de onde veio o `ativo = false`; quem distingue é a grade,
  comparando o **mestre** com o **resolvido**, e passa a classificação ao seletor
  (`classificar`). A etiqueta da linha já dizia CORTADO × DEMITIDO — era só o **filtro** que
  não sabia.
  ⚠ `cortado` fica **fora da seleção padrão**, de propósito: posto cortado não está no quadro e
  não deve entrar no headcount nem no custo. O que faltava não era mostrá-lo, era **dizer onde
  ele foi parar**.

  **Situação do posto** — regra e seletor em **`lib/situacaoPosto.tsx`**, usados por *Postos*,
  *Memória de cálculo* e *Organograma*. ⚠⚠ **Não usar em tela por COMPETÊNCIA** (Folha realizada,
  Apontamento, Conciliação): `sit_folha` é um retrato do momento da importação, sobrescrito na
  carga seguinte, e aplicá-lo lá esconderia linhas de **março** com a situação de **outubro** —
  quem foi demitido em outubro trabalhou e foi pago em março, e o número mudaria sem dizer por
  quê. Para servir ali, a situação teria de ser **histórica por competência**: outro desenho.
  O aviso está no topo do arquivo, para que "completar" as telas que faltam não introduza o erro.

  ⚠⚠ **A IMPORTAÇÃO NUNCA GRAVOU `sit_folha`** (achado em 05/nov/2026). A v3_152 carimbou a
  coluna **uma vez, por SQL**, e o import de postos jamais a manteve — o CLAUDE.md dizia que
  "a importação carimba", e não carimbava. Ficou invisível enquanto o valor de 2026 continuou
  lá; quando os 568 postos foram apagados e recriados, `sit_folha` veio **nula nos 570** e os
  **243 demitidos passaram a contar como ativos** no headcount, no FTE e no custo. Hoje a coluna
  `situacao` do arquivo é gravada como as outras opcionais (presente grava, ausente não toca) e
  o resumo diz quantos demitidos entraram.

  ⚠⚠ **Excluir o posto NÃO apagava o orçado dele** (nov/2026). `fat_orcado` não tem `posto_id`
  — a origem vive em `dims->>'posto'`, que é **texto e sem FK** — e em `fat_folha` o `posto_id` é
  `ON DELETE SET NULL`. Um pró-labore excluído seguiu custando **R$ 900.000 em 2026**, sem dono
  e sem rastro. ⚠ E `dims->>'posto'` é o **CÓDIGO**: posto novo com o mesmo código adotava as
  linhas órfãs do antigo, calado. Hoje a exclusão limpa as duas tabelas e diz quanto vai junto;
  **versão `bloqueada` fica de fora**, porque retrato do que foi aprovado não se reescreve.
  ⚠ Folha e apontamento **realizados** nunca são apagados — o valor foi pago.

  ⚠⚠ **Linha DESATIVADA não é componente de ponte (nov/2026).** `relatorio_linha.desativada`
  exibe o valor tachado e o tira do cálculo: `SOMAR_FILHOS` pula a linha e referência a ela em
  fórmula vale **zero** (`lib/engine.ts`). Então o TOTAL do resultado não a contém — mas a ponte
  do *Orçamento — análise* a somava como barra, porque `componentesDe()` devolvia os filhos do
  subtotal sem olhar a marca. O resíduo absorvia a diferença, e dava para ver a olho nu:
  *Titulos baixados para PDD +565.003* contra *não explicado −565.003*, a mesma cifra invertida.
  ⚠ **E não dava para consertar na tela:** `linhasConciliaveis` já esconde desativada do seletor,
  então a linha entrava pelo botão *usar os da estrutura* e ficava marcada **sem checkbox para
  desmarcar**. Hoje `componentesDe` filtra, **e a seleção já salva é limpa no cálculo** — corrigir
  só a primeira deixaria o defeito vivo em todo preset montado antes, que é justamente o que as
  pessoas abrem todo dia.
  ⚠ O aviso de resíduo dizia só "subtotal junto com componente, ou falta um componente" — passou
  a prever a terceira causa, senão quem bater nela procura duplicata e não acha.

  ⚠ **Marcador que aparece em quase toda linha deixa de marcar (nov/2026).** O asterisco do
  custo/mês sinaliza "o custo mudou durante o ano", e a PLR foi incluída na condição com um
  raciocínio correto — o custo/mês mostra dezembro, que não tem parcela, e `custo/mês × 12`
  ficava abaixo do anual parecendo erro de conta. O efeito saiu errado: cadastrada a PLR para
  todo o quadro CLT, **94 dos 95 asteriscos passaram a ser dela** e sobrou **um** de causa real.
  A explicação desceu para o rodapé, que é o lugar de um fato constante; o asterisco voltou a
  sinalizar a **exceção deste posto** (reajuste próprio, afastamento, rescisão). **Ao incluir
  uma causa nova num marcador, conte quantas linhas passam a tê-lo** — a condição certa com
  alcance errado é pior que a ausência, porque esconde o caso que importa.

  **Verbas variáveis do prestador (nov/2026).** O custo do prestador tem **dez** verbas além do
  par `222+228`, e nenhuma chegava ao orçado: cinco estavam como `INFORMATIVA` (que
  `verbasDoRegime` descarta) e três nem existiam no catálogo. São **R$ 483 mil/mês**, R$ 5,8 mi
  no ano. Hoje são `VALOR_FIXO`, regime `BR-PRESTADOR`, conta `20301 Terceiros Internos` — o
  mesmo item em que o realizado as lança.
  ⚠⚠ **A `418 Garantia de horas` é a que mais importa, e não pelo valor.** Nas 35 pessoas que a
  recebem, **só a `222` oscila 120% entre meses; `222+418` oscila 36%** — a garantia é
  exatamente o que torna o custo previsível, porque quem fatura pouco num mês recebe a diferença
  por ela. Orçar só a `222` é orçar a parte que varia e ignorar a que estabiliza.
  ⚠ **O valor é média mensal, não o mês escolhido** (`scripts/media_prestadores.py`, lê o `srd`,
  que tem 35 competências contra 4 importadas). Isso corrige um defeito silencioso: o conversor
  pegava UMA competência por verba, e quem não recebeu naquele mês vinha com coluna em branco —
  e o importador, que apaga o que o arquivo cita, **removia o benefício**. A `235` tem 36 pessoas
  no ano e **1 em setembro**: importar por setembro apagava 35.
  ⚠⚠ **PENDÊNCIA ACEITA (Ricardo disse "não precisa", nov/26):** `VERBAS_BENEFICIO` no conversor
  ainda lista `230` e `231`, então **a carga mensal as sobrescreve com o valor de um mês** e
  desfaz a média nessas duas — as outras oito ficam intactas, porque não são colunas do arquivo.
  Quem estranhar comissão/bônus "voltando ao valor antigo" está vendo isto, não um defeito novo.
  ⚠ **`236` fica sem ninguém de propósito:** os 12 que a recebem estão demitidos, uma competência
  cada. É encargo de rescisão de prestador — provisioná-la no cadastro orçaria a saída de quem
  não está saindo.
  ⚠ **`coalesce` guarda o erro que o seed existe para corrigir.** A `230` apontava para
  `20101 Salários e Ordenados` com o realizado em `20301`; escrevi
  `coalesce(conta_destino_id, …)` "por cautela" e preservei o defeito. Quando o destino é
  conhecido pelo dado, a atribuição é direta — `coalesce` é para o que não se sabe.

  ⚠ **A chave do RH é SEMPRE `(filial, matrícula)`** — confirmado pelo Ricardo em nov/2026, e
  vale para `srd`, folha e cadastro de posto. A matrícula **sozinha** não identifica em nenhum
  dos dois sentidos: a `900008` pertence a 7 CPFs (v3_149) e a `900012` aparece em 5 filiais
  somando ~R$ 100 mil/mês, que são pessoas diferentes, não uma. Ao agregar qualquer coisa vinda
  do RH, agregue pelo par — somar por matrícula funde gente.

  ⚠⚠ **Uma pessoa pode ter DUAS matrículas, e a chave achar só uma.** O Ronaldo é `800002` na
  folha (série de pró-labore) e `900101` no cadastro do posto (série de prestador). Procurando
  por `(filial, matrícula)` eu concluí que ele não tinha posto, afirmei que faltava R$ 1,1 mi no
  orçamento e escrevi um seed que teria criado **duplicata** — ele estava lá, com o mesmo nome,
  a mesma empresa·filial·CC e o mesmo salário. **"Não achei por esta chave" não é "não existe"**:
  ao concluir ausência a partir de uma chave, confira pelo nome antes de criar cadastro.

  ⚠⚠ **Competência errada não dá erro, e some atrás de outro defeito** (v3_189). A folha de
  **maio/2026** estava gravada também em **2027-01** — 5.008 linhas, R$ 4,36 mi, importada em
  28/jul/2026, a única competência de folha **sem lote**. Prova: 1.460 dos 1.461 pares
  (matrícula, verba) idênticos aos de 2026-05, **zero** pares exclusivos, e o único divergente
  com um "3" digitado na frente (31.468,71 contra 1.468,71) — rastro de teste do importador.
  Ficou meses invisível porque 22 mil linhas estavam órfãs de posto: a tela as mostrava como
  "sem posto", não como maio. Achada pelo gerente de TI, que só perguntou *"isto é simulação?"*.
  ⚠ A guarda da migration é a **data de importação**, não o ano/mês: em jan/2027 a folha de
  verdade ocupa essa competência, e apagar "2027-01" sem mais nada seria bomba-relógio para
  quem reexecutasse a migration depois.

  **A fonte da situação vem da FOLHA, com dedução como reserva** (v3_152). `RA_SITFOLH` — uma letra:
  `D` demitido, `A` afastado, `F` férias, vazio trabalhando — chega na *Relação de Funcionários* e
  a importação carimba em **`posto.sit_folha`**. Guardada no **posto** e não na pessoa porque a
  situação é por **vínculo**: a relação traz uma linha por (empresa, filial, matrícula), e alguém
  pode estar demitido numa empresa do grupo e ativo em outra. `situacaoPosto()` prefere a fonte e
  cai na janela `afast_ini`/`afast_fim` quando não há (posto criado à mão, ou que nunca casou).
  ⚠ **Férias não é dedutível** de nada — era por isso que afastado passava por ativo antes. O
  filtro da tela é por situação (4 estados, multi-seleção), não mais "só ativos / com demitidos".

  **"Considerar rateios" na grade de Postos** (18/nov) — o gerente do **CC 514** abria a tela e
  via **vazio** com **R$ 561.023** no orçamento dele: 10 pessoas de outras áreas, todas por
  rateio. O **214** recebe metade do José Eduardo (R$ 273.810) sem ter ninguém lotado nisso.
  Medido: **137 dos 316 postos** caem em empresa ou CC que não é o de origem — **R$ 17,5 mi pelo
  rateio de EMPRESA** e R$ 3,6 mi pelo de CC, então o lado da empresa é **5× maior**.
  ⚠⚠ **Não recalcula a cascata.** O Aplicar carimba `dims.posto_id` em **100%** das células e
  `rateio_pct` quando é parcial — o conjunto **já está gravado** em `fat_orcado`. Recalcular
  seria segunda fonte de verdade; lendo o fato, a tela e a DRE concordam **por construção**, que
  era o defeito original.
  ⚠⚠ **UNIÃO, nunca substituição.** No CC 224 há **29 lotados e só 26 com célula lá** — três têm
  o custo inteiro rateado para fora. Listar "quem tem célula aqui" os **tiraria**: ligar um botão
  para ver mais e ver menos.
  ⚠ Fora dos KPIs (meia pessoa rateada não é meia pessoa), **não editável** (o cadastro é de
  outra área), **salário integral** e **custo só da parte rateada**. Só depois do **Aplicar**.
  ⚠⚠ **Com o toggle LIGADO a tela inteira passa a responder "o que cai no meu recorte"** — não
  só a seção de chegadas. Antes as duas metades usavam regras diferentes (chegada rateada,
  lotado integral), e somá-las dava um número que não era nem o quadro nem o orçado do CC.
  Medido: **LUIS R. MULLA é lotado no 224, o motor diz R$ 597.385 e o 224 fica com R$ 0** — ele
  rateia tudo para fora, e a tela mostrava os 597 mil. São **147 dos 331** postos que rateiam
  para fora, então não é exceção.
  ⚠ **Desligado, nada muda** — nem linha, nem KPI, nem ordenação. `custoAnoVis`/`custoMesVis` só
  trocam a fonte quando o toggle está ligado; o comportamento de sempre é o certo ali, porque a
  pergunta é outra ("quanto custa esta pessoa").
  ⚠ **A memória de cálculo segue integral**, e a tela diz isso: ela é do POSTO, não do recorte.
  Sem avisar, seria o defeito do drill de novo — o detalhe contradizendo a linha que o abriu.
  ⚠ **Zero tem duas causas** e o número é honesto nas duas: rateia tudo para fora, ou o quadro
  ainda não foi aplicado (15 postos ativos sem célula, 4 com salário).

  ⚠⚠ **A % é POR DESTINO, e uma pessoa cai em VÁRIOS dentro do mesmo filtro.** Guardar o
  `rateio_pct` da primeira célula lida mostrava a fatia de **um** destino como se fosse a da
  tela — mesmo erro do drill, que exibia o lançamento de uma pessoa como o total da célula.
  Junta-se por destino (as 12 células do mês compartilham a %) e somam-se as fatias que caem
  no recorte.
  ⚠ **Provado por personificação antes de liberar acesso:** para `nappi.fernando`, **49 postos**
  alcançam o escopo dele e ele lê o cadastro de **37** — os outros **12** (José Eduardo, Luis
  Roberto Mulla, Gisele…) aparecem só com nome, matrícula, % e valor. É exatamente o estado que
  o teste com admin **nunca** mostra.

  ⚠ **A degradação por escopo é VISÍVEL de propósito:** nome, matrícula, % e valor saem de
  `dims` e funcionam para quem só alcança a célula; cargo e salário exigem o `posto`, que o RLS
  recorta — e aparecem como *"sem acesso ao cadastro de origem"*, nunca em branco nem zero.
  Sem isso o defeito só morderia quem não é admin, e quem desenvolve é admin.
  **Zero migration, zero mudança de RLS** — o acesso continua vindo do cadastro.
  ⚠⚠ **Efeito que GRAVA estado não depende de identidade de objeto.** O `useMemo` do recorte
  levava `acesso.canSeePessoas` nas dependências — e `useUserAccess` recria essa função a cada
  render. Resultado: objeto novo → efeito dispara → `setState` → render → objeto novo. **Laço
  infinito**, cujo sintoma é o *"lendo o orçado…"* piscando para sempre e a tela parecendo
  lenta quando está em ciclo. (O `filtrados` original usava `acesso.loading` justamente por
  isso; o defeito nasceu ao extrair o bloco.) Hoje o efeito depende de uma **chave primitiva**
  com o CONTEÚDO do recorte — identidade nova não reinicia leitura nenhuma.

  ⚠⚠ **Postos conta por SITUAÇÃO; o orçado sai por VIGÊNCIA — e os dois dizem "headcount".**
  Medido em 17/nov com filtro limpo: **304** na tela de Postos × **302** na aba *Análise Pessoas*.
  A diferença são exatamente **DIJAN DE BARROS** (vigência até 12/2026) e **MARCOS ROBERTO BARTH
  DE LIMA** (até 11/2026): não estão demitidos, então a grade os conta, mas o motor gera **zero**
  em 2027, o Aplicar não escreve nada e o dashboard — que lê `fat_orcado` — não os vê.
  **Nenhum dos dois números está errado**; eles respondem perguntas diferentes, e é a falta de
  dizer isso que faz parecer defeito. O KPI de Headcount passou a avisar quantos ficam sem custo
  no ano da versão.

  ⚠⚠ **MISTURAR TIPO DE CHAVE PARTE A PESSOA EM DUAS** (nov/2026). `pessoaChave` prefere
  `funcionario_id` e cai no nome — seguro enquanto a coluna estava **vazia em 100%**, inseguro
  desde que a `v3_149` passou a populá-la. Medido no **CC 411**: 13 postos, **5 pessoas**, a tela
  dizia **8**. Dez postos tinham id (chave = uuid), três não (chave = texto), e eram os `SOCIO_0x`.
  ⚠ **Acertar o NOME não resolve:** `LUIS RICARDO CISNEIRO` e `EMERSON WAGNER` já batiam letra
  por letra e contavam dobrado — uuid e texto nunca se encontram. Depois de o cadastro ser
  igualado, a regra antiga **ainda dava 8**; a nova dá 5.
  **`resolverPessoas(lista)`** resolve sobre o CONJUNTO: quem tem id ensina o id a quem só tem
  nome. Dois ids com o mesmo nome são homônimos de verdade e **não** colapsam.
  ⚠ No Organograma ela é construída sobre a lista **inteira**, não sobre o recorte filtrado: o
  posto que ensina o id pode estar fora do filtro.
  ⚠ **O orçado guarda o nome de quando o Aplicar rodou** (`dims->>'nome'`), então a aba *Análise
  Pessoas* segue com as duas grafias até o próximo Aplicar — ela não lê `posto`.

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

- ⚠ **Quem mostra valor de despesa aplica `fatorExibicao`, e quem GRAVA desfaz.** O banco guarda
  despesa negativa; a DRE mostra positiva. O drill mostrava o valor cru, então a **mesma célula**
  aparecia `+19.834,29` em *Orçar por linha* e `-19.834,29` ao abrir — e quem digitasse teria de
  lembrar do sinal. Hoje o drill recebe o fator por prop e converte nas duas pontas (`mostrar` /
  `paraBanco`), inclusive na comparação que decide se houve mudança. **Tela nova que edite
  `fat_orcado` precisa das duas conversões, não só da de exibição** — só a de exibição grava o
  sinal trocado, e o erro aparece meses depois no relatório.

- ⚠⚠ **O que se OFERECE na tela é outra pergunta do que o que se ENTREGA.** O dado de CC já tem
  duas camadas — `escopoFiltro`/`aplicaEscopo` cruzam o filtro da tela com o escopo VER, e o RLS
  recorta `fat_orcado` por CC desde a v3_129 —, então clicar numa área sem acesso devolve
  **vazio**, nunca o dado alheio. O que vazava era a **EXISTÊNCIA**: a pílula "Diretoria"
  aparecia com o nome da área para quem não alcança nenhum CC dela, e dava um botão que não faz
  nada. Auditei as 13 telas que montam `FiltrosButton`: **só o `OrcamentoDashPage` passava a
  lista crua** — as outras já usavam `filterList`/`filterPessoas`. É a pendência do F2 ("esconder
  opções fora de escopo nos dropdowns"), agora fechada nas telas.
  ⚠⚠ **A lista recortada é DERIVADA e não substitui a crua.** `escopoFiltro` decide se há
  restrição comparando `permitidos.length >= todos.length` — passando a lista já filtrada como
  `todos`, a comparação daria sempre "sem restrição" e **o escopo pararia de ser aplicado**. A
  crua alimenta o cálculo; a recortada, a interface.

- **Atalho de dimensão: `PillsDim` em `DashFiltros.tsx` (nov/2026).** "Por área" e "por divisão"
  são as perguntas do dia a dia, e chegar nelas custava cinco gestos: abrir o modal, achar a
  coluna certa entre seis, marcar, aplicar, fechar. As pílulas filtram num clique.
  ⚠ **Mora em `DashFiltros`, não na tela** — são ~10 dashboards lendo dali, e copiar as pílulas
  em cada um é o jeito de elas divergirem (uma ganha "Todas", outra não; uma ordena por código,
  outra por nome). Recebe a dimensão por parâmetro, então a segunda tela é **uma linha**.
  ⚠ **Toggle, várias ao mesmo tempo.** Nasceu escolha única (*"como fica SÓ o Comercial?"*) e
  estava errado para o uso real — comparar Comercial + Serviços é tão comum quanto olhar um.
  **As duas vias escrevem no mesmo estado**, então marcar na pílula aparece no modal e a contagem
  do botão *Filtros* acompanha: não há duas verdades. ⚠ *Todas* é a lista **vazia**, não "todas
  marcadas" — marcar as cinco dá o mesmo resultado (`effectiveCcFilter` ignora seleção que cobre
  tudo), mas vazio é o estado canônico e é o que o *Limpar* do modal produz.
  ⚠ Some sozinho abaixo de 2 valores: atalho com uma opção é enfeite ocupando a linha mais
  visível da tela.

- **A ponte É a memória de cálculo da fórmula (23/nov)** — a pergunta que a criou foi
  justamente essa, e ela respondeu com dois defeitos à vista.
  ⚠⚠ **O SINAL DO TERMO NA FÓRMULA ERA IGNORADO.** A ponte somava `destino − origem` de cada
  componente como se toda fórmula fosse soma. Em
  `=([1]-[111]+[130])+([2]-[205])+[Lmqrzyy5k]`, `[111]` (reembolso) e `[205]` (viagens) entram
  **subtraídos** — e entravam com o sinal trocado, que é **duas vezes** o erro:
  `2 × (454.965 + 130.906) = 1.171.742`, **exatamente** o "não explicado" que aparecia na tela.
  O resíduo denunciava, como foi desenhado para fazer; o que faltava era ler o denunciante.
  `sinaisDaExpressao` percorre a expressão com uma pilha de parênteses, então `-([2]-[205])`
  inverte os dois termos de dentro. ⚠ Termo subtraído leva `(−)` ao lado do nome: sem isso a
  linha mostra o número certo e o leitor não sabe de que lado ele entrou.
  ⚠⚠ **Fórmula com `*` ou `/` NÃO decompõe, e a ponte deixou de oferecê-la** (`ehDecomponivel`):
  numa razão não existe "quanto cada componente contribuiu" que some ao total — era oferecer e
  então errar em silêncio. É mais estreito que `formato = PERCENTUAL`, que é campo de exibição e
  está incompleto na base.
  ⚠⚠ **E a ponte do ACOMPANHAMENTO lia outra verdade que o cartão ao lado.** Ela recebia
  `tOrc`/`tReal` — `computeTotais` sobre o agregado cru, que **ignora o `filtro_escopo` da
  linha** —, enquanto o cartão vem de `totaisRelatorio`. *Margem Sustentação* (escopo
  `cc:[317]`) dizia **4.312.927** no cartão e **28.064.670** na ponte, a margem da empresa
  inteira: mesma linha, mesma tela, 6× de diferença e nenhuma pista de qual era qual. Hoje
  `setTotais` recebe os totais escopados, que saíram de dentro do `if (indicLines.length)` —
  a ponte precisa deles mesmo num relatório sem indicador.
  ⚠ **A regra geral é a do drill:** peça que decompõe um total tem de ler **a mesma fonte** do
  total que a abriu. Duas funções que "passam pelo motor" não são a mesma fonte.

- **A ponte NAVEGA (19/nov).** Trocar a linha no seletor era o único caminho, e analisar
  "de onde veio" é descer. Ícone `↳` na linha da tabela desce; a **trilha** acima do gráfico
  sobe. Medido: **54 das 170 linhas** se decompõem (27 por subtotal, 27 por fórmula) e a
  profundidade real é **4 níveis** — no máximo 3 cliques até a folha.
  ⚠ **Subir é um `↑` no CABEÇALHO da tabela**, na mesma coluna do `↳` de descer — não uma
  trilha acima do gráfico, que foi a primeira tentativa. A trilha mostrava o caminho inteiro,
  mas a profundidade real é **4 níveis** (no máximo 3 voltas) e o cabeçalho já nomeia onde se
  está: ela ocupava uma faixa da tela para repetir o que estava logo abaixo.
  ⚠⚠ **Subir segue o CAMINHO PERCORRIDO, não o `pai_id`.** Descendo por subtotal os dois
  coincidem; por **fórmula**, não — o EBITDA referencia `Despesas`, que é linha de topo com pai
  nulo, e o ↑ não teria para onde voltar. Metade dos pontos de descida é fórmula.
  ⚠ A trilha **não** entra no card: ele guarda a linha onde se parou, e reabrir é como entrar
  pelo seletor. Caminho é do momento, não da análise.
  ⚠⚠ **Mas o estado dela mora na PÁGINA, não no cartão.** Descer muda `secPonte.sel`, o que
  dispara a recarga, e enquanto `carregando` é true esta tela troca **todo** o conteúdo por
  "Calculando…": o `Ponte` desmonta e qualquer estado local morre. Na primeira versão a trilha
  nunca chegou a aparecer. **Estado que precisa sobreviver a uma recarga não pode viver num
  componente que a recarga desmonta** — vale para qualquer cartão desta tela.
  ⚠⚠ **O MESMO botão de nível significa coisas diferentes nos dois cartões, e é deliberado.**
  Na **ponte** é **cumulativo** (*até 2* = níveis 1 e 2): seletor de ponto de partida, e esconder
  o nível 1 ao pedir mais profundidade surpreenderia. Em **"O que mudou"** é uma **partição**
  (*2* = só o nível 2 + folhas acima): ali a lista precisa **somar**, e incluir o nível 1 junto
  conta o mesmo dinheiro duas vezes.
  O **visual é idêntico** — os dois usam o componente `Grupo`, para não divergirem na primeira
  alteração — e a diferença é dita **no texto de cada cartão**, nunca no estilo do botão. Só o
  quarto valor difere, porque os extremos são outros: `tudo` na ponte, `folhas` no ranking.
  ⚠ **Pílula de natureza também na ponte**, mesma regra dos dois: só na aba Linhas.
  ⚠ **O seletor começa no nível 1** — ele escolhe o ponto de partida; descer é com o `↳`. Eram
  170 opções indentadas, rolagem longa para achar o que a navegação alcança num clique.
  ⚠⚠ **`linhasConciliaveis` NÃO serve à ponte — filtro certo para a pergunta errada.** Ele existe
  para a conciliação ("linha de fórmula tem total mas não tem folha a conciliar contra"), e numa
  ponte isso não importa: o que importa é ter **valor e componentes**, e um indicador de fórmula
  tem os dois mesmo sem conta própria. Emprestado, derrubava **13 dos 23 indicadores** — a lista
  caía para 4 e sumiam `Custo Pessoas`, `Folha direta`, `Margem bruta`, justamente as
  decomposições que se quer olhar.
  ⚠ E **todos os 23 indicadores já são nível 1**, então o filtro de profundidade nunca tirou
  nenhum — o sintoma apontava para ele, a causa era o outro.
  ⚠ **A linha ATUAL entra na lista mesmo fora do nível 1.** O seletor é o "onde estou":
  descendo para uma linha de nível 2 ela não estava entre as opções e o combo voltava a
  "— linha de resultado —" — vazio **justamente depois de navegar**. Vale também ao reabrir,
  porque o card guarda a linha onde se parou e ela pode ser funda.
  ⚠ **O seletor usa a MESMA regra do `↳`** — oferecer linha que não decompõe abre ponte vazia,
  que é o "offer and then refuse" evitado no ícone. Sobram **8 em Linhas e 11 em Indicadores**.
  Saiu o `Headcount médio (FTE)` (ANALITICA com master, única de nível 1 sem componentes) e as
  8 percentuais.
  ⚠⚠ **`formato` serve a EXIBIÇÃO e está sendo usado para responder "isto é uma razão?".**
  Coincide no percentual e **falha na TAXA**: `Receita por FTE (mês)` e `Custo médio por pessoa`
  são R$/FTE, decompõem e somariam taxas — e marcá-las `PERCENTUAL` as exibiria com `%`, o que
  seria pior. O enum não tem "índice". Fica o resíduo denunciando; se virar incômodo, é campo
  novo, não truque de filtro.
  ⚠⚠ **EBITDA e Resultado Líquido são `INDICADOR`**, então caem na aba *Indicadores* — e são
  justamente os pontos de partida mais prováveis de uma ponte. Quem procurar em *Linhas* não
  acha. É fiel à estrutura, mas contraintuitivo: se incomodar, o conserto é de cadastro
  (`tipo_linha`), não de filtro na tela.
  ⚠ **Percentual não desce** — somar pontos percentuais não fecha. O campo é `formato`, e ele
  está **incompleto**: `LER Bruto`, `LER de Margem`, `dLER` e `mLER` são razões marcadas
  `NUMERO` e escapam. **Conserto é de CADASTRO**, não lista de nomes — nome chumbado funciona
  nesta DRE e quebra na próxima.
  ⚠⚠ **O SENTIDO DA PONTE É A PERGUNTA, e o default errado inverte a leitura (19/nov).**
  A ponte ia sempre `comparado → analisado`: certo entre dois **orçamentos** ("saí de 2026 e
  cheguei no 2027 que estou montando" — o destino é a coisa sendo construída), e **invertido**
  contra o realizado, onde o plano é a REFERÊNCIA e o realizado o resultado.
  Medido na tela: *Despesas* com realizado −72,5 mi contra orçado −67,4 mi aparecia
  **+5.061.499 ↓ gasto, em VERDE** — frase verdadeira sobre a seta desenhada ("indo do realizado
  para o orçado, o gasto cai") e que **ninguém pergunta**; o que houve foi estouro de 5,06 mi.
  Hoje o default segue o **modo** (`Orçado × Realizado` → orçado→realizado; `Orçado × Orçado` →
  comparado→analisado) e um botão inverte, dizendo **por extenso** de onde para onde — ⇄ sozinho
  não informa para que lado aponta agora.
  ⚠ **A Ponte deixou de saber o que é orçado**: recebe `origem`/`destino` e quem decide é a
  página. Foi isso que fez o sentido ser um botão em vez de um `if` espalhado pelo componente.
  ⚠ **A semântica se corrige sozinha** — cor e `↑ gasto / ↓ gasto` saem do sinal cru cruzado com
  a natureza, então a despesa estourada vira vermelha com `↑ gasto` por construção. Inversão que
  não exige caso especial é a evidência de que o modelo de sinal está certo.
  ⚠ **`undefined` é "siga o modo"**, não um valor: gravar o sentido resolvido faria a escolha
  automática virar escolha fixa no primeiro salvamento (mesma distinção intenção × estado do
  preset do relatório). Card sem a chave não apaga a escolha de quem está na tela.
  ⚠⚠ **O sentido é do CABEÇALHO, e rege a aba — não é ajuste de um cartão.** A primeira versão
  pôs o botão dentro da ponte, e aí *O que mudou* continuou em `analisado − comparado` enquanto
  a ponte ia ao contrário: **a mesma linha com sinais opostos na mesma tela**. Hoje é um campo
  do cabeçalho (*Sentido da leitura*, com a frase inteira — "de X para Y") e os dois quadros o
  seguem: a ponte como narrativa, o ranking como ordem das colunas e sinal de `variação`.
  ⚠ Aparece **só na aba Comparativo**: em *Orçamento* o protagonista é o plano e o comparado é um
  Δ discreto nos cards; em *Análise Pessoas* não há comparação.
  ⚠⚠ **A Acurácia NÃO segue, de propósito** — e o quadro diz isso. Ela não compara `base × comp`:
  compara o **orçado de um ano com o realizado do mesmo ano**, e `erro = realizado − orçado` é a
  única direção que existe. Orçamento se mede contra o que aconteceu, nunca o contrário; oferecer
  a inversão ali seria um controle que não significa nada.
  ⚠⚠ **No modo Realizado a versão de comparação faz DUAS coisas**, e o código afirmava que
  fazia uma só ("a versão só serve para dizer o ANO"). Ela diz o ano do realizado — a ponte e
  *O que mudou* leem `serie('REALIZADO', anoComp)` e não olham a versão — **e** escolhe qual
  orçamento daquele ano a *Acurácia* confronta com esse realizado (`chamar(vComp, [anoComp])`).
  Sintoma: três versões de 2027 viravam três **"Realizado 2027" idênticos** no combo — rótulos
  iguais para opções que **não são equivalentes**, já que trocar entre elas muda a Acurácia
  inteira. ⚠ **Deduplicar por ano seria o conserto errado**: apagaria a escolha e elegeria uma
  versão em silêncio, a armadilha do `ON CONFLICT` de novo. O rótulo passou a dizer a segunda
  coisa (`· acurácia vs <código>`) e **só onde há mais de uma versão no ano** — sufixo em toda
  linha deixa de informar.

  ⚠ Em *O que mudou* o denominador do limiar virou o **destino**. No modo Orçado × Orçado o
  destino é o analisado, que é exatamente o que já era — trocar o sentido não remexe nos limiares
  de quem compara orçamentos.

  ⚠⚠ **O Δ do resultado não estava em lugar nenhum (19/nov).** A tabela dava o valor inicial,
  cada componente e o valor final — e **a soma que tudo aquilo explica** ficava para o leitor
  fazer de cabeça, justamente o número que a ponte existe para decompor. No gráfico ele é só a
  **distância entre as duas barras roxas**, que se lê por aproximação. Hoje vai no **cabeçalho da
  coluna**, acima de *efeito no resultado*: a resposta antes do detalhe que a explica, com o % ao
  lado (nulo quando o inicial é zero — "∞%" não informa).
  ⚠ **A linha de resultado também pode ser DESPESA** — é o que acontece ao descer para
  `Despesas` —, então o Δ do cabeçalho leva o mesmo **↑ gasto / ↓ gasto** das linhas. O aviso tem
  de estar junto do número que engana, aqui como lá.

  ⚠ **Limite de barras é só do GRÁFICO** (uma linha tem 45 filhas); a tabela mostra tudo. O
  resto vira **uma barra "outros"**, nunca é descartado — sem ela a cascata não chega ao total e
  o gráfico mente. E o **resíduo fica fora do agrupamento**: ele é o aviso.
  ⚠ **Saíram `usar os da estrutura` e o seletor de componentes.** Só existiam um por causa do
  outro — um deixava mexer à mão, o outro desfazia —, e componente escolhido a dedo faz a ponte
  não fechar. Card antigo com escolha manual **se re-deriva sozinho**, senão ficaria preso nela
  sem caminho de volta pela tela.

- **"Quem causou a variação" — a ponte pelo outro eixo (19/nov).** A ponte decompõe o Δ por
  LINHA; este quadro decompõe **o mesmo Δ** por empresa · área · divisão · BU · CC. Usa a linha
  de resultado da ponte, então descer lá move os dois juntos e os totais fecham por construção.
  Existia porque responder "qual área estourou?" era marcar a área no filtro, ler, desmarcar e
  repetir — cinco gestos por área e nenhuma comparação lado a lado.
  ⚠ **O motor roda POR DIMENSÃO.** A linha de resultado costuma ser fórmula ou subtotal; somar
  `orcado` das folhas daria um número que não existe na DRE — mesma mecânica do gráfico por
  empresa. O detalhe que abre no clique são **os componentes da ponte** naquela área: literalmente
  "a ponte daquela área".
  ⚠ **No caso típico não custa consulta nenhuma.** `relatorio_linha_empresa_agg` e
  `dashboard_cc_agg` já devolvem `orcado` **e** `realizado` do ano pedido, então Orçado2026 ×
  Realizado 2026 sai das chamadas que a tela já fazia. Só orçado × orçado, ou ano diferente,
  pede uma segunda leitura. Área, divisão e BU são **atributos do CC**, então os três saem da
  mesma leitura e trocar entre eles não custa nada.
  ⚠⚠ **A ATRIBUIÇÃO DOS DOIS LADOS É ASSIMÉTRICA, e isso faz toda área parecer que economizou.**
  Medido na DRE Gerencial/2026: **100% do orçado tem centro de custo e só 81,8% do realizado**
  (18,2% — R$ 22 mi de 120,6 mi — são lançamentos do razão sem CC). Comparando por área, o
  realizado de cada uma chega menor do que é e o excedente aparece inteiro em *(sem centro de
  custo)*: cada número certo, conclusão falsa. O quadro **calcula a assimetria do próprio bruto**
  (em magnitude, acompanhando relatório, período e filtro) e avisa acima de 2 pontos de
  diferença, dizendo para comparar as áreas **entre si**, não contra o orçado delas.
  ⚠ **Por empresa não existe o problema**: `empresa_id` é preenchido nos dois fatos (0 nulos
  medidos em 2026, nas duas tabelas).
  ⚠⚠ **A CAUSA, medida (19/nov) — são DUAS, e nenhuma é lançamento desleixado.** Dos R$ 22 mi
  sem CC na DRE Gerencial/2026:
  **(1) R$ 12,93 mi são `30101 Receitas Financeiras`** — 98% sem CC, em **todas as 10 empresas**.
  Legítimo: resultado financeiro não pertence a centro de custo. ⚠ E ela **não é orçada em 2026**
  (só em 2027), então mesmo com CC não haveria o que comparar.
  **(2) R$ 8,98 mi são a empresa `XX PARAGUAI`, e é falha real.** 1.750 lançamentos, todos os
  meses, origem `IMPORT`, **filial também nula em 100%**. Não é um lote ruim — os **quatro** lotes
  do ERP vêm 94–100% sem CC (`008810` 96% · `008820` 100% · `008850` 95% · `008890` 94%), logo é
  a origem. Medido: o **orçado** do PY está em 5 CCs (111 · 214 · 314 · 411 · 514) e **0% sem
  CC**; o realizado tem CC em **357 de 7.643** (4,7%) e, quando tem, usa CCs **legados**
  (`100 Adm(legado)`, `300 CC Serviços(legado)`, `400 Diretoria(Legado)`) — plano antigo.
  ⚠ **No Brasil, fora Receitas Financeiras, é ZERO.** A amarração de CC do razão brasileiro está
  íntegra; o problema é exterior (ver a memória *Exterior PY/BO — pausado*) e tem de ser
  resolvido no perfil de importação ou num CC padrão por empresa, não na tela.
  ⚠ Por isso o aviso manda **trocar para Empresa** quando dispara: ali os dois lados estão sempre
  atribuídos e o buraco aparece concentrado em uma.

  ⚠ O sustinho inicial foi ler "71% do realizado sem CC" sobre o razão **inteiro** — são as
  contas de BALANÇO (Fornecedores, Empréstimos, Reservas, Lucros Acumulados), que não têm centro
  de custo nem entram na DRE. **Restringir ao universo do relatório é parte da medição**, não
  refinamento.
  ⚠ O resíduo *não atribuído a nenhum grupo* tem as mesmas três causas conhecidas: linha com
  `filtro_escopo` próprio (o agregado por dimensão não o aplica), projeção ligada e recorte de
  empresa entre as duas RPCs. Aparece como linha, igual ao resíduo da ponte.

- ⚠⚠ **CAPACIDADE PRODUTIVA · SERVIÇOS (`v3_199..201`, 23/nov).** Confronta o tamanho da equipe
  com a receita orçada, e a resposta sai como **valor-hora implícito** (receita ÷ horas
  vendáveis), que é comparável com o preço praticado — um gap em reais ninguém sabe interpretar.
  **TRÊS PAPÉIS, e o terceiro custou uma migration extra.** `PRODUCAO` e `COORDENACAO` vendem
  hora (R$ 200 e 250) e entram na margem direta; `ESTRUTURA` não vende e entra só na margem da
  área. A v3_199 nasceu com dois e **fundiu naturezas diferentes**: medido, *Coordenador de
  Projetos* aponta 99 h/mês e *Gerente Executivo* e *Diretor* apontam **ZERO** — com os dois a
  R$ 250/h o quadro criaria **R$ 5,8 mi de capacidade inexistente**, e o erro seria invisível
  porque a conta fecharia. ⚠ `ESTRUTURA aponta: nenhuma hora` é a conferência que prova o corte.
  ⚠ **Nem o CC nem a área funcional distinguem** — analista e coordenador dividem os dois. Quem
  distingue é o **cargo**: `cargo.papel_servico` é a regra e `posto.papel_servico` a exceção, com
  precedência `posto → cargo` (a mesma de `posto.recebe_hora`). ⚠ **Nulo no posto é "siga o
  cargo"**, por isso ele nasce nulo em todos: semear em massa congelaria a regra e mudar o cargo
  deixaria de surtir efeito, calado.
  ⚠ **A regra de nome SEMEIA, não governa** — roda uma vez na migration. `GERENTE` sozinho
  pegaria o *gerente de projeto*, que vende hora; o que distingue é o par `GERENTE EXECUTIVO`.
  ⚠⚠ **O FATOR DE UTILIZAÇÃO É A ALAVANCA, e é editável.** O apontamento dá 162 h/mês na produção
  (101% sobre 160), mas isso **não é utilização faturável**: inclui hora extra e projeto interno,
  e a literatura põe IT services em 70–80%. Com 80% a capacidade cai de R$ 55,5 mi para 43,9 mi
  e **o quadro inverte, de folga para déficit**. O medido fica à vista ao lado do campo: número
  sem origem vira chute com casas decimais.
  ⚠ **Headcount por VIGÊNCIA, não por situação** — quem sai em 11/2026 aparece no quadro de hoje
  e gera zero em 2027. ⚠ **Intercâmbio fora das horas** (10,6% do total, até 50% em alguém): é
  receita de outra empresa do grupo, com contrapartida em *Repasses*.
  ⚠⚠ **TUDO SOBRE A RECEITA LÍQUIDA, e o imposto é PROPORCIONAL às linhas marcadas.** É o mesmo
  raciocínio do `[130]*([111]/[1])` da fórmula `Margem Serviço` do DRE: tirando o reembolso da
  receita, o imposto que incidia sobre ele sai junto. Aqui a conta é a recíproca — do imposto da
  área fica a fração que cabe à receita escolhida.
  ⚠ **A fórmula do DRE não tem erro no numerador** (`[1]-[111]+[130]` já é líquido); o que falta
  lá é o **denominador** do `%` usar a mesma base, senão o percentual sai subestimado.
  ⚠⚠ **O quadro ESTAVA EXCLUINDO as outras despesas da área** — só somava `origem POSTO` e
  terceiros, então aluguel, software e administrativas ficavam de fora e a margem da área saía
  **superestimada**. Hoje *Demais despesas* é o **RESTO** (total da área − pessoal − terceiros −
  viagens): somar linha a linha exigiria marcar dezenas e qualquer esquecimento viraria margem a
  mais, calado.
  ⚠ **Viagens sai dos DOIS lados** (`[2]-[205]` do DRE): o reembolso saiu da receita, então a
  despesa reembolsável sai junto.
  ⚠ **A cascata é "quem executa" → "quem apoia"**: receita líquida → pessoal próprio
  (**margem direta**) → terceiros (**margem com terceiros**) → demais despesas (**margem da
  área**). Terceiro é **mão de obra contratada**, quase tão direto quanto o próprio — agrupá-lo
  com aluguel e software esconderia que a entrega depende dele. ⚠ Mas fica **fora da
  capacidade**: somá-lo ali faria a capacidade crescer com a contratação, e a pergunta
  *"cabe na equipe?"* deixaria de existir.
  ⚠ As margens vão em **cascata**, não em cartões: percentuais lado a lado para "margem de
  serviços" parecem contradição; em cascata, cada um é o anterior menos um custo nomeado.
  ⚠ **Os totais saem de `totaisRelatorio` recortado pela ÁREA**, não de `base` (filtro da tela):
  é a mesma função do relatório, então batem com a DRE por construção — `filtro_escopo` incluído.
  ⚠⚠ **O quadro é o que está no FILTRO, e ele diz isso.** Sem recorte de CC soma a empresa
  inteira e chama de Serviços — a capacidade triplicaria e a conta fecharia, errada e plausível.
  ⚠⚠ **A ÁREA É UM SELETOR DO QUADRO, e o recorte vai na CHAMADA.** A primeira versão só
  avisava "sem filtro de CC isto soma a empresa inteira" — e mostrava **247 FTE de produção**
  quando a área tem 143: número plausível e errado, o pior tipo. Hoje a RPC recebe os CCs da
  área escolhida, **interseccionados com o filtro da tela** (quem filtra "Serviços › Base" vê só
  aquilo); interseção vazia esconde o quadro, que é um quadro de Serviços. ⚠ `'3'` não fica
  chumbado: é cadastro desta instalação, o mesmo eixo do `filtro_escopo` da *Margem Serviço*
  (`{"area":["3"]}`), e o seletor é o que torna o quadro reusável nas outras áreas.
  ⚠⚠ **Receita e terceiros são LISTAS de linha, com proteção contra dupla contagem.** Uma linha
  só era restritivo — a receita pode ser a agrupadora **ou** várias filhas (Horas Abertas + Banco
  de Horas + Projetos Fechados…). Marcar uma linha **desmarca a agrupadora dela e as filhas**:
  é o defeito da ponte e do botão *Seções* outra vez, e aqui seria pior — a receita dobraria e a
  capacidade pareceria insuficiente por um erro de seleção.
  ⚠ **Capacidade e custo são da ÁREA; a receita é do filtro da tela.** Medido: 99% da receita de
  serviços de 2027 está na área 3, então a diferença é pequena — mas existe, e o quadro a declara.
  ⚠ A receita sai de `base` (já filtrada), não do banco: somando a linha direto, a **Bolívia**
  entrava com R$ 7,4 mi **sem equipe no CC 3** e o quadro ficava 13% otimista — erro que eu
  cometi ao desenhar este quadro.
  ⚠ Os parâmetros vão para o **preset do card**, não para tabela: cada diretor salva o cenário
  dele e a conversa é comparar os cards.

- **A PONTE virou `lib/Ponte.tsx` e entrou no acompanhamento (23/nov).** A extração custou pouco
  porque a Ponte **já havia deixado de saber o que é orçado**: recebe `origem`/`destino` e quem
  decide qual lado é qual é a página — foi a mudança do *sentido da leitura* (22/nov) que a
  tornou portátil, um dia antes de precisarmos disso.
  ⚠ **O que a prendia era o ESTILO, não a lógica**: ela usava 3 chaves de um objeto `S` da tela.
  Hoje `S` é prop **opcional** com `S_PONTE` de fallback, então a análise continua passando o
  dela (aparência intacta) e o acompanhamento não passa nada.
  ⚠ **No acompanhamento o sentido é FIXO** (orçado → realizado): lá a tela faz uma pergunta só, e
  seletor com uma resposta é controle morto. Na análise ele é escolhido porque a comparação pode
  ser entre dois orçamentos.
  ⚠ Usa `tOrc`/`tReal`, que já passaram pelo motor e são os mesmos números do KPI — **a ponte não
  recalcula nada, decompõe o que a tela já mostra**. Trilha e navegação ficam na **página**:
  `loading` troca o conteúdo inteiro e desmontaria o componente com o caminho percorrido junto.
  ⚠ Vem **depois dos indicadores** de propósito: os cartões respondem "quanto", a ponte "de onde
  vem" — e a segunda pergunta só faz sentido depois da primeira.

- **A ponte abre o RAZÃO (23/nov).** Clicar no **valor** (ou na barra) de um componente abre o
  `DrillModal` daquela linha; o `↳` do nome continua descendo na ponte. É o mesmo par de gestos
  que o drill do relatório já usa — *"clique no nome para descer; clique numa barra/valor para o
  razão"* —, e o sublinhado pontilhado é o que diz que ali há um clique.
  ⚠ **A Ponte NÃO sabe o que o drill faz.** `onDrill` é opcional e só avisa que houve clique:
  quem conhece relatório, versão, período e filtros é a **página**, que já monta o modal com o
  recorte certo. Trazer esses parâmetros para dentro do componente devolveria o acoplamento que
  o impedia de viver fora de uma tela.
  ⚠ Resíduo e *outros (N)* não abrem — não são linha de relatório —, e o cursor não promete que
  abrem.
  ⚠⚠ **`soOrcado` deixou de ser fixo na análise.** A tela abre o drill de vários pontos que só
  falam de orçado (por área, por empresa), e lá o realizado é ruído; vindo da ponte em
  `Orçado × Realizado`, o razão é justamente o que se foi buscar. O `drill` passou a carregar
  `comReal`.
  ⚠ **E só quando os anos COINCIDEM:** o `DrillModal` recebe UM conjunto de anos e lê os dois
  lados dele. Com `Orçado2027 × Realizado 2026`, pedir o realizado de 2027 devolveria vazio — e
  vazio parece *"não houve movimento"*, não *"perguntei o ano errado"*.

- **Ordenar coluna no "Quem causou" (23/nov).** `Tabela` já ordenava por clique desde sempre,
  então *O que mudou* e *Acurácia* já tinham; faltava o *Quem causou*, que é `<table>` à mão por
  causa das linhas que expandem no clique.
  ⚠⚠ **A SELEÇÃO DOS 12 CONTINUA POR IMPACTO — a ordenação só reordena esses.** Ordenar antes de
  cortar mudaria o significado de *outros*: por nome, os 12 primeiros seriam os alfabéticos, e o
  quadro passaria a esconder as áreas que mais mexeram no resultado **justamente quando se
  ordena por outra coluna**.
  ⚠ Três cliques (desc → asc → volta ao impacto): sem o terceiro estado não há como desfazer a
  ordenação sem recarregar.
  ⚠ **"% do Δ" não ordena**: é o `delta` sobre uma constante, então daria exatamente a mesma
  ordem — coluna clicável que repete outra ensina que o clique não faz nada.

- **Os TRÊS quadros de variação agora servem às duas telas (23/nov).** `lib/Ponte.tsx` e
  `lib/AnaliseVariacao.tsx` (ranking *O que mudou* + *Quem causou a variação*, com `Tabela`,
  `useCorte` e a partição em nível) saíram de `OrcamentoDashPage`, que caiu de **2.495 para
  1.946 linhas**. A mesma variação por três eixos — por LINHA (ponte), por DIMENSÃO (quem
  causou) e como RANKING (o que mudou) —, os três fechando no mesmo Δ, que é o que permite ler
  um contra o outro.
  ⚠ **A extração só foi barata por causa do que veio antes:** os três já recebiam
  `origem`/`destino` e não sabiam qual lado era o orçado. O que os prendia era o **objeto de
  estilo da página** — hoje `S` é prop opcional com `S_PONTE` de fallback.
  ⚠⚠ **No acompanhamento isso custou ZERO consulta.** `relatorio_linha_empresa_agg` e
  `dashboard_cc_agg` já traziam `orcado` **e** `realizado` e já eram carregados ali — faltava
  alguém guardar os dois lados em vez de descartar um.
  ⚠ As duas convenções de sinal convivem na mesma tela, cada peça com a sua: o ranking usa
  `val`/`fatorExibicao` (despesa positiva) e a ponte usa o sinal econômico cru, que é a exceção
  já declarada neste documento.

- **Indicadores do acompanhamento reordenam por arrasto (23/nov) — sem campo novo.** `indicSel`
  **já era** a lista de quais exibir, já persistida no localStorage e no preset do card; só não
  era usada como ORDEM, porque a renderização filtrava `indicCards` (ordem da estrutura) em vez
  de percorrer a seleção. O array guardava a ordem e a tela a ignorava.
  ⚠ `.filter(Boolean)` ao percorrer: id de indicador que não existe mais (relatório trocado) some,
  como o filtro antigo fazia de graça.

- **"% EBITDA por empresa" no lugar de "Relatório inteiro por empresa" (22/nov).** O card da
  esquerda somava as folhas de cada empresa — no escopo "Relatório inteiro" isso **não é número
  de lugar nenhum da DRE**, o mesmo defeito do gráfico mensal. E pior: ao lado do *EBITDA por
  empresa*, repetia a leitura — as duas barras maiores eram a mesma empresa pelo mesmo motivo.
  A margem responde o que o valor não responde: *a maior é também a mais eficiente?*
  ⚠ Usa a **linha percentual do próprio relatório**, não `EBITDA ÷ receita` calculado aqui: se
  "% EBITDA" é sobre receita líquida ou bruta é decisão do **cadastro**.
  ⚠⚠ **`ebNode` pegava a PRIMEIRA linha com "ebitda" no nome** — se `% EBITDA` viesse antes na
  ordem, o gráfico de VALOR mostraria percentual, em silêncio. Agora cada um é escolhido pelo
  `formato`, que é o campo que diz isso.
  ⚠ **Percentual difere em PONTOS percentuais**: o tooltip mostra `pp`, não `%`. "Δ 2,3" sem a
  unidade seria lido como 2,3% de variação, que é outro número.
  ⚠ Cai no gráfico antigo quando o relatório não tem linha de % EBITDA (o Balanço) — leitura
  imperfeita é melhor que card vazio.

- ⚠⚠ **A ORDEM DOS CENÁRIOS É INFORMAÇÃO, e o sort alfabético a jogava fora (v3_198, 22/nov).**
  No Comparativo **o Δ é a 2ª série menos a 1ª** — ordem não é cosmética. `expandirCens`
  ordenava as versões pelo CÓDIGO, então `ORC2027_PRELIM` vinha sempre antes de `Orçado2027`
  por **acidente de alfabeto**, e quem queria ler o preliminar *contra* o orçado via o sinal
  invertido sem ter como mudar: o seletor é um **checkbox**, e checkbox não expressa ordem.
  ⚠ `toggleCen` sempre acrescentou no fim — **a intenção estava gravada o tempo todo**, era a
  leitura que a descartava. O conserto foi tirar o sort, não criar campo novo.
  ⚠ **O modal ganhou a lista "Ordem das colunas" com setas**, e ela diz qual Δ sai (`B − A`).
  Regra que existe e ninguém alcança é regra que não existe — e aqui a tela era justamente o
  lugar onde a ordem parecia não importar.
  ⚠⚠ **A migration das visões gravadas é PARCIAL de propósito:** realizado vai para o **fim**
  (isso não era acidente, é semântica — plano antes de resultado; sem o passo, "O x R Mensal
  2026", gravada como `{REALIZADO, Orçado2026}`, inverteria sozinha e o usuário descobriria pelo
  sinal do Δ), mas **entre versões a ordem gravada fica como está** — ali o alfabeto era
  arbitrário, e devolver a ordem de marcação é o conserto. Reordenar tudo pelo critério antigo
  seria "preservar" o defeito.
  ⚠ Os `REALIZADO@<ano>` do modo ciclo são **gerados**, não escolhidos: continuam ordenados por
  ano, na posição em que o `REALIZADO` estava.

- ⚠⚠ **CENÁRIO ÓRFÃO NA VISÃO FAZIA O Δ SUMIR (v3_197, 22/nov).** A visão "Orçado 2007 x 2027
  Preliminar" parou de mostrar Δ e Δ%: ela guardava **três** cenários, e o do meio era uma versão
  **excluída**. `view_config.cenarios` é `text[]` **sem FK** — nem podia ter, porque o array
  mistura id de versão com as chaves especiais `REALIZADO`, `REALIZADO@<ano>` e `REALIZADO_ANT` —,
  então apagar a versão não limpou nada.
  ⚠⚠ **O sintoma não apontava para a causa**, e é isso que torna o caso caro: o Δ só existe com
  **exatamente 2 séries** e o morto contava como terceira. Some a coluna que interessa, aparece
  uma rotulada `—`, e o modal *Editar visão* mostra **2 marcados** — porque ele itera as versões
  que existem. O estado inválido era invisível **justamente na tela onde se iria procurar por ele**.
  **Três pontas:** gatilho `AFTER DELETE` em `versao_orcamento` limpando o array (a exclusão
  acontece por Cadastros, por `excluir_cenario` e por SQL à mão — regra de tela não alcança
  nenhum dos três); limpeza do que já estava gravado; e o frontend **descartando na leitura e
  AVISANDO**. ⚠ Filtrar em silêncio esconderia o problema: a visão voltaria a funcionar e
  continuaria gravada errada, levando o defeito para todo relatório feito a partir dela.
  ⚠ O filtro é "**parece uuid E não existe**": só "não existe" removeria `REALIZADO`; só "parece
  uuid" removeria as versões boas.
  ⚠⚠ **O AVISO MANDAVA FAZER O QUE REINSERIA O ÓRFÃO.** A grade descartava a versão morta na
  LEITURA, mas o modal guardava o array **cru** — então "abra *Editar visão* e salve" regravava
  exatamente o que a migration tinha acabado de remover, e o defeito voltava com cara de teimoso.
  Hoje o modal **normaliza ao abrir**, e aí a instrução faz o que promete. **Lição: filtrar na
  leitura não basta quando existe um caminho que grava o estado cru de volta** — o conserto tem
  de alcançar a escrita.
  ⚠ E o filtro do modal só vale com `versoes` **carregada**: com a lista vazia ele apagaria todos
  os cenários e um *Salvar* gravaria a visão em branco — o conserto destruindo o que veio
  consertar.

- ⚠⚠ **O PDF cortava card ao meio porque fatiava em alturas IGUAIS (22/nov).** `exportarPdf`
  rasteriza a tela num PNG e dividia por `h / páginas` — o corte caía onde calhasse. Hoje cada
  corte **recua para o topo do card que atravessaria**, então as páginas têm alturas diferentes
  e o total só se conhece depois de calcular.
  ⚠ **Os cards são medidos DURANTE a captura**, com as barras `data-noexport` já escondidas e as
  rolagens expandidas: medidos antes, cada um estaria deslocado pela altura da barra de filtros
  e o corte erraria com ar de acerto.
  ⚠ **Heurística declarada:** card é quem tem `border-radius >= 8px` e altura >= 36px (o piso
  tira os botões). Exigir um atributo em toda tela seria mais exato e teria o defeito que este
  projeto já cometeu três vezes — motor pronto, marcação esquecida na tela nova, defeito de
  volta sem ninguém entender. `data-bloco` existe como escape explícito e tem precedência.
  ⚠⚠ **Bloco MAIOR que a página sai da conta.** Recuar por ele é o pior dos mundos, e só o teste
  mostrou: um card de 600px com página de 300 fazia a página anterior terminar em **100px** e o
  card era partido do mesmo jeito 300px adiante. Não cabendo, o corte cego é a resposta certa.
  ⚠ **O recuo tem piso (25% da página)**: sem ele, uma sequência de cards altos geraria páginas
  com dois dedos de conteúdo.
  ⚠ `exportarDash.teste.mjs` cobre os 8 casos e **a lógica errou em 2 na primeira escrita** —
  nenhum dos dois visível lendo o código. Lógica que decide onde cortar papel merece casos
  escritos, mesmo num projeto sem runner.

- ⚠⚠ **Rótulo de eixo: `fmtEixo` em TODOS, e a varredura achou 21 fora (22/nov).** O drill abria
  com `1.000.0002.000.0003.000.000` colados — o eixo deixava de dizer escala, que é a única
  função dele ali. `lib/fmtEixo.ts` existia desde out/2026 **e só tinha chegado a 3 eixos**,
  enquanto o próprio arquivo avisava "ao mexer em eixo de gráfico, usar este".
  Medido na varredura: **`fmtK` em 18** (`DashboardPage` e `BalancoDashboardPage`, com a função
  **copiada literalmente** nos dois — divide por mil sempre, então 13,7 milhões viravam
  `13.770k`), **`fmt` cheio em 3** (os dois eixos Y do *Orçamento — análise* e o drill) e `fmtC`
  no Comparativo.
  ⚠ **Nem tudo virou `fmtEixo`, e as exceções têm razão:** o eixo do CAGR é **percentual**; e o
  `fmtC` formata conforme o **tipo da linha** — hoje ele mantém `formatValor` no percentual (onde
  "12,4%" é a informação) e delega o resto. ⚠ `fmtRow` **não** foi tocado: ele serve ao eixo
  **e à tabela**, e na tabela o valor cheio é o certo.
  ⚠ **Um uso de `fmtK` sobreviveu, renomeado para `fmtPonto`**: o valor escrito SOBRE o ponto da
  linha, onde a precisão importa para comparar meses — `1.536k` distingue o que `1,5 mi` achata.
  O nome passou a dizer o papel, que é o que impedia de notar a diferença.
  **A lição é a do padrão do erro:** função utilitária criada para unificar não unifica sozinha —
  ou se varre tudo no mesmo passo, ou nasce a quarta convenção.

- ⚠⚠ **GRÁFICO QUE SOMA FOLHAS NÃO É A LINHA DO RELATÓRIO (22/nov).** No acompanhamento, o
  cartão *Orçado × Realizado por mês* somava `leaves` — as folhas **ANALITICAS** com master —,
  enquanto o KPI ao lado lia o **nó** `Resultado Líquido` pelo motor. Duas definições de "o
  resultado" na mesma tela, e **a maior era a errada**: a soma de folhas ignora `tipo_linha`
  FORMULA e INDICADOR, que são **14 linhas com master** nesta DRE — a mais cara delas o
  `IRPJ/CSLL` (`=[…]*0,1520`).
  Medido: barras 25.049.791 × cartão 21.124.823 no orçado, e 20.477.541 × 17.261.200 no
  realizado — **a diferença é exatamente o imposto sobre o resultado** nos dois casos
  (3.924.968 e 3.216.341). Confere pela própria DRE:
  `EBITDA − resultado financeiro − impostos = Resultado Líquido`.
  Hoje as barras leem o **mesmo nó** do cartão (`cOrc[no]?.[periodo]`), mecânica que a linha
  laranja já usava desde sempre — era só as barras fazerem igual.
  ⚠ **Não eram as desativadas**, que foi a primeira suspeita e vale registrar como descartada:
  há 4 linhas desativadas com master e o orçado delas é **zero**; além disso `leaves` já filtra
  `desativada`.
  ⚠ **A linha laranja some no escopo inteiro**: com as barras já sendo o Resultado Líquido, ela
  desenharia em cima da barra azul.
  ⚠ **O título passou a nomear o NÓ**, não o escopo: sem linha agrupadora o escopo é "Relatório
  inteiro" e as barras são o Resultado Líquido — dizer "relatório inteiro" seria repetir o mesmo
  erro no texto. Sem nó identificável, mantém a soma das folhas: gráfico aproximado é melhor que
  gráfico vazio.

- ⚠⚠ **Seções no seletor: "só esta" × "as filhas", e NUNCA as duas (nov/2026).** O atalho óbvio
  — marcar a subárvore inteira de uma seção — pouparia cliques e **quebraria a ponte por
  construção**: subtotal junto com filha conta a mesma variação duas vezes, que é o primeiro
  aviso do texto da própria seção. Por isso as duas ações são **mutuamente excludentes**: *só
  esta* tira os descendentes, *as filhas* tira o pai. E *as filhas* são as **diretas**, tirando
  os netos junto — filha + neta tem o mesmo problema um nível abaixo.
  É o mesmo par do botão **Seções** do relatório, e a razão de existir é a mesma: a escolha útil
  não é "marcar tudo", é **em que nível olhar**.
  ⚠ **Indicador e fórmula ficam em grupo separado**, e percentual leva selo. Eram 142 linhas de
  relatório misturadas com 27 indicadores na DRE Gerencial: marcar *% EBITDA* junto com
  *Marketing* soma pontos percentuais com reais, na ponte e na ordenação da variação.

- ⚠⚠ **"O que mudou" é um RANKING, e ranking de itens que se contêm é dupla contagem por
  construção** (19/nov). Com a seleção livre dava para marcar `Despesas` **e** `Despesas com
  Pessoal`, e o leitor somava o mesmo dinheiro duas vezes. Numa **ponte** o resíduo denuncia;
  num ranking **não há resíduo que denuncie** — por isso o conjunto passou a vir de um **corte
  em nível** (`particaoNivel`), que é uma partição: nada se repete, nada se perde.
  ⚠ O corte no nível N são as linhas de profundidade N **mais as folhas acima** — sem elas,
  dinheiro de um ramo curto sumiria. `folhas` é o grão de lançamento.
  ⚠ **A profundidade sai do `pai_id`, nunca de `nivel`** — essa coluna é **1 em todas as 170
  linhas**, não é mantida.
  ⚠ **A seleção manual SAIU.** Ela é que permitia a duplicata; com nível + limiar o recorte já
  existe. `cfg.sel` continua sendo o armazenamento porque alimenta `todasSel` (o que carregar),
  só deixou de ser digitado.
  ⚠ **Nível não vale na aba Indicadores**: os 23 são todos nível 1, então o botão some ali em
  vez de ficar morto. Medido: Linhas N=1: 9 · N=2: 34 · N=3: 120 · folhas: 120.
  ⚠⚠ **Indicador ordena por %, não por valor.** Eles misturam unidades — `% EBITDA` em pontos
  percentuais, `Custo Pessoas` em reais, `Receita por FTE` em R$/FTE: ordenar por variação
  absoluta compara grandezas diferentes e põe sempre os de reais no topo.
  ⚠ **Linha zerada nos DOIS períodos não entra.** Não é "variação pequena", é ausência de
  conteúdo — a linha existe na estrutura e não foi orçada em nenhum dos lados. Com o limiar em
  0, que é como se vê tudo, elas enchiam a lista e empurravam o que importa para baixo. O
  contador diz quantas saíram.
  ⚠ **Pílula de natureza `Todas · Receita · Despesa`**, só na aba Linhas (entre os indicadores
  são 3 de despesa e 20 neutros — "Receita" daria lista vazia). Medido: N=1 → 1 receita, 1
  despesa e **7 neutras**; N=2 → 14/12/8; N=3 → 37/68/15.
  ⚠⚠ **As neutras NÃO são sobra** — no nível 1 são `Impostos s/ faturamento`, `Resultado
  Financeiro`, `Impostos sobre o Resultado`, `Receita Liquida`: dinheiro de verdade que uma
  pílula de dois estados esconderia em silêncio. Por isso há o terceiro estado, e ao recortar a
  tela **diz quantas ficaram de fora** em vez de só encolher a lista.
  ⚠ **A duplicação restante é CADASTRO:** só **um** indicador é espelho estrutural de uma linha
  (`ImpostosFaturamento`); `Custo Pessoas (fully loaded)` e `Folha direta` dão valores idênticos
  porque são duas fórmulas que calculam a mesma coisa, e nenhum filtro adivinha isso.

- ⚠⚠ **Acurácia é o SEGUNDO ranking, e ranking pede partição (19/nov).** Ela tinha seleção livre
  (`SelLinhas`) enquanto *O que mudou* já havia trocado para o corte em nível — então dava para
  marcar `Despesas` junto com `Despesas com Pessoal` e **o mesmo erro aparecia duas vezes**, sem
  resíduo que denunciasse. Aqui pesa mais do que no outro cartão: o erro é o que calibra a
  confiança na rodada seguinte, e contá-lo em dobro desconfia da linha errada.
  Hoje os dois cartões usam **`useCorte` + `BarraCorte` + `useSincronizaSel`** — aba
  Linhas/Indicadores, nível, pílula de natureza e o limiar duplo, idênticos.
  ⚠ **Extraído em vez de copiado de propósito:** eram ~60 linhas iguais, e a cópia divergiria na
  primeira alteração deixando **um dos dois** contando duas vezes, em silêncio. A **ponte** fica
  fora do helper: lá o nível é cumulativo, e é diferença deliberada.
  ⚠ Zero nos dois lados sai da lista nos dois cartões (ausência de conteúdo, não erro pequeno) —
  divergir faria o mesmo relatório render duas listas.

- **Seletor de linhas do *Orçamento — análise*: "todas", "nenhuma" e "sem limiar" (nov/2026).**
  Analisar o resultado inteiro era marcar 32 caixas na mão, uma a uma — e quem desiste no meio
  fica com uma análise que **parece completa e não é**. ⚠ "Marcar todas" usa a lista já filtrada
  (`linhasConciliaveis`: tem master e não está desativada), então marca o que faz sentido
  comparar, não tudo o que existe.
  ⚠ **O limiar duplo fica** — percentual E % do total, com E. "40% numa conta de R$ 800 é ruído;
  3% na folha é a maior conversa do orçamento": só o percentual enche a tela, só o valor esconde
  a conta pequena que dobrou. O que faltava não era remover um filtro, era **desligá-lo num
  clique**: `0` nos dois campos já mostrava tudo, e não havia como descobrir isso olhando.

- ⚠⚠ **Seleção DENTRO de um cartão não recarrega a tela (nov/2026).** No *Orçamento — análise*,
  marcar uma linha em qualquer quadro disparava a carga inteira: a união das seleções
  (`todasSel`) estava na **guarda e nas dependências** do efeito, e `carregando` troca todo o
  conteúdo por "Calculando…" — a tela piscava e todo estado local dos cartões morria.
  **E era puro desperdício:** a carga sempre computou TODAS as linhas (`base` recebe `linhas`,
  nunca a seleção), então o recálculo devolvia exatamente o mesmo dado. Hoje só muda a carga o
  que muda o **dado**: versão, ano, período, modo, projeção e os filtros/pílulas do **topo**.
  ⚠ O gráfico *por empresa* era o único caso real — o cálculo morava na carga. O **bruto** passou
  a ficar no estado (`linhaEmpBruto`) e o gráfico virou `useMemo`: a busca já ia com **todos** os
  masters, então trocar a linha de resultado nunca mudou uma vírgula do que o banco devolve.
  **A regra:** se o seletor não muda o que se pede ao banco, ele não pertence às dependências da
  carga — e a prova disso é olhar se o parâmetro da consulta cita o seletor.

- ⚠⚠ **Alerta é sobre o ORÇAMENTO, não sobre o recorte de outro quadro (nov/2026).** O cartão
  *Alertas* recebia `secVar.sel` — a seleção de *O que mudou* — e errava das duas pontas: com o
  nível 1 ele apontava **subtotais**, onde "sumiu" não significa nada (o subtotal só reflete as
  filhas), e **nenhuma linha de lançamento** era conferida. Hoje varre as **folhas analíticas**
  do relatório (sem filha, não indicador, não fórmula), sempre as mesmas, e de graça sai do
  caminho da recarga. ⚠ Sem seleção o conjunto cresce, então a **ordem** passa a importar (o que
  sumiu antes do que foi copiado) e a lista cortada **diz quantas ficaram** — corte calado faz
  quem leu as 30 primeiras achar que conferiu tudo.

- ⚠⚠ **O drill filtrava só por EMPRESA, e contradizia a linha que o abriu** (nov/2026). Em
  produção, com a pílula *Serviços* marcada, a linha *Correio/moto taxi* mostrava **10.465** e o
  drill dela abria com **14.936,77 em 10 combinações**, metade do CSC. Os dois números vinham da
  mesma célula e discordavam — e não havia como saber qual era o da linha.
  `DrillCombinacoes` recebia `empresas` e **não** `filial`/`cc`; hoje recebe `filialIds`/`ccIds`
  (`null` = sem restrição, mesmo contrato do `effectiveCcFilter`) e o cabeçalho **diz** quando o
  total está recortado — sem isso quem filtra vê um número menor e procura lançamento que não
  sumiu. ⚠ Linha **consolidada** (filial/cc nulos) fica de fora quando há filtro, e é o certo:
  ela não pertence a filial nem CC nenhum, logo não pertence ao recorte.
  **A regra geral:** toda tela que abre detalhe a partir de um total tem de herdar **o mesmo
  recorte** — detalhe que não soma o total de onde veio não é detalhe, é outro número.

- ⚠⚠ **Orçado × Orçado com período PARCIAL engana mais que no realizado** (18/nov). Os dois lados
  são planos do **ano inteiro**; recortar meses deixa de fora economia que existe e está gravada.
  Custou uma investigação: o cenário dizia **−591.979** de efeito no ano e o comparativo mostrava
  **−467.414**. Medido, nada se perdera — os **124.565** que faltavam estavam em **nov+dez**,
  fora do recorte (`jan–out`), e o Δ de *todas as origens* no ano era exatamente 591.979, o que
  prova que o Aplicar tocou só os postos. A tela não dizia, e os dois números pareciam discordar.
  ⚠ O aviso é **só no modo ORC**: no realizado, período parcial é o normal (o ano não acabou) e o
  mesmo texto viraria ruído em toda sessão.

- ⚠⚠ **Na PONTE, o sinal cru se lê ao contrário — e avisar em texto não basta** (nov/2026).
  A ponte usa o sinal econômico cru por necessidade (ver a exceção abaixo), então despesa que
  **cresce** aparece **negativa**: ela piora o resultado. Mas o resto do sistema exibe despesa
  **positiva** (`fatorExibicao`), e o painel ainda se chama "DESPESAS" — a pessoa lê com a
  convenção certa em todo lugar menos ali. A tela já trazia o aviso em texto e **o próprio autor
  da regra leu errado**: viu "Marketing −1.379.414" como "gastou menos", quando o gasto subiu
  R$ 1,38 mi. Hoje cada linha de **natureza DESPESA** (própria ou herdada) traz **↑ gasto** /
  **↓ gasto** ao lado do número, e a coluna chama-se *efeito no resultado*, não *variação*.
  ⚠ Só em despesa: em receita o sinal se lê direto, e "↑ receita" seria ruído.
  ⚠⚠ **O marcador tem COLUNA PRÓPRIA, e ela existe mesmo vazia.** Inline, ele ocupava o fluxo da
  célula e empurrava o número **daquela** linha para a esquerda — a única fora do alinhamento da
  coluna, o que faz quem confere procurar defeito no número. Reservar a largura em todas as
  linhas custa 22px e mantém os valores na mesma borda.
  ⚠ Ficou **só a seta**, sem a palavra (decisão do Ricardo, 19/nov): "↑ gasto" dobrava a largura
  reservada em toda linha para explicar o que o `title` explica sob demanda. Perde-se a leitura
  sem passar o mouse; por isso a seta só aparece em linha de **DESPESA**, onde é a única
  convenção possível, e o **cabeçalho continua escrevendo por extenso**.
  **A lição vale além desta tela:** quando a convenção local contraria a do resto do produto,
  explicar no cabeçalho não resolve — tem de estar **na linha**, junto do número que engana.

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


- ⚠ **Em modal, a ação de confirmar fica no CABEÇALHO FIXO** (18/nov). O padrão certo já existia
  em `DashFiltros` e no Balanço — *cabeçalho que não rola + corpo rolando* —, e vários modais
  faziam o oposto: container com `overflow: auto` e o botão no fim, então quem abria para
  conferir um campo não via como confirmar. Corrigidos: os dois de **Configurações** (acesso e
  convite), o **formulário de posto** e os dois do **editor de relatório**.
  ⚠ **Rodapé FIXO (`flexShrink: 0` + `borderTop`) é aceitável** — `FormulariosPage` faz assim e a
  ação nunca some. O defeito não é "estar embaixo", é **sair da tela**.
  ⚠ No editor de linha os botões estavam **dentro do `fieldset disabled`** do modo leitura, então
  até o Cancelar ficava travado. Ao subir, *Cancelar* volta a funcionar e *Salvar* **some** em vez
  de aparecer apagado — botão desabilitado numa tela de consulta é pergunta sem resposta.
  `CadastrosPage` não precisou: sem `maxHeight`, nada rola ali.

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
  ⚠⚠ **Prova que chama RPC precisa PERSONIFICAR, e `EXCEPTION WHEN others` faz teste passar
  pelo motivo errado** (18/nov). `prova_ratear_orcado.sql` morreu em
  *current_tenant_id() nulo* — a função lê `auth.uid()`, que sai de `request.jwt.claims`, e no
  SQL Editor esse claim **não existe**. Pior: o teste da invariante tinha "passado", porque o
  `WHEN others` capturou justamente esse erro e concluiu que a recusa funcionava.
  **Toda asserção de recusa confere a MENSAGEM** (`SQLERRM LIKE '%…%'`) — "levantou alguma
  coisa" não é a asserção que interessa. E a personificação vai de
  `set_config('request.jwt.claims', …, true)`, local à transação.

  ⚠ Asserção de prova afirma o **mínimo** necessário. `prova_escopo_pessoas.sql` exigiu que uma
  dimensão de escopo abrisse tudo e levou 568 de 570 — o sistema estava certo, a asserção errada,
  e meia hora foi gasta investigando o código que funcionava.
- ⚠⚠ **`current_tenant_id()` CRU no `WHERE` da RPC roda por linha — 20× (v3_193).** Mesma
  consulta, mesmo índice, mesmo plano: **36 ms** como dono com o tenant literal, **1.119 ms**
  personificado com `tenant_id = current_tenant_id()`, **54 ms** com
  `tenant_id = (SELECT current_tenant_id())`. São 24.398 chamadas a ~44 µs.
  ⚠ **A política de RLS já estava certa** (`(SELECT escopo_*())`, InitPlan nos quatro escopos) —
  quem estava cru era o `WHERE` da própria função. **A armadilha nº 2 da v3_129 todo mundo
  aprendeu a evitar DENTRO da policy, e ninguém aplicou FORA dela.**
  ⚠ `STABLE` **não é cache**: promete o mesmo valor durante a instrução, não que o Postgres o
  reaproveite. Quem faz virar avaliação única é a subconsulta escalar.
  ⚠ **Ao escrever RPC nova que varra os fatos, `(SELECT current_tenant_id())`.** A v3_193 tratou
  os 11 agregados de leitura e a **v3_194 fechou as 54 restantes** (43 reescritas; as outras 11
  já usavam `DECLARE t uuid := current_tenant_id()`, que calcula uma vez e é a forma ótima).
  Medido depois: `conciliacao_pessoas_folha(2026,9)` **920 ms → 41 ms**.
  ⚠ **Em plpgsql, `:=` também casa com um regex de `=` descuidado.** `[^(]` antes do `=` aceita
  o `:`, então a conferência da v3_194 leu **atribuição** como chamada crua e reportou 11
  funções pendentes que nunca foram problema. A troca já as ignorava (`([^:])=`); mentia só o
  relatório. Use `[^(:]`.
  ⚠ **`conciliacao_clt(2026,9)` segue em 1,7 s** depois da troca — ali o custo é outro, ainda
  não diagnosticado.

- ⚠⚠ **A tela levava 40 s em 84 chamadas, e 66 delas eram supérfluas** (*Orçamento — análise*,
  nov/2026). Medido: uma `relatorio_orcado_agg` personificada custa **~990 ms**, a DRE Gerencial
  tem **5 grupos de `filtro_escopo` distintos**, e `totaisRelatorio` faz **1 + 5** idas ao banco —
  **em fila**. A carga invocava `totaisRelatorio` **14 vezes**. Três defeitos somados:
  **1. O detalhe mensal já vinha na resposta e era jogado fora.** `relatorio_orcado_agg` devolve
  `TABLE(linha_id, ano, **mes**, valor, …)`, e a tela pedia mês a mês (`meses.map(...)`) para
  reconstruir o que a primeira chamada trouxe: **10 invocações, 60 RPCs**. Hoje
  `totaisRelatorioMes` devolve `{ total, mes }` e o mensal sai de graça.
  ⚠ O valor mensal passa a ser avaliado com o período inteiro em mãos, então `=ANTERIOR()`
  resolve — é diferente da chamada isolada por mês, e **melhor**.
  **2. A mesma leitura era pedida duas vezes.** Com *Orçado × Orçado* sem projeção,
  `serie(vComp)` e o `oa` da acurácia são idênticos. Um cache **de promessas** (não de
  resultados) por carga faz o segundo pedido entrar de carona no voo já levantado.
  **3. As 6 leituras de cada invocação eram sequenciais** e nenhuma depende da outra — só a
  **fusão** tem ordem. Em paralelo, 6 s de espera viram ~1 s.
  **84 → 18 chamadas**, e as 6 de cada uma agora concorrentes.
  ⚠ A regra: **antes de otimizar a consulta, conte quantas vezes ela é feita.** A RPC aqui estava
  razoável; o problema era a tela pedi-la 84 vezes.

- ⚠⚠ **Medir como DONO não mede a tela — o RLS é o custo** (v3_192, nov/2026). A perna de
  despesa de `analise_pessoas_agg` levava **36 ms** no meu usuário e **~2,5 s** personificando
  quem usa; a função inteira, **3,4 s**, contra um `statement_timeout` de **8 s** no
  `authenticated`, numa tela que já faz 6 a 8 chamadas — daí o *canceling statement due to
  statement timeout*. Toda medição de desempenho vai com
  `set_config('request.jwt.claims',…)` + `SET ROLE authenticated`.
  **A causa, no plano:** `LEFT JOIN centro_custo` virava **nested loop de 17.712 iterações** numa
  tabela de **85 linhas** (53 mil buffers), cada uma reavaliando `current_tenant_id()` no filtro
  da política de `centro_custo` — a armadilha nº 2 da v3_129 vista de fora. **Agregar o fato
  ANTES de juntar** (por `cc_id`) derruba para ~600 e ~85 grupos: **3.386 ms → 139 ms, 24×**, com
  as duas versões devolvendo **314 linhas, mesmas somas, zero linhas divergentes**.
  ⚠ Quando o join existe só para RESOLVER UM ATRIBUTO do agrupamento, ele pertence depois do
  `GROUP BY`, não dentro dele.
  ⚠ **E falha de consulta não é ausência de dado.** O erro virava lista vazia e a aba dizia
  "Sem orçado de pessoal — rode o Aplicar", mandando resolver um problema que não era esse.

- **Verificação mede efeito, não intenção.** `SELECT` sobre `pg_policy` confirma que a política
  existe; não confirma que ela filtra. Conferência de acesso **personifica e conta**:
  `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` — sem trocar de papel, o
  dono das tabelas ignora RLS e toda contagem volta cheia. Padrão em
  `seguranca_passo2_naoregressao.sql`.
- ⚠⚠ **Paginar sem `ORDER BY` repete linhas e perde outras** (nov/2026). `range(0,999)` e
  `range(1000,1999)` são **duas consultas independentes**: sem ordenação o Postgres não promete a
  mesma sequência entre elas — basta um plano paralelo ou outra execução. Não dá erro; devolve um
  conjunto *quase* certo, que erra em proporção ao tamanho da tabela.
  **Como apareceu:** um cenário de orçamento recém-copiado — dado idêntico, provado no banco
  (24.454 = 24.454, soma igual, `cenario_orcado_diff` = 0) — mostrou **74 linhas divergentes** na
  tela, algumas com 30% a mais. As linhas de poucas células vinham iguais, as de milhares não:
  assinatura exata de duas paginações de 25 páginas sem ordem.
  Hoje **`pageAll` impõe a ordem** (`id` por padrão, `{ orderBy }` para quem não tem `id`), e não
  é convenção do chamador — eram 60 chamadas e a maioria não ordenava; convenção voltaria a
  faltar na próxima. Quando não consegue ordenar (view sem `id`, coluna sem `GRANT`), segue sem
  ordem mas **reclama no console** em vez de devolver aproximação calada.
- ⚠⚠ **Mês sem movimento NÃO existe no fato, e média que o ignora infla** (wizard de réplica,
  nov/2026). `completarCauda` montava a janela com as N últimas **LINHAS** e dividia pela
  quantidade delas. Como ausência é zero (a regra do resto do produto), três defeitos de uma vez:
  **MEDIA3** pegava "as 3 últimas linhas", que podiam ser jan·mai·set; **MEDIAPER** dividia pelos
  meses *com* valor — conta faturada em 3 dos 12 meses projetava **4× o ritmo real** (13.210,15
  onde o certo é 3.302,54); e **ULTIMO** pegava "a última linha", virando o mês **anterior** ao de
  corte sempre que o de corte não tinha movimento — "o mês até" virava "o mês até − 1", calado.
  Hoje a janela é por **número de mês** e o divisor é o **tamanho dela**.
  ⚠ **O dashboard de Orçamento sempre fez certo** (`meses.slice(-3)`, `mesFim`). O wizard dizia
  seguir "os mesmos métodos" e os reimplementava — comentário afirmando paridade não é paridade.
  ⚠ Escopo com janela vazia projeta **zero**, que é a resposta certa, e vai contado num aviso:
  sumir da projeção sem explicação parece dado perdido.

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
