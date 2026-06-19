-- ============================================================
-- PLANORC 2.0 — Schema v3: Relatório / Formulário / Dashboard
-- Substitui o modelo polimórfico template+tipo por 3 entidades
-- por comportamento. Recomeça do zero (ambiente de dev).
--
-- Rodar APÓS schema_v2.sql + schema_v2_tenant_rls.sql.
-- Mantém intactos: tenant, empresa, filial, centro_custo,
-- conta_contabil, funcionario, verba_folha, projeto,
-- dimensao_config, indice_*, versao_orcamento.
-- ============================================================

-- ── DROP do modelo antigo (ordem reversa de dependência) ──
DROP TABLE IF EXISTS view_config     CASCADE;
DROP TABLE IF EXISTS conta_linha      CASCADE;
DROP TABLE IF EXISTS fat_realizado    CASCADE;
DROP TABLE IF EXISTS fat_orcado       CASCADE;
DROP TABLE IF EXISTS linha_template   CASCADE;
DROP TABLE IF EXISTS template         CASCADE;

-- (formulário ainda não existia; drops defensivos para re-rodar)
DROP TABLE IF EXISTS formulario_valor CASCADE;
DROP TABLE IF EXISTS formulario_linha CASCADE;
DROP TABLE IF EXISTS formulario       CASCADE;
DROP TABLE IF EXISTS relatorio_linha  CASCADE;
DROP TABLE IF EXISTS relatorio        CASCADE;
DROP TABLE IF EXISTS categoria_relatorio CASCADE;


-- ============================================================
-- CATEGORIA DE RELATÓRIO (configurável — substitui o enum tipo)
-- DRE, BP, DFC, DVA, DMPL, NOTAS, ... criadas como dado.
-- ============================================================
CREATE TABLE categoria_relatorio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  ordem       int,
  UNIQUE (tenant_id, codigo)
);


-- ============================================================
-- RELATÓRIO (DRE, BP, ... — demonstração que lê dos fatos)
-- ============================================================
CREATE TABLE relatorio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  categoria_id  uuid REFERENCES categoria_relatorio ON DELETE SET NULL,
  codigo        text NOT NULL,
  nome          text NOT NULL,
  descricao     text,
  UNIQUE (tenant_id, codigo)
);

-- Linhas hierárquicas do relatório
CREATE TABLE relatorio_linha (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relatorio_id    uuid NOT NULL REFERENCES relatorio ON DELETE CASCADE,
  pai_id          uuid REFERENCES relatorio_linha ON DELETE CASCADE,
  codigo          text NOT NULL,
  descricao       text NOT NULL,
  ordem           int,
  nivel           int NOT NULL DEFAULT 1,
  tipo_linha      text NOT NULL DEFAULT 'ANALITICA'
                  CHECK (tipo_linha IN ('SOMAR_FILHOS','ANALITICA','FORMULA','INDICADOR','ESPACO')),
  expressao       text,                       -- fórmula da linha (FORMULA/INDICADOR)
  natureza        text CHECK (natureza IN ('RECEITA','DESPESA','NEUTRO')),
  -- Aparência / formato (só exibição)
  formato         text NOT NULL DEFAULT 'NUMERO'
                  CHECK (formato IN ('NUMERO','PERCENTUAL','MOEDA')),
  casas_decimais  int NOT NULL DEFAULT 0,
  negrito         boolean DEFAULT false,
  italico         boolean DEFAULT false,
  cor_texto       text,
  UNIQUE (relatorio_id, codigo)
);

-- DE-PARA conta contábil → linha do relatório (usado p/ realizado)
CREATE TABLE conta_linha (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  conta_id    uuid NOT NULL REFERENCES conta_contabil ON DELETE CASCADE,
  linha_id    uuid NOT NULL REFERENCES relatorio_linha ON DELETE CASCADE,
  sinal       int NOT NULL DEFAULT 1 CHECK (sinal IN (1, -1)),
  UNIQUE (conta_id, linha_id)
);


-- ============================================================
-- FORMULÁRIO (memória de cálculo — alimenta o relatório)
-- ============================================================
CREATE TABLE formulario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  descricao   text,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE formulario_linha (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id     uuid NOT NULL REFERENCES formulario ON DELETE CASCADE,
  pai_id            uuid REFERENCES formulario_linha ON DELETE CASCADE,
  codigo            text NOT NULL,
  descricao         text NOT NULL,
  ordem             int,
  nivel             int NOT NULL DEFAULT 1,
  tipo_linha        text NOT NULL DEFAULT 'ANALITICA'
                    CHECK (tipo_linha IN ('SOMAR_FILHOS','ANALITICA','FORMULA','INDICADOR','ESPACO')),
  expressao         text,
  natureza          text CHECK (natureza IN ('RECEITA','DESPESA','NEUTRO')),
  formato           text NOT NULL DEFAULT 'NUMERO'
                    CHECK (formato IN ('NUMERO','PERCENTUAL','MOEDA')),
  casas_decimais    int NOT NULL DEFAULT 0,
  negrito           boolean DEFAULT false,
  italico           boolean DEFAULT false,
  -- Linha-resultado: posta seu valor calculado nesta conta do relatório (via "Aplicar")
  conta_destino_id  uuid REFERENCES conta_contabil ON DELETE SET NULL,
  UNIQUE (formulario_id, codigo)
);

-- Valores (fato) das células do formulário
CREATE TABLE formulario_valor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  formulario_id   uuid NOT NULL REFERENCES formulario ON DELETE CASCADE,
  linha_id        uuid NOT NULL REFERENCES formulario_linha ON DELETE CASCADE,
  versao_id       uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  empresa_id      uuid NOT NULL REFERENCES empresa,
  filial_id       uuid REFERENCES filial,          -- null = consolidado
  ano             int NOT NULL,
  mes             int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor           numeric(18,2),
  expressao       text,                            -- fórmula da célula (=ANTERIOR()*1,05)
  dims            jsonb NOT NULL DEFAULT '{}',
  atualizado_em   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX uq_formulario_valor
  ON formulario_valor (versao_id, linha_id, empresa_id, COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid), ano, mes, (dims::text));


-- ============================================================
-- FATO: ORÇADO (do relatório) — manual + calculado via "Aplicar"
-- ============================================================
CREATE TABLE fat_orcado (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  versao_id                 uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  linha_id                  uuid NOT NULL REFERENCES relatorio_linha ON DELETE CASCADE,
  empresa_id                uuid NOT NULL REFERENCES empresa,
  filial_id                 uuid REFERENCES filial,         -- nullable (consolidado)
  cc_id                     uuid REFERENCES centro_custo,   -- nullable (consolidado)
  ano                       int NOT NULL,
  mes                       int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor                     numeric(18,2),
  expressao                 text,                           -- fórmula da célula (simulação)
  origem                    text NOT NULL DEFAULT 'MANUAL'
                            CHECK (origem IN ('MANUAL','FORMULARIO')),
  origem_formulario_linha_id uuid REFERENCES formulario_linha ON DELETE SET NULL,
  dims                      jsonb NOT NULL DEFAULT '{}',
  atualizado_em             timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX uq_fat_orcado
  ON fat_orcado (versao_id, linha_id, empresa_id,
                 COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(cc_id,    '00000000-0000-0000-0000-000000000000'::uuid),
                 ano, mes, (dims::text));
CREATE INDEX ON fat_orcado (tenant_id, versao_id, ano);
CREATE INDEX ON fat_orcado (linha_id, ano, mes);


-- ============================================================
-- FATO: REALIZADO (razão do ERP) — grão de lançamento
-- linha_id NULLABLE: a linha do relatório é resolvida na
-- consulta via conta_linha (decisão "b").
-- ============================================================
CREATE TABLE fat_realizado (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  linha_id        uuid REFERENCES relatorio_linha ON DELETE SET NULL,  -- nullable
  conta_id        uuid REFERENCES conta_contabil,
  empresa_id      uuid NOT NULL REFERENCES empresa,
  filial_id       uuid REFERENCES filial,
  cc_id           uuid REFERENCES centro_custo,
  ano             int NOT NULL,
  mes             int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  data            date,
  documento       text,
  historico       text,
  debito          numeric(18,2),
  credito         numeric(18,2),
  dc              char(1) CHECK (dc IN ('D','C')),
  valor           numeric(18,2) NOT NULL,    -- movimentação (com sinal p/ relatório)
  dims            jsonb NOT NULL DEFAULT '{}',
  origem          text NOT NULL DEFAULT 'ERP'
                  CHECK (origem IN ('ERP','MANUAL','IMPORT')),
  importado_em    timestamptz DEFAULT now()
);
CREATE INDEX ON fat_realizado (tenant_id, ano, mes);
CREATE INDEX ON fat_realizado (conta_id, ano, mes);
CREATE INDEX ON fat_realizado (empresa_id, ano, mes);
CREATE INDEX ON fat_realizado (cc_id);
CREATE INDEX ON fat_realizado USING GIN (dims);


-- ============================================================
-- VIEW_CONFIG (abas/visões) — pertence a relatório OU formulário
-- ============================================================
CREATE TABLE view_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relatorio_id    uuid REFERENCES relatorio  ON DELETE CASCADE,
  formulario_id   uuid REFERENCES formulario ON DELETE CASCADE,
  nome            text NOT NULL,
  ordem           int,
  funcao          text NOT NULL DEFAULT 'MENSAL'
                  CHECK (funcao IN ('MENSAL','ACM','MENSAL_ACM','COMPARATIVO')),
  cenarios        text[] NOT NULL DEFAULT '{}',   -- uuids de versao + 'REALIZADO'
  filtros         jsonb DEFAULT '{}',             -- periodo, classificacao, dims, etc.
  CHECK (num_nonnulls(relatorio_id, formulario_id) = 1)
);


-- ============================================================
-- RLS — padrão current_tenant_id() (igual schema_v2_tenant_rls)
-- ============================================================
ALTER TABLE categoria_relatorio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categoria_relatorio_rls" ON categoria_relatorio FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE relatorio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "relatorio_rls" ON relatorio FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE relatorio_linha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "relatorio_linha_rls" ON relatorio_linha FOR ALL
  USING (EXISTS (SELECT 1 FROM relatorio r WHERE r.id = relatorio_linha.relatorio_id AND r.tenant_id = current_tenant_id()));

ALTER TABLE conta_linha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conta_linha_rls" ON conta_linha FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE formulario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "formulario_rls" ON formulario FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE formulario_linha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "formulario_linha_rls" ON formulario_linha FOR ALL
  USING (EXISTS (SELECT 1 FROM formulario f WHERE f.id = formulario_linha.formulario_id AND f.tenant_id = current_tenant_id()));

ALTER TABLE formulario_valor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "formulario_valor_rls" ON formulario_valor FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE fat_orcado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fat_orcado_rls" ON fat_orcado FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE fat_realizado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fat_realizado_rls" ON fat_realizado FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE view_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view_config_rls" ON view_config FOR ALL
  USING (
    (relatorio_id  IS NOT NULL AND EXISTS (SELECT 1 FROM relatorio  r WHERE r.id = view_config.relatorio_id  AND r.tenant_id = current_tenant_id()))
    OR
    (formulario_id IS NOT NULL AND EXISTS (SELECT 1 FROM formulario f WHERE f.id = view_config.formulario_id AND f.tenant_id = current_tenant_id()))
  );


-- ============================================================
-- SEED — categorias padrão (configuráveis depois)
-- ============================================================
INSERT INTO categoria_relatorio (tenant_id, codigo, nome, ordem) VALUES
  ('11111111-1111-1111-1111-111111111111', 'DRE',   'Demonstração do Resultado (DRE)', 1),
  ('11111111-1111-1111-1111-111111111111', 'BP',    'Balanço Patrimonial',            2),
  ('11111111-1111-1111-1111-111111111111', 'DFC',   'Fluxo de Caixa',                 3),
  ('11111111-1111-1111-1111-111111111111', 'DVA',   'Demonstração do Valor Adicionado',4),
  ('11111111-1111-1111-1111-111111111111', 'DMPL',  'Mutações do Patrimônio Líquido', 5),
  ('11111111-1111-1111-1111-111111111111', 'NOTAS', 'Notas Explicativas',             6)
ON CONFLICT (tenant_id, codigo) DO NOTHING;
