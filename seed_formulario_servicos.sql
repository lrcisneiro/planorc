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
-- ───────── A CONTA DE DESTINO É PROVISÓRIA (decidido 29/out) ─────────
-- Serviços não tem UMA conta, tem uma família: 11001 Horas Abertas (7 contas
-- contábeis amarradas), 11002 Projetos Fechados, 11003 OutSourcing, 11004
-- Banco de Horas, 11005 Templates, 11006 Sustentação (2), 11007 Templates
-- Adesão, 11008 Assessoria MKT, 11011 Template Recorrência (3) — sob a
-- sintética 110. O MRR e o NR, por comparação, gravam numa conta só (10201 e
-- 10101).
--
-- Para ESTA versão do orçamento — a que calibra o EBITDA e dimensiona o time
-- de serviços — tudo vai para a 11001. No orçamento final a meta se divide
-- entre as contas, como o realizado de 2026 já se divide.
--
-- ⚠ Consequência enquanto for uma conta só: Orçado × Realizado fecha no TOTAL
-- de serviços, não linha a linha. O realizado de Sustentação, OutSourcing e
-- Projetos Fechados continua caindo nas contas deles, e na DRE aparecerá como
-- orçado zero contra realizado cheio — e o contrário em Horas Abertas. Não é
-- erro de carga; é a provisoriedade.
--
-- ───────── COMO DIVIDIR DEPOIS (é barato) ─────────
-- O Aplicar grava UMA LINHA DE FORMULÁRIO POR CONTA — ele monta os destinos com
-- `linhas.filter(l => l.conta_destino_id)` e carimba o código da linha em
-- `dims`, então várias linhas coexistem no fat_orcado sem colidir. Dividir é
-- acrescentar linhas ANALITICA irmãs da METASV, cada uma com a sua conta:
--   METASV_HORAS → 11001 · METASV_SUST → 11006 · METASV_PROJ → 11002 …
-- Nenhuma migration, nenhuma fórmula, e o estudo passa a entregar a meta já
-- repartida. A METASV atual vira uma delas ou sai.
--
-- O FORMULÁRIO JÁ EXISTE — código `SERVICO`, criado vazio (0 linhas). Este seed
-- só acrescenta a linha e preenche a descrição; NÃO cria formulário e NÃO
-- renomeia o seu. Se o código não for achado, aborta em vez de criar um
-- segundo formulário de serviços ao lado do existente.
--
-- Idempotente: re-rodar ATUALIZA a descrição e a linha; NÃO mexe na conta
-- de destino que você tiver definido (o ON CONFLICT não lista a coluna).
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
    (v_form, 'METASV', 'Meta de serviços — receita do mês (R$)',
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
END $$;

-- ---------- conferência ----------
SELECT l.codigo, l.descricao, l.tipo_linha,
       COALESCE(co.codigo || ' · ' || co.descricao, '⚠ SEM CONTA — o Aplicar recusa') AS destino
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
  LEFT JOIN conta_orcamentaria co ON co.id = l.conta_destino_id
 WHERE f.codigo = 'SERVICO'
 ORDER BY l.ordem;
