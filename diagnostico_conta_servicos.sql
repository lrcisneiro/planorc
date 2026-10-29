-- ============================================================
-- A busca de candidatas do seed_formulario_servicos.sql não devolveu nada.
-- Isto olha mais largo: confirma que a linha METASV existe, mostra como as
-- contas de RECEITA estão de fato cadastradas e quais contas o MRR e o NR já
-- usam como destino — a de serviços deve ser vizinha delas.
-- Só leitura. Uma consulta só.
-- ============================================================
WITH linha AS (
  SELECT l.codigo, l.descricao, l.tipo_linha,
         CASE WHEN l.conta_destino_id IS NULL THEN '(sem conta)' ELSE 'tem conta' END AS destino
  FROM formulario f JOIN formulario_linha l ON l.formulario_id = f.id
  WHERE f.codigo = 'SERVICO'
),
nat AS (
  SELECT coalesce(natureza, '(nulo)') AS natureza, count(*) n
  FROM conta_orcamentaria GROUP BY 1
),
usadas AS (
  -- as contas que os OUTROS formulários já gravam: a de serviços é parente
  SELECT DISTINCT f.codigo AS form, co.codigo, co.descricao,
         coalesce(co.natureza, '(nulo)') AS natureza
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
  JOIN conta_orcamentaria co ON co.id = l.conta_destino_id
),
amarr AS (
  -- agregado UMA vez e juntado depois. Correlacionar um count por conta é o
  -- que estourou o timeout da primeira tentativa (lá era sobre fat_realizado,
  -- a tabela do razão: um scan por conta).
  SELECT linha_id, count(*) n FROM conta_linha GROUP BY linha_id
),
vizinhas AS (
  -- tudo que começa com 1 (faixa de receita, onde mora a 10201) + qualquer
  -- coisa que cheire a serviço, sem filtrar natureza
  SELECT co.codigo, co.descricao, coalesce(co.natureza,'(nulo)') AS natureza,
         coalesce(a.n, 0) AS contas_amarradas
  FROM conta_orcamentaria co
  LEFT JOIN amarr a ON a.linha_id = co.id
  WHERE co.codigo LIKE '1%'
     OR co.descricao ILIKE '%serv%'
     OR co.descricao ILIKE '%receita%'
)
SELECT '1 · linhas do formulário SERVICO' AS secao, codigo AS a, descricao AS b, tipo_linha AS c, destino AS d FROM linha
UNION ALL
SELECT '2 · naturezas cadastradas', natureza, n::text, '', '' FROM nat
UNION ALL
SELECT '3 · contas já usadas por formulário', form || ' → ' || codigo, descricao, natureza, '' FROM usadas
UNION ALL
SELECT '4 · candidatas (faixa 1x ou nome)', codigo, descricao, natureza,
       contas_amarradas || ' conta(s) contábil(is) amarrada(s)' FROM vizinhas
ORDER BY 1, 2;
