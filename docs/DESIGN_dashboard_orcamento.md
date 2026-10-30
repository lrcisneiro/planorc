# DESIGN — Dashboard de Orçamento

Out/2026. **Primeira versão implementada** em `/dashboards/orcamento`: o chassi
completo e os blocos 1 a 4. Os demais seguem propostos.

> **Procedência:** a primeira versão saiu de conhecimento geral de FP&A. Depois
> foi confrontada com pesquisa (fontes no fim), que confirmou a ponte e o
> painel de premissas, e **acrescentou quatro coisas** — o *run rate* como
> terceira régua, a tabela ao lado da ponte, o limiar duplo e o comentário por
> linha. O que veio de pesquisa está marcado com ⌕.

## A pergunta que ele responde

Os seis dashboards de hoje respondem **"como estamos indo?"** — execução,
orçado × realizado, desvio do mês. Um dashboard de orçamento responde outra
coisa:

> **"Devo aprovar este orçamento?"**

O público não é quem acompanha, é quem **decide**. Isso muda tudo: o número
isolado importa menos que a **procedência** dele, e a pergunta mais útil não é
"quanto" mas "**por que mudou**" e "**dá para acreditar**".

É por isso que ele quase não usa realizado — só o suficiente para julgar o
orçamento contra a história.

---

## A armadilha que precisa ser resolvida antes

**O realizado de 2026 é parcial.** Comparar o ano cheio de 2027 contra jan–set
de 2026 subestima o passado e infla o crescimento — e o erro é invisível,
porque os dois números parecem anuais.

Três tratamentos possíveis, e o dashboard precisa dizer qual está usando:

| modo | o que compara | quando serve |
|---|---|---|
| **Mesmo período** | jan–set/27 × jan–set/26 | o mais honesto; o padrão |
| **Ano cheio × orçado** | 2027 × **orçado** 2026 | compara plano com plano |
| **Anualizado** | 2027 × 2026 projetado | só com o método declarado na tela |
| **⌕ Run rate** | 2027 × **3 últimos meses fechados × 4** | a régua que pega inflexão recente |

> ⌕ **O run rate é uma régua separada, não um detalhe.** A prática de revisão
> manda explicar a variação contra o ano anterior **e contra o ritmo atual** —
> são perguntas diferentes. Um orçamento 5% acima de 2026 pode estar 15% abaixo
> do que a empresa está rodando hoje, e o total anual esconde isso. Já temos a
> máquina: é a média dos 3 últimos meses fechados que o wizard de réplica usa.

> Nunca o ano cheio contra o realizado parcial, calado. É exatamente o tipo de
> comparação que ninguém confere e que vira slide.

---

## Refinamento do Ricardo (30/out) — e o que ele muda

### Período + chave de projeção substitui os "três modos"

Mês início/fim mais uma chave *projetar os meses seguintes* gera os três modos
que eu havia listado, e com uma mecânica só. **É melhor que a minha proposta** e
substitui a tabela acima:

| o que se quer ver | período | projeção |
|---|---|---|
| ano cheio contra ano cheio | jan–dez | **ligada** |
| só o que está fechado | jan–set | desligada |
| plano contra plano | jan–dez | irrelevante (os dois lados são orçado) |

> **A projeção é ANUALIZAÇÃO, e vale nos dois modos** (ajustado em 30/out).
> Ela projeta os meses **depois do período** até dezembro, nos **dois lados**.
> Limitar o período e perguntar *"e se o resto do ano seguir este ritmo?"* é a
> mesma pergunta comparando dois orçados ou comparando com realizado — a
> primeira versão só a oferecia no modo Realizado, e o controle sumia sem
> explicação no outro.
>
> Isso também tornou o seletor **"fechado até" desnecessário**: o **período é
> quem define o que é real**, e o que vem depois é projeção. Dois controles
> dizendo quase a mesma coisa confundiam; sobrou um, e a detecção do último mês
> com realizado virou só um **aviso** — "o realizado vai até setembro mas o
> período vai até dezembro: esses meses entram como zero".
>
> Cinco métodos, porque cada um responde a uma pergunta diferente:
> não projetar · média dos **3 últimos** meses do período · média de **todo** o
> período · repetir o **último** mês · (só no modo Realizado) o **orçado** do
> ano, que é a projeção de fechamento da própria empresa.

> **A chave esconde uma decisão de método.** "Projetar out–nov–dez" a partir de
> quê? Três respostas, três números diferentes:
> **(a)** o **orçado daquele ano** para esses meses — é a estimativa da própria
> empresa, e é o que o mercado chama de *projeção de fechamento*; **(b)** a
> média dos 3 últimos fechados — ignora sazonalidade de fim de ano, que é forte;
> **(c)** repetir o último mês — pior ainda em dezembro.
>
> **Proposta: (a) como padrão**, com (b) disponível. E o motivo de (a) ser
> seguro aqui é que o lado comparado é outra versão/ano: projetar 2026 com o
> orçado de 2026 não contamina o julgamento de 2027.

> ⚠ **Mas há um caso em que contamina.** Se alguém puser a **mesma versão** nos
> dois lados — ou comparar 2027 contra 2027 com projeção ligada —, os meses
> projetados ficam idênticos por construção e a variação neles é zero **de
> mentira**. A tela precisa avisar quando os dois lados compartilham a versão
> usada na projeção.

> **Meses projetados têm de parecer projetados.** Hachura, tom mais claro, o que
> for — mas distintos. Projeção lida como fato é o jeito mais fácil de um
> orçamento ser aprovado por engano.

### A versão carrega o ano — um seletor só, dois modos

Comparar é sempre **contra uma versão**. O modo diz apenas o que ler dela:

| modo | lê da versão escolhida |
|---|---|
| **Orçado × Orçado** | o `fat_orcado` dela |
| **Orçado × Realizado** | o `fat_realizado` do **ano** dela |

Comparar com o ano retrasado vira trocar a versão de comparação. Simples e sem
seletor de ano em lugar nenhum.

> Um cuidado de rótulo: no modo Realizado, a versão escolhida serve só para
> dizer **o ano**. A tela deve mostrar "Realizado **2025**", não o código da
> versão — senão sugere que aquele realizado pertence àquela versão, o que não
> existe.

### Linha pequena que varia 1000%: dois remédios, e eles se somam

Você está certo, e o problema tem duas soluções que resolvem coisas diferentes:

1. **Escolher o nível certo** — comparar pela linha **agrupadora** em vez das
   analíticas. No administrativo, uma linha fechada no lugar de trinta. Isso
   *elimina* o ruído na origem.
2. **Limiar duplo** — percentual **e** valor mínimo, juntos. Isso filtra o que
   sobra depois de escolher o nível.

Os dois, porque nenhum basta: agrupar demais esconde a conta que dobrou, e
filtrar sem agrupar deixa trinta linhas pequenas disputando atenção.

> **O valor mínimo deve se auto-escalar.** Um limiar fixo em R$ está errado em
> alguma seção por definição — receita e despesa de viagem não cabem no mesmo
> número. Proposta: padrão em **0,5% do total da seção**, editável para
> absoluto quando a pessoa quiser.

### Seleção de linhas POR SEÇÃO

No dashboard de acompanhamento a seleção vale para o relatório inteiro. Aqui
**cada seção escolhe as suas** — e é melhor assim: a ponte quer os blocos de
nível 1, a tabela de variação pode querer descer num bloco específico, e a
acurácia quer as analíticas onde o erro mora.

Já existe a peça: o seletor em árvore com checkbox do wizard de réplica
(`emArvore` + `linhasConciliaveis`). É o mesmo componente.

> **Padrão: as linhas de nível 1 do relatório.** Seção que nasce vazia parece
> quebrada, e nível 1 é exatamente o que a ponte quer.

### Reuso do dashboard de acompanhamento

Tudo em `pages/dashboard/DashFiltros.tsx`, importado e não reescrito:

| peça | o que faz |
|---|---|
| `FiltrosButton` | empresa · filial · CC · área · divisão · BU |
| `PeriodoButton` + `PeriodPicker` | mês início/fim |
| `SalvarCardButton` | preset em `dashboard_card`, com `owner_id` |
| `ExportarButton` | PNG/PDF, já atrás de `can('exportar')` |
| `escopoFiltro` | cruza o filtro com o escopo de dados do usuário |

> **O preset ganha mais valor aqui.** Com seleção de linha e limiar por seção, o
> `filtros jsonb` do card passa a guardar a **configuração inteira da análise** —
> "Revisão do orçamento 2027" vira um card que reabre tudo como estava. É mais
> do que o card do acompanhamento guarda hoje, e cabe no mesmo campo.

---

## O que eu construiria, em ordem de valor

### 1 · A ponte (waterfall) — EBITDA 2026 → 2027

O artefato canônico de FP&A, e o único gráfico que responde **de onde vem o
crescimento** numa imagem. Barras em cascata:

```
EBITDA 2026  →  +receita recorrente  +receita nova  +NR  +serviços
             →  −impostos  −folha  −demais despesas  →  EBITDA 2027
```

Se a ponte tem uma barra gigante e o resto nivelado, o orçamento tem **uma
aposta só** — e essa é a conversa a ter. Se tem muitas barras pequenas se
cancelando, ninguém sabe de onde vem o número.

> ⚠ **Uma ponte exige componentes que NÃO SE SOBREPÕEM** — e a primeira
> implementação errou nisso. Ela somava as linhas selecionadas para achar o
> início, e o padrão "nível 1" de uma DRE traz **subtotais junto com
> componentes**: EBITDA, Margem e Resultado convivendo com Receitas, Despesas e
> Folha. A soma contava a mesma receita várias vezes — num teste real deu 496
> milhões de "início" onde o EBITDA era uma fração disso, e a cascata saiu
> achatada porque a escala ia de zero a um número que não existia.
>
> O desenho certo tem **duas entradas**: a **linha de resultado** cuja variação
> se decompõe, e os **componentes** que a explicam. E uma barra de **"não
> explicado"**: se os componentes não fecham a variação do resultado, a
> decomposição está incompleta ou se sobrepõe, e isso precisa aparecer em vez
> de o gráfico fingir que fecha. É a honestidade da ponte.
>
> **A escala não força o zero.** Num bridge o início é muito maior que as
> variações; incluir o zero achata todas as barras. O eixo cobre a faixa do
> caminho acumulado, com folga.

> **Os componentes saem da ESTRUTURA, nunca de nomes no código.** A primeira
> implementação escolhia o padrão por regex sobre a descrição
> (`/margem|ebitda|resultado/`) — funcionava numa DRE e quebraria na seguinte,
> e o produto atende segmentos diferentes. A estrutura do relatório já tem a
> resposta: **linha `FORMULA` declara os próprios termos na `expressao`**
> (`=[REC] - [CUSTO]`), e **`SOMAR_FILHOS` tem as filhas**, por definição do
> tipo. Isso é parametrizável por quem monta a DRE, sem tocar em código.

> ⌕ **Sempre com a tabela ao lado.** Cascata se lê por aproximação — a altura
> da barra dá a ordem de grandeza, não o número. Quem aprova precisa do valor
> exato, e a prática é parear o gráfico com o resumo tabular em vez de escolher
> um dos dois.

### 2 · Variação por linha, ordenada por IMPACTO

Não alfabética nem por tamanho: pela **contribuição ao delta**. As 15 linhas
que explicam a mudança, com absoluto e %. O resto colapsado em "demais".

Quem revisa orçamento quer saber o que mudou, não ler a DRE inteira.

> ⌕ **Limiar duplo em vez de "as 15 maiores".** A prática é marcar o que passa
> de **5–10% E de um valor mínimo absoluto** ao mesmo tempo. As duas condições
> juntas importam: 40% numa conta de R$ 800 é ruído, e 3% na folha é a maior
> conversa do orçamento. Só o percentual enche a tela de bobagem; só o absoluto
> esconde a conta pequena que dobrou.

> ⌕ **Comentário por linha, gravado.** Variação marcada pede três coisas — *o
> que mudou, por que, e o que se faz a respeito*. Já existe o precedente no
> produto: a `conciliacao_folha_nota`, onde o resíduo pede justificativa
> escrita. Uma linha explicada deixa de voltar à pauta na reunião seguinte.

### 3 · Acurácia do orçamento ANTERIOR  ⟵ o mais subutilizado

Orçado 2026 × realizado 2026, por linha. Não para julgar o passado — para
**calibrar a confiança no futuro**.

Uma linha que errou 12% ano passado e vem com número redondo e confiante em
2027 merece pergunta. Uma linha que acertou três anos seguidos pode passar.

Mais valioso ainda: o **viés**. Erro sempre para o mesmo lado não é imprecisão,
é tendência — e tendência se corrige.

### 4 · Detector de orçamento preguiçoso

Barato de calcular e pega problema real:

- **12 meses idênticos** — o clássico "dividi por doze"; legítimo em contrato
  fixo, suspeito em despesa variável
- **igual ao ano anterior**, centavo a centavo — copiado sem revisar
- **sem histórico em 2026** — linha nova, que merece justificativa escrita
- **sem orçado em 2027 tendo realizado em 2026** — a linha que sumiu

O último é o mais importante e é o que mais nos custou nesta semana: linha que
desaparece **não aparece em lugar nenhum**. Só o total denuncia, e tarde.

### 5 · Cobertura

Combinações empresa × filial × CC × conta com realizado em 2026 e **sem** orçado
em 2027 — e o contrário. Com o valor de 2026 ao lado, para a pergunta ser
"isso deveria estar aqui?" e não só "faltou".

É o irmão estrutural do item 4, no grão do escopo em vez do da linha.

### 6 · Painel de PREMISSAS

As premissas que **geram** o orçamento, hoje enterradas nos formulários:

| | |
|---|---|
| receita | churn, correção, repasse, postergação, inadimplência |
| NR | nº de parcelas, % mensalidade, % recuperação de vencidas |
| despesa | reajuste geral, chave de rateio |
| imposto | alíquota por filial |
| folha | dissídio, encargos |

A credibilidade de um orçamento mora nesses números, não no total. Mostrá-los
lado a lado com o ano anterior — *"churn era 0,95%, virou 0,80%: por quê?"* —
é a conversa que de fato muda o resultado.

> ⌕ **A pesquisa põe isto mais alto do que eu havia posto.** O padrão de revisão
> antes da aprovação é que as premissas sejam **documentadas e mensuráveis**, e
> que o CFO *"teste de onde vêm os números"* — porque uma projeção detalhada
> pode parecer precisa dependendo inteiramente de premissa não testada. Isso
> empata com os quatro primeiros em prioridade, não vem depois deles.

### 7 · Mix e composição

Receita por tipo (recorrente / NR / serviços) e por BU, 2026 × 2027. Despesa:
folha × demais. Mostra **mudança de estratégia** que o total esconde — crescer
10% trocando recorrente por serviço é outra empresa.

### 8 · Sazonalidade

Curva mensal 2027 × 2026, normalizada. Pega curva implausível e, de novo, a
linha reta — que em receita quase nunca é verdade.

### 9 · Concentração (Pareto)

Quanto do orçamento está nas 10 maiores contas / CCs / clientes. Enquadra
risco: 60% em três linhas é um orçamento frágil, por melhor que seja a média.

### 10 · Indicadores estruturais

Margem EBITDA, despesa/receita, folha/receita, receita por cabeça — 2026 → 2027,
com o delta em pontos percentuais. Um orçamento que cresce receita e piora
margem está dizendo algo que o valor absoluto não diz.

---

## Primeira versão — o que eu faria agora

**1, 2, 3 e 4 — feitos.** Juntos já respondem "devo aprovar": de onde vem o
crescimento, o que mudou, dá para acreditar em quem fez, e o que foi feito no
automático.

Decisões da implementação que valem registro:

- **Cada série é uma chamada de `totaisRelatorio`**, com faixas de meses
  diferentes. A projeção se compõe daí — realizado em `jan…fechado` mais a
  estimativa em `fechado+1…fim` —, sem precisar de dado mensal cru. O motor do
  relatório (rollup de `SOMAR_FILHOS`, fórmulas) vem junto de graça.
- **O "fechado até" é detectado como sugestão e é editável.** O mês corrente
  aparece parcial no razão; tomá-lo por fechado contamina duas vezes — entra
  menor e ainda puxa a média que projeta o resto do ano.
- **O mês início/fim é próprio, não o `PeriodPicker`.** Aquele escolhe pares
  (ano, mês), e aqui o ano vem da versão — pedir o ano de novo deixaria montar
  um par inconsistente.
- **O detector de "linha reta" precisa do mensal**, então a base é buscada mês
  a mês em paralelo. É o mesmo dado que alimentará a sazonalidade (bloco 8).

5 e 6 na sequência — a cobertura porque é o erro que mais dói, e as premissas
porque são a conversa real.

7 a 10 depois, conforme aparecer necessidade. Dashboard que nasce com dez
blocos é dashboard que ninguém lê.

---

## Comparar dois CENÁRIOS, não só dois anos

Todos os blocos acima funcionam com **duas versões do mesmo ano** no lugar de
dois anos. A ponte entre `Orçado2027` e `Orçado2027_B` responde "o que muda se
a meta for 20% em vez de 15%" — que é a pergunta da F7.

Vale desenhar o seletor como **duas versões quaisquer**, não como "ano atual ×
anterior". Custa o mesmo e serve às duas perguntas.

---

## O que NÃO entra

- **Execução mensal e desvio do mês** — é o `/dashboard`, já existe
- **Realizado como protagonista** — aqui ele é régua, não assunto
- **Drill até lançamento** — o `DrillModal` serve ao acompanhamento; aqui o
  grão é a linha e a premissa

---

## Fontes

- [18 Point Budget Checklist — CFO Leadership Council](https://cfoleadershipcouncil.com/18-point-budget-checklist/)
- [What is budget planning checklist? — Hyperbots](https://www.hyperbots.com/glossary/budget-planning-checklist)
- [CFO Budget Planning: A Strategic Three-quarter Guide — CBH](https://www.cbh.com/insights/articles/cfo-budget-planning-best-practices-a-strategic-guide/)
- [The Budgeting Process: Step-by-Step Guide for FP&A — Corporate Finance Institute](https://corporatefinanceinstitute.com/resources/fpa/budgeting-process-guide-fpa/)
- [Shapley vs waterfall variance bridge — Cleo AI](https://cleoai.tech/knowledge/shapley_vs_waterfall_variance_bridge_which_method_should_fpa_teams_use_to_explain_budget_variances.php)
- [Budget Variance: How FP&A Teams Build a Tighter Reporting Workflow — Numeric](https://www.numeric.io/blog/budget-variance)
- [Margin Bridge Analysis: 4 Variance Drivers Explained — eFinancialModels](https://www.efinancialmodels.com/mastering-the-gross-margin-bridge/)
