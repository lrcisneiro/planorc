-- ============================================================
-- F5 · Posto de Trabalho — PCT_VERBA sobre MÚLTIPLAS verbas
--
-- O tipo PCT_VERBA (% sobre outra verba) só referenciava UMA verba
-- (verba_ref_id). Mas há encargos que incidem sobre a soma de várias
-- (ex.: FGTS sobre 13º + férias). Agora `verba_ref` guarda uma LISTA de
-- CÓDIGOS separada por vírgula (ex.: '13SAL,FER'); o motor soma os valores
-- dessas verbas e aplica o %. verba_ref_id fica vestigial.
-- Idempotente.
-- ============================================================

ALTER TABLE verba_folha ADD COLUMN IF NOT EXISTS verba_ref text;

-- migra o FK único existente para o código correspondente (lista de 1)
UPDATE verba_folha v
SET verba_ref = r.codigo
FROM verba_folha r
WHERE v.verba_ref_id = r.id AND (v.verba_ref IS NULL OR v.verba_ref = '');
