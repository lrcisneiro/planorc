# Análises do dashboard de orçamento — desenho

> Status: **desenho**, 17/nov/2026. Nada implementado.
> Pedido do Ricardo: responder "quanto é o custo de pessoal do administrativo",
> "e das outras áreas", "qual o headcount de cada área" — e pesquisar boas
> práticas de análise orçamentária em empresas de serviços.

## O que o dado já responde

Medido na versão `Orçado2027`, origem POSTO para pessoal, com a receita vinda
dos formulários. **"Administrativo" = CSC = todo CC que começa com 1** — as
duas definições dão o mesmo conjunto, conferido nos dois sentidos.

| área | pessoas | pessoal | % da área | % do pessoal | **% da despesa** | custo/pessoa | receita |
|---|---|---|---|---|---|---|---|
| Serviços | 173 | 32,19 mi | 82,0% | 59,2% | **43,0%** | 186 mil | 70,20 mi |
| Comercial | 76 | 15,71 mi | 89,4% | 28,9% | **21,0%** | 207 mil | 52,95 mi |
| **CSC (Adm)** | **40** | **4,85 mi** | **43,0%** | **8,9%** | **6,5%** | **121 mil** | 1,11 mi |
| Marketing | 10 | 0,98 mi | 21,9% | 1,8% | **1,3%** | 98 mil | — |
| Diretoria | **6** | 0,65 mi | 19,5% | 1,2% | **0,9%** | 109 mil | 0,19 mi |
| **total** | **305** | **54,38 mi** | | | **72,6%** | **178 mil** | **124,44 mi** |

**DESPESA = SÓ A OPERACIONAL** (bloco `2` do plano, R$ 74.899.050) — decisão do
Ricardo, 17/nov. ⚠ Ficam **de fora** três coisas que pareciam candidatas:
· o **resultado financeiro** (bloco `3`: juros, IOF, tarifas — R$ 998 mil), que
  não é operacional;
· os **impostos sobre faturamento** (`13001`, R$ 7,14 mi), que moram no bloco da
  receita porque são **dedução da receita bruta**, não despesa;
· a **receita** inteira, claro.
Com o denominador errado a conta dá 71,6% ou 65,5% em vez de 72,6% — diferença
pequena no total e suficiente para ninguém conseguir reproduzir o número depois.

**72,6% da despesa operacional é gente.** É o número que dimensiona todo o
resto: a telefonia do CC 141 que a homologação levantou (R$ 156 mil/ano) é 0,2%.

⚠⚠ **AS TRÊS PORCENTAGENS SOMAM COISAS DIFERENTES, e isso é armadilha de
gráfico:** "% da área" não soma nada (cada uma tem seu denominador), "% do
pessoal" soma 100% e "% da despesa" soma 72,6%. Juntas e sem rótulo, alguém
soma a coluna errada. **Mostrar no máximo duas por vez**, sempre com o
denominador escrito.

⚠⚠ **A UNIDADE DESTA TELA É A PESSOA. "Posto" não aparece em gráfico nenhum**
(decisão do Ricardo, 17/nov) — porque posto duplica: o pró-labore é pago **por
empresa** do grupo, e a matrícula é por empresa, então quem recebe em mais de
uma ganha um posto em cada. A Diretoria tem **11 postos e 6 pessoas** (o Marco
Aurélio aparece 4 vezes). A primeira versão desta tabela contou posto e errou —
e `lib/pessoaChave.ts` existe desde sempre justamente para isso.
✅ **Conferido que a soma fecha:** nenhuma pessoa tem custo em mais de uma área,
então `Σ pessoas por área = 305` sem dupla contagem. O custo continua somando
todos os postos da pessoa, que é o certo — ela custa em cada empresa.

**A resposta direta das perguntas 1 e 2:** o pessoal do Administrativo é **43,0%
da despesa da própria área** e **8,9% do custo de pessoal da empresa** (ou 6,4%
da despesa total). É a área com a MENOR participação de pessoal na própria
despesa entre as que têm equipe grande — ou seja, o CSC gasta mais com coisa que
não é gente do que qualquer outra área operacional.

⚠ **E isso é o achado, não a resposta.** Serviços e Comercial são 82% e 89%
pessoal — são áreas que **são** gente. O CSC é 43%: os outros R$ 6,4 milhões são
aluguel, software, contabilidade, energia, seguros. Comparar "% de pessoal" entre
elas mede naturezas diferentes, não eficiências diferentes.

## Os três gráficos pedidos

**1 · Composição da despesa por área (barra empilhada 100%)** — pessoal × resto,
uma barra por área. Responde as perguntas 1 e 2 juntas e torna visível que as
áreas não são comparáveis pelo mesmo número.

**2 · Headcount por área (barra horizontal)** — pessoas, com o custo médio ao
lado. ⚠ O número sozinho engana: 10 pessoas em Marketing custam R$ 98 mil cada
e 173 em Serviços custam R$ 186 mil. Sem o custo médio, a barra diz que
Marketing e Diretoria são do mesmo tamanho.

**3 · Pessoal × receita por área (dispersão ou barra pareada)** — é o que
transforma as duas anteriores em julgamento. Serviços gera R$ 401 mil por
cabeça, Comercial R$ 662 mil, e o CSC não gera receita por construção.

⚠ **Nos três, a pergunta é "em relação a quê"**, e tem de estar no rótulo. "43%"
sem dizer "da despesa da própria área" é o tipo de número que vira slide e
depois vira decisão errada.

## 4 · Headcount e custo por REGIME

Pedido à parte, sem separar o resto da análise.

| regime | pessoas | custo 2027 | % | por pessoa |
|---|---|---|---|---|
| BR-PRESTADOR | 202 | 42,62 mi | **78,4%** | 210.980 |
| BR-CLT | 93 | 11,09 mi | 20,4% | 119.221 |
| BR-PROLABORE | **7** | 0,60 mi | 1,1% | 86.281 |
| BR-ESTAGIO | 3 | 0,07 mi | 0,1% | 22.429 |

**O número que salta: 78,4% do custo de pessoal é prestador.** Não é uma
empresa de CLT com alguns terceiros — é o contrário.

⚠ **E a coluna "por pessoa" levanta uma pergunta, não a responde.** Prestador
custa R$ 211 mil e CLT custa R$ 119 mil **já com encargos** — 1,77×. Isso pode
ser preço de regime ou pode ser **mistura de senioridade** (consultor sênior PJ
contra auxiliar administrativo CLT). O gráfico deve mostrar a diferença e
**não sugerir a causa**; quem responde é a pirâmide de senioridade.

⚠ O pró-labore é onde posto e pessoa mais divergem (16 postos, 7 pessoas), e é
a razão de a tela falar só de pessoas: a média por pessoa ali **só faz sentido
somando as empresas em que ela recebe**.

## O que a pesquisa diz, e o que daqui se aplica

Boas práticas de empresas de serviços profissionais convergem em cinco
indicadores. Três são calculáveis hoje; dois exigem dado que falta.

### Calculáveis com o que existe

**Overhead ratio — apoio ÷ receita.** É o indicador mais citado do setor: quanto
da receita sustenta quem não entrega. Aqui: **15,3%** (CSC + Marketing +
Diretoria sobre R$ 124,4 mi).

**Razão direto : apoio.** Hoje **3,9 : 1** em headcount (255 contra 66). É a
métrica que diz se a estrutura cresce junto com a entrega ou na frente dela — e
é a mais fácil de acompanhar mês a mês.

**Receita por cabeça.** R$ 388 mil no total. ⚠ Os benchmarks publicados são em
dólar e de mercados diferentes (US$ 175 mil+ para firmas pequenas); **comparar
direto seria desonesto**. O valor desta métrica aqui é a **série**, não o
patamar: subir significa preço melhor, utilização melhor ou estrutura menor.

**Custo de pessoal ÷ receita.** **43,7%**, e a despesa total é 61,0% da receita
— margem orçada de 39,0%. Acompanhar por área separa quem carrega a margem.

### Exigem dado que ainda não existe

**Utilização (horas faturáveis ÷ horas disponíveis).** É *o* indicador do setor,
com faixa saudável de 65–75% (75–85% para consultor técnico). ⚠ O Planorc tem
`fat_apontamento`, mas com **3 competências carregadas** (jun–ago/2026) e as
horas disponíveis não estão em lugar nenhum. Sem as duas pontas, não se calcula.
**É a maior lacuna analítica do produto**, e a mais valiosa de fechar.

**Realização (faturado ÷ valor-padrão das horas).** Depende do valor-hora de
tabela por cargo, que não existe no cadastro. `cargo` tem `nivel`, não preço.

## Três análises que a pesquisa sugere e que o dado aguenta

**Pirâmide de senioridade por área.** `cargo_step` e `cargo.nivel` existem desde
a v3_158/161. Mostra se a entrega está sendo feita por gente cara demais — em
serviços, a margem mora na mistura, não no preço.

**Custo de pessoal por linha de receita.** As receitas já são separadas por
formulário (MRR, não recorrente, serviços). Cruzar com o CC de quem entrega
mostra qual linha paga a própria estrutura.

**Variação de headcount × variação de receita.** Duas séries no mesmo eixo, por
área. Quadro crescendo mais rápido que receita é o sintoma que antecede a queda
de margem, e aparece meses antes no orçamento.

## A fonte: foto, não cadastro

⚠⚠ **A pergunta mais importante do desenho, levantada pelo Ricardo:** os
gráficos leem do cadastro, que é uma foto de HOJE. Mês a mês a importação
atualiza o quadro, e os gráficos mudariam — **deixando de representar o
planejamento que se aprovou**.

**A inconsistência estava na minha primeira proposta:** o custo vinha do
`fat_orcado` (congelado pelo Aplicar) e o headcount eu tirei de `posto` (vivo).

**A regra:** custo **e** headcount saem da **mesma foto** — `fat_orcado`, cujo
`dims` carrega `posto`, `nome` e `matricula` de quem gerou cada linha. Medido
hoje, um dia após o Aplicar:

```
             foto     cadastro
  TOTAL   301 pessoas  305
```

⚠ A diferença de hoje **não é deriva ainda**: são 7 postos com salário zero e
nenhuma verba. Custam nada, o Aplicar não escreve linha e a foto não os vê.
Muda o rótulo do gráfico: a foto conta **quem custa**, não **quem existe**.

⚠ **E congelar o gráfico não congelava o orçamento** — reaplicar na mesma versão
substituía tudo sem registro. Resolvido na `v3_190`: fechar a versão trava o
Aplicar **no banco**, e simulação vai noutra versão. A partir daí o gráfico mede
um alvo fixo, que é a condição para "acompanhar o realizado contra a meta"
significar alguma coisa.

## Decisões que o desenho ainda precisa

✅ **"Área" NESTA TELA é o centro de custo** (`centro_custo.area_nome`, 5
valores) — decisão do Ricardo, 17/nov. ⚠ **Não confundir com `area_funcional`**,
os 37 nós do organograma: aquilo é *onde a pessoa trabalha*, isto é *onde o
dinheiro cai*. São as "três estruturas, três perguntas" do CLAUDE.md, e misturar
as duas numa tela é o jeito de ninguém confiar em nenhuma. A área funcional fica
no Organograma, que já a usa.

⚠ **O custo por área funcional é calculável**, mas por caminho diferente:
`fat_orcado.dims->>'posto'` → `posto.area_func_id`. Funciona (testado), e não
serve para despesa que não é de posto — aluguel não tem área funcional.

⚠ **Marketing e Diretoria não têm receita**, então toda razão que divide por
receita fica indefinida nelas. Mostrar "—" e não zero: zero afirma que a área
não gerou nada, e o certo é que a pergunta não se aplica.
