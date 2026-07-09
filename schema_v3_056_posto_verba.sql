-- ============================================================
-- F5 · Posto de Trabalho — valores de verba POR POSTO
--
-- Benefícios (VALOR_FIXO: VA/VR, ass. médica, multibenefício, VT, seguro) e
-- variável NÃO são uniformes: cada pessoa tem seu conjunto e seu valor. O
-- catálogo (verba_folha) fica com as REGRAS globais (encargos %, provisões
-- fator); os valores por pessoa vivem aqui. Sem linha = a pessoa não tem
-- aquela verba. Populado da folha (código da verba = CD_VERBA do ERP).
--
-- O motor: encargos/provisões calculados sobre a base (global); VALOR_FIXO
-- (e variável) vêm de posto_verba. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS posto_verba (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  posto_id   uuid NOT NULL REFERENCES posto ON DELETE CASCADE,
  verba_id   uuid NOT NULL REFERENCES verba_folha ON DELETE CASCADE,
  valor      numeric(14,2) NOT NULL DEFAULT 0,   -- valor mensal desta verba p/ este posto
  ativo      boolean NOT NULL DEFAULT true,
  UNIQUE (posto_id, verba_id)
);
CREATE INDEX IF NOT EXISTS ix_posto_verba_posto ON posto_verba (posto_id);

ALTER TABLE posto_verba ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posto_verba_rls" ON posto_verba;
CREATE POLICY "posto_verba_rls" ON posto_verba FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
