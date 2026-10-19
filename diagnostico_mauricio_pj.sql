-- ============================================================
-- Mauricio "sem nota" — a NF existe; falta o de-para
--
-- JÁ VERIFICADO no arquivo do ERP (não refazer):
--   · a NF ESTÁ no razão BRASILEIRO, conta 41021002, histórico
--     "INC NF NOVA COOPERATIVA-MAURICIO FERNAND";
--   · o histórico é truncado em 40 caracteres, então o nome chega CORTADO
--     ("MAURICIO FERNAND", sem o "O");
--   · set/2026 no arquivo tem 3.631,83 de NF (item PY) + 3.779,76 de AJTCC.
--     Os 18.050,17 que aparecem no ERP NÃO estão no arquivo extraído em 08/10 —
--     ou são posteriores à extração, ou estão em outra competência.
--
-- A conciliação de terceiros casa a nota à pessoa por
-- <FORNECEDOR>-<PARTICIPANTE> (planorc_pj_frag) + o de-para posto_fornecedor.
-- Na tela a coluna FORNECEDOR dele está VAZIA, o que aponta de-para ausente.
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

  -- 1. o que a função extrai do histórico real
  txt := txt || E'\n=== 1. O QUE planorc_pj_frag() EXTRAI ===\n';
  FOR r IN SELECT planorc_pj_frag('INC NF NOVA COOPERATIVA-MAURICIO FERNAND') f
  LOOP txt := txt || format('  fornecedor/participante = %s', r.f) || E'\n'; END LOOP;

  -- 2. existe de-para para ele?
  txt := txt || E'\n=== 2. posto_fornecedor DO MAURICIO ===\n';
  FOR r IN
    SELECT p.codigo posto, p.matricula, left(p.nome,30) nome,
           pf.fornecedor, pf.participante, pf.ativo
      FROM posto p
      LEFT JOIN posto_fornecedor pf ON pf.posto_id = p.id AND pf.tenant_id = t
     WHERE p.tenant_id = t AND p.nome ILIKE '%MAURICIO%FERNAND%'
  LOOP
    txt := txt || format('  posto %-14s mat %-8s %-30s', r.posto, r.matricula, r.nome) || E'\n';
    txt := txt || format('      fornecedor=%s | participante=%s | ativo=%s',
             coalesce(r.fornecedor,'*** SEM DE-PARA ***'), coalesce(r.participante,'-'),
             coalesce(r.ativo::text,'-')) || E'\n';
  END LOOP;

  -- 3. quem mais tem o fornecedor NOVA COOPERATIVA (p/ ver o padrão que funciona)
  txt := txt || E'\n=== 3. OUTROS COM FORNECEDOR "NOVA COOPERATIVA" ===\n';
  FOR r IN
    SELECT pf.fornecedor, pf.participante, left(p.nome,30) nome, p.matricula
      FROM posto_fornecedor pf JOIN posto p ON p.id = pf.posto_id
     WHERE pf.tenant_id = t AND pf.fornecedor ILIKE '%COOPERATIVA%'
     ORDER BY pf.participante LIMIT 15
  LOOP
    txt := txt || format('  %-24s | part=%-24s | %s (%s)', r.fornecedor, r.participante, r.nome, r.matricula) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $d$;
