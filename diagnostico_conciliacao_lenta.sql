-- ============================================================
-- "TypeError: Failed to fetch" na aba Contábil × Folha
--
-- Não é erro de dado: é o gateway cortando a resposta por tempo. A tela dispara
-- 6 RPCs em paralelo; basta uma estourar. Este script descobre qual.
--
-- HIPÓTESE PRINCIPAL: o Substituir apagou e reinseriu 308 mil linhas em
-- fat_realizado. As estatísticas da tabela ficaram velhas e o planner passa a
-- escolher plano ruim — a própria v3_089 registra que essa conciliação já foi
-- de 1s para 7s por esse motivo.
--
-- Rode a PARTE 1 primeiro e teste a tela. Se voltar a funcionar, acabou.
-- ============================================================

-- ─────────── PARTE 1 · reestatística (rápido, sem lock de escrita) ───────────
-- Rode cada uma sozinha. VACUUM não roda dentro de bloco/transação.
ANALYZE fat_realizado;
ANALYZE fat_realizado_mensal;
ANALYZE conta_contabil;
ANALYZE fat_folha;
-- Se ainda estiver lento depois disso, o espaço morto do delete é o problema:
--   VACUUM (ANALYZE) fat_realizado;


-- ─────────── PARTE 2 · qual RPC está lenta ───────────
-- Roda as 6 chamadas da tela, cronometrando cada uma. Chamada por parametro
-- NOMEADO: a v3_089 recriou as funcoes com p_relatorio_id em 3o lugar, entao
-- passar por posicao pega a assinatura antiga ou nenhuma. O resultado sai como
-- erro (é o jeito de ver a saída de um bloco DO no SQL Editor); nada é gravado.
DO $t$
DECLARE
  uid uuid; t uuid; rel uuid; ini timestamptz; out_txt text := E'\n';
  n int; a int := 2026; m int := 9;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  SELECT id INTO rel FROM relatorio WHERE nome ILIKE '%DRE Gerencial%' AND tenant_id = t LIMIT 1;
  IF rel IS NULL THEN RAISE EXCEPTION 'relatorio "DRE Gerencial" nao encontrado'; END IF;
  out_txt := out_txt || format('competencia %s/%s   relatorio %s', m, a, rel) || E'\n\n';

  ini := clock_timestamp();
  SELECT count(*) INTO n FROM conciliacao_clt(p_ano := a, p_mes := m, p_relatorio_id := rel);
  out_txt := out_txt || format('  conciliacao_clt              %12s  %s linhas', clock_timestamp()-ini, n) || E'\n';

  ini := clock_timestamp();
  SELECT count(*) INTO n FROM conciliacao_clt_outros(p_ano := a, p_mes := m, p_relatorio_id := rel);
  out_txt := out_txt || format('  conciliacao_clt_outros       %12s  %s linhas', clock_timestamp()-ini, n) || E'\n';

  ini := clock_timestamp();
  SELECT count(*) INTO n FROM conciliacao_terceiros(p_ano := a, p_mes := m, p_relatorio_id := rel);
  out_txt := out_txt || format('  conciliacao_terceiros        %12s  %s linhas', clock_timestamp()-ini, n) || E'\n';

  ini := clock_timestamp();
  SELECT count(*) INTO n FROM conciliacao_patrimoniais(p_ano := a, p_mes := m);
  out_txt := out_txt || format('  conciliacao_patrimoniais     %12s  %s linhas', clock_timestamp()-ini, n) || E'\n';

  ini := clock_timestamp();
  SELECT count(*) INTO n FROM conciliacao_item_razao(p_ano := a, p_mes := m, p_relatorio_id := rel);
  out_txt := out_txt || format('  conciliacao_item_razao       %12s  %s linhas', clock_timestamp()-ini, n) || E'\n';

  ini := clock_timestamp();
  SELECT count(*) INTO n FROM conciliacao_terceiros_total(p_ano := a, p_mes := m, p_relatorio_id := rel);
  out_txt := out_txt || format('  conciliacao_terceiros_total  %12s  %s linhas', clock_timestamp()-ini, n) || E'\n';

  RAISE EXCEPTION '%', out_txt;
END $t$;


-- ─────────── PARTE 3 · natureza das contas novas (outro problema) ───────────
-- A natureza é preenchida pela regra do 1º dígito do plano BRASILEIRO
-- (1=ativo 2=passivo 3=receita 4=despesa). Ela não vale no exterior:
--   PY: 04=INGRESOS, 05=COSTOS, 11=GASTOS DE ADMINISTRACION  (todas começam
--       com 0 ou 1 -> viram TRANSITORIA ou ATIVO)
--   BO: 40=INGRESOS -> DESPESA,  50=GASTOS -> TRANSITORIA
-- Conta fora de RECEITA/DESPESA não entra na conferência da folha nem na regra
-- de "CC obrigatório". Esta consulta mostra o estrago.
select
  pc.codigo                        as plano,
  coalesce(cc.natureza, '(nulo)')  as natureza_gravada,
  left(cc.codigo, 2)               as grupo,
  count(*)                         as contas,
  min(cc.codigo) || ' ' || min(cc.descricao) as exemplo
from conta_contabil cc
join plano_contas pc on pc.id = cc.plano_id
where pc.codigo in ('PYTOP', 'BOTOP')
group by pc.codigo, cc.natureza, left(cc.codigo, 2)
order by pc.codigo, grupo;
