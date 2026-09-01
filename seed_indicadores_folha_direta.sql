-- ============================================================
-- SEED — dLER / mLER: folha DIRETA vs APOIO por área de centro de custo
--
-- Fecha o LER do Crabtree de verdade. Até aqui só existia o "LER Bruto"
-- (receita ÷ folha total); o framework original separa:
--   dLER = Margem Bruta ÷ folha DIRETA (time que gera receita)
--   mLER = Margem de Contribuição ÷ folha de GESTÃO
-- e a leitura conjunta diz onde está o problema: produtividade do time técnico
-- (dLER) ou peso da estrutura (mLER).
--
-- O corte usa a dimensão ÁREA, que o app já deriva do 1º dígito do centro de
-- custo (lib/ccDims.ts e a função decodificar_cc da migration 037):
--   1 = CSC · 2 = Comercial · 3 = Serviços · 4 = Diretoria · 5 = Marketing
-- Por ser derivada do código, centro de custo NOVO entra na regra sozinho —
-- nada de lista de CC para manter.
--
-- REQUER o ajuste do motor que faz a linha escopada valer para quem a
-- referencia (commit "Motor: linha escopada por CC agora vale para quem a
-- referencia"). Sem ele, o dLER sai silenciosamente igual ao LER de margem.
--
-- IDEMPOTENTE. Rode depois de seed_indicadores_operacionais.sql.
-- ============================================================

DO $$
DECLARE
  -- ══════════════ CONFIGURE AQUI ══════════════
  v_rel_codigo     text   := 'DRE';
  v_cod_margem     text   := 'MB';           -- linha de Margem Bruta (obrigatória aqui)
  v_cods_custo     text[] := ARRAY['DP01'];  -- as MESMAS linhas de folha do seed de indicadores
  v_custo_negativo boolean := true;
  v_areas_diretas  text[] := ARRAY['2','3','5'];  -- Comercial, Serviços, Marketing
  v_areas_apoio    text[] := ARRAY['1','4'];      -- CSC, Diretoria
  v_sobrescrever   boolean := false;
  -- ════════════ fim da configuração ════════════

  v_tenant uuid; v_rel uuid; v_linha uuid;
  v_soma text := ''; v_expr text;
  v_ordem int; v_existe boolean;
  r record; c text;
  v_criados text := ''; v_pulados text := '';
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;
  SELECT id INTO v_rel FROM relatorio WHERE tenant_id = v_tenant AND codigo = v_rel_codigo;
  IF v_rel IS NULL THEN RAISE EXCEPTION 'Relatório % não encontrado', v_rel_codigo; END IF;
  IF NOT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = v_cod_margem) THEN
    RAISE EXCEPTION 'Linha de margem "%" não existe — dLER e mLER dependem dela', v_cod_margem;
  END IF;
  FOREACH c IN ARRAY v_cods_custo LOOP
    IF NOT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = c) THEN
      RAISE EXCEPTION 'Linha de custo "%" não existe', c;
    END IF;
    v_soma := v_soma || CASE WHEN v_soma = '' THEN '' ELSE '+' END || '[' || c || ']';
  END LOOP;
  v_expr := CASE WHEN v_custo_negativo THEN format('=-1*(%s)', v_soma) ELSE format('=%s', v_soma) END;

  SELECT COALESCE(MAX(ordem), 0) INTO v_ordem FROM relatorio_linha WHERE relatorio_id = v_rel AND pai_id IS NULL;

  FOR r IN
    SELECT * FROM (VALUES
      -- codigo, descricao, expressao, formato, casas, escopo(areas ou NULL)
      ('FDIR',    'Folha direta (Comercial/Serviços/Marketing)', v_expr, 'MOEDA', 0, v_areas_diretas),
      ('FAPOIO',  'Folha apoio (CSC/Diretoria)',                 v_expr, 'MOEDA', 0, v_areas_apoio),
      ('DLER',    'dLER — LER direto',        format('=[%s]/[FDIR]', v_cod_margem),              'NUMERO', 2, NULL::text[]),
      ('MLER',    'mLER — LER de gestão',     format('=([%s]-[FDIR])/[FAPOIO]', v_cod_margem),   'NUMERO', 2, NULL::text[]),
      ('PESTRUT', '% Estrutura (apoio na folha)', '=[FAPOIO]/([FDIR]+[FAPOIO])*100',             'PERCENTUAL', 1, NULL::text[])
    ) AS t(codigo, descricao, expressao, formato, casas, areas)
  LOOP
    SELECT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = r.codigo) INTO v_existe;
    IF v_existe AND NOT v_sobrescrever THEN v_pulados := v_pulados || r.codigo || ' '; CONTINUE; END IF;

    v_ordem := v_ordem + 10;
    INSERT INTO relatorio_linha (relatorio_id, pai_id, codigo, descricao, ordem, nivel, tipo_linha,
                                 expressao, natureza, formato, casas_decimais, nao_soma,
                                 filtro_escopo, visivel_dashboard, visivel_relatorio)
    VALUES (v_rel, NULL, r.codigo, r.descricao, v_ordem, 1, 'INDICADOR',
            r.expressao, 'NEUTRO', r.formato, r.casas, true,
            CASE WHEN r.areas IS NULL THEN NULL ELSE jsonb_build_object('area', to_jsonb(r.areas)) END,
            true, true)
    ON CONFLICT (relatorio_id, codigo) DO UPDATE SET
      descricao = EXCLUDED.descricao, tipo_linha = EXCLUDED.tipo_linha, expressao = EXCLUDED.expressao,
      formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais,
      nao_soma = EXCLUDED.nao_soma, filtro_escopo = EXCLUDED.filtro_escopo;
    v_criados := v_criados || r.codigo || ' ';
  END LOOP;

  -- ── Metas: agora sim valem as faixas do Crabtree ──
  -- (só entram se a tabela indicador_meta existir — migration v3_079)
  IF to_regclass('public.indicador_meta') IS NOT NULL THEN
    FOR r IN
      SELECT * FROM (VALUES
        ('DLER', 2.5::numeric, 2.0::numeric, 1.7::numeric,
         'Crabtree: 2,0x é onde 90% das empresas batem a meta de lucro; serviços saudáveis 2,2–2,8x',
         'Este é o LER do livro: margem bruta ÷ folha direta. Diferente do LER Bruto, aqui as faixas do '
         'estudo-base valem de verdade, porque o numerador é margem e o denominador é só o time que gera receita.'),
        ('MLER', 8.0::numeric, 4.0::numeric, 3.0::numeric,
         'Crabtree: alvo 8,0x; faixa 4,0–8,0x considerada ótima',
         'Margem de contribuição (margem bruta − folha direta) ÷ folha de gestão. Abaixo de 4,0x indica '
         'estrutura pesada para o tamanho da operação. Ler junto do dLER: dLER baixo aponta produtividade '
         'do time técnico; mLER baixo aponta peso da administração.'),
        ('PESTRUT', NULL::numeric, NULL::numeric, NULL::numeric,
         'Sem régua de mercado — depende do modelo de operação',
         'Quanto da folha total está em CSC e Diretoria. Não tem "bom" absoluto: serve para acompanhar se '
         'a estrutura cresce mais rápido que o time que gera receita. Fica sem faixa de propósito.')
      ) AS t(codigo, excelente, saudavel, atencao, benchmark_ref, comentario)
    LOOP
      SELECT id INTO v_linha FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = r.codigo;
      CONTINUE WHEN v_linha IS NULL;
      INSERT INTO indicador_meta (tenant_id, linha_id, ano, empresa_id, maior_melhor,
                                  excelente, saudavel, atencao, benchmark_ref, comentario)
      VALUES (v_tenant, v_linha, NULL, NULL, true, r.excelente, r.saudavel, r.atencao, r.benchmark_ref, r.comentario)
      ON CONFLICT (tenant_id, linha_id, ano, empresa_id) DO NOTHING;
    END LOOP;
  END IF;

  RAISE NOTICE 'Folha direta: áreas % · apoio: áreas %', array_to_string(v_areas_diretas, '/'), array_to_string(v_areas_apoio, '/');
  RAISE NOTICE 'Expressão da folha: %', v_expr;
  RAISE NOTICE 'Gravados: %', COALESCE(NULLIF(v_criados, ''), '(nenhum)');
  IF v_pulados <> '' THEN RAISE NOTICE 'Já existiam, mantidos: % — ligue v_sobrescrever', v_pulados; END IF;
  RAISE NOTICE 'Confira o corte: a soma FDIR + FAPOIO tem de bater com a folha total.';
END $$;

-- ── Conferência: as linhas e o escopo de cada uma ──
SELECT rl.codigo, rl.descricao, rl.expressao, rl.formato,
       rl.filtro_escopo->'area' AS areas,
       m.excelente, m.saudavel, m.atencao
  FROM relatorio_linha rl
  JOIN relatorio r ON r.id = rl.relatorio_id
  LEFT JOIN indicador_meta m ON m.linha_id = rl.id AND m.ano IS NULL AND m.empresa_id IS NULL
 WHERE r.codigo = 'DRE'                 -- ajuste
   AND rl.codigo IN ('FDIR','FAPOIO','DLER','MLER','PESTRUT')
 ORDER BY rl.ordem;
