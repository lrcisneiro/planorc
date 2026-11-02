-- ============================================================
-- PROVA do escopo de versão — arquivo SEPARADO, de propósito
--
-- Por que não está dentro da migration: o SQL Editor roda o script inteiro em
-- UMA transação, e `RAISE EXCEPTION` é erro. Prova por exceção dentro da
-- migration **desfaz a migration** — foi o que aconteceu com o v3_133, o
-- v3_134 e o v3_136, que exibiram sucesso e não aplicaram nada.
--
-- Aqui a exceção é inofensiva: este arquivo **não escreve nada**, então não há
-- o que desfazer. Rodar DEPOIS do `schema_v3_137_reaplicar.sql`.
--
-- O resultado sai como ERROR. É o resultado, não uma falha — no editor, a
-- exceção é a única saída que sempre aparece, e um laço não tem "última
-- instrução" para mostrar.
-- ============================================================
DO $prova$
DECLARE u record; n_orc bigint; n_ver int; rel text := '';
BEGIN
  FOR u IN SELECT user_id, role FROM user_tenant ORDER BY role, user_id LOOP
    SELECT coalesce(array_length(valor_ids,1),0) INTO n_ver FROM user_acesso_regra
     WHERE user_id = u.user_id AND dimensao = 'versao' AND escopo = 'VER';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT count(DISTINCT versao_id) FROM fat_orcado' INTO n_orc;
    RESET ROLE;

    rel := rel || format(E'\n%s  %s  versões marcadas=%s  →  enxerga %s versão(ões) no orçado',
      rpad(u.role,7), left(u.user_id::text,8) || '…',
      CASE WHEN n_ver = 0 THEN 'todas' ELSE n_ver::text END, n_orc);
  END LOOP;
  RAISE EXCEPTION E'=== ESCOPO DE VERSÃO ===%\n\nESPERADO:\n  · admin ............... todas\n  · "marcadas=todas" .... todas (regra vazia = explícito)\n  · "marcadas=1" ........ 1\n\nSe quem marcou 1 enxerga mais de 1, o predicado de versão não pegou.', rel;
END $prova$;
