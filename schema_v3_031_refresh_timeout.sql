-- ============================================================
-- 031 — refresh_realizado_mensal: timeout amplo
--
-- A reconstrução completa dos agregados (L1 fat_realizado_mensal,
-- L2 cubo_realizado, L3 cubo_realizado_anual) a partir de ~1M linhas
-- estourava o statement_timeout padrão. Aqui a função recebe um
-- SET statement_timeout grande (mesma técnica das RPCs de leitura).
-- Mesmo corpo da 029.
--
-- IDEMPOTENTE.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_realizado_mensal()
RETURNS void
LANGUAGE sql VOLATILE
SET statement_timeout = '600s'
AS $$
  -- L1
  DELETE FROM fat_realizado_mensal WHERE tenant_id = current_tenant_id();
  INSERT INTO fat_realizado_mensal (tenant_id, conta_id, empresa_id, filial_id, cc_id, linha_id, ano, mes, valor)
  SELECT fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes, sum(fr.valor)
  FROM fat_realizado fr
  WHERE fr.tenant_id = current_tenant_id()
    AND NOT EXISTS (
      SELECT 1 FROM lote_ignorado li
      WHERE li.tenant_id = fr.tenant_id AND li.ativo
        AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
        AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
        AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
    )
  GROUP BY fr.tenant_id, fr.conta_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.linha_id, fr.ano, fr.mes;

  -- L2 (resolve conta→linha com sinal; 1 linha por conta = última)
  DELETE FROM cubo_realizado WHERE tenant_id = current_tenant_id();
  INSERT INTO cubo_realizado (tenant_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, valor)
  SELECT t.tenant_id, t.linha_id, t.empresa_id, t.filial_id, t.cc_id, t.ano, t.mes, sum(t.v)
  FROM (
    SELECT m.tenant_id, m.linha_id, m.empresa_id, m.filial_id, m.cc_id, m.ano, m.mes, m.valor v
    FROM fat_realizado_mensal m
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NOT NULL
    UNION ALL
    SELECT m.tenant_id, cl.linha_id, m.empresa_id, m.filial_id, m.cc_id, m.ano, m.mes, (m.valor * cl.sinal) v
    FROM fat_realizado_mensal m
    JOIN (
      SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
      FROM conta_linha c WHERE c.tenant_id = current_tenant_id()
      ORDER BY c.conta_id, c.id DESC
    ) cl ON cl.conta_id = m.conta_id
    WHERE m.tenant_id = current_tenant_id() AND m.linha_id IS NULL
  ) t
  GROUP BY t.tenant_id, t.linha_id, t.empresa_id, t.filial_id, t.cc_id, t.ano, t.mes;

  -- L3 (anual por linha × empresa)
  DELETE FROM cubo_realizado_anual WHERE tenant_id = current_tenant_id();
  INSERT INTO cubo_realizado_anual (tenant_id, linha_id, empresa_id, ano, valor)
  SELECT tenant_id, linha_id, empresa_id, ano, sum(valor)
  FROM cubo_realizado WHERE tenant_id = current_tenant_id()
  GROUP BY tenant_id, linha_id, empresa_id, ano;
$$;
