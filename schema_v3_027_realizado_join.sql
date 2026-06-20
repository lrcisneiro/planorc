-- ============================================================
-- 027 — Realizado: trocar LATERAL por-linha por hash-join com mapa
--
-- As RPCs do realizado resolviam conta→linha com um JOIN LATERAL
-- executado UMA VEZ POR LANÇAMENTO (centenas de milhares). Aqui o mapa
-- conta→linha (1 por conta = a "última") é pré-resolvido em um CTE
-- (DISTINCT ON) e juntado por hash-join — escala muito melhor em 1M+ linhas.
-- Mesmo resultado de antes. Mantém exclusão de lote inline.
--
-- IDEMPOTENTE.
-- ============================================================

-- (1) Consolidado por linha/ano/mês
CREATE OR REPLACE FUNCTION relatorio_realizado_agg(
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '90s'
AS $$
  WITH cl AS (
    SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c
    WHERE c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.conta_id, c.id DESC
  ),
  base AS (
    SELECT fr.linha_id, fr.conta_id, fr.ano, fr.mes, fr.valor
    FROM fat_realizado fr
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      AND NOT EXISTS (
        SELECT 1 FROM lote_ignorado li
        WHERE li.tenant_id = current_tenant_id() AND li.ativo
          AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
          AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
          AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
      )
  )
  SELECT t.linha_id, t.ano, t.mes, sum(t.v) AS valor
  FROM (
    SELECT b.linha_id, b.ano, b.mes, b.valor::numeric AS v
    FROM base b WHERE b.linha_id = ANY(p_linhas)
    UNION ALL
    SELECT cl.linha_id, b.ano, b.mes, (b.valor * cl.sinal)::numeric AS v
    FROM base b JOIN cl ON cl.conta_id = b.conta_id
    WHERE b.linha_id IS NULL
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;

-- (2) Por empresa × linha (EBITDA etc.) — mesmo padrão + exclusão de lote
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
      AND (p_ccs     IS NULL OR cc_id     = ANY(p_ccs))
    GROUP BY empresa_id, linha_id
  ),
  base AS (
    SELECT fr.empresa_id, fr.linha_id, fr.conta_id, fr.valor
    FROM fat_realizado fr
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      AND NOT EXISTS (
        SELECT 1 FROM lote_ignorado li
        WHERE li.tenant_id = current_tenant_id() AND li.ativo
          AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
          AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
          AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
      )
  ),
  r AS (
    SELECT empresa_id, linha_id, sum(v) v FROM (
      SELECT b.empresa_id, b.linha_id, b.valor::numeric v
      FROM base b WHERE b.linha_id = ANY(p_linhas)
      UNION ALL
      SELECT b.empresa_id, cl.linha_id, (b.valor * cl.sinal)::numeric v
      FROM base b JOIN cl ON cl.conta_id = b.conta_id
      WHERE b.linha_id IS NULL
    ) t GROUP BY empresa_id, linha_id
  )
  SELECT COALESCE(o.empresa_id, r.empresa_id),
         COALESCE(o.linha_id, r.linha_id),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r
    ON o.empresa_id = r.empresa_id AND o.linha_id = r.linha_id
$$;
