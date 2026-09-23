-- ============================================================
-- 100 — O drill da pessoa lado a lado, não em dois blocos
--
-- A v3_099 pôs os dois lados no mesmo grão, mas empilhados: seis linhas de
-- folha, depois seis de razão. Comparar exigia procurar a empresa de cima na
-- lista de baixo, de olho, linha por linha. Com seis empresas ainda dá; com
-- vinte, não.
--
-- Agora é uma linha por empresa · filial · CC, com folha e razão nas mesmas
-- colunas e a diferença calculada. A do Sacchi passa a ser o que ela é:
--
--   06 · 2001 · 133    folha 745,31    razão 745,30    −0,01
--
-- Arredondamento do rateio, visível em um relance em vez de dois blocos e uma
-- subtração mental.
--
-- FULL JOIN de propósito: empresa que só tem folha (nota não chegou) ou só tem
-- razão (nota lançada em empresa que a folha não rateou) É a divergência que se
-- procura, e some num INNER.
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_terceiros_pessoa(int, int, uuid, uuid, text, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_pessoa(
  p_ano int, p_mes int, p_relatorio_id uuid, p_filial_id uuid, p_matricula text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  empresa_cod text, filial_cod text, cc_cod text,
  folha_ref text, razao_ref text, historico text,
  lancamentos bigint, folha numeric, razao numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH contas_clt AS (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  -- a chave vai concatenada porque FULL JOIN não aceita IS NOT DISTINCT FROM
  -- (não é hash/merge-joinable), e empresa/filial/CC podem ser nulos
  rz AS (
    SELECT concat_ws('|', coalesce(e.codigo, ''), coalesce(fl.codigo, ''), coalesce(ccu.codigo, '')) AS k,
           e.codigo AS emp, fl.codigo AS fil, ccu.codigo AS cc,
           string_agg(DISTINCT cc2.codigo, ', ' ORDER BY cc2.codigo) AS conta,
           string_agg(DISTINCT coalesce(a.documento, ''), ', ') AS doc,
           max(a.historico) AS historico,
           count(*)::bigint AS lancamentos, sum(a.valor)::numeric AS valor
      FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
      JOIN conta_contabil cc2 ON cc2.id = a.conta_id
      LEFT JOIN empresa e  ON e.id  = a.lanc_empresa_id
      LEFT JOIN filial  fl ON fl.id = a.lanc_filial_id
      LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
     WHERE a.matricula = p_matricula AND a.filial_id IS NOT DISTINCT FROM p_filial_id
     GROUP BY 1, 2, 3, 4
  ),
  fo AS (
    SELECT concat_ws('|', coalesce(e.codigo, ''), coalesce(fl.codigo, ''), coalesce(ccu.codigo, '')) AS k,
           e.codigo AS emp, fl.codigo AS fil, ccu.codigo AS cc,
           string_agg(DISTINCT cc2.codigo, ', ' ORDER BY cc2.codigo) AS conta,
           string_agg(DISTINCT btrim(coalesce(ff.verba_cod, '')), ', ') AS verbas,
           sum(ff.valor)::numeric AS valor
      FROM fat_folha ff
      JOIN conta_contabil cc2 ON cc2.id = ff.conta_id
      LEFT JOIN empresa e  ON e.id  = ff.empresa_id
      LEFT JOIN filial  fl ON fl.id = ff.filial_id
      LEFT JOIN centro_custo ccu ON ccu.id = ff.cc_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes
       AND ff.matricula = p_matricula AND ff.filial_id IS NOT DISTINCT FROM p_filial_id
       AND ff.conta_id NOT IN (SELECT conta_id FROM contas_clt)
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2, 3, 4
  )
  SELECT coalesce(f.emp, r.emp), coalesce(f.fil, r.fil), coalesce(f.cc, r.cc),
         nullif(concat_ws(' · ', f.conta, f.verbas), ''),
         nullif(concat_ws(' · ', r.conta, nullif(r.doc, '')), ''),
         r.historico,
         coalesce(r.lancamentos, 0),
         coalesce(f.valor, 0)::numeric, coalesce(r.valor, 0)::numeric
    FROM fo f
    FULL JOIN rz r ON r.k = f.k
   ORDER BY abs(coalesce(r.valor, 0) - coalesce(f.valor, 0)) DESC,
            coalesce(f.emp, r.emp);
$$;
