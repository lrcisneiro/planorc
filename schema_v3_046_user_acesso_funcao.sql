-- ============================================================
-- F2 — Override de capacidade por usuário (user_acesso_funcao)
-- Libera/nega uma capacidade (função ou item de menu) para um
-- usuário específico, sobrepondo o padrão do papel.
--   ausência de linha = herda o padrão do papel (lib/capacidades.ts)
--   permitido = true  → libera
--   permitido = false → nega
-- Espelha o padrão de user_acesso_regra (tenant via trigger + RLS).
-- Idempotente (pode rodar de novo).
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS user_acesso_funcao (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid    NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capacidade text    NOT NULL,        -- chave do catálogo: 'orcar','estrutura','menu.xxx'
  permitido  boolean NOT NULL,        -- true = libera, false = nega
  UNIQUE (tenant_id, user_id, capacidade)
);

-- Trigger: preenche tenant_id automaticamente (mesmo de user_acesso_regra)
DROP TRIGGER IF EXISTS trg_auto_tenant_user_acesso_funcao ON user_acesso_funcao;
CREATE TRIGGER trg_auto_tenant_user_acesso_funcao
  BEFORE INSERT ON user_acesso_funcao
  FOR EACH ROW EXECUTE FUNCTION _auto_set_tenant_id();

CREATE INDEX IF NOT EXISTS idx_user_funcao_user   ON user_acesso_funcao(user_id);
CREATE INDEX IF NOT EXISTS idx_user_funcao_tenant ON user_acesso_funcao(tenant_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE user_acesso_funcao ENABLE ROW LEVEL SECURITY;

-- Usuário comum: lê apenas os próprios overrides (alimenta o useCapacidades)
DROP POLICY IF EXISTS "read own funcao" ON user_acesso_funcao;
CREATE POLICY "read own funcao" ON user_acesso_funcao
  FOR SELECT
  USING (user_id = auth.uid() AND tenant_id = get_my_tenant_id());

-- Admin: gerencia os overrides de qualquer usuário do tenant
DROP POLICY IF EXISTS "admin manage funcao" ON user_acesso_funcao;
CREATE POLICY "admin manage funcao" ON user_acesso_funcao
  FOR ALL
  USING (
    tenant_id = get_my_tenant_id() AND
    (SELECT role FROM user_tenant
     WHERE user_id = auth.uid() AND tenant_id = get_my_tenant_id()) = 'admin'
  )
  WITH CHECK (
    tenant_id = get_my_tenant_id() AND
    (SELECT role FROM user_tenant
     WHERE user_id = auth.uid() AND tenant_id = get_my_tenant_id()) = 'admin'
  );

COMMIT;
