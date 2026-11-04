-- ============================================================
-- PROVA — o veredito não se escreve pela API (v3_174)
--
-- Personifica um `member` e tenta aprovar direto na tabela, pelos dois
-- caminhos. Antes da v3_174 as duas tentativas PASSAVAM.
--
-- ⚠ Esta prova ESCREVE, então é um `DO` só terminando em `RAISE EXCEPTION`:
-- a exceção aborta o bloco inteiro e nada do teste sobrevive — inclusive
-- quando a prova falha no meio. E a mensagem da exceção é o único canal que o
-- SQL Editor mostra com certeza (`RAISE NOTICE` ele engole).
--
-- Por isso ela SEMPRE "dá erro". Leia o prefixo: ✅ PASSOU ou ⛔ FALHOU.
-- ============================================================
DO $$
DECLARE
  v_uid uuid; v_email text; v_tenant uuid;
  v_pv uuid; v_versao uuid; v_linha uuid;
  r_aprova text := 'não testado'; r_insere text := 'não testado'; r_propoe text := 'não testado';
  falhas text := '';
BEGIN
  -- Uma cobaia member qualquer do tenant.
  SELECT ut.user_id, u.email, ut.tenant_id INTO v_uid, v_email, v_tenant
    FROM user_tenant ut JOIN auth.users u ON u.id = ut.user_id
   WHERE ut.role = 'member' LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '⛔ FALHOU — não há usuário member para personificar.';
  END IF;

  SELECT id, versao_id INTO v_pv FROM posto_versao WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_versao FROM versao_orcamento WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_linha  FROM conta_orcamentaria WHERE tenant_id = v_tenant LIMIT 1;

  -- ⚠ Sem trocar de PAPEL, o dono das tabelas ignora RLS e privilégio de
  -- coluna, e toda tentativa "passa" — a prova mediria a si mesma.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. aprovar posto direto na tabela
  IF v_pv IS NOT NULL THEN
    BEGIN
      UPDATE posto_versao SET aprovado = true WHERE id = v_pv;
      r_aprova := 'PASSOU A ESCRITA (furo aberto)';
    EXCEPTION WHEN insufficient_privilege THEN r_aprova := 'barrado (42501)';
              WHEN OTHERS THEN r_aprova := 'barrado (' || SQLSTATE || ')';
    END;
  END IF;

  -- 2. inserir veredito de orçamento direto na tabela
  IF v_versao IS NOT NULL AND v_linha IS NOT NULL THEN
    BEGIN
      INSERT INTO orcado_veredito (tenant_id, versao_id, linha_id, aprovado)
      VALUES (v_tenant, v_versao, v_linha, true);
      r_insere := 'PASSOU A ESCRITA (furo aberto)';
    EXCEPTION WHEN insufficient_privilege THEN r_insere := 'barrado (42501)';
              WHEN OTHERS THEN r_insere := 'barrado (' || SQLSTATE || ')';
    END;
  END IF;

  -- 3. a PROPOSTA tem de continuar passando — fechar demais quebra a grade,
  --    e um controle que impede o trabalho legítimo volta desligado amanhã.
  IF v_pv IS NOT NULL THEN
    BEGIN
      UPDATE posto_versao SET nota = 'prova v3_174' WHERE id = v_pv;
      r_propoe := 'passa (correto)';
    EXCEPTION WHEN OTHERS THEN r_propoe := 'BARRADO — ' || SQLSTATE || ' (quebrou a grade)';
    END;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF r_aprova LIKE 'PASSOU%' THEN falhas := falhas || ' · posto_versao.aprovado ainda é gravável'; END IF;
  IF r_insere LIKE 'PASSOU%' THEN falhas := falhas || ' · orcado_veredito ainda aceita insert'; END IF;
  IF r_propoe LIKE 'BARRADO%' THEN falhas := falhas || ' · a proposta parou de passar'; END IF;

  RAISE EXCEPTION '% — cobaia % | aprovar posto: % | inserir veredito: % | propor: %',
    CASE WHEN falhas = '' THEN '✅ PASSOU' ELSE '⛔ FALHOU' || falhas END,
    v_email, r_aprova, r_insere, r_propoe;
END $$;
