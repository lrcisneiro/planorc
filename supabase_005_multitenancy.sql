-- ============================================================
-- MIGRATION 005 — Multi-tenancy: tenant_id + RLS real
--
-- O que faz:
--   1. Cria tabelas tenant e user_tenant
--   2. Cria função get_my_tenant_id() + trigger _auto_set_tenant_id
--   3. Adiciona tenant_id em todas as tabelas de dados
--   4. Migra dados existentes para um tenant padrão
--   5. Atualiza constraints de unicidade para serem compostas por tenant
--   6. Cria índices em tenant_id
--   7. Substitui políticas "dev_all" abertas por isolamento real por tenant
--
-- Execute no Supabase SQL Editor
-- ============================================================

-- ── 1. TABELA DE TENANTS (clientes do produto) ────────────
CREATE TABLE IF NOT EXISTS tenant (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  ativo      bool        NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. VÍNCULO USUÁRIO ↔ TENANT ──────────────────────────
CREATE TABLE IF NOT EXISTS user_tenant (
  user_id    uuid NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenant(id)       ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',   -- 'admin' | 'member' | 'viewer'
  PRIMARY KEY (user_id, tenant_id)
);

-- ── 3. FUNÇÃO HELPER: retorna tenant do usuário atual ─────
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM user_tenant WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ── 4. TRIGGER: preenche tenant_id automaticamente ───────
--    Garante que um INSERT sem tenant_id explícito use o do usuário logado.
CREATE OR REPLACE FUNCTION _auto_set_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := get_my_tenant_id();
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. TENANT PADRÃO para migrar dados existentes ─────────
INSERT INTO tenant (id, nome, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'TOTVS Oeste', 'toeste')
ON CONFLICT (slug) DO NOTHING;

-- ── 6. ADICIONA tenant_id EM TODAS AS TABELAS ─────────────
ALTER TABLE empresa             ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE filial              ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE plano_orcamentario  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE versao_orcamento    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE fat_lancamento      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE centro_custo        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE conta_contabil      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE verba_folha         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE funcionario         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE item_conta_contabil ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE dimensao            ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);
ALTER TABLE dimensao_valor      ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenant(id);

-- ── 7. MIGRA DADOS EXISTENTES para o tenant padrão ────────
DO $$
DECLARE
  tid CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  UPDATE empresa             SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE filial              SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE plano_orcamentario  SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE versao_orcamento    SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE fat_lancamento      SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE centro_custo        SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE conta_contabil      SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE verba_folha         SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE funcionario         SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE item_conta_contabil SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE dimensao            SET tenant_id = tid WHERE tenant_id IS NULL;
  UPDATE dimensao_valor      SET tenant_id = tid WHERE tenant_id IS NULL;
END $$;

-- ── 8. TORNA tenant_id NOT NULL ───────────────────────────
ALTER TABLE empresa             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE filial              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE plano_orcamentario  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE versao_orcamento    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fat_lancamento      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE centro_custo        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE conta_contabil      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE verba_folha         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE funcionario         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE item_conta_contabil ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dimensao            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dimensao_valor      ALTER COLUMN tenant_id SET NOT NULL;

-- ── 9. ATUALIZA CONSTRAINTS DE UNICIDADE ──────────────────
--    Remove globais, adiciona compostas por tenant.
--    Sem isso, dois clientes com mesmo código de empresa entrariam em conflito.

-- empresa
ALTER TABLE empresa DROP CONSTRAINT IF EXISTS empresa_codigo_key;
ALTER TABLE empresa ADD CONSTRAINT empresa_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- filial
ALTER TABLE filial DROP CONSTRAINT IF EXISTS filial_codigo_key;
ALTER TABLE filial ADD CONSTRAINT filial_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- plano_orcamentario
ALTER TABLE plano_orcamentario DROP CONSTRAINT IF EXISTS plano_orcamentario_codigo_key;
ALTER TABLE plano_orcamentario ADD CONSTRAINT plano_orcamentario_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- versao_orcamento
ALTER TABLE versao_orcamento DROP CONSTRAINT IF EXISTS versao_orcamento_codigo_key;
ALTER TABLE versao_orcamento ADD CONSTRAINT versao_orcamento_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- centro_custo
ALTER TABLE centro_custo DROP CONSTRAINT IF EXISTS centro_custo_codigo_key;
ALTER TABLE centro_custo ADD CONSTRAINT centro_custo_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- conta_contabil
ALTER TABLE conta_contabil DROP CONSTRAINT IF EXISTS conta_contabil_codigo_key;
ALTER TABLE conta_contabil ADD CONSTRAINT conta_contabil_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- verba_folha
ALTER TABLE verba_folha DROP CONSTRAINT IF EXISTS verba_folha_codigo_key;
ALTER TABLE verba_folha ADD CONSTRAINT verba_folha_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- dimensao
ALTER TABLE dimensao DROP CONSTRAINT IF EXISTS dimensao_codigo_key;
ALTER TABLE dimensao ADD CONSTRAINT dimensao_tenant_codigo_key
  UNIQUE (tenant_id, codigo);

-- funcionario: chave de upsert incremental TOTVS
ALTER TABLE funcionario DROP CONSTRAINT IF EXISTS funcionario_bk_funcionario_key;
ALTER TABLE funcionario ADD CONSTRAINT funcionario_tenant_bk_key
  UNIQUE (tenant_id, bk_funcionario);

-- dimensao_valor
ALTER TABLE dimensao_valor DROP CONSTRAINT IF EXISTS dimensao_valor_dimensao_id_codigo_key;
ALTER TABLE dimensao_valor ADD CONSTRAINT dimensao_valor_tenant_dim_codigo_key
  UNIQUE (tenant_id, dimensao_id, codigo);

-- item_conta_contabil
ALTER TABLE item_conta_contabil DROP CONSTRAINT IF EXISTS item_conta_contabil_item_orc_id_conta_id_key;
ALTER TABLE item_conta_contabil ADD CONSTRAINT item_conta_contabil_tenant_key
  UNIQUE (tenant_id, item_orc_id, conta_id);

-- fat_lancamento: recria incluindo tenant_id
ALTER TABLE fat_lancamento DROP CONSTRAINT IF EXISTS fat_lancamento_unique;
ALTER TABLE fat_lancamento ADD CONSTRAINT fat_lancamento_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, versao_id, item_orc_id, empresa_id, filial_id, ano, mes, tipo_lancamento);

-- ── 10. ÍNDICES em tenant_id para performance ─────────────
CREATE INDEX IF NOT EXISTS idx_empresa_tenant             ON empresa(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filial_tenant              ON filial(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plano_orc_tenant           ON plano_orcamentario(tenant_id);
CREATE INDEX IF NOT EXISTS idx_versao_orc_tenant          ON versao_orcamento(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fat_lancamento_tenant      ON fat_lancamento(tenant_id);
CREATE INDEX IF NOT EXISTS idx_centro_custo_tenant        ON centro_custo(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conta_contabil_tenant      ON conta_contabil(tenant_id);
CREATE INDEX IF NOT EXISTS idx_verba_folha_tenant         ON verba_folha(tenant_id);
CREATE INDEX IF NOT EXISTS idx_funcionario_tenant         ON funcionario(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_conta_contabil_tenant ON item_conta_contabil(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dimensao_tenant            ON dimensao(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dimensao_valor_tenant      ON dimensao_valor(tenant_id);

-- ── 11. TRIGGERS: auto-preencher tenant_id em INSERT ──────
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'empresa','filial','plano_orcamentario','versao_orcamento','fat_lancamento',
    'centro_custo','conta_contabil','verba_folha','funcionario',
    'item_conta_contabil','dimensao','dimensao_valor'
  ] LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER trg_auto_tenant_%I
         BEFORE INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION _auto_set_tenant_id()',
      tbl, tbl
    );
  END LOOP;
END $$;

-- ── 12. RLS: remove políticas abertas, cria isolamento real ─
-- Remove "dev_all" criadas na migration 001
DROP POLICY IF EXISTS "dev_all" ON empresa;
DROP POLICY IF EXISTS "dev_all" ON filial;
DROP POLICY IF EXISTS "dev_all" ON centro_custo;
DROP POLICY IF EXISTS "dev_all" ON plano_orcamentario;
DROP POLICY IF EXISTS "dev_all" ON fat_lancamento;
DROP POLICY IF EXISTS "dev_all" ON versao_orcamento;

-- Habilita RLS nas tabelas que ainda não têm
ALTER TABLE conta_contabil      ENABLE ROW LEVEL SECURITY;
ALTER TABLE verba_folha         ENABLE ROW LEVEL SECURITY;
ALTER TABLE funcionario         ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_conta_contabil ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimensao            ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimensao_valor      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant         ENABLE ROW LEVEL SECURITY;

-- tenant e user_tenant
CREATE POLICY "tenant: leitura própria"    ON tenant      FOR SELECT USING (id = get_my_tenant_id());
CREATE POLICY "user_tenant: leitura própria" ON user_tenant FOR SELECT USING (user_id = auth.uid());

-- Tabelas de dados: acesso total apenas ao próprio tenant
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'empresa','filial','plano_orcamentario','versao_orcamento','fat_lancamento',
    'centro_custo','conta_contabil','verba_folha','funcionario',
    'item_conta_contabil','dimensao','dimensao_valor'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I
         FOR ALL
         USING     (tenant_id = get_my_tenant_id())
         WITH CHECK (tenant_id = get_my_tenant_id())',
      tbl
    );
  END LOOP;
END $$;

-- ── 13. VINCULA usuários existentes ao tenant padrão ──────
--    Todos os usuários autenticados já viram os dados existentes,
--    então todos entram como 'admin' do tenant padrão.
--    Ajuste antes de executar se já houver múltiplos usuários com papéis distintos.
INSERT INTO user_tenant (user_id, tenant_id, role)
SELECT id, '00000000-0000-0000-0000-000000000001', 'admin'
FROM auth.users
ON CONFLICT DO NOTHING;

-- ============================================================
-- APÓS EXECUTAR: atualizar no frontend os onConflict strings
-- (ver comentários abaixo — as mudanças foram feitas no código)
--
-- Constraints que mudaram:
--   empresa, filial, plano_orcamentario, versao_orcamento,
--   centro_custo, conta_contabil, verba_folha, dimensao
--     'codigo'              → 'tenant_id,codigo'
--
--   funcionario
--     'bk_funcionario'      → 'tenant_id,bk_funcionario'
--
--   dimensao_valor
--     'dimensao_id,codigo'  → 'tenant_id,dimensao_id,codigo'
--
--   item_conta_contabil
--     'item_orc_id,conta_id' → 'tenant_id,item_orc_id,conta_id'
--
--   fat_lancamento
--     (constraint recriada com tenant_id como primeira coluna)
-- ============================================================
