# Prompt para o estudo — Não Recorrente e Serviços (Claude Desktop)

> Copie daqui para baixo. Anexe junto a saída de `contexto_formulario_para_estudo.sql`
> (o realizado de 2026 por escopo, mês a mês).
>
> Irmão do `PROMPT_estudo_baseline_mrr.md`, que cobre a receita recorrente. Os
> escopos e o formato são os mesmos; os drivers, não.

---

Você vai converter o estudo em tabelas de entrada para o Planorc, nosso sistema
de orçamento. São **dois formulários**: receita **não recorrente (NR)** e
receita de **serviços**. **Entregue tabelas, não SQL** — você não enxerga o
banco e inventaria identificadores.

---

# Formulário 1 — Receita não recorrente

A venda NR (licenças, implantação) é parcelada: a venda do mês *m* vira *N*
parcelas iguais a partir de *m+1*, e sobre elas incide o % de repasse. Além
disso, cada venda deixa uma **mensalidade** que acumula como carteira.

## Drivers de entrada

| código | o que é | unidade | quando |
|---|---|---|---|
| `METANR` | meta de venda NR do mês, **bruta** | R$ | 12 meses |
| `NPARC` | nº médio de parcelas da venda | número | 12 meses |
| `PARCANT` | parcelas de safras **anteriores** que entram neste mês, **brutas** | R$ | jan…jun |
| `PREVNR` | outras receitas NR previstas, **já líquidas** | R$ | onde houver |
| `METADEZ` | meta de **dezembro/2026**, bruta — só para gerar mensalidade | R$ | **só janeiro** |
| `REPNR` | % de repasse sobre a venda NR | **%** | 12 meses |
| `PMENS` | % de mensalidade sobre a venda NR | **%** | 12 meses |
| `REPM` | % de repasse sobre a mensalidade | **%** | 12 meses |
| `CHURNNR` | % de perda da carteira de mensalidades | **%** | 12 meses |
| `CORRNR` | % de correção da carteira | **%** | 12 meses |

O que o motor faz com isso:

```
receita NR  = ( Σ parcelas das metas anteriores (peso definido por NPARC)
                + PARCANT ) × REPNR/100  +  PREVNR

mensalidade nova = (METANR do mês anterior + METADEZ) × PMENS/100
carteira         = carteira anterior × (1+CORRNR/100) × (1−CHURNNR/100) + mensalidade nova
receita recorrente = carteira × REPM/100
```

## Oito regras que mudam o resultado

1. **Percentual é em pontos percentuais.** Repasse de 18,5% escreve-se `18,50`.
   A fórmula já divide por 100; `0,185` zera a receita e ninguém percebe.

2. **Preencha os 12 meses de todo percentual**, mesmo repetindo o valor. Célula
   vazia vale **zero**, não "igual ao mês anterior". Com `REPNR` vazio a
   receita NR daquele mês é **zero**.

   > ⚠ Isso já está acontecendo. Hoje o formulário tem 48 valores de `METANR` e
   > só 24 de `REPNR` — metade dos escopos tem meta sem repasse, portanto
   > receita zero. Entregue os dois completos para todos os escopos.

3. **`PARCANT` é bruta, `PREVNR` é líquida.** As duas carregam receita de fora
   do ciclo do ano, mas o motor as trata de forma oposta: a `PARCANT` ainda vai
   ser multiplicada por `REPNR`, a `PREVNR` não. Escolher a errada erra o
   número por um fator de ~5.

   | você sabe | use | escreva |
   |---|---|---|
   | o valor da **venda** antiga sendo parcelada | `PARCANT` | o valor bruto |
   | a **comissão** que de fato vamos receber | `PREVNR` | o valor líquido |

   **Nunca as duas para o mesmo dinheiro** — seria contar duas vezes.

4. **`PARCANT` é o que conserta a virada de ano, e é obrigatória.** Em janeiro
   de 2027 deveriam estar parcelando as safras de **jul a dez/2026** — seis
   vendas diferentes. O motor não enxerga o ano anterior, então sem a `PARCANT`
   janeiro entra com **zero** de safra antiga, fevereiro com um sexto, e o
   primeiro semestre inteiro sai a **58% do regime**.

   Para cada mês de jan a jun, some o que ainda falta parcelar de cada safra de
   2026 e escreva o total. Com *N* = 6, em janeiro são as parcelas que faltam
   de jul, ago, set, out, nov e dez.

5. **`METADEZ` NÃO é mais parcelamento.** Ele tinha dois papéis e agora tem um
   só: a meta de **dezembro/2026**, bruta, digitada **só em janeiro**, que serve
   exclusivamente para gerar a mensalidade que nasce em janeiro. O parcelamento
   da venda de dezembro vai na `PARCANT`, como o das outras safras. Pôr o mesmo
   dinheiro nos dois conta duas vezes.

6. **`NPARC` sai do estudo, por unidade.** É o número médio de parcelas daquela
   BU. **Aceita fracionário**: `5,5` produz cinco parcelas cheias e uma meia,
   somando a venda inteira. Deixar vazio vale **6** — então só preencha se
   souber; não chute.

   > Com `NPARC` alto a venda atravessa o ano: *N* = 12 numa venda de janeiro
   > entrega 11 parcelas em 2027 e a 12ª em 2028. Não é perda — é a parcela
   > pertencendo ao ano seguinte, e quem a recebe lá é a `PARCANT` de 2028.

7. **Não projete a carteira histórica de mensalidades.** A conta contábil que
   recebe comissão recorrente recebe **tudo**, qualquer que seja a origem, e
   essa carteira antiga já está no `BASE` do formulário de MRR. Aqui projete
   **apenas** a mensalidade nova, gerada pelas vendas NR de 2027. Não existe
   driver de estoque inicial neste formulário, e isso é proposital.

8. **Se o estudo não tiver churn ou correção da carteira NR, deixe em branco.**
   Vazio é neutro nesses dois (`1 − 0` e `1 + 0`). Não chute.

---

# Formulário 2 — Receita de serviços

O mais simples dos três. A receita cai no **mês da execução**, a meta **já é a
receita** (não há repasse) e serviço **não deixa cauda recorrente**.

| código | o que é | unidade | quando |
|---|---|---|---|
| `METASV` | receita de serviços do mês, **somando todos os tipos** | R$ | 12 meses |

Um driver só, nenhuma fórmula. O valor que você escrever é o que entra na DRE
daquele mês — não aplique percentual nenhum antes.

> Por não usar defasagem, este é o único dos três **imune** ao problema de
> virada de ano. Não há safra anterior escorrendo para dentro de 2027: não
> procure por ela, não crie driver para ela.

Serviço tem sazonalidade forte (férias, fechamento de ano). Como você entrega
mês a mês, traga a sazonalidade do histórico em vez de dividir o ano por doze.

## Uma linha agora, várias depois

**No histórico de 2026 a receita de serviços aparece repartida** entre várias
contas — *Horas Abertas*, *Projetos Fechados*, *OutSourcing*, *Banco de Horas*,
*Templates*, *Sustentação*, *Assessoria MKT*. Isso é o cadastro real; não é
inconsistência do extrato.

**Nesta versão do orçamento, some tudo numa linha só.** O objetivo aqui é
calibrar o EBITDA e dimensionar o time de serviços, e para isso o total basta.
Entregue `METASV` consolidada por escopo, somando todos os tipos de serviço.

> As linhas por tipo **já existem** no formulário, vazias, uma por conta
> (`SV11002` Projetos Fechados, `SV11003` OutSourcing, `SV11006` Sustentação…).
> Quando o orçamento final pedir a divisão, o pedido virá explícito com a lista
> de códigos. Até lá, **não reparta por conta própria** e não invente esses
> códigos: uma linha `METASV` por escopo, com o total.

Ao reconstruir a sazonalidade, porém, **olhe os tipos separados antes de
somar**: sustentação é estável mês a mês, projetos fechados são irregulares e
horas abertas acompanham o calendário de férias. A curva do total pode esconder
que um tipo cresce enquanto outro encolhe, e isso muda a projeção.

---

# Os 60 escopos (valem para os dois formulários)

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

> **A empresa 25 (Moda) mudou de filial no meio de 2026** — saiu da `2101` para
> a `2501`. Some as duas ao reconstruir o histórico, mas lance o resultado só
> na `2501`.

> **Ignore os lançamentos de reclassificação:** linhas com **um único mês e
> valor negativo** que casam centavo a centavo com uma positiva em outra
> empresa. São transferências contábeis de carteira, não receita.

---

# Formato da resposta

**Dois blocos CSV separados**, um por formulário. Separador `;`, decimal com
**vírgula**, sem separador de milhar, sem aspas. Uma linha por escopo × driver,
com os doze meses em colunas:

```
empresa;filial;cc;linha;jan;fev;mar;abr;mai;jun;jul;ago;set;out;nov;dez
01;2101;211;METANR;80000,00;80000,00;85000,00;85000,00;90000,00;90000,00;90000,00;95000,00;95000,00;100000,00;100000,00;100000,00
01;2101;211;NPARC;6,0;6,0;6,0;6,0;6,0;6,0;6,0;6,0;6,0;6,0;6,0;6,0
01;2101;211;PARCANT;210000,00;175000,00;140000,00;105000,00;70000,00;35000,00;;;;;;
01;2101;211;METADEZ;95000,00;;;;;;;;;;;
01;2101;211;REPNR;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50;18,50
```

Célula vazia = sem valor naquele mês. Repare no desenho da `PARCANT` acima: ela
**decresce** de janeiro a junho, porque a cada mês uma safra de 2026 termina de
parcelar. Se a sua vier constante ou crescente, provavelmente está errada.

Serviços sai num bloco próprio, com `METASV` como única `linha`.

Depois dos CSVs, escreva em **até 20 linhas**: de onde saiu cada premissa, o que
você estimou por falta de dado, e qual escopo ficou mais frágil. Se faltar
informação para algum dos 60, **diga qual** em vez de preencher com média.
