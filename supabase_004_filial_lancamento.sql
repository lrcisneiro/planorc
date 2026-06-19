-- ============================================================
-- MIGRATION 004 - Adiciona filial_id em fat_lancamento
-- Execute no Supabase SQL Editor
-- ============================================================

-- 1. Adiciona coluna filial_id (nullable — existente sem filial fica como NULL)
ALTER TABLE fat_lancamento ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES filial(id);

-- 2. Remove o constraint de unicidade antigo (nome gerado automaticamente)
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'fat_lancamento'::regclass AND contype = 'u'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE fat_lancamento DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- 3. Recria constraint incluindo filial_id
-- NULLS NOT DISTINCT trata NULL = NULL, garantindo unicidade mesmo com filial_id nulo
ALTER TABLE fat_lancamento
  ADD CONSTRAINT fat_lancamento_unique
  UNIQUE NULLS NOT DISTINCT (versao_id, item_orc_id, empresa_id, filial_id, ano, mes, tipo_lancamento);
