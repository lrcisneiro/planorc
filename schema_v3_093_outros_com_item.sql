-- ============================================================
-- 093 — "Outros" carrega a identidade da conta e o item
--
-- SINTOMA: no item de Salários a tela mostrou R$ 892,89 de distância até a DRE,
-- e a lista que deveria explicar a distância veio VAZIA.
--
-- CAUSA: a tela montava a lista de contas a partir de conciliacao_clt, que só
-- devolve conta com razão de folha ou folha no recorte. Conta que no recorte
-- escolhido tem SÓ "outros" — lançamento do financeiro e mais nada — não
-- aparecia ali, e o "outros" dela não entrava no total do item. A DRE conta;
-- a soma da tela não contava; e a lista do que falta, que é feita no banco, não
-- via diferença nenhuma porque no banco a identidade fecha.
--
-- Ou seja: o erro não estava em nenhuma das duas contas, estava no encontro
-- delas. É o tipo de furo que só aparece com recorte de escopo — sem filtro a
-- conta quase sempre tem alguma folha e o problema some.
--
-- CORREÇÃO: conciliacao_clt_outros passa a devolver a identidade da conta e o
-- item a que ela pertence, para a tela poder montar a linha mesmo quando a
-- conta não tem mais nada. Assim o total do item é sempre a soma do que está na
-- tela, e não uma soma parcial.
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_clt_outros(int, int, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_clt_outros(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, conta_cod text, conta_desc text, plano_cod text,
  linha_id uuid, linha_cod text, linha_desc text, linha_ordem int,
  lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  o AS (
    SELECT fr.conta_id, count(*)::bigint AS lancamentos, sum(-fr.valor)::numeric AS valor
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND fr.conta_id IN (SELECT conta_id FROM ct)
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1
    HAVING sum(fr.valor) <> 0
  )
  SELECT o.conta_id, cc.codigo, cc.descricao, pc.codigo,
         i.linha_id, i.linha_cod, i.linha_desc, i.linha_ordem,
         o.lancamentos, o.valor
    FROM o
    JOIN conta_contabil cc ON cc.id = o.conta_id
    LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
    LEFT JOIN item i ON i.conta_id = o.conta_id;
$$;
