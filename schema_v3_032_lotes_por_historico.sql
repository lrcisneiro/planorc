-- ============================================================
-- 032 — Diagnóstico de lotes de encerramento por HISTÓRICO
--
-- Encontra os lotes cujos lançamentos têm histórico contendo termos de
-- fechamento (ex.: ENCERRAMENTO, EXERCICIO, APURACAO). Alimenta o
-- "Sugerir fechamento por histórico" no cadastro de Lotes Ignorados.
-- p_ano NULL = todos os anos. Match por ILIKE (use raízes p/ pegar
-- variações, ex.: 'EXERC' cobre EXERCICIO/EXERCÍCIO).
--
-- IDEMPOTENTE.
-- ============================================================
CREATE OR REPLACE FUNCTION lotes_por_historico(p_termos text[], p_ano int DEFAULT NULL)
RETURNS TABLE(lote text, n bigint, soma numeric, bruto numeric, meses text, exemplos text)
LANGUAGE sql STABLE
SET statement_timeout = '90s'
AS $$
  SELECT fr.lote,
         count(*)            AS n,
         sum(fr.valor)       AS soma,
         sum(abs(fr.valor))  AS bruto,
         string_agg(DISTINCT lpad(fr.mes::text, 2, '0'), ',' ORDER BY lpad(fr.mes::text, 2, '0')) AS meses,
         array_to_string((array_agg(DISTINCT left(coalesce(fr.historico, ''), 60)))[1:3], ' | ')  AS exemplos
  FROM fat_realizado fr
  WHERE fr.tenant_id = current_tenant_id()
    AND fr.lote IS NOT NULL
    AND (p_ano IS NULL OR fr.ano = p_ano)
    AND EXISTS (SELECT 1 FROM unnest(p_termos) t WHERE fr.historico ILIKE '%' || t || '%')
  GROUP BY fr.lote
  ORDER BY count(*) DESC
$$;
