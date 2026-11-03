-- ============================================================
-- prova_escopo_pessoas.sql — rodar DEPOIS da v3_162
--
-- Verificação mede EFEITO, não intenção: `SELECT` em pg_policy confirma que a
-- política existe, não que ela filtra. Aqui se PERSONIFICA e se CONTA — sem
-- trocar de papel, o dono das tabelas ignora RLS e toda contagem volta cheia.
--
-- ⚠ ESTE SCRIPT SEMPRE TERMINA EM ERRO, e isso é o desenho. Leia a mensagem:
-- começa com ✅ PASSOU ou com ⛔ FALHOU.
--
-- Por que assim: a prova grava uma regra de teste e precisa desfazê-la, sempre,
-- inclusive quando falha no meio. Um `DO` é UM comando — a exceção aborta o
-- bloco inteiro e nada do que ele escreveu sobra. Tentei antes com
-- `BEGIN`/tabela temporária/`ROLLBACK` e o SQL Editor perdeu a temporária entre
-- os comandos ("relation _res does not exist"): ele não garante sessão única.
-- A mensagem da exceção é o único canal que o editor mostra com certeza —
-- `RAISE NOTICE` ele engole, e `SELECT` depende da temporária ter sobrevivido.
--
-- ⚠ A COBAIA PRECISA ESTAR NO ESTADO ANTIGO — sem regra PESSOAS. Quem já tem
-- começa amplo, e aí a medição "antes" já é o depois: a prova não mede nada.
-- Por isso a busca exclui quem tem PESSOAS, e o `ON CONFLICT` é só rede (o
-- abort desfaz qualquer escrita, inclusive update). Conforme as pessoas forem
-- cadastradas, a fila de cobaias encolhe; quando acabar, a prova diz isso em
-- vez de falhar por chave duplicada.
--
-- ⚠ O ESCOPO É POR DIMENSÃO. Regra PESSOAS só em `centro_custo` deixa
-- `empresa` e `filial` herdando o VER. A primeira versão afirmava que uma
-- dimensão bastava e levou 568 de 570 na cara — o sistema estava certo, a
-- asserção é que estava errada. Hoje ela mede as duas etapas e EXIGE a
-- diferença, que é o que a tela de Configurações grava (as três de uma vez).
-- ============================================================

DO $$
DECLARE
  v_user uuid; v_mail text; v_tenant uuid; v_cc uuid; v_ccnome text; d text;
  n_total int; n_antes int; n_so_cc int; n_pessoas int; n_negado int;
  n_orc_antes int; n_orc_depois int; n_folha_real int;
  rel text; falhas text := '';
BEGIN
  SELECT r.user_id, r.tenant_id INTO v_user, v_tenant
    FROM user_acesso_regra r JOIN user_tenant ut ON ut.user_id = r.user_id
   WHERE r.dimensao='centro_custo' AND r.escopo='VER'
     AND ut.role <> 'admin' AND coalesce(array_length(r.valor_ids,1),0) > 0
     AND NOT EXISTS (SELECT 1 FROM user_acesso_regra x
                      WHERE x.user_id = r.user_id AND x.escopo = 'PESSOAS')
   LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION '⛔ Sem cobaia: todo não-admin com recorte de centro de custo já tem regra '
                    'PESSOAS. Crie um usuário de teste no estado antigo para rodar esta prova.';
  END IF;
  SELECT email INTO v_mail FROM auth.users WHERE id = v_user;
  SELECT count(*) INTO n_total FROM posto;

  -- (1) como está hoje
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_antes     FROM posto_v;
  SELECT count(*) INTO n_orc_antes FROM fat_orcado;
  EXECUTE 'RESET ROLE';

  -- (2) PESSOAS só em centro_custo — empresa e filial seguem herdando o VER
  INSERT INTO user_acesso_regra (tenant_id, user_id, dimensao, valor_ids, escopo, negados)
  VALUES (v_tenant, v_user, 'centro_custo', '{}', 'PESSOAS', '{}')
  ON CONFLICT (tenant_id, user_id, dimensao, escopo)
  DO UPDATE SET valor_ids = '{}', negados = '{}';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_so_cc FROM posto_v;
  EXECUTE 'RESET ROLE';

  -- (3) as TRÊS, que é o que o interruptor de Configurações grava
  FOREACH d IN ARRAY ARRAY['empresa','filial'] LOOP
    INSERT INTO user_acesso_regra (tenant_id, user_id, dimensao, valor_ids, escopo, negados)
    VALUES (v_tenant, v_user, d, '{}', 'PESSOAS', '{}')
    ON CONFLICT (tenant_id, user_id, dimensao, escopo)
    DO UPDATE SET valor_ids = '{}', negados = '{}';
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_pessoas    FROM posto_v;
  SELECT count(*) INTO n_orc_depois FROM fat_orcado;
  EXECUTE 'RESET ROLE';

  -- (4) negar um CC tem de encolher de volta
  SELECT p.cc_id, c.codigo INTO v_cc, v_ccnome
    FROM posto p JOIN centro_custo c ON c.id = p.cc_id
   WHERE p.cc_id IS NOT NULL GROUP BY p.cc_id, c.codigo ORDER BY count(*) DESC LIMIT 1;
  UPDATE user_acesso_regra SET negados = ARRAY[v_cc]
   WHERE user_id=v_user AND dimensao='centro_custo' AND escopo='PESSOAS';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_negado FROM posto_v;
  -- (5) v3_163: folha REALIZADA tem versao_id NULO e a política a escondia de
  -- quem tem recorte de versão. Zero aqui = a tela Folha realizada volta vazia.
  SELECT count(*) INTO n_folha_real FROM fat_folha WHERE tipo = 'REALIZADO';
  EXECUTE 'RESET ROLE';

  -- asserções: junta TODAS as falhas, para não consertar uma por rodada
  IF n_antes  >= n_total   THEN falhas := falhas || format('; INCONCLUSIVO: o VER da cobaia já via tudo (%s de %s)', n_antes, n_total); END IF;
  IF n_so_cc  <= n_antes   THEN falhas := falhas || format('; PESSOAS em centro_custo não ampliou (%s→%s)', n_antes, n_so_cc); END IF;
  IF n_so_cc  >= n_total   THEN falhas := falhas || format('; PESSOAS só em centro_custo viu TUDO (%s) — empresa devia herdar o VER', n_so_cc); END IF;
  IF n_pessoas <> n_total  THEN falhas := falhas || format('; nas três dimensões devia ver %s, viu %s', n_total, n_pessoas); END IF;
  IF n_negado >= n_pessoas THEN falhas := falhas || format('; negar um CC não encolheu (%s→%s)', n_pessoas, n_negado); END IF;
  IF n_orc_depois <> n_orc_antes THEN falhas := falhas || format('; VAZOU: o orçado mudou (%s→%s)', n_orc_antes, n_orc_depois); END IF;
  IF n_folha_real = 0 THEN falhas := falhas || '; folha REALIZADA invisível (v3_163: versao_id nulo barrado pelo escopo de versão)'; END IF;

  rel := format(
    '%s cobaia %s | postos no banco %s | 1·VER de hoje %s | 2·PESSOAS só em CC %s'
    ' | 3·PESSOAS nas três %s | 4·negando o CC %s → %s | orçado %s → %s (tem de ser igual)'
    ' | 5·folha REALIZADA visível %s%s'
    '  ——  regra de teste desfeita pelo abort.',
    CASE WHEN falhas = '' THEN '✅ PASSOU —' ELSE '⛔ FALHOU —' END,
    v_mail, n_total, n_antes, n_so_cc, n_pessoas, v_ccnome, n_negado,
    n_orc_antes, n_orc_depois, n_folha_real,
    CASE WHEN falhas = '' THEN '' ELSE '  FALHAS:' || falhas END);

  RAISE EXCEPTION '%', rel;
END $$;
