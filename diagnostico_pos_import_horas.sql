-- ============================================================
-- Conferência pós-import — as horas chegaram e os fantasmas sumiram
--
-- Duas coisas mudaram desde a importação anterior: a conta_cred das linhas
-- redirecionadas voltou a ser a conta que o ERP creditou (o que restaura a
-- exclusão de contrapartida da conciliação), e a folha passou a trazer a
-- QUANTIDADE (horas).
--
-- Esperado, medido direto no prgper02 de ago/2026:
--    verba 222  17.731,1 h      verba 223  531,1 h
--    conta_cred 41013001 em 22 linhas, 41041008 em 3, 41041005 em 2
--
-- Responde com ERROR — ver diagnostico_terceiro_desconto.sql para o porquê.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; h222 numeric; h223 numeric; nulas int; c1 int; c2 int; c3 int;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  SELECT coalesce(sum(horas) FILTER (WHERE btrim(verba_cod) = '222'), 0),
         coalesce(sum(horas) FILTER (WHERE btrim(verba_cod) = '223'), 0),
         count(*) FILTER (WHERE horas IS NULL)
    INTO h222, h223, nulas
    FROM fat_folha
   WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
     AND ano = 2026 AND mes = 8;

  SELECT count(*) FILTER (WHERE btrim(conta_cred_cod) = '41013001'),
         count(*) FILTER (WHERE btrim(conta_cred_cod) = '41041008'),
         count(*) FILTER (WHERE btrim(conta_cred_cod) = '41041005')
    INTO c1, c2, c3
    FROM fat_folha
   WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
     AND ano = 2026 AND mes = 8;

  RAISE EXCEPTION 'HORAS — 222: % h (esperado 17.731,1) · 223: % h (esperado 531,1) · linhas sem horas: % || CONTA_CRED — 41013001: % (esp. 22) · 41041008: % (esp. 3) · 41041005: % (esp. 2)',
    to_char(h222, 'FM999G990D0'), to_char(h223, 'FM999G990D0'), nulas, c1, c2, c3;
END
$diag$;
