# DESIGN — Cenários (F7)

> Planejado em out/2026. **Ainda não implementado.** Base: pesquisa de mercado (Workday Adaptive, Planful, Anaplan, Abacum, Jirav, Cube) + `Requisitos_Plataforma_FPA.docx` §4.3/§4.4 + decisões já tomadas em `DESIGN_formularios_dre.md` (cenário = versão).

## 0. Decisão de base (mantida)
**Cenário = linha de `versao_orcamento`.** Orçamento, Revisão, Forecast, Simulação são versões; Realizado é o caso especial `'REALIZADO'` em `view_config.cenarios[]`. O papel da versão **não vira enum** (texto livre com sugestões). A F7 não cria estrutura nova de fatos — resolve o *ato de criar cenário*, a *coerência da cópia*, o *rastro* e a *comparação*.

## 1. Padrões de mercado que adotamos

| Padrão | Fonte | Aplicação no Planorc |
|---|---|---|
| Toda versão nasce como cópia — em branco / só estrutura / estrutura+dados | Adaptive | Criar versão = semear dados, numa tela só |
| *Projection Start / Start of plan*: meses anteriores fechados recebem realizado; mudar a data → "refresh closed period data" | Planful, Adaptive, Anaplan (switchover) | Forecast composto = campo `inicio_projecao` + rotina reexecutável |
| Cenário what-if = filho de versão base; células alteradas destacadas; depois *merge* ou descarte | Adaptive (personal scenarios) | Versão oficial × simulação derivada; mesmo objeto, papel diferente |
| Ajuste em massa por %/driver sobre a cópia; 5–7 drivers; 3 casos (base/otimista/pessimista) | Abacum, Jirav | Regras de ajuste gravadas como **premissas** do cenário |
| Comparação: cenários como colunas, *difference*, base "pinada" | Adaptive, Cube, Planful | Modelo coluna={período,cenário} confirmado; gap é ergonomia |
| Tabela-resumo de premissas por cenário + *trigger points* | Jirav, Abacum | Painel de premissas na página da versão |

Anti-padrões a evitar: planilha por cenário (sprawl), dezenas de variáveis, cenário anual sem refresh mensal com realizado, "cenário do meio vira o plano" sem decisão.

## 2. Diagnóstico — o que já existe × gap

**Existe:** `versao_orcamento` (codigo, descricao, ano, ativa, bloqueada) · RPC `copiar_versao_orcado(origem,destino,substituir)` (v3_007 — **só `fat_orcado`**, acionado em Cadastros→Versões) · `fat_orcado.expressao` + engine compartilhado (`=ANTERIOR()*1,05`) · `versao_taxa` (câmbio por versão) · `view_config.cenarios[]` + `funcao=COMPARATIVO` · Importar Baseline por versão (F3) · `totaisRelatorio` (mesmo cálculo do editor/Indicadores).

**Gaps:**
1. Não há ato de "criar cenário": criar versão e copiar são passos soltos, sem semente de realizado nem ajuste %.
2. Cópia não leva `formulario_valor`, `versao_taxa` nem tabelas de posto por versão (sindicato/dissídio) → cenário nasce incoerente.
3. Sem rastro: versão não sabe de quem derivou nem o que mudou.
4. Comparação só dentro do relatório; sem visão cenário×cenário por KPI; sub-colunas por período explodem a largura.
5. Sem ciclo de vida (rascunho → oficial → arquivada; merge de simulação).
6. **`bloqueada` só vale pela metade.** `FormularioEditorPage` resolve
   `readOnly = bloqueada || !escopoCompleto` e `OrcarGradePage` carrega a coluna — mas
   `PostosGradePage` **não tem uma única ocorrência de `bloqueada`**. O "Aplicar" do motor
   de folha apaga e regrava `fat_orcado` (origem POSTO) e `fat_folha` (tipo ORCADO) de
   qualquer versão, travada ou não. É o único clique do sistema que destrói trabalho já
   validado, e move mais dinheiro que os outros dois caminhos somados.
7. **O quadro de postos é compartilhado por todas as versões** — ver §5.7.

## 3. UX proposta — área **Cenários** (grupo *Orçar*, escrita)

### 3.1 Hub `/cenarios` — árvore por ano
```
2026
 ├─ ● BASELINE_2026   Orçamento aprovado        🔒 bloqueada   oficial
 │    ├─ REV1_2026    Revisão 1 (jun)            rascunho       derivada de BASELINE
 │    └─ SIM_CAMBIO_6 Simulação câmbio 6,00      simulação      derivada de REV1 · 42 células alteradas
 ├─ ● FCST_2026_09    Forecast set (real até ago) oficial       proj. a partir de 09/2026
```
Linha: badge papel (oficial/rascunho/simulação/arquivada), origem, início de projeção, nº de ajustes, ações (**Comparar**, Duplicar, Promover/Merge, Bloquear, Arquivar). **Substitui a aba Versões de Cadastros.**

### 3.2 Wizard "Nova versão" (3 passos)
1. **Identificação** — código, descrição, ano, papel (livre, com sugestões), cor (colunas/gráficos).
2. **Semente** (uma das quatro):
   - Em branco
   - Copiar versão X — **tudo**: `fat_orcado`, `formulario_valor`, `versao_taxa`, postos por versão
   - Copiar X **+ realizado até MM/AAAA** → grava `inicio_projecao`; meses anteriores recebem o realizado resolvido por linha. Botão "Reatualizar realizado" fica disponível na versão.
   - Importar planilha (reusa Importar Baseline)
3. **Ajustes iniciais** (opcional, repetível) — regra: `linhas {…} · empresas {…} · períodos {…} · +5%` ou `= versão X × 1,10`. Cada regra vira **premissa** e é aplicada sobre a cópia.

### 3.3 Página da versão
- Cabeçalho: origem, início de projeção, status, **painel de premissas** (regras aplicadas + notas livres).
- Atalhos: Orçar neste cenário (`/orcar/:rel` com versão fixada), Formulários, Postos, Comparar com base.
- No editor/grade, versão com `origem_versao_id`: célula ≠ origem recebe marca visual (carrega a origem em memória e compara; barato).

### 3.4 Comparar — `/cenarios/comparar?a=&b=&c=&d=`
Read-only, até 4 cenários, seletor de relatório + nível (1..5), cenário base "pinado":
- **Resumo** — linhas-chave × cenários, Δ e Δ% contra a base, seta por favorabilidade (reusa `natureza`).
- **Detalhado** — cenários como colunas fixas, período como filtro (anual/ACM/mês).
- **Só diferenças** — filtra linhas em que algum cenário diverge da base.
- Export (reusa `ExportarButton`). Tudo via `totaisRelatorio`; nenhum cálculo novo.

### 3.5 Ciclo de vida
Promover (simulação → oficial; opcional *merge* = copiar células alteradas para a origem, com confirmação listando-as) · Bloquear (existe) · Arquivar (= `ativa=false`, só ganha nome) · versão oficial bloqueada não aceita ajuste, só derivação.

## 4. Schema — impacto mínimo

**`versao_orcamento`** (todas nullable): `origem_versao_id uuid` · `papel text` · `cor text` · `inicio_projecao_ano smallint` · `inicio_projecao_mes smallint`.

**Premissas:** começar com `premissas jsonb` na própria versão; evoluir para tabela `versao_premissa` (tenant, versao_id, ordem, descricao, regra jsonb, aplicada_em, aplicada_por) só se precisarmos reaplicar/desfazer regras individualmente.

**RPCs:**
- `copiar_versao_orcado` → `copiar_versao`: copia também `formulario_valor`, `versao_taxa`
  e as tabelas de posto por versão, numa transação. Elas são duas e **não se comportam
  igual**:
  - `premissa_dissidio.versao_id` é `NOT NULL` → copiar sempre.
  - `rateio_regra.versao_id` é **nullable, e `NULL` significa "vale para todas as
    versões"** → copiar **só as preenchidas**. Duplicar uma regra global criaria uma
    segunda regra em cascata valendo para todo mundo.
- `semear_realizado(versao, ate_ano, ate_mes)`: grava em `fat_orcado` com `origem='REALIZADO_SEED'` (novo valor de `origem`) usando a resolução realizado→linha existente; reexecutável.
- `aplicar_ajuste(versao, regra jsonb)`: UPDATE em massa (filtro linhas/empresas/períodos × fator ou fórmula).

**Não muda:** `fat_orcado`, `view_config`, relatórios, cubos, RLS. `view_config.cenarios[]` segue alimentando a comparação.

## 5. Pontos em aberto (recomendação + contra)
1. **Realizado da versão: materializar em `fat_orcado` ou resolver em runtime?** Rec.:
   materializar (simples, cubos funcionam, exporta). Contra: fica stale com nova carga do
   ERP. O aviso "realizado desatualizado desde DD/MM" **não basta no ritmo real**: durante
   o fechamento o razão é reimportado várias vezes por dia, então a versão passaria a maior
   parte do tempo exibindo o alerta e o usuário aprenderia a ignorá-lo. Melhor reexecutar
   `semear_realizado` ao fim da importação, como já se faz com `refresh_realizado_mensal`,
   e deixar o botão manual só para quem precisa forçar.
2. **Cenário "vivo" (base flui para o filho) como no Adaptive?** Rec.: **não** — cópia estática + marcação de diferença + "Reaplicar da origem" manual. Mais previsível para controladoria.
3. **Ajuste % em `SOMAR_FILHOS`**: proporcional nas analíticas filhas (esperado pelo usuário) × recusar e pedir analíticas (não mascara rateio).
4. **Ajuste % sobre célula de formulário/posto**: vira `origem=MANUAL` e perde o driver, ou ajusta-se no driver e reaplica? Mercado faz no driver; % direto é aceitável para simulação rápida se registrado na premissa.
5. **Limite de 4 cenários** na comparação: manter (legibilidade) ou livre.
6. **Papel livre** (mantido), mas "Simulação" com comportamento especial: fora dos dashboards oficiais por padrão.
7. **O cenário de FOLHA não é representável por cópia de versão — DECIDIDO (out/2026).**
   `posto` **não tem `versao_id`**: o quadro é um só, compartilhado por todas as versões;
   só o resultado (`fat_orcado`/`fat_folha`) é congelado pelo "Aplicar". Basta alguém
   reaplicar o motor numa versão derivada para ele recalcular do quadro único e desfazer o
   cenário. "Corta 10 postos" e "adia 5 contratações" não convivem como duas hipóteses.
   Ver §7.

## 6. Fases
- **F7.1** Hub + wizard (identificação, cópia completa, realizado até mês) + colunas novas
  + **respeitar `bloqueada` no "Aplicar" da grade de postos** (gap 6). Este item não espera
  a F7.4: é proteção contra perda de dado já validado, e custa uma guarda. Virou o **P0**
  do §7.6. ⬜
- **F7.2** Ajustes por regra + premissas + marcação de diferenças no editor. ⬜
  O cenário de **folha** tem trilho próprio: §7 (`posto_versao`), decidido em out/2026.
- **F7.3** Tela Comparar (resumo / detalhado / só diferenças) + export. ⬜
- **F7.4** Promover/merge, arquivamento, simulações fora dos dashboards oficiais. ⬜

## 7. Cenário de folha — `posto_versao` (sobreposição)

### 7.1 O que o mercado faz

Dois campos, e a divisão é por como o dado de pessoal está modelado — não por porte:

| campo | quem | mecanismo |
|---|---|---|
| **cópia completa** | Oracle EPM, Workday Adaptive | `Scenario`/`Version` são dimensões do cubo; a regra *Copy Version* copia a fatia inteira (exige membro de Scenario, Account, Entity, Period, Version). No Adaptive a *personnel sheet* é por versão, escolhida num dropdown. Sem herança: o que não foi copiado não existe. |
| **base + diferença** | SAP SAC, Prophix, Anaplan | SAC: editar versão pública cria uma **versão privada** temporária, e publicar oferece *all data* ou **só o alterado** (`updateChangedDataOnly`) — copy-on-write com merge do delta. Prophix: **Default Scenario** é a baseline; atributos do funcionário variam por cenário, mas ao postar "o Default é a única fonte dos valores de atributo". Anaplan: cada *line item* declara a quais versões se aplica (propriedade `Versions`) — o que varia é decidido **campo a campo**. |

A cópia completa funciona porque ali o dado já é dimensional e copiar é operação de cubo.
Aqui seriam 571 postos × N cenários em tabela relacional: custo de reconciliação alto e,
pior, **apaga a resposta "o que mudou"** — que é justamente o que se apresenta.

**Adotamos o segundo campo.** Três coisas vêm da pesquisa e não da intuição:

- **fato × decisão declarado campo a campo** (Anaplan, Prophix). Não é "tudo pode variar";
- **vaga de cenário não é sobreposição** — a literatura de *position-based planning* separa
  *supply* (quem existe) de *demand* (vaga planejada). São mecanismos distintos;
- **versão privada** (SAC): mexer sem sujar a versão oficial e publicar quando decide. É o
  fluxo certo para reestruturação, que é decisão sensível e ainda indecisa.

### 7.2 Modelo

```sql
CREATE TABLE posto_versao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  versao_id  uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  posto_id   uuid NOT NULL REFERENCES posto ON DELETE CASCADE,
  -- DECISÕES. NULL = herda do posto mestre.
  salario_base   numeric(14,2),
  fte            numeric(5,2),
  ini_ano smallint, ini_mes smallint,     -- adiar/antecipar entrada
  fim_ano smallint, fim_mes smallint,     -- demissão simulada
  reajuste_mes smallint, reajuste_pct numeric, reajuste_valor numeric,
  afast_ini_ano smallint, afast_ini_mes smallint,
  afast_fim_ano smallint, afast_fim_mes smallint,
  ativo      boolean,
  limpos     text[] NOT NULL DEFAULT '{}',  -- campos EXPLICITAMENTE sem valor (ver 7.3)
  nota       text,                           -- por que esta decisão
  UNIQUE (versao_id, posto_id)
);
```

**Variam** (decisão): salário, FTE, vigência, reajuste, afastamento, ativo.
**Não variam** (fato, moram no mestre): nome, matrícula, **admissão**, cargo, regime,
sindicato, empresa/filial/CC, `recurso_cod`, benefícios (`posto_verba`), rateio.

> Realocação (trocar CC/empresa num cenário) ficou **fora** de propósito: muda a chave do
> rateio e do escopo de acesso, e é reorganização, não corte. Se virar necessidade, entra
> depois com o impacto no rateio resolvido antes.

**Vaga que só existe num cenário** não é sobreposição — é `posto.so_versao_id uuid NULL`:
NULL = posto real, presente em todas as versões; preenchido = vaga que só aquele cenário
enxerga. Uma coluna, sem segunda tabela, e toda consulta filtra
`so_versao_id IS NULL OR so_versao_id = :versao`.

### 7.3 A armadilha do NULL

`NULL = herda` não consegue dizer **"neste cenário este campo não tem valor"**. Caso real:
o mestre diz que a pessoa sai em maio (demissão já decidida) e o cenário quer simular que
ela **fica o ano todo** — é preciso *limpar* `fim_ano/fim_mes`, não herdar.

Daí `limpos text[]`: lista de nomes de campo explicitamente vazios naquele cenário. A
resolução fica `campo ∈ limpos ? null : (overlay.campo ?? mestre.campo)`. Uma coluna
resolve, e a UI a preenche sozinha quando se apaga um campo que o mestre tem cheio.

### 7.4 Resolução, no motor

Função pura ao lado do `calcularPosto`, sem I/O:

```ts
resolvePosto(mestre: Posto, ov: PostoVersao | null): Posto
```

O motor **não muda** — continua recebendo um posto resolvido. Isso mantém `calcularPosto`
testável e impede que a lógica de cenário vaze para dentro da cascata de verbas.

### 7.5 Onde se vê o diff — DECIDIDO

São **dois** diffs e misturá-los é o erro:

- **de resultado** ("o cenário B tem EBITDA 2,1 mi maior") → é o **relatório**, comparando
  versões. Já existe; nenhuma tela nova;
- **de premissa** ("demite 14, adia 3 contratações, promove 2") → é uma **lista de
  decisões**, e vai na **própria grade de Postos**, não em tela separada.

Por que na grade: é onde a decisão é *tomada* — decidir num lugar e ver noutro é o que faz
cenário custar caro; a grade já tem filtros, escopo, rateio e colunas de custo que uma tela
nova duplicaria; e o padrão de herança **já existe e já é usado** aqui (premissa global do
formulário: herdado em itálico, sobrescrito em destaque, apagar volta a herdar).

A grade ganha: **seletor de versão**, célula sobrescrita em destaque com o valor herdado no
title, e filtro **"só as alteradas (N)"** — que *é* o diff de premissa, pronto para
apresentar. A tela **Comparar** (F7.3) continua, mas para o nível financeiro, não pessoa a
pessoa.

### 7.6 Ordem de implementação

- **P0 — guarda do `bloqueada` no "Aplicar"** ✅ *(out/2026)* da grade de postos. Não espera nada: hoje uma
  versão aprovada pode ser sobrescrita por engano (o formulário respeita `bloqueada`; a
  folha, não). Custa uma condição e protege 2026, que está validado.
- **P1 — `posto_versao` + grade + motor + Aplicar.** ✅ *(out/2026 — v3_120/121)*
  P1 e P2 eram **a mesma coisa**: a grade mostra custo calculado pelo motor, então para
  ver o efeito da decisão o motor já tem que ler a sobreposição. Separá-los entregaria
  uma tela que não mostra o que se acabou de decidir. Entregue:
  `posto_versao` (v3_120); `lib/postoVersao.ts` com `resolvePosto`/`camposAlterados`
  (funções puras — o motor segue recebendo um posto comum e não sabe o que é cenário);
  alternador **Cadastro × Cenário** na grade; decisão em violeta e herdado em itálico;
  filtro **"só as alteradas (N)"**; modal de decisão próprio (só campos de decisão, com
  "voltar a herdar" por campo); o *Aplicar* grava o quadro **resolvido**; e o card de
  custo anual mostra **−X vs cadastro**.
  Junto veio `copiar_versao_cenario` (v3_121): a cópia de versão só levava `fat_orcado` —
  e nem ele inteiro, deixava `moeda_origem`/`val_m2..m5` para trás, perdendo a visão em
  US$ em silêncio. Agora leva também `versao_taxa`, `premissa_dissidio`,
  `formulario_valor` e `posto_versao`, senão o cenário derivado nasce incoerente e a
  folha dele volta ao quadro mestre no primeiro reaplicar.
  E a UI: **Duplicar** (ícone próprio em Cadastros → Versões) cria a versão nova e copia
  num passo só, partindo da versão que se quer clonar. Antes era preciso criar a versão
  vazia e lembrar de copiar *para* ela — o sentido invertido do que se pensa ao criar um
  cenário. O "copiar para esta" continua, para trazer de outra versão. Nos dois, a opção
  **cenário completo** vem marcada e o resultado sai por tabela, para não haver dúvida do
  que veio junto.
- **P3 — `posto.so_versao_id`**: vaga que só existe no cenário.
- **P4 — publicar/promover** um cenário no mestre (o *publish* do SAC): as decisões que
  viraram realidade descem para o cadastro e o overlay se esvazia.

## Fontes
- Workday Adaptive — Create plan versions: https://doc.workday.com/adaptive-planning/en-us/workday-adaptive-planning-documentation/modeling/managing-the-model/versions/plan-versions/nre1660090973895.html
- Workday Adaptive — Personal scenarios: https://doc.workday.com/adaptive-planning/en-us/workday-adaptive-planning-documentation/scenarios/concept--personal-scenarios.html
- Planful — Scenario Setup overview: https://help.planful.com/v4/docs/how-to-refresh-actuals
- Planful — Plan scenarios: https://help.planful.com/docs/plan-scenarios
- Anaplan Community — switchover dates: https://community.anaplan.com/discussion/83233/question-on-switchover-dates
- Abacum — What-if analysis: https://www.abacum.ai/blog/what-if-analysis
- Jirav — Scenario planning for finance teams: https://www.jirav.com/blog/scenario-planning-for-finance-teams-a-practical-guide-with-examples
- Cube — Scenario planning: https://www.cubesoftware.com/scenario-planning

### Folha por cenário (pesquisa de out/2026 — §7.1)
- Oracle EPM — [Copying Versions](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/svsvs/copying_versions_298.html) · [Strategic Workforce Planning](https://www.oracle.com/a/ocom/docs/workforce-planning-solution-brief.pdf)
- SAP Analytics Cloud — [Planning on Private Versions](https://help.sap.com/docs/SAP_ANALYTICS_CLOUD/18850a0e13944f53aa8a8b7c094ea29e/1a011f8041a84e109a3b6bf8c1c81bc1.html) · [Create, Publish, and Manage Versions](https://help.sap.com/doc/00f68c2e08b941f081002fd3691d86a7/2023.20/en-US/9d9056a13b764ad3aca8fef2630fcc00.html)
- Prophix — [Scenarios in Detailed Planning](https://help.prophix.cloud/Content/DP/dp_modelling/dp_scenarios.htm) · [Workforce planning with FP&A Plus](https://www.prophix.com/blog/fpa-workforce-planning/)
- Anaplan — [Configure line items](https://help.anaplan.com/configure-line-items-e7de33be-6345-4ecc-a517-c3265ff6d04a) · [Select the versions for a line item formula](https://help.anaplan.com/en/317d27f8-04dc-418d-b77b-64c1afaf6916)
- Workday Adaptive — [Adaptive Planning for the Workforce (datasheet)](https://www.workday.com/content/dam/web/en-us/documents/datasheets/enus-pln-da-workday-adaptive-planning-for-workforce.pdf)
- Farseer — [Workforce planning best practices](https://www.farseer.com/blog/workforce-planning-best-practices/) (position-based; separar supply de demand)
