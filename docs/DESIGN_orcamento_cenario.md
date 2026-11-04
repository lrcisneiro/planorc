# Cenário e aprovação do **orçamento** — desenho

> Irmão do fluxo de postos (v3_162…v3_170), que já está no ar. Aqui o objeto é
> `fat_orcado`, não `posto`. Escrito antes de codar, como o de postos.
> Decisões tomadas com o Ricardo em 04/nov/2026 estão marcadas **[decidido]**.

## 1. O problema

Hoje qualquer um com `orcar` e escopo grava direto na versão do orçamento. Não
há proposta, não há revisão, não há baseline protegida. O gerente de área muda
o orçamento da empresa e ninguém fica sabendo.

O que se quer: **a baseline fica com a controladoria; a área propõe num
cenário; a controladoria revisa linha a linha e libera.**

## 2. O modelo — o cenário É a versão **[decidido]**

`fat_orcado` já tem `versao_id`. Diferente dos postos — onde foi preciso
inventar `posto_versao`, porque o posto é único e atravessa versões — aqui a
separação já existe no fato. **Nenhuma tabela de sobreposição.**

```
Orçado2027                 baseline · controladoria
 ├─ 2027 · Comercial       cenário da área
 ├─ 2027 · Serviços
 └─ 2027 · Adm/Financeiro
```

**Um cenário por área [decidido].** Resolve de graça o escopo da aprovação que
ficou em aberto nos postos: a versão já é da área, então não há decisão de uma
área misturada com a de outra. "Liberar o quadro para a área" passa a ser,
literalmente, **criar a versão dela**.

⚠ O custo é o seletor de versão mais cheio — 6 a 8 por ano. Aceito.

### O controle de acesso já existe

O RLS de `fat_orcado` recorta por **versão**, na leitura e na escrita (v3_137).
Então:

| quem | o quê |
|---|---|
| gerente da área | `ORCAR` na versão do cenário dela · `VER` na baseline |
| controladoria | `ORCAR` em tudo |

É cadastro em Configurações → acesso. **Zero código**, e vale no banco, não na
tela.

## 3. Schema

```sql
versao_orcamento
  + origem_versao_id uuid   -- de qual baseline este cenário foi semeado

orcado_veredito               -- o veredito é por LINHA [decidido]
  versao_id   uuid
  linha_id    uuid           -- conta_orcamentaria (MASTER), não relatorio_linha
  aprovado    boolean        -- null = pendente
  nota        text
  aprov_em    timestamptz
  aprov_por   uuid
  UNIQUE (versao_id, linha_id)
```

O **carimbo do cenário** reusa o que a v3_165 criou em `versao_orcamento`
(`aprovado_em`, `aprovado_por`, `aprovacao_nota`) — já é genérico, não é de
postos. ⚠ `aprovar_cenario` hoje só conta pendências em `posto_versao`;
passa a contar as duas.

## 4. Semear

`copiar_versao` **não existia** (o doc da F7 supunha que sim). Escrita na
`v3_171`: cria a versão, copia `fat_orcado` da baseline e grava
`origem_versao_id`. Versão sem origem é baseline; com origem, é proposta — não
precisou de coluna "é cenário".

**Só admin semeia [decidido].** "Liberar o orçamento para a área" é ato da
controladoria. A função é `SECURITY DEFINER` e copia a baseline inteira sem
olhar escopo; se o gerente pudesse chamá-la, seria o caminho para materializar
numa versão sua o orçado de áreas que ele não vê. Quem **orça** no cenário
segue sendo cadastro, e vale no RLS por versão (v3_137).

**Semeia todas as origens, merge só `MANUAL`.** Não é incoerência: sem POSTO e
FORMULARIO o cenário mostraria a área sem 70% do próprio custo e o Δ não
significaria nada. Copiar é para enxergar.

⚠ **Cenário de cenário não.** O seletor só oferece baseline como origem:
empilhar Δ sobre Δ deixaria o comparativo sem referência.

### O grão misto não bloqueia — medido em 04/nov

Eu havia posto a limpeza antes da B1. **Errado:** os 122 grupos mistos estão
todos em **2026** (`Orçado2026` · 50 · conta 20601 *Feiras e eventos*, filial
2001; `OrçadoPosto` · 72 · contas de folha). A baseline `Orçado2027`, com
24.454 células, tem **zero** células de `cc_id` nulo. Semear 2027 não copia
problema nenhum.

E os 72 do lado POSTO **não são dupla contagem**: vêm de **19 dos 25 destinos
de rateio** (RATEMP01/02/03, RATEMPPY) que distribuem **por empresa, sem CC** —
`fat_orcado` guarda o destino, o destino não tem CC, a célula fica consolidada.
Cadastro deliberado, não dado sujo; os dois lados somam em vez de se sobrepor,
que é por isso que nenhum grupo tem os lados iguais.

Sobra a limpeza real: **uma conta, uma filial, na versão de 2026** — digitação
em "— consolidado —" na grade. Fica como pendência de higiene, fora do caminho
crítico.

## 5. Revisar

A tela é a **Orçar por linha** com modo comparativo: duas colunas de valor
(baseline × cenário), Δ, e o veredito por linha.

**Por que por linha:** são 82 linhas com orçado; por célula seriam 89 mil. E a
conversa real é "esse aumento de viagens não passa", não "a célula de março da
filial 2002 não passa".

Mesma mecânica dos postos, que já se provou:
- ✓/✗ por linha, recusa **exige motivo**, motivo aparece na linha;
- quem propôs **responde e reenvia** (volta a pendente) ou **abandona**;
- **recusada não trava** o fechamento — ela simplesmente não é liberada;
- **pendente trava**: significa "ninguém olhou";
- qualquer alteração na proposta **derruba o carimbo**, por gatilho.

## 6. Liberar (o merge) — a parte perigosa

**Só o alterado [decidido].** Escreve na baseline apenas as células que diferem
dela, comparadas **no momento do merge**.

> Baseline: *Viagens*, jan 10 mil. O cenário é semeado igual. O gerente muda
> **janeiro** para 12 mil; a controladoria, por outro motivo, ajusta **março**
> da baseline para 15 mil.
> **"Tudo"** devolveria março para 10 mil — o ajuste da controladoria sumiria
> sem aviso. **"Só o alterado"** grava só janeiro.

### Só origem `MANUAL`

No orçado de 2027: **`POSTO` 13.140 · `FORMULARIO` 5.680 · `MANUAL` 5.634**.
Setenta por cento é **gerado**, não digitado — e gerado é regerado: o *Aplicar
no orçado* dos postos substitui tudo que é `POSTO` da versão, e a aplicação do
formulário faz o equivalente.

**Mergear valor gerado criaria um número que a próxima aplicação apaga** — o
pior resultado, porque ele passa pela aprovação e some depois, calado.

⚠ **Aresta conhecida:** o drill de `/orcar-linha` transforma em `MANUAL` a
célula de origem gerada que for editada. Então é possível, por esse caminho,
propor por cima de um valor de posto. O merge deve **avisar** nesses casos — a
liberação acontece, mas com o aviso de que a próxima aplicação daquela origem
vai sobrescrever.

### Zerar também é alteração

Célula que existe na baseline e **não existe** no cenário é uma proposta de
**apagar**. Tratar só as que existem no cenário perderia isso em silêncio.

### Se a baseline andou

O aprovador carimbou um Δ calculado contra a baseline de ontem. Se ela mudou
desde então, o merge grava **o valor aprovado** (foi o que se aprovou) e
**reporta as células onde a baseline havia mudado**, para a controladoria ver o
que está sobrescrevendo. Recusar silenciosamente seria pior; sobrescrever sem
dizer, também.

### Guardas

- a baseline **não pode estar `bloqueada`**;
- o cenário tem de estar **carimbado**;
- função no banco, **atômica** — merge pela metade é pior que merge nenhum;
- ⚠ o upsert tem de casar o unique inteiro de `fat_orcado`, que inclui
  `dims::text` e as sentinelas `COALESCE` de filial/cc.

## 7. Fases

| | |
|---|---|
| **B1** | ✅ `origem_versao_id` + `copiar_versao` + criar cenário pela tela (`v3_171`) |
| **B2** | modo comparativo em `/orcar-linha` + `orcado_veredito` + vereditos |
| **B3** | o merge, com relatório do que foi escrito e do que ficou de fora |
| **B4** | ~~limpeza do grão misto~~ — não bloqueia (ver § 4); virou higiene de 2026 |

## 8. Fora de escopo, de propósito

- **Escopo `APROVAR`** — some com cenário-por-área: a versão já é da área.
  Volta a fazer falta se um dia houver cenário compartilhado.
- **Alçada por valor** ("acima de X aprova o diretor") — pedido futuro.
- **Dimensões configuráveis** (`dims jsonb`) no diff: o comparativo soma por
  linha, então `dims` entra no total sem aparecer. Suficiente por ora.
