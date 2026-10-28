# Prompt para o projeto do baseline (Claude Desktop)

> Copie daqui para baixo. Anexe junto a saída de `contexto_formulario_para_estudo.sql`
> (o realizado de 2026 por escopo, mês a mês).

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
| `METADEZ` | venda de períodos **anteriores** cuja receita entra NESTE mês | R$ |
| `CHURN` | % de perda mensal da carteira | **%** |
| `CORR` | % de correção (IGPM/IPCA) do mês | **%** |
| `REP` | % de comissão de repasse | **%** |
| `POST1` | % da venda que começa **1 mês** depois do previsto | **%** |
| `POST2` | % da venda que começa **2 meses** depois do previsto | **%** |

Como o motor usa isso, mês a mês:

```
receita nova  = (META do mês anterior + METADEZ do mês) × REP/100
MRR           = (MRR anterior + BASE) × (1 + CORR/100) × (1 − CHURN/100) + receita nova
```

## Sete regras que mudam o resultado

1. **Percentual é em pontos percentuais.** Churn de 0,95% escreve-se `0,95` — a
   fórmula já divide por 100. Escrever `0,0095` zera o churn e ninguém percebe.
2. **Preencha os 12 meses de `CHURN`, `CORR`, `REP`, `POST1` e `POST2`**, mesmo
   que o valor repita. Célula vazia vale **zero**, não "igual ao mês anterior".
   Foi exatamente esse esquecimento que inflou o orçamento de 2026 em 10,5%.
3. **`BASE` só em janeiro.** É o estoque inicial. Repetir nos outros meses soma
   a carteira doze vezes.
4. **A venda do mês gera receita no mês seguinte** — é o padrão do modelo
   (`META` do mês anterior). Negociar início para janeiro e a receita cair em
   fevereiro **já está** contemplado; não compense isso à mão.
5. **`METADEZ` é para qualquer mês, não só janeiro.** Use-o para a venda já
   fechada de 2026 cujo início você conhece: ponha o valor no mês em que ela
   entra. Ele **não** sofre `POST1`/`POST2` — é passado conhecido.
6. **`POST1`/`POST2` são o atraso ALÉM do padrão**, e só sobre a venda de 2027.
   Se o estudo não tiver essa medida confiável, deixe os dois em branco: o
   modelo funciona sem eles. Não chute.
7. **Não some Base com Novos.** São centros de custo diferentes (ver abaixo), e
   cada um tem o próprio `BASE`, `META`, `CHURN` e `REP`.

## Os 48 escopos

Seis empresas, uma filial cada, oito centros de custo:

- **Empresas:** `01`, `05`, `06`, `25`, `YY`, `ZZ`
- **Filial:** `2001` para **ZZ** e **06**; `2101` para `01`, `05`, `25` e `YY`
- **Centros de custo** — quatro BUs, em Base e em Novos:

| BU | CC Base | CC Novos |
|---|---|---|
| 1 · PC-Sistemas | `211` | `221` |
| 4 · Gestão (ERP Tradicional) | `214` | `224` |
| 5 · RD | `215` | `225` |
| 6 · Moda | `216` | `226` |

Use **exatamente** esses códigos. Não invente nem abrevie.

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

Depois do CSV, escreva em **até 15 linhas**: de onde saiu cada premissa, o que
você estimou por falta de dado, e qual escopo ficou mais frágil. Se faltar
informação para algum dos 48, **diga qual** em vez de preencher com média.
