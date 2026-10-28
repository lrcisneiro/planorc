# DESIGN — Receitas (formulários de projeção)

Duas projeções, cada uma num formulário: **Receita recorrente (MRR)** e
**Receita não recorrente (TOTVS)**. Este doc registra as decisões de estrutura,
o escopo de carga e o que ficou pendente. Out/2026.

## Escopo de carga — 48 combinações

| | |
|---|---|
| **Empresas · filial** | `01`→2101 · `05`→2101 · `06`→2001 · `25`→**2501** · `YY`→2101 · `ZZ`→2001 |
| **CCs (BU)** | 1 PC-Sistemas, **2 HXM**, 4 Gestão, 5 RD, 6 Moda — **Base e Novos** |

6 × 1 × 10 = **60 escopos**. Foi o que motivou o botão *Aplicar em todos*: sem
ele são 60 cliques por formulário, e esquecer um deixa aquela BU com o orçado
velho sem nada na tela denunciar.

Duas correções que só apareceram ao olhar o realizado de 2026:

- **O HXM tinha ficado de fora** da lista inicial de BUs e vale **~3,1 mi em 10
  meses** (`212` + `222`, nas cinco empresas) — a segunda maior BU depois do ERP
  Tradicional. Incluído.
- **A empresa 25 (Moda) migrou de filial no meio de 2026**, da `2101` para a
  `2501`. No CC `216` a `2101` terminou o histórico em R$ 8,73 e a `2501` em
  R$ 280.506. O escopo de 2027 é a **2501**.

> **Cisão da empresa 25.** O realizado de 2026 tem pares exatos de valor oposto
> num único mês — `−248.762,34` na 05 e `+248.762,34` na 25, mesmo CC, e mais
> uma dúzia em 01, YY e ZZ. É carteira transferida na criação da 25, não
> receita. Por isso o `BASE` do orçamento sai do **último mês** do histórico e
> não da média do ano: numa carteira que mudou de dono em agosto, a média
> mistura dois mundos. A coluna `ultimo_valor` de
> `contexto_formulario_para_estudo.sql` existe para isso.

> ⚠ **A faixa do CC ainda não está confirmada.** Os mesmos produtos aparecem em
> três faixas — `21x/22x`, `31x/32x` e `51x/52x` — com a matriz Base/Novos
> completa em cada uma. A tela que o Ricardo usou em out/2026 estava no CC `214`,
> o que aponta para a faixa **2xx**, mas isso precisa ser confirmado antes da
> carga: errar a faixa põe a receita em 8 CCs que ninguém olha.

## Estrutura do MRR — decisões

**Movimento da carteira visível em R$** (`seed_mrr_movimento_carteira.sql`).
`CORRVL`/`CHURNVL` (mês) e `CORRAC`/`CHURNAC` (acumulado). O churn sempre
acumulou certo — o `MRR` se realimenta pelo `ANTERIOR()` —, mas só aparecia
como "a linha cai um pouco". A ordem importa: a correção vem antes do churn
dentro do `MRR`, então o `(1 + CORR/100)` mora no `CHURNVL`.
Identidade que confere sozinha:
`carteira anterior + BASE + correção − churn + receita nova = MRR`.

**Base × nova, e a postergação** (`seed_mrr_split_postergacao.sql`). Dois
estoques em vez de um, e um índice de atraso:

| linha | grava | |
|---|---|---|
| `MRRBASE` | → 10201 | carteira que evolui |
| `MRRNOVO` | → 10201 | receita nova, no prazo |
| `POSTERGVL` | → 10201 | efeito da postergação (negativa) |
| `MRR` | apoio | conferência, soma das três |

**Uma conta só, três gravações.** Exigiu mudar o Aplicar: ele somava linhas que
apontavam para a mesma conta ("evita colisão de chave"). A chave única do
`fat_orcado` inclui `dims`, então cada linha carimba o próprio código ali e as
três coexistem — distinguíveis no drill, somadas na DRE.

**O atraso sistemático já estava no modelo.** `ANTERIOR([META])` é "vendeu em m,
recebe em m+1" — negociar para janeiro e cair em fevereiro. `POST1`/`POST2` são
as postergações **além** dessa. Elas incidem só sobre a `META` do ano corrente;
nunca sobre o `METADEZ`, que é passado que o estudo já conhece. A perda não se
recupera: cada safra entra mais tarde no estoque e o buraco se arrasta até
dezembro. Medido (meta 40k/mês, base 1mi, repasse 18,5%):
`POST1=20%` → −2,8% da receita nova; `30%+10%` → −6,9%; `50%+20%` → −12,4%.
Com os índices vazios o resultado é **idêntico** ao de antes, verificado contra
o motor — por isso o seed pôde ser rodado sem risco.

**`METADEZ` servia para qualquer mês o tempo todo.** A fórmula lê a célula do
mês **corrente**; só o rótulo dizia "digitar em JANEIRO". Renomeado para
*"Venda de períodos anteriores que entra NESTE mês (R$ — do estudo)"*.

**`REP` não precisa virar linha nova para variar por produto.** A linha já
existe; o itálico na tela só quer dizer "esta célula está vazia aqui, herdou do
🌐". Preencher no escopo da BU sobrescreve, e as BUs sem valor próprio seguem
pegando a média global. Vale igual para o `CHURN`.

## Pendências

- **Cadastro de CC torto (anotado em 28/out).** `327` e `328` têm descrição
  *"Base Sustentação"* e *"Base Smart"*, mas estão na faixa `32x`, que é a de
  **Novos** (320 Novos-Diretoria, 321 Novos PC … 326 Novos Moda). Repete igual
  em Bauru e Rio Preto, nas duas filiais — não é digitação isolada. Quem mapear
  por nome classifica errado; quem mapear por faixa discorda do nome. A consulta
  `contexto_formulario_para_estudo.sql` traz `classe_nome` e `classe_faixa` lado
  a lado para expor isso. **Decidir qual das duas leituras vale e corrigir.**
- **As três faixas de CC** (2xx / 3xx / 5xx) — o que distingue `211` de `311` de
  `511` para o mesmo produto. A faixa `3xx` aparece recebendo **reclassificação**
  (`YY·2001·214 = +13.440` contra `YY·2001·314 = −13.440` no mesmo mês;
  `06·2001·314 = +18.658`), o que sugere uso contábil de ajuste — mas é
  inferência, não resposta.
- **`ANTERIOR()` não atravessa o ano** ([engine.ts](../frontend/src/lib/engine.ts),
  `prevKey` devolve `null` antes do 1º período). É a terceira vez que isso
  aparece: o `METADEZ` do MRR, a rampa de 6 safras do não-recorrente e agora a
  parte postergada de nov/dez. Cada caso ganhou uma muleta própria. A correção
  de verdade é o motor enxergar o ano anterior (realizado ou orçado) — parente
  do `inicio_projecao` desenhado na F7.
- **Flag de "premissa anual"** no `formulario_linha`: premissa digitada uma vez
  valendo o ano todo, com o vazio herdando do mês anterior. Hoje é preciso
  preencher os 12 meses de `CHURN`/`CORR`/`REP`/`POST1`/`POST2` — e foi
  exatamente esquecer isso que errou o churn do orçamento de 2026 (medido:
  +10,5% de receita a mais). O seed defende contra a repetição, mas a digitação
  manual continua exposta.

## Rampa do não-recorrente (ainda não tratada)

`RECNR` parcela a venda NR em 6 meses, mas atravessando o ano carrega só
dezembro. Em janeiro deveriam estar gerando as safras de **jul a dez**: a
fórmula entrega 1/6 em janeiro, 1/3 em fevereiro, …, cheio só em junho — o 1º
semestre a **58% do regime**. O driver `PREVNR` ("Receitas NR de outros
períodos") parece ser a válvula de escape prevista para isso; falta confirmar se
está preenchido.
