# Resposta à validação funcional do PlanOrc — TI / CC 141

_Referente ao documento de 10/11/2026. Posição em 16/11/2026._

Obrigado pelo relatório. Ele encontrou coisas que não estavam no nosso radar, e
duas delas eram sérias. Abaixo está o que foi corrigido, o que você pode
conferir agora, o que depende do próximo deploy e o que continua com você.

Resumo: **dos seis itens de prioridade alta, cinco estão resolvidos.** O sexto
(A-18) não é defeito de sistema e depende de informação da TI.

---

## 1. Quatro dos seus itens eram o mesmo defeito

**A-02, A-17, A-20 e C-09** tinham uma causa única, que seu relatório ajudou a
localizar: uma importação de cadastro de postos rodada em 05/11 no modo
"Substituir escopo" apagou e recriou os postos com identificadores novos. Como
a folha e o apontamento guardam uma referência ao posto, **59 mil linhas
perderam o vínculo** — sem apagar um único valor e sem erro em lugar nenhum.

É por isso que as telas por competência continuavam certas e só as perguntas
"deste posto" falhavam. Medição no momento do conserto:

| tabela | linhas sem vínculo |
|---|---|
| folha realizada | 45.024 |
| apontamento | 14.309 (100% da tabela) |

**Corrigido** pela migration `v3_188`, religando por (filial, matrícula) — que
é chave única no cadastro de postos. Zero linhas ficaram ambíguas.

### Como validar — já está no ar

| item | onde | o que deve aparecer agora |
|---|---|---|
| **A-17 / C-09** | Posto de trabalho > 4 · Folha realizada > Out/2026 > buscar `000078` | O posto `2101-000078` com **57 verbas, R$ 7.488,22**, sendo **R$ 6.435,40** nas oito verbas do ERP. O salário sempre esteve na base — o que faltava era o vínculo. |
| **A-02** | Posto de trabalho > 6 · Conciliação > Orçado × Folha | Nenhuma matrícula "sem posto relacionado". A competência Jan/2027 foi removida (ver item 4). |
| **A-20 / C-11** | Posto de trabalho > 6 · Conciliação > Apontamento × Folha, Jun a Ago/2026 | Horas apontadas deixam de ser 0,0. Jun **27.124,1 h** · Jul **28.112,5 h** · Ago **25.338,7 h** no total da empresa. |

**O que não religou, e por quê:** 401 linhas de apontamento de terceiros
(`TER###`, `TC####`, função TERCEIRO / FÁBRICA DE SOFTWARE). Não têm posto no
quadro e não devem ter — ali a ausência de vínculo é o valor correto, não uma
lacuna. Isso responde também sua observação de que analistas da planilha não
aparecem na Conciliação: ela lista quem tem posto e verba de folha.

> **Sobre sua hipótese no A-20** — você levantou que a carga do Extrato de Horas
> poderia estar filtrando por função, CC ou status. Não é isso, e vale dizer
> para ninguém mexer no filtro à toa. **Mas a outra metade do seu achado está
> de pé:** o PlanOrc tem apenas Jun, Jul e Ago/2026 de apontamento, e os totais
> desses três meses não batem com sua planilha. Isso é carga faltando, e
> continua em aberto.

---

## 2. A-04 — linha ignorando o filtro de centro de custo

**Confirmado, e era defeito de verdade.** Você filtrou o CC 14 (sem movimento),
a DRE inteira zerou e a linha "Folha apoio" continuou exibindo o consolidado da
empresa, com "% Estrutura" 100%.

Causa: linhas de indicador podem ter um recorte próprio de centro de custo
("esta linha é só das áreas CSC e Diretoria"). Esse recorte estava
**substituindo** o filtro da tela em vez de se somar a ele. Passou a somar: o
recorte da linha agora **estreita** o que a tela mostra, nunca alarga.

O caso que parecia justificar o comportamento antigo na verdade o desmente: num
indicador como *margem ÷ folha direta*, substituindo o filtro o numerador vem
filtrado e o denominador não, e a razão deixa de significar qualquer coisa.

Duas linhas da DRE Gerencial eram afetadas: **Folha direta** e **Folha apoio**.

> **Correção de uma coisa que escrevi antes:** empresa e filial **nunca** foram
> ignoradas — era só o centro de custo. Sua contraprova já mostrava isso
> (Empresa 01 + CC 141 deu 9.477, coerente com Bauru).

### Como validar — **depende do próximo deploy**

Relatório > DRE Gerencial > Filtros > Centro de custo > somente "14 · TI".
Tudo deve zerar, **Folha apoio inclusive**, e o "% Estrutura" deve parar de
mostrar 100%.

---

## 3. A-01 — DRE × Posto divergindo em R$ 128.413,01

**Resolvido.** O posto `2101-000079` saiu do orçado de 2027 — a vigência dele
terminou em 11/2026, e um novo processamento do orçado de pessoal o excluiu.
As duas telas passam a fechar o mesmo total.

> **A causa estrutural merece sua atenção, porque vai se repetir:** a DRE mostra
> o resultado do **último processamento** do orçado de pessoal, enquanto a tela
> Posto calcula ao vivo. As duas discordam sempre que o cadastro muda depois do
> processamento. Não é defeito, é a natureza do dado — mas falta a tela dizer
> de quando é o retrato, e isso está na nossa lista.

Sobre o **C-05** (a vigência do posto): a resposta do RH é que ele saiu, e o
cadastro já reflete isso.

---

## 4. C-07 — a folha de Jan/2027

**Você perguntou se era simulação. Não era: era a folha de maio de 2026
gravada na competência errada**, e a prova é comparação par a par:

- 1.461 pares (matrícula, verba) em 2027-01
- **1.460 idênticos** ao valor de 2026-05
- 1 diferente: matrícula 900004, verba 231 → R$ 31.468,71 contra R$ 1.468,71
  (um "3" digitado na frente)
- **zero** pares existindo só em 2027-01

Importada em 28/07/2026 — três dias depois da carga de maio — e era a única
competência de folha sem identificação de lote. É o rastro de um teste de
importador.

**Removida** (migration `v3_189`), com maio/2026 intacto: 6.591 linhas,
R$ 4.747.107,19. As competências de folha que restam são **2026-05, 2026-08,
2026-09 e 2026-10**.

Isso também responde seu **A-16**: o filtro de competência está honesto — ele
lista o que existe. O que falta são as cargas de folha dos meses ausentes, e
isso é operação, não sistema. (A ordem que lhe pareceu errada é decrescente:
a competência mais recente primeiro.)

> Vale registrar: **um defeito escondia o outro.** A folha de Jan/2027 ficou
> meses invisível porque as linhas estavam sem vínculo de posto — a tela as
> mostrava como "sem posto", não como "maio". Só depois de religar os ponteiros
> ela ficou legível.

---

## 5. A-09 — grafia dos cadastros

**Corrigidas 26 descrições** em conta orçamentária, linha de relatório e centro
de custo. Entre elas todas as que você listou:

```
Impostors s/ Faturamento        →  Impostos s/ Faturamento
Pagamento Roaylties             →  Pagamento Royalties
Repasse ... entre unidadees     →  ... entre unidades
Adminstrativo  Geral            →  Administrativo Geral   (e o espaço dobrado)
Salarios e Ordenados            →  Salários e Ordenados
Receita de Servicos             →  Receita de Serviços
Manutençao de Software          →  Manutenção de Software
Resultado Liquido               →  Resultado Líquido
Receita Nao Recorrente ...      →  Receita Não Recorrente Comissões ...
```

Mais Bolívia, México, Adesão, Recorrência e uma troca de letra que não aparecia
na sua tela ("Recelita Líquida", no cadastro-mestre da Receita Líquida).

**Duas coisas ficaram de fora de propósito:**

- **A duplicata de impostos continua sendo dois cadastros.** Corrigimos a
  grafia, não fundimos: fundir plano de contas é decisão de controladoria e
  fundir errado move lançamento de lugar. ⚠ O efeito colateral é bom — agora
  que os nomes ficaram quase iguais, **a duplicata parou de se esconder atrás
  do erro de digitação** e fica evidente para quem decidir.
- **`**Livre` fica.** Os asteriscos parecem marcação de linha reservada, não
  engano.

> **Observação de origem:** boa parte eram acentos que o ERP não exporta
> (`Servicos`, `Salarios`, `Comissoes`). Eles **voltam** na próxima importação
> que sobrescreva descrição — o conserto definitivo é no perfil de importação,
> e está na nossa lista.

### Como validar — já está no ar
Relatório > DRE Gerencial, e Organograma > árvore de centro de custo.

---

## 6. A causa raiz foi fechada

Além de religar os vínculos, o modo de importação que os quebrou foi
reconstruído. Antes ele apagava e recriava; agora **atualiza quem está no
arquivo e remove apenas quem não está**, preservando o identificador do posto —
e com ele a área funcional e os ajustes feitos à mão, que também se perdiam.

Duas proteções novas: vaga sem matrícula nunca é removida (o arquivo do RH não
pode contê-la), e a confirmação **lista pelo nome** quem vai sair, em vez de só
contar.

Foi encontrado e corrigido no caminho um defeito irmão que ninguém havia
notado: **excluir um posto não apagava o orçamento que ele havia gerado** — um
posto inexistente seguia custando, sem dono e sem rastro.

Ambos dependem do próximo deploy.

---

## 7. Pontos onde a leitura precisa de um ajuste

Isto não diminui o relatório — são casos em que o comportamento está certo e a
interpretação levaria a um conserto errado.

**C-08 e C-15 — empresa diferente entre cadastro e folha não é erro de
cadastro.** É o rateio do próprio ERP. Seu **C-21** mostra isso: o Nilson
aparece repartido em 6 empresas com percentuais fixos (01 25,1% · 05 25,6% ·
06 7,5% · 25 10,4% · YY 14,2% · ZZ 17,1%). A "empresa da folha" é destino de
rateio, não a empresa do posto. ⚠ Corrigir a origem, como o documento sugere,
quebraria o rateio. O **C-15** (Filial 2002 ≠ Empresa 01) tem a mesma
explicação.

**C-01, C-02 e C-19 — efeito do seu escopo de acesso.** Você enxerga apenas o
CC 141, então a receita é zero, tudo vira prejuízo, e a linha de IRPJ/CSLL
aplica a alíquota sobre um prejuízo que só existe nessa visão. A pergunta que
sobrevive é legítima e é de controladoria: a DRE deve lançar crédito sobre
resultado negativo?

**C-20 — os 5,5% são premissa de dissídio da versão**, aplicada por sindicato,
com mês-base diferente para cada um (SP em janeiro, PR em maio, MS em junho).
Benefícios congelados é por desenho. Você tem razão de que o parâmetro deveria
estar visível para quem audita — anotado.

---

## 8. O que continua com você

**A-18 — despesas administrativas do CC 141.** Este não é defeito de sistema:
são lançamentos que faltam no orçado. Precisamos de você:

1. o **de-para** entre o tipo de contrato do seu controle (Telefonia,
   Hospedagem, Cloud Backup, Outsourcing, Monitoramento, Loja de Aplicativo) e
   as linhas do plano de contas;
2. os **valores mensais** por linha.

Telefonia fixa e móvel existem como linha e estão zeradas — é a maior categoria
do seu controle (R$ 156.313,80/ano) e a maior parte da diferença de
R$ 87.648,28 que você apurou.

**A-19 — o prestador Gustavo Dias.** Precisamos do posto, centro de custo e
valor mensal do contrato para incluí-lo no quadro.

**A-20 (2ª parte) — as cargas de apontamento de Jan a Out/2026**, e a
conferência das 12 h de diferença do Amauri Zeferino em Ago/2026.

---

## 9. Situação por item

| ref. | situação |
|---|---|
| A-01 | ✅ resolvido · validável agora |
| A-02 | ✅ resolvido · validável agora |
| A-03 | 🔍 em análise — não reproduzimos ainda |
| A-04 | ✅ corrigido · **após o próximo deploy** |
| A-09 | ✅ corrigido · validável agora |
| A-16 | ✅ esclarecido — o filtro está correto; faltam cargas |
| A-17 | ✅ resolvido · validável agora |
| A-18 | ⬜ **com a TI** — de-para e valores |
| A-19 | ⬜ **com RH/TI** — dados do contrato |
| A-20 | ✅ vínculo resolvido · ⬜ cargas faltantes com a TI |
| C-05 · C-07 · C-09 · C-11 | ✅ respondidos |
| C-08 · C-15 · C-21 | ℹ️ comportamento correto — é rateio do ERP |
| C-01 · C-02 · C-19 | ℹ️ efeito do escopo · pergunta de controladoria em pé |
| C-20 | ℹ️ premissa confirmada · parâmetro será exposto |
| A-05 a A-08, A-10 a A-15, C-03 · C-04 · C-06 · C-10 · C-12 a C-14 · C-16 a C-18 | 📋 em fila |

---

**Uma nota de agradecimento, e não é formalidade.** A conferência verba a verba
da memória de cálculo contra a folha analítica do ERP — três postos, oito
verbas, batendo ao centavo — é a validação mais completa que o motor de folha
já recebeu. E o defeito dos vínculos estava em produção havia onze dias sem que
ninguém percebesse: ele só apareceu porque alguém sentou e conferiu posto a
posto.
