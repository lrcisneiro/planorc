-- ============================================================
-- 038 — Flags de VISIBILIDADE por linha (só exibição)
--
-- Diferente de `desativada` (que tira do CÁLCULO): estes flags não afetam
-- totais/fórmulas — a linha continua entrando no EBITDA, somas, etc.
-- Só controlam ONDE a linha aparece:
--   visivel_dashboard = false → some das visões de dashboard (composição,
--                               drill, desvios), mas segue no cálculo.
--   visivel_relatorio = false → some da tabela do relatório (e export),
--                               mas segue no cálculo.
--
-- Caso de uso: impostos s/ resultado e resultado financeiro são necessários
-- p/ o EBITDA no relatório, mas poluem a análise no dashboard.
--
-- IDEMPOTENTE.
-- ============================================================
ALTER TABLE relatorio_linha ADD COLUMN IF NOT EXISTS visivel_dashboard boolean NOT NULL DEFAULT true;
ALTER TABLE relatorio_linha ADD COLUMN IF NOT EXISTS visivel_relatorio boolean NOT NULL DEFAULT true;
