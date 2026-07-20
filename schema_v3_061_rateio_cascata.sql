-- ============================================================
-- F5 · Posto de Trabalho — Rateio como CÓDIGO reutilizável (step 4)
--
-- O rateio do cliente é em cascata, por dimensão: primeiro distribui por CC
-- (origem → N CCs), depois por EMPRESA (→ N empresas, mesmo CC). A ORIGEM é
-- sempre o próprio posto (empresa/CC do posto) — não se cadastra origem.
--
-- Modelo: rateio_regra vira um CÓDIGO de rateio nomeado e reutilizável
--   nome     : rótulo do código (ex.: "CSC RH → empresas")
--   dimensao : 'CC' | 'EMPRESA'  — para onde o código distribui
-- e anexa-se ao posto via posto_rateio (posto_id, regra_id, ordem) — a ordem
-- é a sequência da cascata (CC=1, EMPRESA=2). Um posto pode ter N códigos.
-- rateio_destino é reusado: dimensao=CC preenche cc_id; dimensao=EMPRESA
-- preenche empresa_id. As colunas legadas escopo_tipo/escopo_id ficam
-- opcionais (não são mais a chave; origem = posto). Idempotente.
-- ============================================================

-- ---- rateio_regra vira "código de rateio" (nome + dimensao) ----
ALTER TABLE rateio_regra
  ADD COLUMN IF NOT EXISTS nome     text,
  ADD COLUMN IF NOT EXISTS dimensao text CHECK (dimensao IN ('CC', 'EMPRESA'));

-- origem deixa de ser obrigatória (origem = próprio posto)
ALTER TABLE rateio_regra ALTER COLUMN escopo_tipo DROP NOT NULL;
ALTER TABLE rateio_regra ALTER COLUMN escopo_id   DROP NOT NULL;

-- destino por CC não tem empresa (dimensao=CC preenche cc_id, empresa_id NULL)
ALTER TABLE rateio_destino ALTER COLUMN empresa_id DROP NOT NULL;

-- ---- posto_rateio: anexa códigos ao posto, em cascata (ordem) ----
CREATE TABLE IF NOT EXISTS posto_rateio (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  posto_id  uuid NOT NULL REFERENCES posto ON DELETE CASCADE,
  regra_id  uuid NOT NULL REFERENCES rateio_regra ON DELETE CASCADE,
  ordem     int  NOT NULL DEFAULT 1,   -- sequência da cascata
  UNIQUE (tenant_id, posto_id, regra_id)
);
CREATE INDEX IF NOT EXISTS ix_posto_rateio_posto ON posto_rateio (tenant_id, posto_id);

ALTER TABLE posto_rateio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posto_rateio_rls" ON posto_rateio;
CREATE POLICY "posto_rateio_rls" ON posto_rateio FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
