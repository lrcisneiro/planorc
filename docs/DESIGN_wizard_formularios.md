# DESIGN — Wizard de formulários

Out/2026. **Mecanismo implementado**, com o wizard de impostos como primeiro caso.

## O problema

O formulário de drivers é a memória de cálculo do orçado, mas hoje só nasce de
duas formas: alguém escreve um seed SQL com a estrutura, ou alguém digita tudo
na tela. E ele só se preenche de duas: digitando célula a célula, ou importando
um CSV de tabela larga.

Isso deixa de fora o caso mais comum em controladoria: **o driver já está no
sistema**. A receita orçada está no `fat_orcado`; a alíquota de imposto está no
cadastro da filial. Pedir que alguém redigite a receita por filial para
multiplicá-la por um número que o sistema já tem é trabalho e é risco.

## A ideia

Um **wizard** gera um formulário a partir de uma receita conhecida: cria a
estrutura, preenche os drivers lendo o que já existe, e entrega um formulário
normal — que se edita, se confere e se aplica como qualquer outro.

O primeiro é o de **impostos sobre faturamento**. Depois podem vir outros:
vendas por produto (produto × meta × ticket médio), aluguel por m², comissão
por canal. O valor do wizard não está no imposto — está em ser **genérico**.

## Anatomia

Um wizard é uma receita com três partes:

**1. Estrutura** — as linhas do formulário, como num seed: código, descrição,
tipo, formato, fórmula, conta de destino.

**2. Fontes** — como preencher cada driver. É o que distingue um wizard de um
seed, e vem de um catálogo pequeno:

| fonte | o que faz | parâmetros |
|---|---|---|
| `ORCADO` | soma o orçado da versão por escopo × mês | contas ou naturezas a incluir, contas a excluir |
| `CADASTRO` | lê um campo de cadastro e repete nos 12 meses | tabela (`filial`, `empresa`, `centro_custo`), campo |
| `REALIZADO` | soma o realizado de um ano por escopo × mês | contas, ano |
| `ENTRADA` | o wizard pergunta, numa grade do próprio wizard | colunas a pedir |
| `CONSTANTE` | um valor repetido | valor |

**3. Escopo de geração** — para quais empresa × filial × CC gerar. Normalmente
"todos os escopos que têm dado na fonte", que é o que evita gerar 500 células
vazias.

## O wizard de impostos

```
estrutura
  RECBASE   Receita faturada do mês (do orçado)      ANALITICA · MOEDA
  ALIQ      % de imposto sobre faturamento           ANALITICA · PERCENTUAL
  IMPOSTO   = -[RECBASE] * [ALIQ] / 100              FORMULA   · MOEDA  → 13001

fontes
  RECBASE ← ORCADO    { natureza: RECEITA, excluir_contas: [13001],
                        excluir_linhas: ['INADVL'] }
  ALIQ    ← CADASTRO  { tabela: filial, campo: imp_fat }

escopo
  todos os escopos com receita orçada na versão
```

O resultado é um formulário comum: você abre, vê a receita-base mês a mês, vê a
alíquota herdada do cadastro, vê o imposto calculado, **corrige a célula de uma
filial com regime especial** se precisar, e aplica.

### Duas decisões de base que não são do wizard

**Inadimplência não reduz a base.** Inadimplência é faturar e não receber — o
imposto é devido do mesmo jeito. Já a **postergação** fica dentro da base, e
corretamente: venda postergada não foi faturada.

**O imposto não tributa a si mesmo.** A conta de destino sai da base por
construção, e isso vira regra geral: *um wizard nunca lê o que ele escreve*.

## A regra que impede o tiro no pé

> **Um wizard nunca lê o que ele escreve.**

A fonte `ORCADO` tem de excluir automaticamente as contas de destino das linhas
do próprio formulário. Sem isso, o imposto entra na base na segunda rodada e o
número cresce a cada execução — um erro que aparece devagar e parece premissa.

## Envelhecimento

O dado copiado envelhece: muda a receita, o formulário fica velho. Três
anteparos, todos já existentes no produto:

1. **Re-gerar é um botão.** O wizard roda de novo sobre o mesmo formulário e
   substitui o que ele mesmo gerou.
2. **Célula editada à mão não é sobrescrita.** O wizard marca o que gerou; o
   que você corrigiu fica. (Precisa de uma marca em `formulario_valor` — a
   única mudança de schema que o wizard pede.)
3. **O aviso já existe.** `formulario_aplicacao` registra o último Aplicar, e o
   editor já mostra "⚠ alterações não aplicadas". O mesmo padrão diz "a receita
   mudou depois da última geração".

## Onde mora a definição

**No código**, em `lib/wizards.ts`, como o catálogo `CAPACIDADES`. A *receita* é
código — versionada, revisável, sem migration. O *resultado* é dado.

Pôr a definição no banco permitiria o usuário montar wizards, mas é outro
produto: exigiria editor de fórmulas, validação de fontes e versionamento. Não
agora.

## O que o wizard reaproveita

Tudo depois da geração: o editor de formulário, a herança do escopo 🌐 global,
o Aplicar por escopo e o "Aplicar em todos", o carimbo em `dims`, o aviso de
alterações não aplicadas. O wizard só preenche — quem calcula e grava é o que
já existe.

## Decidido na implementação

- **Marca de gerado:** coluna `formulario_valor.gerado` (v3_125), não chave em
  `dims` — é predicado de `DELETE` na re-geração, e coluna indexável vale mais
  que chave de jsonb nesse uso.
- **A versão é parâmetro do wizard**, perguntada na tela. Resolve o caso de
  cenários sem inventar regra: você escolhe de onde ler.
- **Re-gerar é a mesma rotina** com `formularioId` — apaga só `gerado = true` e
  reescreve. O botão "Atualizar a partir do orçado" é só interface; a função já
  aceita.
- **Navegação:** o botão *Novo formulário* virou cascata, com **Em branco** em
  primeiro e os wizards abaixo, sob o rótulo "A partir de dados que já existem".

## O que ficou de fora, de propósito

- **Wizard de vendas por produto** (produto × meta × ticket médio). Serviu de
  contexto para o mecanismo ser genérico; não foi construído. Quando vier, usa
  a fonte `ENTRADA`, que ainda não existe — é a única peça nova que ele pede.
- **Fontes `REALIZADO` e `CONSTANTE`**: desenhadas acima, não implementadas.
  Nenhum wizard precisa delas hoje, e fonte sem uso é fonte que se descobre
  errada no dia em que alguém usa.
- **Botão "Atualizar a partir do orçado"** no editor. A função já re-gera; falta
  só o botão. Vale esperar o primeiro uso real para saber onde ele incomoda
  menos.

## O que isto substitui

A `schema_v3_124_impostos_faturamento.sql` — RPC que calculava e gravava o
imposto direto no `fat_orcado`, sem formulário. Opaca (o cálculo vivia no
`dims`) e sem espaço para exceção por filial. A lógica de leitura dela
sobrevive: vira a fonte `ORCADO`.
