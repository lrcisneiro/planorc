-- ============================================================
-- AJUSTE — Formulário EXISTENTE "RECEITASBASELINE" (F5)
-- Modelo (v2 — recomposição pelo valor cliente TOTVS):
--   A base digitada é a SUA receita (comissão). Com a % média de comissão
--   recompõe-se o valor CHEIO que o cliente paga à TOTVS; reajuste (IGPM) e
--   churn incidem sobre esse valor cheio (com linhas de conferência em R$);
--   o baseline seu = valor cliente ajustado × % comissão.
--
--   BaseMes(m)  = ValorCli(m-1) + BaseDez(m) / (%Comissao/100)     ← apoio
--   ReajR$(m)   = BaseMes(m) × %IGPM/100                            ← conferência
--   ChurnR$(m)  = BaseMes(m) × %Churn/100                           ← conferência
--   ValorCli(m) = BaseMes(m) + ReajR$(m) − ChurnR$(m)
--   BASELINE(m) = ValorCli(m) × %Comissao/100
--
--   · BASEDEZ (sua receita recorrente de dez) digitado UMA vez, em JANEIRO.
--   · %COMISSAO é OBRIGATÓRIA (sem ela tudo zera) — sugestão: escopo 🌐 global.
--   · %IGPM só nos meses de reajuste; %Churn digitado POSITIVO (2 = perde 2%),
--     linhas de % com natureza NEUTRO (Despesa inverte o sinal do digitado).
-- Não cria formulário novo: localiza o RECEITASBASELINE existente e faz
-- upsert das linhas pelo código. Idempotente.
-- ============================================================

DO $$
DECLARE
  v_tenant uuid;
  v_form   uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;

  SELECT id INTO v_form FROM formulario
   WHERE tenant_id = v_tenant AND (upper(codigo) = 'RECEITASBASELINE' OR upper(nome) LIKE '%RECEITASBASELINE%')
   LIMIT 1;
  IF v_form IS NULL THEN
    RAISE EXCEPTION 'Formulário RECEITASBASELINE não encontrado — confira o código na tela de Formulários';
  END IF;

  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais)
  VALUES
    -- ── drivers (entrada) ──
    (v_form, 'BASEDEZ',  'Base recorrente de dezembro — sua receita (R$ — digitar em JANEIRO)', 10, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA',      2),
    (v_form, 'COMISSAO', '% Comissão média (obrigatória)',                        20, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'IGPM',     '% IGPM (meses de reajuste)',                            30, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'CHURN',    '% Churn mensal (saída de contratos)',                   40, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    -- ── fórmulas (cálculo) ──
    (v_form, 'BASEMES',  'Valor cliente TOTVS — base do mês (apoio)',             50, 1, 'FORMULA',
       '=ANTERIOR([VLRCLI]) + [BASEDEZ] / ([COMISSAO]/100)',                          'RECEITA', 'MOEDA', 2),
    (v_form, 'REAJRS',   'Reajuste do mês (R$ — conferência)',                    60, 1, 'FORMULA',
       '=[BASEMES] * [IGPM] / 100',                                                   'RECEITA', 'MOEDA', 2),
    (v_form, 'CHURNRS',  'Churn do mês (R$ — conferência)',                       70, 1, 'FORMULA',
       '=[BASEMES] * [CHURN] / 100',                                                  'RECEITA', 'MOEDA', 2),
    (v_form, 'VLRCLI',   'Valor cliente TOTVS ajustado (bruto)',                  80, 1, 'FORMULA',
       '=[BASEMES] + [REAJRS] - [CHURNRS]',                                           'RECEITA', 'MOEDA', 2),
    (v_form, 'BASELINE', 'Baseline recorrente recomposto (sua receita)',          90, 1, 'FORMULA',
       '=[VLRCLI] * [COMISSAO] / 100',                                                'RECEITA', 'MOEDA', 2)
  ON CONFLICT (formulario_id, codigo) DO UPDATE SET
    descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem, tipo_linha = EXCLUDED.tipo_linha,
    expressao = EXCLUDED.expressao, natureza = EXCLUDED.natureza,
    formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

  -- OPCIONAL: conta orçamentária de destino do BASELINE (para o "Aplicar"):
  -- UPDATE formulario_linha SET conta_destino_id = (SELECT id FROM conta_orcamentaria
  --   WHERE tenant_id = v_tenant AND codigo = 'CODIGO_DA_CONTA' LIMIT 1)
  --   WHERE formulario_id = v_form AND codigo = 'BASELINE';

  RAISE NOTICE 'RECEITASBASELINE ajustado (modelo valor cliente TOTVS): %', v_form;
END $$;
