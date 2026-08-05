-- ============================================================
-- Folha F5 — libera posto.regime (remove o CHECK CLT/PRESTADOR/PROLABORE).
--
-- O v3_058 removeu o CHECK de regime só na verba_folha; o posto continuou preso
-- a ('CLT','PRESTADOR','PROLABORE'), então novos regimes (IPS, CONTRATO — folha
-- Paraguai, ver v3_076) são rejeitados ao editar o posto:
--   ERROR: new row for relation "posto" violates check constraint "posto_regime_check"
--
-- Regime passa a ser texto livre (a UI oferece as opções válidas). Idempotente.
-- ============================================================
ALTER TABLE posto DROP CONSTRAINT IF EXISTS posto_regime_check;

-- defensivo: se o CHECK tiver outro nome, localiza e remove (mesmo padrão da v3_058)
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'posto'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%regime%'
     AND pg_get_constraintdef(oid) ILIKE '%CLT%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE posto DROP CONSTRAINT %I', cname); END IF;
END $$;
