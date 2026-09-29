-- ============================================================
-- Quem tem verba de hora na folha? E o recurso é a matrícula?
--
-- Três perguntas que decidem o escopo da conciliação Apontamento × Folha:
--
-- 1. A consulta 5 do diagnóstico de junho deu ZERO para CLT contra a folha de
--    agosto. Mas ela junta fat_folha com posto, e CLT sem posto casado sumiria
--    sem aviso. Aqui o regime é contado SEM join obrigatório, para separar
--    "não existe CLT com verba de hora" de "existe e eu perdi no join".
--
-- 2. Os recursos 001324 e 001788 têm cara de matrícula nossa e não acharam
--    posto. Se recurso_cod == matricula for a regra geral, dá para resolver por
--    matrícula quando o cadastro está sem o recurso — mas só se for regra, não
--    coincidência de formato. A consulta 3 mede.
--
-- 3. Que competências de folha existem, e quais têm horas gravadas (a coluna
--    veio na migration 110; o que foi importado antes está com horas NULL e não
--    concilia).
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

  -- ── 1. Folha ago/2026, verbas de hora, por regime — SEM perder quem não tem posto ──
  txt := txt || E'\n=== 1. FOLHA ago/2026 verbas 222/223 POR REGIME (posto nulo incluído) ===\n';
  FOR r IN
    SELECT f.verba_cod, coalesce(p.regime, '(sem posto casado)') regime,
           count(*) linhas, count(DISTINCT f.matricula) pessoas,
           sum(coalesce(f.horas,0)) h, sum(f.valor) v
      FROM fat_folha f LEFT JOIN posto p ON p.id = f.posto_id
     WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND f.verba_cod IN ('222','223')
     GROUP BY 1,2 ORDER BY 1,2
  LOOP
    txt := txt || format('  verba %-4s %-22s %4s linhas %4s pessoas %10s h  R$ %12s',
                         r.verba_cod, r.regime, r.linhas, r.pessoas,
                         to_char(r.h,'FM999G990D0'), to_char(r.v,'FM999G999G990D00')) || E'\n';
  END LOOP;

  -- ── 2. E os CLTs de agosto, recebem o quê? (as 8 maiores verbas) ──
  -- Se CLT não tem verba de hora, a pergunta seguinte é por onde o custo dele
  -- chega ao CC do projeto — ou se simplesmente não chega.
  txt := txt || E'\n=== 2. FOLHA ago/2026 — TOP VERBAS dos CLTs ===\n';
  FOR r IN
    SELECT f.verba_cod, max(f.verba_desc) desc_, count(*) linhas,
           sum(coalesce(f.horas,0)) h, sum(f.valor) v
      FROM fat_folha f JOIN posto p ON p.id = f.posto_id
     WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8 AND p.regime LIKE '%CLT%'
     GROUP BY 1 ORDER BY sum(abs(f.valor)) DESC LIMIT 8
  LOOP
    txt := txt || format('  %-5s %-30s %4s linhas %9s h  R$ %12s',
                         r.verba_cod, coalesce(r.desc_,''), r.linhas,
                         to_char(r.h,'FM999G990D0'), to_char(r.v,'FM999G999G990D00')) || E'\n';
  END LOOP;

  -- ── 3. recurso_cod == matricula é regra ou coincidência? ──
  txt := txt || E'\n=== 3. RECURSO x MATRÍCULA nos postos que TÊM recurso ===\n';
  SELECT count(*) tot,
         count(*) FILTER (WHERE btrim(recurso_cod) = btrim(matricula)) iguais,
         count(*) FILTER (WHERE btrim(recurso_cod) <> btrim(matricula)) difs
    INTO r FROM posto
   WHERE tenant_id = t AND coalesce(btrim(recurso_cod),'') <> '';
  txt := txt || format('  postos com recurso: %s  |  recurso = matrícula: %s  |  diferentes: %s',
                       r.tot, r.iguais, r.difs) || E'\n';
  txt := txt || '  exemplos de DIFERENTES (se a regra não for geral, não dá para resolver por matrícula):' || E'\n';
  FOR r IN
    SELECT codigo, matricula, recurso_cod, nome
      FROM posto WHERE tenant_id = t AND coalesce(btrim(recurso_cod),'') <> ''
       AND btrim(recurso_cod) <> btrim(matricula) LIMIT 10
  LOOP
    txt := txt || format('    %-14s mat %-8s recurso %-10s %s', r.codigo, r.matricula, r.recurso_cod, coalesce(r.nome,'')) || E'\n';
  END LOOP;

  -- ── 4. Os dois casos concretos: existe posto com essa matrícula? ──
  txt := txt || E'\n=== 4. OS RECURSOS 001324 / 001788 / 001527 NO CADASTRO ===\n';
  FOR r IN
    SELECT p.codigo, p.matricula, coalesce(p.recurso_cod,'(vazio)') recurso, p.ativo, p.regime, p.nome
      FROM posto p WHERE p.tenant_id = t
       AND btrim(p.matricula) IN ('001324','001788','001527','001785','001599')
     ORDER BY p.matricula, p.codigo
  LOOP
    txt := txt || format('    %-14s mat %-8s recurso %-10s ativo=%s %-14s %s',
                         r.codigo, r.matricula, r.recurso, r.ativo, coalesce(r.regime,''), coalesce(r.nome,'')) || E'\n';
  END LOOP;

  -- ── 5. Que folhas existem, e quais servem para conciliar ──
  txt := txt || E'\n=== 5. COMPETÊNCIAS DE FOLHA IMPORTADAS (todas as verbas) ===\n';
  FOR r IN
    SELECT ano, mes, count(*) linhas, count(DISTINCT matricula) pessoas,
           count(*) FILTER (WHERE verba_cod IN ('222','223')) v222,
           count(*) FILTER (WHERE verba_cod IN ('222','223') AND horas IS NULL) v222_sem_h
      FROM fat_folha WHERE tenant_id = t GROUP BY 1,2 ORDER BY 1,2
  LOOP
    txt := txt || format('  %s/%s  %6s linhas  %4s pessoas  |  222/223: %s (sem horas: %s)',
                         r.mes, r.ano, r.linhas, r.pessoas, r.v222, r.v222_sem_h) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $diag$;
