-- ============================================================
-- Onde vivem os dois masters da conta 31041006?
--
-- A amarração NÃO é por relatório: conta_linha.linha_id aponta para
-- `conta_orcamentaria` (o MASTER), e cada relatório tem linhas
-- (relatorio_linha.linha_orc_id) que apontam para esses masters. O mesmo master
-- pode aparecer em vários relatórios, em um só, ou em NENHUM.
--
-- Por isso "Serviços Não Recorente" pode não estar na DRE Gerencial — e se não
-- estiver em relatório algum, o -1 da Receita Recorrente SUBTRAI sem que o valor
-- reapareça em lugar nenhum: some da DRE.
--
-- No SQL Editor current_tenant_id() é NULL — daí a claim no DO e o RAISE.
-- Só leitura.
-- ============================================================
DO $d$
DECLARE uid uuid; t uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role='admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  txt := txt || E'\n=== EM QUE RELATORIOS CADA MASTER APARECE ===\n';
  FOR r IN
    SELECT co.codigo mcod, left(co.descricao,28) mdesc, cl.sinal,
           rel.nome relatorio, rl.codigo lcod, left(rl.descricao,26) ldesc, rl.natureza
      FROM conta_contabil cc
      JOIN conta_linha cl ON cl.conta_id = cc.id AND cl.tenant_id = t
      JOIN conta_orcamentaria co ON co.id = cl.linha_id
      LEFT JOIN relatorio_linha rl ON rl.linha_orc_id = co.id
      LEFT JOIN relatorio rel ON rel.id = rl.relatorio_id
     WHERE cc.codigo = '31041006'
     ORDER BY cl.sinal DESC, rel.nome NULLS LAST
  LOOP
    txt := txt || format('  master %-12s %-28s sinal=%-3s', r.mcod, r.mdesc, r.sinal) || E'\n';
    txt := txt || format('      %s', CASE WHEN r.relatorio IS NULL
             THEN '*** NAO ESTA EM NENHUM RELATORIO ***'
             ELSE format('relatorio [%s] linha %s %s (nat %s)', r.relatorio, r.lcod, r.ldesc, coalesce(r.natureza,'-')) END) || E'\n';
  END LOOP;

  -- o master de destino existe mesmo como linha em algum lugar?
  txt := txt || E'\n=== O MASTER "Servicos Nao Recorente" ===\n';
  FOR r IN
    SELECT co.codigo, co.descricao, co.natureza,
           (SELECT count(*) FROM relatorio_linha x WHERE x.linha_orc_id = co.id) n_linhas,
           (SELECT count(*) FROM conta_linha y WHERE y.linha_id = co.id AND y.tenant_id = t) n_contas
      FROM conta_orcamentaria co
     WHERE co.tenant_id = t AND co.descricao ILIKE '%ecorente%' OR co.descricao ILIKE '%Nao Recorrente%'
     ORDER BY co.codigo LIMIT 10
  LOOP
    txt := txt || format('  %-12s %-34s nat=%-8s linhas_em_relatorio=%s contas_amarradas=%s',
             r.codigo, left(r.descricao,34), coalesce(r.natureza,'-'), r.n_linhas, r.n_contas) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $d$;
