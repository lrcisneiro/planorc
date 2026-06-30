-- ============================================================
-- 048 — Flag "redutora de receita" na linha do relatório
-- Marca linhas (ex.: impostos sobre vendas) que são RECEITA mas
-- REDUZEM a receita. Permite distinguir:
--   Receita Bruta    = receitas, SEM as redutoras
--   Receita Líquida  = receitas, COM as redutoras (= bruta − impostos)
-- A natureza continua RECEITA (correto); o flag só separa bruta/líquida.
-- Vive em relatorio_linha (a estrutura é por relatório). Default false.
-- Idempotente.
-- ============================================================
ALTER TABLE relatorio_linha
  ADD COLUMN IF NOT EXISTS redutora boolean NOT NULL DEFAULT false;
