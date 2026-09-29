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
| `status_aprov` | `A`/`R` — os 4 rejeitados não entram na conciliação |
| `lote`, `origem`, `dims` | controle de carga |

`lote` desde o início: reapontamento e correção retroativa vão acontecer, e foi o que
salvou a folha confidencial.

### O de-para recurso → pessoa

`BK_RECURSO` existe no `Funcionarios.csv` e cobre **160 dos 172** recursos. Mas:

- `converter_funcionarios.py` **não o exporta** e `posto` **não tem campo para ele** —
  a informação existe no TOTVS e se perde no caminho;
- dos 12 que não casam, **9 são `TER***`** — justamente terceiros.

Duas frentes, e a segunda não é opcional:

1. acrescentar `recurso_cod` ao converter de funcionários e a `posto` (pequeno);
2. um de-para próprio para quem não está no cadastro, na linha do `posto_fornecedor`
   que já resolve o PJ na conciliação contábil.

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
