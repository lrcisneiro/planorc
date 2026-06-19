-- ============================================================
-- MIGRATION 009 — Grupo Empresarial
--
-- Agrupa múltiplas empresas para filtros e visualizações.
-- O grupo é um atributo da empresa (não do lançamento).
-- Hierarquia: Grupo → Empresa → Filial
-- ============================================================

-- 1. Tabela de grupos
CREATE TABLE IF NOT EXISTS grupo_empresarial (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo     text NOT NULL,
  descricao  text NOT NULL,
  UNIQUE (tenant_id, codigo)
);

-- 2. Trigger auto tenant_id
CREATE TRIGGER trg_auto_tenant_grupo_empresarial
  BEFORE INSERT ON grupo_empresarial
  FOR EACH ROW EXECUTE FUNCTION _auto_set_tenant_id();

-- 3. Índice
CREATE INDEX IF NOT EXISTS idx_grupo_empresarial_tenant ON grupo_empresarial(tenant_id);

-- 4. RLS
ALTER TABLE grupo_empresarial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON grupo_empresarial
  FOR ALL
  USING     (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- 5. Adiciona grupo_id em empresa (nullable — empresa pode não ter grupo)
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES grupo_empresarial(id);
CREATE INDEX IF NOT EXISTS idx_empresa_grupo ON empresa(grupo_id);
