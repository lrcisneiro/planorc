# Prompt para o projeto do baseline (Claude Desktop)

> Copie daqui para baixo. Anexe junto a saída de `contexto_formulario_para_estudo.sql`
> (o realizado de 2026 por escopo, mês a mês).

---

## ⚠ O FORMULÁRIO MUDOU — leia antes de gerar (29/out/2026)

Da última vez eu disse que o formulário de MRR estava **fechado** e que só
faltavam os números de outubro. Isso mudou: **entrou um driver novo**.

| driver | o que é | obrigatório? |
|---|---|---|
| `INADIMP` | % de inadimplência sobre a receita do mês | **não** — pode vir vazio |

**Nada mais mudou.** Os oito drivers anteriores (`BASE`, `META`, `METADEZ`,
`CHURN`, `CORR`, `REP`, `POST1`, `POST2`) continuam idênticos em significado,
unidade e formato, e tudo o que você já apurou segue valendo. Na prática é **uma
linha a mais por escopo** no CSV — ou nenhuma, se você deixar o driver de fora.

**O que é a inadimplência aqui, e o que ela não é.** Churn tira o cliente da
carteira para sempre; inadimplência é um mês que não foi pago, com o cliente
ainda na base. Por isso ela desconta a receita **sem reduzir o estoque** — são
premissas de coisas diferentes, e o modelo as trata em lugares diferentes.

> **Não some inadimplência ao churn** nem desconte uma da outra. Se o seu estudo
> hoje embute perda por falta de pagamento dentro do churn, **diga isso** em vez
> de preencher os dois: o número está no lugar errado e precisa ser separado
> antes, não compensado depois.

Se o estudo não tiver essa medida com confiança, **deixe `INADIMP` em branco**.
Vazio vale zero e o resultado é exatamente o de antes — o Ricardo calibra o
percentual direto na tela. Não chute.

---

Você vai converter o estudo do baseline em uma tabela de entrada para o Planorc,
nosso sistema de orçamento. **Entregue uma tabela, não SQL** — você não enxerga o
banco e inventaria identificadores. Eu converto a tabela em carga.

## O que o formulário calcula

Projeção de receita recorrente (MRR) por escopo. As linhas de **entrada** são as
que você preenche; o resto é calculado pelo Planorc e não deve vir na tabela.

| código | o que é | unidade |
|---|---|---|
| `BASE` | MRR da carteira no início — **só em janeiro** | R$ |
| `META` | meta de venda de MRR novo, do mês | R$ |
| `METADEZ` | venda de períodos **anteriores** cuja receita entra NESTE mês — **jan e fev** | R$ |
| `CHURN` | % de perda mensal da carteira | **%** |
| `CORR` | % de correção (IGPM/IPCA) do mês | **%** |
| `REP` | % de comissão de repasse | **%** |
| `POST1` | % da venda que começa **1 mês** depois do previsto | **%** |
| `POST2` | % da venda que começa **2 meses** depois do previsto | **%** |
| `INADIMP` | % de inadimplência sobre a receita do mês | **%** |

Como o motor usa isso, mês a mês:

```
receita nova  = (META de DOIS meses atrás + METADEZ do mês) × REP/100
MRR           = (MRR anterior + BASE) × (1 + CORR/100) × (1 − CHURN/100) + receita nova
```

**Por que dois meses:** a TOTVS fatura no mês da meta, o vencimento cai no mês
seguinte e o pagamento vem no mês depois do vencimento. Meta em *m* → comissão
em *m+2*.

## Sete regras que mudam o resultado

1. **Percentual é em pontos percentuais.** Churn de 0,95% escreve-se `0,95` — a
   fórmula já divide por 100. Escrever `0,0095` zera o churn e ninguém percebe.
2. **Preencha os 12 meses de `CHURN`, `CORR`, `REP`, `POST1` e `POST2`**, mesmo
   que o valor repita. Célula vazia vale **zero**, não "igual ao mês anterior".
   Foi exatamente esse esquecimento que inflou o orçamento de 2026 em 10,5%.
3. **`BASE` só em janeiro.** É o estoque inicial. Repetir nos outros meses soma
   a carteira doze vezes.
4. **A venda gera receita dois meses depois** — é o ciclo de faturamento, já
   dentro do modelo. Não compense isso à mão deslocando a `META`.
5. **`METADEZ` precisa de JANEIRO e FEVEREIRO, obrigatoriamente.** A receita
   desses dois meses vem da meta de **nov e dez/2026**, e o motor não enxerga o
   ano anterior — sem o `METADEZ` o ano começa com dois meses de receita nova
   **zerada**. Medido num exemplo de meta 40k/mês: −165.328 no ano, 1,4% do MRR.
   Use-o também em março e abril se houver venda de 2026 que entre lá. Ele
   **não** sofre `POST1`/`POST2` — é passado conhecido, já com o ciclo aplicado.

   > ⚠ **`METADEZ` é venda BRUTA, não comissão.** A fórmula o multiplica por
   > `REP` junto com a `META`. Se a venda de novembro foi R$ 50.000 e o repasse
   > é 18,5%, escreva **`50000,00`** — não `9250,00`. Pôr a comissão já líquida
   > faz o formulário aplicar os 18,5% de novo e sobra 3,4% do valor real, em
   > dois meses que ninguém confere com lupa.
6. **`INADIMP` é cobrança que não entra, não é churn.** Churn tira o cliente da
   carteira para sempre; inadimplência é um mês que não foi pago, e a carteira
   continua lá. Por isso ela desconta a receita **sem** reduzir o estoque — não
   some a inadimplência ao churn nem tente compensar uma com a outra. Se o
   estudo não tiver a medida, deixe em branco: o Ricardo calibra depois.

7. **`POST1`/`POST2` são o atraso ALÉM do ciclo** (m+3 e m+4), só sobre a venda
   de 2027.
   Se o estudo não tiver essa medida confiável, deixe os dois em branco: o
   modelo funciona sem eles. Não chute.
8. **Não some Base com Novos.** São centros de custo diferentes (ver abaixo), e
   cada um tem o próprio `BASE`, `META`, `CHURN` e `REP`.
9. **`BASE` é o estoque do ÚLTIMO mês do histórico, não a média do ano.** A
   média mistura meses de realidades diferentes, e em 2026 isso acontece de
   verdade (ver a nota sobre a empresa 25 abaixo). Tire o `BASE` do último mês
   fechado e projete a partir dele.
10. **Ignore os lançamentos de reclassificação.** No realizado de 2026 há linhas
   com **um único mês e valor negativo** que casam, centavo a centavo, com uma
   linha positiva em outra empresa — por exemplo `−248.762,34` na empresa 05 e
   `+248.762,34` na 25, no mesmo CC. São transferências contábeis de carteira,
   não receita. Não as some ao histórico nem as use para calcular churn.

> **A empresa 25 (Moda) mudou de filial no meio de 2026.** A carteira saiu da
> `2101` e foi para a `2501`: no CC `216`, a `2101` terminou o histórico em
> **R$ 8,73** e a `2501` em **R$ 280.506**. Para 2027 ela vive na `2501`. Some
> as duas filiais ao reconstruir o histórico da 25, mas lance o resultado só na
> `2501`.

## Os 60 escopos

Seis empresas, **uma filial cada**, dez centros de custo. Use exatamente estes
códigos — não invente, não abrevie, não troque a filial.

| empresa | nome | filial |
|---|---|---|
| `01` | Bauru | `2101` |
| `05` | Rio Preto | `2101` |
| `06` | Mato Grosso do Sul | `2001` |
| `25` | Moda | `2501` |
| `YY` | Cascavel | `2101` |
| `ZZ` | Londrina | `2001` |

| BU | CC Base | CC Novos |
|---|---|---|
| 1 · PC-Sistemas | `211` | `221` |
| 2 · HXM | `212` | `222` |
| 4 · Gestão (ERP Tradicional) | `214` | `224` |
| 5 · RD | `215` | `225` |
| 6 · Moda | `216` | `226` |

6 × 1 × 10 = **60 escopos**. São 9 drivers por escopo (8, se `INADIMP` ficar
de fora), então o CSV terá até 540
linhas. Entregue todas.

## Formato da resposta

Um bloco CSV, separador `;`, decimal com **vírgula**, sem separador de milhar,
sem aspas. Uma linha por escopo × driver, com os doze meses em colunas:

```
empresa;filial;cc;linha;jan;fev;mar;abr;mai;jun;jul;ago;set;out;nov;dez
01;2101;211;BASE;125000,00;;;;;;;;;;;
01;2101;211;META;8000,00;8000,00;8500,00;8500,00;9000,00;9000,00;9000,00;9500,00;9500,00;10000,00;10000,00;10000,00
01;2101;211;CHURN;0,95;0,95;0,95;0,95;0,95;0,95;0,95;0,95;0,95;0,95;0,95;0,95
01;2101;211;REP;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50
```

Célula vazia = sem valor naquele mês (é o caso do `BASE` de fevereiro em diante).

> **A meta de nov e dez/2027 não vira receita em 2027** — ela cai em jan e
> fev/2028, pelo ciclo de dois meses. Não é erro nem perda; é só a razão de a
> soma das metas do ano não bater com a receita nova do ano. Não tente
> compensar.

Depois do CSV, escreva em **até 15 linhas**: de onde saiu cada premissa, o que
você estimou por falta de dado, e qual escopo ficou mais frágil. Se faltar
informação para algum dos 48, **diga qual** em vez de preencher com média.
