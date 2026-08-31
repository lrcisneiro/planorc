-- ============================================================
-- VALIDAÇÃO — LER do PLANORC × planilha TOESTE (P0)
--
-- Soma o REALIZADO do PLANORC por mês (receita, custo de pessoas, margem),
-- calcula o LER e compara com a série da planilha (estudo-base, seção 7:
-- TOESTE_Indicadores_Operacionais.md, abr/2024 a abr/2026).
--
-- Reproduz a mesma resolução conta→linha da RPC relatorio_realizado_agg:
-- lê o rollup fat_realizado_mensal e resolve o que está sem linha via
-- conta_linha (DISTINCT ON por conta, escopado às contas orçamentárias do
-- relatório, aplicando o sinal).
--
-- LIMITE: soma a SUBÁRVORE de cada código configurado, contando só as linhas
-- ANALÍTICAS. Se a sua Margem Bruta for FORMULA (receita − custos), ela sai
-- zerada aqui — rode a checagem 2 antes de acreditar na coluna de margem.
-- Sem filtro de empresa/filial/CC: compara o consolidado, como a planilha.
-- ============================================================

-- ══════════════ 1) COMPARATIVO MÊS A MÊS ══════════════
WITH RECURSIVE cfg AS (
  SELECT 'DRE'::text            AS rel_codigo,   -- ajuste os 4 abaixo
         'REC'::text            AS cod_receita,
         'MB'::text             AS cod_margem,   -- '' se a margem não for somável
         ARRAY['DP01']::text[]  AS cods_custo
),
t AS (SELECT id FROM tenant LIMIT 1),
rel AS (SELECT r.id FROM relatorio r CROSS JOIN cfg CROSS JOIN t
         WHERE r.tenant_id = t.id AND r.codigo = cfg.rel_codigo),
lin AS (SELECT rl.* FROM relatorio_linha rl CROSS JOIN rel WHERE rl.relatorio_id = rel.id),
cl AS (
  SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c CROSS JOIN t
   WHERE c.tenant_id = t.id
     AND c.linha_id IN (SELECT DISTINCT linha_orc_id FROM lin WHERE linha_orc_id IS NOT NULL)
   ORDER BY c.conta_id, c.id DESC
),
raiz AS (
  SELECT l.id, 'RECEITA'::text AS grupo FROM lin l CROSS JOIN cfg WHERE l.codigo = cfg.cod_receita
  UNION ALL
  SELECT l.id, 'MARGEM'  FROM lin l CROSS JOIN cfg WHERE cfg.cod_margem <> '' AND l.codigo = cfg.cod_margem
  UNION ALL
  SELECT l.id, 'CUSTO'   FROM lin l CROSS JOIN cfg WHERE l.codigo = ANY(cfg.cods_custo)
),
arv AS (
  SELECT r.id, r.grupo FROM raiz r
  UNION ALL
  SELECT l.id, a.grupo FROM lin l JOIN arv a ON l.pai_id = a.id
),
alvo AS (
  SELECT DISTINCT a.grupo, l.linha_orc_id AS m
    FROM arv a JOIN lin l ON l.id = a.id
   WHERE l.linha_orc_id IS NOT NULL
     AND l.tipo_linha = 'ANALITICA'
     AND NOT l.desativada
     AND NOT COALESCE(l.nao_soma, false)
),
mov AS (
  SELECT al.grupo, fm.ano, fm.mes, fm.valor AS v
    FROM fat_realizado_mensal fm
    JOIN alvo al ON al.m = fm.linha_id
   WHERE fm.tenant_id = (SELECT id FROM t)
  UNION ALL
  SELECT al.grupo, fm.ano, fm.mes, fm.valor * cl.sinal AS v
    FROM fat_realizado_mensal fm
    JOIN cl ON cl.conta_id = fm.conta_id
    JOIN alvo al ON al.m = cl.linha_id
   WHERE fm.tenant_id = (SELECT id FROM t) AND fm.linha_id IS NULL
),
planorc AS (
  SELECT ano, mes,
         COALESCE(sum(v) FILTER (WHERE grupo = 'RECEITA'), 0)      AS receita,
         COALESCE(-sum(v) FILTER (WHERE grupo = 'CUSTO'), 0)       AS custo,   -- despesa negativa → positiva
         COALESCE(sum(v) FILTER (WHERE grupo = 'MARGEM'), 0)       AS margem
    FROM mov GROUP BY ano, mes
),
gab (ano, mes, receita, custo, margem, ler, lerm) AS (VALUES
  (2024, 4, 6639517, 3817554, 1591686, 1.74, 0.42),
  (2024, 5, 6763961, 3916456, 1455228, 1.73, 0.37),
  (2024, 6, 6712552, 3795891, 1552211, 1.77, 0.41),
  (2024, 7, 6746135, 3867883, 1461601, 1.74, 0.38),
  (2024, 8, 7154356, 3876512, 2217046, 1.85, 0.57),
  (2024, 9, 6922199, 3946494, 1786210, 1.75, 0.45),
  (2024,10, 6781162, 3963267, 1588348, 1.71, 0.40),
  (2024,11, 7183472, 3960829, 1938601, 1.81, 0.49),
  (2024,12, 6410680, 3889858, 1421638, 1.65, 0.37),
  (2025, 1, 7199263, 3796630, 2314067, 1.90, 0.61),
  (2025, 2, 8317386, 4164561, 2659972, 2.00, 0.64),
  (2025, 3, 7205537, 4392542, 1378600, 1.64, 0.31),
  (2025, 4, 7371163, 4572077, 1464519, 1.61, 0.32),
  (2025, 5, 8679092, 4617124, 2644500, 1.88, 0.57),
  (2025, 6, 8258056, 4771127, 2030956, 1.73, 0.43),
  (2025, 7, 8152676, 5094646, 1164603, 1.60, 0.23),
  (2025, 8, 8212534, 4967783, 1808647, 1.65, 0.36),
  (2025, 9, 7866124, 4867383, 1523669, 1.62, 0.31),
  (2025,10, 8531657, 4874119, 1765334, 1.75, 0.36),
  (2025,11, 8326420, 5094095, 1529953, 1.63, 0.30),
  (2025,12, 8521254, 5060414, 1565117, 1.68, 0.31),
  (2026, 1, 8390575, 5193127, 1926454, 1.62, 0.37),
  (2026, 2, 8330420, 4866849, 1919244, 1.71, 0.39),
  (2026, 3, 8554408, 5146513, 1653761, 1.66, 0.32),
  (2026, 4, 9344860, 5186151, 2164235, 1.80, 0.42)
)
SELECT
  g.ano, g.mes,
  round(p.receita)                                                   AS receita_planorc,
  g.receita                                                          AS receita_planilha,
  round((p.receita - g.receita) / NULLIF(g.receita, 0) * 100, 1)      AS receita_dif_pct,
  round(p.custo)                                                     AS custo_planorc,
  g.custo                                                            AS custo_planilha,
  round((p.custo - g.custo) / NULLIF(g.custo, 0) * 100, 1)            AS custo_dif_pct,
  round(p.receita / NULLIF(p.custo, 0), 2)                           AS ler_planorc,
  g.ler                                                              AS ler_planilha,
  round(p.receita / NULLIF(p.custo, 0) - g.ler, 2)                   AS ler_dif,
  round(p.margem / NULLIF(p.custo, 0), 2)                            AS lerm_planorc,
  g.lerm                                                             AS lerm_planilha
FROM gab g
LEFT JOIN planorc p ON p.ano = g.ano AND p.mes = g.mes
ORDER BY g.ano, g.mes;


-- ══════════════ 2) As raízes configuradas são somáveis? ══════════════
-- Se a linha for FORMULA/INDICADOR, a soma da subárvore acima NÃO vale para ela:
-- confira esse indicador na tela (Dashboards → Indicadores), não por aqui.
SELECT rl.codigo, rl.descricao, rl.tipo_linha, rl.expressao,
       (SELECT count(*) FROM relatorio_linha f WHERE f.pai_id = rl.id) AS filhas
  FROM relatorio_linha rl
  JOIN relatorio r ON r.id = rl.relatorio_id
 WHERE r.codigo = 'DRE'                          -- ajuste
   AND rl.codigo IN ('REC', 'MB', 'DP01')        -- ajuste: receita, margem, custos
 ORDER BY rl.ordem;


-- ══════════════ 3) Conta amarrada a mais de uma linha do relatório ══════════════
-- Fonte clássica de dupla contagem — e o risco direto de criar a matriz de
-- receita (R1/R2/S1/S2) sem tirar a amarração antiga. Esperado: zero linhas.
SELECT cc.codigo AS conta, cc.descricao,
       count(*) AS vezes,
       string_agg(co.codigo, ', ' ORDER BY co.codigo) AS contas_orcamentarias
  FROM conta_linha cl
  JOIN conta_contabil cc ON cc.id = cl.conta_id
  JOIN conta_orcamentaria co ON co.id = cl.linha_id
 WHERE cl.linha_id IN (
         SELECT DISTINCT rl.linha_orc_id
           FROM relatorio_linha rl JOIN relatorio r ON r.id = rl.relatorio_id
          WHERE r.codigo = 'DRE' AND rl.linha_orc_id IS NOT NULL   -- ajuste
       )
 GROUP BY cc.codigo, cc.descricao
HAVING count(*) > 1
 ORDER BY 3 DESC, 1;
