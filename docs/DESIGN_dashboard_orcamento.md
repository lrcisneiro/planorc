# DESIGN — Dashboard de Orçamento

Proposta (out/2026). **Não implementado.** Para discussão antes de construir.

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

> Nunca o ano cheio contra o realizado parcial, calado. É exatamente o tipo de
> comparação que ninguém confere e que vira slide.

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

### 2 · Variação por linha, ordenada por IMPACTO

Não alfabética nem por tamanho: pela **contribuição ao delta**. As 15 linhas
que explicam a mudança, com absoluto e %. O resto colapsado em "demais".

Quem revisa orçamento quer saber o que mudou, não ler a DRE inteira.

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

**1, 2, 3 e 4.** Juntos já respondem "devo aprovar": de onde vem o crescimento,
o que mudou, dá para acreditar em quem fez, e o que foi feito no automático.

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
