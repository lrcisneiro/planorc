-- ============================================================
-- 040 — "Meus Cards": presets de dashboard salvos por tenant.
-- Um card = um dashboard-base (rota) + os filtros aplicados (jsonb).
-- Abrir o card = abrir o dashboard-base já com aquele preset.
-- IDEMPOTENTE.
-- ============================================================
CREATE TABLE IF NOT EXISTS dashboard_card (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  nome       text NOT NULL,
  base       text NOT NULL,              -- rota do dashboard-base (ex.: '/dashboard')
  filtros    jsonb NOT NULL DEFAULT '{}'::jsonb,
  cor        text,
  ordem      int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_card_tenant ON dashboard_card (tenant_id, ordem);

ALTER TABLE dashboard_card ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_card_rls ON dashboard_card;
CREATE POLICY dashboard_card_rls ON dashboard_card
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
