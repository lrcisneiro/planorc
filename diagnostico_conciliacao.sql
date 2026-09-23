-- ============================================================
-- Diagnóstico: qual versão das funções está viva, e o que ela devolve
-- Rode no SQL Editor do Supabase. Troque o ano/mês se precisar.
-- ============================================================

-- 1) as funções que cada migration cria estão lá?
SELECT 'planorc_concil_contas_clt (v3_087)' AS funcao,
       to_char(count(*), 'FM9') AS existe FROM pg_proc WHERE proname = 'planorc_concil_contas_clt'
UNION ALL SELECT 'conciliacao_clt_outros (v3_088)',      to_char(count(*),'FM9') FROM pg_proc WHERE proname = 'conciliacao_clt_outros'
UNION ALL SELECT 'conciliacao_clt_outros_lanc (v3_088)', to_char(count(*),'FM9') FROM pg_proc WHERE proname = 'conciliacao_clt_outros_lanc'
UNION ALL SELECT 'planorc_pj_casa devolve mat_folha (v3_086)',
       CASE WHEN pg_get_function_result(oid) LIKE '%mat_folha%' THEN '1' ELSE '0' END
  FROM pg_proc WHERE proname = 'planorc_pj_casa'
UNION ALL SELECT 'conciliacao_clt usa FULL JOIN (v3_087)',
       CASE WHEN prosrc LIKE '%FULL JOIN fo f%' THEN '1' ELSE '0' END
  FROM pg_proc WHERE proname = 'conciliacao_clt'
UNION ALL SELECT 'conciliacao_terceiros corta por conta (v3_087)',
       CASE WHEN prosrc LIKE '%planorc_concil_contas_clt%' THEN '1' ELSE '0' END
  FROM pg_proc WHERE proname = 'conciliacao_terceiros';

-- 2) o CLT, SEM filtro de escopo: quantos pares e quanto de diferença
SELECT count(*) AS pares,
       count(*) FILTER (WHERE abs(razao - folha) > 1) AS fora_da_tolerancia,
       count(*) FILTER (WHERE razao = 0) AS so_folha_sem_razao,
       to_char(sum(razao), 'FM999G999G990D00') AS razao,
       to_char(sum(folha), 'FM999G999G990D00') AS folha,
       to_char(sum(razao - folha), 'FM999G999G990D00') AS diferenca
  FROM conciliacao_clt(2026, 8);

-- 3) as maiores divergências do CLT, sem filtro
SELECT conta_cod, verba_cod, left(coalesce(verba_desc, ''), 24) AS verba,
       to_char(razao, 'FM999G999G990D00') AS razao,
       to_char(folha, 'FM999G999G990D00') AS folha,
       to_char(razao - folha, 'FM999G999G990D00') AS dif
  FROM conciliacao_clt(2026, 8)
 WHERE abs(razao - folha) > 1
 ORDER BY abs(razao - folha) DESC LIMIT 10;

-- 4) a coluna "outros", sem filtro
SELECT cc.codigo AS conta, left(cc.descricao, 34) AS descricao,
       o.lancamentos, to_char(o.valor, 'FM999G999G990D00') AS outros
  FROM conciliacao_clt_outros(2026, 8) o
  JOIN conta_contabil cc ON cc.id = o.conta_id
 ORDER BY abs(o.valor) DESC LIMIT 10;
