-- ============================================================
-- PLANORC 2.0 — Migration 003
-- filial_id e cc_id nullable em fat_orcado e fat_realizado
--
-- Motivo: lançamentos consolidados no nível do template DRE
-- não têm filial/CC específicos. Detalhamentos por filial/CC
-- entram via Formulários filhos.
-- ============================================================

ALTER TABLE fat_orcado ALTER COLUMN filial_id DROP NOT NULL;
ALTER TABLE fat_orcado ALTER COLUMN cc_id DROP NOT NULL;

ALTER TABLE fat_realizado ALTER COLUMN filial_id DROP NOT NULL;
ALTER TABLE fat_realizado ALTER COLUMN cc_id DROP NOT NULL;
