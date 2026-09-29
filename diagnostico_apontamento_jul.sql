-- ============================================================
-- A prova do modelo: apontamento de JULHO x folha de AGOSTO, em HORAS
--
-- Julho é a competência de apontamento dos PJs da folha de agosto (defasagem 1),
-- e a folha de agosto é a única no banco com a coluna `horas` preenchida. Se a
-- chave (filial do posto, matrícula, CC do projeto) estiver certa, aqui ela
-- casa; a consulta 5 repete tudo com junho, que é a defasagem errada, porque um
-- número de acerto sem o número de controle não prova nada.
--
-- Mede também três coisas que decidem o escopo da tela:
--  · CLT tem verba de hora na folha? (sem join obrigatório com posto, senão
--    CLT sem posto casado sumiria e eu concluiria a coisa errada)
--  · intercâmbio (projeto 9999999999) entra ou não na conta
--  · recurso_cod == matricula é regra ou coincidência de formato
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

  -- ── 1. O que entrou, e se a correção da resolução pegou ──
  txt := txt || E'\n=== 1. APONTAMENTOS IMPORTADOS ===\n';
  FOR r IN
    SELECT a.ano, a.mes, count(*) linhas, sum(a.horas) h,
           count(*) FILTER (WHERE a.posto_id IS NULL) sem_posto,
           sum(a.horas) FILTER (WHERE a.posto_id IS NULL) h_sem_posto,
           count(DISTINCT a.recurso_cod) FILTER (WHERE a.posto_id IS NULL) rec_sem_posto,
           count(*) FILTER (WHERE a.dims ? 'posto_ambiguo') ambiguo
      FROM fat_apontamento a WHERE a.tenant_id = t
     GROUP BY 1,2 ORDER BY 1,2
  LOOP
    txt := txt || format('  %s/%s  %5s linhas %10s h  |  sem posto: %s linhas / %s recursos / %s h  |  ambíguos: %s',
                         r.mes, r.ano, r.linhas, to_char(r.h,'FM999G990D0'),
                         r.sem_posto, r.rec_sem_posto, to_char(coalesce(r.h_sem_posto,0),'FM999G990D0'), r.ambiguo) || E'\n';
  END LOOP;

  -- ── 2. Para qual folha cada regime foi mandado ──
  txt := txt || E'\n=== 2. COMPETÊNCIA DA FOLHA CALCULADA ===\n';
  FOR r IN
    SELECT a.ano, a.mes, a.comp_folha_ano fa, a.comp_folha_mes fm,
           coalesce(p.regime,'(sem posto)') regime, count(*) linhas, sum(a.horas) h
      FROM fat_apontamento a LEFT JOIN posto p ON p.id = a.posto_id
     WHERE a.tenant_id = t GROUP BY 1,2,3,4,5 ORDER BY 1,2,5
  LOOP
    txt := txt || format('  apont %s/%s -> folha %s/%s  %-16s %5s linhas %10s h',
                         r.mes, r.ano, r.fm, r.fa, r.regime, r.linhas, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 3. Folha ago/2026, verbas de hora, por regime — sem perder quem não tem posto ──
  txt := txt || E'\n=== 3. FOLHA ago/2026 verbas 222/223 POR REGIME ===\n';
  FOR r IN
    SELECT f.verba_cod, coalesce(p.regime, '(sem posto casado)') regime,
           count(*) linhas, count(DISTINCT f.matricula) pessoas, sum(coalesce(f.horas,0)) h
      FROM fat_folha f LEFT JOIN posto p ON p.id = f.posto_id
     WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND f.verba_cod IN ('222','223')
     GROUP BY 1,2 ORDER BY 1,2
  LOOP
    txt := txt || format('  verba %-4s %-22s %4s linhas %4s pessoas %10s h',
                         r.verba_cod, r.regime, r.linhas, r.pessoas, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 4. A PROVA: PJ jul/2026 x folha ago/2026, em horas ──
  -- Lado do apontamento: horas (->222) + horas_rv (->223). Lado da folha: a
  -- quantidade das verbas 222/223. Chave: filial DO POSTO + matrícula + CC do projeto.
  txt := txt || E'\n=== 4. PROVA — PJ jul/2026 x FOLHA ago/2026 (chave filial+matricula+CC) ===\n';
  FOR r IN
    WITH ap AS (
      SELECT a.filial_id, a.matricula, a.cc_projeto_id cc_id, sum(a.horas + a.horas_rv) h
        FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
       WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 7 AND p.regime NOT LIKE '%CLT%'
       GROUP BY 1,2,3
    ), fo AS (
      SELECT f.filial_id, f.matricula, f.cc_id, sum(coalesce(f.horas,0)) h
        FROM fat_folha f
       WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND f.verba_cod IN ('222','223')
       GROUP BY 1,2,3
    )
    SELECT count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL) casam,
           count(*) FILTER (WHERE fo.h IS NULL) so_ap,
           count(*) FILTER (WHERE ap.h IS NULL) so_fo,
           count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL AND abs(ap.h - fo.h) > 0.01) divergem,
           to_char(coalesce(sum(ap.h),0),'FM999G990D0') hap,
           to_char(coalesce(sum(fo.h),0),'FM999G990D0') hfo,
           to_char(coalesce(sum(ap.h),0) - coalesce(sum(fo.h),0),'FM999G990D0') delta,
           to_char(coalesce(sum(ap.h) FILTER (WHERE fo.h IS NULL),0),'FM999G990D0') h_so_ap,
           to_char(coalesce(sum(fo.h) FILTER (WHERE ap.h IS NULL),0),'FM999G990D0') h_so_fo
      FROM ap FULL JOIN fo ON fo.filial_id = ap.filial_id AND fo.matricula = ap.matricula
                          AND fo.cc_id IS NOT DISTINCT FROM ap.cc_id
  LOOP
    txt := txt || format('  chaves: casam %s  |  só apontamento %s (%s h)  |  só folha %s (%s h)',
                         r.casam, r.so_ap, r.h_so_ap, r.so_fo, r.h_so_fo) || E'\n';
    txt := txt || format('  das que casam, horas DIFERENTES: %s', r.divergem) || E'\n';
    txt := txt || format('  total apontamento %s h  |  folha %s h  |  delta %s h', r.hap, r.hfo, r.delta) || E'\n';
  END LOOP;

  -- ── 5. CONTROLE: o mesmo teste com junho (defasagem errada para PJ) ──
  txt := txt || E'\n=== 5. CONTROLE — PJ jun/2026 x FOLHA ago/2026 (esperado casar pouco) ===\n';
  FOR r IN
    WITH ap AS (
      SELECT a.filial_id, a.matricula, a.cc_projeto_id cc_id, sum(a.horas + a.horas_rv) h
        FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
       WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 6 AND p.regime NOT LIKE '%CLT%'
       GROUP BY 1,2,3
    ), fo AS (
      SELECT f.filial_id, f.matricula, f.cc_id, sum(coalesce(f.horas,0)) h
        FROM fat_folha f
       WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND f.verba_cod IN ('222','223')
       GROUP BY 1,2,3
    )
    SELECT count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL) casam,
           count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL AND abs(ap.h - fo.h) > 0.01) divergem
      FROM ap FULL JOIN fo ON fo.filial_id = ap.filial_id AND fo.matricula = ap.matricula
                          AND fo.cc_id IS NOT DISTINCT FROM ap.cc_id
  LOOP
    txt := txt || format('  casam %s  |  destas, com horas diferentes: %s', r.casam, r.divergem) || E'\n';
  END LOOP;

  -- ── 6. O intercâmbio entra na conta? ──
  -- Projeto 9999999999. Se o delta da prova encolher ao tirá-lo, ele não vira
  -- verba de hora e a tela tem de separá-lo em vez de acusar divergência.
  txt := txt || E'\n=== 6. INTERCÂMBIO (projeto 9999999999) em jul/2026 ===\n';
  FOR r IN
    SELECT a.intercambio, count(*) linhas, count(DISTINCT a.recurso_cod) pessoas, sum(a.horas + a.horas_rv) h
      FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
     WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 7 AND p.regime NOT LIKE '%CLT%'
     GROUP BY 1 ORDER BY 1
  LOOP
    txt := txt || format('  intercambio=%s  %5s linhas  %3s pessoas  %10s h', r.intercambio, r.linhas, r.pessoas, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;
  FOR r IN
    WITH ap AS (
      SELECT a.filial_id, a.matricula, a.cc_projeto_id cc_id, sum(a.horas + a.horas_rv) h
        FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
       WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 7 AND p.regime NOT LIKE '%CLT%'
         AND NOT a.intercambio
       GROUP BY 1,2,3
    ), fo AS (
      SELECT f.filial_id, f.matricula, f.cc_id, sum(coalesce(f.horas,0)) h
        FROM fat_folha f
       WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND f.verba_cod IN ('222','223')
       GROUP BY 1,2,3
    )
    SELECT count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL) casam,
           count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL AND abs(ap.h - fo.h) > 0.01) divergem,
           to_char(coalesce(sum(ap.h),0) - coalesce(sum(fo.h),0),'FM999G990D0') delta
      FROM ap FULL JOIN fo ON fo.filial_id = ap.filial_id AND fo.matricula = ap.matricula
                          AND fo.cc_id IS NOT DISTINCT FROM ap.cc_id
  LOOP
    txt := txt || format('  SEM intercâmbio: casam %s | divergem %s | delta %s h', r.casam, r.divergem, r.delta) || E'\n';
  END LOOP;

  -- ── 7. A cara das divergências (as 12 maiores) ──
  txt := txt || E'\n=== 7. MAIORES DIVERGÊNCIAS (PJ jul x folha ago) ===\n';
  FOR r IN
    WITH ap AS (
      SELECT a.filial_id, a.matricula, a.cc_projeto_id cc_id, max(a.nome) nome, sum(a.horas + a.horas_rv) h
        FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
       WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 7 AND p.regime NOT LIKE '%CLT%'
       GROUP BY 1,2,3
    ), fo AS (
      SELECT f.filial_id, f.matricula, f.cc_id, max(f.nome) nome, sum(coalesce(f.horas,0)) h
        FROM fat_folha f
       WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND f.verba_cod IN ('222','223')
       GROUP BY 1,2,3
    )
    SELECT coalesce(ap.matricula, fo.matricula) mat,
           coalesce(ap.nome, fo.nome) nome,
           fl.codigo filial, cc.codigo cc,
           coalesce(ap.h,0) hap, coalesce(fo.h,0) hfo, coalesce(ap.h,0) - coalesce(fo.h,0) d
      FROM ap FULL JOIN fo ON fo.filial_id = ap.filial_id AND fo.matricula = ap.matricula
                          AND fo.cc_id IS NOT DISTINCT FROM ap.cc_id
      LEFT JOIN filial fl ON fl.id = coalesce(ap.filial_id, fo.filial_id)
      LEFT JOIN centro_custo cc ON cc.id = coalesce(ap.cc_id, fo.cc_id)
     WHERE abs(coalesce(ap.h,0) - coalesce(fo.h,0)) > 0.01
     ORDER BY abs(coalesce(ap.h,0) - coalesce(fo.h,0)) DESC LIMIT 12
  LOOP
    txt := txt || format('  %-8s %-26s fil %-5s cc %-6s apont %8s h  folha %8s h  delta %8s h',
                         coalesce(r.mat,'-'), coalesce(r.nome,''), coalesce(r.filial,'-'), coalesce(r.cc,'-'),
                         to_char(r.hap,'FM999G990D0'), to_char(r.hfo,'FM999G990D0'), to_char(r.d,'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 8. recurso_cod == matricula é regra ou coincidência? ──
  txt := txt || E'\n=== 8. RECURSO x MATRÍCULA nos postos que TÊM recurso ===\n';
  SELECT count(*) tot,
         count(*) FILTER (WHERE btrim(recurso_cod) = btrim(matricula)) iguais
    INTO r FROM posto WHERE tenant_id = t AND coalesce(btrim(recurso_cod),'') <> '';
  txt := txt || format('  postos com recurso: %s  |  recurso = matrícula: %s', r.tot, r.iguais) || E'\n';
  FOR r IN
    SELECT codigo, matricula, recurso_cod, nome FROM posto
     WHERE tenant_id = t AND coalesce(btrim(recurso_cod),'') <> ''
       AND btrim(recurso_cod) <> btrim(matricula) LIMIT 8
  LOOP
    txt := txt || format('    DIFERENTE: %-14s mat %-8s recurso %-10s %s', r.codigo, r.matricula, r.recurso_cod, coalesce(r.nome,'')) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $diag$;
