-- ============================================================
-- 079 — Metas e faixas de status por indicador (P1 dos indicadores operacionais)
--
-- Hoje os cards coloriam só por real × orçado. Indicadores como o LER precisam
-- de FAIXA ABSOLUTA (≥2,5x excelente / ≥2,0x saudável / ≥1,5x atenção), e meta é
-- dado vivo: evolui por ano (trilha 2026 → 2027 → 2028), pode variar por empresa
-- e carrega a referência de mercado que a justifica.
-- É o equivalente PLANORC da aba "Parâmetros" da planilha.
--
-- Herança (mesmo padrão das premissas globais da F5, v3_051): a linha vale para
-- todos os anos/empresas quando ano/empresa_id são NULL. A resolução do mais
-- específico para o mais genérico é feita no front (lib/indicadorMeta.ts).
--
-- `maior_melhor = false` inverte a leitura das faixas — para churn, DSO,
-- turnover e afins, onde menor é melhor.
--
-- IDEMPOTENTE.
-- ============================================================

CREATE TABLE IF NOT EXISTS indicador_meta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  linha_id      uuid NOT NULL REFERENCES relatorio_linha ON DELETE CASCADE,
  ano           int,                                    -- NULL = vale para todos os anos
  empresa_id    uuid REFERENCES empresa ON DELETE CASCADE,  -- NULL = todas as empresas
  maior_melhor  boolean NOT NULL DEFAULT true,
  excelente     numeric,     -- ≥ → Excelente (ou ≤, se maior_melhor = false)
  saudavel      numeric,     -- ≥ → Saudável
  atencao       numeric,     -- ≥ → Atenção; fora disso → Crítico
  benchmark_ref text,        -- ex.: 'Crabtree ≥2,0x' · 'SPI 2025: HPO 75%'
  comentario    text,
  UNIQUE NULLS NOT DISTINCT (tenant_id, linha_id, ano, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_indicador_meta_linha ON indicador_meta (tenant_id, linha_id);

ALTER TABLE indicador_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS indicador_meta_rls ON indicador_meta;
CREATE POLICY indicador_meta_rls ON indicador_meta FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
