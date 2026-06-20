-- ============================================================
-- 033 — Aplicar lotes ignorados aos DADOS (apaga do fat_realizado)
--
-- Para lançamentos JÁ importados, a regra com ativo só exclui na consulta
-- (cube). Esta função APAGA do fat_realizado as linhas que casam com as
-- regras ATIVAS do cadastro lote_ignorado — assim não é preciso reimportar.
-- Retorna a quantidade excluída. Recalcule os agregados depois
-- (refresh_realizado_mensal), o que o app faz na sequência.
--
-- IDEMPOTENTE (rodar de novo não acha mais nada).
-- ============================================================
CREATE OR REPLACE FUNCTION excluir_lotes_ignorados()
RETURNS bigint
LANGUAGE plpgsql VOLATILE
SET statement_timeout = '600s'
AS $$
DECLARE n bigint;
BEGIN
  WITH del AS (
    DELETE FROM fat_realizado fr
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.lote IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM lote_ignorado li
        WHERE li.tenant_id = fr.tenant_id AND li.ativo
          AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
          AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
          AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
      )
    RETURNING 1
  )
  SELECT count(*) INTO n FROM del;
  RETURN n;
END $$;
