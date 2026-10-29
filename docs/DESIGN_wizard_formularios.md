# DESIGN — Wizard de formulários

Rascunho para discussão (out/2026). **Não implementado.**

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

## O que falta decidir

- Marca de "gerado pelo wizard" em `formulario_valor` — coluna própria ou uma
  chave em `dims`?
- O wizard cria um formulário novo a cada vez, ou atualiza um existente?
- A fonte `ORCADO` lê de qual versão: a mesma que o formulário vai aplicar, ou
  uma escolhida? (Cenários tornam isso uma pergunta real.)
- Onde fica na navegação: botão "Novo a partir de modelo" no hub de Formulários?

## O que isto substitui

A `schema_v3_124_impostos_faturamento.sql` — RPC que calculava e gravava o
imposto direto no `fat_orcado`, sem formulário. Opaca (o cálculo vivia no
`dims`) e sem espaço para exceção por filial. A lógica de leitura dela
sobrevive: vira a fonte `ORCADO`.
