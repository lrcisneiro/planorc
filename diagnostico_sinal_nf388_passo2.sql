-- para onde conta_linha.linha_id aponta de verdade, e quem é a amarração -1
DO $d$
DECLARE uid uuid; t uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role='admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  t := current_tenant_id();

  txt := txt || E'\n=== FK real de conta_linha.linha_id ===\n';
  FOR r IN
    SELECT confrelid::regclass::text alvo
      FROM pg_constraint
     WHERE conrelid = 'conta_linha'::regclass AND contype='f'
       AND 'linha_id' = ANY (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=conrelid AND a.attnum=ANY(conkey))
  LOOP txt := txt || '  aponta para: ' || r.alvo || E'\n'; END LOOP;

  txt := txt || E'\n=== as 3 amarracoes da conta 31041006 (por plano) ===\n';
  FOR r IN
    SELECT cl.sinal, pc.codigo plano, cc.id conta_id,
           co.codigo mcod, left(co.descricao,30) mdesc
      FROM conta_contabil cc
      JOIN conta_linha cl ON cl.conta_id = cc.id AND cl.tenant_id = t
      LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
      LEFT JOIN conta_orcamentaria co ON co.id = cl.linha_id
     WHERE cc.codigo = '31041006'
     ORDER BY cl.sinal
  LOOP
    txt := txt || format('  sinal=%-3s plano=%-10s master=%s %s', r.sinal, coalesce(r.plano,'?'),
                         coalesce(r.mcod,'(nao e conta_orcamentaria)'), coalesce(r.mdesc,'')) || E'\n';
  END LOOP;

  txt := txt || E'\n=== TODAS as amarracoes com sinal -1 no tenant ===\n';
  FOR r IN
    SELECT cc.codigo conta, left(cc.descricao,28) cdesc, pc.codigo plano,
           co.codigo mcod, left(co.descricao,26) mdesc
      FROM conta_linha cl
      JOIN conta_contabil cc ON cc.id = cl.conta_id
      LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
      LEFT JOIN conta_orcamentaria co ON co.id = cl.linha_id
     WHERE cl.tenant_id = t AND cl.sinal = -1
     ORDER BY cc.codigo
  LOOP
    txt := txt || format('  %-10s %-28s plano=%-8s -> %s %s', r.conta, r.cdesc,
                         coalesce(r.plano,'?'), coalesce(r.mcod,'?'), coalesce(r.mdesc,'')) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $d$;
