-- ============================================================
-- MIGRATION 008 — Inclui dim_values no constraint de unicidade
--
-- Problema: o constraint anterior não incluía dim_values, então
-- dois lançamentos com dimensões diferentes (ex: funcionário A e B
-- no mesmo item/empresa/mes/tipo) eram tratados como duplicatas.
--
-- Solução: coluna gerada dim_hash = md5(dim_values::text).
-- PostgreSQL normaliza JSONB antes de serializar (chaves ordenadas),
-- garantindo hash determinístico independente da ordem de inserção.
--
-- Resultado: múltiplas linhas com dim_values distintos coexistem;
-- a mesma combinação exata de dimensões ainda gera conflito (upsert).
-- ============================================================

-- 1. Coluna gerada: hash determinístico de dim_values
ALTER TABLE fat_lancamento
  ADD COLUMN IF NOT EXISTS dim_hash text
  GENERATED ALWAYS AS (md5(dim_values::text)) STORED;

-- 2. Remove constraint antigo (apenas colunas estruturais, sem dim_values)
ALTER TABLE fat_lancamento DROP CONSTRAINT IF EXISTS fat_lancamento_unique;

-- 3. Novo constraint incluindo dim_hash
--    NULLS NOT DISTINCT cobre filial_id = NULL
ALTER TABLE fat_lancamento ADD CONSTRAINT fat_lancamento_unique
  UNIQUE NULLS NOT DISTINCT (
    tenant_id, versao_id, item_orc_id, empresa_id,
    filial_id, ano, mes, tipo_lancamento, dim_hash
  );

-- 4. Índice auxiliar para queries filtradas por dim_hash
CREATE INDEX IF NOT EXISTS idx_fat_lancamento_dim_hash ON fat_lancamento(dim_hash);
