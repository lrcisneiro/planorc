-- ============================================================
-- Agregação por EMPRESA × ANO × MÊS (dashboard). Substitui/expande
-- relatorio_empresa_agg (014): agora retorna orçado e realizado por
-- empresa, ano e mês, com filtros de filial/CC. Realizado resolve via
-- linha direta (linha_id) + conta_linha (JOIN LATERAL, 1 por conta).
-- ============================================================
CREATE OR REPLACE FUNCTION relatorio_empresa_mes_agg(
  p_versao  uuid,
  p_anos    int[],
  p_meses   int[],
  p_linhas  uuid[],
  p_filiais uuid[] DEFAULT NULL,
  p_ccs     uuid[] DEFAULT NULL
) RETURNS TABLE(empresa_id uuid, ano int, mes int, orcado numeric, realizado numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  WITH o AS (
    SELECT empresa_id, ano, mes, sum(valor) v FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR cc_id     = ANY(p_ccs))
    GROUP BY empresa_id, ano, mes
  ),
  r AS (
    SELECT empresa_id, ano, mes, sum(v) v FROM (
      SELECT fr.empresa_id, fr.ano, fr.mes, fr.valor::numeric v
      FROM fat_realizado fr
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id = ANY(p_linhas)
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      UNION ALL
      SELECT fr.empresa_id, fr.ano, fr.mes, (fr.valor * cl.sinal)::numeric v
      FROM fat_realizado fr
      JOIN LATERAL (
        SELECT c.linha_id, c.sinal FROM conta_linha c
        WHERE c.conta_id = fr.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
        ORDER BY c.id DESC LIMIT 1
      ) cl ON true
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id IS NULL
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
    ) t GROUP BY empresa_id, ano, mes
  )
  SELECT COALESCE(o.empresa_id, r.empresa_id),
         COALESCE(o.ano, r.ano),
         COALESCE(o.mes, r.mes),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r
    ON o.empresa_id = r.empresa_id AND o.ano = r.ano AND o.mes = r.mes
$$;
