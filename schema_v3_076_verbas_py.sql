-- ============================================================
-- F5 · Folha Paraguai — catálogo de verbas (pais='PY'), 2 modalidades.
-- Fonte: pesquisa 04/ago/2026 (IPS portal, MTESS, DNIT/SET, Código del Trabajo
-- Ley 213/93, Ley 6380/2019). 23 claims confirmados por fontes oficiais.
--
-- MODALIDADES (regime do posto, prefixado por país — ver v3_078):
--   'PY-IPS'      = relación de dependencia (empregado registrado no IPS) — CLT-eq.
--   'PY-CONTRATO' = honorarios / prestador independente (SEM IPS) — prestador-eq.
--
-- CUSTO DO EMPREGADOR (o motor de folha calcula o custo patronal):
--   · IPS: salário + aporte patronal 16,5% + provisões (aguinaldo, vacaciones,
--          indemnización) + bonificación familiar (por filho).
--   · CONTRATO: só o honorário. IVA 10% (recuperável) e IRP são tributos do
--          PRÓPRIO prestador, não custo da empresa → não entram no buildup.
--   · O aporte OBRERO 9% é DESCONTO do empregado (já dentro do salário bruto),
--          não é custo adicional do empregador → não entra como verba de custo.
--
-- BASE DE INCIDÊNCIA IPS (Ley 430/73): salário + horas extras + comissões.
--   EXCLUI aguinaldo e bonificación familiar → incide_encargos=false nelas.
--
-- MATEMÁTICA DAS PROVISÕES (tipo PROVISAO_1_12: base × fator / 12):
--   · Aguinaldo (13º): 1/12 da remuneração anual → fator 1 (Art. 243). ✓
--   · Vacaciones: (salário/30) × dias. Default 12 dias hábeis (até 5 anos) =
--       0,4 salário/ano → fator 0,4. >5-10 anos=18d (0,6); >10 anos=30d (1,0).
--       AJUSTE por antiguidade se necessário (parâmetro é global por verba).
--   · Indemnización despido: 15 salários DIÁRIOS/ano = 0,5 salário mensal/ano
--       → fator 0,5 (Art. 91). Provisão contínua (como a rescisão BR).
--   · Bonificación familiar: VALOR_FIXO por posto = 5% do salário mínimo × nº
--       filhos (< G. 152.200/filho com o mínimo de jul/2026). Preenchido por
--       posto (nº de filhos varia). Cessa se salário > 200% do mínimo.
--
-- Salário mínimo ref.: G. 3.044.000/mês (jul/2026, Decreto 6225/2026).
-- conta_destino_id fica NULL — amarrar em /postos/regras ou informar os códigos.
-- Idempotente: ON CONFLICT (tenant_id, codigo) DO NOTHING.
--
-- tenant_id: NÃO usa current_tenant_id() (retorna NULL no SQL Editor, sem JWT).
-- Deriva do tenant das VERBAS já existentes (as brasileiras). Se por acaso não
-- houver verba ainda, cai no tenant da 1ª empresa cadastrada.
-- ============================================================
INSERT INTO verba_folha
  (tenant_id, codigo, descricao, tipo_calculo, parametro, incide_encargos, ordem, regime, pais, categoria, ativo)
SELECT t.id, v.codigo, v.descricao, v.tipo_calculo, v.parametro, v.incide_encargos, v.ordem, v.regime, 'PY', v.categoria, true
FROM (
  SELECT COALESCE(
    (SELECT tenant_id FROM verba_folha LIMIT 1),
    (SELECT tenant_id FROM empresa     LIMIT 1)
  ) AS id
) t
CROSS JOIN (VALUES
  -- ===== Modalidade IPS (relación de dependencia) =====
  ('PY_SAL',     'Salario base (rel. dependencia)',        'BASE',          NULL::numeric, true,  10, 'PY-IPS',      'SALARIO'),
  ('PY_IPS_PAT', 'Aporte patronal IPS 16,5% (14%+2,5%)',   'PCT_BASE',      16.5,          false, 20, 'PY-IPS',      'ENCARGOS'),
  ('PY_AGUI',    'Aguinaldo (13º) — 1/12 anual',           'PROVISAO_1_12', 1,             false, 30, 'PY-IPS',      'PROVISOES'),
  ('PY_VAC',     'Vacaciones (provisão, 12 dias)',         'PROVISAO_1_12', 0.4,           false, 40, 'PY-IPS',      'PROVISOES'),
  ('PY_IND',     'Indemnización despido (provisão)',       'PROVISAO_1_12', 0.5,           false, 50, 'PY-IPS',      'PROVISOES'),
  ('PY_BONFAM',  'Bonificación familiar (5% mín./filho)',  'VALOR_FIXO',    NULL,          false, 60, 'PY-IPS',      'BENEFICIOS'),
  -- ===== Modalidade CONTRATO (honorarios / prestador) =====
  ('PY_HON',     'Honorarios (contrato/prestador)',        'BASE',          NULL,          true,  10, 'PY-CONTRATO', 'SALARIO')
) AS v(codigo, descricao, tipo_calculo, parametro, incide_encargos, ordem, regime, categoria)
WHERE t.id IS NOT NULL
ON CONFLICT (tenant_id, codigo) DO NOTHING;
