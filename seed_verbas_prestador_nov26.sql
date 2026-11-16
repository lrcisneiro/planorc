-- ============================================================
-- SEED — as verbas variáveis do prestador viram BENEFÍCIO orçável
--
-- POR QUE EXISTE: o custo do prestador tem dez verbas além do par 222+228, e
-- **nenhuma delas chega ao orçado**. Cinco estão catalogadas como
-- `INFORMATIVA`, que o motor descarta (`verbasDoRegime` filtra), e três nem
-- existem no catálogo. Achado pelo RH ao conferir o cadastro: "tem pessoas que
-- têm garantia de horas e essa verba não veio".
--
-- ⚠⚠ A 418 NÃO É UM DETALHE. Medido nas 35 pessoas que a recebem, em 2026:
--     só a 222 .......... oscila 120% entre meses
--     222 + 418 ......... oscila  36%
-- A garantia de horas é **exatamente o que torna o custo previsível**: quem
-- fatura pouco num mês recebe a diferença por ela. Orçar só a 222 nessas
-- pessoas é errado E instável — orça-se a parte que varia e ignora-se a que
-- estabiliza. O que o contrato promete é a SOMA.
--
-- ⚠ `INFORMATIVA` É PIOR QUE AUSENTE, e por isso este seed vem ANTES do
-- arquivo de importação: a tela aceita coluna de qualquer verba ATIVA, não só
-- das `VALOR_FIXO`. Importar a 418 hoje gravaria o valor em `posto_verba`, o
-- resumo diria "10 verbas" e o motor continuaria ignorando — número guardado,
-- custo não contado, e nada acusando.
--
-- REGIME E CONTA SAEM DO DADO, não de suposição: as dez são recebidas **só**
-- por `BR-PRESTADOR` e **todas** caem no item `20301 · Terceiros Internos`.
--
-- ⚠ O que NÃO entra: `222` e `228` continuam fora do catálogo de propósito —
-- elas formam o `salario_base` do prestador (decisão do Ricardo, nov/26), e
-- uma verba não pode estar nos dois lugares sem contar duas vezes.
-- ⚠ Descontos (`629 Camisetas`, `610 Adiantamento`, `655 Multa`) ficam de
-- fora: reduziriam o custo orçado, e isso é decisão de controladoria.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

WITH t AS (SELECT id FROM tenant ORDER BY criado_em LIMIT 1),
conta AS (SELECT id FROM conta_orcamentaria WHERE codigo='20301' AND tenant_id=(SELECT id FROM t))
INSERT INTO verba_folha (tenant_id, codigo, descricao, tipo_calculo, regime,
                         categoria, incide_encargos, mantem_afastado, conta_destino_id, ordem, ativo)
SELECT (SELECT id FROM t), x.cod, x.descr, 'VALOR_FIXO', 'BR-PRESTADOR',
       'BENEFICIOS', false, true, (SELECT id FROM conta), x.ord, true
  FROM (VALUES
    ('418', 'Garantia de horas',            300),
    ('223', 'Translado',                    301),
    ('234', 'Comissões de fechamento',      302),
    ('235', 'Bônus complementar',           303),
    ('168', 'Fixo despesas',                304),
    ('224', 'Despesas fixas',               305),
    ('236', 'Pagto encargos prest. serviço',306),
    ('237', 'Pagto prest. serviço compl.',  307)
  ) AS x(cod, descr, ord)
ON CONFLICT (tenant_id, codigo) DO UPDATE
  SET descricao = EXCLUDED.descricao,
      tipo_calculo = 'VALOR_FIXO',          -- ⚠ o ponto do seed: sai de INFORMATIVA
      regime = EXCLUDED.regime,
      categoria = EXCLUDED.categoria,
      incide_encargos = false,              -- prestador não gera encargo trabalhista
      conta_destino_id = EXCLUDED.conta_destino_id,
      ativo = true;

-- ⚠ A 230 e a 231 já eram VALOR_FIXO e já estão anexadas a 8 e 33 postos, mas
-- com regime NULO (= vale para todos) e sem conta. Só quem as recebe é
-- prestador; deixá-las abertas faria uma importação de CLT criar benefício
-- onde não há.
UPDATE verba_folha SET regime = 'BR-PRESTADOR',
       conta_destino_id = coalesce(conta_destino_id,
         (SELECT id FROM conta_orcamentaria WHERE codigo='20301' AND tenant_id=verba_folha.tenant_id)),
       categoria = coalesce(categoria, 'BENEFICIOS')
 WHERE codigo IN ('230','231') AND coalesce(regime,'') = '';

-- ---------------- conferência ----------------
SELECT 'verbas do prestador prontas para orçar' AS secao,
       (SELECT string_agg(codigo || '=' || tipo_calculo, ' · ' ORDER BY codigo)
          FROM verba_folha WHERE ativo AND codigo IN
               ('168','223','224','230','231','234','235','236','237','418')) AS resultado
UNION ALL
SELECT 'ainda INFORMATIVA entre elas?',
       (SELECT CASE WHEN count(*)=0 THEN 'nenhuma — correto' ELSE '⛔ ' || string_agg(codigo,', ') END
          FROM verba_folha WHERE ativo AND tipo_calculo='INFORMATIVA'
            AND codigo IN ('168','223','224','230','231','234','235','236','237','418'))
UNION ALL
SELECT 'todas apontam para Terceiros Internos?',
       (SELECT CASE WHEN count(*)=10 THEN 'sim — 10 de 10' ELSE count(*)::text || ' de 10' END
          FROM verba_folha v JOIN conta_orcamentaria c ON c.id=v.conta_destino_id
         WHERE c.codigo='20301' AND v.codigo IN ('168','223','224','230','231','234','235','236','237','418'))
UNION ALL
SELECT 'valores já anexados a posto (antes da carga)',
       (SELECT coalesce(string_agg(t,' · '),'nenhum') FROM (
          SELECT v.codigo || ': ' || count(*)::text || ' posto(s)' AS t
            FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
           WHERE pv.ativo AND v.codigo IN ('168','223','224','230','231','234','235','236','237','418')
           GROUP BY v.codigo ORDER BY v.codigo) q);
