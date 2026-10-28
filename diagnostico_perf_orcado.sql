-- ============================================================
-- Por que relatorio_orcado_agg leva 0,8–1,8s com "pouco dado"?
-- Uma consulta só (o SQL Editor mostra apenas a última) e responde por SELECT.
-- Roda como postgres → ignora RLS, por isso NÃO filtra tenant.
-- ============================================================
WITH tot AS (
  SELECT count(*) n, pg_size_pretty(pg_total_relation_size('fat_orcado')) tam FROM fat_orcado
),
porv AS (
  SELECT v.codigo, fo.ano, count(*) n,
         count(*) FILTER (WHERE fo.dims ? 'funcionario') n_func,
         count(*) FILTER (WHERE fo.expressao IS NOT NULL) n_expr,
         count(DISTINCT fo.linha_id) n_linhas
  FROM fat_orcado fo LEFT JOIN versao_orcamento v ON v.id = fo.versao_id
  GROUP BY 1,2
),
idx AS (
  SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) tam
  FROM pg_stat_user_indexes WHERE relname = 'fat_orcado'
),
vac AS (
  SELECT last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, n_dead_tup, n_live_tup
  FROM pg_stat_user_tables WHERE relname = 'fat_orcado'
)
SELECT '1 · tamanho'  secao, tam           a, n::text        b, ''           c, ''              d, ''                e FROM tot
UNION ALL
SELECT '2 · por versão/ano', coalesce(codigo,'(sem versão)') || ' / ' || coalesce(ano::text,'?'),
       n::text, 'func=' || n_func, 'expr=' || n_expr, 'linhas=' || n_linhas FROM porv
UNION ALL
SELECT '3 · índices', indexrelname, tam, 'scans=' || idx_scan, '', '' FROM idx
UNION ALL
SELECT '4 · vacuum', 'vivas=' || n_live_tup, 'mortas=' || n_dead_tup,
       'vacuum=' || coalesce(greatest(last_vacuum, last_autovacuum)::text, 'NUNCA'),
       'analyze=' || coalesce(greatest(last_analyze, last_autoanalyze)::text, 'NUNCA'), '' FROM vac
ORDER BY 1, 2;
