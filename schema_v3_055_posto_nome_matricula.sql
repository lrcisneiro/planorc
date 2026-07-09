-- ============================================================
-- F5 · Posto de Trabalho — P1 step 3: nome/matrícula no posto
--
-- A matrícula do ERP NÃO é única no grupo (a mesma matrícula aparece em
-- filiais/empresas diferentes para pessoas diferentes), então não dá para
-- linkar `funcionario` (UNIQUE(tenant,matricula)) direto. Guardamos nome e
-- matrícula no próprio posto para exibição e conciliação com a folha
-- (fat_folha, P2); funcionario_id fica nulo por ora (link futuro).
-- Idempotente. Ref.: docs/DESIGN_posto_trabalho.md
-- ============================================================

ALTER TABLE posto
  ADD COLUMN IF NOT EXISTS nome      text,
  ADD COLUMN IF NOT EXISTS matricula text;

CREATE INDEX IF NOT EXISTS ix_posto_matricula ON posto (tenant_id, filial_id, matricula);
