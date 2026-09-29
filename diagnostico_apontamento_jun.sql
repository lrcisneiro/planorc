-- ============================================================
-- Diagnóstico — apontamento de junho/2026 recém-importado
--
-- Três avisos da tela precisam de número antes de a conciliação ser construída
-- em cima deles: 22 recursos sem posto, 6 ambíguos e 631 linhas apontadas numa
-- filial diferente da do posto. Em julho a regra do ambíguo NUNCA disparava e
-- as linhas fora da filial eram de 2 pessoas — junho é outro tamanho, e a
-- pergunta é se é o mesmo fenômeno maior ou um fenômeno diferente.
--
-- E a conferência que sustenta o modelo: junho é a competência de apontamento
-- dos CLTs da folha de AGOSTO (defasagem 2). Casa? A consulta 6 repete o mesmo
-- teste com a defasagem errada, que é o que dá sentido ao número da 5.
--
-- No SQL Editor current_tenant_id() é NULL (sem JWT), então todo filtro por
-- tenant volta vazio. Daí a claim no bloco DO e a resposta por RAISE.
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

  -- ── 1. Quem ficou sem posto, e quanto pesa ──
  txt := txt || E'\n=== 1. RECURSOS SEM POSTO (horas sem dono no cadastro) ===\n';
  FOR r IN
    SELECT recurso_cod, max(nome) nome, count(*) linhas, sum(horas) h
      FROM fat_apontamento
     WHERE tenant_id = t AND ano = 2026 AND mes = 6 AND posto_id IS NULL
     GROUP BY recurso_cod ORDER BY sum(horas) DESC
  LOOP
    txt := txt || format('  %-10s %-34s %4s linhas %10s h', r.recurso_cod, coalesce(r.nome,''), r.linhas, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;
  SELECT to_char(coalesce(sum(horas) FILTER (WHERE posto_id IS NULL),0),'FM999G990D0') sem,
         to_char(sum(horas),'FM999G990D0') tot,
         to_char(100*coalesce(sum(horas) FILTER (WHERE posto_id IS NULL),0)/nullif(sum(horas),0),'FM990D0') pct
    INTO r FROM fat_apontamento WHERE tenant_id = t AND ano = 2026 AND mes = 6;
  txt := txt || format('  TOTAL sem posto: %s h de %s h (%s%%)', r.sem, r.tot, r.pct) || E'\n';

  -- ── 2. Ambíguos: a tela escolheu o primeiro. Quanto isso decide? ──
  txt := txt || E'\n=== 2. AMBÍGUOS (mais de um posto ativo na mesma filial) ===\n';
  FOR r IN
    SELECT a.recurso_cod, max(a.nome) nome, count(*) linhas, sum(a.horas) h,
           (SELECT string_agg(p.codigo || CASE WHEN p.ativo THEN '' ELSE '(inativo)' END, ' | ' ORDER BY p.codigo)
              FROM posto p WHERE p.tenant_id = t AND btrim(p.recurso_cod) = a.recurso_cod) candidatos
      FROM fat_apontamento a
     WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 6 AND a.dims ? 'posto_ambiguo'
     GROUP BY a.recurso_cod ORDER BY sum(a.horas) DESC
  LOOP
    txt := txt || format('  %-10s %-26s %4s linhas %9s h  ->  %s', r.recurso_cod, coalesce(r.nome,''), r.linhas, to_char(r.h,'FM999G990D0'), r.candidatos) || E'\n';
  END LOOP;

  -- ── 3. Apontou fora da filial do posto: quantas PESSOAS, não linhas ──
  txt := txt || E'\n=== 3. APONTADO EM FILIAL DIFERENTE DA DO POSTO ===\n';
  FOR r IN
    SELECT a.recurso_cod, max(a.nome) nome, fp.codigo fil_posto, fa.codigo fil_apont,
           count(*) linhas, sum(a.horas) h
      FROM fat_apontamento a
      LEFT JOIN filial fp ON fp.id = a.filial_id
      LEFT JOIN filial fa ON fa.id = a.filial_apont_id
     WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 6
       AND a.filial_apont_id IS DISTINCT FROM a.filial_id
     GROUP BY a.recurso_cod, fp.codigo, fa.codigo
     ORDER BY sum(a.horas) DESC LIMIT 15
  LOOP
    txt := txt || format('  %-10s %-24s posto %-5s <- apontou %-5s %4s linhas %9s h',
                         r.recurso_cod, coalesce(r.nome,''), coalesce(r.fil_posto,'-'), coalesce(r.fil_apont,'-'),
                         r.linhas, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;
  SELECT count(DISTINCT recurso_cod) FILTER (WHERE filial_apont_id IS DISTINCT FROM filial_id) pes,
         to_char(coalesce(sum(horas) FILTER (WHERE filial_apont_id IS DISTINCT FROM filial_id),0),'FM999G990D0') h,
         to_char(sum(horas),'FM999G990D0') tot
    INTO r FROM fat_apontamento WHERE tenant_id = t AND ano = 2026 AND mes = 6;
  txt := txt || format('  %s pessoa(s), %s h de %s h', r.pes, r.h, r.tot) || E'\n';

  -- ── 4. Para onde a tela mandou cada linha (competência da folha) ──
  txt := txt || E'\n=== 4. COMPETÊNCIA DA FOLHA CALCULADA (defasagem por regime) ===\n';
  FOR r IN
    SELECT a.comp_folha_ano ano, a.comp_folha_mes mes, coalesce(p.regime,'(sem posto)') regime,
           count(*) linhas, sum(a.horas) h
      FROM fat_apontamento a LEFT JOIN posto p ON p.id = a.posto_id
     WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 6
     GROUP BY 1,2,3 ORDER BY 1,2,3
  LOOP
    txt := txt || format('  %s/%s  %-16s %5s linhas %10s h', r.mes, r.ano, r.regime, r.linhas, to_char(r.h,'FM999G990D0')) || E'\n';
  END LOOP;

  -- ── 5. A prova do modelo: CLT de junho × folha de agosto, verbas 222/223 ──
  -- Chave: (filial do posto, matrícula, CC do projeto) contra (filial, matrícula, CC).
  txt := txt || E'\n=== 5. CLT jun/2026 x FOLHA ago/2026 (verbas 222+223, em HORAS) ===\n';
  FOR r IN
    WITH ap AS (
      SELECT a.filial_id, a.matricula, a.cc_projeto_id cc_id, sum(a.horas + a.horas_rv) h
        FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
       WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 6 AND p.regime LIKE '%CLT%'
       GROUP BY 1,2,3
    ), fo AS (
      SELECT f.filial_id, f.matricula, f.cc_id, sum(coalesce(f.horas,0)) h
        FROM fat_folha f JOIN posto p ON p.id = f.posto_id
       WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 8
         AND f.verba_cod IN ('222','223') AND p.regime LIKE '%CLT%'
       GROUP BY 1,2,3
    )
    SELECT count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL) casadas,
           count(*) FILTER (WHERE fo.h IS NULL) so_ap,
           count(*) FILTER (WHERE ap.h IS NULL) so_fo,
           count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL AND abs(ap.h - fo.h) > 0.01) divergem,
           to_char(coalesce(sum(ap.h),0),'FM999G990D0') hap,
           to_char(coalesce(sum(fo.h),0),'FM999G990D0') hfo,
           to_char(coalesce(sum(ap.h),0) - coalesce(sum(fo.h),0),'FM999G990D0') delta
      FROM ap FULL JOIN fo ON fo.filial_id = ap.filial_id AND fo.matricula = ap.matricula
                          AND fo.cc_id IS NOT DISTINCT FROM ap.cc_id
  LOOP
    txt := txt || format('  casam: %s  |  só no apontamento: %s  |  só na folha: %s', r.casadas, r.so_ap, r.so_fo) || E'\n';
    txt := txt || format('  das que casam, com horas DIFERENTES: %s', r.divergem) || E'\n';
    txt := txt || format('  horas apontamento: %s h | folha (222+223): %s h | delta: %s h', r.hap, r.hfo, r.delta) || E'\n';
  END LOOP;

  -- ── 6. Controle: os mesmos CLTs contra a folha de JULHO (defasagem errada) ──
  txt := txt || E'\n=== 6. CONTROLE: mesmos CLTs x folha JUL (defasagem 1, esperado NAO casar) ===\n';
  FOR r IN
    WITH ap AS (
      SELECT a.filial_id, a.matricula, a.cc_projeto_id cc_id, sum(a.horas + a.horas_rv) h
        FROM fat_apontamento a JOIN posto p ON p.id = a.posto_id
       WHERE a.tenant_id = t AND a.ano = 2026 AND a.mes = 6 AND p.regime LIKE '%CLT%'
       GROUP BY 1,2,3
    ), fo AS (
      SELECT f.filial_id, f.matricula, f.cc_id, sum(coalesce(f.horas,0)) h
        FROM fat_folha f JOIN posto p ON p.id = f.posto_id
       WHERE f.tenant_id = t AND f.ano = 2026 AND f.mes = 7
         AND f.verba_cod IN ('222','223') AND p.regime LIKE '%CLT%'
       GROUP BY 1,2,3
    )
    SELECT count(*) FILTER (WHERE ap.h IS NOT NULL AND fo.h IS NOT NULL) casadas,
           count(*) FILTER (WHERE ap.h IS NULL) so_fo
      FROM ap FULL JOIN fo ON fo.filial_id = ap.filial_id AND fo.matricula = ap.matricula
                          AND fo.cc_id IS NOT DISTINCT FROM ap.cc_id
  LOOP
    txt := txt || format('  casam: %s  |  só na folha: %s', r.casadas, r.so_fo) || E'\n';
  END LOOP;

  -- ── 7. Contra o que dá para testar ──
  txt := txt || E'\n=== 7. FOLHAS IMPORTADAS (verbas 222/223) ===\n';
  FOR r IN
    SELECT ano, mes, count(*) linhas, sum(coalesce(horas,0)) h, count(*) FILTER (WHERE horas IS NULL) sem_h
      FROM fat_folha WHERE tenant_id = t AND verba_cod IN ('222','223')
     GROUP BY 1,2 ORDER BY 1,2
  LOOP
    txt := txt || format('  %s/%s  %4s linhas %10s h  (sem horas gravadas: %s)', r.mes, r.ano, r.linhas, to_char(r.h,'FM999G990D0'), r.sem_h) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $diag$;
