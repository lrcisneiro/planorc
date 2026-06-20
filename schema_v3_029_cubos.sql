-- ============================================================
-- 029 — Cubos do realizado (camada de agregação BI)
--
-- Conceito BI: tabelas agregadas ("aggregate navigation") em níveis:
--   L0  fat_realizado            — grão de razão (drill).
--   L1  fat_realizado_mensal     — soma por conta/empresa/filial/cc/mês (028).
--   L2  cubo_realizado           — JÁ resolvido conta→linha COM sinal, por
--                                  linha(master)/empresa/filial/cc/ano/mês.
--                                  Leitura de DRE/dash não precisa mais do join.
--   L3  cubo_realizado_anual     — soma por linha/empresa/ano (comparativo/CAGR).
--
-- Tudo derivado de fat_realizado (lotes ignorados já excluídos na L1).
-- Recalculado por refresh_realizado_mensal() após import/limpar/lotes/DE-PARA.
-- Orçado continua lido de fat_orcado direto (é pequeno e muda no editor).
--
-- IDEMPOTENTE.
-- ============================================================

-- ---------- L2: cubo por linha (master) × mês ----------
CREATE TABLE IF NOT EXISTS cubo_realizado (
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  linha_id   uuid NOT NULL,       -- conta_orcamentaria (master)
  empresa_id uuid NOT NULL,
  filial_id  uuid,
  cc_id      uuid,
  ano        int  NOT NULL,
  mes        int  NOT NULL,
  valor      numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubo_real_filtro ON cubo_realizado (tenant_id, ano, mes);
CREATE INDEX IF NOT EXISTS idx_cubo_real_emp    ON cubo_realizado (tenant_id, empresa_id, ano);
CREATE INDEX IF NOT EXISTS idx_cubo_real_linha  ON cubo_realizado (tenant_id, linha_id, ano);

ALTER TABLE cubo_realizado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cubo_real_rls ON cubo_realizado;
CREATE POLICY cubo_real_rls ON cubo_realizado
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ---------- L3: cubo anual por linha × empresa ----------
CREATE TABLE IF NOT EXISTS cubo_realizado_anual (
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  linha_id   uuid NOT NULL,
  empresa_id uuid NOT NULL,
  ano        int  NOT NULL,
  valor      numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cubo_real_anual ON cubo_realizado_anual (tenant_id, ano);
CREATE INDEX IF NOT EXISTS idx_cubo_real_anual_linha ON cubo_realizado_anual (tenant_id, linha_id);

ALTER TABLE cubo_realizado_anual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cubo_real_anual_rls ON cubo_realizado_anual;
CREATE POLICY cubo_real_anual_rls ON cubo_realizado_anual
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- refresh_realizado_mensal() — reconstrói L1 + L2 + L3 do tenant chamador
-- (mantém o nome pois o app já chama após import/limpar)
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_realizado_mensal()
RETURNS void
LANGUAGE sql VOLATILE
AS $$
  -- L1
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

  -- L2 (resolve conta→linha com sinal; 1 linha por conta = última)
  DELETE FROM cubo_realizado WHERE tenant_id = current_tenant_id();
  INSERT INTO cubo_realizado (tenant_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, valor)
  SELECT t.tenant_id, t.linha_id, t.empresa_id, t.filial_id, t.cc_id, t.ano, t.mes, sum(t.v)
  FROM (
    SELECT m.tenant_id, m.linha_id, m.empresa_id, m.filial_id, m.cc_id, m.ano, m.mes, m.valor v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NOT NULL
    UNION ALL
    SELECT m.tenant_id, cl.linha_id, m.empresa_id, m.filial_id, m.cc_id, m.ano, m.mes, (m.valor * cl.sinal) v
    FROM fat_realizado_mensal m
    JOIN (
      SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
      FROM conta_linha c WHERE c.tenant_id = current_tenant_id()
      ORDER BY c.conta_id, c.id DESC
    ) cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
  ) t
  GROUP BY t.tenant_id, t.linha_id, t.empresa_id, t.filial_id, t.cc_id, t.ano, t.mes;

  -- L3 (anual por linha × empresa)
  DELETE FROM cubo_realizado_anual WHERE tenant_id = current_tenant_id();
  INSERT INTO cubo_realizado_anual (tenant_id, linha_id, empresa_id, ano, valor)
  SELECT tenant_id, linha_id, empresa_id, ano, sum(valor)
  FROM cubo_realizado WHERE tenant_id = current_tenant_id()
  GROUP BY tenant_id, linha_id, empresa_id, ano;
$$;

-- ============================================================
-- População inicial p/ TODOS os tenants (roda como owner, ignora RLS)
-- ============================================================
TRUNCATE cubo_realizado;
INSERT INTO cubo_realizado (tenant_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, valor)
SELECT t.tenant_id, t.linha_id, t.empresa_id, t.filial_id, t.cc_id, t.ano, t.mes, sum(t.v)
FROM (
  SELECT m.tenant_id, m.linha_id, m.empresa_id, m.filial_id, m.cc_id, m.ano, m.mes, m.valor v
  FROM fat_realizado_mensal m WHERE m.linha_id IS NOT NULL
  UNION ALL
  SELECT m.tenant_id, cl.linha_id, m.empresa_id, m.filial_id, m.cc_id, m.ano, m.mes, (m.valor * cl.sinal) v
  FROM fat_realizado_mensal m
  JOIN (
    SELECT DISTINCT ON (c.tenant_id, c.conta_id) c.tenant_id, c.conta_id, c.linha_id, c.sinal
    FROM conta_linha c ORDER BY c.tenant_id, c.conta_id, c.id DESC
  ) cl ON cl.tenant_id = m.tenant_id AND cl.conta_id = m.conta_id
  WHERE m.linha_id IS NULL
) t
GROUP BY t.tenant_id, t.linha_id, t.empresa_id, t.filial_id, t.cc_id, t.ano, t.mes;

TRUNCATE cubo_realizado_anual;
INSERT INTO cubo_realizado_anual (tenant_id, linha_id, empresa_id, ano, valor)
SELECT tenant_id, linha_id, empresa_id, ano, sum(valor)
FROM cubo_realizado GROUP BY tenant_id, linha_id, empresa_id, ano;

ANALYZE cubo_realizado;
ANALYZE cubo_realizado_anual;

-- ============================================================
-- RPCs de leitura passam a usar o cubo (sem join de conta_linha)
-- ============================================================

-- Consolidado por linha/ano/mês (mesma assinatura de antes)
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
  SELECT c.linha_id, c.ano, c.mes, sum(c.valor) AS valor
  FROM cubo_realizado c
  WHERE c.tenant_id = current_tenant_id()
    AND c.linha_id = ANY(p_linhas)
    AND c.empresa_id = ANY(p_empresas) AND c.ano = ANY(p_anos) AND c.mes = ANY(p_meses)
    AND (p_filiais IS NULL OR c.filial_id = ANY(p_filiais))
    AND (p_ccs     IS NULL OR c.cc_id     = ANY(p_ccs))
  GROUP BY c.linha_id, c.ano, c.mes
$$;

-- Por empresa × linha (orçado de fat_orcado; realizado do cubo)
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
    SELECT empresa_id, linha_id, sum(valor) v FROM cubo_realizado
    WHERE tenant_id = current_tenant_id() AND linha_id = ANY(p_linhas)
      AND ano = ANY(p_anos) AND mes = ANY(p_meses)
      AND (p_filiais IS NULL OR filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR cc_id     = ANY(p_ccs))
    GROUP BY empresa_id, linha_id
  )
  SELECT COALESCE(o.empresa_id, r.empresa_id),
         COALESCE(o.linha_id, r.linha_id),
         COALESCE(o.v, 0), COALESCE(r.v, 0)
  FROM o FULL OUTER JOIN r
    ON o.empresa_id = r.empresa_id AND o.linha_id = r.linha_id
$$;

-- Anual: realizado por linha/ano (consolida empresas filtradas) — comparativo/CAGR
CREATE OR REPLACE FUNCTION relatorio_realizado_anual(
  p_empresas uuid[],
  p_anos     int[],
  p_linhas   uuid[]
) RETURNS TABLE(linha_id uuid, ano int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT linha_id, ano, sum(valor) AS valor
  FROM cubo_realizado_anual
  WHERE tenant_id = current_tenant_id()
    AND linha_id = ANY(p_linhas) AND empresa_id = ANY(p_empresas) AND ano = ANY(p_anos)
  GROUP BY linha_id, ano
$$;

-- Anual: orçado por linha/ano (de fat_orcado, somando os 12 meses)
CREATE OR REPLACE FUNCTION relatorio_orcado_anual(
  p_versao   uuid,
  p_empresas uuid[],
  p_anos     int[],
  p_linhas   uuid[]
) RETURNS TABLE(linha_id uuid, ano int, valor numeric, expr_n bigint)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT linha_id, ano, sum(valor) AS valor, count(*) AS expr_n
  FROM fat_orcado
  WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
    AND linha_id = ANY(p_linhas) AND empresa_id = ANY(p_empresas) AND ano = ANY(p_anos)
  GROUP BY linha_id, ano
$$;
