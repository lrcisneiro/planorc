-- ============================================================
-- Agregação por (EMPRESA × LINHA/CONTA ORÇAMENTÁRIA) — totais do período.
-- Alimenta o dashboard quando é preciso avaliar FÓRMULAS por empresa
-- (ex.: EBITDA), rodando a engine de cálculo no cliente por empresa.
-- Retorna orçado e realizado por empresa e por linha mestre (master).
-- Realizado resolve via linha direta (linha_id) + conta_linha (lateral).
--
-- SUBSTITUI relatorio_empresa_agg (014) e relatorio_empresa_mes_agg (015):
-- o total por empresa é obtido somando todas as linhas; não é preciso
-- rodar 015 — basta este 016.
-- ============================================================
CREATE OR REPLACE FUNCTION relatorio_linha_empresa_agg(
  p_versao  uuid,
  p_anos    int[],
  p_meses   int[],
  p_linhas  uuid[],
  p_filiais uuid[] DEFAULT NULL,
  p_ccs     uuid[] DEFAULT NULL
) RETURNS TABLE(empresa_id uuid, linha_id uuid, orcado numeric, realizado numeric)
LANGUAGE sql STABLE
SET statement_timeout = '90s'
AS $$
  WITH o AS (
    SELECT empresa_id, linha_id, sum(valor) v FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR cc_id     = ANY(p_ccs))
    GROUP BY empresa_id, linha_id
  ),
  r AS (
    SELECT empresa_id, linha_id, sum(v) v FROM (
      SELECT fr.empresa_id, fr.linha_id, fr.valor::numeric v
      FROM fat_realizado fr
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id = ANY(p_linhas)
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      UNION ALL
      SELECT fr.empresa_id, cl.linha_id, (fr.valor * cl.sinal)::numeric v
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
    ) t GROUP BY empresa_id, linha_id
  )
  SELECT COALESCE(o.empresa_id, r.empresa_id),
         COALESCE(o.linha_id, r.linha_id),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r
    ON o.empresa_id = r.empresa_id AND o.linha_id = r.linha_id
$$;
