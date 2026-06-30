-- ============================================================
-- 047 — Agregação por Centro de Custo para os gráficos do Dashboard
-- Soma orçado (fat_orcado) e realizado por cc_id × linha (master) × ano × mês.
--
-- IMPORTANTE: o realizado é resolvido EXATAMENTE como na
-- relatorio_realizado_agg (migration 034): lê o rollup
-- fat_realizado_mensal e resolve conta→linha POR RELATÓRIO via
-- conta_linha (com sinal). NÃO usa cubo_realizado (desativado na 034).
-- Mantém o cc_id no group by para os gráficos "por área/CC".
--
-- Read-only, STABLE, RLS por tenant. Idempotente.
-- ============================================================
CREATE OR REPLACE FUNCTION dashboard_cc_agg(
  p_versao   uuid,
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE(cc_id uuid, linha_id uuid, ano int, mes int, orcado numeric, realizado numeric)
LANGUAGE sql STABLE
SET statement_timeout = '90s'
AS $$
  WITH cl AS (
    SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c
    WHERE c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.conta_id, c.id DESC
  ),
  o AS (
    SELECT cc_id, linha_id, ano, mes, sum(valor) v FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND empresa_id = ANY(p_empresas) AND ano = ANY(p_anos) AND mes = ANY(p_meses)
      AND linha_id = ANY(p_linhas)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR cc_id     = ANY(p_ccs))
    GROUP BY cc_id, linha_id, ano, mes
  ),
  r AS (
    SELECT cc_id, linha_id, ano, mes, sum(v) v FROM (
      -- realizado já resolvido na linha (master deste relatório)
      SELECT m.cc_id, m.linha_id, m.ano, m.mes, m.valor::numeric AS v
      FROM fat_realizado_mensal m
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
        AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR m.cc_id     = ANY(p_ccs))
      UNION ALL
      -- realizado sem linha → resolve conta→linha POR RELATÓRIO (com sinal)
      SELECT m.cc_id, cl.linha_id, m.ano, m.mes, (m.valor * cl.sinal)::numeric AS v
      FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
        AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR m.cc_id     = ANY(p_ccs))
    ) t
    GROUP BY cc_id, linha_id, ano, mes
  )
  SELECT COALESCE(o.cc_id, r.cc_id), COALESCE(o.linha_id, r.linha_id),
         COALESCE(o.ano, r.ano), COALESCE(o.mes, r.mes),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r
    ON o.cc_id IS NOT DISTINCT FROM r.cc_id AND o.linha_id = r.linha_id
   AND o.ano = r.ano AND o.mes = r.mes
  ORDER BY 2, 1, 3, 4   -- linha_id, cc_id, ano, mes — ordem estável p/ paginação no cliente
$$;
