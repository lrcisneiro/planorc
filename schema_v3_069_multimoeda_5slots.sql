-- ============================================================
-- Multimoeda — amplia para 5 SLOTS de moeda (val_m1..val_m5).
-- Design: docs/ESTUDO_multimoeda.md. Complementa a v3_068 (que criou val_m2/m3).
--
-- val_m1 = `valor` (slot 1 = base/BRL). Esta migration adiciona val_m4 e val_m5,
-- fechando 5 moedas materializadas por fato. As RPCs de agregação passam a somar
-- a coluna do slot pedido (p_slot) — feito em migration própria (ver v3_070).
-- ============================================================
ALTER TABLE fat_orcado
  ADD COLUMN IF NOT EXISTS val_m4 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m5 numeric(18,2);
ALTER TABLE fat_realizado
  ADD COLUMN IF NOT EXISTS val_m4 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m5 numeric(18,2);
ALTER TABLE fat_saldo
  ADD COLUMN IF NOT EXISTS val_m4 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m5 numeric(18,2);
ALTER TABLE fat_folha
  ADD COLUMN IF NOT EXISTS val_m4 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m5 numeric(18,2);
