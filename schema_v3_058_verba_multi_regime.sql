-- ============================================================
-- F5 · Posto de Trabalho — verba com MÚLTIPLOS regimes de incidência
--
-- Encargos (INSS, FGTS…) incidem igual em CLT e PRÓ-LABORE, mas não em
-- prestador. Com regime único era preciso duplicar a verba. Agora o campo
-- `regime` guarda uma LISTA separada por vírgula (ex.: 'CLT,PROLABORE');
-- vazio/NULL = vale para todos os regimes. O motor faz o split.
--
-- Aqui só removemos o CHECK antigo (que só aceitava um valor). Os dados
-- existentes ('CLT'/'PRESTADOR'/'PROLABORE') seguem válidos como lista de 1.
-- Idempotente.
-- ============================================================

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'verba_folha'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%regime%'
     AND pg_get_constraintdef(oid) ILIKE '%CLT%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE verba_folha DROP CONSTRAINT %I', cname);
  END IF;
END $$;
