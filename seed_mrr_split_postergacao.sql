-- ============================================================
-- MRR: separa base × nova e calibra a POSTERGAÇÃO de início
--
-- Três coisas, numa conta só (10201 · Receita Recorrente, a que já está lá).
-- A separação é para LER e CALIBRAR, não para a DRE — o orçado continua
-- recebendo um número por mês, agora o realista.
--
-- 1) BASE × NOVA. Hoje o `MRR` mistura a carteira que evolui com a receita
--    nova que se acumula, e depois do 2º mês não dá mais para distinguir.
--    Dois estoques separados resolvem, e a soma é IDÊNTICA à de hoje:
--      MRRBASE = (ANTERIOR() + [BASE]) * fatores
--      MRRNOVO =  ANTERIOR()           * fatores + [RECNOVA]
--
-- 2) POSTERGAÇÃO. O atraso SISTEMÁTICO já estava no modelo: `ANTERIOR([META])`
--    é "vendeu em m, recebe em m+1" — o caso de negociar para janeiro e cair
--    em fevereiro. `POST1`/`POST2` são as postergações ALÉM dessa, que é o que
--    se calibra. Elas incidem só sobre a META do ano corrente (futuro incerto),
--    nunca sobre o `METADEZ` (passado que o estudo já conhece mês a mês).
--
--    A perda NÃO se recupera: cada safra entra mais tarde no estoque e o buraco
--    se arrasta até dezembro. Medido com meta 40k/mês, base 1mi, repasse 18,5%:
--      POST1=20% POST2= 0%  →  −2,8% da receita nova do ano
--      POST1=30% POST2=10%  →  −6,9%
--      POST1=50% POST2=20%  →  −12,4%
--
-- 3) `METADEZ` já servia para qualquer mês — a fórmula lê a célula do mês
--    CORRENTE, não só janeiro. Só a descrição induzia ao erro. O estudo pode
--    preencher jan, fev, mar… com o que sabe exatamente que vai entrar.
--
-- SEGURO POR CONSTRUÇÃO: com `POST1` e `POST2` vazios (= 0), o `MRR` dá
-- EXATAMENTE o mesmo de hoje — verificado contra o motor, 12.142.327,26 nos
-- dois. Rodar este seed não muda o orçado de ninguém; só muda quando você
-- preencher os índices.
--
-- Idempotente: re-rodar ATUALIZA fórmula, descrição e ordem.
-- ============================================================

-- ---------- 1 · drivers novos (preencher; vazio = 0 = sem atraso) ----------
INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, v.codigo, v.descricao, v.ordem, 1, 'ANALITICA', NULL, 'NEUTRO', 'PERCENTUAL', 2, NULL
FROM formulario f
CROSS JOIN (VALUES
  ('POST1', '% da venda que começa 1 mês depois do previsto', 52),
  ('POST2', '% da venda que começa 2 meses depois do previsto', 54)
) AS v(codigo, descricao, ordem)
WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
ON CONFLICT (formulario_id, codigo) DO UPDATE
  SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
      tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
      formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

-- ---------- 2 · linhas de cálculo (todas APOIO: conta_destino NULL) ----------
INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, v.codigo, v.descricao, v.ordem, 1, 'FORMULA', v.expressao, 'RECEITA', 'MOEDA', 2, NULL
FROM formulario f
CROSS JOIN (VALUES
  -- fluxo REAL da receita nova: parte escorrega 1 ou 2 meses.
  -- [METADEZ] fica FORA do parêntese do atraso — é entrada já conhecida.
  ('RECNOVAR',  'Receita nova REAL (com postergação) — apoio', 62,
   '=(ANTERIOR([META],1) * (100 - [POST1] - [POST2])/100 + ANTERIOR([META],2) * [POST1]/100 + ANTERIOR([META],3) * [POST2]/100 + [METADEZ]) * [REP] / 100'),
  -- os dois estoques
  ('MRRBASE',   'MRR da carteira BASE — apoio',                72,
   '=(ANTERIOR() + [BASE]) * (1 + [CORR]/100) * (1 - [CHURN]/100)'),
  ('MRRNOVO',   'MRR da receita NOVA, no prazo — apoio',       74,
   '=ANTERIOR() * (1 + [CORR]/100) * (1 - [CHURN]/100) + [RECNOVA]'),
  ('MRRNOVOR',  'MRR da receita NOVA, real — apoio',           76,
   '=ANTERIOR() * (1 + [CORR]/100) * (1 - [CHURN]/100) + [RECNOVAR]'),
  -- a redutora: quanto a postergação tira do estoque. Nasce NEGATIVA.
  ('POSTERGVL', 'Efeito da postergação (R$) — apoio',          78,
   '=[MRRNOVOR] - [MRRNOVO]')
) AS v(codigo, descricao, ordem, expressao)
WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
ON CONFLICT (formulario_id, codigo) DO UPDATE
  SET expressao = EXCLUDED.expressao, descricao = EXCLUDED.descricao,
      ordem = EXCLUDED.ordem, tipo_linha = EXCLUDED.tipo_linha,
      natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
      casas_decimais = EXCLUDED.casas_decimais;

-- ---------- 3 · o MRR passa a ser a soma dos dois estoques REAIS ----------
-- Continua sendo a ÚNICA linha com conta de destino — o orçado recebe um
-- número por mês. Se as linhas novas também tivessem conta, o Aplicar somaria
-- todas na mesma conta e a receita dobraria.
UPDATE formulario_linha l
   SET expressao = '=[MRRBASE] + [MRRNOVOR]',
       descricao = 'MRR / Receita projetada (base + nova, com postergação)'
  FROM formulario f
 WHERE f.id = l.formulario_id AND l.codigo = 'MRR'
   AND f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%';

-- ---------- 4 · METADEZ: o rótulo é que estava errado ----------
UPDATE formulario_linha l
   SET descricao = 'Venda de períodos anteriores que entra NESTE mês (R$ — do estudo)'
  FROM formulario f
 WHERE f.id = l.formulario_id AND l.codigo = 'METADEZ'
   AND f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%';

-- ---------- conferência ----------
SELECT l.ordem, l.codigo, l.descricao,
       l.tipo_linha || ' · ' || COALESCE(l.natureza,'—') || ' · ' || l.formato AS tipo,
       COALESCE(l.expressao,'— preencher —') AS formula,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio' ELSE '→ ORÇADO' END AS destino
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
 ORDER BY l.ordem;
