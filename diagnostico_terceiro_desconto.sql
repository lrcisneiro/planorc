-- ============================================================
-- A nota do terceiro é LÍQUIDA; a folha registra BRUTO + desconto à parte
--
-- Caso JOSE CHOITE KITA JUNIOR (900048, filial 2001), Ago/2026:
--
--   folha   16.959,59   = 222 HORAS FATURAVEIS 16.947,81 + 223 TRANSLADO 11,78
--                         (as duas debitam 41021001 — conta de terceiro)
--   razão   14.222,96   = a NF, doc 000011, na mesma 41021001
--   dif     -2.736,63   = exatamente a verba 549 CONVENIO MEDICO
--
-- A 549 existe na folha, mas debita 21012017 (patrimonial) e credita 41013001:
-- é o convênio que a empresa adiantou e desconta do prestador. A nota sai JÁ
-- LÍQUIDA disso, então o razão registra 14.222,96 e nunca bate com o bruto.
--
-- É o OPOSTO do CLT. Lá o razão registra o bruto e a retenção vira crédito num
-- passivo separado — por isso a conciliação exclui verba de desconto do lado da
-- folha, e faz certo. No terceiro o desconto já está embutido no razão. Mesma
-- palavra, contabilização invertida.
--
-- ⚠ A verba D53 SEGURO VIDA P.J. (142,38) NÃO entra: é 'Base (Desconto)' com
-- débito em DESPESA (41013004) — custo da empresa, não retenção do prestador,
-- e a nota não é reduzida por ela. Por isso o corte é `tipo_verba = 'Desconto'`
-- exato, e não `LIKE 'Desconto%'`.
--
-- ─────────────────────────────────────────────────────────────
-- POR QUE ISTO É UM BLOCO `DO` QUE RESPONDE COM ERRO
--
-- No SQL Editor não há JWT: `auth.uid()` é nulo, `current_tenant_id()` devolve
-- NULL, e TODA consulta filtrada por tenant volta vazia — inclusive por dentro
-- das RPCs. A primeira versão desta consulta não retornou nada por isso, e não
-- por falta de dado.
--
-- A correção é definir a identidade antes de consultar. Ela vai num bloco `DO`
-- único porque o editor não garante que um `BEGIN;` agrupe as instruções
-- seguintes, e a identidade definida numa se perderia antes da outra rodar. E
-- a resposta sai por `RAISE EXCEPTION` porque é a única saída que o editor
-- sempre mostra. Ver "ERROR" aqui é o funcionamento normal.
--
-- Não troca de papel no Postgres: só preenche a claim para o tenant resolver.
-- Nada é escrito.
-- ============================================================

DO $diag$
DECLARE
  uid uuid; rel uuid;
  r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM user_tenant LIMIT 1; END IF;
  IF uid IS NULL THEN RAISE EXCEPTION 'Nenhum usuário em user_tenant'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() continua nulo';
  END IF;

  SELECT r2.id INTO rel FROM relatorio r2
    JOIN relatorio_linha rl ON rl.relatorio_id = r2.id AND rl.linha_orc_id IS NOT NULL
   WHERE r2.tenant_id = current_tenant_id()
   GROUP BY r2.id ORDER BY count(*) DESC LIMIT 1;

  FOR r IN
    WITH clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(2026, 8)),
    rz AS (
      SELECT a.filial_id, a.matricula, sum(a.valor)::numeric AS razao
        FROM planorc_pj_atribui(2026, 8, rel) a
       WHERE a.matricula IS NOT NULL
       GROUP BY 1, 2
    ),
    fo AS (
      SELECT ff.filial_id, ff.matricula,
             coalesce(sum(ff.valor) FILTER (
               WHERE ff.conta_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM clt WHERE clt.conta_id = ff.conta_id)
             ), 0)::numeric AS folha_bloco,
             coalesce(sum(ff.valor) FILTER (WHERE ff.tipo_verba = 'Desconto'), 0)::numeric AS descontos
        FROM fat_folha ff
       WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
         AND ff.ano = 2026 AND ff.mes = 8
       GROUP BY 1, 2
    ),
    j AS (
      SELECT coalesce(fo.folha_bloco, 0) - rz.razao                              AS dif_bruto,
             -- SOMA, não subtrai: depois da correção do conversor a linha do
             -- desconto vem do lado do CRÉDITO e já chega negativa. Subtrair
             -- dobrava o erro — foi o que o balde 5 mostrou.
             coalesce(fo.folha_bloco, 0) + coalesce(fo.descontos, 0) - rz.razao  AS dif_liquido,
             coalesce(fo.descontos, 0)                                           AS descontos
        FROM rz LEFT JOIN fo ON fo.filial_id IS NOT DISTINCT FROM rz.filial_id
                            AND fo.matricula = rz.matricula
    )
    SELECT CASE
             WHEN abs(dif_bruto) <= 1               THEN '1 ja batia sem desconto'
             WHEN descontos = 0                     THEN '4 diverge SEM desconto (outra causa)'
             WHEN abs(dif_liquido) <= 1             THEN '2 EXPLICADO: folha + desconto = razao'
             WHEN abs(dif_liquido) < abs(dif_bruto) THEN '3 melhora mas nao fecha'
             ELSE                                        '5 PIORA ao somar (NAO aplicar)'
           END AS balde,
           count(*) AS pessoas,
           sum(dif_bruto)   AS soma_hoje,
           sum(dif_liquido) AS soma_se_liquido
      FROM j GROUP BY 1 ORDER BY 1
  LOOP
    txt := txt || format('%s: %s pessoa(s), dif hoje %s, dif se liquido %s | ',
                         r.balde, r.pessoas,
                         to_char(r.soma_hoje, 'FM999G999G990D00'),
                         to_char(r.soma_se_liquido, 'FM999G999G990D00'));
  END LOOP;

  IF txt = '' THEN
    RAISE EXCEPTION 'Nenhuma pessoa no bloco de terceiros em Ago/2026 (tenant=%, relatorio=%)', current_tenant_id(), rel;
  END IF;
  RAISE EXCEPTION 'RESULTADO — %', txt;
END
$diag$;
