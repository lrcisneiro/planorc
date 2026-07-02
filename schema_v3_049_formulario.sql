-- ============================================================
-- F5 — Formulário de drivers (memória de cálculo que alimenta o orçado)
-- Cria formulario / formulario_linha / formulario_valor ALINHADOS ao modelo
-- vivo pós-repoint (F1/F2): a linha-resultado posta seu valor numa CONTA
-- ORÇAMENTÁRIA mestre (conta_orcamentaria), que é o grão de fat_orcado.linha_id.
-- Idempotente: usa IF NOT EXISTS e guardas p/ conviver com o que já existe.
-- ============================================================

-- ---------- formulario ----------
CREATE TABLE IF NOT EXISTS formulario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  descricao   text,
  UNIQUE (tenant_id, codigo)
);

-- ---------- formulario_linha (hierárquico) ----------
CREATE TABLE IF NOT EXISTS formulario_linha (
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
  -- Linha-resultado: "Aplicar" posta o valor calculado nesta conta ORÇAMENTÁRIA (mestre),
  -- que vira fat_orcado.linha_id. NULL = linha auxiliar (driver) que não sai para o orçado.
  conta_destino_id  uuid REFERENCES conta_orcamentaria ON DELETE SET NULL,
  UNIQUE (formulario_id, codigo)
);

-- ---------- formulario_valor (fato: célula do formulário) ----------
CREATE TABLE IF NOT EXISTS formulario_valor (
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_formulario_valor
  ON formulario_valor (versao_id, linha_id, empresa_id,
                       COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       ano, mes, (dims::text));
CREATE INDEX IF NOT EXISTS ix_formulario_valor_lookup
  ON formulario_valor (formulario_id, versao_id, empresa_id, ano);

-- ---------- fat_orcado: garantir colunas de origem (podem já existir no vivo) ----------
ALTER TABLE fat_orcado ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE fat_orcado ADD COLUMN IF NOT EXISTS origem_formulario_linha_id
  uuid REFERENCES formulario_linha ON DELETE SET NULL;

-- garante que o CHECK de `origem` aceita FORMULARIO (recria o que existir)
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'fat_orcado'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%origem%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE fat_orcado DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE fat_orcado ADD CONSTRAINT fat_orcado_origem_check CHECK (origem IN ('MANUAL','FORMULARIO'));
END $$;

-- ---------- RLS (padrão current_tenant_id()) ----------
ALTER TABLE formulario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formulario_rls" ON formulario;
CREATE POLICY "formulario_rls" ON formulario FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE formulario_linha ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formulario_linha_rls" ON formulario_linha;
CREATE POLICY "formulario_linha_rls" ON formulario_linha FOR ALL
  USING (EXISTS (SELECT 1 FROM formulario f WHERE f.id = formulario_linha.formulario_id AND f.tenant_id = current_tenant_id()));

ALTER TABLE formulario_valor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formulario_valor_rls" ON formulario_valor;
CREATE POLICY "formulario_valor_rls" ON formulario_valor FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
