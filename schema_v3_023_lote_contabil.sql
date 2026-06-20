-- ============================================================
-- 023 — Lote contábil em fat_realizado + cadastro de lotes a ignorar
--
-- No TOTVS o lançamento contábil é identificado por LOTE/SUBLOTE/DOC/LINHA.
-- Existem lotes de ENCERRAMENTO/APURAÇÃO que zeram as contas de resultado
-- (transferem o saldo para conta patrimonial). Para comparativos a partir de
-- MOVIMENTO (DRE por fluxo), esses lotes precisam ser ignorados.
--
-- Estratégia escolhida: gravar lote/sublote no fat_realizado e EXCLUIR na
-- consulta os lotes cadastrados em `lote_ignorado` (ativo). Há ainda a flag
-- `pular_import` para nem gravar a linha na importação.
--
-- IDEMPOTENTE.
-- ============================================================

-- 1) Colunas de lote no fato do realizado
ALTER TABLE fat_realizado ADD COLUMN IF NOT EXISTS lote    text;
ALTER TABLE fat_realizado ADD COLUMN IF NOT EXISTS sublote text;
CREATE INDEX IF NOT EXISTS idx_fat_realizado_lote ON fat_realizado (tenant_id, lote);

-- 2) Cadastro de lotes a ignorar
--    sublote NULL    = vale para todos os sublotes do lote
--    empresa_id NULL = vale para todas as empresas
CREATE TABLE IF NOT EXISTS lote_ignorado (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  lote         text NOT NULL,
  sublote      text,
  empresa_id   uuid REFERENCES empresa ON DELETE CASCADE,
  descricao    text,
  ativo        boolean NOT NULL DEFAULT true,   -- excluir na consulta
  pular_import boolean NOT NULL DEFAULT false,  -- nem gravar na importação
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE lote_ignorado DROP CONSTRAINT IF EXISTS uq_lote_ignorado;
ALTER TABLE lote_ignorado ADD CONSTRAINT uq_lote_ignorado
  UNIQUE NULLS NOT DISTINCT (tenant_id, lote, sublote, empresa_id);

CREATE INDEX IF NOT EXISTS idx_lote_ignorado_lookup ON lote_ignorado (tenant_id, ativo);

ALTER TABLE lote_ignorado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lote_ignorado_rls ON lote_ignorado;
CREATE POLICY lote_ignorado_rls ON lote_ignorado
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- 3) Helper: o lançamento bate com algum lote ignorado ativo?
--    (lote NULL nunca bate → lançamentos manuais/antigos seguem contando)
CREATE OR REPLACE FUNCTION lote_eh_ignorado(p_lote text, p_sublote text, p_empresa uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM lote_ignorado li
    WHERE li.tenant_id = current_tenant_id() AND li.ativo
      AND li.lote = p_lote
      AND (li.sublote   IS NULL OR li.sublote   = p_sublote)
      AND (li.empresa_id IS NULL OR li.empresa_id = p_empresa)
  )
$$;

-- 4) RPC do realizado passa a excluir os lotes ignorados ativos
CREATE OR REPLACE FUNCTION relatorio_realizado_agg(
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT t.linha_id, t.ano, t.mes, sum(t.v) AS valor
  FROM (
    -- lançamentos com linha_id direto (manual)
    SELECT fr.linha_id, fr.ano, fr.mes, fr.valor::numeric AS v
    FROM fat_realizado fr
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.linha_id = ANY(p_linhas)
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      AND NOT lote_eh_ignorado(fr.lote, fr.sublote, fr.empresa_id)
    UNION ALL
    -- lançamentos por conta (resolve via conta_linha; 1 linha por conta = a "última")
    SELECT cl.linha_id, fr.ano, fr.mes, (fr.valor * cl.sinal)::numeric AS v
    FROM fat_realizado fr
    JOIN LATERAL (
      SELECT c.linha_id, c.sinal FROM conta_linha c
      WHERE c.conta_id = fr.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
      ORDER BY c.id DESC LIMIT 1
    ) cl ON true
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.linha_id IS NULL
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      AND NOT lote_eh_ignorado(fr.lote, fr.sublote, fr.empresa_id)
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;

-- 5) Helper para a UI: lista lotes candidatos a encerramento — lotes cujo
--    impacto líquido nas contas de RESULTADO no ano é ~zero mas têm volume.
--    (natureza do item via conta_linha → relatorio_linha → conta_orcamentaria)
--    Use só como SUGESTÃO; o usuário confirma no cadastro.
CREATE OR REPLACE FUNCTION lotes_candidatos_encerramento(p_ano int)
RETURNS TABLE(lote text, sublote text, empresa_id uuid, linhas bigint, soma numeric, bruto numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT fr.lote, fr.sublote, fr.empresa_id,
         count(*)             AS linhas,
         sum(fr.valor)        AS soma,
         sum(abs(fr.valor))   AS bruto
  FROM fat_realizado fr
  WHERE fr.tenant_id = current_tenant_id()
    AND fr.ano = p_ano
    AND fr.lote IS NOT NULL
  GROUP BY fr.lote, fr.sublote, fr.empresa_id
  HAVING sum(abs(fr.valor)) > 0
     AND abs(sum(fr.valor)) < 0.01 * sum(abs(fr.valor))  -- líquido < 1% do bruto
  ORDER BY sum(abs(fr.valor)) DESC
$$;
