# ESTUDO — Multimoeda no Planorc

> Status: **estudo fechado / pronto para implementar** (29/jul/2026). Decisões
> tomadas com Ricardo + validadas por pesquisa de mercado (deep-research, 25
> fontes, 23 claims confirmados / 2 refutados). Ainda **sem código**.

## 1. O problema

Empresas do grupo no exterior (Paraguai, Bolívia) operam e **reportam em USD**;
o Brasil em BRL. Hoje o Planorc trata **todo valor como a mesma moeda** (implícito
BRL): `fat_orcado`, `fat_realizado`, `fat_saldo`, `fat_folha` guardam `valor` e as
RPCs `relatorio_*_agg` **somam sem converter**. Consolidar BR + exterior mistura
moedas. Precisamos: (1) saber a moeda de cada lançamento; (2) converter para
consolidar/comparar; (3) câmbio por período; (4) **exibir em qualquer moeda**.

## 2. Decisões (todas fechadas em 29/jul)

1. **Moedas: BRL e USD** por ora. Exterior reporta **orçado e realizado já em USD**
   (não em moeda local). Arquitetura genérica p/ +moedas depois (ex.: Argentina→ARS).
2. **Moeda por FATO** (não só derivada da empresa): a mesma empresa `XX` (Paraguai)
   pode receber BRL (redirect da folha do Brasil, lançado em BRL) **e** USD (reporte
   próprio). A moeda default vem da empresa, mas o fato carrega a sua.
3. **Modelo MATERIALIZADO (N colunas por moeda)** — decisão do Ricardo, **validada
   pela pesquisa** como 1 dos 2 designs canônicos. Ao gravar um fato, converte na
   **escrita** para todas as N moedas configuradas; as RPCs só **somam a coluna** da
   moeda de exibição → **agregação quase intacta** (de-risca o maior ponto).
4. **Câmbio DIÁRIO com carry-forward** — a cotação é por dia; ao converter, usa a
   **taxa da data do lançamento** (ou a **última anterior** disponível). É o padrão
   NetSuite (taxa da data da transação).
5. **Taxa REALIZADA × taxa ORÇADA por versão** (em escopo, não Fase 2). O realizado
   usa a taxa **real** (câmbio diário). O orçado usa a **taxa orçada** da **versão**
   (premissa do cenário). Consequência boa: comparar orçado×realizado em BRL mostra
   o efeito cambial; comparar em USD (moeda origem) o remove → **análise em moeda
   constante** (prática de FP&A: Workday Adaptive guarda taxa por versão).
6. **Exibir em qualquer moeda** — o gestor do Paraguai vê em USD, o do Brasil em BRL,
   consolidado do grupo em BRL. Com o modelo materializado, "exibir em X" = **ler a
   coluna do slot X** (sem conversão em runtime).
7. **Uso gerencial** — 1 taxa por moeda×período; **sem** separar average (DRE) de
   closing (balanço) nem variação cambial no PL (CPC 02). A pesquisa **refutou**
   (0-3) que separar seja obrigatório; como o exterior já reporta em USD, o
   par é único (USD↔BRL) e average/closing importa pouco aqui.
8. **Câmbio em tabela dedicada** — `indice_economico`/`indice_valor` estão **sem uso**
   e guardam **% mensal** (correção), não cotação absoluta. Não reusar.

## 3. Modelo de dados (final)

```
moeda            slot int (1..N), codigo (BRL, USD…), nome, simbolo, casas, ativo
                 -- config por tenant: M1=BRL, M2=USD, M3=(livre). Pré-criar N slots
                 -- (ex.: 4) para adicionar moeda = ativar slot + recalcular, SEM migration.

empresa         + moeda_slot   -- moeda FUNCIONAL/default (Brasil=1/BRL, exterior=2/USD);
                                  default do input do orçado e do import daquela empresa.

cambio           data, taxa_para_base   -- cotação REAL por DIA vs base (BRL). BRL=1.
                 -- resolve por data ≤ lançamento (carry-forward da última anterior).
                 -- (par único USD↔BRL agora; genérico (moeda_slot, data, taxa) p/ +moedas)

versao_taxa      versao_id, moeda_slot, (ano, mes | nulo=constante), taxa_orcada
                 -- taxa ORÇADA por versão (premissa). Usada só pelo ORÇADO.

fat_orcado      + moeda_origem (slot digitado) + val_m1, val_m2, val_m3 …
fat_realizado   + moeda_origem + val_m1, val_m2, val_m3 …
fat_saldo       + moeda_origem + val_m1, val_m2, val_m3 …
fat_folha       + moeda_origem + val_m1, val_m2, val_m3 …
                 -- val_<origem> = valor como digitado/importado (intocável);
                 -- demais slots = convertidos na escrita; recalculáveis.
```

## 4. Conversão (na ESCRITA / materialização)

- **Realizado (razão/folha/saldo):** ao importar, o lote informa a moeda (default =
  a da empresa). `val_<origem>` = valor do arquivo; os outros slots = `valor × taxa`
  do **câmbio real** na data (carry-forward). Razão tem data → taxa do dia; folha/
  saldo (mensais) → taxa representativa do mês (fim do mês).
- **Orçado:** ao digitar/Aplicar, `val_<origem>` = valor orçado; outros slots =
  `valor × taxa_orcada` da **versão**. (Sem versao_taxa cadastrada → cai na câmbio
  real do período, com aviso.)
- **RPCs `relatorio_*_agg`:** recebem o **slot de exibição** e somam `val_m{slot}`.
  Nenhuma matemática de câmbio no banco em runtime. (Mudança mínima e segura.)
- **Recalcular conversões:** rotina que, ao corrigir uma taxa (câmbio ou orçada),
  refaz os slots convertidos a partir do `val_<origem>` — sem reimportar. Resolve
  o único ponto fraco do materializado (snapshot desatualizar).

## 5. Onde toca (impacto por área)

- **Cadastro:** catálogo `moeda` (slots), `cambio` (cotações diárias), `versao_taxa`
  (taxa orçada), `empresa.moeda_slot`.
- **Import (razão + folha):** seletor "moeda deste arquivo" + materialização dos slots.
- **Orçar (grade/editor):** input na moeda da empresa + rótulo; Aplicar materializa.
- **RPCs de agregação** (`_orcado_agg`/`_realizado_agg`/`_saldo_agg` + `_anual`/
  `_empresa`): parâmetro de slot + soma da coluna. **Mudança pequena** (vs reescrever).
- **DRE/dashboards:** seletor de **moeda de exibição** (default BRL).
- **Conciliação de folha:** já lida com Paraguai (`XX`); passa a comparar na mesma moeda.

## 6. Casos de borda

- **Taxa faltante** (dia/mês sem cotação e sem anterior): **erro/aviso visível**,
  nunca converter em silêncio errado. Import barra ou marca a linha.
- **Retrocompat:** fatos existentes → `moeda_origem` = BRL, `val_m1` = `valor` atual;
  `recalcular` preenche os demais slots quando houver cotação.
- **Precisão:** conversão **por linha** na escrita (não converter o total) — evita
  erro de arredondamento por mistura.
- **Adicionar moeda** (ex.: ARS): ativa o slot, cadastra cotações, **recalcular**
  materializa a coluna. Sem migration se os slots foram pré-criados.

## 7. Validação de mercado (deep-research, 29/jul)

25 fontes, 23 claims confirmados / 2 refutados (votação adversarial 3-voto).

- **Moeda por fato + taxa na data:** ✅ NetSuite guarda taxa **no nível da
  transação**; TM1 recomenda moeda como **dimensão separada**.
- **Materializar N colunas × converter na leitura:** ✅ **ambos canônicos** — a
  fonte técnica (data-warehouse) descreve "wide table que materializa cada moeda na
  escrita" **ou** "normalizada que converte na consulta". Nossa escolha (materializar)
  é padrão, não gambiarra.
- **Taxa por versão (budget vs actual):** ✅ Workday Adaptive guarda taxa **por
  versão**; OneStream/Jedox por cenário. → validou a decisão #5.
- **Exibir em qualquer moeda / base + triangulação:** ✅ (SQLBI/DAX, Oracle EPM).
- **3 camadas (transação/funcional/reporting):** ✅ padrão (abacum, liveflow, Phocas).
- **Refutado (0-3):** que seja **obrigatório** comparar realizado-a-closing vs
  orçado-a-budget-rate → simplificar (1 taxa gerencial) é defensável.
- **Cuidado (informativo):** ferramentas societárias separam **average (DRE)** de
  **closing (balanço)** — fora do nosso escopo gerencial atual, mas anotado.

Fontes-chave: NetSuite (timdietrich), data-warehouse currency (pljung.de),
Workday Adaptive (bspny), Phocas docs, Oracle EPM, Anaplan, TM1 forum, SQLBI.

## 8. Faseamento (enxuto — tudo em escopo)

1. **Migrations:** `moeda` (slots), `cambio`, `versao_taxa`, `moeda_origem` + `val_m*`
   nas 4 tabelas de fato (pré-criar N slots; default BRL/slot1). *(pequeno)*
2. **Cadastros:** telas de moeda, cotação diária, taxa orçada por versão. *(médio)*
3. **Materialização na escrita:** import (razão/folha) e Aplicar/orçar convertem e
   gravam os slots + rotina **recalcular**. *(médio)*
4. **RPCs:** parâmetro de slot + soma da coluna. *(pequeno-médio, com regressão)*
5. **Exibição:** seletor de moeda na DRE/dashboards. *(médio)*

## 9. Riscos / notas

- **Denormalização:** N colunas × 4 tabelas de fato. Aceitável p/ N pequeno; escolha
  consciente por consulta simples (RPC só soma coluna).
- **Snapshot:** valor convertido desatualiza se a taxa muda → a rotina **recalcular**
  é obrigatória, não opcional.
- **Regressão das RPCs:** ainda que a mudança seja pequena, é o coração — testar.
- **Ordem de implementação:** cadastro+câmbio → materialização no import → RPC/exibição.

> Relaciona: [[multi-moeda-orcamento]], [[agrupamento-e-consolidacao-participacao]],
> [[filtro-periodo-dinamico-realizado-multiano]].
