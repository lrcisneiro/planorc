-- ============================================================
-- v3_050 — Premissa GLOBAL no formulário de drivers
-- Separa o desenho do formulário (genérico) da aplicação por empresa:
--   formulario_valor.empresa_id NULL = premissa global (vale para
--   todas as empresas; a grade da empresa herda e pode sobrescrever).
-- Idempotente.
-- ============================================================

-- 1) empresa_id passa a ser opcional (NULL = global)
ALTER TABLE formulario_valor ALTER COLUMN empresa_id DROP NOT NULL;

-- 2) unique index precisa tratar NULL de empresa (senão NULLs duplicam)
DROP INDEX IF EXISTS uq_formulario_valor;
CREATE UNIQUE INDEX uq_formulario_valor
  ON formulario_valor (versao_id, linha_id,
                       COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       COALESCE(filial_id,  '00000000-0000-0000-0000-000000000000'::uuid),
                       ano, mes, (dims::text));

-- 3) coerência: premissa global não tem filial
ALTER TABLE formulario_valor DROP CONSTRAINT IF EXISTS ck_formulario_valor_global_sem_filial;
ALTER TABLE formulario_valor ADD CONSTRAINT ck_formulario_valor_global_sem_filial
  CHECK (empresa_id IS NOT NULL OR filial_id IS NULL);
