-- ============================================================
-- SEED — Metas iniciais dos indicadores operacionais (v3_079 · indicador_meta)
--
-- Carga de PARTIDA com as referências de mercado pesquisadas (set/2026), para
-- os indicadores criados por seed_indicadores_operacionais.sql. É ponto de
-- partida, não verdade: cada faixa entra como regra geral (ano e empresa em
-- branco) para você calibrar depois em Cadastros → Metas de indicadores.
--
-- Fontes (o texto curto vai em benchmark_ref, visível no card):
--   • Greg Crabtree, "Simple Numbers" — dLER 2,0x é o ponto em que 90% das
--     empresas americanas atingem a meta de lucro; serviços saudáveis operam
--     entre 2,2x e 2,8x.  gregcrabtree.net + nailstonumbers.substack.com
--   • SPI / Kantata "2025 Professional Services Maturity Benchmark" — receita
--     por consultor faturável US$ 210 mil/ano (+6% vs US$ 199 mil em 2024),
--     margem de projeto 37,7% (meta > 35%), utilização > 70%.
--   • Deltek / Mosaic (2025) — margem de projeto estável em ~35% na média;
--     TI: Accenture 32%, IBM 38%, Cognizant 29%.
--   • Estudo-base TOESTE — Receita por FTE R$ 25–40 mil/mês (canais TOTVS),
--     % recorrência meta ≥ 50%, TOTVS 91% no segmento Gestão.
--
-- ATENÇÃO à diferença de numerador (é o que mais engana):
--   O dLER do Crabtree é MARGEM BRUTA ÷ folha DIRETA. Nosso LERM usa a folha
--   TOTAL (direta + gestão), então a régua fica naturalmente mais baixa que
--   2,0x — por isso 1,0 / 0,8 / 0,6, como na planilha. E o "LER Bruto" usa
--   RECEITA, não margem: não existe régua de mercado para ele (ver comentário
--   da linha), então a faixa vem da própria série histórica.
--
-- IDEMPOTENTE — só insere o que falta. Ligue v_sobrescrever para atualizar.
-- Requer: schema_v3_079_indicador_meta.sql e as linhas do seed de indicadores.
-- ============================================================

DO $$
DECLARE
  -- ══════════════ CONFIGURE AQUI ══════════════
  v_rel_codigo   text    := 'DRE';    -- relatório onde os indicadores foram criados
  v_sobrescrever boolean := false;    -- true = reescreve as metas já cadastradas destes indicadores
  -- ════════════ fim da configuração ════════════

  v_tenant uuid; v_rel uuid; v_linha uuid;
  r record;
  v_novas text := ''; v_pulados text := ''; v_ausentes text := '';
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;
  SELECT id INTO v_rel FROM relatorio WHERE tenant_id = v_tenant AND codigo = v_rel_codigo;
  IF v_rel IS NULL THEN RAISE EXCEPTION 'Relatório % não encontrado', v_rel_codigo; END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- codigo, maior_melhor, excelente, saudavel, atencao, benchmark_ref, comentario
      ('LER', true, 2.00::numeric, 1.80::numeric, 1.65::numeric,
       'Sem régua de mercado — 2,0x equivale a folha = 50% da receita líquida',
       'O LER Bruto (receita ÷ folha) é simplificação local: o indicador do mercado é o LER de Margem. '
       'Estas faixas vêm da própria série 2024–2026, que oscila entre 1,60x e 1,90x (mediana ~1,72x), '
       'como trilha de melhoria. NÃO use aqui as faixas 2,5/2,0/1,5 do estudo-base: elas são do dLER, '
       'cujo numerador é margem bruta, e deixariam a empresa presa em "Atenção" por erro de referência.'),

      ('LERM', true, 1.00::numeric, 0.80::numeric, 0.60::numeric,
       'Crabtree: dLER 2,0x (margem ÷ folha direta); serviços saudáveis 2,2–2,8x',
       'Este é o indicador canônico (margem bruta ÷ custo de pessoas). A régua de 2,0x do Crabtree vale '
       'para a folha DIRETA/faturável; como aqui o denominador é a folha total, a faixa fica em 1,0/0,8/0,6 '
       '(mesma da planilha). Para comparar com o 2,0x do livro, é preciso o dLER — separar folha direta '
       'de gestão por centro de custo (EFI-05 do benchmark).'),

      ('RFTE', true, 40000::numeric, 32000::numeric, 25000::numeric,
       'Canais TOTVS R$ 25–40 mil/mês por consultor; SPI 2025: US$ 210 mil/ano por consultor faturável',
       'Nosso RFTE é por pessoa-mês sobre o headcount TOTAL, não só o faturável — por isso a régua local '
       'é a que vale. O número do SPI (US$ 210 mil/ano, +6% sobre 2024) só é comparável se recortar os '
       'faturáveis. Depende da linha FTE estar lançada; sem ela o card fica zerado.'),

      ('CMP', true, NULL::numeric, NULL::numeric, NULL::numeric,
       'Sem meta de mercado — acompanhar a tendência junto com LER e utilização',
       'Custo médio por pessoa não tem "bom" absoluto: cair pode significar juniorização, subir pode ser '
       'senioridade que aumenta a margem. Fica sem faixa de propósito (o card mostra o número e a nota, '
       'sem chip de status). Ler sempre em par com o LER.'),

      ('MBP', true, 45::numeric, 38::numeric, 35::numeric,
       'SPI 2025: margem de projeto 37,7% (meta > 35%); saudável 35–45%',
       'Margem de projeto do SPI subiu para 37,7% em 2025, com a meta do benchmark em >35%. Em TI, as '
       'grandes ficam entre 29% e 38% (Cognizant 29, Accenture 32, IBM 38). Atenção ao escopo: a margem '
       'do relatório é da empresa toda, e o 37,7% do SPI é por projeto.'),

      ('PREC', true, 60::numeric, 50::numeric, 40::numeric,
       'Meta interna ≥ 50%; TOTVS: 91% de receita recorrente no segmento Gestão',
       'Indicador estratégico da transformação do negócio (FIN-04). Hoje a casa está em ~45–50%; a trilha '
       'de longo prazo mira 60%+. Só calcula depois da matriz de receita R1/R2/S1/S2 (bloco B do seed de '
       'indicadores) — sem ela o card fica zerado.')
    ) AS t(codigo, maior_melhor, excelente, saudavel, atencao, benchmark_ref, comentario)
  LOOP
    SELECT id INTO v_linha FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = r.codigo;
    IF v_linha IS NULL THEN
      v_ausentes := v_ausentes || r.codigo || ' ';
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM indicador_meta
                WHERE tenant_id = v_tenant AND linha_id = v_linha AND ano IS NULL AND empresa_id IS NULL)
       AND NOT v_sobrescrever THEN
      v_pulados := v_pulados || r.codigo || ' ';
      CONTINUE;
    END IF;

    INSERT INTO indicador_meta
      (tenant_id, linha_id, ano, empresa_id, maior_melhor, excelente, saudavel, atencao, benchmark_ref, comentario)
    VALUES
      (v_tenant, v_linha, NULL, NULL, r.maior_melhor, r.excelente, r.saudavel, r.atencao, r.benchmark_ref, r.comentario)
    ON CONFLICT (tenant_id, linha_id, ano, empresa_id) DO UPDATE SET
      maior_melhor = EXCLUDED.maior_melhor, excelente = EXCLUDED.excelente,
      saudavel = EXCLUDED.saudavel, atencao = EXCLUDED.atencao,
      benchmark_ref = EXCLUDED.benchmark_ref, comentario = EXCLUDED.comentario;
    v_novas := v_novas || r.codigo || ' ';
  END LOOP;

  RAISE NOTICE 'Gravadas: %', COALESCE(NULLIF(v_novas, ''), '(nenhuma)');
  IF v_pulados  <> '' THEN RAISE NOTICE 'Já tinham meta geral, mantidas: % — ligue v_sobrescrever para reescrever', v_pulados; END IF;
  IF v_ausentes <> '' THEN RAISE NOTICE 'Indicador não existe no relatório %, ignorado: %', v_rel_codigo, v_ausentes; END IF;
  RAISE NOTICE 'Calibre em Cadastros → Metas de indicadores. Faixa por ano/empresa = nova linha lá.';
END $$;

-- ── Conferência ──
SELECT rl.codigo, rl.descricao,
       CASE WHEN m.maior_melhor THEN 'maior ↑' ELSE 'menor ↓' END AS sentido,
       m.excelente, m.saudavel, m.atencao, m.benchmark_ref
  FROM indicador_meta m
  JOIN relatorio_linha rl ON rl.id = m.linha_id
  JOIN relatorio r ON r.id = rl.relatorio_id
 WHERE r.codigo = 'DRE'                 -- ajuste
   AND m.ano IS NULL AND m.empresa_id IS NULL
 ORDER BY rl.ordem;
