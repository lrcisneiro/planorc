-- ============================================================
-- Multimoeda — passo 4: RPCs de agregação SOMAM POR SLOT (p_slot).
-- Design: docs/ESTUDO_multimoeda.md. Complementa v3_068/069 (colunas de slot).
--
-- Regra: p_slot int DEFAULT 1. slot 1 = coluna base (valor / saldo); 2..5 = val_m2..val_m5.
-- Sem p_slot → soma a base como hoje (retrocompat: telas atuais não mudam).
-- O front NUNCA converte — pede o slot e recebe o valor já somado.
--
-- O realizado passa por rollup (fat_realizado_mensal): este ganha val_m2..m5 e o
-- refresh soma-as. RE-RODAR refresh_realizado_mensal() após esta migration para
-- popular os slots do rollup (e recalcular os fatos antigos — ver rotina no app).
--
-- CREATE OR REPLACE não troca assinatura (p_slot muda a aridade) → DROP + CREATE.
-- IDEMPOTENTE.
-- ============================================================

-- ---- rollup do realizado ganha os slots + refresh soma-as ----
ALTER TABLE fat_realizado_mensal
  ADD COLUMN IF NOT EXISTS val_m2 numeric,
  ADD COLUMN IF NOT EXISTS val_m3 numeric,
  ADD COLUMN IF NOT EXISTS val_m4 numeric,
  ADD COLUMN IF NOT EXISTS val_m5 numeric;

CREATE OR REPLACE FUNCTION refresh_realizado_mensal()
RETURNS void
LANGUAGE sql VOLATILE
SET statement_timeout = '600s'
AS $$
  DELETE FROM fat_realizado_mensal WHERE tenant_id = current_tenant_id();
  INSERT INTO fat_realizado_mensal (tenant_id, conta_id, empresa_id, filial_id, cc_id, linha_id, ano, mes, valor, val_m2, val_m3, val_m4, val_m5)
  SELECT fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes,
         sum(fr.valor), sum(fr.val_m2), sum(fr.val_m3), sum(fr.val_m4), sum(fr.val_m5)
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

-- ================= ORÇADO (fat_orcado direto) =================
DROP FUNCTION IF EXISTS relatorio_orcado_agg(uuid, uuid[], int[], int[], uuid[], uuid[], uuid[]);
CREATE FUNCTION relatorio_orcado_agg(
  p_versao uuid, p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot int DEFAULT 1
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric, n bigint, expr text, det boolean)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT fo.linha_id, fo.ano, fo.mes,
         sum(CASE p_slot WHEN 2 THEN fo.val_m2 WHEN 3 THEN fo.val_m3 WHEN 4 THEN fo.val_m4 WHEN 5 THEN fo.val_m5 ELSE fo.valor END) AS valor,
         count(*) AS n,
         CASE WHEN count(*) = 1 THEN max(fo.expressao) END AS expr,
         bool_or(fo.filial_id IS NOT NULL OR fo.cc_id IS NOT NULL) AS det
  FROM fat_orcado fo
  WHERE fo.tenant_id = current_tenant_id()
    AND fo.versao_id = p_versao AND fo.empresa_id = ANY(p_empresas)
    AND fo.ano = ANY(p_anos) AND fo.mes = ANY(p_meses) AND fo.linha_id = ANY(p_linhas)
    AND (p_filiais IS NULL OR fo.filial_id = ANY(p_filiais))
    AND (p_ccs     IS NULL OR fo.cc_id     = ANY(p_ccs))
  GROUP BY fo.linha_id, fo.ano, fo.mes
$$;

DROP FUNCTION IF EXISTS relatorio_orcado_anual(uuid, uuid[], int[], int[], uuid[], uuid[], uuid[]);
CREATE FUNCTION relatorio_orcado_anual(
  p_versao uuid, p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot int DEFAULT 1
) RETURNS TABLE(linha_id uuid, ano int, valor numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  SELECT linha_id, ano,
         sum(CASE p_slot WHEN 2 THEN val_m2 WHEN 3 THEN val_m3 WHEN 4 THEN val_m4 WHEN 5 THEN val_m5 ELSE valor END) AS valor
  FROM fat_orcado
  WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
    AND linha_id = ANY(p_linhas) AND empresa_id = ANY(p_empresas)
    AND ano = ANY(p_anos) AND mes = ANY(p_meses)
    AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
    AND (p_ccs IS NULL OR cc_id = ANY(p_ccs))
  GROUP BY linha_id, ano
$$;

-- ================= SALDO (fat_saldo direto; base = saldo) =================
DROP FUNCTION IF EXISTS relatorio_saldo_agg(uuid[], int, int[], uuid[], uuid[]);
CREATE FUNCTION relatorio_saldo_agg(
  p_empresas uuid[], p_ano int, p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_slot int DEFAULT 1
) RETURNS TABLE(linha_id uuid, mes int, saldo numeric)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT cl.linha_id, fs.mes,
         sum((CASE p_slot WHEN 2 THEN fs.val_m2 WHEN 3 THEN fs.val_m3 WHEN 4 THEN fs.val_m4 WHEN 5 THEN fs.val_m5 ELSE fs.saldo END) * cl.sinal)::numeric
  FROM fat_saldo fs
  JOIN LATERAL (
    SELECT c.linha_id, c.sinal FROM conta_linha c
    WHERE c.conta_id = fs.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.id DESC LIMIT 1
  ) cl ON true
  WHERE fs.tenant_id = current_tenant_id() AND fs.empresa_id = ANY(p_empresas)
    AND fs.ano = p_ano AND fs.mes = ANY(p_meses)
    AND (p_filiais IS NULL OR fs.filial_id = ANY(p_filiais))
  GROUP BY cl.linha_id, fs.mes
$$;

-- ================= REALIZADO via rollup (fat_realizado_mensal) =================
DROP FUNCTION IF EXISTS relatorio_realizado_agg(uuid[], int[], int[], uuid[], uuid[], uuid[]);
CREATE FUNCTION relatorio_realizado_agg(
  p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot int DEFAULT 1
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
    SELECT m.linha_id, m.ano, m.mes,
           (CASE p_slot WHEN 2 THEN m.val_m2 WHEN 3 THEN m.val_m3 WHEN 4 THEN m.val_m4 WHEN 5 THEN m.val_m5 ELSE m.valor END)::numeric AS v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
    UNION ALL
    SELECT cl.linha_id, m.ano, m.mes,
           ((CASE p_slot WHEN 2 THEN m.val_m2 WHEN 3 THEN m.val_m3 WHEN 4 THEN m.val_m4 WHEN 5 THEN m.val_m5 ELSE m.valor END) * cl.sinal)::numeric AS v
    FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;

DROP FUNCTION IF EXISTS relatorio_realizado_anual(uuid[], int[], int[], uuid[], uuid[], uuid[]);
CREATE FUNCTION relatorio_realizado_anual(
  p_empresas uuid[], p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot int DEFAULT 1
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
    SELECT m.linha_id, m.ano,
           (CASE p_slot WHEN 2 THEN m.val_m2 WHEN 3 THEN m.val_m3 WHEN 4 THEN m.val_m4 WHEN 5 THEN m.val_m5 ELSE m.valor END)::numeric AS v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
    UNION ALL
    SELECT cl.linha_id, m.ano,
           ((CASE p_slot WHEN 2 THEN m.val_m2 WHEN 3 THEN m.val_m3 WHEN 4 THEN m.val_m4 WHEN 5 THEN m.val_m5 ELSE m.valor END) * cl.sinal)::numeric AS v
    FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
  ) t
  GROUP BY t.linha_id, t.ano
$$;

-- ================= POR EMPRESA × LINHA (orçado direto + realizado rollup) =================
DROP FUNCTION IF EXISTS relatorio_linha_empresa_agg(uuid, int[], int[], uuid[], uuid[], uuid[]);
CREATE FUNCTION relatorio_linha_empresa_agg(
  p_versao uuid, p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot int DEFAULT 1
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
    SELECT empresa_id, linha_id,
           sum(CASE p_slot WHEN 2 THEN val_m2 WHEN 3 THEN val_m3 WHEN 4 THEN val_m4 WHEN 5 THEN val_m5 ELSE valor END) v
    FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs IS NULL OR cc_id = ANY(p_ccs))
    GROUP BY empresa_id, linha_id
  ),
  r AS (
    SELECT empresa_id, linha_id, sum(v) v FROM (
      SELECT m.empresa_id, m.linha_id,
             (CASE p_slot WHEN 2 THEN m.val_m2 WHEN 3 THEN m.val_m3 WHEN 4 THEN m.val_m4 WHEN 5 THEN m.val_m5 ELSE m.valor END)::numeric v
      FROM fat_realizado_mensal m
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
        AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs IS NULL OR m.cc_id = ANY(p_ccs))
      UNION ALL
      SELECT m.empresa_id, cl.linha_id,
             ((CASE p_slot WHEN 2 THEN m.val_m2 WHEN 3 THEN m.val_m3 WHEN 4 THEN m.val_m4 WHEN 5 THEN m.val_m5 ELSE m.valor END) * cl.sinal)::numeric v
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

-- ================= POR EMPRESA (orçado direto + realizado fat_realizado DIRETO) =================
DROP FUNCTION IF EXISTS relatorio_empresa_agg(uuid, int[], int[], uuid[]);
CREATE FUNCTION relatorio_empresa_agg(
  p_versao uuid, p_anos int[], p_meses int[], p_linhas uuid[], p_slot int DEFAULT 1
) RETURNS TABLE(empresa_id uuid, orcado numeric, realizado numeric)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH o AS (
    SELECT empresa_id, sum(CASE p_slot WHEN 2 THEN val_m2 WHEN 3 THEN val_m3 WHEN 4 THEN val_m4 WHEN 5 THEN val_m5 ELSE valor END) v
    FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
    GROUP BY empresa_id
  ),
  r AS (
    SELECT empresa_id, sum(v) v FROM (
      SELECT fr.empresa_id, (CASE p_slot WHEN 2 THEN fr.val_m2 WHEN 3 THEN fr.val_m3 WHEN 4 THEN fr.val_m4 WHEN 5 THEN fr.val_m5 ELSE fr.valor END)::numeric v
      FROM fat_realizado fr
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id = ANY(p_linhas)
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      UNION ALL
      SELECT fr.empresa_id, ((CASE p_slot WHEN 2 THEN fr.val_m2 WHEN 3 THEN fr.val_m3 WHEN 4 THEN fr.val_m4 WHEN 5 THEN fr.val_m5 ELSE fr.valor END) * cl.sinal)::numeric v
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

DROP FUNCTION IF EXISTS relatorio_empresa_mes_agg(uuid, int[], int[], uuid[], uuid[], uuid[]);
CREATE FUNCTION relatorio_empresa_mes_agg(
  p_versao uuid, p_anos int[], p_meses int[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot int DEFAULT 1
) RETURNS TABLE(empresa_id uuid, ano int, mes int, orcado numeric, realizado numeric)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH o AS (
    SELECT empresa_id, ano, mes, sum(CASE p_slot WHEN 2 THEN val_m2 WHEN 3 THEN val_m3 WHEN 4 THEN val_m4 WHEN 5 THEN val_m5 ELSE valor END) v
    FROM fat_orcado
    WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
      AND ano = ANY(p_anos) AND mes = ANY(p_meses) AND linha_id = ANY(p_linhas)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR cc_id     = ANY(p_ccs))
    GROUP BY empresa_id, ano, mes
  ),
  r AS (
    SELECT empresa_id, ano, mes, sum(v) v FROM (
      SELECT fr.empresa_id, fr.ano, fr.mes, (CASE p_slot WHEN 2 THEN fr.val_m2 WHEN 3 THEN fr.val_m3 WHEN 4 THEN fr.val_m4 WHEN 5 THEN fr.val_m5 ELSE fr.valor END)::numeric v
      FROM fat_realizado fr
      WHERE fr.tenant_id = current_tenant_id() AND fr.linha_id = ANY(p_linhas)
        AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      UNION ALL
      SELECT fr.empresa_id, fr.ano, fr.mes, ((CASE p_slot WHEN 2 THEN fr.val_m2 WHEN 3 THEN fr.val_m3 WHEN 4 THEN fr.val_m4 WHEN 5 THEN fr.val_m5 ELSE fr.valor END) * cl.sinal)::numeric v
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
  SELECT COALESCE(o.empresa_id, r.empresa_id), COALESCE(o.ano, r.ano), COALESCE(o.mes, r.mes),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r ON o.empresa_id = r.empresa_id AND o.ano = r.ano AND o.mes = r.mes
$$;
