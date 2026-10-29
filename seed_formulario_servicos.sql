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
-- ⚠ FALTA A CONTA DE DESTINO. O seed deixa `conta_destino_id` NULL de
-- propósito: eu não sei qual conta orçamentária recebe serviços, e chutar
-- colocaria receita numa linha errada da DRE. Defina em
-- /formularios/:id/estrutura (modo Estrutura, seletor de conta na linha) — ou
-- rode o UPDATE comentado no fim com o código certo. Sem conta, o Aplicar
-- avisa "Nenhuma linha tem conta de destino" e não grava nada.
--
-- Idempotente: re-rodar ATUALIZA nome, descrição e a linha; NÃO mexe na conta
-- de destino que você tiver definido (o ON CONFLICT não lista a coluna).
-- ============================================================

DO $$
DECLARE
  v_tenant uuid;
  v_form   uuid;
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;

  INSERT INTO formulario (tenant_id, codigo, nome, descricao)
  VALUES (v_tenant, 'VENDAS_SV', 'Receita de serviços (TOTVS)',
          'Meta de serviços = receita no mês da execução. Sem repasse, sem parcelamento e sem cauda recorrente — o mais simples dos três.')
  ON CONFLICT (tenant_id, codigo) DO UPDATE
    SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao
  RETURNING id INTO v_form;

  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais)
  VALUES
    (v_form, 'METASV', 'Meta de serviços — receita do mês (R$)',
     10, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA', 2)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, expressao = EXCLUDED.expressao,
        natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
        casas_decimais = EXCLUDED.casas_decimais;
        -- conta_destino_id de fora de propósito: re-rodar não apaga o destino.
END $$;

-- ---------- candidatas a conta de destino, para escolher ----------
-- Receita no plano orçamentário. Se a de serviços estiver aqui, use o código
-- dela no UPDATE abaixo (ou escolha na tela de Estrutura).
SELECT co.codigo, co.descricao, co.natureza,
       (SELECT count(*) FROM fat_realizado fr WHERE fr.linha_id = co.id) AS lanc_realizado
  FROM conta_orcamentaria co
 WHERE co.natureza = 'RECEITA'
    OR co.descricao ILIKE '%servi%'
    OR co.codigo LIKE '102%'
 ORDER BY co.codigo;

-- ---------- amarrar o destino (trocar o código e descomentar) ----------
-- UPDATE formulario_linha l
--    SET conta_destino_id = (SELECT id FROM conta_orcamentaria
--                             WHERE codigo = 'TROCAR_AQUI' LIMIT 1)
--   FROM formulario f
--  WHERE f.id = l.formulario_id AND f.codigo = 'VENDAS_SV' AND l.codigo = 'METASV';
