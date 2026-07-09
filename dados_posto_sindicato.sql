-- ============================================================
-- Atribui o sindicato aos postos por EMPRESA (critério Ricardo, jul/2026):
--   empresa 06         -> SINDPDMS
--   empresa 08/YY/ZZ   -> SINDPDPR
--   demais             -> SINDPDSP
--
-- Cria os sindicatos se não existirem (mes_database = 1 PROVISÓRIO — ajuste a
-- data-base real de cada um em /postos/regras → Sindicatos). Idempotente.
-- ============================================================

-- 1) garante os 3 sindicatos (por tenant que tenha postos)
INSERT INTO sindicato (tenant_id, codigo, nome, mes_database, ativo)
SELECT DISTINCT p.tenant_id, v.codigo, v.nome, 1, true
FROM posto p
CROSS JOIN (VALUES
  ('SINDPDMS', 'Sind. Proc. Dados — MS'),
  ('SINDPDPR', 'Sind. Proc. Dados — PR'),
  ('SINDPDSP', 'Sind. Proc. Dados — SP')
) AS v(codigo, nome)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- 2) atualiza o sindicato de cada posto conforme a empresa
UPDATE posto p
SET sindicato_id = s.id
FROM empresa e
JOIN sindicato s ON s.tenant_id = e.tenant_id
WHERE p.empresa_id = e.id
  AND s.codigo = CASE
    WHEN e.codigo = '06'                THEN 'SINDPDMS'
    WHEN e.codigo IN ('08', 'YY', 'ZZ') THEN 'SINDPDPR'
    ELSE                                     'SINDPDSP'
  END;

-- 3) conferência (rode junto para ver a distribuição)
SELECT s.codigo AS sindicato, count(*) AS postos
FROM posto p JOIN sindicato s ON s.id = p.sindicato_id
GROUP BY s.codigo ORDER BY 1;
