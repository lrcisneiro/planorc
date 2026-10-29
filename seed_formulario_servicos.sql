-- ============================================================
-- SEED — Formulário "Receita de serviços (TOTVS)" (F5)
--
-- A terceira linha de meta. Decisões tomadas em 29/out:
--   · a receita cai no MÊS DA EXECUÇÃO — o mesmo mês da meta;
--   · a meta JÁ É a receita — não há percentual de repasse;
--   · serviço é pontual — não deixa cauda recorrente.
--
-- Com isso o formulário não tem fórmula nenhuma: nada de ANTERIOR(), nada de
-- carteira, nada de churn. E por não usar ANTERIOR() ele é o ÚNICO dos três
-- IMUNE ao furo de virada de ano que custou uma correção no MRR (METADEZ) e
-- outra no NR (PARCANT) — não há safra anterior escorrendo para dentro do ano.
--
-- UMA LINHA SÓ. O Aplicar monta os destinos com
-- `linhas.filter(l => l.conta_destino_id)`, sem olhar o tipo_linha
-- (FormularioEditorPage.tsx), então uma ANALITICA com conta de destino grava
-- igual a uma FORMULA. Criar uma linha de fórmula `=[METASV]` só para ter uma
-- "linha-resultado" seria cerimônia sem função.
--
-- Se um dia a meta deixar de ser a receita — abatimento, taxa de realização —
-- o acréscimo é barato e NEUTRO POR CONSTRUÇÃO se vier como desconto:
--   driver  DESCSV  '% de abatimento sobre a meta'
--   fórmula RECSV   '=[METASV] * (1 - [DESCSV]/100)'   ← vazio = 0 = meta cheia
-- e aí a conta de destino migra da METASV para a RECSV. Não está aqui porque
-- hoje a meta é a receita, e driver que não se usa é driver que se preenche
-- errado.
--
-- ───────── UMA LINHA POR CONTA DE SERVIÇO (decidido 29/out) ─────────
-- Serviços não tem UMA conta, tem uma família sob a sintética 110: 11001 Horas
-- Abertas, 11002 Projetos Fechados, 11003 OutSourcing, 11004 Banco de Horas,
-- 11005 Templates/Add-Ons, 11006 Sustentação, 11007 Templates Adesão, 11008
-- Assessoria MKT, 11009 Horas Projetos Bolívia, 11011 Template (Recorrência),
-- 11020 Reembolso por NF. O MRR e o NR, por comparação, gravam numa conta só.
--
-- O formulário ganha TODAS elas como linhas, criadas vazias. Hoje preenche-se
-- só a METASV, com a meta consolidada; quando o estudo trouxer a meta por tipo
-- de serviço, as outras linhas já estão lá esperando — é só preencher.
--
-- ⚠ POR QUE A METASV NÃO É UMA LINHA A MAIS. Ela aponta para a 11001, e as
-- demais linhas apontam cada uma para a SUA conta — nunca duas para a mesma.
-- Se houvesse uma "METASV consolidada" além de uma "SV11001", preencher as
-- duas somaria duas vezes na 11001, e nada na tela denunciaria. Assim, no dia
-- da divisão, a METASV simplesmente PASSA A SER a linha de Horas Abertas: você
-- tira dela o que é dos outros tipos e distribui. Nenhum dado se move de conta.
--
-- ⚠ Enquanto a meta estiver consolidada na 11001, Orçado × Realizado fecha no
-- TOTAL de serviços, não linha a linha: o realizado de Sustentação, OutSourcing
-- e Projetos Fechados continua caindo nas contas deles, e a DRE mostrará orçado
-- zero contra realizado cheio nessas linhas — e o contrário em Horas Abertas.
-- Não é erro de carga.
--
-- ⚠ A 11020 (Reembolso de Despesas por NF) está na faixa 110 mas é reembolso,
-- não venda de serviço. Entra porque a faixa a inclui; deixe-a vazia se o
-- reembolso não for meta comercial.
--
-- O Aplicar ignora linha sem valor (`if (!v) continue`), então as dez linhas
-- vazias não gravam nada e não atrapalham.
--
-- O FORMULÁRIO JÁ EXISTE — código `SERVICO`, criado vazio (0 linhas). Este seed
-- só acrescenta a linha e preenche a descrição; NÃO cria formulário e NÃO
-- renomeia o seu. Se o código não for achado, aborta em vez de criar um
-- segundo formulário de serviços ao lado do existente.
--
-- Idempotente: re-rodar ATUALIZA a descrição e a linha, e preenche a conta de
-- destino só se ela estiver vazia — uma troca feita na tela de Estrutura
-- sobrevive (é o COALESCE no ON CONFLICT, lá embaixo).
-- ============================================================

DO $$
DECLARE
  v_form  uuid;
  v_conta uuid;
BEGIN
  SELECT id INTO v_form FROM formulario WHERE codigo = 'SERVICO';
  IF v_form IS NULL THEN
    RAISE EXCEPTION 'Formulário de código SERVICO não encontrado. Confira o código na tela de Formulários antes de rodar — criar um novo aqui deixaria dois formulários de serviços.';
  END IF;

  UPDATE formulario
     SET descricao = 'Meta de serviços = receita no mês da execução. Sem repasse, sem parcelamento e sem cauda recorrente — o mais simples dos três.'
   WHERE id = v_form;

  SELECT id INTO v_conta FROM conta_orcamentaria WHERE codigo = '11001';
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'Conta orçamentária 11001 (Serviços Horas Abertas) não encontrada.';
  END IF;

  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  VALUES
    (v_form, 'METASV', 'Meta de serviços — CONSOLIDADA hoje; vira Horas Abertas ao abrir por tipo (→ 11001)',
     10, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA', 2, v_conta)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, expressao = EXCLUDED.expressao,
        natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
        casas_decimais = EXCLUDED.casas_decimais,
        -- COALESCE e não EXCLUDED direto: se você já tiver trocado a conta na
        -- tela de Estrutura, re-rodar o seed NÃO desfaz a sua escolha.
        conta_destino_id = COALESCE(formulario_linha.conta_destino_id,
                                    EXCLUDED.conta_destino_id);

  -- ---- uma linha por conta de serviço, menos a 11001 (que é a METASV) ----
  -- Dinâmico de propósito: conta nova na faixa 110 entra sozinha numa
  -- re-rodada, em vez de ficar faltando sem ninguém perceber.
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  SELECT v_form,
         'SV' || co.codigo,
         co.descricao || ' (→ ' || co.codigo || ')',
         20 + 10 * (row_number() OVER (ORDER BY co.codigo))::int,
         1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA', 2, co.id
    FROM conta_orcamentaria co
   WHERE co.codigo LIKE '110__'          -- 5 posições: exclui a sintética '110'
     AND co.codigo <> '11001'            -- essa é a METASV
     AND co.natureza = 'RECEITA'
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
        formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais,
        conta_destino_id = COALESCE(formulario_linha.conta_destino_id,
                                    EXCLUDED.conta_destino_id);
END $$;

-- ---------- conferência ----------
-- A coluna `alerta` vigia o risco deste desenho: duas linhas na MESMA conta
-- somariam duas vezes se ambas fossem preenchidas.
SELECT l.ordem, l.codigo, l.descricao,
       COALESCE(co.codigo || ' · ' || co.descricao, '⚠ SEM CONTA — o Aplicar recusa') AS destino,
       CASE WHEN count(*) OVER (PARTITION BY l.conta_destino_id) > 1
            THEN '⚠ CONTA REPETIDA — preencher as duas soma em dobro' ELSE '' END AS alerta,
       (SELECT count(*) FROM formulario_valor v WHERE v.linha_id = l.id) AS n_valores
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
  LEFT JOIN conta_orcamentaria co ON co.id = l.conta_destino_id
 WHERE f.codigo = 'SERVICO'
 ORDER BY l.ordem;
