# Análises do dashboard de orçamento — desenho

> Status: **desenho**, 17/nov/2026. Nada implementado.
> Pedido do Ricardo: responder "quanto é o custo de pessoal do administrativo",
> "e das outras áreas", "qual o headcount de cada área" — e pesquisar boas
> práticas de análise orçamentária em empresas de serviços.

## O que o dado já responde

Medido na versão `Orçado2027`, origem POSTO para pessoal, com a receita vinda
dos formulários. **"Administrativo" = CSC = todo CC que começa com 1** — as
duas definições dão o mesmo conjunto, conferido nos dois sentidos.

| área | postos | **pessoas** | pessoal | % da área | % do pessoal | custo/pessoa | receita |
|---|---|---|---|---|---|---|---|
| Serviços | 175 | 173 | 32,19 mi | 82,0% | 59,2% | 186 mil | 70,20 mi |
| Comercial | 80 | 76 | 15,71 mi | 89,4% | 28,9% | 207 mil | 52,95 mi |
| **CSC (Adm)** | **44** | **40** | **4,85 mi** | **43,0%** | **8,9%** | **121 mil** | 1,11 mi |
| Marketing | 11 | 10 | 0,98 mi | 21,9% | 1,8% | 98 mil | — |
| Diretoria | 11 | **6** | 0,65 mi | 19,5% | 1,2% | 109 mil | 0,19 mi |
| **total** | **321** | **305** | **54,38 mi** | **71,6%** | | **178 mil** | **124,44 mi** |

⚠⚠ **POSTO NÃO É PESSOA, e a primeira versão desta tabela contou errado.** São
**321 postos para 305 pessoas**. A Diretoria é o caso extremo — **11 postos, 6
pessoas**: o pró-labore é pago por empresa, e a matrícula é por empresa, então
quem recebe em mais de uma do grupo ganha um posto em cada (o Marco Aurélio
aparece 4 vezes). Isto já está no CLAUDE.md, com este CC pelo nome, e existe
`lib/pessoaChave.ts` exatamente para resolver — eu contei `posto` e repeti o
erro que o projeto documenta.
**Todo gráfico de headcount tem de usar `pessoaChave()`**, e a tela deve mostrar
as duas colunas: postos é o que custa, pessoas é o quadro.

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

**2 · Headcount por área (barra horizontal)** — **pessoas**, não postos, com o
custo médio ao lado. ⚠ O número sozinho engana duas vezes: pela contagem (11
postos da Diretoria são 6 pessoas) e pela leitura (10 pessoas em Marketing
custam R$ 98 mil cada, 173 em Serviços custam R$ 186 mil). Sem o custo médio, a
barra diz que Marketing e Diretoria são do mesmo tamanho.

**3 · Pessoal × receita por área (dispersão ou barra pareada)** — é o que
transforma as duas anteriores em julgamento. Serviços gera R$ 401 mil por
cabeça, Comercial R$ 662 mil, e o CSC não gera receita por construção.

⚠ **Nos três, a pergunta é "em relação a quê"**, e tem de estar no rótulo. "43%"
sem dizer "da despesa da própria área" é o tipo de número que vira slide e
depois vira decisão errada.

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
