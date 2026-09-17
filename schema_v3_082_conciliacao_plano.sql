-- ============================================================
-- 082 — Conciliação contábil × folha: mostrar o PLANO da conta
--
-- Conta contábil é única por plano, não por código: com 5 planos no tenant, o
-- mesmo "41011001 - SALARIOS" existe em vários, e a conciliação (que agrupa por
-- conta_id, como deve) exibia linhas repetidas e indistinguíveis. O plano é o
-- que separa uma da outra.
--
-- DROP antes do CREATE: mudar as colunas de retorno de uma função não é
-- permitido no CREATE OR REPLACE.
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_folha_contabil(int, int, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_folha_contabil(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL,
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id   uuid,
  conta_cod  text,
  conta_desc text,
  plano_cod  text,
  verba_cod  text,
  verba_desc text,
  origem     text,
  razao      numeric,
  folha      numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH fo AS (
    SELECT ff.conta_id,
           btrim(coalesce(ff.verba_cod, '')) AS verba_cod,
           max(ff.verba_desc)                AS verba_desc,
           sum(ff.valor)::numeric            AS valor
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id()
       AND ff.tipo = 'REALIZADO' AND ff.ano = p_ano AND ff.mes = p_mes
       AND ff.conta_id IS NOT NULL
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  ),
  verbas AS (SELECT DISTINCT verba_cod FROM fo WHERE verba_cod <> ''),
  rz AS (
    SELECT fr.conta_id,
           coalesce(v.verba_cod, '')      AS verba_cod,
           (v.verba_cod IS NOT NULL)      AS eh_folha,
           sum(-fr.valor)::numeric        AS valor
      FROM fat_realizado fr
      LEFT JOIN verbas v
             ON v.verba_cod = btrim(split_part(coalesce(fr.historico, ''), '-', 1))
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes
       AND fr.conta_id IN (SELECT DISTINCT conta_id FROM fo)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2, 3
  ),
  rz_folha AS (SELECT conta_id, verba_cod, valor FROM rz WHERE eh_folha),
  juntos AS (
    SELECT coalesce(f.conta_id, r.conta_id)   AS conta_id,
           coalesce(f.verba_cod, r.verba_cod) AS verba_cod,
           f.verba_desc                       AS verba_desc,
           'FOLHA'::text                      AS origem,
           coalesce(r.valor, 0)::numeric      AS razao,
           coalesce(f.valor, 0)::numeric      AS folha
      FROM fo f
      FULL JOIN rz_folha r ON r.conta_id = f.conta_id AND r.verba_cod = f.verba_cod
    UNION ALL
    SELECT rz.conta_id, NULL::text, NULL::text, 'OUTRAS'::text,
           sum(rz.valor)::numeric, 0::numeric
      FROM rz WHERE NOT rz.eh_folha GROUP BY rz.conta_id
  )
  SELECT j.conta_id, cc.codigo, cc.descricao, pc.codigo,
         nullif(j.verba_cod, ''), j.verba_desc,
         j.origem, j.razao, j.folha
    FROM juntos j
    JOIN conta_contabil cc ON cc.id = j.conta_id
    LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
   ORDER BY cc.codigo, pc.codigo, j.origem DESC, j.verba_cod NULLS FIRST;
$$;
