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

**O ciclo de faturamento é de 2 meses** (corrigido em 28/out). A TOTVS fatura no
mês da meta, o vencimento cai no mês seguinte e o pagamento vem no mês depois do
vencimento: meta em *m* → comissão em *m+2*. Daí `ANTERIOR([META],2)`, e não o
`ANTERIOR([META])` de um mês que o formulário trazia. `POST1`/`POST2` são as
postergações **além** desse ciclo (m+3 e m+4).

> Medido: com `METADEZ` preenchido em jan **e** fev, o resultado é **idêntico**
> ao da defasagem de um mês — o ciclo desloca, não destrói. Sem ele, o ano
> começa com dois meses de receita nova zerada: −165.328 num exemplo de meta
> 40k/mês, 1,4% do MRR anual. E a meta de nov/dez de cada ano só vira receita no
> ano seguinte, o que explica a soma das metas não bater com a receita nova.
>
> **O `N` do `ANTERIOR([X],N)` é literal** — o motor exige um número na
> expressão ([engine.ts](../frontend/src/lib/engine.ts), regex `(\d+)`). Se o
> ciclo de pagamento mudar, é edição de fórmula, não parâmetro. Elas incidem só sobre a `META` do ano corrente;
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

## O `BASE` é FLUXO de comissão, não estoque contratado (decidido 28/out)

A primeira carga produziu um **degrau em janeiro**: 4,37 mi/mês contra 4,46 em
dez/26. O sintoma era um mês com **receita nova zero** — o único do ano —, porque
`ANTERIOR([META],2)` devolve 0 em janeiro e o `METADEZ` de janeiro estava vazio.

A causa não era célula faltando, era **relógio**. O formulário trabalha em fluxo
de comissão (venda em *m* → comissão em *m+2*); o baseline fora medido como
estoque contratado, em que a venda entra quando é assinada. Os dois não compõem,
e a inconsistência aparecia no recorte: a venda de **dezembro** estava fora do
`BASE` (daí `METADEZ` em fevereiro) mas a de **novembro** estava dentro. São
previsões do mesmo tipo; não há motivo para cortar entre elas.

**Decisão:** o `BASE` é a **comissão apurada em dez/26** — é isso que a conta
`10201` registra no realizado, e é com ela que o orçado será comparado. Logo:

| venda | comissão cai em | onde fica |
|---|---|---|
| out/26 | dez/26 | dentro do `BASE` |
| nov/26 | jan/27 | `METADEZ` de **janeiro** |
| dez/26 | fev/27 | `METADEZ` de **fevereiro** |

Contratos com **carência** (a Frigoestrela, que fatura em jan/27) ficam no
`METADEZ` em qualquer leitura — estão fora de qualquer baseline de 2026.

**Resultado:** nenhum mês cai, jan sai a −0,5% de dez/26 (o churn de janeiro
incidindo uma vez sobre a venda de novembro) e o total do ano praticamente não
muda — 56,417 mi contra 56,412 antes. O `BASE` caiu 71.953 e a venda de novembro
entrou valendo ~74.000 de comissão: os dois se anulam, que é o que tem de
acontecer ao mover receita de balde sem criar nem destruir nada.

> **Leitura do orçamento 2027:** a carteira **encolhe** o ano todo, de 4,295 para
> 4,129 mi/mês (−3,9%) — o churn supera a correção. Os +15,3% vêm **inteiros** da
> receita nova, que sai de 72 mil em janeiro para 906 mil em dezembro, 18% do
> total. Não é "a base cresce"; é "a base vaza e a venda nova tapa com folga".

## Carga e calibragem

A calibragem é iterativa — o estudo devolve o CSV, confere-se na tela, corrige e
devolve de novo —, então a carga é **botão, não script de uma vez só**. No editor
do formulário (Preencher):

- **Importar** — tabela larga (`empresa;filial;cc;linha;jan;…;dez`), decimal com
  vírgula, separador `;` ou `,`. Dois modos:
  - *Substituir* (padrão): o arquivo é a verdade para as linhas que traz. Apaga
    os 12 meses de cada escopo × linha presente e regrava. **Célula vazia no
    arquivo remove a que existia** — é o que permite corrigir *tirando* valor.
  - *Só incluir/atualizar*: grava o preenchido e não toca no resto.
- **Limpar** — três coisas diferentes, e confundi-las custa caro:
  - *só o escopo selecionado* — a empresa/filial/CC da barra;
  - *o formulário inteiro* — todos os escopos da versão/ano, sem visitar os 60
    um a um (quem desiste no meio fica com metade do cenário velho e metade do
    novo, que é pior do que não limpar);
  - *o orçado já aplicado* — os lançamentos que **este** formulário mandou para
    o `fat_orcado`. Vive noutra tabela e **sobrevive a tudo** que se faça no
    formulário; o filtro por `origem_formulario_linha_id` garante que manual e
    outros formulários ficam.

> **O relatório lê o `fat_orcado`, não o formulário.** Mudar driver e ir ao
> relatório mostra número velho até o *Aplicar* rodar — foi o que fez dois
> cenários de meta (15% × 20%) aparecerem com a diferença invertida, com a
> suspeita caindo sobre a fórmula, que estava certa.
>
> **Resolvido (v3_122).** `formulario_aplicacao` guarda uma linha por formulário
> × versão × ano com o `aplicado_em`, carimbada a cada Aplicar; a tela compara
> com o `max(atualizado_em)` das células e mostra **⚠ alterações não aplicadas**
> ao lado do botão (ou **nunca aplicado**). Limpar o orçado apaga o carimbo, que
> é o estado correto. O `atualizado_em` ganhou **trigger**: ele existia desde a
> v3_049 mas só era preenchido no INSERT — o editor de célula fazia UPDATE sem
> tocá-lo —, então não servia para "mudou desde quando". Com o trigger vale para
> qualquer caminho de escrita: tela, importação ou SQL.

> **Sem upsert.** A chave única do `formulario_valor` é um **índice de
> expressão** — `COALESCE()` nos ids e `dims::text` ([v3_052](../schema_v3_052_formulario_valor_cc.sql))
> — e o PostgREST não casa `ON CONFLICT` com isso. A carga apaga o alvo e
> insere; os dois modos diferem só no **que** apagam antes. O delete é agrupado
> por escopo + conjunto de meses, não por linha: no arquivo típico são três
> assinaturas por escopo (só jan, jan+fev, os 12 meses), então 60 escopos custam
> ~180 chamadas e não 480.

Linhas **calculadas** que venham no arquivo são ignoradas (o motor as recalcula),
e o 🌐 global não é tocado pela importação. O parser vive em
[`lib/importFormulario.ts`](../frontend/src/lib/importFormulario.ts); a largura
é deliberada: 60 escopos × 8 drivers × 12 meses são 5.760 linhas no formato
longo e 480 em colunas — emitíveis por um modelo e conferíveis no Excel.

## A FK `filial.empresa_id` não filtra o seletor (28/out)

A NF de comissão sai **só nas filiais de Rio Preto** (`2001`/`2101`) e o valor é
rateado gerencialmente para as outras unidades. Então `01 · 2101` é combinação
legítima — e tem 10 meses de realizado. Mas a FK diz que a `2101` é da empresa
`05`, e o seletor de filial filtrava por ela: o dado existia e **sumia da tela**.
Foi o que fez a carga de 2027 parecer não ter funcionado.

No editor do formulário a FK virou **ordem, não filtro**: primeiro as filiais da
empresa, depois as que já têm dado no escopo, depois o resto — com
`(de outra empresa)` ao lado, para a escolha ser consciente. É a aplicação local
da dívida já registrada: *empresa é agrupadora de filiais, não matriz*.

> **Mesmo filtro existe em outras telas.** Aqui foi corrigido porque bloqueava.
> Onde mais `filter(f => f.empresa_id === empresaId)` aparecer, o sintoma vai ser
> o mesmo: dado gravado que não aparece.

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

## Não recorrente — resolvido em 29/out

Eram **dois** furos de virada de ano, não um.

**A rampa.** `RECNR` espalhava o `METADEZ` em seis parcelas, mas em janeiro
todo `ANTERIOR` devolve 0 e sobrava `METADEZ/6` — uma safra de seis. Média do
1º semestre: 21/36 = **58,3% do regime**. Em janeiro/27 deveriam estar
parcelando as safras de **jul a dez/26**, seis vendas diferentes, e nenhum
arranjo de um único número reconstrói isso. Entrou o driver **`PARCANT`**, que
o estudo preenche mês a mês — mesmo padrão que o MRR adotou para o `METADEZ`.

**Os dois papéis do `METADEZ`.** Ele valia *parcelas entrando* na rampa e
*venda de dezembro* na `MENSNOVA`, que são números diferentes. O primeiro papel
virou `PARCANT`; o segundo ficou, porque está certo.

**O `MRRNR` nascer do zero NÃO é bug.** A conta 10201 recebe toda comissão
recorrente, qualquer que seja a origem, então a carteira de mensalidades antiga
já está no `BASE` do MRR. Um `BASENR` aqui contaria a carteira histórica duas
vezes. Este formulário projeta só a mensalidade **nova**, gerada pelas vendas
NR do ano — e o MRR não a tem porque as metas de Recorrente, NR e Serviços são
separadas, uma por formulário.

### Nº de parcelas por escopo

Era fixo em 6 na fórmula; o estudo tem esse número **por unidade**. Não dá para
escrever `ANTERIOR([METANR],[NPARC])` — o motor exige `N` literal (a regex só
casa dígito). O desenho que resolve mantém os **doze termos sempre presentes** e
deixa o `N` definir o peso de cada um:

```
peso_i = MINIMO(1; MAXIMO(0; N − (i−1))) / N
```

Isso cobre `N` **fracionário**, que é o que o seed original pedia ao chamar
`v_parcelas` de "média de meses": com `N = 5,5` saem cinco parcelas cheias e
**uma meia**, somando a venda inteira. Dividir por 5,5 e cortar em 5 perderia
9% da receita em silêncio.

Guarda do vazio numa linha de apoio — `NP = SE([NPARC] < 1; 6; [NPARC])` —
porque célula vazia vale **0** no motor, e `N = 0` zeraria a receita NR daquele
escopo sem nenhum aviso na tela.

Verificado contra o motor: `NPARC` vazio dá resultado idêntico mês a mês à
fórmula antiga; os pesos somam 1 para `N` = 1, 5, 5,5, 6, 7,3 e 10; e os 60
escopos do *Aplicar em todos* passaram de 93 ms para 272 ms.

> ⚠ **Dois seeds disputavam a fórmula do `RECNR`** — o da rampa com 6 fixas, o
> do parâmetro com os 12 termos — e quem rodasse por último vencia, em
> silêncio. Aconteceu. O da rampa agora só escreve se a linha `NP` não existir,
> e a conferência acusa qual versão está no ar.

### Vencidas e inadimplência (29/out)

Dois acréscimos ao NR, com convenções opostas que convém não confundir.

**Recuperação de vencidas.** `VENCIDO` é o **estoque** de receitas vencidas, em
R$ **líquidos** — já é a comissão que nos cabe, então o `REPNR` não incide
(mesma convenção da `PREVNR`, o oposto da `PARCANT`). `PRECUP` é o % que se
planeja receber, e a `RECVENC` dilui igualmente nos doze meses. Grava no orçado
em **linha própria, na mesma conta do `RECNR`**: é passado recuperado, não venda
nova, e separar não custa nada porque o Aplicar grava uma linha por vez.

**Inadimplência embutida.** `INADIMP` multiplica o `RECNR` inteiro por
`(1 − INADIMP/100)` — pegando as parcelas **e** a `PREVNR`, que são cobrança
que pode não entrar. Fica **fora** da `RECVENC` (o `PRECUP` já é a estimativa
de perda dela) e **fora** da mensalidade (lá a perda é o `CHURNNR`). Sem linha
negativa separada: foi escolha explícita, ao contrário do `POSTERGVL` do MRR.

> **Premissa anual emulada com `ANTERIOR()`.** Enquanto a flag de premissa anual
> não existe, a `RECVENC` a emula:
> `=SE([VENCIDO] > 0; [VENCIDO] * [PRECUP] / 100 / 12; ANTERIOR())`.
> Janeiro calcula, os demais copiam o mês anterior **desta linha**. Preencher só
> janeiro basta, e preencher os doze com o mesmo valor dá idêntico — os dois
> hábitos funcionam. O preço: preencher `VENCIDO` num mês do meio do ano
> **recomeça a série** dali.

Verificado contra o motor: com os três drivers vazios o `RECNR` é idêntico mês a
mês ao de antes; `VENCIDO` 1.200.000 com `PRECUP` 50% em janeiro dá 50.000/mês e
600.000 no ano, igual a preencher os doze; `INADIMP` de 0, 2, 5 e 12,5% desconta
o percentual exato; e com `INADIMP` em 10% a `RECVENC` fica intacta.

### Inadimplência no MRR — por que linha separada, e não embutida (29/out)

A mesma premissa, desenhada ao contrário do NR, e por um motivo técnico.

No NR o `RECNR` é **fluxo**: multiplicá-lo por `(1 − INADIMP/100)` desconta uma
vez e acabou. No MRR as três linhas que gravam são **estoque** e se
auto-referenciam por `ANTERIOR()`. Pôr o fator dentro do `MRRBASE` faria o
desconto de janeiro entrar no `ANTERIOR()` de fevereiro e ser descontado de
novo, e outra vez em março — a inadimplência viraria **churn composto**.
Medido: 3% ao mês deixam a carteira de dezembro **30,6% menor**, quando o que
se queria era descontar 3% da receita.

A distinção econômica é a mesma: **churn tira o cliente da carteira para
sempre; inadimplência é uma cobrança que não entrou naquele mês** e não reduz a
carteira.

Daí `INADVL = −([MRRBASE] + [MRRNOVO] + [POSTERGVL]) × [INADIMP]/100`, linha
própria e negativa na mesma conta — o padrão que a postergação já usava. A
carteira fica bruta, a DRE soma os quatro lançamentos e chega no líquido, e o
drill mostra quanto da projeção é inadimplência.

> A soma é **explícita**, não `−[MRR] × [INADIMP]/100`. Como o `MRR` passa a
> incluir o `INADVL`, referenciá-lo criaria um ciclo: o motor convergiria para
> `MRR = bruto/(1+i)`, que não é o pedido e depende da ordem das linhas.

Verificado: com `INADIMP` vazio o total é 12.142.327,26 — o mesmo valor de
referência do seed da postergação; a carteira de dezembro fica em 935.531,28
com 0%, 3% e 10%; e o desconto é o percentual exato da receita.

## Serviços — o mais simples dos três (29/out)

Receita no **mês da execução**, a meta **já é a receita** (sem repasse), e
serviço **não deixa cauda recorrente**. Nenhuma fórmula: **uma linha só**,
`METASV`, ANALITICA com conta de destino. O Aplicar monta os destinos com
`linhas.filter(l => l.conta_destino_id)`, sem olhar o `tipo_linha`, então uma
ANALITICA grava igual a uma FORMULA.

Por não usar `ANTERIOR()`, é o único dos três **imune** ao furo de virada de
ano.

**Uma linha por conta, preenchendo uma.** Serviços não tem uma conta, tem uma
família sob a sintética `110` — ao contrário do MRR (`10201`) e do NR
(`10101`). O formulário ganha **todas** como linhas, criadas vazias; hoje
preenche-se só a `METASV`, com a meta consolidada, e quando o estudo trouxer a
meta por tipo as outras já estão lá.

> **Por que a `METASV` não é uma linha a mais.** Ela aponta para a `11001`, e as
> demais apontam cada uma para a sua — **nunca duas para a mesma conta**. Uma
> "consolidada" convivendo com uma "SV11001" somaria em dobro se ambas fossem
> preenchidas, e nada na tela denunciaria. Assim, no dia da divisão a `METASV`
> *passa a ser* a linha de Horas Abertas: tira-se dela o que é dos outros tipos
> e distribui. Nenhum dado muda de conta.

A criação das linhas é **dinâmica** (`codigo LIKE '110__'`), para conta nova na
faixa entrar sozinha numa re-rodada em vez de faltar sem ninguém perceber. A
`11020` (Reembolso por NF) entra pela faixa mas é reembolso, não venda — fica
vazia se não for meta comercial.

Enquanto a meta estiver consolidada na `11001`, **Orçado × Realizado fecha no
total de serviços, não linha a linha**: o realizado de Sustentação e OutSourcing
continua nas contas deles e aparecerá como orçado zero contra realizado cheio.
Não é erro de carga.

O Aplicar ignora linha sem valor (`if (!v) continue`), então as linhas vazias
não gravam nada.

## Armadilha de operação: o SQL Editor desfaz o seed

O editor roda o arquivo inteiro **numa transação**. Um seed que termina com
consulta pesada pode estourar o timeout no `SELECT` final e **desfazer o `DO`
que já havia rodado** — sem parecer que falhou. Aconteceu com o seed de
serviços, cuja busca de contas candidatas trazia um `count(*)` sobre
`fat_realizado` correlacionado por conta. Conferência de seed tem de ser leve.
