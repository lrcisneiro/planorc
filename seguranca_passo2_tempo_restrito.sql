-- ============================================================
-- PASSO 2 — Tempo do razão com usuário RESTRITO
--
-- "Rápido no admin" não prova nada aqui, e o motivo é estrutural: para o admin
-- `escopo_cc()` devolve NULL e a condição CURTO-CIRCUITA no `IS NULL`, sem
-- comparar array nenhum. Para o restrito, cada leitura faz
-- `cc_id = ANY(array de ~100 uuids)` sobre 1,07 milhão de linhas. São planos
-- diferentes — medir um não mede o outro.
--
-- Este bloco roda a MESMA consulta pesada para cada usuário e mede o tempo.
-- Usa `clock_timestamp()` (relógio de parede), não `now()`, que é congelado na
-- transação e mediria zero.
--
-- Resultado sai por exceção, como os outros: o editor só mostra a última
-- instrução e um laço não tem última. **É o resultado, não um erro.**
--
-- Só leitura.
-- ============================================================
DO $t$
DECLARE
  u      record;
  t0     timestamptz;
  ms     numeric;
  n      bigint;
  rel    text := '';
BEGIN
  FOR u IN SELECT user_id, role FROM user_tenant ORDER BY role, user_id LOOP
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    t0 := clock_timestamp();
    EXECUTE 'SELECT count(*) FROM fat_realizado WHERE ano = 2026' INTO n;
    ms := extract(epoch from (clock_timestamp() - t0)) * 1000;

    RESET ROLE;

    rel := rel || format(E'\n%s  %s  →  %s linha(s) em %s ms%s',
      rpad(u.role, 7), left(u.user_id::text, 8) || '…',
      to_char(n, 'FM999G999'), to_char(ms, 'FM999G990D0'),
      CASE WHEN ms > 3000 THEN '   ⚠ LENTO' ELSE '' END);
  END LOOP;

  RAISE EXCEPTION E'=== TEMPO DO RAZÃO 2026, POR USUÁRIO ===%\n\nCOMO LER:\n  · o admin curto-circuita no IS NULL — é o piso, não a referência.\n  · o que importa é o RESTRITO: se ficar na mesma ordem de grandeza, a policy\n    não custou nada. Se passar de alguns segundos, falta índice com cc_id.\n  · a contagem menor no restrito confirma que o recorte está valendo.', rel;
END $t$;
