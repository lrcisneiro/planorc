-- ============================================================
-- PROVA da v3_209 — rode DEPOIS da migration, no SQL Editor.
--
-- ⚠ Prova que só LÊ: pode terminar em SELECT. A regra do `DO` + `RAISE` vale
-- para prova que ESCREVE, onde a exceção é o que desfaz o rastro do teste.
--
-- A asserção que importa: somando o agregado NOVO por todas as dimensões, o
-- total tem de bater com o agregado ANTIGO ao centavo. Se não bater, o eixo
-- está ganhando ou perdendo dinheiro — e é exatamente isso que ninguém veria
-- na tela, porque cada grupo parece plausível sozinho.
-- ============================================================
WITH mst AS (
  SELECT DISTINCT rl.linha_orc_id AS m FROM relatorio_linha rl
    JOIN relatorio r ON r.id = rl.relatorio_id
   WHERE r.nome ILIKE '%Gerencial%' AND rl.linha_orc_id IS NOT NULL),
p AS (
  SELECT (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027' LIMIT 1) AS versao,
         (SELECT array_agg(id) FROM empresa) AS emps,
         (SELECT array_agg(m) FROM mst) AS linhas),
velho AS (SELECT sum(valor) AS v, count(*) AS n FROM p,
  LATERAL relatorio_orcado_agg(p.versao, p.emps, ARRAY[2027], ARRAY[1,2,3,4,5,6,7,8,9,10,11,12], p.linhas, NULL, NULL, 1)),
sem_dim AS (SELECT sum(valor) AS v, count(*) AS n FROM p,
  LATERAL relatorio_orcado_agg_dim(p.versao, p.emps, ARRAY[2027], ARRAY[1,2,3,4,5,6,7,8,9,10,11,12], p.linhas, NULL, NULL, 1, NULL, NULL)),
por_emp AS (SELECT sum(valor) AS v, count(*) AS n FROM p,
  LATERAL relatorio_orcado_agg_dim(p.versao, p.emps, ARRAY[2027], ARRAY[1,2,3,4,5,6,7,8,9,10,11,12], p.linhas, NULL, NULL, 1, 'empresa', NULL)),
cruz AS (SELECT sum(valor) AS v, count(*) AS n FROM p,
  LATERAL relatorio_orcado_agg_dim(p.versao, p.emps, ARRAY[2027], ARRAY[1,2,3,4,5,6,7,8,9,10,11,12], p.linhas, NULL, NULL, 1, 'empresa', 'area'))
SELECT 'orçado' AS secao, x.k AS chave, to_char(x.v,'FM999G999G999D00') AS info,
       x.n::text||' linhas'
         ||CASE WHEN abs(x.v - (SELECT v FROM velho)) < 0.005 THEN '   ✅ bate com o agregado antigo'
                ELSE '   ⛔ DIVERGE em '||to_char(x.v - (SELECT v FROM velho),'FM999G999G999D00') END AS det
  FROM (SELECT 'agregado ANTIGO' AS k, v, n FROM velho
        UNION ALL SELECT 'novo · sem dimensão', v, n FROM sem_dim
        UNION ALL SELECT 'novo · por empresa', v, n FROM por_emp
        UNION ALL SELECT 'novo · CRUZADO emp × área', v, n FROM cruz) x
 ORDER BY 2;
