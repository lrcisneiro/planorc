-- ============================================================
-- v3_197 — cenário ÓRFÃO em `view_config.cenarios`
--
-- O QUE ACONTECEU (22/nov/2026): a visão "Orçado 2007 x 2027 Preliminar"
-- deixou de mostrar o Δ e o Δ%. Causa: ela guardava TRÊS cenários, e o do meio
-- (`210857b3-…`) era uma versão **excluída**. `view_config.cenarios` é
-- `text[]` sem FK — nem podia ter, porque o array mistura id de versão com as
-- chaves especiais `REALIZADO`, `REALIZADO@<ano>` e `REALIZADO_ANT` —, então
-- apagar a versão não limpou nada.
--
-- ⚠⚠ O SINTOMA NÃO APONTAVA PARA A CAUSA, e é isso que torna o caso caro: o
-- Δ só existe com **exatamente 2 séries**, e o morto contava como terceira.
-- Some a coluna que interessa, aparece uma coluna rotulada "—", e o modal
-- "Editar visão" mostra **2 marcados** — porque ele itera as versões que
-- existem. O estado inválido era invisível justamente na tela onde se iria
-- procurar por ele.
--
-- Duas pontas, e as duas são necessárias:
--   1. LIMPAR o que já está gravado (aqui);
--   2. IMPEDIR que volte — gatilho em `versao_orcamento`, porque a exclusão
--      acontece por três caminhos (Cadastros, `excluir_cenario` da v3_178 e
--      SQL à mão) e regra de tela não alcança nenhum dos três.
-- O frontend ainda descarta o órfão na leitura e AVISA: defesa em profundidade
-- para a visão já gravada em algum tenant que não rodou esta migration.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1 · gatilho: apagar a versão limpa as visões ────────────────────────
CREATE OR REPLACE FUNCTION view_config_sem_versao_morta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- ⚠ Só o id da versão apagada sai do array. As chaves especiais
  -- (`REALIZADO`, `REALIZADO@2026`, `REALIZADO_ANT`) não são ids e passam
  -- intactas — tirá-las apagaria metade das visões do produto.
  UPDATE view_config
     SET cenarios = array_remove(cenarios, OLD.id::text)
   WHERE cenarios @> ARRAY[OLD.id::text];
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_view_config_sem_versao_morta ON versao_orcamento;
CREATE TRIGGER trg_view_config_sem_versao_morta
  AFTER DELETE ON versao_orcamento
  FOR EACH ROW EXECUTE FUNCTION view_config_sem_versao_morta();

-- ── 2 · limpar o que já está gravado ────────────────────────────────────
-- ⚠ O filtro é "parece uuid E não existe em `versao_orcamento`". Testar só
-- "não existe" removeria `REALIZADO` e companhia; testar só "parece uuid"
-- removeria as versões boas.
WITH achados AS (
  SELECT vc.id, c AS morto
    FROM view_config vc, unnest(vc.cenarios) AS c
   WHERE c ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM versao_orcamento v WHERE v.id::text = c)
)
UPDATE view_config vc
   SET cenarios = (SELECT array_agg(c ORDER BY ord)
                     FROM unnest(vc.cenarios) WITH ORDINALITY AS t(c, ord)
                    WHERE c NOT IN (SELECT morto FROM achados a WHERE a.id = vc.id))
 WHERE vc.id IN (SELECT id FROM achados);

-- ---------------- conferência ----------------
SELECT 'cenários órfãos restantes' AS secao,
       coalesce((SELECT count(*)::text FROM view_config vc, unnest(vc.cenarios) AS c
                  WHERE c ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND NOT EXISTS (SELECT 1 FROM versao_orcamento v WHERE v.id::text = c)), '0') AS resultado
UNION ALL
SELECT 'gatilho instalado',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_view_config_sem_versao_morta')
            THEN 'sim' ELSE '⛔ não' END
UNION ALL
SELECT 'chaves REALIZADO preservadas (não podiam sumir)',
       (SELECT count(*)::text FROM view_config vc, unnest(vc.cenarios) AS c WHERE c LIKE 'REALIZADO%')
UNION ALL
SELECT 'visões com 2 cenários (o Δ só aparece assim)',
       (SELECT count(*)::text FROM view_config
         WHERE funcao = 'COMPARATIVO' AND coalesce(array_length(cenarios, 1), 0) = 2)
UNION ALL
SELECT 'visões COMPARATIVO com ≠ 2 (sem Δ, por desenho)',
       coalesce((SELECT string_agg(nome || ' (' || coalesce(array_length(cenarios, 1), 0)::text || ')', ', ')
                   FROM view_config
                  WHERE funcao = 'COMPARATIVO' AND coalesce(array_length(cenarios, 1), 0) <> 2), '—');
