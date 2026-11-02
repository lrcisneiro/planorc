-- ============================================================
-- PROVA do salário por coluna — arquivo SEPARADO (ver prova_rls_escopo.sql)
--
-- Não escreve nada; a exceção no fim é só como o resultado aparece no editor.
-- Rodar DEPOIS de `schema_v3_142_salario_por_coluna.sql`.
--
-- Mede três coisas por pessoa, personificando:
--   postos    — quantos a view devolve (recorte de LINHA, deve bater com antes)
--   c/ valor  — em quantos o salário vem preenchido (recorte de COLUNA)
--   direto    — pedir salario_base na TABELA ainda funciona? deve ser 'negado'
--
-- O que prova o quê: se "postos" cair para zero, o WHERE da view ficou mais
-- apertado que a política e eu quebrei a tela. Se "direto" vier 'LEU',
-- o GRANT não pegou e a view é decoração — qualquer um contorna pela API.
-- ============================================================
DO $prova$
DECLARE u record; n_posto bigint; n_sal bigint; direto text; rel text := '';
BEGIN
  FOR u IN SELECT ut.user_id, ut.role, coalesce(au.email,'?') AS email
             FROM user_tenant ut LEFT JOIN auth.users au ON au.id = ut.user_id
            ORDER BY ut.role, au.email LOOP

    PERFORM set_config('request.jwt.claims',
            json_build_object('sub', u.user_id, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    EXECUTE 'SELECT count(*), count(salario_base) FROM posto_v' INTO n_posto, n_sal;

    BEGIN
      EXECUTE 'SELECT salario_base FROM posto LIMIT 1';
      direto := '⛔ LEU';
    EXCEPTION WHEN insufficient_privilege THEN direto := 'negado';
              WHEN others THEN direto := 'erro: ' || left(SQLERRM, 30);
    END;

    RESET ROLE;

    rel := rel || format(E'\n%s %s  postos=%s  c/ valor=%s  direto na tabela: %s',
      rpad(u.role, 7), rpad(u.email, 30), n_posto, n_sal, direto);
  END LOOP;

  RAISE EXCEPTION E'=== SALÁRIO POR COLUNA ===%\n\nESPERADO:\n  · "direto na tabela" = negado para TODOS, inclusive admin (lê pela view)\n  · admin e member: c/ valor = postos (veem o salário dos postos que alcançam)\n  · viewer: c/ valor = 0, mas postos > 0 se ele tem escopo — vê o posto, não o que ganha\n  · "postos" não pode cair a zero para quem via antes: seria o WHERE da view\n    mais apertado que a política, e a tela quebraria.', rel;
END $prova$;
