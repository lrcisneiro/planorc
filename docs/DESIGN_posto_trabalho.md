# DESIGN — Posto de Trabalho (orçamento de folha) · F5

> Status: **em discussão** (jul/2026). Decisões tomadas com Ricardo em 09/jul.
> Referências de mercado: position-based workforce planning (Workday Adaptive,
> Oracle EPM Workforce), payroll reconciliation, variâncias tipificadas
> (attrition/timing/compensação — Visier, headcount365).

## Problema

Orçar folha de pagamento por **posto de trabalho** (estrutura de cargos →
nível de funcionário nominal × verbas) e acompanhar o realizado ao longo do
ano, absorvendo demissões, contratações e transferências sem perder a
referência do orçamento aprovado.

## Decisões estruturais (fechadas)

1. **Grão híbrido** — funcionários nominais (importados do RH, salário real)
   + postos/vagas planejadas (cargo, CC, mês de início). Padrão Workday/Oracle.
2. **Realizado oficial continua contábil** (conta×CC via `fat_realizado`).
   A folha analítica por pessoa entra em **tabela paralela** (`fat_folha`)
   usada para conciliação contabilizado × folha e análise por pessoa.
   Nunca alimenta a DRE.
3. **Eventos + forecast** — baseline congelada na versão aprovada;
   movimentações (admissão/desligamento/transferência/reajuste) são eventos
   datados que recalculam uma versão FORECAST separada.
4. **Cadastro `verba` reestruturado** — era o de verbas do ERP (nunca usado);
   vira o catálogo central: regra de cálculo + conta orçamentária de destino
   + de-para da folha analítica.
5. **Rescisão = provisão contínua** (regra % sobre a base, como encargos).
6. **Dissídio por sindicato/empresa** — cadastro de sindicato com data-base;
   % de reajuste é premissa por versão × sindicato.

## Modelo de dados (novas tabelas / reestruturas)

```
cargo            id, tenant_id, codigo, nome, salario_ref numeric,
                 ativo bool                              -- catálogo simples

sindicato        id, tenant_id, codigo, nome, mes_database int (1-12)

verba (REESTRUTURADA)
                 id, tenant_id, codigo (ERP), descricao,
                 tipo_calculo: BASE          -- o próprio salário
                             | PCT_BASE      -- % sobre salário (INSS, FGTS, rescisão…)
                             | PCT_VERBA     -- % sobre outra verba (encargo s/ provisão)
                             | PROVISAO_1_12 -- 1/12 da base × fator (13º=1; férias=1,3333)
                             | VALOR_FIXO    -- benefício per capita/mês
                             | INFORMATIVA   -- só de-para da folha (não orça)
                 parametro numeric,          -- % / fator / valor
                 verba_ref_id (para PCT_VERBA),
                 conta_destino_id → conta_orcamentaria,   -- Aplicar + conciliação
                 incide_encargos bool,       -- entra na base de PCT_BASE?
                 ordem int, ativo bool

-- AJUSTES 09/jul (dados reais da folha):
--  · posto.regime: CLT | PRESTADOR | PROLABORE — o regime define QUAIS verbas
--    o motor aplica ao posto. SEM regra por código de matrícula: cada modelo
--    tem suas próprias verbas no ERP, e é a VERBA que direciona a conta
--    orçamentária (CLT→20101/20201; prestador→20301 Terceiros, sem encargos).
--  · verba.regime: a que regime a regra se aplica (encargos/provisões = CLT).
--  · verba.aglutina_em: código ERP → verba orçamentária AGREGADA (ex.: bônus/
--    comissões/prêmios → VAR "Remuneração variável"; horas faturáveis/prestação
--    → PREST). Orçamento limpo nas agregadas; realizado abre por código e a
--    conciliação usa o de-para. Verbas de conciliação = tipo INFORMATIVA.

posto            id, tenant_id, codigo, cargo_id, empresa_id, filial_id, cc_id,
                 sindicato_id (null = herda empresa? v1: obrigatório informar),
                 funcionario_id (null = VAGA planejada),
                 salario_base numeric,       -- real (nominal) ou faixa (vaga)
                 ini_ano int, ini_mes int,   -- vigência no orçamento
                 fim_ano int, fim_mes int,   -- null = até dez
                 fte numeric default 1,      -- meio período etc.
                 obs text

posto_evento     id, tenant_id, posto_id, versao_id,      -- eventos SÓ em versões forecast
                 tipo: ADMISSAO | DESLIGAMENTO | TRANSFERENCIA | REAJUSTE | PROMOCAO,
                 ano int, mes int,
                 payload jsonb               -- {cc_id novo, salario novo, %…}

premissa_dissidio  versao_id, sindicato_id, pct numeric   -- % por versão×sindicato
                                                          -- (aplica a partir do mes_database)

fat_folha        id, tenant_id, empresa_id, filial_id, cc_id,
                 funcionario_id (ou matricula texto p/ não-cadastrados),
                 verba_id (resolvida por codigo), ano, mes, valor,
                 lote/origem import          -- folha analítica do ERP, paralela
```

`fat_orcado` não muda: o Aplicar grava `dims = {posto, funcionario, verba}` e
`origem = 'FORMULARIO'` (ou nova origem 'POSTO' — decidir; nova origem facilita
limpar/reaplicar sem colidir com formulários).

## Motor de cálculo (record-based, separado do engine linha×mês)

Para cada versão × empresa:

```
para cada posto vigente na versão (aplicando eventos da versão por mês):
  para mes = 1..12 dentro da vigência:
    base(mes) = salario_base × fte
                × (1 + dissidio% se mes >= mes_database do sindicato)
                (eventos REAJUSTE/PROMOCAO/TRANSFERENCIA sobrepõem a partir do mês)
    para cada verba ativa (ordem):
      BASE          → base(mes)
      PCT_BASE      → base(mes) × %          (encargos, rescisão-provisão)
      PROVISAO_1_12 → base(mes) × fator / 12 (13º, férias+1/3)
      PCT_VERBA     → valor(verba_ref, mes) × %
      VALOR_FIXO    → valor
    acumula por (verba.conta_destino, empresa, filial, cc, mes)
Aplicar: delete escopo (versão×empresa×origem) + insert fat_orcado
         com dims={posto, funcionario, verba}
```

Desligamento (evento): custo até o mês; a rescisão já está provisionada
mensalmente (decisão 5) — sem one-off no v1.

## Telas (padrão split, rotas novas)

- `/postos` — hub por empresa: grade de postos (cargo, CC, ocupante/vaga,
  salário, vigência, custo anual calculado) + totais headcount/FTE/custo.
  Escopo ORÇAR por empresa (F2). Import de funcionários→postos.
- `/postos/regras` — estrutura (admin): catálogo de verbas/regras (ordem,
  tipo, %, conta destino), cargos, sindicatos + premissas de dissídio.
  Gate capacidade «estrutura».
- `/postos/eventos` (P3) — timeline de movimentações da versão forecast.
- `/folha` (P2) — import da folha analítica + tela de conciliação:
  fat_folha agregada por conta (via verba.conta_destino) × fat_realizado
  (conta×CC×mês) com coluna de diferença; drill por pessoa.
- Variâncias (P3): plano×folha por pessoa → attrition / timing / compensação.

Capacidades novas em `CAPACIDADES`: `menu.postos`, `menu.folha`,
`postos.estrutura` (ou reusar «estrutura»).

## Rateio (CSC — decisões de 09/jul)

Custos de um funcionário/posto/cargo (ou CC inteiro) podem ser rateados para
outras empresas/CCs por percentual — caso típico: Centro de Serviços
Compartilhado. Decisões: o realizado **já vem rateado do ERP** (O×R fecha por
destino); percentuais **fixos por versão** no orçado (variação mensal só
existe no realizado, que chega pronto); alcance = folha primeiro, mas o
conceito serve a outras despesas (ex.: marketing) → **motor genérico e
independente**, que processa qualquer fonte e grava o resultado rateado em
`fat_orcado`.

```
rateio_regra    id, tenant_id, escopo_tipo (FUNCIONARIO|POSTO|CARGO|CC),
                escopo_id, versao_id (null = todas), mes_ini/mes_fim (null = ano),
                ativo
rateio_destino  regra_id, empresa_id, filial_id (null), cc_id, pct
                -- soma = 100% (validação na tela; sem regra = 100% na origem)
```

Motor de rateio (etapa final de qualquer Aplicar):
- entrada: parcelas (verba/linha, empresa, filial, cc, mes, valor) + contexto
  (funcionario, posto, cargo);
- precedência da regra: FUNCIONARIO → POSTO → CARGO → CC (a mais específica);
- saída: N parcelas com empresa/cc de DESTINO e
  `dims = {..., cc_origem, rateio_pct}` — drill mostra a origem.
- Fontes: (1) motor de postos (P1); (2) futuro: pós-processamento de orçado
  por CC (despesas do CSC lançadas na grade/formulários → redistribuídas por
  regra escopo CC; exige origem própria p/ reprocessar idempotente).
- Conciliação da folha (P2): fat_folha está no CC físico da pessoa; para
  bater com o contábil (já rateado), a conciliação aplica as mesmas regras
  antes do confronto.

## Fases

- **P1 — Orçar por posto**: cargo/sindicato/verba reestruturada + posto +
  motor (incluindo etapa de rateio) + telas /postos, /postos/regras e
  cadastro de rateios + Aplicar. Entrega o orçamento.
- **P2 — Folha analítica**: fat_folha + import mensal + conciliação.
- **P3 — Eventos + Forecast**: posto_evento em versão forecast + variâncias
  tipificadas + premissa de dissídio aplicada por evento re-cálculo.
- **P4 — Dashboards**: headcount/FTE, custo médio, turnover, vacancy savings.
- **P5 — Rateio de despesas gerais**: aplicar o motor de rateio como
  pós-processamento do orçado por CC (marketing, TI, aluguéis do CSC).

## Pendências / a discutir

- Origem no fat_orcado: 'FORMULARIO' reuso vs novo valor 'POSTO' (preferir POSTO).
- `funcionario` atual: conferir colunas (matricula? admissao? salario?) e
  enriquecer via import do RH.
- Encargos que variam por empresa (RAT/FAP, Sistema S): v1 usa % único por
  verba; se precisar por empresa, premissa verba×empresa (mesmo padrão 🌐).
- Salário de VAGA: usar salario_ref do cargo como default.
- RLS/escopo: postos respeitam escopo de dados por empresa/CC (F2).
```
