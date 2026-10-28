-- ============================================================
-- MRR: o MOVIMENTO da carteira visível em R$ — correção e churn
--
-- A fórmula do MRR já estava certa, mas entregava só o saldo:
--   MRR = (ANTERIOR() + [BASE]) * (1 + [CORR]/100) * (1 - [CHURN]/100) + [RECNOVA]
-- Dava para ver a linha subir ou descer, não QUANTO entrou de correção nem
-- quanto saiu de churn. Quatro linhas de APOIO abrem isso (nenhuma vai ao
-- orçado — `conta_destino_id` fica NULL):
--
--   CORRVL   correção do mês (R$)  = carteira que entrou × corr%
--   CHURNVL  churn do mês (R$)     = carteira JÁ CORRIGIDA × churn%
--   CORRAC   correção acumulada no ano
--   CHURNAC  churn acumulado no ano
--
-- A ORDEM importa na aritmética: dentro do MRR a correção vem antes do churn,
-- então o churn incide sobre a carteira já corrigida — daí o `(1 + [CORR]/100)`
-- dentro do CHURNVL e não dentro do CORRVL. Trocar isso dá diferença.
--
-- "Carteira que entrou" é `ANTERIOR([MRR]) + [BASE]` — o mesmo termo de dentro
-- do MRR, onde `ANTERIOR()` aponta para a própria linha. Numa linha separada é
-- preciso nomear: `ANTERIOR([MRR])`.
--
-- As acumuladas são as que tornam visível a composição: fevereiro mostra
-- janeiro + fevereiro, março os três, e assim por diante.
--
-- IDENTIDADE QUE CONFERE SOZINHA, em qualquer mês:
--     carteira anterior + BASE + CORRVL − CHURNVL + RECNOVA = MRR
-- Validada contra o motor nos 12 meses (base 10.000, churn 0,95%, corr 0,40%,
-- meta 1, repasse 18,5%): fecha em todos, e no ano
-- 10.000,00 + 465,69 − 1.110,43 + receita nova = 9.357,29 em dezembro.
--
-- NEUTRO + MOEDA de propósito, nas quatro: são números para LER, não para somar
-- no resultado. Marcadas como RECEITA/DESPESA a convenção de exibição trocaria
-- o sinal de uma delas, e o que se quer ler é "entrou 39,78" e "saiu 94,85".
--
-- Idempotente: re-rodar ATUALIZA fórmula, descrição e ordem (para poder iterar).
-- ============================================================

INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, v.codigo, v.descricao, v.ordem, 1, 'FORMULA', v.expressao, 'NEUTRO', 'MOEDA', 2, NULL
FROM formulario f
CROSS JOIN (VALUES
  -- o movimento do mês, na ordem em que acontece dentro da fórmula
  ('CORRVL',  'Correção do mês (R$) — apoio',            80,
   '=(ANTERIOR([MRR]) + [BASE]) * [CORR] / 100'),
  ('CHURNVL', 'Churn do mês (R$) — apoio',               82,
   '=(ANTERIOR([MRR]) + [BASE]) * (1 + [CORR]/100) * [CHURN] / 100'),
  -- e o acumulado do ano
  ('CORRAC',  'Correção acumulada no ano (R$) — apoio',  90,
   '=ANTERIOR() + [CORRVL]'),
  ('CHURNAC', 'Churn acumulado no ano (R$) — apoio',     92,
   '=ANTERIOR() + [CHURNVL]')
) AS v(codigo, descricao, ordem, expressao)
WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
ON CONFLICT (formulario_id, codigo) DO UPDATE
  SET expressao = EXCLUDED.expressao,
      descricao = EXCLUDED.descricao,
      ordem     = EXCLUDED.ordem,
      natureza  = EXCLUDED.natureza,
      formato   = EXCLUDED.formato,
      casas_decimais = EXCLUDED.casas_decimais;

-- conferência (última instrução = a que o SQL Editor mostra)
SELECT f.nome AS formulario, l.ordem, l.codigo, l.descricao,
       l.tipo_linha || ' · ' || COALESCE(l.natureza,'—') || ' · ' || l.formato AS tipo,
       COALESCE(l.expressao,'—') AS formula,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio (não vai ao orçado)' ELSE 'vai ao orçado' END AS destino
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
 ORDER BY l.ordem;
