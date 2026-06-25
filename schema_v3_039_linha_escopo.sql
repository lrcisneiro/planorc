-- ============================================================
-- 039 — Linha de APOIO/INDICADOR com FILTRO PRÓPRIO de CC
--
-- nao_soma     = linha fica FORA do SOMAR_FILHOS (não entra no total),
--                mas continua calculando o valor e pode ser referenciada
--                por fórmulas (igual ao comportamento do INDICADOR/EBITDA).
-- filtro_escopo= filtro de CC específico desta linha (jsonb), sobrepõe o
--                filtro da tela só nas dimensões de CC informadas; ano/empresa
--                e demais dimensões vêm do contexto. Nulo = segue a tela.
--                Formato: { "cc": [..ids..], "area": [..cods..],
--                          "divisao": [..], "bu": [..] }
--
-- Uso: "Receita (Serviços)" / "Custo (Serviços)" como linhas de apoio para
-- uma fórmula de Margem de Serviços, sem afetar o total do relatório.
--
-- IDEMPOTENTE.
-- ============================================================
ALTER TABLE relatorio_linha ADD COLUMN IF NOT EXISTS nao_soma boolean NOT NULL DEFAULT false;
ALTER TABLE relatorio_linha ADD COLUMN IF NOT EXISTS filtro_escopo jsonb;
