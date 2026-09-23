-- ============================================================
-- 104 — O total do terceiro por ITEM, que é o que amarra na DRE
--
-- A v3_102 somava todo o razão das contas do universo do terceiro e chamava
-- isso de "contas na DRE". Só que o universo não é uma linha da DRE: ele é
-- "contas com folha de terceiro MAIS as irmãs de DRE delas", e a semente pode
-- ter contas de itens diferentes. O número não tinha par no relatório.
--
-- Ricardo: "tem alguma coisa errada na soma do DRE de terceiros" — 4.806.414,58
-- na tela contra 3.904.708 na linha Terceiros Internos. Não havia erro de conta;
-- havia erro de rótulo. Somar certo a coisa errada é pior do que somar errado,
-- porque parece conferir.
--
-- Agora sai uma linha por item, com o razão do item (todas as contas amarradas
-- a ele, que é exatamente o que a DRE mostra) contra o que o bloco cobre. Aí
-- "Terceiros Internos" tem par no relatório e a diferença é de uma linha só.
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_terceiros_total(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_total(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  linha_id uuid, linha_cod text, linha_desc text, linha_ordem int,
  razao_item numeric, razao_bloco numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  atr AS MATERIALIZED (SELECT * FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs)),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  ),
  -- o que o BLOCO cobre, por item da conta do lançamento
  bloco AS (
    SELECT coalesce(i.linha_id::text, '') AS k, sum(a.valor)::numeric AS valor
      FROM atr a LEFT JOIN item i ON i.conta_id = a.conta_id
     GROUP BY 1
  ),
  -- o que a DRE mostra nesses itens: TODAS as contas amarradas a eles
  dre AS (
    SELECT coalesce(i.linha_id::text, '') AS k,
           -- não há max(uuid) no Postgres; o id é constante dentro do grupo
           (array_agg(i.linha_id))[1] AS linha_id,
           max(i.linha_cod) AS cod, max(i.linha_desc) AS desc_, max(i.linha_ordem) AS ordem,
           sum(-fr.valor * coalesce(s.sinal, 1))::numeric AS valor
      FROM fat_realizado fr
      JOIN item i ON i.conta_id = fr.conta_id
      LEFT JOIN sinal s ON s.conta_id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND coalesce(i.linha_id::text, '') IN (SELECT k FROM bloco)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1
  )
  SELECT d.linha_id, d.cod, d.desc_, d.ordem,
         coalesce(d.valor, 0)::numeric, coalesce(b.valor, 0)::numeric
    FROM bloco b LEFT JOIN dre d ON d.k = b.k
   WHERE coalesce(b.valor, 0) <> 0 OR coalesce(d.valor, 0) <> 0
   ORDER BY d.ordem NULLS LAST, d.cod;
$$;

-- ── O que fica de fora, agora por item ──
DROP FUNCTION IF EXISTS conciliacao_terceiros_fora(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_fora(
  p_ano int, p_mes int, p_relatorio_id uuid, p_linha_id uuid DEFAULT NULL,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_cod text, conta_desc text, motivo text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  )
  SELECT cc.codigo, cc.descricao,
         CASE
           WHEN btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
             THEN CASE WHEN fr.conta_id IN (SELECT conta_id FROM clt)
                       THEN 'veio da contabilização da folha — está no bloco CLT'
                       ELSE 'veio da contabilização da folha — em conta que o CLT não cobre' END
           WHEN fr.conta_id NOT IN (SELECT conta_id FROM ct)
             THEN 'conta do item que não é de terceiro'
           ELSE 'não classificado — avise, é defeito da conferência'
         END,
         count(*)::bigint, sum(-fr.valor * coalesce(s.sinal, 1))::numeric
    FROM fat_realizado fr
    JOIN item i ON i.conta_id = fr.conta_id
    JOIN conta_contabil cc ON cc.id = fr.conta_id
    LEFT JOIN sinal s ON s.conta_id = fr.conta_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND (p_linha_id IS NULL OR i.linha_id = p_linha_id)
     -- o que o bloco de terceiros NÃO olha: o que veio da folha, ou conta fora
     -- do universo do terceiro
     AND (btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
       OR fr.conta_id NOT IN (SELECT conta_id FROM ct))
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   GROUP BY 1, 2, 3
   ORDER BY abs(sum(-fr.valor * coalesce(s.sinal, 1))) DESC;
$$;
