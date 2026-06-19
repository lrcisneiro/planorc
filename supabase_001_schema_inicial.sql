-- ============================================================
-- PLANORC — Schema Inicial v1.0
-- Executar no Supabase: SQL Editor → New Query → Cole e Run
-- ============================================================

-- ============================================================
-- 1. DIMENSÕES ESTRUTURAIS (fixas, todas as empresas têm)
-- ============================================================

CREATE TABLE empresa (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        VARCHAR(10)  NOT NULL UNIQUE,  -- ex: '01', '05', 'BO'
  descricao     VARCHAR(100) NOT NULL,          -- ex: 'BAURU'
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE filial (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID         NOT NULL REFERENCES empresa(id),
  codigo        VARCHAR(10)  NOT NULL UNIQUE,   -- ex: '2001'
  descricao     VARCHAR(100) NOT NULL,           -- ex: 'WAYUP SERVICOS-RIO PRETO'
  imp_fat       NUMERIC(5,2) NOT NULL DEFAULT 0, -- alíquota ISS
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE centro_custo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        VARCHAR(20)  NOT NULL UNIQUE,   -- ex: 'ADM.01'
  descricao     VARCHAR(100) NOT NULL,
  nivel         SMALLINT     NOT NULL,           -- 1=grupo, 2=subgrupo, 3=analítico
  pai_id        UUID         REFERENCES centro_custo(id),
  -- Dimensões embutidas do CC (Wayup)
  area          VARCHAR(50),                     -- ex: 'CSC', 'COMERCIAL'
  divisao       VARCHAR(50),
  bu            VARCHAR(50),                     -- ex: 'PC-Sistemas', 'HXM'
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. PLANO ORÇAMENTÁRIO (3 níveis, lançamentos só no nível 3)
-- ============================================================

CREATE TABLE plano_orcamentario (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        VARCHAR(20)  NOT NULL UNIQUE,   -- ex: 'AK5200', '201', '102'
  descricao     VARCHAR(150) NOT NULL,
  nivel         SMALLINT     NOT NULL,           -- 1, 2 ou 3
  pai_id        UUID         REFERENCES plano_orcamentario(id),
  -- N1: 1=Receita, 2=Despesas, 3=Resultado Financeiro, 4=Impostos s/Resultado
  n1_codigo     VARCHAR(10),
  n2_codigo     VARCHAR(10),
  -- Comportamento especial
  grupo_folha   BOOLEAN      NOT NULL DEFAULT false,  -- true = habilita dimensão funcionário
  natureza      VARCHAR(10)  CHECK (natureza IN ('RECEITA','DESPESA','NEUTRO')),
  aceita_lancamento BOOLEAN  NOT NULL DEFAULT false,  -- true apenas no nível 3
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. DIMENSÕES ANALÍTICAS CUSTOMIZÁVEIS (por cliente)
-- ============================================================

CREATE TABLE dim_definition (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(50)  NOT NULL UNIQUE,   -- ex: 'bu', 'regional', 'funcionario'
  label         VARCHAR(100) NOT NULL,           -- ex: 'Business Unit', 'Regional'
  obrigatorio   BOOLEAN      NOT NULL DEFAULT false,
  hierarquico   BOOLEAN      NOT NULL DEFAULT false,
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  ordem         SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE dim_value (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dim_slug      VARCHAR(50)  NOT NULL REFERENCES dim_definition(slug),
  codigo        VARCHAR(50)  NOT NULL,
  descricao     VARCHAR(150) NOT NULL,
  pai_id        UUID         REFERENCES dim_value(id),
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (dim_slug, codigo)
);

-- ============================================================
-- 4. MAPEAMENTO ERP → PLANO ORÇAMENTÁRIO
-- ============================================================

-- Conta contábil → Item orçamentário (N:1)
CREATE TABLE map_conta_linha (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_contabil    VARCHAR(20) NOT NULL,        -- código da conta no ERP
  desc_conta        VARCHAR(150),
  item_orc_id       UUID        NOT NULL REFERENCES plano_orcamentario(id),
  erp_origem        VARCHAR(20) NOT NULL DEFAULT 'TOTVS',  -- TOTVS, SAP, ORACLE, etc.
  ativo             BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conta_contabil, erp_origem)
);

-- Rubrica de folha ERP → Verba orçamentária (N:1)
CREATE TABLE verba_orcamentaria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        VARCHAR(20)  NOT NULL UNIQUE,    -- ex: 'SAL', 'INSS', 'FGTS'
  descricao     VARCHAR(100) NOT NULL,
  tipo          VARCHAR(20)  CHECK (tipo IN ('PROVENTO','DESCONTO','ENCARGO')),
  ativo         BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE map_rubrica_verba (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubrica_erp_cod   VARCHAR(20) NOT NULL,        -- ex: '0003' (código no TOTVS SRV)
  rubrica_erp_desc  VARCHAR(150),
  verba_id          UUID        NOT NULL REFERENCES verba_orcamentaria(id),
  erp_origem        VARCHAR(20) NOT NULL DEFAULT 'TOTVS',
  ativo             BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rubrica_erp_cod, erp_origem)
);

-- ============================================================
-- 5. VERSÕES ORÇAMENTÁRIAS
-- ============================================================

CREATE TABLE versao_orcamento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        VARCHAR(20)  NOT NULL UNIQUE,    -- ex: 'BASELINE_2026', 'REV1_2026'
  descricao     VARCHAR(100) NOT NULL,
  ano           SMALLINT     NOT NULL,
  tipo          VARCHAR(20)  CHECK (tipo IN ('BASELINE','REVISAO','FORECAST','REALIZADO')),
  status        VARCHAR(20)  NOT NULL DEFAULT 'RASCUNHO'
                CHECK (status IN ('RASCUNHO','EM_APROVACAO','APROVADO','FECHADO')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. LANÇAMENTOS ORÇAMENTÁRIOS (coração do sistema)
-- ============================================================

CREATE TABLE fat_lancamento (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  versao_id       UUID        NOT NULL REFERENCES versao_orcamento(id),
  item_orc_id     UUID        NOT NULL REFERENCES plano_orcamentario(id),
  empresa_id      UUID        NOT NULL REFERENCES empresa(id),
  filial_id       UUID        REFERENCES filial(id),
  cc_id           UUID        REFERENCES centro_custo(id),
  -- Período
  ano             SMALLINT    NOT NULL,
  mes             SMALLINT    NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- Valor
  valor           NUMERIC(18,2) NOT NULL DEFAULT 0,
  tipo_lancamento VARCHAR(20) NOT NULL CHECK (tipo_lancamento IN ('ORCADO','REALIZADO','FORECAST')),
  -- Dimensões analíticas customizáveis (chave=slug da dimensão, valor=código do DIM_VALUE)
  dim_values      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Funcionário (ativado quando grupo_folha = true)
  matricula       VARCHAR(20),
  nome_funcionario VARCHAR(150),
  -- Auditoria
  origem          VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
                  CHECK (origem IN ('MANUAL','IMPORTACAO_ERP','API')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detalhe de verbas (folha de pagamento)
CREATE TABLE fat_lancamento_verba (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lancamento_id   UUID        NOT NULL REFERENCES fat_lancamento(id) ON DELETE CASCADE,
  verba_id        UUID        NOT NULL REFERENCES verba_orcamentaria(id),
  valor           NUMERIC(18,2) NOT NULL DEFAULT 0,
  tipo_lancamento VARCHAR(20) NOT NULL CHECK (tipo_lancamento IN ('ORCADO','REALIZADO')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. ÍNDICES DE PERFORMANCE
-- ============================================================

CREATE INDEX idx_lancamento_versao     ON fat_lancamento(versao_id);
CREATE INDEX idx_lancamento_item_orc   ON fat_lancamento(item_orc_id);
CREATE INDEX idx_lancamento_empresa    ON fat_lancamento(empresa_id);
CREATE INDEX idx_lancamento_periodo    ON fat_lancamento(ano, mes);
CREATE INDEX idx_lancamento_cc         ON fat_lancamento(cc_id);
CREATE INDEX idx_lancamento_dim_values ON fat_lancamento USING gin(dim_values);

CREATE INDEX idx_plano_pai             ON plano_orcamentario(pai_id);
CREATE INDEX idx_cc_pai                ON centro_custo(pai_id);
CREATE INDEX idx_filial_empresa        ON filial(empresa_id);

-- ============================================================
-- 8. ROW LEVEL SECURITY (multi-tenant — cada cliente vê só seus dados)
-- ============================================================

ALTER TABLE empresa           ENABLE ROW LEVEL SECURITY;
ALTER TABLE filial             ENABLE ROW LEVEL SECURITY;
ALTER TABLE centro_custo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plano_orcamentario ENABLE ROW LEVEL SECURITY;
ALTER TABLE fat_lancamento     ENABLE ROW LEVEL SECURITY;
ALTER TABLE versao_orcamento   ENABLE ROW LEVEL SECURITY;

-- Por enquanto, políticas abertas para desenvolvimento (restringir em produção)
CREATE POLICY "dev_all" ON empresa           FOR ALL USING (true);
CREATE POLICY "dev_all" ON filial             FOR ALL USING (true);
CREATE POLICY "dev_all" ON centro_custo       FOR ALL USING (true);
CREATE POLICY "dev_all" ON plano_orcamentario FOR ALL USING (true);
CREATE POLICY "dev_all" ON fat_lancamento     FOR ALL USING (true);
CREATE POLICY "dev_all" ON versao_orcamento   FOR ALL USING (true);

-- ============================================================
-- 9. DADOS INICIAIS — Wayup Group (do CSV)
-- ============================================================

-- Empresas
INSERT INTO empresa (codigo, descricao) VALUES
  ('01', 'BAURU'),
  ('05', 'RIO PRETO'),
  ('06', 'MATO GROSSO DO SUL'),
  ('07', 'RIO PRETO'),
  ('08', 'MARINGA'),
  ('25', 'MODA'),
  ('28', 'RESULTAR BR'),
  ('35', 'AVENTUM'),
  ('40', 'TOP PARTICIPACOES'),
  ('BO', 'BOLIVIA'),
  ('XX', 'PARAGUAI'),
  ('YY', 'CASCAVEL'),
  ('ZZ', 'LONDRINA');

-- Versão inicial
INSERT INTO versao_orcamento (codigo, descricao, ano, tipo, status) VALUES
  ('BASELINE_2026', 'Orçamento Base 2026', 2026, 'BASELINE', 'APROVADO'),
  ('REALIZADO_2026', 'Realizado 2026', 2026, 'REALIZADO', 'FECHADO');

-- Dimensões analíticas padrão Wayup
INSERT INTO dim_definition (slug, label, obrigatorio, hierarquico, ordem) VALUES
  ('bu',         'Business Unit',  false, false, 1),
  ('area',       'Área',           false, false, 2),
  ('divisao',    'Divisão',        false, false, 3),
  ('regional',   'Regional',       false, false, 4),
  ('produto',    'Produto',        false, false, 5),
  ('funcionario','Funcionário',    false, false, 6);  -- ativado só em grupo_folha

-- BUs Wayup
INSERT INTO dim_value (dim_slug, codigo, descricao) VALUES
  ('bu', 'PC-SISTEMAS',    'PC-Sistemas'),
  ('bu', 'HXM',            'HXM'),
  ('bu', 'LE-OESTE',       'LE Oeste'),
  ('bu', 'ERP-TRAD',       'ERP Tradicional'),
  ('bu', 'RD',             'RD'),
  ('bu', 'MODA',           'Moda'),
  ('bu', 'SUSTENTACAO',    'Sustentação'),
  ('bu', 'SMART',          'Smart');

-- ============================================================
-- FIM DO SCHEMA INICIAL
-- Para executar: Supabase Dashboard → SQL Editor → New Query → Cole tudo → Run
-- ============================================================
