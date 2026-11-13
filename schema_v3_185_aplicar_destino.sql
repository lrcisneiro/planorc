-- ============================================================
-- v3_185 — o Aplicar de postos ganha DESTINO, e a trava sai da tela
--
-- POR QUE: com os cenários de posto em atualização não havia como ver o efeito
-- deles no orçamento — o `Aplicar no orçado` exige o cenário aprovado, e
-- aprovar só para poder olhar inverte a ordem das coisas. O caminho desenhado
-- (docs/DESIGN_orcado_preliminar.md) é aplicar numa versão PRELIMINAR: copiar a
-- baseline com `copiar_versao` e pousar ali os postos "como se tudo passasse".
--
-- A regra, invertida e mais honesta que a de hoje:
--   destino BASELINE (origem_versao_id nulo) → exige carimbo
--   destino CENÁRIO  (origem_versao_id cheio) → dispensa; cenário é hipótese,
--                                               não dinheiro
--
-- ⚠⚠ A TRAVA DE HOJE É SÓ DE TELA — uma linha em `PostosGradePage`. Relaxar a
-- regra sem fechar no banco deixaria "exige aprovação" como teatro, que é
-- exatamente a lição da v3_174: a autoridade existia na FUNÇÃO e faltava na
-- TABELA. Então a regra passa a valer aqui, para qualquer caminho que escreva.
--
-- ⚠ Gatilho de COMANDO, não de linha: o Aplicar insere 13 mil células em lotes
-- de 500, e por linha isto seria 13 mil consultas a `versao_orcamento` e
-- `posto_versao`. Com tabela de transição é uma por lote. Mesmo motivo dos
-- gatilhos da v3_172.
--
-- ⚠ O que NÃO pode quebrar, e por isso o predicado é estreito:
--   · `copiar_versao` semeia POSTO numa versão nova, que nasce CENÁRIO → passa;
--   · aplicar numa baseline SEM nenhuma decisão de cenário é o uso normal de
--     quem orça pelo cadastro → passa (é o `EXISTS` em `posto_versao`);
--   · `mesclar_cenario_orcado` grava só MANUAL → nem chega aqui.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION fat_orcado_posto_exige_carimbo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cod text; v_n int;
BEGIN
  SELECT vo.codigo, count(*) OVER () INTO v_cod, v_n
    FROM (SELECT DISTINCT versao_id FROM novas WHERE origem = 'POSTO') n
    JOIN versao_orcamento vo ON vo.id = n.versao_id
   WHERE vo.origem_versao_id IS NULL          -- é baseline, não cenário
     AND vo.aprovado_em IS NULL               -- sem carimbo
     AND EXISTS (SELECT 1 FROM posto_versao pv WHERE pv.versao_id = vo.id)
   LIMIT 1;

  IF v_cod IS NOT NULL THEN
    RAISE EXCEPTION
      'A versão % tem decisões de cenário de posto e NÃO foi aprovada: o orçado de folha dela não pode ser regravado. Aprove o cenário, ou aplique numa versão preliminar (criada a partir dela) para só simular.', v_cod
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_fat_orcado_posto_carimbo ON fat_orcado;
CREATE TRIGGER trg_fat_orcado_posto_carimbo
AFTER INSERT ON fat_orcado
REFERENCING NEW TABLE AS novas
FOR EACH STATEMENT EXECUTE FUNCTION fat_orcado_posto_exige_carimbo();

-- ---------------- conferência ----------------
SELECT 'gatilho' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgname = 'trg_fat_orcado_posto_carimbo' AND NOT tgisinternal)
            THEN 'criado' ELSE '⛔ não criado' END AS resultado
UNION ALL
SELECT 'é de comando?',
       CASE WHEN (SELECT tgtype & 1 FROM pg_trigger WHERE tgname = 'trg_fat_orcado_posto_carimbo') = 0
            THEN 'sim (FOR EACH STATEMENT)' ELSE '⛔ virou de linha' END
UNION ALL
SELECT 'versões que o gatilho barraria hoje',
       coalesce((SELECT string_agg(vo.codigo, ', ')
                   FROM versao_orcamento vo
                  WHERE vo.origem_versao_id IS NULL AND vo.aprovado_em IS NULL
                    AND EXISTS (SELECT 1 FROM posto_versao pv WHERE pv.versao_id = vo.id)),
                'nenhuma');
