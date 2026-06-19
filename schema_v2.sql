-- ============================================================
-- PLANORC 2.0 — Schema completo
-- Base de dados para planejamento orçamentário empresarial
-- ============================================================

-- DROP em ordem reversa de dependências (seguro re-rodar)
DROP TABLE IF EXISTS fat_realizado         CASCADE;
DROP TABLE IF EXISTS fat_orcado            CASCADE;
DROP TABLE IF EXISTS view_config           CASCADE;
DROP TABLE IF EXISTS conta_linha           CASCADE;
DROP TABLE IF EXISTS linha_template        CASCADE;
DROP TABLE IF EXISTS template              CASCADE;
DROP TABLE IF EXISTS versao_orcamento      CASCADE;
DROP TABLE IF EXISTS indice_valor          CASCADE;
DROP TABLE IF EXISTS indice_economico      CASCADE;
DROP TABLE IF EXISTS dimensao_config       CASCADE;
DROP TABLE IF EXISTS projeto               CASCADE;
DROP TABLE IF EXISTS verba_folha           CASCADE;
DROP TABLE IF EXISTS funcionario           CASCADE;
DROP TABLE IF EXISTS conta_contabil        CASCADE;
DROP TABLE IF EXISTS centro_custo          CASCADE;
DROP TABLE IF EXISTS filial                CASCADE;
DROP TABLE IF EXISTS empresa               CASCADE;
DROP TABLE IF EXISTS tenant                CASCADE;

-- ============================================================
-- MULTI-TENANCY
-- ============================================================

CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  criado_em   timestamptz DEFAULT now()
);


-- ============================================================
-- DIMENSÕES FIXAS (obrigatórias em todo lançamento)
-- ============================================================

CREATE TABLE empresa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE filial (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  empresa_id  uuid NOT NULL REFERENCES empresa ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE centro_custo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  pai_id      uuid REFERENCES centro_custo,  -- hierarquia opcional de CCs
  area        text,
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, codigo)
);


-- ============================================================
-- DIMENSÕES OPCIONAIS (habilitadas por tenant via dimensao_config)
-- ============================================================

-- Plano de contas — usado para mapear realizado ERP → linha do template
CREATE TABLE conta_contabil (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  tipo        text NOT NULL DEFAULT 'ANALITICA'
              CHECK (tipo IN ('SINTETICA', 'ANALITICA')),
  pai_id      uuid REFERENCES conta_contabil,
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

-- Funcionários (importados do ERP)
CREATE TABLE funcionario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  matricula   text NOT NULL,
  nome        text NOT NULL,
  filial_id   uuid REFERENCES filial,
  cc_id       uuid REFERENCES centro_custo,
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, matricula)
);

-- Verbas / rubricas de folha (salário, encargos, benefícios, etc.)
CREATE TABLE verba_folha (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  tipo        text CHECK (tipo IN ('SALARIO', 'ENCARGO', 'BENEFICIO', 'PROVISAO', 'OUTRO')),
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

-- Projetos (clientes que usam essa dimensão)
CREATE TABLE projeto (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  ativo       boolean DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

-- Catálogo de dimensões configuradas por tenant
-- Define quais dims além das 3 fixas aparecem nos filtros e nos lançamentos
CREATE TABLE dimensao_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo        text NOT NULL,   -- 'funcionario', 'verba', 'projeto', 'cliente', etc.
  label         text NOT NULL,   -- label exibido na UI
  tabela_ref    text,            -- 'funcionario', 'verba_folha', 'projeto' (NULL = lista própria)
  obrigatorio   boolean DEFAULT false,
  ordem         int,
  UNIQUE (tenant_id, codigo)
);


-- ============================================================
-- ÍNDICES ECONÔMICOS (stub — preenchimento via import futuro)
-- ============================================================

CREATE TABLE indice_economico (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,     -- 'IPCA', 'IGPM', 'DOLAR', etc.
  descricao   text NOT NULL,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE indice_valor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indice_id       uuid NOT NULL REFERENCES indice_economico ON DELETE CASCADE,
  ano             int NOT NULL,
  mes             int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  taxa            numeric(10,6) NOT NULL,  -- ex: 0.0054 para 0,54% ao mês
  UNIQUE (indice_id, ano, mes)
);


-- ============================================================
-- VERSÕES / CENÁRIOS DE ORÇAMENTO
-- ============================================================

CREATE TABLE versao_orcamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,       -- 'BASELINE_2026', 'REVISAO1_2026'
  descricao   text NOT NULL,
  ano         int NOT NULL,
  ativa       boolean DEFAULT true,
  bloqueada   boolean DEFAULT false,  -- bloqueia edições após aprovação
  criado_em   timestamptz DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);


-- ============================================================
-- TEMPLATES (DRE, Formulário de detalhe, Dashboard)
-- ============================================================

-- Um template = uma estrutura de linhas reutilizável
-- O mesmo template DRE é usado por todas as empresas/CCs — o filtro muda, a estrutura não
CREATE TABLE template (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  tipo        text NOT NULL DEFAULT 'DRE'
              CHECK (tipo IN ('DRE', 'FORMULARIO', 'DASHBOARD')),
  descricao   text,
  UNIQUE (tenant_id, codigo)
);

-- Linhas hierárquicas do template
-- Tipos:
--   SOMAR_FILHOS  — linha de subtotal (RECEITA BRUTA, LUCRO BRUTO, EBITDA...)
--   ANALITICA     — linha que recebe lançamento direto ou via formulário filho
--   FORMULA       — calculada por expressão: =ANTERIOR(), =[linha_a]+[linha_b]
--   INDICADOR     — ratio/percentual calculado (Margem Bruta %, etc.) — não soma para o pai
--   ESPACO        — linha em branco / separador visual
CREATE TABLE linha_template (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES template ON DELETE CASCADE,
  pai_id          uuid REFERENCES linha_template,
  codigo          text NOT NULL,
  descricao       text NOT NULL,
  ordem           int,
  nivel           int NOT NULL DEFAULT 1,
  tipo_linha      text NOT NULL DEFAULT 'ANALITICA'
                  CHECK (tipo_linha IN ('SOMAR_FILHOS','ANALITICA','FORMULA','INDICADOR','ESPACO')),
  -- Fórmula para tipos FORMULA e INDICADOR
  -- Sintaxe: =ANTERIOR() | =[codigo_linha]*1.05 | =[linha_a]+[linha_b] | =[linha_a]/[linha_b]
  expressao       text,
  -- Aparência
  natureza        text CHECK (natureza IN ('RECEITA','DESPESA','NEUTRO')),
  negrito         boolean DEFAULT false,
  italico         boolean DEFAULT false,
  cor_texto       text,    -- hex ou null (herda padrão)
  -- Link para formulário filho (detalhamento por produto, funcionário, etc.)
  -- Quando preenchido, a linha ANALITICA recebe seu valor do total do formulário filho
  formulario_id   uuid REFERENCES template,
  -- Índice de correção aplicado à linha (opcional)
  indice_id       uuid REFERENCES indice_economico,
  UNIQUE (template_id, codigo)
);

-- Mapeamento conta contábil → linha do template
-- Permite que o realizado do ERP (por conta) seja agregado na linha correta do DRE
-- sinal = 1 (normal) ou -1 (inverte sinal, ex: contas de receita que vêm a crédito)
CREATE TABLE conta_linha (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  conta_id    uuid NOT NULL REFERENCES conta_contabil ON DELETE CASCADE,
  linha_id    uuid NOT NULL REFERENCES linha_template ON DELETE CASCADE,
  sinal       int NOT NULL DEFAULT 1 CHECK (sinal IN (1, -1)),
  UNIQUE (conta_id, linha_id)
);


-- ============================================================
-- VIEWS SALVAS (tabs do template — tipo os botões 1 2 3 4 5 do LeverPro)
-- ============================================================

CREATE TABLE view_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES template ON DELETE CASCADE,
  nome            text NOT NULL,
  ordem           int,
  -- Função: como as colunas de tempo são organizadas
  --   MENSAL       → Jan | Fev | ... | Dez
  --   ACM          → ACM (acumulado do exercício)
  --   MENSAL_ACM   → ACM | Jan | Fev | ...
  --   COMPARATIVO  → cada período com sub-colunas por cenário
  funcao          text NOT NULL DEFAULT 'MENSAL'
                  CHECK (funcao IN ('MENSAL','ACM','MENSAL_ACM','COMPARATIVO')),
  -- IDs de versao_orcamento + 'REALIZADO' como string especial
  -- Ex: ["uuid-baseline", "REALIZADO"] → mostra Orçado + Realizado lado a lado
  cenarios        text[] NOT NULL DEFAULT '{}',
  -- Filtros padrão salvos (empresa, filial, cc, etc.)
  filtros         jsonb DEFAULT '{}'
);


-- ============================================================
-- TABELAS FATO
-- ============================================================

-- Orçado
-- dims JSONB carrega dimensões opcionais: funcionario_id, verba_id, projeto_id, etc.
-- A constraint de unicidade usa dims::text — application deve normalizar
-- (chaves do JSON sempre em ordem alfabética antes de inserir)
CREATE TABLE fat_orcado (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  versao_id       uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  linha_id        uuid NOT NULL REFERENCES linha_template ON DELETE CASCADE,
  -- Dimensões fixas (sempre obrigatórias)
  empresa_id      uuid NOT NULL REFERENCES empresa,
  filial_id       uuid NOT NULL REFERENCES filial,
  cc_id           uuid NOT NULL REFERENCES centro_custo,
  -- Período
  ano             int NOT NULL,
  mes             int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- Valor e fórmula (mutuamente exclusivos: ou tem valor manual ou tem expressão)
  valor           numeric(18,2),
  expressao       text,   -- fórmula da célula (=ANTERIOR(), =[P00001]*[P00002], etc.)
  -- Dimensões opcionais configuradas pelo tenant
  -- Ex: {"funcionario": "uuid", "verba": "uuid", "projeto": "uuid"}
  dims            jsonb NOT NULL DEFAULT '{}',
  atualizado_em   timestamptz DEFAULT now()
);

-- Unique index usando dims::text (requer JSON normalizado na inserção)
CREATE UNIQUE INDEX uq_fat_orcado
  ON fat_orcado (versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, (dims::text));

-- Realizado (importado do ERP ou lançado manualmente)
CREATE TABLE fat_realizado (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  linha_id        uuid NOT NULL REFERENCES linha_template ON DELETE CASCADE,
  conta_id        uuid REFERENCES conta_contabil,  -- conta de origem (null se manual)
  -- Dimensões fixas
  empresa_id      uuid NOT NULL REFERENCES empresa,
  filial_id       uuid NOT NULL REFERENCES filial,
  cc_id           uuid NOT NULL REFERENCES centro_custo,
  -- Período
  ano             int NOT NULL,
  mes             int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor           numeric(18,2) NOT NULL,
  -- Dimensões opcionais (mesma estrutura do fat_orcado)
  dims            jsonb NOT NULL DEFAULT '{}',
  origem          text NOT NULL DEFAULT 'ERP'
                  CHECK (origem IN ('ERP','MANUAL','IMPORT')),
  importado_em    timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX uq_fat_realizado
  ON fat_realizado (linha_id, conta_id, empresa_id, filial_id, cc_id, ano, mes, (dims::text));


-- ============================================================
-- ÍNDICES DE PERFORMANCE
-- ============================================================

-- fat_orcado
CREATE INDEX ON fat_orcado (tenant_id, versao_id, ano);
CREATE INDEX ON fat_orcado (linha_id, ano, mes);
CREATE INDEX ON fat_orcado (cc_id);
CREATE INDEX ON fat_orcado USING GIN (dims);
CREATE INDEX ON fat_orcado ((dims->>'funcionario'));
CREATE INDEX ON fat_orcado ((dims->>'verba'));
CREATE INDEX ON fat_orcado ((dims->>'projeto'));

-- fat_realizado
CREATE INDEX ON fat_realizado (tenant_id, ano);
CREATE INDEX ON fat_realizado (linha_id, ano, mes);
CREATE INDEX ON fat_realizado (cc_id);
CREATE INDEX ON fat_realizado USING GIN (dims);
CREATE INDEX ON fat_realizado ((dims->>'funcionario'));
CREATE INDEX ON fat_realizado ((dims->>'verba'));


-- ============================================================
-- NOTAS DE IMPLEMENTAÇÃO
-- ============================================================

-- 1. NORMALIZAÇÃO DO DIMS JSONB
--    Antes de qualquer INSERT/UPDATE em fat_orcado ou fat_realizado,
--    ordenar as chaves do JSON alfabeticamente para garantir que o
--    unique index (dims::text) funcione corretamente.
--    Em PostgreSQL: jsonb mantém chaves ordenadas internamente — OK.
--    No client TypeScript: JSON.stringify(Object.fromEntries(Object.entries(dims).sort()))

-- 2. FÓRMULAS (expressao)
--    Sintaxe da célula:
--      Sem prefixo   → valor manual (ex: "15000")
--      Prefixo =     → fórmula (ex: "=ANTERIOR()", "=[P00001]*[P00002]")
--    Referências entre linhas usam [codigo] da linha_template.
--    Funções temporais: ANTERIOR(), ANTERIOR([linha]), ANTERIOR([linha], N)
--    Avaliação via mathjs com funções customizadas.

-- 3. FORMULÁRIO FILHO (formulario_id em linha_template)
--    Quando uma linha ANALITICA tem formulario_id preenchido:
--    - O usuário entra no detalhe via formulário filho
--    - O total do formulário filho (linha marcada como TOTAL) alimenta esta linha
--    - Os valores são armazenados com dims mais granulares (ex: + funcionario + verba)
--    - O DRE agrega via SUM de fat_orcado WHERE linha_id = esta_linha_id

-- 4. REALIZADO VIA CONTA CONTÁBIL
--    Fluxo: ERP → fat_realizado (com conta_id) → conta_linha → linha_template → DRE
--    A query do DRE para realizado faz JOIN em conta_linha para resolver a linha.
--    Linhas FORMULA e INDICADOR não têm realizado direto — são calculadas.

-- 5. MULTI-TENANCY NO SUPABASE
--    Habilitar RLS em todas as tabelas.
--    Política padrão: WHERE tenant_id = auth.jwt()->>'tenant_id'
--    O tenant_id do usuário vem do JWT (campo custom no Supabase Auth).
