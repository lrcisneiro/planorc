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
7. **O cenário de FOLHA não é representável por cópia de versão.** `posto` **não tem
   `versao_id`** — o quadro é um só, compartilhado por todas as versões; apenas o
   resultado (`fat_orcado`/`fat_folha`) é congelado por versão pelo "Aplicar". A cópia leva
   os números já calculados, mas basta alguém reaplicar o motor na versão derivada para ele
   recalcular do mesmo quadro único e desfazer o cenário. Ou seja: "corta 10 postos" e
   "adia 5 contratações" não convivem como duas hipóteses.
   Hoje o corte se faz por **vigência** (`fim_ano`/`fim_mes`), que é **um** valor por posto:
   serve para uma decisão tomada, não para duas hipóteses simultâneas. As saídas são
   (a) aceitar que a folha só tem *plano que evolui* (revisões que se substituem) e a
   simulação de quadro se faz fora do motor, ou (b) uma camada de sobreposição por versão
   — um `posto_versao` com vigência/FTE/salário que herda do mestre quando ausente, mesmo
   padrão da premissa global do formulário (`formulario_valor.empresa_id NULL`).
   **Decidir antes da F7.2**, porque muda o que "simulação" significa para o maior bloco
   de custo da empresa.

## 6. Fases
- **F7.1** Hub + wizard (identificação, cópia completa, realizado até mês) + colunas novas
  + **respeitar `bloqueada` no "Aplicar" da grade de postos** (gap 6). Este item não espera
  a F7.4: é proteção contra perda de dado já validado, e custa uma guarda. ⬜
- **F7.2** Ajustes por regra + premissas + marcação de diferenças no editor. ⬜
- **F7.3** Tela Comparar (resumo / detalhado / só diferenças) + export. ⬜
- **F7.4** Promover/merge, arquivamento, simulações fora dos dashboards oficiais. ⬜

## Fontes
- Workday Adaptive — Create plan versions: https://doc.workday.com/adaptive-planning/en-us/workday-adaptive-planning-documentation/modeling/managing-the-model/versions/plan-versions/nre1660090973895.html
- Workday Adaptive — Personal scenarios: https://doc.workday.com/adaptive-planning/en-us/workday-adaptive-planning-documentation/scenarios/concept--personal-scenarios.html
- Planful — Scenario Setup overview: https://help.planful.com/v4/docs/how-to-refresh-actuals
- Planful — Plan scenarios: https://help.planful.com/docs/plan-scenarios
- Anaplan Community — switchover dates: https://community.anaplan.com/discussion/83233/question-on-switchover-dates
- Abacum — What-if analysis: https://www.abacum.ai/blog/what-if-analysis
- Jirav — Scenario planning for finance teams: https://www.jirav.com/blog/scenario-planning-for-finance-teams-a-practical-guide-with-examples
- Cube — Scenario planning: https://www.cubesoftware.com/scenario-planning
