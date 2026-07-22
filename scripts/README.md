# Pipeline de import de postos (F5 · Posto de Trabalho)

Converte os exports do TOTVS num CSV único e o importa na grade `/postos`.
**Rode os 3 passos na ordem.** O passo 2 é o que traz salário **e** benefícios —
nunca pule ele antes de importar, senão os postos entram sem salário e sem
benefício (e um "substituir escopo" apaga os `posto_verba` por CASCADE).

## Entradas (em `dados_rh/`, NÃO versionado — PII)
- `Funcionarios.csv` — export TOTVS de funcionários (colunas `BK_*`).
- `Depara_filial_empresa.csv` — de-para filial (4 díg.) → empresa gerencial.
- `prgper02_emp*.xlsx` — folha analítica do mês (salário + benefícios por verba).

## Passos

```bash
# 1) Funcionários → postos + rateio.  Gera funcionarios_convertido.csv
python3 scripts/converter_funcionarios.py \
  dados_rh/Funcionarios.csv dados_rh/funcionarios_convertido.csv \
  --depara=dados_rh/Depara_filial_empresa.csv

# 2) Preenche salário + benefícios (D49/A76/D50/A15/A51) a partir da folha.
#    Sobrescreve o mesmo CSV, preservando as colunas do passo 1 (inclui rateio).
python3 scripts/preencher_salario_folha.py dados_rh/funcionarios_convertido.csv dados_rh

# 3) No app: /postos → "Importar postos (RH)" → funcionarios_convertido.csv
```

Colunas finais do CSV: `posto_codigo, empresa, filial, cc, matricula, nome, cargo,
regime, salario, admissao, demissao, situacao, ativo, rateio, D49, A76, D50, A15, A51`.

## O que cada coluna vira no import
- **posto** (posto_codigo/empresa/filial/cc/cargo/regime/salario/vigência) → tabela `posto`.
- **rateio** (código, ex.: `RATEMP01`) → `posto_rateio` (casa por **nome** do código já
  cadastrado em `4 · Rateio`; vários separados por `;` viram cascata por ordem).
- **D49/A76/D50/A15/A51** (colunas que casam com **código de verba** VALOR_FIXO) → `posto_verba`.

## Regras embutidas
- **Salário por regime** (`preencher_salario_folha.py`): CLT→B39, PROLABORE→073,
  PRESTADOR→222/228 (soma as linhas da folha por filial+matrícula).
- **Rateio por centro de custo** (`converter_funcionarios.py`, `RATEIO_POR_CC`):
  - CC 111/141/411/210/310 → **RATEMP01**
  - CC 121/122/123/131/132/133 → **RATEMP02**
  - CC 317 → **RATEMP03**
- **Benefícios** (`BENEF`): lidos de `verbas_folha_import.xlsx` (tipo VALOR_FIXO) ou
  fallback `D49, A76, D50, A15, A51`.

## Folha realizada (conciliação — fat_folha)

Paralelo ao pipeline de postos, para o REALIZADO da folha (não vem do razão, e sim
da folha analítica). Alimenta `fat_folha` e a conciliação Orçado × Realizado por posto.

```bash
# prgper02_emp*.xlsx (Conferência Contabilização Folha) → folha_realizada.csv
python3 scripts/converter_folha_realizada.py dados_rh dados_rh/folha_realizada.csv \
  --depara=dados_rh/Depara_filial_empresa.csv
# depois: importar folha_realizada.csv na tela de Folha realizada → fat_folha
```

- Uma linha por **matrícula × verba × contabilização** do mês. Traz `conta_deb`
  (débito contábil), que casa o realizado na MESMA linha da DRE, e `posto_codigo`
  = `filial-matrícula` (casa no posto).
- Critério **contábil** (não o rótulo provento/desconto/base): mantém a linha que
  tem **débito contábil**; descarta as sem contabilização (bases informativas puras).
  Importante: encargos patronais vêm como "Base" **com** débito — por isso o filtro
  é por débito, não por tipo.
- **Item orçamentário autoritativo:** a folha já traz a conta orçamentária do débito
  na coluna **IT_CONTAB_DB** (ex.: `20101 Salarios e Ordenados`) — a MESMA codificação
  de `verba.conta_destino`/`fat_orcado`. O converter a exporta em `item_orc`, o import
  resolve para `fat_folha.item_orc_id`, e a **conciliação agrupa por ele** (não pelo
  reverse-lookup `conta_linha`, que é ambíguo: a mesma conta contábil pode estar em
  conta_orcamentaria diferentes por relatório).

## Notas
- "sem linha na folha" no passo 2 = pessoa sem lançamento nos `prgper02` do mês
  (prestador/admissão nova) — esperado; entra com salário 0.
- Modo de import: **"substituir escopo"** só é seguro depois do passo 2 (CSV completo);
  senão use **"adicionar/atualizar"**.
