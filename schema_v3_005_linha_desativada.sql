-- ============================================================
-- Linha desativada: valor exibido (tachado) mas fora da somatória
-- ============================================================
ALTER TABLE relatorio_linha
  ADD COLUMN IF NOT EXISTS desativada boolean NOT NULL DEFAULT false;
