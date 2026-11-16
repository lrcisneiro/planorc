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
| **P1** | ✅ 13/nov/2026 — Aplicar com destino + modo "como se tudo passasse". A trava ficou **de tela**: a `v3_185` tentou levá-la ao banco e a `v3_186` a desfez (ver 5.1) |
| **P2** | ❌ **DESCARTADA** (13/nov/2026) — botão único que criaria versão + visão |
| **P3** | ❌ **DESCARTADA** (13/nov/2026) — rótulo de preliminar nas telas |

### Por que P2 e P3 saíram

Decisão do Ricardo depois de rodar o ciclo inteiro à mão: a P1 já entrega o
que faltava, e os passos restantes são de **cadastro**, não de produto. Criar a
versão em *Novo cenário* e apontar uma visão para ela é trabalho de uma vez por
rodada, feito por quem conhece o orçamento — automatizar isso economizaria
cliques e criaria uma segunda forma de criar versão, divergente da primeira.

⚠ **O que se aceita junto:** sem a P3, **nada na tela diz que o número é
preliminar**. Quem abrir a DRE na versão preliminar lê o EBITDA como qualquer
outro. A mitigação é o nome da versão (`ORC2027_PRELIM`) e a descrição — que
passam a ser a única proteção, e por isso devem ser escritos para serem lidos
por quem não participou da simulação.

⚠ Se um dia isto voltar à mesa, o que muda a conta é **alguém de fora da
controladoria abrir o preliminar sem saber o que é** — aí o rótulo deixa de ser
conveniência. A coluna `papel` da F7 continua sendo o lugar certo.

## 5.1 A trava ficou de TELA — e por quê (v3_185 → v3_186)

A P1 tentou mover para o banco a regra "cenário de posto só vira dinheiro
depois de aprovado", citando a `v3_174` (autoridade que existe na função e
falta na tabela). **Durou três dias.**

⚠⚠ **O Aplicar tem dois modos que gravam exatamente as mesmas colunas:**

| modo | o que grava | precisa de carimbo? |
|---|---|---|
| CADASTRO | o quadro mestre — nenhuma decisão dentro | não |
| CENÁRIO | as decisões da versão | **sim** |

Da tabela `fat_orcado` os dois são **indistinguíveis**: mesma `origem = 'POSTO'`,
mesmas colunas, mesmo formato. O gatilho usou o único sinal que alcançava — *"a
versão de destino TEM decisões"* — e isso é outra pergunta. Passou a recusar o
Aplicar do CADASTRO na baseline só porque existia um cenário em negociação
noutro canto. Apareceu em 16/nov, ao reaplicar o quadro depois de um ajuste de
RATEIO: nada de cenário envolvido, e o Aplicar recusado.

**Não dá para melhorar o predicado.** O que distingue os modos é a INTENÇÃO de
quem chamou, e intenção não está na linha gravada. Ela só chegaria ao banco se
o Aplicar inteiro virasse uma RPC que recebesse o modo — e aí a trava é da
função, não da tabela. É o caminho se um dia isso voltar à mesa.

**A lição não é "não leve regra para o banco".** É: *a tabela só pode fazer
valer o que está escrito na linha.* Quando a regra depende de quem chamou e
por quê, a guarda tem de estar onde essa informação existe — e dizer, sem
rodeio, que é de tela. Uma guarda que recusa a operação errada é pior que
nenhuma: ela ensina a desconfiar do sistema.

## 6. Fora de escopo

- **Aprovação por CC** (`docs/DESIGN_aprovacao_por_cc.md`) é outro problema e
  continua parada. Mas repare: com o preliminar, a pressa de aprovar para
  "poder ver" desaparece — e essa pressa é metade do motivo de a A2 urgir.
- **Simulação sem gravar nada** (overlay no cliente) foi considerada e
  descartada: só funcionaria nas telas que implementassem o overlay, e o número
  não poderia ser comparado nem compartilhado. A versão é a unidade de
  vocabulário do produto inteiro.
