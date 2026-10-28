-- ============================================================
-- Recupera o espaço do uq_fat_orcado: 83 MB onde o conteúdo pede ~24 MB.
-- É bloat do padrão delete+insert do Aplicar (2,08 milhões de scans nesse
-- índice); o VACUUM não encolhe índice, só o REINDEX.
--
-- NÃO altera dado nenhum — reconstrói a estrutura do índice.
-- A performance do relatório já está resolvida pela v3_123, que não usa mais
-- este índice no agregado; o que se ganha aqui é disco e velocidade de ESCRITA
-- (todo INSERT do Aplicar mantém este índice).
--
-- Trava escrita em fat_orcado por alguns segundos. Rodar fora de um Aplicar.
-- ============================================================
REINDEX INDEX uq_fat_orcado;

SELECT 'uq_fat_orcado' AS indice, pg_size_pretty(pg_relation_size('uq_fat_orcado')) AS depois;
