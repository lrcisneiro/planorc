-- ============================================================
-- MIGRATION v3_044 — Dono (owner) nos presets · dashboard_card
-- ============================================================
-- Objetivo: presets pessoais vs compartilhados.
--   owner_id IS NULL  -> preset COMPARTILHADO (criado por admin; aparece p/ todos do tenant)
--   owner_id = <uuid> -> preset PESSOAL (só aparece para aquele usuário)
--
-- dashboard_card já é genérica (o campo `base` é a rota), então esta ÚNICA
-- coluna serve aos dois hubs:
--   • Dashboards  -> base '/dashboard', '/dashboards/anual', ...
--   • Relatórios  -> base '/relatorios/<id>'   (presets "Meus Relatórios")
--
-- Convenções já existentes no schema usadas aqui:
--   current_tenant_id()  -> tenant do usuário logado (mesma fn da policy original)
--   auth.uid()           -> usuário logado (Supabase)
--   user_tenant.role     -> 'admin' | 'member' | 'viewer'
--
-- Comportamento esperado no app:
--   • "Salvar como" pessoal   -> INSERT com owner_id = auth.uid()
--   • Card compartilhado (admin) -> INSERT com owner_id = NULL
--
-- Backfill: cards já existentes ficam com owner_id NULL = compartilhados
-- (continuam visíveis para todos — comportamento atual preservado).
--
-- Idempotente.
-- ============================================================

-- 1) Coluna de dono
ALTER TABLE dashboard_card
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_dashboard_card_owner
  ON dashboard_card (tenant_id, owner_id);


-- 2) RLS — troca a policy única por leitura × escrita
ALTER TABLE dashboard_card ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dashboard_card_rls ON dashboard_card;   -- policy original (040)
DROP POLICY IF EXISTS dashboard_card_sel ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_ins ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_upd ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_del ON dashboard_card;

-- LER: vê os compartilhados (NULL) + os seus
CREATE POLICY dashboard_card_sel ON dashboard_card FOR SELECT
  USING (
    tenant_id = current_tenant_id()
    AND (owner_id IS NULL OR owner_id = auth.uid())
  );

-- CRIAR: pessoal (owner = você) qualquer um; compartilhado (owner NULL) só admin
CREATE POLICY dashboard_card_ins ON dashboard_card FOR INSERT
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      owner_id = auth.uid()
      OR (owner_id IS NULL AND (
            SELECT role FROM user_tenant
            WHERE user_id = auth.uid() AND tenant_id = current_tenant_id()
          ) = 'admin')
    )
  );

-- ALTERAR: dono edita os seus; admin edita os compartilhados
CREATE POLICY dashboard_card_upd ON dashboard_card FOR UPDATE
  USING (
    tenant_id = current_tenant_id()
    AND (
      owner_id = auth.uid()
      OR (owner_id IS NULL AND (
            SELECT role FROM user_tenant
            WHERE user_id = auth.uid() AND tenant_id = current_tenant_id()
          ) = 'admin')
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      owner_id = auth.uid()
      OR (owner_id IS NULL AND (
            SELECT role FROM user_tenant
            WHERE user_id = auth.uid() AND tenant_id = current_tenant_id()
          ) = 'admin')
    )
  );

-- EXCLUIR: idem
CREATE POLICY dashboard_card_del ON dashboard_card FOR DELETE
  USING (
    tenant_id = current_tenant_id()
    AND (
      owner_id = auth.uid()
      OR (owner_id IS NULL AND (
            SELECT role FROM user_tenant
            WHERE user_id = auth.uid() AND tenant_id = current_tenant_id()
          ) = 'admin')
    )
  );

-- ============================================================
-- Notas para o app (frontend)
-- ------------------------------------------------------------
--  • Listagem (hub): a RLS já filtra — basta SELECT * FROM dashboard_card.
--    O usuário recebe compartilhados + os seus, automaticamente.
--  • Para distinguir na UI (badge "Compartilhado" vs "Meu"), use
--    (owner_id IS NULL) ou compare com o id do usuário logado.
--  • Salvar pessoal:   insert({ ..., owner_id: user.id })
--  • Salvar compartilhado (só admin): insert({ ..., owner_id: null })
-- ============================================================
