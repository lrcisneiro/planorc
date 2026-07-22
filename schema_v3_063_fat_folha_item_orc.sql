-- ============================================================
-- F5.2 · Conciliação de folha — item orçamentário AUTORITATIVO da folha
--
-- A folha analítica (prgper02) já traz a linha/conta orçamentária do débito na
-- coluna IT_CONTAB_DB (ex.: 20101 "Salarios e Ordenados") — a MESMA codificação
-- que verba.conta_destino usa no orçado. Guardamos isso no fat_folha e usamos
-- direto na conciliação, em vez do reverse-lookup por conta_linha (ambíguo: a
-- mesma conta contábil pode estar amarrada a conta_orcamentaria diferentes por
-- relatório — flexibilidade de estruturas). Idempotente.
-- ============================================================

ALTER TABLE fat_folha
  ADD COLUMN IF NOT EXISTS item_orc_cod  text,                          -- IT_CONTAB_DB da folha (ex.: 20101)
  ADD COLUMN IF NOT EXISTS item_orc_desc text,                          -- descrição do item (auditoria)
  ADD COLUMN IF NOT EXISTS item_orc_id   uuid REFERENCES conta_orcamentaria;  -- resolvido pelo código

CREATE INDEX IF NOT EXISTS ix_fat_folha_item ON fat_folha (tenant_id, item_orc_id, ano, mes);
