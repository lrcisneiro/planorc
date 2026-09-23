-- ============================================================
-- 102 — O total do terceiro contra a DRE, com a prova do que fica de fora
--
-- "Esse caso me gerou insegurança que estamos deixando valores sem conciliação
-- no razão de fora." O CLT já tinha a coluna "Item na DRE" para amarrar a
-- conferência ao relatório; o terceiro não tinha nada equivalente.
--
-- O universo do terceiro são as contas com folha de terceiro mais as irmãs de
-- DRE delas. Todo o razão dessas contas deveria estar no bloco — e em ago/2026
-- está, os R$ 3.651.153,71 batem exatos. Mas há um caso em que não bate: conta
-- amarrada à mesma linha e que a contabilização da folha TAMBÉM lança. O
-- lançamento dela não é nota (sai do bloco de terceiros) e a conta não é do
-- bloco de CLT quando a folha só a credita. Ficaria fora dos dois.
--
-- Em vez de esperar acontecer e alguém notar, o total vem com a lista do que
-- não está no bloco, com o motivo. Se a lista vier vazia, fechou.
-- ============================================================

CREATE OR REPLACE FUNCTION conciliacao_terceiros_total(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (razao_contas numeric, contas bigint)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  )
  SELECT sum(-fr.valor * coalesce(s.sinal, 1))::numeric, count(DISTINCT fr.conta_id)::bigint
    FROM fat_realizado fr
    JOIN ct ON ct.conta_id = fr.conta_id
    LEFT JOIN sinal s ON s.conta_id = fr.conta_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs));
$$;

-- ── O que está nas contas do terceiro e não aparece no bloco ──
-- Por construção: razao_contas = (casado + sem folha + sem dono) + isto.
CREATE OR REPLACE FUNCTION conciliacao_terceiros_fora(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_cod text, conta_desc text, motivo text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
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
         CASE WHEN fr.conta_id IN (SELECT conta_id FROM clt)
              THEN 'veio da contabilização da folha — está no bloco CLT'
              ELSE 'veio da contabilização da folha — em conta que o CLT não cobre' END,
         count(*)::bigint, sum(-fr.valor * coalesce(s.sinal, 1))::numeric
    FROM fat_realizado fr
    JOIN ct ON ct.conta_id = fr.conta_id
    JOIN conta_contabil cc ON cc.id = fr.conta_id
    LEFT JOIN sinal s ON s.conta_id = fr.conta_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     -- o bloco de terceiros só olha o que NÃO veio da contabilização da folha
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   GROUP BY 1, 2, 3
   ORDER BY abs(sum(-fr.valor * coalesce(s.sinal, 1))) DESC;
$$;
