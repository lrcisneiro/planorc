-- ============================================================
-- PLANORC 2.0 — Migration 004
-- Adiciona coluna `tipo` (SINTETICA/ANALITICA) em centro_custo.
--
-- conta_contabil já possui `tipo` e `pai_id`.
-- centro_custo já possui `pai_id`, mas faltava `tipo`.
-- ============================================================

ALTER TABLE centro_custo
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'ANALITICA'
  CHECK (tipo IN ('SINTETICA', 'ANALITICA'));
