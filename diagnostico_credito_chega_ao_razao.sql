-- ============================================================
-- O crédito da folha vira lançamento no razão, ou não?
--
-- É a pergunta que decide se o quebra-galho da 549 ajuda ou atrapalha — e se
-- as verbas 634 COMBUSTIVEL e 655/628 MULTA TRANSITO devem receber o mesmo
-- tratamento (eu acho que NÃO, e é o que esta consulta testa).
--
-- Dois mundos possíveis, e eles pedem correções opostas:
--
-- (A) O crédito CHEGA ao razão. Então 41013001 recebe −2.736,63 tanto na folha
--     quanto no razão: esse lado já concilia. O único descasamento é a nota ser
--     emitida líquida, e mexer na conta do crédito PIORA — desfaz uma redução
--     de despesa que estava certa. O certo seria nomear a retenção no drill do
--     terceiro e deixar o valor onde está.
--
-- (B) O crédito NÃO chega ao razão. Então é cálculo interno da folha: o único
--     evento contábil é a nota líquida, a despesa de convênio/combustível nunca
--     foi reduzida nos livros, e levar o crédito para a conta do terceiro faz a
--     folha espelhar o razão — que é o que o quebra-galho faz.
--
-- Para PJ há razão de suspeitar de (B): o prestador é pago por NF em lote de
-- contas a pagar, não pela contabilização da folha.
--
-- Compara, por conta, o que a FOLHA credita e o que o RAZÃO movimenta.
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
    WITH alvo(conta_cod, verba) AS (VALUES
      ('41013001', '549 convenio'),
      ('41041005', '634 combustivel'),
      ('41041008', '655/628 multa')
    ),
    c AS (
      SELECT a.conta_cod, a.verba, cc.id AS conta_id
        FROM alvo a
        JOIN conta_contabil cc ON cc.codigo = a.conta_cod
                              AND cc.tenant_id = current_tenant_id()
    )
    SELECT c.conta_cod, c.verba,
           -- o que a folha põe nessa conta (já com o sinal do conversor novo)
           (SELECT coalesce(sum(ff.valor), 0) FROM fat_folha ff
             WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
               AND ff.ano = 2026 AND ff.mes = 8 AND ff.conta_id = c.conta_id) AS folha,
           -- o que o razão movimenta na mesma conta
           (SELECT coalesce(sum(-fr.valor), 0) FROM fat_realizado fr
             WHERE fr.tenant_id = current_tenant_id()
               AND fr.ano = 2026 AND fr.mes = 8 AND fr.conta_id = c.conta_id) AS razao,
           -- e quanto do razão é CRÉDITO (redução de despesa) nessa conta
           (SELECT coalesce(sum(-fr.valor), 0) FROM fat_realizado fr
             WHERE fr.tenant_id = current_tenant_id()
               AND fr.ano = 2026 AND fr.mes = 8 AND fr.conta_id = c.conta_id
               AND fr.valor > 0) AS razao_creditos
      FROM c ORDER BY 1
  LOOP
    txt := txt || format('%s (%s): folha %s · razao %s · creditos no razao %s | ',
      r.conta_cod, r.verba,
      to_char(r.folha, 'FM999G999G990D00'),
      to_char(r.razao, 'FM999G999G990D00'),
      to_char(r.razao_creditos, 'FM999G999G990D00'));
  END LOOP;

  IF txt = '' THEN
    RAISE EXCEPTION 'Nenhuma das contas alvo existe em conta_contabil';
  END IF;
  RAISE EXCEPTION 'FOLHA x RAZAO POR CONTA — %', txt;
END
$diag$;
