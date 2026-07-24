-- ============================================================
-- contas_com_movimento: filtro OPCIONAL por ano.
--
-- Antes agregava a fat_realizado inteira (todos os anos), então o filtro
-- "só com movimento" da Amarração mostrava conta que só teve lançamento em
-- anos antigos. Agora aceita o ano do orçamento selecionado na tela.
--
-- p_ano NULL = sem filtro de ano (comportamento anterior) — necessário para
-- o BALANÇO PATRIMONIAL, onde a conta é patrimonial e o movimento relevante
-- pode estar fora do ano do orçamento.
--
-- DROP + CREATE (não OR REPLACE): mudar a assinatura criaria uma sobrecarga,
-- e aí chamar contas_com_movimento() sem argumento ficaria ambíguo entre a
-- versão 0-ária e a de 1 argumento com DEFAULT. Caller único: AmarracaoPage.
-- ============================================================
DROP FUNCTION IF EXISTS contas_com_movimento();

CREATE OR REPLACE FUNCTION contas_com_movimento(p_ano int DEFAULT NULL)
RETURNS TABLE(conta_id uuid, n bigint, saldo numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT conta_id, count(*)::bigint, sum(valor)::numeric
  FROM fat_realizado
  WHERE tenant_id = current_tenant_id() AND conta_id IS NOT NULL
    AND (p_ano IS NULL OR ano = p_ano)
  GROUP BY conta_id
$$;
