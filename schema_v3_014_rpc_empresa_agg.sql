-- ============================================================
-- Agregação por EMPRESA (dashboard): total orçado e realizado de um
-- relatório (linhas mestre p_linhas), por empresa. Realizado resolve
-- via conta_linha (1 por conta) + linha direta.
-- ============================================================
CREATE OR REPLACE FUNCTION relatorio_empresa_agg(
  p_versao uuid,
  p_anos   int[],
  p_meses  int[],
  p_linhas uuid[]
) RETURNS TABLE(empresa_id uuid, orcado numeric, realizado numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  WITH o AS (
    SELECT empresa_id, sum(valor) v FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
    GROUP BY empresa_id
  ),
  r AS (
    SELECT empresa_id, sum(v) v FROM (
      SELECT fr.empresa_id, fr.valor::numeric v
      FROM fat_realizado fr
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id = ANY(p_linhas)
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      UNION ALL
      SELECT fr.empresa_id, (fr.valor * cl.sinal)::numeric v
      FROM fat_realizado fr
      JOIN LATERAL (
        SELECT c.linha_id, c.sinal FROM conta_linha c
        WHERE c.conta_id = fr.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
        ORDER BY c.id DESC LIMIT 1
      ) cl ON true
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id IS NULL
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
    ) t GROUP BY empresa_id
  )
  SELECT e.id, COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM empresa e
  LEFT JOIN o ON o.empresa_id = e.id
  LEFT JOIN r ON r.empresa_id = e.id
  WHERE e.tenant_id = current_tenant_id()
    AND (COALESCE(o.v, 0) <> 0 OR COALESCE(r.v, 0) <> 0)
$$;
