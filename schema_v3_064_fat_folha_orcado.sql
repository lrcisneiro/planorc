-- ============================================================
-- F5.2 · Conciliação de folha — orçado POR VERBA (paralelo na fat_folha)
--
-- O fat_orcado guarda o orçado só por ITEM (conta_orcamentaria). Para conciliar
-- também POR VERBA (composição), o Aplicar grava paralelamente na fat_folha as
-- linhas do motor por posto × verba × mês, com tipo='ORCADO' e versao_id. Assim
-- a conciliação lê os dois lados (ORCADO × REALIZADO) no mesmo grão. As linhas de
-- ORCADO são por posto (NÃO rateadas — a conciliação é por posto). Idempotente.
-- ============================================================

ALTER TABLE fat_folha
  ADD COLUMN IF NOT EXISTS tipo      text NOT NULL DEFAULT 'REALIZADO',
  ADD COLUMN IF NOT EXISTS versao_id uuid REFERENCES versao_orcamento ON DELETE CASCADE;

-- tipo ∈ REALIZADO | ORCADO
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'fat_folha'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%tipo%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE fat_folha DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE fat_folha ADD CONSTRAINT fat_folha_tipo_check CHECK (tipo IN ('REALIZADO', 'ORCADO'));
END $$;

-- origem passa a aceitar POSTO (linhas de ORCADO vêm do motor de postos)
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'fat_folha'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%origem%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE fat_folha DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE fat_folha ADD CONSTRAINT fat_folha_origem_check CHECK (origem IN ('FOLHA', 'POSTO'));
END $$;

CREATE INDEX IF NOT EXISTS ix_fat_folha_orcado ON fat_folha (tenant_id, tipo, versao_id, ano, mes);
