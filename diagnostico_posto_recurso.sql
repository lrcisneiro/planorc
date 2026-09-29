-- ============================================================
-- Fase 1 do apontamento — o recurso chegou ao posto?
--
-- Esperado (medido no CSV antes de importar):
--    315 postos com recurso_cod, de 558 linhas do cadastro
--    os postos manuais (matrícula 8xxxxx, confidenciais) PRESERVADOS
--
-- A última consulta é a que importa: quantos recursos do extrato de julho
-- encontram posto. Esperado 160 de 172 — os 12 que faltam são apontamentos de
-- empresas terceiras, que não são colaboradores e não passam pela folha.
--
-- Responde com ERROR — ver diagnostico_terceiro_desconto.sql para o porquê.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; tot int; com int; manuais int; dup int;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE coalesce(btrim(recurso_cod), '') <> ''),
         count(*) FILTER (WHERE btrim(coalesce(matricula, '')) LIKE '8%')
    INTO tot, com, manuais
    FROM posto WHERE tenant_id = current_tenant_id();

  -- recurso duplicado é problema: duas pessoas apontando com o mesmo código
  -- fariam o apontamento casar com a errada, em silêncio
  SELECT count(*) INTO dup FROM (
    SELECT recurso_cod FROM posto
     WHERE tenant_id = current_tenant_id() AND coalesce(btrim(recurso_cod), '') <> ''
     GROUP BY recurso_cod HAVING count(*) > 1
  ) t;

  RAISE EXCEPTION 'POSTOS — total % · com recurso % (esp. 315) · matrícula 8xxxxx preservados: % · recursos DUPLICADOS: %',
    tot, com, manuais, dup;
END
$diag$;
