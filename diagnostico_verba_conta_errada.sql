-- ============================================================
-- Verbas de desconto creditando conta DIFERENTE da do terceiro
--
-- Achado do Ricardo, a partir do caso Choite: o desconto do convênio credita
-- 41013001 (Encargos), mas a NOTA FISCAL do prestador já sai líquida dele, em
-- 41021001 (Terceiros Internos). Os dois lados do mesmo fato ficam em contas
-- diferentes, e por isso nunca batem.
--
--   folha  41021001  16.947,81 + 11,78                 = 16.959,59
--   razão  41021001  a NF, líquida do convênio         = 14.222,96
--   folha  41013001  o desconto, sozinho, noutra conta = −2.736,63
--
-- Se a verba creditasse 41021001, a folha daria 14.222,96 — igual ao razão, ao
-- centavo, sem regra nenhuma na conciliação.
--
-- É parametrização da folha no ERP, não modelagem do Planorc. Esta consulta
-- lista os casos para levar a quem mantém o cadastro: a verba, a conta que ela
-- credita hoje, e a conta em que os proventos daquela pessoa estão.
--
-- ⚠ Isto vale para TERCEIRO, onde a nota é emitida líquida. Para CLT creditar
-- a conta do benefício pode estar certo: lá o razão registra o bruto e a
-- recuperação é lançamento separado. Por isso a consulta olha só quem está no
-- bloco de terceiros.
--
-- Responde com ERROR — ver diagnostico_terceiro_desconto.sql para o porquê.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; rel uuid; r record; txt text := ''; n int := 0;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  SELECT r2.id INTO rel FROM relatorio r2
    JOIN relatorio_linha rl ON rl.relatorio_id = r2.id AND rl.linha_orc_id IS NOT NULL
   WHERE r2.tenant_id = current_tenant_id()
   GROUP BY r2.id ORDER BY count(*) DESC LIMIT 1;

  FOR r IN
    WITH gente AS (   -- só quem está no bloco de terceiros
      SELECT DISTINCT a.filial_id, a.matricula
        FROM planorc_pj_atribui(2026, 8, rel) a
       WHERE a.matricula IS NOT NULL
    ),
    linhas AS (
      SELECT ff.filial_id, ff.matricula, ff.verba_cod, max(ff.verba_desc) AS verba_desc,
             cc.codigo AS conta, sum(ff.valor) AS valor
        FROM fat_folha ff
        JOIN gente g ON g.matricula = ff.matricula
                    AND g.filial_id IS NOT DISTINCT FROM ff.filial_id
        JOIN conta_contabil cc ON cc.id = ff.conta_id
       WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
         AND ff.ano = 2026 AND ff.mes = 8
       GROUP BY 1, 2, 3, 5
    ),
    -- a conta onde o dinheiro POSITIVO da pessoa está (a do terceiro)
    principal AS (
      SELECT filial_id, matricula, conta,
             row_number() OVER (PARTITION BY filial_id, matricula ORDER BY sum(valor) DESC) AS rn
        FROM linhas WHERE valor > 0 GROUP BY 1, 2, 3
    )
    SELECT l.verba_cod, max(l.verba_desc) AS verba_desc,
           l.conta AS credita_em, p.conta AS deveria_ser,
           count(*) AS pessoas, sum(l.valor) AS total
      FROM linhas l
      JOIN principal p ON p.filial_id IS NOT DISTINCT FROM l.filial_id
                      AND p.matricula = l.matricula AND p.rn = 1
     WHERE l.valor < 0 AND l.conta <> p.conta
     GROUP BY l.verba_cod, l.conta, p.conta
     ORDER BY sum(l.valor)
  LOOP
    n := n + 1;
    txt := txt || format('%s %s: credita %s, proventos em %s — %s pessoa(s), %s | ',
      r.verba_cod, left(r.verba_desc, 16), r.credita_em, r.deveria_ser, r.pessoas,
      to_char(r.total, 'FM999G999G990D00'));
  END LOOP;

  IF n = 0 THEN
    RAISE EXCEPTION 'Nenhuma verba de terceiro creditando conta diferente — nada a corrigir no cadastro';
  END IF;
  RAISE EXCEPTION 'CADASTRO A CORRIGIR (% caso(s)) — %', n, txt;
END
$diag$;
