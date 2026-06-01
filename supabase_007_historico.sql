-- ============================================================
-- MIGRATION 007 — Campo histórico em fat_lancamento
--
-- Texto livre por lançamento, usado em filtros e drill-down.
-- ============================================================

ALTER TABLE fat_lancamento ADD COLUMN IF NOT EXISTS historico text;
