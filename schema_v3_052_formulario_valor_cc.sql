-- ============================================================
-- v3_052 — Centro de custo no lançamento do formulário (formulario_valor)
-- CC existe só no DADO (Preencher), não na estrutura genérica do formulário.
-- Regra: lançar/Aplicar exige empresa + filial + CC. A premissa GLOBAL
-- (empresa_id NULL) não carrega filial nem CC.
-- Idempotente.
-- ============================================================

-- 1) coluna cc_id
ALTER TABLE formulario_valor ADD COLUMN IF NOT EXISTS cc_id uuid REFERENCES centro_custo;

-- 2) unique index precisa considerar cc_id (senão colapsa filial×CC no mesmo grão)
DROP INDEX IF EXISTS uq_formulario_valor;
CREATE UNIQUE INDEX uq_formulario_valor
  ON formulario_valor (versao_id, linha_id,
                       COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       COALESCE(filial_id,  '00000000-0000-0000-0000-000000000000'::uuid),
                       COALESCE(cc_id,      '00000000-0000-0000-0000-000000000000'::uuid),
                       ano, mes, (dims::text));

-- 3) premissa global (empresa NULL) não tem filial nem CC
ALTER TABLE formulario_valor DROP CONSTRAINT IF EXISTS ck_formulario_valor_global_sem_filial;
ALTER TABLE formulario_valor DROP CONSTRAINT IF EXISTS ck_formulario_valor_global_sem_dims;
ALTER TABLE formulario_valor ADD CONSTRAINT ck_formulario_valor_global_sem_dims
  CHECK (empresa_id IS NOT NULL OR (filial_id IS NULL AND cc_id IS NULL));

-- 4) lookup por CC
CREATE INDEX IF NOT EXISTS ix_formulario_valor_cc ON formulario_valor (cc_id);
