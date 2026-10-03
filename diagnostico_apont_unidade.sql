-- ============================================================
-- Troca de recursos entre unidades — qual o tamanho?
--
-- A conciliação deriva a empresa do DESTINO da filial do POSTO, igual à da
-- origem. Com isso o item contábil sai idêntico nos dois lados do ajuste e a
-- troca entre unidades fica invisível. A unidade do destino deveria vir da
-- filial do APONTAMENTO (`filial_apont_id`) — a filial do projeto —, que a tela
-- hoje nem lê.
--
-- Antes de mudar o grão do quadro CLT, estas consultas dizem se o fenômeno é
-- grande o bastante para justificar, e de que tipo ele é:
--   · mesma empresa gerencial, filial diferente  → item contábil NÃO mudaria
--   · empresa gerencial diferente                → item contábil MUDA, e é o
--     caso que hoje passa batido
--
-- No SQL Editor current_tenant_id() é NULL — daí a claim no DO e o RAISE.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE
  uid uuid; t uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo'; END IF;

  -- ── 1. O quadro geral, por regime ──
  txt := txt || E'\n=== 1. APONTAMENTO: FILIAL DO PROJETO x FILIAL DO POSTO ===\n';
  FOR r IN
    SELECT coalesce(p.regime, '(sem posto)') regime,
           count(*) linhas,
           count(*) FILTER (WHERE a.filial_apont_id IS DISTINCT FROM a.filial_id) outra_filial,
           count(*) FILTER (WHERE fa.empresa_id IS DISTINCT FROM fp.empresa_id) outra_empresa,
           sum(a.horas) h,
           sum(a.horas) FILTER (WHERE fa.empresa_id IS DISTINCT FROM fp.empresa_id) h_outra_emp
      FROM fat_apontamento a
      LEFT JOIN posto p  ON p.id  = a.posto_id
      LEFT JOIN filial fa ON fa.id = a.filial_apont_id
      LEFT JOIN filial fp ON fp.id = a.filial_id
     WHERE a.tenant_id = t
     GROUP BY 1 ORDER BY 1
  LOOP
    txt := txt || format('  %-16s %5s linhas | outra filial: %4s | OUTRA EMPRESA: %4s | %9s h (%s h em outra empresa)',
                         r.regime, r.linhas, r.outra_filial, r.outra_empresa,
                         to_char(r.h,'FM999G990D0'), to_char(coalesce(r.h_outra_emp,0),'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 2. Só o CLT, que é quem gera o AJTCC ──
  -- O par (empresa do posto -> empresa do projeto) é exatamente o par de itens
  -- contábeis que o lançamento precisaria ter.
  txt := txt || E'\n=== 2. CLT — PARES DE EMPRESA (posto -> projeto) ===\n';
  FOR r IN
    SELECT ep.codigo emp_posto, ep.item_contabil item_posto,
           ea.codigo emp_proj,  ea.item_contabil item_proj,
           count(DISTINCT a.posto_id) pessoas, count(*) linhas, sum(a.horas) h
      FROM fat_apontamento a
      JOIN posto p   ON p.id  = a.posto_id AND p.regime LIKE '%CLT%'
      LEFT JOIN filial fa ON fa.id = a.filial_apont_id
      LEFT JOIN filial fp ON fp.id = a.filial_id
      LEFT JOIN empresa ea ON ea.id = fa.empresa_id
      LEFT JOIN empresa ep ON ep.id = fp.empresa_id
     WHERE a.tenant_id = t
     GROUP BY 1,2,3,4 ORDER BY sum(a.horas) DESC
  LOOP
    txt := txt || format('  %-4s (item %-3s) -> %-4s (item %-3s) %4s pessoas %5s linhas %9s h%s',
                         coalesce(r.emp_posto,'-'), coalesce(r.item_posto,'?'),
                         coalesce(r.emp_proj,'-'),  coalesce(r.item_proj,'?'),
                         r.pessoas, r.linhas, to_char(r.h,'FM999G990D0'),
                         CASE WHEN r.emp_posto IS DISTINCT FROM r.emp_proj THEN '  <== TROCA DE UNIDADE' ELSE '' END) || E'\n';
  END LOOP;

  -- ── 3. O mesmo para o PJ, para saber se a mudança afeta o outro quadro ──
  txt := txt || E'\n=== 3. PJ — quanto cruza unidade (não muda a conferência de horas, só o destino) ===\n';
  FOR r IN
    SELECT count(*) linhas, sum(a.horas) h,
           count(*) FILTER (WHERE fa.empresa_id IS DISTINCT FROM fp.empresa_id) cruza,
           sum(a.horas) FILTER (WHERE fa.empresa_id IS DISTINCT FROM fp.empresa_id) h_cruza
      FROM fat_apontamento a
      JOIN posto p ON p.id = a.posto_id AND p.regime NOT LIKE '%CLT%'
      LEFT JOIN filial fa ON fa.id = a.filial_apont_id
      LEFT JOIN filial fp ON fp.id = a.filial_id
     WHERE a.tenant_id = t
  LOOP
    txt := txt || format('  %s linhas / %s h  |  cruzam unidade: %s linhas / %s h',
                         r.linhas, to_char(r.h,'FM999G990D0'), r.cruza, to_char(coalesce(r.h_cruza,0),'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 4. O mesmo CC aparece em unidades diferentes? ──
  -- Se sim, o destino do ajuste NÃO pode ser identificado só pelo CC: duas
  -- linhas com o mesmo CC podem pertencer a unidades distintas, e o grão do
  -- quadro CLT precisa carregar a filial do projeto junto.
  txt := txt || E'\n=== 4. CCs DE PROJETO QUE APARECEM EM MAIS DE UMA UNIDADE ===\n';
  FOR r IN
    SELECT cc.codigo, count(DISTINCT fa.empresa_id) n_emp,
           string_agg(DISTINCT e.codigo, ', ' ORDER BY e.codigo) emps, sum(a.horas) h
      FROM fat_apontamento a
      JOIN centro_custo cc ON cc.id = a.cc_projeto_id
      LEFT JOIN filial fa ON fa.id = a.filial_apont_id
      LEFT JOIN empresa e ON e.id = fa.empresa_id
     WHERE a.tenant_id = t
     GROUP BY cc.codigo HAVING count(DISTINCT fa.empresa_id) > 1
     ORDER BY sum(a.horas) DESC LIMIT 15
  LOOP
    txt := txt || format('  CC %-8s em %s unidades (%s) %9s h', r.codigo, r.n_emp, r.emps, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 5. Conferência de que filial_apont_id foi mesmo gravada ──
  txt := txt || E'\n=== 5. SANIDADE — filial_apont_id preenchida? ===\n';
  SELECT count(*) tot, count(*) FILTER (WHERE filial_apont_id IS NULL) nulos,
         count(DISTINCT filial_apont_id) distintas
    INTO r FROM fat_apontamento WHERE tenant_id = t;
  txt := txt || format('  %s linhas | sem filial de apontamento: %s | filiais distintas: %s',
                       r.tot, r.nulos, r.distintas) || E'\n';

  RAISE EXCEPTION '%', txt;
END $diag$;
