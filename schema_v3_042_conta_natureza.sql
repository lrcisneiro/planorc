-- ============================================================
-- 042 — Natureza da CONTA CONTÁBIL (Ativo/Passivo/Receita/Despesa/Transitória)
--
-- Usada para regras como "CC é obrigatório em contas de receita/despesa".
-- Pré-preenche pela regra do plano do usuário (1º dígito do código):
--   1=ATIVO, 2=PASSIVO, 3=RECEITA, 4=DESPESA, demais=TRANSITORIA.
-- Editável depois no cadastro de Contas. Só preenche onde está nulo.
-- IDEMPOTENTE.
-- ============================================================
ALTER TABLE conta_contabil ADD COLUMN IF NOT EXISTS natureza text;

UPDATE conta_contabil SET natureza = CASE left(codigo, 1)
    WHEN '1' THEN 'ATIVO'
    WHEN '2' THEN 'PASSIVO'
    WHEN '3' THEN 'RECEITA'
    WHEN '4' THEN 'DESPESA'
    ELSE 'TRANSITORIA'
  END
 WHERE natureza IS NULL;
