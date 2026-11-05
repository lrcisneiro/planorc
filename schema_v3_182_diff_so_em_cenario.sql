-- ============================================================
-- v3_182 — Baseline não tem Δ contra coisa nenhuma
--
-- ⚠ A v3_172 fez `aprovar_cenario` contar também as linhas de orçamento sem
-- veredito. `aprovar_cenario` é COMPARTILHADA com o cenário de POSTOS — e aí
-- fechar o cenário de postos de `Orçado2027` passou a dizer "faltam 77
-- vereditos de linha de orçamento", numa versão que nem é cenário de orçado.
--
-- A causa é o nulo ser tratado como valor: `cenario_orcado_diff` lê
-- `WHERE o.versao_id = v.origem_versao_id`, e numa baseline isso é
-- `= NULL` — nenhuma linha. Com o lado da baseline vazio, o `FULL JOIN`
-- devolve TODAS as linhas do outro lado como diferença. O diff não achou 77
-- alterações; ele comparou com o nada.
--
-- Conserto: sem `origem_versao_id`, não há o que comparar e a função devolve
-- vazio. **A guarda é de semântica, não de conveniência** — "o Δ de uma
-- baseline" é uma pergunta sem sentido, e responder 77 a ela é pior que
-- responder zero.
--
-- ⚠ Lição para a próxima: ao acrescentar uma condição a função COMPARTILHADA,
-- conferir o outro chamador. Eu testei o fluxo de orçamento e não o de postos.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION cenario_orcado_diff(p_versao uuid)
RETURNS TABLE(linha_id uuid, base numeric, cenario numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (
    SELECT id, origem_versao_id, ano FROM versao_orcamento
     WHERE id = p_versao AND tenant_id = current_tenant_id()
       AND origem_versao_id IS NOT NULL      -- só cenário de orçamento tem Δ
  ), b AS (
    SELECT o.linha_id, sum(o.valor) AS t FROM fat_orcado o, v
     WHERE o.versao_id = v.origem_versao_id AND o.ano = v.ano
       AND o.tenant_id = current_tenant_id()
     GROUP BY o.linha_id
  ), c AS (
    SELECT o.linha_id, sum(o.valor) AS t FROM fat_orcado o, v
     WHERE o.versao_id = v.id AND o.ano = v.ano
       AND o.tenant_id = current_tenant_id()
     GROUP BY o.linha_id
  )
  SELECT coalesce(b.linha_id, c.linha_id), coalesce(b.t, 0), coalesce(c.t, 0)
    FROM b FULL JOIN c ON c.linha_id = b.linha_id
   WHERE abs(coalesce(c.t, 0) - coalesce(b.t, 0)) > 0.005
$$;

SELECT 'v3_182 aplicada' AS resultado,
       (SELECT CASE WHEN prosrc LIKE '%origem_versao_id IS NOT NULL%' THEN 'sim' ELSE 'NÃO' END
          FROM pg_proc WHERE proname = 'cenario_orcado_diff') AS guarda_no_lugar;
