-- ============================================================
-- RPCs de agregação do relatório (performance).
-- Em vez de baixar todos os lançamentos para o navegador, o banco
-- soma por linha mestre / ano / mês e devolve só os totais.
-- Resolve realizado via conta_linha (1 linha por conta — "última").
-- ============================================================

-- Orçado: soma por (linha, ano, mês); mantém fórmula da célula quando há 1 só lançamento.
CREATE OR REPLACE FUNCTION relatorio_orcado_agg(
  p_versao   uuid,
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric, n bigint, expr text, det boolean)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT fo.linha_id, fo.ano, fo.mes,
         sum(fo.valor)                                            AS valor,
         count(*)                                                 AS n,
         CASE WHEN count(*) = 1 THEN max(fo.expressao) END        AS expr,
         bool_or(fo.filial_id IS NOT NULL OR fo.cc_id IS NOT NULL) AS det
  FROM fat_orcado fo
  WHERE fo.tenant_id = current_tenant_id()
    AND fo.versao_id = p_versao
    AND fo.empresa_id = ANY(p_empresas)
    AND fo.ano = ANY(p_anos)
    AND fo.mes = ANY(p_meses)
    AND fo.linha_id = ANY(p_linhas)
    AND (p_filiais IS NULL OR fo.filial_id = ANY(p_filiais))
    AND (p_ccs     IS NULL OR fo.cc_id     = ANY(p_ccs))
  GROUP BY fo.linha_id, fo.ano, fo.mes
$$;

-- Realizado: resolve conta→linha (via conta_linha, 1 por conta) + linha direta; soma com sinal.
CREATE OR REPLACE FUNCTION relatorio_realizado_agg(
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT t.linha_id, t.ano, t.mes, sum(t.v) AS valor
  FROM (
    -- lançamentos com linha_id direto (manual)
    SELECT fr.linha_id, fr.ano, fr.mes, fr.valor::numeric AS v
    FROM fat_realizado fr
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.linha_id = ANY(p_linhas)
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
    UNION ALL
    -- lançamentos por conta (resolve via conta_linha; 1 linha por conta = a "última")
    SELECT cl.linha_id, fr.ano, fr.mes, (fr.valor * cl.sinal)::numeric AS v
    FROM fat_realizado fr
    JOIN LATERAL (
      SELECT c.linha_id, c.sinal FROM conta_linha c
      WHERE c.conta_id = fr.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
      ORDER BY c.id DESC LIMIT 1
    ) cl ON true
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.linha_id IS NULL
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;
