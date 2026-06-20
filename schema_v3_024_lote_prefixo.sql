-- ============================================================
-- 024 — Lote ignorado por PREFIXO + sugestão por convenção
--
-- Os lotes de fechamento do cliente começam com "Q" (Q2025, Q42025,
-- QQ2025, Q12025…). O sufixo varia, então casar por código exato não
-- serve — precisamos casar por PREFIXO ("começa com Q").
--
-- IDEMPOTENTE.
-- ============================================================

-- 1) flag de prefixo no cadastro
ALTER TABLE lote_ignorado ADD COLUMN IF NOT EXISTS por_prefixo boolean NOT NULL DEFAULT false;

-- 2) helper passa a entender prefixo (case-insensitive quando por_prefixo)
CREATE OR REPLACE FUNCTION lote_eh_ignorado(p_lote text, p_sublote text, p_empresa uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM lote_ignorado li
    WHERE li.tenant_id = current_tenant_id() AND li.ativo
      AND (
        CASE WHEN li.por_prefixo
             THEN upper(p_lote) LIKE upper(li.lote) || '%'
             ELSE li.lote = p_lote
        END
      )
      AND (li.sublote   IS NULL OR li.sublote   = p_sublote)
      AND (li.empresa_id IS NULL OR li.empresa_id = p_empresa)
  )
$$;

-- 3) Sugestão melhor: lotes cujo código começa com LETRA (convenção de
--    fechamento, ex. "Q"), agrupados pelo 1º caractere, com volume e os
--    meses em que ocorrem. p_ano NULL = todos os anos.
DROP FUNCTION IF EXISTS lotes_candidatos_encerramento(int);
CREATE OR REPLACE FUNCTION lotes_candidatos_encerramento(p_ano int DEFAULT NULL)
RETURNS TABLE(prefixo text, exemplos text, linhas bigint, soma numeric, bruto numeric, meses text)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT upper(left(fr.lote, 1))                         AS prefixo,
         string_agg(DISTINCT fr.lote, ', ' ORDER BY fr.lote)
           FILTER (WHERE fr.lote IS NOT NULL)            AS exemplos,
         count(*)                                        AS linhas,
         sum(fr.valor)                                   AS soma,
         sum(abs(fr.valor))                              AS bruto,
         string_agg(DISTINCT lpad(fr.mes::text, 2, '0'), ',' ORDER BY lpad(fr.mes::text, 2, '0')) AS meses
  FROM fat_realizado fr
  WHERE fr.tenant_id = current_tenant_id()
    AND (p_ano IS NULL OR fr.ano = p_ano)
    AND fr.lote IS NOT NULL
    AND left(fr.lote, 1) ~ '[A-Za-z]'   -- só lotes que começam com letra
  GROUP BY upper(left(fr.lote, 1))
  ORDER BY count(*) DESC
$$;
