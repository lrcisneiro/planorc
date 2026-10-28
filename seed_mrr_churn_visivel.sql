-- ============================================================
-- MRR: tornar o CHURN visível em R$, mês a mês e acumulado
--
-- O churn já acumulava corretamente — o `MRR` se realimenta pelo `ANTERIOR()`,
-- então a perda de fevereiro incide sobre o saldo que janeiro já reduziu. Mas
-- isso só aparecia como "a linha do MRR cai um pouco"; não dava para ver quanto
-- se perdeu, nem conferir. Duas linhas de APOIO resolvem (nenhuma vai ao orçado:
-- `conta_destino_id` fica NULL).
--
--   CHURNVL  perda do mês, em R$
--            = (carteira que entrou no mês, já corrigida) × churn%
--            A carteira que entra é `ANTERIOR([MRR]) + [BASE]` — o mesmo termo
--            de dentro do MRR, onde `ANTERIOR()` é a própria linha. Numa linha
--            separada é preciso nomear: `ANTERIOR([MRR])`.
--
--   CHURNAC  perda acumulada no ano = ANTERIOR() + [CHURNVL]
--            É esta que torna visível o que você descreveu: fevereiro mostra
--            janeiro + fevereiro, março os três, e assim por diante.
--
-- CONFERE SOZINHO: em qualquer mês, `CHURNVL` = MRR do mês anterior − MRR do mês
-- + receita nova. Validado contra o motor nos 12 meses (0,95% a.m., base 10.000):
-- jan 95,00 · fev 94,10 · mar 93,21 … dez 85,55, acumulado 1.082,38 — e
-- 10.000 − 1.082,38 + receita nova = 8.919,66, que é o MRR de dezembro.
--
-- NEUTRO + MOEDA de propósito: a linha mostra a perda como número POSITIVO.
-- Marcada como DESPESA ela apareceria com o sinal trocado pela convenção de
-- exibição, e aqui o que se quer ler é "perdi 94,10", não "−94,10".
--
-- Idempotente: re-rodar ATUALIZA a fórmula e a descrição (para poder iterar).
-- ============================================================

INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, v.codigo, v.descricao, v.ordem, 1, 'FORMULA', v.expressao, 'NEUTRO', 'MOEDA', 2, NULL
FROM formulario f
CROSS JOIN (VALUES
  ('CHURNVL', 'Churn do mês (R$) — apoio',          80,
   '=(ANTERIOR([MRR]) + [BASE]) * (1 + [CORR]/100) * [CHURN] / 100'),
  ('CHURNAC', 'Churn acumulado no ano (R$) — apoio', 90,
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
