-- ============================================================
-- 108 — Desfaz a v3_107 (conta aglutinada)
--
-- A v3_107 resolvia um problema que não existe. O pagamento da diretoria já
-- reside na conta de terceiros internos, no CC da diretoria — quem não tem
-- acesso ao CC não vê o lançamento, e o sigilo está resolvido pelo escopo de
-- dados. Não havia o que preencher no quadro.
--
-- Rode se a v3_107 chegou a ser aplicada. É idempotente: se não foi, não faz
-- mal nenhum — só reescreve as duas funções com o corpo que já era o vivo
-- (planorc_concil_contas da v3_106, conciliacao_item_fora da v3_092).
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_aglutinadas(int, int, uuid, uuid[], uuid[], uuid[]);
DROP TABLE IF EXISTS conciliacao_conta_aglutinada;

-- ── planorc_concil_contas volta ao corpo da v3_106 ──
CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  com_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM clt)
  ),
  masters AS (
    SELECT DISTINCT c.linha_id FROM conta_linha c
      JOIN com_folha f ON f.conta_id = c.conta_id
     WHERE c.tenant_id = current_tenant_id()
  )
  SELECT c.conta_id FROM conta_linha c
   WHERE c.tenant_id = current_tenant_id()
     AND c.linha_id IN (SELECT linha_id FROM masters)
     AND c.conta_id NOT IN (SELECT conta_id FROM clt)
  UNION
  SELECT conta_id FROM com_folha
$$;

-- ── conciliacao_item_fora volta ao corpo da v3_092 ──
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
