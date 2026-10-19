-- ============================================================
-- Limpar os planos do exterior com segurança
--
-- Os planos de PY e BO no Planorc foram criados exportando o plano BRASILEIRO.
-- Mas o razão local usa numeração própria (PY: 040901…; BO: 4xxxxxxxxx /
-- 5xxxxxxxxx), então nenhuma daquelas contas aparece nos lançamentos de lá —
-- são cadastro morto, e atrapalham: a mesma conta brasileira passa a existir em
-- dois planos, e a amarração de uma pode ser confundida com a da outra.
--
-- Antes de apagar é preciso saber o que está PRESO nelas. Esta consulta separa
-- o que pode sair do que tem lançamento ou amarração.
--
-- No SQL Editor current_tenant_id() é NULL — daí a claim no DO e o RAISE.
-- Só leitura: não apaga nada.
-- ============================================================
DO $d$
DECLARE uid uuid; t uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role='admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  txt := txt || E'\n=== PLANOS DO TENANT ===\n';
  FOR r IN
    SELECT pc.codigo plano, pc.nome,
           (SELECT count(*) FROM conta_contabil c WHERE c.plano_id = pc.id) n_contas,
           (SELECT string_agg(e.codigo, ',' ORDER BY e.codigo) FROM empresa e WHERE e.plano_id = pc.id AND e.tenant_id=t) empresas,
           (SELECT count(*) FROM fat_realizado f JOIN conta_contabil c2 ON c2.id=f.conta_id
             WHERE c2.plano_id = pc.id AND f.tenant_id=t) n_lanc,
           (SELECT count(*) FROM conta_linha cl JOIN conta_contabil c3 ON c3.id=cl.conta_id
             WHERE c3.plano_id = pc.id AND cl.tenant_id=t) n_amarr
      FROM plano_contas pc ORDER BY pc.codigo
  LOOP
    txt := txt || format('  %-10s %-26s %4s contas | empresas: %-28s | lancamentos: %5s | amarracoes: %4s',
             r.plano, left(coalesce(r.nome,''),26), r.n_contas, coalesce(r.empresas,'(nenhuma)'), r.n_lanc, r.n_amarr) || E'\n';
  END LOOP;

  -- o que está preso em cada plano não-brasileiro
  txt := txt || E'\n=== CONTAS COM LANCAMENTO OU AMARRACAO (nao apagar sem tratar) ===\n';
  FOR r IN
    SELECT pc.codigo plano, cc.codigo conta, left(cc.descricao,26) d,
           (SELECT count(*) FROM fat_realizado f WHERE f.conta_id = cc.id AND f.tenant_id=t) n_lanc,
           (SELECT count(*) FROM conta_linha cl WHERE cl.conta_id = cc.id AND cl.tenant_id=t) n_am
      FROM conta_contabil cc JOIN plano_contas pc ON pc.id = cc.plano_id
     WHERE pc.codigo <> 'BRTOP'
       AND ( (SELECT count(*) FROM fat_realizado f WHERE f.conta_id=cc.id AND f.tenant_id=t) > 0
          OR (SELECT count(*) FROM conta_linha cl WHERE cl.conta_id=cc.id AND cl.tenant_id=t) > 0 )
     ORDER BY pc.codigo, cc.codigo LIMIT 40
  LOOP
    txt := txt || format('  %-8s %-12s %-26s lancamentos=%-5s amarracoes=%s',
             r.plano, r.conta, r.d, r.n_lanc, r.n_am) || E'\n';
  END LOOP;
  IF txt NOT LIKE '%lancamentos=%' THEN
    txt := txt || E'  nenhuma — os planos do exterior estao LIMPOS, da para trocar as contas sem risco\n';
  END IF;

  RAISE EXCEPTION '%', txt;
END $d$;
