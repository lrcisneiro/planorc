-- ============================================================
-- Backfill: país = 'BR' onde ainda não informado (empresa E verba_folha).
-- Só toca linhas com pais NULL ou vazio — as já preenchidas (PY/BO/…) são
-- preservadas. As verbas/empresas atuais são todas brasileiras. Idempotente
-- (re-rodar não muda nada). Ver schema_v3_074.
-- ============================================================
UPDATE empresa      SET pais = 'BR' WHERE pais IS NULL OR pais = '';
UPDATE verba_folha  SET pais = 'BR' WHERE pais IS NULL OR pais = '';
