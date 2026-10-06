-- ============================================================
-- Correção de dado — matrícula de posto sem o zero à esquerda
--
-- O export do cadastro (`Funcionarios.csv`) perde o zero à esquerda quando a
-- matrícula vira número no ETL: medido em out/2026, 1 de 560 veio com 5 dígitos
-- (`90041` em vez de `090041`). A folha sempre normaliza com zfill(6), então a
-- mesma pessoa ficava com duas matrículas e o realizado dela não casava com o
-- posto — aparecia todo mês como "posto não existe" na importação da folha.
--
-- O conversor passou a aplicar zfill(6). Este script arruma o que JÁ está no
-- banco: sem ele, o próximo import criaria um posto NOVO com o código correto e
-- deixaria o antigo órfão, levando junto orçado, rateio e verbas dele.
--
-- RENOMEIA, não recria. Idempotente: rodar de novo não faz nada.
-- ============================================================
DO $fix$
DECLARE
  uid uuid; t uuid; r record; n int := 0; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  FOR r IN
    SELECT p.id, p.codigo, p.matricula, p.nome,
           lpad(btrim(p.matricula), 6, '0') AS mat_nova,
           split_part(p.codigo, '-', 1) || '-' || lpad(btrim(p.matricula), 6, '0') AS cod_novo
      FROM posto p
     WHERE p.tenant_id = t
       AND btrim(coalesce(p.matricula, '')) ~ '^[0-9]+$'
       AND length(btrim(p.matricula)) < 6
  LOOP
    -- se o código correto já existir, há DOIS postos para a mesma pessoa e
    -- renomear daria conflito de unique: melhor parar e mostrar do que fundir
    -- orçado de dois registros por conta própria
    IF EXISTS (SELECT 1 FROM posto x WHERE x.tenant_id = t AND x.codigo = r.cod_novo AND x.id <> r.id) THEN
      txt := txt || format('  CONFLITO: %s e %s coexistem — resolva à mão (%s)', r.codigo, r.cod_novo, coalesce(r.nome,'')) || E'\n';
      CONTINUE;
    END IF;

    UPDATE posto SET codigo = r.cod_novo, matricula = r.mat_nova WHERE id = r.id;
    n := n + 1;
    txt := txt || format('  %s -> %s  (%s)', r.codigo, r.cod_novo, coalesce(r.nome,'')) || E'\n';
  END LOOP;

  IF n = 0 AND txt = '' THEN
    txt := '  nada a corrigir — todas as matrículas já têm 6 dígitos';
  END IF;

  RAISE EXCEPTION E'\nPOSTOS RENOMEADOS: %\n%', n, txt;
END $fix$;
