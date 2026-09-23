-- ============================================================
-- 092 — O total do item, para amarrar a conferência à DRE
--
-- A conferência mostra só o que a folha toca. A DRE soma TODAS as contas
-- amarradas ao item. Enquanto os dois números não aparecem lado a lado, quem
-- confere não sabe se fechou de verdade:
--
--   Encargos e Benefícios   razão 85.055,90 + outros 33.091,67 = 118.147,57
--   DRE, mesma competência                                       118.263,00
--
-- A distância entre os dois tem TRÊS causas, e todas são legítimas:
--
--   1. conta do item em que a folha não lança nada — benefício que vem inteiro
--      do financeiro, rateio de outra unidade
--   2. contrapartida de crédito DENTRO de conta de despesa do item — o estorno
--      da verba 509 credita a própria conta de SALARIOS. A conciliação a exclui
--      (é o outro lado do lançamento, não tem folha a conciliar); a DRE a
--      inclui, porque para ela é redução de despesa. Em ago/2026 são
--      R$ 14.910,39 só no item de Salários.
--   3. conta do item que concilia no bloco de Terceiros, não no de CLT
--
-- Nenhuma delas é divergência. O que era divergência é não conseguir ver que
-- são elas — e sair procurando erro onde não há. Por isso o total do item vem
-- acompanhado da lista do que ele tem e a conferência não conta, com o motivo
-- de cada linha. Os quatro pedaços somam o total, por construção.
--
-- razao_item aplica o SINAL da amarração (conta_linha.sinal), porque é ele que
-- a DRE aplica.
-- ============================================================

-- ── O total de cada item: o mesmo número que a DRE mostra ──
CREATE OR REPLACE FUNCTION conciliacao_item_razao(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (linha_id uuid, razao_item numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  )
  SELECT i.linha_id, sum(-fr.valor * coalesce(s.sinal, 1))::numeric
    FROM fat_realizado fr
    JOIN item i  ON i.conta_id = fr.conta_id
    LEFT JOIN sinal s ON s.conta_id = fr.conta_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   GROUP BY i.linha_id;
$$;

-- ── O que o item tem e a conferência não conta, com o motivo ──
-- Por construção fecha: razao_item = razão + outros + tudo o que sai daqui.
CREATE OR REPLACE FUNCTION conciliacao_item_fora(
  p_ano int, p_mes int, p_relatorio_id uuid, p_linha_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_cod text, conta_desc text, motivo text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH item AS (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  terc AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  cred AS (
    SELECT DISTINCT ccred.id AS conta_id, btrim(coalesce(ff.verba_cod, '')) AS v
      FROM fat_folha ff
      JOIN conta_contabil cdeb  ON cdeb.id = ff.conta_id
      JOIN conta_contabil ccred ON ccred.tenant_id = cdeb.tenant_id
                               AND ccred.plano_id IS NOT DISTINCT FROM cdeb.plano_id
                               AND ccred.codigo = btrim(ff.conta_cred_cod)
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.conta_cred_cod, '') <> ''
  ),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  ),
  lan AS (
    SELECT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS verba,
           (-fr.valor * coalesce(s.sinal, 1))::numeric AS valor
      FROM fat_realizado fr
      JOIN item i ON i.conta_id = fr.conta_id AND i.linha_id = p_linha_id
      LEFT JOIN sinal s ON s.conta_id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
  )
  SELECT cc.codigo, cc.descricao, x.motivo, count(*)::bigint, sum(x.valor)::numeric
    FROM (
      SELECT lan.conta_id, lan.valor,
             CASE
               WHEN lan.conta_id NOT IN (SELECT conta_id FROM clt)
                AND lan.conta_id IN (SELECT conta_id FROM terc) THEN 'concilia no bloco Terceiros'
               WHEN lan.conta_id NOT IN (SELECT conta_id FROM clt) THEN 'conta do item sem folha'
               WHEN EXISTS (SELECT 1 FROM cred WHERE cred.conta_id = lan.conta_id AND cred.v = lan.verba)
                    THEN 'contrapartida de crédito da folha'
               ELSE NULL END AS motivo
        FROM lan
    ) x
    JOIN conta_contabil cc ON cc.id = x.conta_id
   WHERE x.motivo IS NOT NULL
   GROUP BY 1, 2, 3
   ORDER BY abs(sum(x.valor)) DESC;
$$;
