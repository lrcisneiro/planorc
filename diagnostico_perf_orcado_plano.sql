-- ============================================================
-- Plano real da consulta que a relatorio_orcado_agg executa.
-- A função filtra por current_tenant_id(), que é NULL no SQL Editor; então aqui
-- o corpo é reproduzido com o tenant e a versão que TÊM dado, via InitPlan.
-- Instrução única → o resultado aparece.
-- Os arrays levam cast explícito: sem ele o ANY(...) é lido como SUBCONSULTA
-- (uuid = uuid[]) em vez de array, e o plano nem chega a rodar.
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, VERBOSE OFF)
SELECT fo.linha_id, fo.ano, fo.mes,
       sum(fo.valor) AS valor,
       count(*) AS n,
       CASE WHEN count(*) = 1 THEN max(fo.expressao) END AS expr,
       bool_or(fo.filial_id IS NOT NULL OR fo.cc_id IS NOT NULL) AS det
FROM fat_orcado fo
WHERE fo.tenant_id = (SELECT tenant_id FROM fat_orcado GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)
  AND fo.versao_id = (SELECT versao_id FROM fat_orcado GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)
  AND fo.empresa_id = ANY((SELECT array_agg(DISTINCT empresa_id) FROM fat_orcado)::uuid[])
  AND fo.ano        = ANY((SELECT array_agg(DISTINCT ano)        FROM fat_orcado)::int[])
  AND fo.mes        = ANY(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12])
  AND fo.linha_id   = ANY((SELECT array_agg(DISTINCT linha_id)   FROM fat_orcado)::uuid[])
GROUP BY fo.linha_id, fo.ano, fo.mes;
