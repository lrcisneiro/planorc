-- ============================================================
-- Multimoeda — passo 1 (schema). Design: docs/ESTUDO_multimoeda.md.
--
-- Modelo MATERIALIZADO por SLOTS de moeda (M1=BRL base, M2=USD, M3 livre):
--   cada fato guarda `moeda_origem` (slot digitado/importado, intocável) e os
--   valores já convertidos por slot. `valor` EXISTENTE = val_m1 (slot 1 = base),
--   então tudo que soma `valor` hoje segue mostrando a BASE sem mudança
--   (retrocompat). Adiciona-se só `moeda_origem` + `val_m2`/`val_m3`.
--
-- Câmbio DIÁRIO (tabela `cambio`) com carry-forward → realizado. Taxa ORÇADA por
-- versão (`versao_taxa`) → orçado. A materialização (conversão na escrita) e a
-- rotina "recalcular" são passos seguintes (app), não esta migration.
-- Idempotente.
-- ============================================================

-- ---- catálogo de moedas (slots configuráveis por tenant) ----
CREATE TABLE IF NOT EXISTS moeda (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  slot           int  NOT NULL,                 -- 1 = base/reporting (nunca converte)
  codigo         text NOT NULL,                 -- 'BRL', 'USD'
  nome           text NOT NULL,
  simbolo        text,
  casas_decimais int  NOT NULL DEFAULT 2,
  ativo          boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, slot),
  UNIQUE (tenant_id, codigo)
);
ALTER TABLE moeda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "moeda_rls" ON moeda;
CREATE POLICY "moeda_rls" ON moeda FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ---- cotação REAL por DIA vs base (slot 1). taxa = unidades da BASE por 1 unid. do slot ----
CREATE TABLE IF NOT EXISTS cambio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  moeda_slot int  NOT NULL,                      -- slot cotado (ex.: 2 = USD)
  data       date NOT NULL,
  taxa       numeric(18,8) NOT NULL,             -- ex.: 5.20 = 5,20 BRL por 1 USD
  UNIQUE (tenant_id, moeda_slot, data)
);
CREATE INDEX IF NOT EXISTS ix_cambio_slot_data ON cambio (tenant_id, moeda_slot, data);
ALTER TABLE cambio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cambio_rls" ON cambio;
CREATE POLICY "cambio_rls" ON cambio FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ---- taxa ORÇADA por versão (premissa do cenário). (ano,mes) NULL = constante ----
CREATE TABLE IF NOT EXISTS versao_taxa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  versao_id  uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  moeda_slot int  NOT NULL,
  ano        int,
  mes        int CHECK (mes BETWEEN 1 AND 12),
  taxa       numeric(18,8) NOT NULL,
  UNIQUE NULLS NOT DISTINCT (tenant_id, versao_id, moeda_slot, ano, mes)
);
ALTER TABLE versao_taxa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "versao_taxa_rls" ON versao_taxa;
CREATE POLICY "versao_taxa_rls" ON versao_taxa FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ---- moeda funcional/default da empresa (slot) ----
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS moeda_slot int NOT NULL DEFAULT 1;

-- ---- fatos: slot de origem + valores convertidos (val_m1 = valor existente = base) ----
ALTER TABLE fat_orcado
  ADD COLUMN IF NOT EXISTS moeda_origem int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS val_m2 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m3 numeric(18,2);
ALTER TABLE fat_realizado
  ADD COLUMN IF NOT EXISTS moeda_origem int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS val_m2 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m3 numeric(18,2);
ALTER TABLE fat_saldo
  ADD COLUMN IF NOT EXISTS moeda_origem int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS val_m2 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m3 numeric(18,2);
ALTER TABLE fat_folha
  ADD COLUMN IF NOT EXISTS moeda_origem int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS val_m2 numeric(18,2),
  ADD COLUMN IF NOT EXISTS val_m3 numeric(18,2);

-- ---- seed BRL (slot 1) + USD (slot 2) para os tenants existentes ----
INSERT INTO moeda (tenant_id, slot, codigo, nome, simbolo)
  SELECT id, 1, 'BRL', 'Real', 'R$' FROM tenant
  ON CONFLICT (tenant_id, slot) DO NOTHING;
INSERT INTO moeda (tenant_id, slot, codigo, nome, simbolo)
  SELECT id, 2, 'USD', 'Dólar', 'US$' FROM tenant
  ON CONFLICT (tenant_id, slot) DO NOTHING;
