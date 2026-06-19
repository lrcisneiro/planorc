-- ============================================================
-- Contas contábeis que têm movimento no realizado (para o filtro da
-- tela de Amarração). Agrega no banco (a fat_realizado é grande).
-- Retorna conta_id, nº de lançamentos e saldo (soma de valor).
-- ============================================================
CREATE OR REPLACE FUNCTION contas_com_movimento()
RETURNS TABLE(conta_id uuid, n bigint, saldo numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT conta_id, count(*)::bigint, sum(valor)::numeric
  FROM fat_realizado
  WHERE tenant_id = current_tenant_id() AND conta_id IS NOT NULL
  GROUP BY conta_id
$$;
