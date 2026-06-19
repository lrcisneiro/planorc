-- ============================================================
-- Multi-ERP: plano de contas por ERP.
-- conta_contabil passa a pertencer a um plano; empresa aponta para
-- um plano. Resolve colisão de códigos entre ERPs diferentes.
-- Backfill seguro: cria 1 plano padrão e move contas/empresas atuais
-- para ele (NÃO reponta fat_* nem conta_linha — conta_id continua igual).
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS plano_contas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo     text NOT NULL,
  nome       text NOT NULL,
  UNIQUE (tenant_id, codigo)
);
ALTER TABLE plano_contas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plano_contas_rls" ON plano_contas;
CREATE POLICY "plano_contas_rls" ON plano_contas FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE conta_contabil ADD COLUMN IF NOT EXISTS plano_id uuid REFERENCES plano_contas ON DELETE CASCADE;
ALTER TABLE empresa        ADD COLUMN IF NOT EXISTS plano_id uuid REFERENCES plano_contas ON DELETE SET NULL;

-- Plano padrão (1 por tenant) com as contas/empresas existentes
INSERT INTO plano_contas (tenant_id, codigo, nome)
SELECT DISTINCT tenant_id, 'PADRAO', 'Plano padrão (atual)' FROM empresa
ON CONFLICT (tenant_id, codigo) DO NOTHING;

UPDATE conta_contabil c SET plano_id = p.id
FROM plano_contas p WHERE p.tenant_id = c.tenant_id AND p.codigo = 'PADRAO' AND c.plano_id IS NULL;
UPDATE empresa e SET plano_id = p.id
FROM plano_contas p WHERE p.tenant_id = e.tenant_id AND p.codigo = 'PADRAO' AND e.plano_id IS NULL;

-- Unicidade da conta passa a ser por plano (resolve colisão entre ERPs)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'conta_contabil'::regclass AND contype = 'u'
  LOOP EXECUTE format('ALTER TABLE conta_contabil DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;
ALTER TABLE conta_contabil
  ADD CONSTRAINT conta_contabil_plano_codigo_key UNIQUE (tenant_id, plano_id, codigo);

CREATE INDEX IF NOT EXISTS idx_conta_contabil_plano ON conta_contabil (plano_id);
CREATE INDEX IF NOT EXISTS idx_empresa_plano ON empresa (plano_id);

COMMIT;
