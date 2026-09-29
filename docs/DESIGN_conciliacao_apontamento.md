# Conciliação Apontamento × Folha

> Status: **desenho**, medido sobre dados reais (apontamento jul/2026 × folha ago/2026).
> Terceira pill da Conciliação, ao lado de *Orçado × Folha* e *Contábil × Folha*.

## A pergunta

Profissionais de serviço apontam horas em projetos. Desses apontamentos nascem verbas
por centro de custo, e a folha calcula e paga — o PJ por nota fiscal. Hoje o líder da
área **não consegue verificar se as horas que ele aprovou viraram custo no centro de
custo e na empresa do projeto**. A aba responde exatamente isso, e nada além.

## O que foi medido

Dois extratos, 58 colunas cada:

| arquivo | linhas | valor | recursos |
|---|---|---|---|
| `Extrato_Horas_Apontadas_20260601_20260630.xlsx` | 4.813 | 2.114.841,36 | 182 |
| `Extrato_Horas_Apontadas_20260701_20260731.xlsx` | 4.943 | 2.169.729,02 | 172 |

**A competência vem do nome do arquivo** — `yyyyMMdd_yyyyMMdd`, de/até. Não há coluna de
competência no conteúdo, e `Dt. Pgto Fol` vem vazia. A importação lê o período do nome e
confere contra a coluna `Data`; divergência é erro de arquivo, não de regra.

**`Custo` = `CUSTO_HORA` × `Qt. Horas` nas 4.943 linhas, sem uma exceção** e sem taxa
zerada. É a coluna de valor. (`TOTAL_SEMIMP`/`TOTAL_COMIMP` são valor de venda ao
cliente, não custo — ficam fora.)

**`Empresa` + `Filial` concatenam no padrão de 4 dígitos da folha** (`20`+`05` → `2005`),
o mesmo que `converter_folha_realizada.py` monta. A chave de local casa sem tradução.

### Quem é PJ não é o que o arquivo diz

A coluna `Cargo` é a **função no projeto** (`CONSULTOR(A)`, `GESTOR DE PROJETOS`), não o
tipo de contrato. Ela marca só 85 linhas como `TERCEIRO`/`TERCEIROS` — e com duas
grafias. Cruzando o recurso com a folha (conta de terceiro `41021001`):

| tipo real | linhas | valor | % |
|---|---|---|---|
| **PJ** — folha em conta de terceiro | 3.996 | 1.817.009,62 | **83,7 %** |
| CLT — folha em conta própria | 797 | 269.298,84 | 12,4 % |
| sem de-para recurso→matrícula | 130 | 75.785,36 | 3,5 % |
| sem folha na competência | 20 | 7.635,20 | 0,4 % |

**O tipo de contrato vem da folha, nunca do apontamento.**

### A verba que corresponde é a 222

Testado contra a folha de agosto, chave `(filial, matrícula, CC)`:

| verbas da folha | conciliado | apontado s/ folha | folha s/ apontado | diferença |
|---|---|---|---|---|
| **222 HORAS FATURAVEIS** | **146** | 95 | **2** | 30 · −12.268,92 |
| 222 + 418 | 130 | 95 | 2 | 46 |
| 222 + 228 | 143 | 72 | 107 | 56 |
| todas | 44 | 72 | 107 | 155 |

Só **2 chaves** de folha sem apontamento confirmam o recorte. Qualquer verba a mais
estoura o lado da folha.

### O tamanho do problema que a aba vai mostrar

- **84 de 172 pessoas** batem no total (ignorando o CC).
- Dessas, **8 pessoas têm o valor em CC diferente** — R$ 5.531,10 deslocados entre
  centros de custo. É o achado que o líder procura, e é pequeno.
- As outras **88 pessoas não batem nem no total**: apontado R$ 1.817.009,62 contra
  R$ 1.463.874,10 na verba 222. **Faltam ~353 mil na folha**, e essa é a questão maior
  — ver *Em aberto*.

## O integrador do ERP (`OEFOLM02.PRW`) — a fonte da verdade

O fonte ADVPL que leva o apontamento para a folha respondeu o que a medição não
conseguia. **A conciliação é em HORAS, não em valor.**

### Como a folha é gerada

`RetHoras(recurso)` roda a MESMA consulta do extrato (`u_TRI0052A`, perg `TRI052`) e
acumula por **`CC_PROJETO` + item contábil**, somando `AFU_HQUANT` (horas) e `AFU_XHRRV`
(horas RV). Depois `IncHoras()` grava na folha:

| verba (parâmetro) | default | quantidade | valor |
|---|---|---|---|
| `MV_XVBHRNO` | **222** | horas apontadas | `RetValHr(SRA)` |
| `MV_XVBHRTR` | **223** | horas RV (traslado) | `RetValTr(SRA)` |
| `MV_XVBAJUC` | 224 | 1 | `RA_X_AJCUS` |
| `MV_XVBPREM` | 228 | 1 | prêmio meta |
| `MV_XVBADIA` | 430 | 1 | `RA_SALARIO` |
| `MV_XVBFIXO` | 228 | 1 | `RA_SALARIO` |

**O valor da 222 vem de `RetValHr(SRA)` — o valor-hora do CADASTRO, não o `CUSTO_HORA`
do extrato.** Era por isso que comparar valor não fechava: são duas taxas diferentes para
a mesma hora. As verbas 224, 228 e 430 não nascem de apontamento — vêm do cadastro — e
por isso incluí-las estourava o lado da folha.

Os códigos são **parametrizados** (`MV_*`): não podem ser fixados no Planorc.

### Medido em horas, e fecha

Chave `(filial, matrícula, CC_PROJETO)`, só quem tem roteiro `AUT` na folha:

| | apontado | folha | conciliado | apont s/ folha | folha s/ apont | diferença |
|---|---|---|---|---|---|---|
| **222** horas normais | 20.866,0 h | 17.731,1 h | **157** | 53 | **2** | 19 · **−1,4 h** |
| **223** traslado | 555,4 h | 531,1 h | **222** | 5 | **0** | 2 · −9,9 h |

Dezenove chaves divergindo 1,4 hora no total é ruído de arredondamento. O modelo está
certo. Sobram **53 chaves · ~3.135 h apontadas que não viraram folha** — e *isso* é o
produto.

### Quatro regras do integrador que a tela tem de conhecer

1. **PJ é `RA_CATFUNC = 'A'`** (roteiro `AUT`), com `RA_XCOOPER` separando cooperado. Vem
   do cadastro da folha, não da conta contábil nem do `Cargo` do extrato.
2. **O recurso mora em `SRA.RA_X_RECUR`** — o de-para é do próprio Protheus.
3. **Quem já tem cálculo no período é PULADO** (`RegFunCal`/`TemSrcPd`), e o integrador
   lista esses no fim. Depois de descartar o intercâmbio por medição, esta é a hipótese
   principal para as **53 chaves / 3.322,5 h** que não viraram folha. Basta guardar o log
   de uma execução do `OEFOLM02` para cruzar.
4. **Projeto `9999999999` é intercâmbio**: `CalPrjIn()` busca o CC em `AF8_CC` de outra
   empresa (`AFU200/250/280/500/510`) e pode **espalhar as horas para outra empresa**.
   Uma hora apontada em intercâmbio não cai onde o extrato sugere.

O item contábil sai de `u_GetItemC(empresa, filial)` — o mesmo de-para que
`converter_folha_realizada.py` já usa, e ele vem da **filial do recurso**, enquanto o CC
vem do **projeto**. A chave `(filial da pessoa, matrícula, CC do projeto)` está correta.

### O CC do razão herda a proporção das horas (`OEFOLM03.PRW`)

O segundo fonte fecha o ciclo. `OEFOLM03` leva a folha calculada ao financeiro: emite o
pedido de compra do PJ pelo **líquido** (`MV_XVBLIQU`, default `A14`) — é por isso que a
NF não tem o valor do apontamento — e o **rateia entre centros de custo**.

O rateio, em `RetRateio()`, é o **percentual do valor das verbas 222/223 por CC**; só se
não houver nenhuma delas é que cai para o CC da própria `A14`.

Ou seja: **o CC que chega ao razão herda a proporção das horas apontadas.** O ciclo é

```
apontamento (horas por CC do projeto)
   → folha: verbas 222/223, quantidade = horas, por CC
      → NF: líquido A14, rateado pelo % dessas horas
         → razão: conta de terceiro, no CC resultante
```

Isso dá à nova aba um papel que as outras duas não têm: um CC errado no apontamento **se
propaga até a contabilidade**, proporcionalmente. A conciliação Contábil × Folha mostra o
efeito; só esta mostra a origem.

### O extrato por dentro (`TRI0052A.prw`)

O fonte que gera o extrato confirma a escolha por horas — e com um comentário do próprio
autor:

```
//ALEXEI - ALTERACAO FEITA PARA CALCULAR O VALOR HORA BASEADO NO CUSTO DO APONTAMENTO
//E NAO NO VALOR HORA DO RECURSO (AE8_VALOR) QUE PODE SER ALTERADO CONFORME EVOLUCAO
//DO CONSULTOR.
```

`CUSTO_HORA` = `AFU_CUSTO1 / AFU_HQUANT` — custo **do apontamento**, congelado. O
integrador usa `RetValHr(SRA)`, o valor-hora **do cadastro**, que muda quando o consultor
evolui. São duas taxas para a mesma hora, **de propósito**. Comparar valor nunca fecharia.

Outros pontos que a importação precisa respeitar:

- **`CC_PROJETO` = `AFU_CCPRJ`** — o CC gravado **no apontamento**, não o do cadastro do
  projeto (`AF8_CC`). É o que o líder digitou/herdou na hora de apontar.
- **Moeda**: se `AE8_MOEDA <> '1'`, o custo é convertido por `M2_MOEDA2`. Há recurso em
  moeda estrangeira, e o extrato já sai convertido conforme `MV_PAR24`.
- **Filtros fixos da consulta**: `AFU_CTRRVS = '1'` e `AF8_EMPRES = '2'`. Linha fora
  disso não existe no extrato, e portanto não existe na conciliação.
- **Intercâmbio é opcional no extrato**: `lSemInter := Len(aEmpFil) > 1` — rodando
  multi-empresa, o projeto `9999999999` é excluído para não duplicar. **Os dois arquivos
  que temos o incluem** (493 linhas em julho, 512 em junho). A importação tem de detectar
  isso, senão a mesma competência gera resultados diferentes conforme quem exportou.

Medido: **manter o intercâmbio concilia melhor** — 157 chaves contra 119 sem ele. O
`CalPrjIn()` na maioria das vezes devolve o mesmo CC que o extrato mostra, então excluir
as linhas só cria buraco dos dois lados.

### Consequência para o modelo

- A conciliação compara **horas**; valor entra como informação, não como critério.
- `fat_folha` precisa guardar **quantidade** — o `prgper02` traz `HORAS_DIAS` e o
  conversor não exporta. É pré-requisito da fase 3.
- O CLT também tem vínculo: a verba de prêmio é
  `max(horas × valor_hora − salário, 0) + traslado × valor_traslado`. Não é alocação pura
  como eu havia escrito — mas continua não sendo comparável em valor.

## Modelo

### `fat_apontamento`

Mesmo padrão de `fat_folha`. Uma linha por apontamento (grão do arquivo), não agregada:
agregar na importação impede conferir depois.

| campo | origem |
|---|---|
| `tenant_id`, `ano`, `mes` | competência **do apontamento** |
| `comp_folha_ano`, `comp_folha_mes` | competência da folha a que ele corresponde (ver regra) |
| `recurso_cod`, `nome` | `Recurso`, `Descricao` |
| `matricula`, `filial_id`, `posto_id` | resolvidos pelo de-para |
| `empresa_id`, `cc_projeto_id`, `cc_recurso_id` | `Empresa`+`Filial`, `CC_PROJETO`, `CC_RECURSO` |
| `projeto_cod`, `projeto_desc`, `os_num`, `tarefa` | contexto |
| `horas`, `custo_hora`, `valor` | `Qt. Horas`, `CUSTO_HORA`, `Custo` |
| `status_aprov` | `A`/`R` — o integrador só considera aprovado |
| `horas`, `horas_rv` | `Qt. Horas` e `Horas RV` — as duas grandezas que viram verba |
| `lote`, `origem`, `dims` | controle de carga |

`lote` desde o início: reapontamento e correção retroativa vão acontecer, e foi o que
salvou a folha confidencial.

### O de-para recurso → pessoa

O campo oficial é **`SRA.RA_X_RECUR`** (é o que o integrador usa), exportado como
`BK_RECURSO` no `Funcionarios.csv`, onde cobre **160 dos 172** recursos. Mas:

- `converter_funcionarios.py` **não o exporta** e `posto` **não tem campo para ele** —
  a informação existe no TOTVS e se perde no caminho;
- dos 12 que não casam, **9 são `TER***`** — justamente terceiros.

**Frente 1 — FEITA** (set/2026): o conversor extrai o código depois do último pipe
(`P |01|AE8200||001075` → `001075`, descartando o placeholder `01 - INDEFINIDO`),
`posto.recurso_cod` existe (v3_111) e o import grava. Medido: 315 de 558 linhas do
cadastro têm recurso, cobrindo **160 dos 172** do extrato de julho.

**Frente 2 — os 12 que sobram não são caso de de-para.** Verificado nome a nome contra
a folha de agosto e contra o cadastro de postos: **nenhum dos 12 está em nenhum dos
dois**.

```
001324 SINVAL GEDOLIN       TER348 CARLOS AUGUSTO BATIST   TER373 PEDRO RAFAEL ALCANTARA
TC0044 JORGE E. AREVALO     TER360 ANDREA GUNDIN           TER388 LUIZ R. SACRAMENTO
TER073 JOHNY W. P. FELIPE   TER362 ROMILDA SANTOS SILVA    TER393 OPC SERVICOS LTDA
TER341 TIAGO CASTILHO       TER367 WISLEY A. FERNANDES     TL9015 VITOR LOPES
```

São apontamentos de **empresas terceiras**, que não são colaboradores da TOTVS Oeste —
`TER393 OPC SERVICOS LTDA` é o caso explícito. Não há de-para a construir: essa gente não
passa pela folha porque não deveria mesmo passar.

São **130 linhas · R$ 75.785,36 · 3,5%** do valor apontado em julho.

**Consequência para a tela:** ficam **fora da conferência**, com estado próprio —
*"empresa terceira, não é colaborador"*. Mas o valor aparece num rodapé, como os
patrimoniais: o total apontado os inclui, então sem mostrá-los a **prova de soma não
fecha**, e o quadro passaria a afirmar uma completude que não tem. Jogá-los em "apontado
sem folha" seria pior ainda — poluiria justamente a lista que o líder precisa olhar.

O corte é pelo recurso não ter `posto` com `recurso_cod` correspondente: é o que os
identifica sem depender de convenção de código (`TER***` não é regra, `001324` e `TC0044`
seguem o padrão de quem está no cadastro).

### Recurso duplicado: a regra de desempate

Medido depois de importar: **12 recursos aparecem em mais de um posto** (315 postos com
recurso, 566 no total). Três padrões, e nenhum é erro de cadastro:

| padrão | casos | exemplo |
|---|---|---|
| A — mesma pessoa em duas filiais, **ambas ativas** | 3 | sócio com pró-labore em `2001` e `2101` |
| B — transferência: um demitido, outro ativo | 7 | `2006` (D) → `2801` (A) |
| C — os dois demitidos | 2 | duas matrículas na mesma filial |

Cruzando com o extrato de julho: **os 3 do padrão A não apontam nenhuma hora** (a
ambiguidade é teórica), os 7 do B apontam na filial **ativa**, e o C não aparece.

Mas dois do padrão B apontam **também numa filial onde não têm posto** — `001640` com
16 h em `2001` e `TC0052` com 2 h, tendo posto só em `2006` (D) e `2801` (A). Isso não é
erro: é trabalho feito em outra unidade. A folha paga na filial **da pessoa**.

**Regra de resolução, em ordem:**

1. posto com o mesmo `recurso_cod` **e** a mesma filial do apontamento;
2. senão, o **único posto ativo** com aquele recurso;
3. senão, ambíguo — a tela mostra e não escolhe.

Com os dados de julho a regra 2 resolve as horas órfãs e a 3 nunca dispara. E há uma
consequência para a chave da conciliação: o lado do apontamento tem de usar a filial do
**posto**, não a do apontamento, senão trabalho feito em outra unidade vira divergência
falsa.

### Regra de competência

| tipo | defasagem | exemplo |
|---|---|---|
| PJ | 1 mês | apontamento jul/2026 → folha ago/2026 |
| CLT | 2 meses | apontamento jun/2026 → folha ago/2026 |

A defasagem do PJ foi **testada**, comparando os dois extratos contra a mesma folha:

| apontamento × folha ago, verba 222 | conciliados | folha sem apontamento |
|---|---|---|
| **julho** | **146** | **2** |
| junho | 4 | 24 |
| jun + jul somados | 19 | — |

Sem ambiguidade. E é um teste que vale repetir a cada competência nova: se um mês parar
de casar, a regra mudou no ERP e a tela avisaria em vez de acusar divergência falsa.

A defasagem **depende do tipo de contrato**, que vem da folha. Consequência prática: uma
competência da folha compara contra **dois** arquivos de apontamento diferentes, e a
importação precisa gravar a competência-alvo por linha.

### O CLT é outra pergunta, não a mesma com outro recorte

Junho → agosto, só CLT: **702 linhas · R$ 250.804,40 · 62 chaves** `(filial, matrícula,
CC_PROJETO)`.

- **42 dessas 62 chaves — R$ 166.174,93 — estão num CC que a folha não pagou.** Dois
  terços do custo-hora apontado pelo CLT apontam para um centro de custo que a folha
  nunca tocou.
- `CC_PROJETO` = `CC_RECURSO` em apenas **21 de 62**.

Isso não é divergência a corrigir: é o desenho atual. A folha do CLT paga **salário no CC
do recurso**, e o apontamento diz **onde o tempo foi**. Comparar os dois valores seria
comparar coisas diferentes — um é folha, o outro é custo-hora.

Então o bloco de CLT **não concilia valor**: mostra **alocação**. Para cada pessoa, quanto
do custo-hora dela o apontamento colocou em cada projeto, e o fato de a folha ter
alocado tudo no CC dela. O número que interessa ao líder é *"R$ 166 mil de custo de hora
CLT pertencem a projetos de outros centros de custo"* — e hoje ninguém consegue dizer isso.

## A conciliação

Chave: **`filial + matrícula + centro de custo`**. Lado do apontamento: `CC_PROJETO`
(é dele que se pergunta). Lado da folha: verba `222` na conta de terceiro.

`FULL JOIN`, quatro estados:

| estado | leitura |
|---|---|
| conciliado | apontou e a folha pagou no mesmo CC |
| **apontado sem folha** | apontou no CC do projeto e a folha não pagou lá |
| **folha sem apontamento** | a folha pagou num CC que ninguém apontou |
| diferença de valor | mesmo CC, valor diferente |

Os dois do meio são o produto: juntos dizem **"o custo saiu do projeto P e foi parar no
CC X"**. Uma coluna extra com `CC_RECURSO` explica boa parte deles sem pesquisa.

**Prova de soma**, como nos outros quadros: apontado + folha − conciliado tem de fechar
com os totais de cada lado. Sem ela a tela vira opinião.

**CLT em rodapé "fora da conferência"**, com valor visível e a explicação de que a folha
dele ainda não é por projeto — o mesmo tratamento das contas patrimoniais. Esconder faria
o total parecer completo.

## Configuração

Dois eixos, e eles são diferentes:

- **`tenant.usa_apontamento`** (boolean) — *esta instalação tem esse mecanismo?* Sem ele
  a pill não é renderizada. Segue o precedente de `tenant.conciliacao_tolerancia`.
- **`CAPACIDADES`** com `conciliacao.apontamento` — *quem, dentro dela, pode ver?*
  Aparece sozinha em Configurações, sem migration.

Padrão **desligado** nos três papéis: tenant novo não vê nada e ninguém precisa lembrar
de esconder. É específico da TOTVS Oeste.

## Fases

1. `recurso_cod` no converter de funcionários e em `posto`; de-para para os `TER***`.
2. `fat_apontamento` + tela de importação (lote, substituir/adicionar, relatório do que
   não casou).
3. A aba com a conciliação PJ e a prova de soma.
4. Export XLSX, no padrão das outras duas.
5. CLT — depende de a folha passar a carregar projeto, ou de aceitar comparar contra
   `CC_RECURSO` e mostrar o deslocamento como informação.

## Em aberto

- **Os ~353 mil de apontado sem folha (PJ).** A defasagem já foi descartada como causa
  (o teste acima). Sobram: cooperado pago por outra verba, hora apontada e glosada, ou NF
  emitida com valor diferente do custo-hora. **Decidir isto antes da fase 3** — se a regra
  de verba estiver incompleta, a tela nasce acusando divergência onde não há.
- **Os 9 recursos `TER***` fora do cadastro** — existem com outro código, ou nunca
  entraram?
- **`Dt. Pgto Fol` vem vazia** nos dois extratos. Se o ERP puder preenchê-la, ela substitui
  a regra de defasagem por um vínculo explícito, que é muito melhor — e resolveria de uma
  vez a diferença de defasagem entre PJ e CLT.
