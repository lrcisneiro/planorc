-- ============================================================
-- VERIFICAÇÃO (rodar ANTES da F1/F2). Não altera nada — só SELECTs.
-- Objetivo: achar o único risco da migração por código —
-- o MESMO código com lançamentos de orçado em RELATÓRIOS DIFERENTES.
-- Se a 1ª consulta vier vazia, o repontamento (F2) é seguro.
-- ============================================================

-- 1) Códigos com fat_orcado em mais de um relatório (RISCO p/ F2)
SELECT rl.codigo,
       count(DISTINCT r.id)        AS relatorios_com_dado,
       array_agg(DISTINCT r.codigo) AS relatorios,
       sum(f.c)                     AS total_lancamentos
FROM relatorio_linha rl
JOIN relatorio r ON r.id = rl.relatorio_id
JOIN (SELECT linha_id, count(*) c FROM fat_orcado GROUP BY linha_id) f
     ON f.linha_id = rl.id
GROUP BY rl.codigo
HAVING count(DISTINCT r.id) > 1
ORDER BY rl.codigo;

-- 2) (Informativo) Mesmo código com descrição/tipo divergente entre relatórios
SELECT rl.codigo,
       count(DISTINCT rl.descricao)  AS n_descricoes,
       count(DISTINCT rl.tipo_linha) AS n_tipos,
       array_agg(DISTINCT rl.descricao) AS descricoes
FROM relatorio_linha rl
GROUP BY rl.codigo
HAVING count(DISTINCT rl.descricao) > 1 OR count(DISTINCT rl.tipo_linha) > 1
ORDER BY rl.codigo;

-- 3) Panorama geral
SELECT
  (SELECT count(*) FROM relatorio)                          AS relatorios,
  (SELECT count(*) FROM relatorio_linha)                    AS linhas_total,
  (SELECT count(DISTINCT codigo) FROM relatorio_linha)      AS codigos_distintos,
  (SELECT count(*) FROM fat_orcado)                         AS lancamentos_orcado;
