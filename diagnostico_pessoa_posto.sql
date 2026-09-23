-- ============================================================
-- Diagnóstico: por que uma pessoa não aparece na busca de amarração
-- Rode no SQL Editor. Troque o nome e a competência se precisar.
-- ============================================================

-- 1) a função já é a nova? (tem a coluna origem)
SELECT CASE WHEN pg_get_function_result(oid) LIKE '%origem%'
            THEN 'v3_096/097 aplicada' ELSE 'AINDA É A VERSÃO ANTIGA — rode as migrations' END AS versao
  FROM pg_proc WHERE proname = 'conciliacao_pessoas_folha';

-- 2) o posto existe, e com o que está preenchido?
SELECT p.codigo, p.nome, p.matricula, p.ativo,
       f.codigo AS filial, e.codigo AS empresa, cc.codigo AS cc,
       p.ini_ano, p.ini_mes, p.fim_ano, p.fim_mes,
       CASE WHEN coalesce(btrim(p.matricula), '') = ''
            THEN 'SEM MATRÍCULA — é vaga, não pode ser amarrada' ELSE 'ok' END AS obs
  FROM posto p
  LEFT JOIN filial f       ON f.id = p.filial_id
  LEFT JOIN empresa e      ON e.id = p.empresa_id
  LEFT JOIN centro_custo cc ON cc.id = p.cc_id
 WHERE p.tenant_id = current_tenant_id()
   AND (p.nome ILIKE '%KAIROF%' OR p.codigo ILIKE '%KAIROF%' OR p.matricula LIKE '8%');

-- 3) ele sai na lista da competência?
SELECT filial_cod, matricula, nome, origem, valor
  FROM conciliacao_pessoas_folha(2026, 8)
 WHERE nome ILIKE '%KAIROF%' OR matricula LIKE '8%';
