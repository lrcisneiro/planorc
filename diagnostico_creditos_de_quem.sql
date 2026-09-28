-- ============================================================
-- De QUEM são os créditos que o razão tem nessas contas?
--
-- A regra do Ricardo: terceiro não contabiliza por verba, só pela nota. Por
-- isso levar o crédito do 549 para a conta do terceiro funcionou.
--
-- Mas a medição mostrou o crédito da folha batendo AO CENTAVO com o crédito do
-- razão em 41041005 (−1.065,84) e 41041008 (−487,11). Se ali a verba chega ao
-- razão, aplicar o mesmo override contaria duas vezes.
--
-- E em 41013001 há −10.111,80 de crédito no razão contra −10.000,30 de 549 de
-- PJ. Se esses créditos FOREM o PJ, o override que já fiz deixou a conta
-- divergente em 10 mil no bloco CLT — eu preciso saber, não supor.
--
-- O discriminador é o mesmo que a conciliação de CLT usa: linha que veio da
-- contabilização da folha começa o HISTÓRICO com o código da verba.
--
-- Responde com ERROR. Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  FOR r IN
    SELECT cc.codigo AS conta,
           btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS prefixo,
           left(max(coalesce(fr.historico, '')), 34) AS exemplo,
           count(*) AS lancamentos,
           sum(-fr.valor) AS valor
      FROM fat_realizado fr
      JOIN conta_contabil cc ON cc.id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = 2026 AND fr.mes = 8
       AND cc.codigo IN ('41013001', '41041005', '41041008')
       AND fr.valor > 0                    -- só os CRÉDITOS
     GROUP BY 1, 2
     ORDER BY 1, sum(-fr.valor)
  LOOP
    txt := txt || format('%s [%s] "%s" %sx %s | ', r.conta, r.prefixo, r.exemplo,
                         r.lancamentos, to_char(r.valor, 'FM999G999G990D00'));
  END LOOP;

  IF txt = '' THEN
    RAISE EXCEPTION 'Nenhum crédito no razão nessas contas em ago/2026';
  END IF;
  RAISE EXCEPTION 'CREDITOS NO RAZAO — %', txt;
END
$diag$;
