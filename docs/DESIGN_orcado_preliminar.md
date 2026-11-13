# Orçado **preliminar** — ver o impacto do cenário de postos antes de aprovar

> Escrito antes de codar. Problema trazido pelo Ricardo em 13/nov/2026: os
> cenários de posto estão **em atualização** e, para saber o efeito deles no
> orçamento, só havia o `Aplicar no orçado` — que exige o cenário aprovado.
> Roteiro desenhado com ele e confirmado abaixo contra o código.

## 1. O roteiro

1. Copiar o `Orçado2027` para uma versão **preliminar**.
2. Aplicar o cenário de postos **nessa versão**, como se tudo estivesse
   aprovado.
3. Ler o resultado nos relatórios e dashboards (EBITDA, margem), ou comparar
   as duas versões no comparativo que já existe.

## 2. O que já existe — medido, não suposto

| peça | estado |
|---|---|
| `copiar_versao(origem, codigo, descricao, semear)` | ✅ `v3_171`, só admin |
| Versão-cenário (`origem_versao_id`) | ✅ existe; **nenhuma criada até hoje** |
| DRE/dashboards por versão | ✅ já leem a versão |
| Comparativo entre versões | ✅ `view_config.cenarios` é **array** + função `COMPARATIVO` |
| `excluir_cenario` com guarda | ✅ `v3_176` |

**Três fatos do código que moldam o desenho:**

⚠ **`copiar_versao` copia `fat_orcado` INTEIRO, todas as origens** — inclusive
POSTO e FORMULARIO. Então o preliminar **já nasce** com a folha e os
formulários que estavam na baseline. É por isso que o roteiro funciona sem
reaplicar formulário nenhum: o passo 2 só troca a parte de POSTO.

⚠ **`copiar_versao` NÃO copia `posto_versao`.** As decisões continuam morando
na versão onde foram tomadas (`Orçado2027`). Logo o Aplicar precisa aprender
que *de onde vêm as decisões* e *onde o dinheiro pousa* são perguntas
diferentes — hoje são a mesma.

⚠ **A trava de aprovação é de TELA**, uma linha em `PostosGradePage`
(`!vSel?.aprovado_em`). Não há guarda no banco. Ao mexer nela, fechar no banco
junto — senão "exige aprovação" segue sendo teatro, que é a lição da `v3_174`.

## 3. O que precisa ser construído

**Só uma coisa: o Aplicar ganha DESTINO e um modo de resolução.**

```
decisões de:  Orçado2027           (não muda de lugar)
aplicar em:   Orçado2027_PRELIM    (cenário, semeado do Orçado2027)
resolver:     ( ) só o aprovado        ← hoje
              (•) como se tudo passasse ← preliminar
```

A trava se inverte, e fica mais honesta que a de hoje:

- destino **baseline** → exige carimbo **e** resolve só o aprovado;
- destino **cenário** → dispensa carimbo **e** permite "como se tudo passasse".

O resto do Aplicar não muda: continua apagando `origem = 'POSTO'` **da versão
de destino** e reinserindo. ⚠ É onde se erra: hoje o delete usa a versão
selecionada na tela, e com destino ele tem de usar o destino.

## 4. Armadilhas

⚠⚠ **"Como se tudo passasse" é o coração, e tem de aparecer NO NÚMERO.** Se
ficar implícito, alguém leva o EBITDA preliminar para uma reunião achando que é
consenso. A versão deve nascer com a descrição carimbada pela própria função
("preliminar · postos sem veredito tratados como aprovados · gerada em …"), e
a tela deve dizer isso onde o número aparece. A F7 já previa `papel`/`cor` em
`versao_orcamento` — **não existem**; se forem criados, é aqui que servem.

⚠ **O preliminar não contamina a baseline, e isso é de graça.** O merge da
`v3_173` grava **só origem `MANUAL`** — célula de POSTO não atravessa. Mesmo
que alguém libere o preliminar por engano, a folha não vai junto.

⚠ **`cenario_orcado_diff` soma TODAS as origens.** Abrir `/orcar-linha` no
preliminar marcaria toda linha de folha como alterada e pediria veredito nelas.
Não trava nada — preliminar não é para aprovar nem mesclar — mas polui.
**A saída NÃO é filtrar o diff por origem:** no cenário de orçamento de
verdade, POSTO também é semeado e o Δ precisa dele para significar alguma
coisa. A saída é não usar aquela tela no preliminar.

⚠⚠ **FALTA UM PASSO NO ROTEIRO: a DRE lê a versão da VISÃO**, não de um
seletor no cabeçalho (`view.cenarios`). Criar o preliminar não o faz aparecer
em lugar nenhum. O passo 3 real é:
**3a.** criar uma visão apontando para o preliminar — ou, melhor, uma visão
`COMPARATIVO` com `[Orçado2027, Orçado2027_PRELIM]`, que é literalmente o
"motor de comparação entre duas versões" e já existe;
**3b.** ler EBITDA e margem nela.
Vale a função que cria o preliminar **oferecer criar a visão de comparação**:
sem isso, o usuário faz os dois primeiros passos e não vê nada, sem erro.

⚠ **RLS por versão (`v3_137`) morde em silêncio.** Quem tem recorte de versão
cadastrado não enxerga o preliminar até que ele entre no cadastro de acesso — e
o sintoma é tela vazia, não mensagem. Se a simulação for para o gerente ver, o
acesso tem de ser dado junto.

⚠ **Permissões.** `copiar_versao` e `posto.aplicar` são **admin**. Se a ideia é
o gerente simular a própria área, abrir só para **destino cenário**; aplicar na
baseline continua sendo ato da controladoria.

⚠ **Preliminares acumulam** e o seletor de versão cresce — aqui não é "6 a 8
por ano", é um por rodada de simulação. `excluir_cenario` já resolve a
limpeza; o que falta é o hábito.

## 5. Fases

| | |
|---|---|
| **P1** | Aplicar com destino + modo "como se tudo passasse"; trava por tipo de versão, no banco também |
| **P2** | Botão "criar orçado preliminar": `copiar_versao` + descrição carimbada + visão comparativa |
| **P3** | Rótulo de preliminar onde o número aparece (DRE, dashboards, seletor de versão) |

## 6. Fora de escopo

- **Aprovação por CC** (`docs/DESIGN_aprovacao_por_cc.md`) é outro problema e
  continua parada. Mas repare: com o preliminar, a pressa de aprovar para
  "poder ver" desaparece — e essa pressa é metade do motivo de a A2 urgir.
- **Simulação sem gravar nada** (overlay no cliente) foi considerada e
  descartada: só funcionaria nas telas que implementassem o overlay, e o número
  não poderia ser comparado nem compartilhado. A versão é a unidade de
  vocabulário do produto inteiro.
