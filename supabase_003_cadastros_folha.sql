-- ============================================================
-- MIGRATION 003 - Cadastros de Folha, Conta Contábil,
--                 Amarrações e Sistema de Dimensões Configuráveis
-- Execute no Supabase SQL Editor
-- ============================================================

-- ── 1. CENTRO DE CUSTO ────────────────────────────────────
--    Fonte: CentroCusto.csv
--    Chave:  CTT_CUSTO_11   (coluna 11 = nível mais granular, ex: "314")
--    Desc:   CTT_DESC01_11
--    Extra:  AREA, DIVISAO, BU
CREATE TABLE IF NOT EXISTS centro_custo (
  id        uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo    text  NOT NULL UNIQUE,
  descricao text  NOT NULL,
  area      text,
  divisao   text,
  bu        text,
  ativo     bool  NOT NULL DEFAULT true
);

-- ── 2. CONTA CONTÁBIL ────────────────────────────────────
--    Fonte: ContaContabil.csv
--    Chave:  CT1_CONTA_11   (coluna 11 = código completo, ex: "41011001")
--    Desc:   CT1_DESC01_11
--    Filtro de importação: CLASSE_CONTABIL = "2" (contas analíticas/lançamento)
CREATE TABLE IF NOT EXISTS conta_contabil (
  id        uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo    text  NOT NULL UNIQUE,
  descricao text  NOT NULL,
  ativo     bool  NOT NULL DEFAULT true
);

-- ── 3. VERBA DE FOLHA ────────────────────────────────────
--    Fonte: srv.csv
--    Chave:  RV_COD (ex: "001")
--    Amarração embutida no CSV:
--      BK_CONTA   → conta_id    (extrair código após "||")
--      ID_ITEMORC → item_orc_id (extrair código após "||")
CREATE TABLE IF NOT EXISTS verba_folha (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text  NOT NULL UNIQUE,
  descricao   text  NOT NULL,
  tipo        text,   -- D=diário  H=horas  V=valor
  tipo_pdb    text,   -- PROVENTO | DESCONTO | BASE PROVENTO | BASE DESCONTO
  conta_id    uuid  REFERENCES conta_contabil(id),
  item_orc_id uuid  REFERENCES plano_orcamentario(id),
  ativo       bool  NOT NULL DEFAULT true
);

-- ── 4. FUNCIONÁRIO / MATRÍCULA ───────────────────────────
--    Fonte: Funcionarios.csv
--    Chave única: BK_FUNCIONARIO (chave TOTVS para upsert incremental)
--    Mapeamento:
--      MATRICULA_FUNC → codigo
--      NOME_FUNC      → nome
--      SITFOLHA       → situacao (" "=ativo  "D"=demitido  "A"=afastado  "F"=férias)
--      RA_ADMISSA     → data_admissao (YYYYMMDD → date)
--      RA_DEMISSA     → data_demissao (8 espaços = null)
--      BK_FILIAL         → filial_id        ("P |01|2001" → codigo "2001")
--      BK_CENTRO_CUSTO   → centro_custo_id  ("P |01|CTT200||314" → codigo "314")
--    Ignorar: MATRICULA_FUNC = "000000"
CREATE TABLE IF NOT EXISTS funcionario (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text  NOT NULL,
  bk_funcionario  text  UNIQUE,
  nome            text  NOT NULL,
  situacao        text  DEFAULT ' ',
  data_admissao   date,
  data_demissao   date,
  empresa_id      uuid  REFERENCES empresa(id),
  filial_id       uuid  REFERENCES filial(id),
  centro_custo_id uuid  REFERENCES centro_custo(id),
  ativo           bool  NOT NULL DEFAULT true
);

-- ── 5. AMARRAÇÃO: item orçamentário → contas contábeis ──
--    Apenas itens com grupo_folha = false
--    Permite classificar automaticamente o realizado por conta
CREATE TABLE IF NOT EXISTS item_conta_contabil (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  item_orc_id uuid  NOT NULL REFERENCES plano_orcamentario(id) ON DELETE CASCADE,
  conta_id    uuid  NOT NULL REFERENCES conta_contabil(id)     ON DELETE CASCADE,
  UNIQUE(item_orc_id, conta_id)
);

-- ============================================================
-- SISTEMA DE DIMENSÕES CONFIGURÁVEIS
-- ============================================================
--
-- dim_values (jsonb) em fat_lancamento armazena pares:
--   { "codigo_dimensao": "<uuid_do_valor>" }
--
-- Exemplos:
--   Folha:    { "verba": "uuid", "funcionario": "uuid", "centro_custo": "uuid" }
--   Projetos: { "projeto": "uuid", "cliente": "uuid", "fase": "uuid" }
--   Misto:    { "area": "uuid", "divisao": "uuid" }
--
-- tabela_ref != NULL → o UUID aponta para um registro nessa tabela
-- tabela_ref IS NULL → o UUID aponta para dimensao_valor.id

-- ── 6. CATÁLOGO DE DIMENSÕES ─────────────────────────────
CREATE TABLE IF NOT EXISTS dimensao (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text    NOT NULL UNIQUE, -- chave usada no dim_values JSON
  label       text    NOT NULL,        -- rótulo exibido na UI
  tabela_ref  text,   -- 'verba_folha' | 'funcionario' | 'centro_custo' | NULL
                      --  NULL = valores gerenciados em dimensao_valor
  obrigatorio bool    NOT NULL DEFAULT false,
  ordem       int     NOT NULL DEFAULT 0,
  ativo       bool    NOT NULL DEFAULT true
);

-- ── 7. VALORES DE DIMENSÕES SEM TABELA PRÓPRIA ───────────
--    Para dimensões custom (projeto, cliente, fase, etc.)
CREATE TABLE IF NOT EXISTS dimensao_valor (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  dimensao_id uuid  NOT NULL REFERENCES dimensao(id) ON DELETE CASCADE,
  codigo      text  NOT NULL,
  descricao   text  NOT NULL,
  ativo       bool  NOT NULL DEFAULT true,
  UNIQUE(dimensao_id, codigo)
);

-- ── SEEDS: dimensões padrão ──────────────────────────────
INSERT INTO dimensao (codigo, label, tabela_ref, ordem) VALUES
  ('verba',        'Verba de Folha',  'verba_folha',  10),
  ('funcionario',  'Funcionário',     'funcionario',  20),
  ('centro_custo', 'Centro de Custo', 'centro_custo', 30),
  ('projeto',      'Projeto',         NULL,           40),
  ('cliente',      'Cliente',         NULL,           50)
ON CONFLICT (codigo) DO NOTHING;

-- ── ÍNDICES ─────────────────────────────────────────────
-- GIN em dim_values para consultas por qualquer dimensão
CREATE INDEX IF NOT EXISTS idx_fat_lancamento_dim
  ON fat_lancamento USING GIN (dim_values);

CREATE INDEX IF NOT EXISTS idx_funcionario_filial   ON funcionario(filial_id);
CREATE INDEX IF NOT EXISTS idx_funcionario_empresa  ON funcionario(empresa_id);
CREATE INDEX IF NOT EXISTS idx_funcionario_cc       ON funcionario(centro_custo_id);
CREATE INDEX IF NOT EXISTS idx_verba_item_orc       ON verba_folha(item_orc_id);
CREATE INDEX IF NOT EXISTS idx_verba_conta          ON verba_folha(conta_id);
CREATE INDEX IF NOT EXISTS idx_item_conta_item      ON item_conta_contabil(item_orc_id);
CREATE INDEX IF NOT EXISTS idx_item_conta_conta     ON item_conta_contabil(conta_id);
CREATE INDEX IF NOT EXISTS idx_dim_valor_dim        ON dimensao_valor(dimensao_id);
