-- ============================================================
-- SEED — Formulário "Receita não recorrente (TOTVS)" (F5)
-- Modelo: a venda NR (licenças/implantação) gera:
--   1) Receita NR PARCELADA: a venda do mês M vira v_parcelas parcelas
--      iguais a partir de M+1 (ex.: 100.000 em jan, 5 parcelas → 20.000
--      de fev a jun), sobre as quais incide o % de repasse:
--        RecNR(m) = ( (Σ_{i=1..N} MetaNR(m-i)) / N
--                   + (Σ_{i=0..N-1} MetaDez(m-i)) / N ) × %RepNR/100 + PrevNR(m)
--      MetaDez = META DE DEZEMBRO do ano anterior (R$ BRUTO), digitada UMA vez
--      na célula de JANEIRO: as fórmulas espalham as N parcelas (jan..jun com
--      N=6) e a mensalidade dela nasce em janeiro (ver MensNova).
--      PrevNR  = outras receitas NR previstas de outros períodos, digitadas
--      já LÍQUIDAS (sem incidência do %RepNR).
--   2) Uma MENSALIDADE estimada (% sobre a venda NR) que nasce no mês
--      seguinte e ACUMULA como carteira recorrente própria deste formulário:
--        MensNova(m) = MetaNR(m-1) × %Mens/100
--        Carteira(m) = Carteira(m-1) × (1+%Corr/100) × (1−%Churn/100) + MensNova(m)
--        RecMens(m)  = Carteira(m) × %RepMens/100
-- Preenchimento sugerido: percentuais no escopo 🌐 GLOBAL; Meta NR e
-- ParcAnt por empresa. %Churn/%Correção opcionais (vazios = neutro).
-- ⚙ v_parcelas (média de meses do parcelamento) é FIXO na fórmula:
--   para mudar, ajuste a constante abaixo e rode o seed de novo (idempotente).
-- ============================================================

DO $$
DECLARE
  v_tenant   uuid;
  v_form     uuid;
  v_parcelas int := 6;      -- ⚙ média de meses do parcelamento da venda NR
  v_expr     text := '';
  v_dez      text := '[METADEZ]';   -- parcelamento da meta de dezembro: começa em JANEIRO (offset 0)
  i          int;
BEGIN
  -- ajuste aqui se houver mais de um tenant:
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;

  -- monta a fórmula do parcelamento: (ANTERIOR([METANR],1)+...+ANTERIOR([METANR],N))/N × repasse + parcelas antigas
  FOR i IN 1..v_parcelas LOOP
    v_expr := v_expr || format('ANTERIOR([METANR],%s)', i) || CASE WHEN i < v_parcelas THEN ' + ' ELSE '' END;
  END LOOP;
  FOR i IN 1..v_parcelas - 1 LOOP
    v_dez := v_dez || format(' + ANTERIOR([METADEZ],%s)', i);
  END LOOP;
  v_expr := format('=((%s) / %s + (%s) / %s) * [REPNR] / 100 + [PREVNR]', v_expr, v_parcelas, v_dez, v_parcelas);

  INSERT INTO formulario (tenant_id, codigo, nome, descricao)
  VALUES (v_tenant, 'VENDAS_NR', 'Receita não recorrente (TOTVS)',
          format('Meta NR → receita parcelada em %s meses (a partir do mês seguinte) × %% repasse + mensalidade estimada (%% da venda) que acumula como carteira recorrente', v_parcelas))
  ON CONFLICT (tenant_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao
  RETURNING id INTO v_form;

  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais)
  VALUES
    -- ── drivers (entrada) ──
    (v_form, 'METANR',   'Meta de vendas NR (R$)',                        10, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA',      2),
    (v_form, 'METADEZ',  'Meta de dezembro do ano anterior (R$ — digitar em JANEIRO)', 20, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA', 2),
    (v_form, 'PREVNR',   'Receitas NR de outros períodos — líquidas (R$/mês)', 25, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA',  2),
    (v_form, 'REPNR',    '% Repasse sobre venda NR',                      30, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'PMENS',    '% Mensalidade sobre venda NR',                  40, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'REPM',     '% Repasse sobre mensalidade',                   50, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'CHURNNR',  '% Churn da carteira (opcional)',                60, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    (v_form, 'CORRNR',   '% Correção da carteira (opcional)',             70, 1, 'ANALITICA', NULL, 'NEUTRO',  'PERCENTUAL', 2),
    -- ── fórmulas (cálculo) ──
    (v_form, 'RECNR',    format('Receita NR (parcelada em %s meses × repasse)', v_parcelas), 80, 1, 'FORMULA',
       v_expr,                                                                       'RECEITA', 'MOEDA', 2),
    (v_form, 'MENSNOVA', 'Mensalidade nova (bruta) — apoio',              90, 1, 'FORMULA',
       '=(ANTERIOR([METANR]) + [METADEZ]) * [PMENS] / 100',                          'RECEITA', 'MOEDA', 2),
    (v_form, 'MRRNR',    'Carteira de mensalidades (bruta) — apoio',     100, 1, 'FORMULA',
       '=ANTERIOR() * (1 + [CORRNR]/100) * (1 - [CHURNNR]/100) + [MENSNOVA]',        'RECEITA', 'MOEDA', 2),
    (v_form, 'RECMENS',  'Receita recorrente da mensalidade (repasse)',  110, 1, 'FORMULA',
       '=[MRRNR] * [REPM] / 100',                                                    'RECEITA', 'MOEDA', 2)
  ON CONFLICT (formulario_id, codigo) DO UPDATE SET
    descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem, tipo_linha = EXCLUDED.tipo_linha,
    expressao = EXCLUDED.expressao, natureza = EXCLUDED.natureza,
    formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

  -- OPCIONAL: amarrar as linhas-resultado às contas orçamentárias de destino
  -- (o que o "Aplicar" grava em fat_orcado). Troque os códigos e descomente:
  -- UPDATE formulario_linha SET conta_destino_id = (SELECT id FROM conta_orcamentaria
  --   WHERE tenant_id = v_tenant AND codigo = 'CONTA_RECEITA_NR' LIMIT 1)
  --   WHERE formulario_id = v_form AND codigo = 'RECNR';
  -- UPDATE formulario_linha SET conta_destino_id = (SELECT id FROM conta_orcamentaria
  --   WHERE tenant_id = v_tenant AND codigo = 'CONTA_RECEITA_RECORRENTE' LIMIT 1)
  --   WHERE formulario_id = v_form AND codigo = 'RECMENS';

  RAISE NOTICE 'Formulário VENDAS_NR criado/atualizado (parcelamento em % meses): %', v_parcelas, v_form;
END $$;
