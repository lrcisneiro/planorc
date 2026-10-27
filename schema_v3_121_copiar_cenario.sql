-- ============================================================
-- 121 — Copiar um CENÁRIO inteiro (não só o fat_orcado)
--
-- `copiar_versao_orcado` (v3_007) copia **apenas** `fat_orcado`, e nem ele
-- inteiro: deixa de fora `moeda_origem` e `val_m2..val_m5`, as colunas
-- materializadas de moeda — a versão copiada perdia a visão em US$ em silêncio.
--
-- E um cenário é mais que o fat_orcado. Sem as premissas junto, a versão
-- derivada nasce incoerente e basta alguém reaplicar um motor para ela voltar a
-- ser outra coisa:
--   versao_taxa        câmbio orçado — sem ele a conversão cai
--   premissa_dissidio  % por sindicato — sem ele a folha reaplicada muda
--   formulario_valor   os drivers
--   posto_versao       as DECISÕES de folha do cenário (v3_120); sem elas a
--                      folha do cenário derivado volta ao quadro mestre
--
-- Mantém a `copiar_versao_orcado` funcionando (corrigida) para quem só quer os
-- lançamentos, e acrescenta a cópia completa.
-- SECURITY INVOKER: respeita o RLS do tenant.
-- IDEMPOTENTE.
-- ============================================================

-- ---------- 1 · corrigir a cópia do fat_orcado (moeda) ----------
CREATE OR REPLACE FUNCTION copiar_versao_orcado(
  p_origem uuid,
  p_destino uuid,
  p_substituir boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql
SET statement_timeout = '180s'
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
     valor, expressao, origem, origem_formulario_linha_id, dims,
     moeda_origem, val_m2, val_m3, val_m4, val_m5)   -- <<< faltavam
  SELECT tenant_id, p_destino, linha_id, empresa_id, filial_id, cc_id, ano, mes,
         valor, expressao, origem, origem_formulario_linha_id, dims,
         moeda_origem, val_m2, val_m3, val_m4, val_m5
  FROM fat_orcado
  WHERE versao_id = p_origem AND tenant_id = current_tenant_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------- 2 · copiar o cenário inteiro ----------
-- Devolve uma linha por tabela copiada, para a tela mostrar o que veio junto.
CREATE OR REPLACE FUNCTION copiar_versao_cenario(
  p_origem uuid,
  p_destino uuid,
  p_substituir boolean DEFAULT true
) RETURNS TABLE (tabela text, linhas integer)
LANGUAGE plpgsql
SET statement_timeout = '300s'
AS $$
DECLARE t uuid := current_tenant_id(); n int;
BEGIN
  IF p_origem = p_destino THEN
    RAISE EXCEPTION 'Origem e destino são iguais.';
  END IF;
  IF t IS NULL THEN
    -- no SQL Editor não há JWT: sem isto a função apagaria e copiaria NADA,
    -- sem erro, e quem chamou acharia que funcionou
    RAISE EXCEPTION 'current_tenant_id() nulo — chame pelo app, não pelo SQL Editor.';
  END IF;

  n := copiar_versao_orcado(p_origem, p_destino, p_substituir);
  tabela := 'fat_orcado'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM versao_taxa WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO versao_taxa (tenant_id, versao_id, moeda_slot, ano, mes, taxa)
  SELECT tenant_id, p_destino, moeda_slot, ano, mes, taxa
    FROM versao_taxa WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'versao_taxa'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM premissa_dissidio WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO premissa_dissidio (tenant_id, versao_id, sindicato_id, pct)
  SELECT tenant_id, p_destino, sindicato_id, pct
    FROM premissa_dissidio WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'premissa_dissidio'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM formulario_valor WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO formulario_valor
    (tenant_id, formulario_id, linha_id, versao_id, empresa_id, filial_id, ano, mes, valor, expressao, dims)
  SELECT tenant_id, formulario_id, linha_id, p_destino, empresa_id, filial_id, ano, mes, valor, expressao, dims
    FROM formulario_valor WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'formulario_valor'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM posto_versao WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO posto_versao
    (tenant_id, versao_id, posto_id, salario_base, fte, ini_ano, ini_mes, fim_ano, fim_mes,
     reajuste_mes, reajuste_pct, reajuste_valor,
     afast_ini_ano, afast_ini_mes, afast_fim_ano, afast_fim_mes, ativo, limpos, nota)
  SELECT tenant_id, p_destino, posto_id, salario_base, fte, ini_ano, ini_mes, fim_ano, fim_mes,
         reajuste_mes, reajuste_pct, reajuste_valor,
         afast_ini_ano, afast_ini_mes, afast_fim_ano, afast_fim_mes, ativo, limpos, nota
    FROM posto_versao WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'posto_versao'; linhas := n; RETURN NEXT;
END $$;

COMMENT ON FUNCTION copiar_versao_cenario IS
  'Duplica um cenário inteiro: fat_orcado + versao_taxa + premissa_dissidio + formulario_valor + posto_versao. Devolve uma linha por tabela.';

NOTIFY pgrst, 'reload schema';
