-- ============================================================
-- 099 — O lado FOLHA do drill também é por empresa · filial · CC
--
-- SERGIO DA SILVA SACCHI, ago/2026: a folha dele vem RATEADA em seis linhas,
-- uma por empresa (YY 1.402,63 · ZZ 1.693,24 · 25 1.028,00 · 06 745,31 ·
-- 01 2.484,02 · 05 2.531,46). O razão traz as seis, uma por empresa. E o drill
-- mostrava UMA linha de folha, de R$ 9.884,66, marcada como empresa ZZ.
--
-- A v3_098 acrescentou as colunas de empresa e filial, mas só no SELECT: o lado
-- da folha continuava agrupando por conta × verba × CC, e o max(empresa) da
-- agregação escolhia uma das seis. As colunas certas, mostrando o dado errado —
-- pior do que não ter a coluna, porque parece informação.
--
-- Granularidade é por empresa · filial · CC, e isso vale para o GROUP BY, não
-- só para a exibição. Agora os dois lados saem no mesmo grão e dá para comparar
-- linha a linha: a folha de YY contra a nota de YY.
--
-- (Na linha de RESUMO — a pessoa no bloco de terceiros, a pessoa dentro de uma
-- verba — continua valendo o agregado com "vários", porque ali o grão é a
-- pessoa. O grão empresa·filial·cc é do DETALHE.)
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_terceiros_pessoa(int, int, uuid, uuid, text, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_pessoa(
  p_ano int, p_mes int, p_relatorio_id uuid, p_filial_id uuid, p_matricula text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  lado text, empresa_cod text, filial_cod text, conta_cod text, conta_desc text,
  ref text, cc_cod text, data date, documento text, historico text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH contas_clt AS (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes))
  SELECT 'RAZÃO', e.codigo, fl.codigo, cc2.codigo, cc2.descricao, a.fornecedor_cod, ccu.codigo,
         a.data, a.documento, a.historico, a.valor
    FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
    JOIN conta_contabil cc2 ON cc2.id = a.conta_id
    LEFT JOIN empresa e  ON e.id  = a.lanc_empresa_id
    LEFT JOIN filial  fl ON fl.id = a.lanc_filial_id
    LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
   WHERE a.matricula = p_matricula AND a.filial_id IS NOT DISTINCT FROM p_filial_id

  UNION ALL
  -- empresa e filial ENTRAM NO GRUPO: a folha rateada tem uma linha por
  -- empresa, e é assim que ela se compara com a nota
  SELECT 'FOLHA', e.codigo, fl.codigo, cc2.codigo, cc2.descricao,
         btrim(coalesce(ff.verba_cod, '')) || ' ' || coalesce(ff.verba_desc, ''), ccu.codigo,
         NULL::date, NULL::text, NULL::text, sum(ff.valor)::numeric
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
   GROUP BY e.codigo, fl.codigo, cc2.codigo, cc2.descricao,
            btrim(coalesce(ff.verba_cod, '')), ff.verba_desc, ccu.codigo
   ORDER BY 1, 4, 2, 11 DESC;
$$;
