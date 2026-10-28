-- ============================================================
-- Onde estão os 136 MB de fat_orcado — heap, índices e toast separados.
-- CORREÇÃO de leitura: pg_total_relation_size INCLUI os índices; dividir esse
-- número pela contagem de linhas dá "bytes por linha" inflado e sem sentido.
--
-- O `dims` foi medido e NÃO é o problema: 11,2 MB somando as quatro versões,
-- com o `historico` em média de 51 bytes.
-- Só leitura. Uma consulta só.
-- ============================================================
WITH l AS (SELECT count(*)::numeric n FROM fat_orcado),
heap AS (
  SELECT pg_table_size('fat_orcado') - coalesce(pg_relation_size(reltoastrelid), 0) b
  FROM pg_class WHERE oid = 'fat_orcado'::regclass
),
toast AS (
  SELECT coalesce(pg_relation_size(reltoastrelid), 0) b
  FROM pg_class WHERE oid = 'fat_orcado'::regclass
),
idx AS (
  SELECT indexrelname nome, pg_relation_size(indexrelid) b,
         pg_relation_size(indexrelid) / (SELECT n FROM l) por_linha
  FROM pg_stat_user_indexes WHERE relname = 'fat_orcado'
)
SELECT '1 · heap (só as linhas)' secao, pg_size_pretty(b) tam,
       round(b / (SELECT n FROM l)) || ' bytes/linha' detalhe FROM heap
UNION ALL
SELECT '2 · toast', pg_size_pretty(b), '' FROM toast
UNION ALL
SELECT '3 · índice · ' || nome, pg_size_pretty(b), round(por_linha) || ' bytes/entrada' FROM idx
UNION ALL
SELECT '4 · soma dos índices', pg_size_pretty(sum(b)), '' FROM idx
ORDER BY 1;
