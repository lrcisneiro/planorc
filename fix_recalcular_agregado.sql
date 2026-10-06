-- ============================================================
-- O agregado está em dia? E, se não estiver, recalcular pelo SQL Editor
--
-- ATENÇÃO: `select refresh_realizado_mensal();` sozinho NÃO funciona aqui. A
-- função filtra por current_tenant_id(), que no SQL Editor é NULL — ela apaga
-- nada e insere nada, sem erro nenhum. Por isso o bloco DO com a claim.
--
-- Rode a PARTE 1 primeiro. Se o agregado já tiver os meses novos, não precisa
-- da PARTE 2.
-- ============================================================

-- ─────────── PARTE 1 · diagnóstico (só leitura) ───────────
-- Compara mês a mês o que existe no fato com o que existe no agregado.
-- Mês que aparece no fato e não no agregado = o refresh não terminou.
select
  coalesce(f.ano, m.ano)                         as ano,
  coalesce(f.mes, m.mes)                         as mes,
  f.linhas_fato,
  m.linhas_agregado,
  round(f.valor_fato, 2)                         as valor_fato,
  round(m.valor_agregado, 2)                     as valor_agregado,
  case
    when m.ano is null                           then '*** FALTA no agregado ***'
    when abs(coalesce(f.valor_fato,0) - coalesce(m.valor_agregado,0)) > 0.01
                                                 then '*** valor diferente ***'
    else 'ok'
  end                                            as situacao
from (
  select ano, mes, count(*) linhas_fato, sum(valor) valor_fato
    from fat_realizado group by ano, mes
) f
full join (
  select ano, mes, count(*) linhas_agregado, sum(valor) valor_agregado
    from fat_realizado_mensal group by ano, mes
) m on m.ano = f.ano and m.mes = f.mes
order by 1 desc, 2 desc;

-- Obs.: diferença de VALOR é esperada quando há lote ignorado — a função exclui
-- os lotes de `lote_ignorado` do agregado de propósito. Mês FALTANDO não é.


-- ─────────── PARTE 2 · recalcular (só se a PARTE 1 acusar) ───────────
-- Descomente e rode. Pode levar alguns minutos; o SQL Editor espera.
/*
DO $rec$
DECLARE uid uuid; t uuid; n_antes int; n_depois int;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo — o refresh nao faria nada'; END IF;

  SELECT count(*) INTO n_antes FROM fat_realizado_mensal WHERE tenant_id = t;
  PERFORM refresh_realizado_mensal();
  SELECT count(*) INTO n_depois FROM fat_realizado_mensal WHERE tenant_id = t;

  -- RAISE aborta a transacao e desfaria o refresh; por isso o resultado sai por
  -- NOTICE e o bloco termina normalmente, deixando o commit acontecer.
  RAISE NOTICE 'agregado: % -> % linhas', n_antes, n_depois;
END $rec$;
*/
