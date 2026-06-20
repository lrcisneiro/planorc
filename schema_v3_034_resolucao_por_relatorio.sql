-- ============================================================
-- 034 — Resolução conta→linha POR RELATÓRIO (corrige multi-amarração)
--
-- A migration 029 (cubo global cubo_realizado) resolvia cada conta para
-- UMA única linha (a amarração mais recente, global). Isso quebra o caso
-- legítimo de a MESMA conta estar amarrada a linhas diferentes em
-- relatórios diferentes: o valor ia só para a última, sumindo do outro.
--
-- Voltamos a resolver no momento da consulta, ESCOPADO às linhas do
-- relatório consultado (p_linhas), lendo do rollup mensal
-- fat_realizado_mensal (rápido). Dentro de um mesmo relatório, se a conta
-- cair em >1 linha, DISTINCT ON pega 1 (evita dobrar).
--
-- O cubo_realizado / cubo_realizado_anual deixam de ser usados; o refresh
-- passa a construir só o L1 (fat_realizado_mensal).
--
-- IDEMPOTENTE.
-- ============================================================

-- Consolidado por linha/ano/mês (escopo = p_linhas)
CREATE OR REPLACE FUNCTION relatorio_realizado_agg(
  p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH cl AS (
    SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c
    WHERE c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.conta_id, c.id DESC
  )
  SELECT t.linha_id, t.ano, t.mes, sum(t.v) AS valor
  FROM (
    SELECT m.linha_id, m.ano, m.mes, m.valor::numeric AS v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
    UNION ALL
    SELECT cl.linha_id, m.ano, m.mes, (m.valor * cl.sinal)::numeric AS v
    FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;

-- Por empresa × linha (orçado de fat_orcado; realizado escopado)
CREATE OR REPLACE FUNCTION relatorio_linha_empresa_agg(
  p_versao uuid, p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE(empresa_id uuid, linha_id uuid, orcado numeric, realizado numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH cl AS (
    SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c
    WHERE c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.conta_id, c.id DESC
  ),
  o AS (
    SELECT empresa_id, linha_id, sum(valor) v FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR cc_id = ANY(p_ccs))
    GROUP BY empresa_id, linha_id
  ),
  r AS (
    SELECT empresa_id, linha_id, sum(v) v FROM (
      SELECT m.empresa_id, m.linha_id, m.valor::numeric v
      FROM fat_realizado_mensal m
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
        AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
      UNION ALL
      SELECT m.empresa_id, cl.linha_id, (m.valor * cl.sinal)::numeric v
      FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
        AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
    ) t GROUP BY empresa_id, linha_id
  )
  SELECT COALESCE(o.empresa_id, r.empresa_id), COALESCE(o.linha_id, r.linha_id),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r ON o.empresa_id = r.empresa_id AND o.linha_id = r.linha_id
$$;

-- Anual (YTD) por linha/ano, escopado
CREATE OR REPLACE FUNCTION relatorio_realizado_anual(
  p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[]
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
    UNION ALL
    SELECT cl.linha_id, m.ano, (m.valor * cl.sinal)::numeric AS v
    FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
  ) t
  GROUP BY t.linha_id, t.ano
$$;

-- refresh passa a construir só o L1 (fat_realizado_mensal); cubos L2/L3 não são mais usados
CREATE OR REPLACE FUNCTION refresh_realizado_mensal()
RETURNS void
LANGUAGE sql VOLATILE
SET statement_timeout = '600s'
AS $$
  DELETE FROM fat_realizado_mensal WHERE tenant_id = current_tenant_id();
  INSERT INTO fat_realizado_mensal (tenant_id, conta_id, empresa_id, filial_id, cc_id, linha_id, ano, mes, valor)
  SELECT fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes, sum(fr.valor)
  FROM fat_realizado fr
  WHERE fr.tenant_id = current_tenant_id()
    AND NOT EXISTS (
      SELECT 1 FROM lote_ignorado li
      WHERE li.tenant_id = fr.tenant_id AND li.ativo
        AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
        AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
        AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
    )
  GROUP BY fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes;
$$;
