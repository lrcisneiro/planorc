-- ============================================================
-- 028 — Rollup mensal do realizado (escala p/ múltiplos anos)
--
-- fat_realizado é grão de razão (1M+ linhas). Para os relatórios/dashboards
-- só importa a SOMA por (conta, empresa, filial, cc, linha, ano, mês), já
-- excluindo lotes ignorados. Criamos uma tabela pré-agregada e apontamos
-- as RPCs de leitura para ela. O drill (razão) continua lendo o fat_realizado
-- cru. O rollup é recalculado pelo app após importar/limpar/mudar lotes.
--
-- IDEMPOTENTE.
-- ============================================================

CREATE TABLE IF NOT EXISTS fat_realizado_mensal (
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  conta_id   uuid,
  empresa_id uuid NOT NULL,
  filial_id  uuid,
  cc_id      uuid,
  linha_id   uuid,
  ano        int  NOT NULL,
  mes        int  NOT NULL,
  valor      numeric NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_frm_filtro ON fat_realizado_mensal (tenant_id, empresa_id, ano, mes);
CREATE INDEX IF NOT EXISTS idx_frm_conta  ON fat_realizado_mensal (tenant_id, conta_id, ano, mes);

ALTER TABLE fat_realizado_mensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frm_rls ON fat_realizado_mensal;
CREATE POLICY frm_rls ON fat_realizado_mensal
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Recalcula o rollup do tenant chamador (chamado pelo app após import/limpar/lotes)
CREATE OR REPLACE FUNCTION refresh_realizado_mensal()
RETURNS void
LANGUAGE sql VOLATILE
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

-- População inicial p/ TODOS os tenants (roda como owner, ignora RLS)
TRUNCATE fat_realizado_mensal;
INSERT INTO fat_realizado_mensal (tenant_id, conta_id, empresa_id, filial_id, cc_id, linha_id, ano, mes, valor)
SELECT fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes, sum(fr.valor)
FROM fat_realizado fr
WHERE NOT EXISTS (
  SELECT 1 FROM lote_ignorado li
  WHERE li.tenant_id = fr.tenant_id AND li.ativo
    AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
    AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
    AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
)
GROUP BY fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes;

ANALYZE fat_realizado_mensal;

-- ============================================================
-- RPCs de leitura passam a usar o rollup (lote já excluído nele).
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
  )
  SELECT t.linha_id, t.ano, t.mes, sum(t.v) AS valor
  FROM (
    SELECT m.linha_id, m.ano, m.mes, m.valor::numeric AS v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR m.cc_id     = ANY(p_ccs))
    UNION ALL
    SELECT cl.linha_id, m.ano, m.mes, (m.valor * cl.sinal)::numeric AS v
    FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
      AND m.empresa_id = ANY(p_empresas) AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR m.cc_id     = ANY(p_ccs))
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;

-- (2) Por empresa × linha (EBITDA etc.)
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
  r AS (
    SELECT empresa_id, linha_id, sum(v) v FROM (
      SELECT m.empresa_id, m.linha_id, m.valor::numeric v
      FROM fat_realizado_mensal m
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id = ANY(p_linhas)
        AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR m.cc_id     = ANY(p_ccs))
      UNION ALL
      SELECT m.empresa_id, cl.linha_id, (m.valor * cl.sinal)::numeric v
      FROM fat_realizado_mensal m JOIN cl ON cl.conta_id = m.conta_id
      WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
        AND m.ano = ANY(p_anos) AND m.mes = ANY(p_meses)
        AND (p_filiais IS NULL OR m.filial_id = ANY(p_filiais))
        AND (p_ccs     IS NULL OR m.cc_id     = ANY(p_ccs))
    ) t GROUP BY empresa_id, linha_id
  )
  SELECT COALESCE(o.empresa_id, r.empresa_id),
         COALESCE(o.linha_id, r.linha_id),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r
    ON o.empresa_id = r.empresa_id AND o.linha_id = r.linha_id
$$;
