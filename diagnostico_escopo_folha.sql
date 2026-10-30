-- ============================================================
-- CPESSOAS, FDIR e FAPOIO têm a MESMA fórmula: -1*([201]+[202]+[203]).
-- O que as separa é o `filtro_escopo`, e ele recorta por ÁREA:
--   CPESSOAS  sem filtro (todas)      FDIR  áreas 2,3,5      FAPOIO  áreas 1,4
--
-- Para FDIR + FAPOIO = CPESSOAS, as áreas 1..5 precisam cobrir TODO centro de
-- custo que tenha folha. Área fora dessa lista, ou CC sem área, entra no
-- CPESSOAS e em nenhum dos dois — e aí:
--   PESTRUT = FAPOIO/(FDIR+FAPOIO)   mente sobre a proporção de estrutura,
--   MGBRUTA = MCPRE - FDIR           tira folha a menos,
--   DLER, MLER, LERM                 herdam.
-- Nada na tela denuncia: as linhas calculam, só calculam coisa diferente do
-- que os nomes prometem.
--
-- ⚠ A versão anterior desta consulta olhava `filtro_escopo->'cc'` e devolvia
-- vazio porque o recorte é por 'area'. Vazio por olhar a chave errada parece
-- "está tudo certo", que é o pior resultado possível num diagnóstico.
--
-- Só leitura. Uma consulta só.
-- ============================================================
with alvo as (
  select rl.codigo, rl.filtro_escopo
    from relatorio_linha rl
    join relatorio r on r.id = rl.relatorio_id
   where r.nome ilike '%DRE Gerencial%' and rl.codigo in ('FDIR','FAPOIO')
),
areas_linha as (
  select a.codigo, x.area
    from alvo a, lateral jsonb_array_elements_text(coalesce(a.filtro_escopo->'area','[]'::jsonb)) x(area)
),
-- toda área que aparece em centro de custo ATIVO, com quantos CCs tem
areas_cc as (
  select coalesce(cc.area_cod, '(sem área)') as area,
         coalesce(max(cc.area_nome), '—')    as area_nome,
         count(*)                            as ccs
    from centro_custo cc where cc.ativo
   group by 1
),
-- quanto de folha (contas 201/202/203 via master) cada área tem orçado
folha as (
  select coalesce(cc.area_cod, '(sem área)') as area, round(sum(fo.valor), 2) as valor
    from fat_orcado fo
    join centro_custo cc on cc.id = fo.cc_id
    join conta_orcamentaria co on co.id = fo.linha_id
   where co.codigo like '201%' or co.codigo like '202%' or co.codigo like '203%'
   group by 1
)
select case
         when exists (select 1 from areas_linha where area = a.area and codigo = 'FDIR')
          and exists (select 1 from areas_linha where area = a.area and codigo = 'FAPOIO')
              then '⚠ DUPLA — está em FDIR e em FAPOIO'
         when exists (select 1 from areas_linha where area = a.area)
              then '✓ ' || (select string_agg(codigo, '+') from areas_linha where area = a.area)
         else '⚠ FORA — não entra em FDIR nem em FAPOIO'
       end                                       as situacao,
       a.area, a.area_nome, a.ccs               as centros_custo,
       coalesce(to_char(f.valor, 'FM999G999G990D00'), '—') as folha_orcada
  from areas_cc a
  left join folha f on f.area = a.area
 order by 1, 2;
