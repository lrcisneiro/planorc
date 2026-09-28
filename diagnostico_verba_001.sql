-- ============================================================
-- Onde estão os 5.250,91 da verba 001 SALARIO em 41011001
--
-- Na tela: razão 399.084,79 · folha 404.335,70 · dif −5.250,91. As demais
-- verbas da conta (021, 024, 025) batem zero, então a diferença é toda da 001.
--
-- Duas hipóteses, e elas pedem correções diferentes:
--
-- (A) A folha põe em CONTA diferente da que o razão usou. Aparece como espelho:
--     sobra em 41011001 e falta noutra conta, mesmo valor, sinal trocado.
--
-- (B) A folha põe em EMPRESA diferente. O conversor redireciona a empresa por
--     ITEM_CONTABIL (01→05, 02→01, 03→06...), mas o razão guarda a empresa que
--     o ERP lançou. Com filtro de empresa na tela, o mesmo dinheiro entra de um
--     lado e não do outro — e some sem deixar rastro no total consolidado.
--
-- ⚠ Esta consulta roda SEM filtro de escopo. Se a tela estiver filtrada, os
--    números não são comparáveis linha a linha — e se (B) for a causa, é
--    exatamente essa incomparabilidade que a explica.
--
-- Responde com ERROR. Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; r record; txt text := ''; t2 text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  -- (A) por CONTA: a folha e o razão põem a verba 001 na mesma conta?
  FOR r IN
    WITH fo AS (
      SELECT cc.codigo AS conta, sum(ff.valor) AS v
        FROM fat_folha ff JOIN conta_contabil cc ON cc.id = ff.conta_id
       WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
         AND ff.ano = 2026 AND ff.mes = 8 AND btrim(ff.verba_cod) = '001'
       GROUP BY 1
    ),
    rz AS (
      SELECT cc.codigo AS conta, sum(-fr.valor) AS v
        FROM fat_realizado fr JOIN conta_contabil cc ON cc.id = fr.conta_id
       WHERE fr.tenant_id = current_tenant_id() AND fr.ano = 2026 AND fr.mes = 8
         AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) = '001'
       GROUP BY 1
    )
    SELECT coalesce(fo.conta, rz.conta) AS conta,
           coalesce(fo.v, 0) AS folha, coalesce(rz.v, 0) AS razao,
           coalesce(fo.v, 0) - coalesce(rz.v, 0) AS dif
      FROM fo FULL JOIN rz ON rz.conta = fo.conta
     WHERE abs(coalesce(fo.v, 0) - coalesce(rz.v, 0)) > 0.005
     ORDER BY abs(coalesce(fo.v, 0) - coalesce(rz.v, 0)) DESC
  LOOP
    txt := txt || format('%s: folha %s razao %s dif %s | ', r.conta,
      to_char(r.folha,'FM999G999G990D00'), to_char(r.razao,'FM999G999G990D00'),
      to_char(r.dif,'FM999G999G990D00'));
  END LOOP;

  -- (B) por EMPRESA, só em 41011001
  FOR r IN
    WITH fo AS (
      SELECT e.codigo AS emp, sum(ff.valor) AS v
        FROM fat_folha ff
        JOIN conta_contabil cc ON cc.id = ff.conta_id AND cc.codigo = '41011001'
        LEFT JOIN empresa e ON e.id = ff.empresa_id
       WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
         AND ff.ano = 2026 AND ff.mes = 8 AND btrim(ff.verba_cod) = '001'
       GROUP BY 1
    ),
    rz AS (
      SELECT e.codigo AS emp, sum(-fr.valor) AS v
        FROM fat_realizado fr
        JOIN conta_contabil cc ON cc.id = fr.conta_id AND cc.codigo = '41011001'
        LEFT JOIN empresa e ON e.id = fr.empresa_id
       WHERE fr.tenant_id = current_tenant_id() AND fr.ano = 2026 AND fr.mes = 8
         AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) = '001'
       GROUP BY 1
    )
    SELECT coalesce(fo.emp, rz.emp, '(nula)') AS emp,
           coalesce(fo.v, 0) - coalesce(rz.v, 0) AS dif
      FROM fo FULL JOIN rz ON rz.emp IS NOT DISTINCT FROM fo.emp
     WHERE abs(coalesce(fo.v, 0) - coalesce(rz.v, 0)) > 0.005
     ORDER BY abs(coalesce(fo.v, 0) - coalesce(rz.v, 0)) DESC
  LOOP
    t2 := t2 || format('%s %s | ', r.emp, to_char(r.dif, 'FM999G999G990D00'));
  END LOOP;

  RAISE EXCEPTION 'VERBA 001 — POR CONTA: % || EM 41011001, POR EMPRESA: %',
    coalesce(nullif(txt,''), 'todas as contas batem'),
    coalesce(nullif(t2,''), 'todas as empresas batem');
END
$diag$;
