-- ============================================================
-- F5 · Posto de Trabalho (orçamento de folha) — P1: fundação de dados
-- Cria cargo / sindicato / posto / premissa_dissidio / rateio_regra /
-- rateio_destino e REESTRUTURA verba_folha (catálogo central de regras).
-- Habilita origem 'POSTO' no fat_orcado (Aplicar do motor de postos).
-- Idempotente: IF NOT EXISTS + guardas p/ conviver com o vivo.
-- Ref.: docs/DESIGN_posto_trabalho.md
-- ============================================================

-- ---------- cargo (catálogo simples) ----------
CREATE TABLE IF NOT EXISTS cargo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  salario_ref numeric(14,2),          -- default p/ salário de VAGA planejada
  ativo       boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

-- ---------- sindicato (data-base do dissídio) ----------
CREATE TABLE IF NOT EXISTS sindicato (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo        text NOT NULL,
  nome          text NOT NULL,
  mes_database  int NOT NULL DEFAULT 1 CHECK (mes_database BETWEEN 1 AND 12),
  ativo         boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

-- ---------- verba_folha (REESTRUTURADA: catálogo central de regras) ----------
-- Era o cadastro de verbas do ERP (nunca usado). Vira a regra de cálculo +
-- conta orçamentária de destino (Aplicar/conciliação). A coluna `tipo` antiga
-- (SALARIO/ENCARGO/...) fica VESTIGIAL — substituída por `tipo_calculo`.
ALTER TABLE verba_folha
  ADD COLUMN IF NOT EXISTS tipo_calculo text NOT NULL DEFAULT 'BASE'
    CHECK (tipo_calculo IN ('BASE','PCT_BASE','PCT_VERBA','PROVISAO_1_12','VALOR_FIXO','INFORMATIVA')),
  ADD COLUMN IF NOT EXISTS parametro        numeric,                  -- % / fator / valor
  ADD COLUMN IF NOT EXISTS verba_ref_id     uuid REFERENCES verba_folha ON DELETE SET NULL,  -- p/ PCT_VERBA
  ADD COLUMN IF NOT EXISTS conta_destino_id uuid REFERENCES conta_orcamentaria ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS incide_encargos  boolean NOT NULL DEFAULT true,  -- entra na base de PCT_BASE?
  ADD COLUMN IF NOT EXISTS ordem            int;

-- tipo_calculo:
--   BASE          → o próprio salário (base(mes))
--   PCT_BASE      → parametro% sobre a base de incidência (INSS, FGTS, rescisão-provisão)
--   PCT_VERBA     → parametro% sobre outra verba (verba_ref_id)
--   PROVISAO_1_12 → base × parametro(fator) / 12  (13º: fator 1; férias: 1,3333)
--   VALOR_FIXO    → parametro (benefício per capita/mês)
--   INFORMATIVA   → só de-para da folha (não orça)

-- ---------- posto (grão híbrido: funcionário nominal OU vaga planejada) ----------
CREATE TABLE IF NOT EXISTS posto (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo         text NOT NULL,
  cargo_id       uuid REFERENCES cargo ON DELETE SET NULL,
  empresa_id     uuid NOT NULL REFERENCES empresa,
  filial_id      uuid REFERENCES filial,           -- null = consolidado
  cc_id          uuid REFERENCES centro_custo,
  sindicato_id   uuid REFERENCES sindicato ON DELETE SET NULL,  -- null = sem dissídio (UI pode exigir)
  funcionario_id uuid REFERENCES funcionario ON DELETE SET NULL, -- null = VAGA planejada
  salario_base   numeric(14,2) NOT NULL DEFAULT 0, -- real (nominal) ou faixa (vaga)
  ini_ano        int,
  ini_mes        int CHECK (ini_mes BETWEEN 1 AND 12),  -- vigência no orçamento
  fim_ano        int,
  fim_mes        int CHECK (fim_mes BETWEEN 1 AND 12),  -- null = até dezembro
  fte            numeric(5,2) NOT NULL DEFAULT 1,   -- meio período etc.
  obs            text,
  ativo          boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_posto_empresa ON posto (tenant_id, empresa_id);

-- ---------- premissa_dissidio (% por versão × sindicato) ----------
CREATE TABLE IF NOT EXISTS premissa_dissidio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  versao_id    uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  sindicato_id uuid NOT NULL REFERENCES sindicato ON DELETE CASCADE,
  pct          numeric NOT NULL DEFAULT 0,          -- reajuste a partir do mes_database
  UNIQUE (versao_id, sindicato_id)
);

-- ---------- rateio_regra + rateio_destino (motor genérico de rateio) ----------
-- Custos de um funcionário/posto/cargo/CC redistribuídos por percentual (CSC).
-- Percentuais FIXOS por versão; sem regra = 100% na origem.
CREATE TABLE IF NOT EXISTS rateio_regra (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  escopo_tipo text NOT NULL CHECK (escopo_tipo IN ('FUNCIONARIO','POSTO','CARGO','CC')),
  escopo_id   uuid NOT NULL,                        -- id do funcionario/posto/cargo/centro_custo
  versao_id   uuid REFERENCES versao_orcamento ON DELETE CASCADE,  -- null = todas as versões
  mes_ini     int CHECK (mes_ini BETWEEN 1 AND 12), -- null = ano inteiro
  mes_fim     int CHECK (mes_fim BETWEEN 1 AND 12),
  ativo       boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_rateio_regra_lookup ON rateio_regra (tenant_id, escopo_tipo, escopo_id);

CREATE TABLE IF NOT EXISTS rateio_destino (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra_id    uuid NOT NULL REFERENCES rateio_regra ON DELETE CASCADE,
  empresa_id  uuid NOT NULL REFERENCES empresa,
  filial_id   uuid REFERENCES filial,               -- null = consolidado
  cc_id       uuid REFERENCES centro_custo,
  pct         numeric NOT NULL                      -- soma por regra = 100% (validação na tela)
);
CREATE INDEX IF NOT EXISTS ix_rateio_destino_regra ON rateio_destino (regra_id);

-- ---------- fat_orcado: habilita origem 'POSTO' (Aplicar do motor de postos) ----------
-- Aplicar apaga por (versao × empresa × origem='POSTO') e reinsere com
-- dims = {posto, funcionario, verba}. Recria o CHECK preservando os valores atuais.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'fat_orcado'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%origem%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE fat_orcado DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE fat_orcado ADD CONSTRAINT fat_orcado_origem_check
    CHECK (origem IN ('MANUAL','FORMULARIO','POSTO'));
END $$;

-- ---------- RLS (padrão current_tenant_id()) ----------
ALTER TABLE cargo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cargo_rls" ON cargo;
CREATE POLICY "cargo_rls" ON cargo FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sindicato ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sindicato_rls" ON sindicato;
CREATE POLICY "sindicato_rls" ON sindicato FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE posto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posto_rls" ON posto;
CREATE POLICY "posto_rls" ON posto FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE premissa_dissidio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "premissa_dissidio_rls" ON premissa_dissidio;
CREATE POLICY "premissa_dissidio_rls" ON premissa_dissidio FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE rateio_regra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rateio_regra_rls" ON rateio_regra;
CREATE POLICY "rateio_regra_rls" ON rateio_regra FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE rateio_destino ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rateio_destino_rls" ON rateio_destino;
CREATE POLICY "rateio_destino_rls" ON rateio_destino FOR ALL
  USING (EXISTS (SELECT 1 FROM rateio_regra r WHERE r.id = rateio_destino.regra_id AND r.tenant_id = current_tenant_id()));
