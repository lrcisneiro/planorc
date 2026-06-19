-- ============================================================
-- Copiar os lançamentos do orçado de uma versão para outra.
-- Mantém linha/empresa/filial/CC/período/valor/fórmula/dims;
-- troca apenas o versao_id. p_substituir = true limpa o destino antes.
-- Roda como SECURITY INVOKER (respeita o RLS do tenant).
-- ============================================================
CREATE OR REPLACE FUNCTION copiar_versao_orcado(
  p_origem uuid,
  p_destino uuid,
  p_substituir boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql
SET statement_timeout = '180s'   -- volume grande: sobrepõe o timeout curto da role anon
AS $$
DECLARE n int;
BEGIN
  IF p_origem = p_destino THEN
    RAISE EXCEPTION 'Origem e destino são iguais.';
  END IF;
  IF p_substituir THEN
    DELETE FROM fat_orcado
      WHERE versao_id = p_destino AND tenant_id = current_tenant_id();
  END IF;
  INSERT INTO fat_orcado
    (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
     valor, expressao, origem, origem_formulario_linha_id, dims)
  SELECT tenant_id, p_destino, linha_id, empresa_id, filial_id, cc_id, ano, mes,
         valor, expressao, origem, origem_formulario_linha_id, dims
  FROM fat_orcado
  WHERE versao_id = p_origem AND tenant_id = current_tenant_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
