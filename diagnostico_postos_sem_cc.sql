-- ============================================================
-- De onde vem o orçado sem centro de custo (origem POSTO)
--
-- ⚠ Duas versões anteriores deste arquivo erraram, e as duas pelo mesmo vício:
-- eu inferi em vez de olhar o que o Aplicar grava.
--   1ª — listava posto sem CC OU sem rateio, quando o que gera nulo é E.
--   2ª — procurava em `fat_folha`, que grava o CC DO POSTO. Veio vazio, e
--        vazio num diagnóstico se lê como "está tudo certo".
--
-- O Aplicar escreve as duas tabelas com CCs DIFERENTES, de propósito:
--   · `fat_folha`  → cc_id do POSTO     (origem do custo, p/ conciliar a folha)
--   · `fat_orcado` → cc_id do DESTINO   (depois do rateio, p/ a DRE)
-- Então o nulo nasce no DESTINO do rateio, não no cadastro do posto.
--
-- E `fat_orcado.dims` carrega `posto`, `cc_origem` e `rateio_pct` — dá para ir
-- direto à fonte, sem adivinhar.
--
-- As seções 0 e 1 SEMPRE devolvem linha, inclusive zeradas: um diagnóstico que
-- volta vazio não distingue "não há problema" de "a consulta está cega".
--
-- Só leitura. Uma consulta só.
-- ============================================================
with v as (
  select id, codigo from versao_orcamento
   where codigo ilike '%2027%' and codigo ilike 'Or%ado%'   -- tolera acento/caixa
),
posto_nulo as (
  select f.dims->>'posto'       as posto,
         f.dims->>'cc_origem'   as cc_origem_id,
         f.dims->>'rateio_pct'  as pct,
         f.empresa_id, f.filial_id, f.valor
    from fat_orcado f join v on v.id = f.versao_id
   where f.origem = 'POSTO' and f.cc_id is null
)
select '0 · a consulta enxerga?' as secao,
       (select coalesce(string_agg(codigo, ', '), '⚠ NENHUMA versão casou o filtro')) as a,
       (select count(*)::text || ' linha(s) origem POSTO' from fat_orcado f join v on v.id = f.versao_id where f.origem = 'POSTO') as b,
       (select count(*)::text || ' delas SEM cc' from posto_nulo) as c,
       (select to_char(coalesce(sum(valor), 0), 'FM999G999G990D00') from posto_nulo) as d,
       '' as e
  from v
union all
select '1 · por posto (do dims)',
       coalesce(pn.posto, '(sem posto no dims)'),
       e.codigo || coalesce(' · ' || f.codigo, ''),
       coalesce(cc.codigo || ' · ' || cc.descricao, '⚠ posto também sem CC de origem'),
       to_char(sum(pn.valor), 'FM999G999G990D00'),
       count(*) || ' lanç.' || coalesce(' · rateio ' || max(pn.pct) || '%', ' · sem rateio parcial')
  from posto_nulo pn
  join empresa e on e.id = pn.empresa_id
  left join filial f on f.id = pn.filial_id
  left join centro_custo cc on cc.id = pn.cc_origem_id::uuid
 group by pn.posto, e.codigo, f.codigo, cc.codigo, cc.descricao
union all
-- O alvo do conserto. A coluna que decide tudo é a DIMENSÃO da regra:
--
--   cc_id: dim === 'CC' ? (d.cc_id ?? null) : c.cc_id     (lib/rateioFolha.ts)
--
-- Regra de dimensão EMPRESA preserva o CC de ORIGEM — é o rateio "mesmo custo,
-- outra empresa". Só a de dimensão CC troca o centro de custo, e aí um destino
-- sem CC vira nulo. Destino que só define empresa numa regra marcada como CC é
-- a combinação que produz o "Sem CC".
--
-- `pct` já está em PERCENTUAL no banco (o motor divide por 100), então nada de
-- multiplicar aqui — a versão anterior mostrava 754% onde eram 7,54%.
select '2 · destinos de rateio SEM CC',
       r.nome || '  [dimensão: ' || coalesce(r.dimensao, '—') || ']',
       coalesce(de.codigo || ' · ' || de.descricao, '(empresa nula)'),
       to_char(rd.pct, 'FM990D00') || '%',
       (select count(*)::text || ' posto(s) usam' from posto_rateio pr where pr.regra_id = rd.regra_id),
       case when r.dimensao = 'CC' then '⚠ dimensão CC + destino sem CC = nulo. Se a intenção é só trocar de EMPRESA, mude a dimensão'
            else 'dimensão não é CC — este destino não zera o CC' end
  from rateio_destino rd
  join rateio_regra r on r.id = rd.regra_id
  left join empresa de on de.id = rd.empresa_id
 where rd.cc_id is null
 order by 1, 5 desc;
