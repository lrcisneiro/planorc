-- ============================================================
-- NR: recuperação de RECEITAS VENCIDAS + % de INADIMPLÊNCIA.
--
-- ───────── 1 · VENCIDAS (decidido 29/out) ─────────
-- O estudo traz um estoque de receitas vencidas. Planeja-se recuperar uma
-- parte, diluída IGUALMENTE nos 12 meses de 2027.
--
--   VENCIDO = estoque de vencidas, em R$ LÍQUIDOS — já é o que nos cabe,
--             então o REPNR NÃO incide (mesma convenção da PREVNR, e o
--             oposto da PARCANT, que é bruta)
--   PRECUP  = % desse estoque que se planeja receber
--   RECVENC = VENCIDO × PRECUP/100 / 12, repetido nos 12 meses
--
-- ⚠ O `/12` é a diluição igualitária pedida. Se um dia a recuperação tiver
-- curva (mais no começo, por exemplo), isto vira um driver mês a mês como a
-- PARCANT, e não uma divisão.
--
-- ───────── A PREMISSA ANUAL, SEM ESPERAR A FEATURE ─────────
-- Célula vazia vale ZERO no motor, então um driver "digitado uma vez" não
-- existe — é a pendência da "premissa anual" (docs/DESIGN_receitas.md). Aqui
-- ela é contornada com auto-referência:
--
--   RECVENC = SE([VENCIDO] > 0; [VENCIDO] * [PRECUP] / 100 / 12; ANTERIOR())
--
-- Janeiro calcula; fevereiro a dezembro acham [VENCIDO] vazio e copiam o mês
-- anterior DESTA linha. Preencher VENCIDO e PRECUP só em JANEIRO basta.
-- Preencher os 12 meses com o mesmo valor dá idêntico — os dois jeitos
-- funcionam, o que evita que o hábito de preencher tudo quebre a conta.
--
-- ⚠ Preencher VENCIDO num mês do MEIO do ano recomeça a série dali: o valor
-- novo passa a valer de lá até dezembro, e o anterior some. É o preço de
-- emular premissa anual com ANTERIOR(); documentado, não corrigido.
--
-- PRECUP vazio = 0 = nenhuma recuperação. Sem guarda de padrão de propósito:
-- não inventar receita é o comportamento seguro.
--
-- RECVENC GRAVA NO ORÇADO, em linha própria, na mesma conta do RECNR. É
-- dinheiro de natureza diferente — passado recuperado, não venda nova — e o
-- Aplicar grava uma linha por vez carimbando o código em `dims`, então as duas
-- coexistem na conta e a DRE soma igual. No drill dá para separar.
--
-- ───────── 2 · INADIMPLÊNCIA (decidido 29/out) ─────────
-- Incide SÓ sobre o RECNR, e EMBUTIDA — sem linha negativa separada:
--
--   RECNR = ((Σ parcelas + [PARCANT]) × [REPNR]/100 + [PREVNR])
--           × (1 − [INADIMP]/100)
--
-- Repare no parêntese: a inadimplência pega a receita parcelada E a PREVNR,
-- porque as duas são cobrança que pode não entrar. NÃO pega a RECVENC, que
-- está fora do RECNR — o PRECUP já é a estimativa de perda dela, e descontar
-- de novo penalizaria duas vezes.
--
-- Fica DE FORA da mensalidade (RECMENS): a perda da carteira recorrente já é
-- o CHURNNR.
--
-- ───────── SEGURO POR CONSTRUÇÃO ─────────
-- Com VENCIDO, PRECUP e INADIMP vazios o resultado é IDÊNTICO ao de hoje:
-- `(1 − 0/100)` = 1 e a RECVENC fica em zero o ano inteiro. Rodar este seed
-- não muda número nenhum — só muda quando você preencher.
--
-- ───────── VERIFICADO CONTRA O MOTOR (29/out) ─────────
--   · com VENCIDO, PRECUP e INADIMP vazios, o RECNR dá IDÊNTICO mês a mês ao
--     de antes, e a RECVENC fica em zero o ano inteiro;
--   · VENCIDO 1.200.000 e PRECUP 50% só em JANEIRO → 50.000,00 em cada um dos
--     doze meses, 600.000,00 no ano;
--   · preencher os 12 meses com o mesmo valor dá EXATAMENTE o mesmo — os dois
--     hábitos de preenchimento funcionam;
--   · INADIMP de 0, 2, 5 e 12,5% desconta o percentual exato do RECNR;
--   · com INADIMP em 10%, a RECVENC continua 600.000,00 — a inadimplência não
--     a toca, como desenhado.
--
-- Idempotente. Pressupõe o seed_nr_parcelas_parametro.sql (lê a fórmula
-- parametrizada do RECNR e só lhe acrescenta o fator de inadimplência).
-- ============================================================

DO $$
DECLARE
  v_form  uuid;
  v_conta uuid;
  v_expr  text;
BEGIN
  SELECT id INTO v_form FROM formulario WHERE codigo = 'VENDAS_NR';
  IF v_form IS NULL THEN RAISE EXCEPTION 'Formulário VENDAS_NR não encontrado'; END IF;

  SELECT conta_destino_id INTO v_conta
    FROM formulario_linha WHERE formulario_id = v_form AND codigo = 'RECNR';
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'A linha RECNR está sem conta de destino — a RECVENC herdaria NULL e não gravaria.';
  END IF;

  -- ---- drivers novos ----
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  SELECT v_form, v.codigo, v.descricao, v.ordem, 1, 'ANALITICA', NULL,
         v.natureza, v.formato, 2, NULL
    FROM (VALUES
      ('VENCIDO', 'Receitas VENCIDAS a recuperar — estoque, R$ líquido (digitar em JANEIRO)', 26, 'RECEITA', 'MOEDA'),
      ('PRECUP',  '% das vencidas que se planeja receber (digitar em JANEIRO)',                27, 'NEUTRO',  'PERCENTUAL'),
      ('INADIMP', '% de inadimplência sobre a receita NR',                                     35, 'NEUTRO',  'PERCENTUAL')
    ) AS v(codigo, descricao, ordem, natureza, formato)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
        formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

  -- ---- a recuperação, diluída em 12 e carregada pelo ano ----
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  VALUES
    (v_form, 'RECVENC', 'Recuperação de receitas vencidas (1/12 do estoque × % recuperação)',
     85, 1, 'FORMULA',
     '=SE([VENCIDO] > 0; [VENCIDO] * [PRECUP] / 100 / 12; ANTERIOR())',
     'RECEITA', 'MOEDA', 2, v_conta)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, expressao = EXCLUDED.expressao,
        natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
        casas_decimais = EXCLUDED.casas_decimais,
        conta_destino_id = COALESCE(formulario_linha.conta_destino_id,
                                    EXCLUDED.conta_destino_id);

  -- ---- inadimplência embutida no RECNR ----
  -- Reescreve a fórmula QUE ESTIVER LÁ, envolvendo-a no fator. Assim este seed
  -- não precisa conhecer o parcelamento, e continua valendo se o nº de termos
  -- mudar. A guarda do LIKE impede aplicar o fator duas vezes numa re-rodada.
  SELECT expressao INTO v_expr
    FROM formulario_linha WHERE formulario_id = v_form AND codigo = 'RECNR';

  IF v_expr IS NULL THEN
    RAISE EXCEPTION 'RECNR sem expressão — rode antes o seed_nr_parcelas_parametro.sql';
  END IF;

  IF position('[INADIMP]' in v_expr) = 0 THEN
    -- tira o '=' do início, embrulha no fator
    v_expr := '=(' || ltrim(v_expr, '=') || ') * (1 - [INADIMP] / 100)';
    UPDATE formulario_linha
       SET expressao = v_expr,
           descricao = 'Receita NR (parcelas + safras anteriores) × repasse, líquida de inadimplência'
     WHERE formulario_id = v_form AND codigo = 'RECNR';
  END IF;
END $$;

-- ---------- conferência ----------
SELECT l.ordem, l.codigo, l.descricao,
       l.tipo_linha || ' · ' || COALESCE(l.natureza,'—') || ' · ' || l.formato AS tipo,
       CASE WHEN l.codigo = 'RECNR' AND l.expressao LIKE '%[INADIMP]%' THEN 'inadimplência aplicada ✓'
            WHEN l.codigo = 'RECNR' THEN '⚠ sem inadimplência'
            ELSE '' END AS check,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio' ELSE '→ ORÇADO' END AS destino,
       (SELECT count(*) FROM formulario_valor v WHERE v.linha_id = l.id) AS n_valores
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.codigo = 'VENDAS_NR'
 ORDER BY l.ordem;
