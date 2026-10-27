-- ============================================================
-- LIMPAR TODO O ORÇADO DE 2027
--
-- Apaga as três origens, não só o seed: MANUAL (inclusive o que foi digitado à
-- mão), FORMULARIO e POSTO. Também limpa `fat_folha` tipo ORCADO, que o
-- "Aplicar" da grade de postos grava em paralelo ao fat_orcado — esquecer dela
-- deixaria a conciliação Orçado × Folha mostrando um orçado que já não existe.
--
-- O QUE VOLTA SOZINHO e o que não volta:
--   POSTO        recuperável — é só clicar "Aplicar" na grade de postos de novo
--   FORMULARIO   recuperável — reaplicar o formulário
--   MANUAL       NÃO volta. O que foi digitado à mão some para sempre, e o seed
--                só volta reimportando a planilha.
--
-- Rode a PARTE 1 e confira os números. Só então descomente a PARTE 2.
-- ============================================================

-- ─────────── PARTE 1 · o que será apagado ───────────
select
  v.codigo                       as versao,
  v.ano                          as ano_da_versao,
  f.ano                          as ano_da_linha,
  f.origem,
  count(*)                       as lancamentos,
  count(distinct f.linha_id)     as contas,
  count(distinct f.empresa_id)   as empresas,
  round(sum(f.valor), 2)         as total
from fat_orcado f
join versao_orcamento v on v.id = f.versao_id
where f.ano = 2027
group by v.codigo, v.ano, f.ano, f.origem
order by v.codigo, f.origem;

-- a folha orçada que o Aplicar grava junto
select
  v.codigo as versao, ff.ano, ff.tipo, ff.origem,
  count(*) as lancamentos, round(sum(ff.valor), 2) as total
from fat_folha ff
join versao_orcamento v on v.id = ff.versao_id
where ff.ano = 2027 and ff.tipo = 'ORCADO'
group by v.codigo, ff.ano, ff.tipo, ff.origem
order by v.codigo;

-- ⚠ nada em 2026 deve aparecer aqui. Se aparecer, PARE: o delete da PARTE 2
-- filtra por ano = 2027, mas vale conferir que 2026 está intacto antes e depois.
select ano, origem, count(*) as lancamentos, round(sum(valor), 2) as total
  from fat_orcado
 where ano <> 2027
 group by ano, origem
 order by ano desc, origem;


-- ─────────── PARTE 2 · apagar (descomente para rodar) ───────────
/*
DO $limpa$
DECLARE uid uuid; t uuid; n_orc int; n_folha int;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo — o delete nao filtraria por tenant'; END IF;

  DELETE FROM fat_orcado WHERE tenant_id = t AND ano = 2027;
  GET DIAGNOSTICS n_orc = ROW_COUNT;

  DELETE FROM fat_folha  WHERE tenant_id = t AND ano = 2027 AND tipo = 'ORCADO';
  GET DIAGNOSTICS n_folha = ROW_COUNT;

  -- NOTICE, nao EXCEPTION: EXCEPTION aborta a transacao e desfaz os deletes
  RAISE NOTICE 'fat_orcado 2027: % apagados | fat_folha ORCADO 2027: % apagados', n_orc, n_folha;
END $limpa$;
*/

-- ─────────── PARTE 3 · conferir que ficou vazio ───────────
select
  (select count(*) from fat_orcado where ano = 2027)                      as orcado_2027,
  (select count(*) from fat_folha  where ano = 2027 and tipo = 'ORCADO')  as folha_orcada_2027,
  (select count(*) from fat_orcado where ano = 2026)                      as orcado_2026_intacto;
