-- ============================================================
-- 030 — Comparações anuais em base equivalente (YTD)
--
-- Comparar ano contra ano exige os MESMOS meses em todos os anos
-- (ex.: jan–mai/2026 vs jan–mai/2025), não o ano cheio. As RPCs anuais
-- passam a aceptar p_meses e somam só esses meses, lendo o cubo MENSAL
-- (cubo_realizado / fat_orcado). O cubo anual (L3) continua válido só p/
-- ano fechado e deixa de ser usado por estas telas.
--
-- IDEMPOTENTE.
-- ============================================================

-- Realizado anual (YTD): soma meses selecionados por linha/ano, do cubo mensal
DROP FUNCTION IF EXISTS relatorio_realizado_anual(uuid[], int[], uuid[]);
CREATE OR REPLACE FUNCTION relatorio_realizado_anual(
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[]
) RETURNS TABLE(linha_id uuid, ano int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT linha_id, ano, sum(valor) AS valor
  FROM cubo_realizado
  WHERE tenant_id = current_tenant_id()
    AND linha_id = ANY(p_linhas) AND empresa_id = ANY(p_empresas)
    AND ano = ANY(p_anos) AND mes = ANY(p_meses)
  GROUP BY linha_id, ano
$$;

-- Orçado anual (YTD): idem, de fat_orcado
DROP FUNCTION IF EXISTS relatorio_orcado_anual(uuid, uuid[], int[], uuid[]);
CREATE OR REPLACE FUNCTION relatorio_orcado_anual(
  p_versao   uuid,
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[]
) RETURNS TABLE(linha_id uuid, ano int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT linha_id, ano, sum(valor) AS valor
  FROM fat_orcado
  WHERE tenant_id = current_tenant_id() AND versao_id = p_versao
    AND linha_id = ANY(p_linhas) AND empresa_id = ANY(p_empresas)
    AND ano = ANY(p_anos) AND mes = ANY(p_meses)
  GROUP BY linha_id, ano
$$;
