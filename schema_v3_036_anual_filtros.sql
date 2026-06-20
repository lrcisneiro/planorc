-- ============================================================
-- 036 — Filtros de filial/CC nas RPCs anuais (padronização de filtros)
--
-- Comparativo Anual e CAGR passam a aceitar p_filiais/p_ccs, como as RPCs
-- mensais já fazem, para os dashboards terem o mesmo conjunto de filtros
-- (empresa/filial/CC). Resolução conta→linha continua escopada a p_linhas.
--
-- IDEMPOTENTE.
-- ============================================================

DROP FUNCTION IF EXISTS relatorio_realizado_anual(uuid[], int[], int[], uuid[]);
CREATE OR REPLACE FUNCTION relatorio_realizado_anual(
  p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, valor numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH cl AS (
    SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c
    WHERE c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.conta_id, c.id DESC
  )
  SELECT t.linha_id, t.ano, sum(t.v) AS valor
  FROM (
    SELECT m.linha_id, m.ano, m.valor::numeric AS v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
    UNION ALL
    SELECT cl.linha_id, m.ano, (m.valor * cl.sinal)::numeric AS v
    FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
  ) t
  GROUP BY t.linha_id, t.ano
$$;

DROP FUNCTION IF EXISTS relatorio_orcado_anual(uuid, uuid[], int[], int[], uuid[]);
CREATE OR REPLACE FUNCTION relatorio_orcado_anual(
  p_versao uuid, p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, valor numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  SELECT linha_id, ano, sum(valor) AS valor
  FROM fat_orcado
  WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
    AND linha_id = ANY(p_linhas) AND empresa_id = ANY(p_empresas)
    AND ano = ANY(p_anos) AND mes = ANY(p_meses)
    AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
    AND (p_ccs IS NULL OR cc_id = ANY(p_ccs))
  GROUP BY linha_id, ano
$$;
