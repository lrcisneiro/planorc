-- ============================================================
-- MIGRATION 006 — Controle de acesso por usuário
--
-- Permite restringir quais empresas, filiais e dimensões
-- cada usuário pode visualizar dentro do tenant.
-- Vazio (valor_ids = {}) = sem restrição (acesso total).
-- ============================================================

-- ── 1. TABELA DE REGRAS DE ACESSO ────────────────────────
CREATE TABLE IF NOT EXISTS user_acesso_regra (
  id         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid  NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id    uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dimensao   text  NOT NULL,        -- 'empresa' | 'filial' | dimensao.codigo
  valor_ids  uuid[] NOT NULL DEFAULT '{}',  -- vazio = acesso a tudo
  UNIQUE (tenant_id, user_id, dimensao)
);

-- Trigger: preenche tenant_id automaticamente
CREATE TRIGGER trg_auto_tenant_user_acesso_regra
  BEFORE INSERT ON user_acesso_regra
  FOR EACH ROW EXECUTE FUNCTION _auto_set_tenant_id();

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_acesso_user   ON user_acesso_regra(user_id);
CREATE INDEX IF NOT EXISTS idx_user_acesso_tenant ON user_acesso_regra(tenant_id);

-- ── 2. RLS ────────────────────────────────────────────────
ALTER TABLE user_acesso_regra ENABLE ROW LEVEL SECURITY;

-- Usuário comum: lê apenas suas próprias regras
CREATE POLICY "read own rules" ON user_acesso_regra
  FOR SELECT
  USING (user_id = auth.uid() AND tenant_id = get_my_tenant_id());

-- Admin: gerencia todas as regras do tenant
CREATE POLICY "admin manage rules" ON user_acesso_regra
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

-- ── 3. FUNÇÃO: lista usuários do tenant (somente admins) ──
CREATE OR REPLACE FUNCTION get_tenant_users()
RETURNS TABLE(user_id uuid, email text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT ut.role FROM user_tenant ut
      WHERE ut.user_id = auth.uid()
        AND ut.tenant_id = get_my_tenant_id()) <> 'admin' THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores';
  END IF;

  RETURN QUERY
  SELECT ut.user_id, u.email::text, ut.role
  FROM user_tenant ut
  JOIN auth.users u ON u.id = ut.user_id
  WHERE ut.tenant_id = get_my_tenant_id()
  ORDER BY u.email;
END;
$$;
