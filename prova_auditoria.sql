-- ============================================================
-- PROVA da auditoria — arquivo SEPARADO, e aqui o rollback é FEATURE
--
-- Este arquivo escreve: insere uma regra de acesso de teste para ver se o
-- gatilho grava. Mas como o `RAISE EXCEPTION` do fim desfaz a transação
-- inteira, **a regra de teste e os registros de auditoria somem juntos** — o
-- rollback é a limpeza.
--
-- É o inverso do que aconteceu nas migrations: lá a exceção desfez o trabalho
-- que deveria persistir; aqui ela desfaz o teste que não deveria persistir. A
-- diferença não é a exceção, é o que mais está na transação.
--
-- Rodar DEPOIS do `schema_v3_137_reaplicar.sql`.
--
-- O resultado sai como ERROR. É o resultado.
-- ============================================================
DO $prova$
DECLARE
  v_user uuid; n_antes bigint; n_depois bigint; reg record;
BEGIN
  SELECT user_id INTO v_user FROM user_tenant ORDER BY user_id LIMIT 1;
  SELECT count(*) INTO n_antes FROM auditoria;

  -- mexe de verdade numa regra, e volta ao estado anterior logo em seguida
  INSERT INTO user_acesso_regra (tenant_id, user_id, dimensao, escopo, valor_ids, negados)
  VALUES ((SELECT tenant_id FROM user_tenant WHERE user_id = v_user LIMIT 1),
          v_user, '__teste_auditoria__', 'VER', '{}'::uuid[], '{}'::uuid[]);
  DELETE FROM user_acesso_regra WHERE user_id = v_user AND dimensao = '__teste_auditoria__';

  SELECT count(*) INTO n_depois FROM auditoria;
  SELECT tabela, operacao, origem, coalesce(quem::text, '(privilegiada)') AS quem
    INTO reg FROM auditoria ORDER BY id DESC LIMIT 1;

  RAISE EXCEPTION E'=== PROVA DA AUDITORIA ===\n\nregistros antes ...... %\nregistros depois ..... %  (esperado: +2, um INSERT e um DELETE)\núltimo registro ...... % · % · origem %\nquem ................. %\n\nSe "depois" não subiu 2, o gatilho não está gravando.\nOrigem "privilegiada" aqui é o ESPERADO: este bloco roda no SQL Editor,\nonde auth.uid() é NULL — exatamente o caso que motivou o MON-01.\n\nA exceção DESFAZ tudo: a regra de teste e os 2 registros de auditoria\nsomem juntos. Aqui o rollback é a limpeza, e por isso a prova não suja nada.',
    n_antes, n_depois, reg.tabela, reg.operacao, reg.origem, reg.quem;
END $prova$;
