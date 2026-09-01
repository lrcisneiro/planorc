-- ============================================================
-- SEED — Margem pré-folha: corrige o numerador do dLER/mLER/LERM/MBP
--
-- POR QUE: os indicadores estavam apontados para a linha `Lmqedmuuc`, que é o
-- **EBITDA** — uma margem que já desconta a folha inteira e todas as despesas.
-- Dividir isso pela folha não tem significado: o dLER saía 0,46 e o mLER
-- NEGATIVO (-2,97), porque a margem era menor que a própria folha direta.
--
-- No Crabtree, gross margin é receita menos o CPV **não-trabalho** — a folha
-- fica FORA da dedução, porque o indicador mede quanto de margem cada real de
-- gente produz. Duas linhas novas resolvem:
--
--   MCPRE    Margem pré-folha  = receita líquida − (terceiros externos +
--                                viagens + royalties)          → o GM do livro
--   MGBRUTA  Margem bruta      = MCPRE − folha direta          → a "contribution
--                                margin" do Crabtree, e o que se compara ao SPI
--
-- Números conferidos com o ano de 2025 do DREGER:
--   receita líquida  96.641.163  (bate com a planilha: 96.641.162)
--   margem pré-folha 87.485.821  (90,5% da receita)
--   margem bruta     39.879.286  (41,3% — dentro da faixa SPI de 35–45%)
--   dLER 1,84 · mLER 4,60 · LERM 0,71     (antes: 0,46 · −2,97 · 0,39)
--
-- 203 "Terceiros Internos" fica na FOLHA, não no CPV: são PJs que atuam como
-- time (definição fully loaded do estudo-base). Quem é pass-through de verdade
-- é 204 "Terceiros Externos", que entra no CPV.
--
-- IDEMPOTENTE. Rode depois de seed_indicadores_folha_direta.sql.
-- ============================================================

DO $$
DECLARE
  -- ══════════════ CONFIGURE AQUI ══════════════
  v_rel_codigo   text   := 'DREGER';
  v_cod_recliq   text   := 'RECLIQ';                   -- receita líquida (a do seed de indicadores)
  v_cods_cogs    text[] := ARRAY['204','205','207'];   -- CPV NÃO-trabalho: terceiros externos, viagens, royalties
  v_cod_folha_dir text  := 'FDIR';
  v_cod_folha_apo text  := 'FAPOIO';
  v_cod_folha_tot text  := 'CPESSOAS';
  -- ════════════ fim da configuração ════════════

  v_tenant uuid; v_rel uuid; v_linha uuid;
  v_ded text := ''; v_expr_mcpre text; v_ordem int;
  r record; c text;
  v_criados text := ''; v_repontados text := '';
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;
  SELECT id INTO v_rel FROM relatorio WHERE tenant_id = v_tenant AND codigo = v_rel_codigo;
  IF v_rel IS NULL THEN RAISE EXCEPTION 'Relatório % não encontrado', v_rel_codigo; END IF;

  FOREACH c IN ARRAY (v_cods_cogs || v_cod_recliq || v_cod_folha_dir || v_cod_folha_apo) LOOP
    IF NOT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = c) THEN
      RAISE EXCEPTION 'Linha "%" não existe em % — rode os seeds anteriores primeiro', c, v_rel_codigo;
    END IF;
  END LOOP;

  -- as linhas de custo são negativas no DRE; abs() protege contra sinal invertido
  FOREACH c IN ARRAY v_cods_cogs LOOP v_ded := v_ded || format('-abs([%s])', c); END LOOP;
  v_expr_mcpre := format('=[%s]%s', v_cod_recliq, v_ded);

  SELECT COALESCE(MAX(ordem), 0) INTO v_ordem FROM relatorio_linha WHERE relatorio_id = v_rel AND pai_id IS NULL;

  -- ── 1) As duas margens ──
  FOR r IN
    SELECT * FROM (VALUES
      ('MCPRE',   'Margem pré-folha (CPV não-trabalho)', v_expr_mcpre),
      ('MGBRUTA', 'Margem bruta (após folha direta)',    format('=[MCPRE]-[%s]', v_cod_folha_dir))
    ) AS t(codigo, descricao, expressao)
  LOOP
    v_ordem := v_ordem + 10;
    INSERT INTO relatorio_linha (relatorio_id, pai_id, codigo, descricao, ordem, nivel, tipo_linha,
                                 expressao, natureza, formato, casas_decimais, nao_soma,
                                 visivel_dashboard, visivel_relatorio)
    VALUES (v_rel, NULL, r.codigo, r.descricao, v_ordem, 1, 'INDICADOR',
            r.expressao, 'NEUTRO', 'MOEDA', 0, true, true, true)
    ON CONFLICT (relatorio_id, codigo) DO UPDATE SET
      descricao = EXCLUDED.descricao, expressao = EXCLUDED.expressao,
      tipo_linha = EXCLUDED.tipo_linha, nao_soma = EXCLUDED.nao_soma;
    v_criados := v_criados || r.codigo || ' ';
  END LOOP;

  -- ── 2) Reaponta os indicadores que estavam com o EBITDA no numerador ──
  FOR r IN
    SELECT * FROM (VALUES
      ('DLER', format('=[MCPRE]/[%s]', v_cod_folha_dir)),
      ('MLER', format('=[MGBRUTA]/[%s]', v_cod_folha_apo)),
      ('LERM', format('=[MGBRUTA]/[%s]', v_cod_folha_tot)),
      ('MBP',  format('=[MGBRUTA]/[%s]*100', v_cod_recliq))
    ) AS t(codigo, expressao)
  LOOP
    UPDATE relatorio_linha SET expressao = r.expressao
     WHERE relatorio_id = v_rel AND codigo = r.codigo;
    IF FOUND THEN v_repontados := v_repontados || r.codigo || ' '; END IF;
  END LOOP;

  -- ── 3) Metas que dependiam do numerador ──
  IF to_regclass('public.indicador_meta') IS NOT NULL THEN
    SELECT id INTO v_linha FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = 'MBP';
    IF v_linha IS NOT NULL THEN
      UPDATE indicador_meta SET
        benchmark_ref = 'SPI 2025: margem de projeto 37,7% (meta > 35%); saudável 35–45%',
        comentario = 'Agora é margem bruta de verdade (receita líquida − CPV não-trabalho − folha direta), '
                     'comparável ao 37,7% do SPI. Antes usava o EBITDA e dava ~22%, que não se compara com nada.'
       WHERE linha_id = v_linha AND ano IS NULL AND empresa_id IS NULL;
    END IF;
    SELECT id INTO v_linha FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = 'LERM';
    IF v_linha IS NOT NULL THEN
      UPDATE indicador_meta SET
        comentario = 'Margem bruta ÷ folha TOTAL. A régua de 2,0x do Crabtree é sobre a folha DIRETA — para '
                     'essa leitura use o dLER. ATENÇÃO: a série histórica da planilha (0,3–0,6) foi calculada '
                     'com o EBITDA no numerador; a partir daqui os valores mudam de patamar (~0,7).'
       WHERE linha_id = v_linha AND ano IS NULL AND empresa_id IS NULL;
    END IF;
  END IF;

  RAISE NOTICE 'Margem pré-folha: %', v_expr_mcpre;
  RAISE NOTICE 'Criados/atualizados: %', v_criados;
  RAISE NOTICE 'Reapontados para a margem certa: %', COALESCE(NULLIF(v_repontados, ''), '(nenhum)');
  RAISE NOTICE 'Confira: MCPRE - FDIR = MGBRUTA, e MGBRUTA / receita líquida deve dar ~41%%.';
END $$;

-- ── Conferência ──
SELECT rl.codigo, rl.descricao, rl.expressao, m.excelente, m.saudavel, m.atencao
  FROM relatorio_linha rl
  JOIN relatorio r ON r.id = rl.relatorio_id
  LEFT JOIN indicador_meta m ON m.linha_id = rl.id AND m.ano IS NULL AND m.empresa_id IS NULL
 WHERE r.codigo = 'DREGER'
   AND rl.codigo IN ('RECLIQ','MCPRE','MGBRUTA','FDIR','FAPOIO','DLER','MLER','LERM','MBP')
 ORDER BY rl.ordem;
