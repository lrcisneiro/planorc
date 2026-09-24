-- ============================================================
-- A folha tem DOIS lados contábeis; o Planorc só resolve um
--
-- O import grava `conta_id` a partir de `conta_deb` e só dele
-- (FolhaRealizadaPage:328). A `conta_cred_cod` fica como texto e é usada
-- apenas para EXCLUIR a contrapartida (v3_087, v3_092) — nunca para atribuir
-- valor a uma conta de resultado.
--
-- A premissa embutida: "o débito é o resultado, o crédito é o passivo". Vale
-- para o CLT — débito despesa, crédito a pagar. Mas a verba 549 CONVENIO
-- MEDICO é o contrário: débito 21012017 (patrimonial), crédito 41013001
-- (despesa). É a empresa recuperando do prestador o convênio que adiantou.
--
-- Nessas linhas o efeito no RESULTADO está do lado do crédito, e a conciliação
-- não enxerga: a linha é classificada pela conta patrimonial do débito e cai
-- fora dos dois blocos.
--
-- Esta consulta mede o tamanho do ponto cego em Ago/2026.
-- Responde com ERROR — ver diagnostico_terceiro_desconto.sql para o porquê.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; r record; txt text := ''; verbas text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  FOR r IN
    WITH base AS (
      SELECT ff.verba_cod, ff.verba_desc, ff.valor,
             cd.natureza AS nat_deb,
             (SELECT c2.natureza FROM conta_contabil c2
               WHERE c2.tenant_id = current_tenant_id()
                 AND c2.codigo = btrim(ff.conta_cred_cod)
               LIMIT 1) AS nat_cred
        FROM fat_folha ff
        LEFT JOIN conta_contabil cd ON cd.id = ff.conta_id
       WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
         AND ff.ano = 2026 AND ff.mes = 8
    ),
    cls AS (
      SELECT CASE
               WHEN nat_deb IN ('RECEITA','DESPESA') AND nat_cred IN ('RECEITA','DESPESA')
                                                          THEN '3 os DOIS lados sao resultado'
               WHEN nat_deb IN ('RECEITA','DESPESA')      THEN '1 normal: debito resultado'
               WHEN nat_cred IN ('RECEITA','DESPESA')     THEN '2 INVERTIDA: resultado esta no CREDITO'
               WHEN nat_deb IS NULL                       THEN '5 debito nao resolvido'
               ELSE                                            '4 os dois lados patrimoniais'
             END AS classe, valor
        FROM base
    )
    SELECT classe, count(*) AS linhas, sum(valor) AS total
      FROM cls GROUP BY 1 ORDER BY 1
  LOOP
    txt := txt || format('%s: %s linha(s) %s | ', r.classe, r.linhas,
                         to_char(r.total, 'FM999G999G990D00'));
  END LOOP;

  -- quais verbas caem na classe invertida (é a lista a levar para a área)
  FOR r IN
    SELECT ff.verba_cod, max(ff.verba_desc) AS desc_, sum(ff.valor) AS total
      FROM fat_folha ff
      LEFT JOIN conta_contabil cd ON cd.id = ff.conta_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = 2026 AND ff.mes = 8
       AND coalesce(cd.natureza,'') NOT IN ('RECEITA','DESPESA')
       AND (SELECT c2.natureza FROM conta_contabil c2
             WHERE c2.tenant_id = current_tenant_id()
               AND c2.codigo = btrim(ff.conta_cred_cod) LIMIT 1) IN ('RECEITA','DESPESA')
     GROUP BY 1 ORDER BY sum(ff.valor) DESC LIMIT 8
  LOOP
    verbas := verbas || format('%s %s (%s) · ', r.verba_cod, left(r.desc_, 18),
                               to_char(r.total, 'FM999G999G990D00'));
  END LOOP;

  RAISE EXCEPTION 'CLASSES — % || VERBAS INVERTIDAS: %', txt,
                  coalesce(nullif(verbas, ''), 'NENHUMA');
END
$diag$;
