-- ============================================================
-- Define a natureza pela faixa do código:
--   começa com 1 → RECEITA · 2 → DESPESA · 3 → NEUTRO
-- Aplica na conta orçamentária (hub) e nas linhas de relatório.
-- Demais faixas (ex.: 4 = Custo de Impostos) ficam inalteradas.
-- ============================================================
UPDATE conta_orcamentaria SET natureza = CASE
    WHEN codigo LIKE '1%' THEN 'RECEITA'
    WHEN codigo LIKE '2%' THEN 'DESPESA'
    WHEN codigo LIKE '3%' THEN 'NEUTRO'
    ELSE natureza
  END
WHERE tenant_id = current_tenant_id()
  AND (codigo LIKE '1%' OR codigo LIKE '2%' OR codigo LIKE '3%');

-- relatorio_linha é escopada via relatorio (não tem tenant_id próprio)
UPDATE relatorio_linha SET natureza = CASE
    WHEN codigo LIKE '1%' THEN 'RECEITA'
    WHEN codigo LIKE '2%' THEN 'DESPESA'
    WHEN codigo LIKE '3%' THEN 'NEUTRO'
    ELSE natureza
  END
WHERE relatorio_id IN (SELECT id FROM relatorio WHERE tenant_id = current_tenant_id())
  AND (codigo LIKE '1%' OR codigo LIKE '2%' OR codigo LIKE '3%');
