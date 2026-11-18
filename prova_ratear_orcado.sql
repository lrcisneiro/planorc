-- ============================================================
-- PROVA — `ratear_orcado` (v3_195)
--
-- ⚠ É um `DO` SÓ, terminando em RAISE, como manda a convenção: um DO é UM
-- comando, então a exceção aborta o bloco inteiro e **tudo o que foi escrito
-- some** — inclusive se a prova falhar no meio. E a mensagem da exceção é o
-- único canal que o SQL Editor mostra com certeza.
-- Por isso esta prova SEMPRE "dá erro": leia se começa com ✅ ou ⛔.
--
-- ⚠ Escreve em **ano 2099**, que não existe no orçamento de ninguém. Mesmo
-- rolando tudo para trás, trabalhar sobre o ano real seria apostar que o
-- rollback funciona — e é justamente o que se está testando.
--
-- ⚠⚠ PRECISA FINGIR UM USUÁRIO. `current_tenant_id()` lê `auth.uid()`, que sai
-- de `request.jwt.claims` — e no SQL Editor esse claim NÃO EXISTE, então a
-- função devolve NULO e a RPC recusa a chamada logo na primeira linha. A
-- primeira versão desta prova morreu assim. `set_config(..., true)` resolve o
-- tenant e é local à transação.
--
-- ⚠⚠ E `EXCEPTION WHEN others` FAZ TESTE PASSAR PELO MOTIVO ERRADO. Na versão
-- que morreu, o teste da invariante "passou": ele capturou o erro de tenant
-- nulo e concluiu que a recusa funcionava. Por isso cada recusa aqui confere a
-- MENSAGEM — "levantou alguma coisa" não é a asserção que interessa.
--
-- Roda como DONO (sem RLS), então prova a MECÂNICA: totais, merge, exclusão da
-- origem e as recusas. O recorte por escopo é do RLS e tem prova própria
-- (`prova_rls_escopo.sql`).
-- ============================================================

DO $$
DECLARE
  t       uuid := (SELECT id FROM tenant ORDER BY criado_em LIMIT 1);
  v_ver   uuid;
  v_lin   uuid;
  e1 uuid; e2 uuid; cc1 uuid; cc2 uuid;
  r       jsonb;
  falhas  text[] := '{}';
  n       int;
  soma    numeric;
  recusou boolean := false;
  msg     text;
  v_uid   uuid;
BEGIN
  SELECT user_id INTO v_uid FROM user_tenant WHERE role='admin' LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION '⛔ FALHOU: nenhum usuário admin para personificar.'; END IF;
  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION '⛔ FALHOU: current_tenant_id() segue nulo depois de personificar.';
  END IF;

  SELECT id INTO v_ver FROM versao_orcamento WHERE tenant_id=t AND bloqueada IS NOT TRUE ORDER BY codigo LIMIT 1;
  SELECT id INTO v_lin FROM conta_orcamentaria WHERE tenant_id=t ORDER BY codigo LIMIT 1;
  SELECT id INTO e1 FROM empresa WHERE tenant_id=t ORDER BY codigo LIMIT 1;
  SELECT id INTO e2 FROM empresa WHERE tenant_id=t AND id<>e1 ORDER BY codigo LIMIT 1;
  SELECT id INTO cc1 FROM centro_custo WHERE tenant_id=t ORDER BY codigo LIMIT 1;
  SELECT id INTO cc2 FROM centro_custo WHERE tenant_id=t AND id<>cc1 ORDER BY codigo LIMIT 1;

  -- origem: 3 meses de 100,00 (despesa, negativa como o banco guarda)
  INSERT INTO fat_orcado (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, valor, origem, dims)
  SELECT t, v_ver, v_lin, e1, NULL, cc1, 2099, m, -100.00, 'MANUAL', '{}'::jsonb
    FROM generate_series(1,3) m;

  -- um destino JÁ COM valor, para provar que soma em vez de substituir
  INSERT INTO fat_orcado (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, valor, origem, dims)
  VALUES (t, v_ver, v_lin, e2, NULL, cc2, 2099, 1, -7.00, 'MANUAL', '{}'::jsonb);

  -- ── 1 · recusa quando o total não fecha ──
  BEGIN
    PERFORM ratear_orcado(v_ver, 2099, v_lin, e1, NULL, cc1,
      jsonb_build_array(jsonb_build_object('e', e2, 'f', NULL, 'c', cc2,
        'm', jsonb_build_object('1', -50.0))));     -- só 50 de 300
  EXCEPTION WHEN others THEN recusou := true; msg := SQLERRM;
  END;
  IF NOT recusou THEN falhas := falhas || 'aceitou rateio que NÃO FECHA (origem 300, destinos 50)';
  ELSIF msg NOT LIKE '%não fecha%' THEN
    falhas := falhas || format('recusou o rateio que não fecha, mas por OUTRO motivo: "%s"', msg);
  END IF;

  -- ── 2 · rateio válido: 1/3 e 2/3 em dois destinos ──
  SELECT ratear_orcado(v_ver, 2099, v_lin, e1, NULL, cc1, jsonb_build_array(
      jsonb_build_object('e', e2, 'f', NULL, 'c', cc2, 'm',
        jsonb_build_object('1', -33.33, '2', -33.33, '3', -33.34)),
      jsonb_build_object('e', e1, 'f', NULL, 'c', cc2, 'm',
        jsonb_build_object('1', -66.67, '2', -66.67, '3', -66.66))
  )) INTO r;

  -- a origem sumiu?
  SELECT count(*) INTO n FROM fat_orcado
   WHERE tenant_id=t AND versao_id=v_ver AND ano=2099 AND linha_id=v_lin
     AND empresa_id=e1 AND cc_id=cc1;
  IF n <> 0 THEN falhas := falhas || format('origem não foi apagada: %s célula(s)', n); END IF;

  -- o total da LINHA se preserva? 300 da origem + 7 que já estavam = 307
  SELECT round(sum(valor),2) INTO soma FROM fat_orcado
   WHERE tenant_id=t AND versao_id=v_ver AND ano=2099 AND linha_id=v_lin;
  IF soma <> -307.00 THEN falhas := falhas || format('total virou %s, esperado -307.00', soma); END IF;

  -- o destino que já tinha valor SOMOU (−7 + −33,33 = −40,33)?
  SELECT round(valor,2) INTO soma FROM fat_orcado
   WHERE tenant_id=t AND versao_id=v_ver AND ano=2099 AND linha_id=v_lin
     AND empresa_id=e2 AND cc_id=cc2 AND mes=1;
  IF soma <> -40.33 THEN falhas := falhas || format('destino existente virou %s, esperado -40.33 (somar, não substituir)', soma); END IF;

  -- o relatório bate com o que foi feito?
  IF (r->>'apagadas')::int <> 3 THEN falhas := falhas || format('relatou %s apagadas, esperado 3', r->>'apagadas'); END IF;
  IF (r->>'atualizadas')::int <> 1 THEN falhas := falhas || format('relatou %s atualizadas, esperado 1', r->>'atualizadas'); END IF;
  IF (r->>'inseridas')::int <> 5 THEN falhas := falhas || format('relatou %s inseridas, esperado 5', r->>'inseridas'); END IF;

  -- ── 3 · recusa origem com valor GERADO ──
  INSERT INTO fat_orcado (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes, valor, origem, dims)
  VALUES (t, v_ver, v_lin, e1, NULL, cc1, 2099, 6, -10.00, 'POSTO', '{"posto":"X"}'::jsonb);
  recusou := false;
  BEGIN
    PERFORM ratear_orcado(v_ver, 2099, v_lin, e1, NULL, cc1,
      jsonb_build_array(jsonb_build_object('e', e2, 'f', NULL, 'c', cc2,
        'm', jsonb_build_object('6', -10.0))));
  EXCEPTION WHEN others THEN recusou := true; msg := SQLERRM;
  END;
  IF NOT recusou THEN falhas := falhas || 'aceitou ratear origem com célula de POSTO';
  ELSIF msg NOT LIKE '%posto ou formul%' THEN
    falhas := falhas || format('recusou a origem gerada, mas por OUTRO motivo: "%s"', msg);
  END IF;

  IF array_length(falhas,1) IS NULL THEN
    RAISE EXCEPTION '✅ PASSOU — total preservado, origem apagada, destino existente somado, invariante e origem gerada recusadas. (rollback: nada ficou no banco)';
  ELSE
    RAISE EXCEPTION '⛔ FALHOU: %', array_to_string(falhas, '  |  ');
  END IF;
END $$;
