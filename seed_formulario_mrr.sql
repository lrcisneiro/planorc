-- ============================================================
-- SEED — Formulário "MRR — Receita recorrente" (F5)
-- Cria o formulário + linhas (drivers e fórmulas) do modelo:
--   MRR(m) = (MRR(m-1) + Baseline) × (1 + %Corr/100) × (1 − %Churn/100) + ReceitaNova(m)
--   ReceitaNova(m) = (Meta(m-1) + MetaDez(m)) × %Repasse/100
--     · Meta gera receita no mês SEGUINTE.
--     · MetaDez = meta de DEZEMBRO do ano anterior (R$), digitada UMA vez na
--       célula de JANEIRO → gera a receita nova de janeiro (que entra no MRR
--       e replica nos meses seguintes), como a meta de jan gera em fev.
--       ATENÇÃO: o Baseline não deve incluir esse efeito (senão conta em dobro).
-- Preenchimento sugerido: %Churn / %Correção / %Repasse no escopo 🌐 GLOBAL
-- (requer v3_050); Baseline (só janeiro) e Meta por EMPRESA.
-- Idempotente: pode rodar de novo (atualiza as linhas pelo código).
-- ============================================================

DO $$
DECLARE
  v_tenant uuid;
  v_form   uuid;
BEGIN
  -- ajuste aqui se houver mais de um tenant:
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;

  INSERT INTO formulario (tenant_id, codigo, nome, descricao)
  VALUES (v_tenant, 'MRR', 'Receita recorrente (MRR)',
          'Baseline + meta de vendas × % repasse (mês seguinte), % churn e % correção IGPM/IPCA')
  ON CONFLICT (tenant_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao
  RETURNING id INTO v_form;

  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais)
  VALUES
    -- ── drivers (entrada) ──
    (v_form, 'BASE',    'MRR Baseline (carteira) — só janeiro',      10, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA',      2),
    (v_form, 'META',    'Meta de vendas (MRR novo no mês)',          20, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA',      2),
    (v_form, 'METADEZ', 'Meta de dezembro do ano anterior (R$ — digitar em JANEIRO)', 25, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA', 2),
    (v_form, 'CHURN',   '% Churn mensal',                            30, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'CORR',    '% Correção (IGPM/IPCA)',                    40, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'REP',     '% Comissão de repasse',                     50, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    -- ── fórmulas (cálculo) ──
    (v_form, 'RECNOVA', 'Receita nova (meta anterior × repasse)',    60, 1, 'FORMULA',
       '=(ANTERIOR([META]) + [METADEZ]) * [REP] / 100',                          'RECEITA', 'MOEDA', 2),
    (v_form, 'MRR',     'MRR / Receita projetada',                   70, 1, 'FORMULA',
       '=(ANTERIOR() + [BASE]) * (1 + [CORR]/100) * (1 - [CHURN]/100) + [RECNOVA]', 'RECEITA', 'MOEDA', 2)
  ON CONFLICT (formulario_id, codigo) DO UPDATE SET
    descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem, tipo_linha = EXCLUDED.tipo_linha,
    expressao = EXCLUDED.expressao, natureza = EXCLUDED.natureza,
    formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

  -- OPCIONAL: amarrar a linha MRR à conta orçamentária de destino (o que o
  -- "Aplicar" grava em fat_orcado). Troque 'CODIGO_DA_CONTA' e descomente:
  -- UPDATE formulario_linha
  --    SET conta_destino_id = (SELECT id FROM conta_orcamentaria
  --                             WHERE tenant_id = v_tenant AND codigo = 'CODIGO_DA_CONTA' LIMIT 1)
  --  WHERE formulario_id = v_form AND codigo = 'MRR';

  RAISE NOTICE 'Formulário MRR criado/atualizado: %', v_form;
END $$;
