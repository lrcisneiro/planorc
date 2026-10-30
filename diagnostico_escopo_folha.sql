-- ============================================================
-- CPESSOAS, FDIR e FAPOIO têm a MESMA fórmula: -1*([201]+[202]+[203]).
-- O que as separa é o `filtro_escopo` — o recorte de centro de custo de cada
-- uma. Esta consulta mostra esse recorte e confere se ele fecha.
--
-- Por que importa: se FDIR e FAPOIO não forem partição de CPESSOAS — isto é,
-- se algum CC ficar de fora dos dois, ou entrar nos dois —, então
--   PESTRUT = FAPOIO/(FDIR+FAPOIO)   mente sobre a proporção,
--   MGBRUTA = MCPRE - FDIR           tira folha a menos (ou a mais),
--   DLER, MLER, LERM                 herdam o erro.
-- E nada na tela denuncia: as três linhas calculam, só calculam coisas
-- diferentes do que os nomes prometem.
--
-- Só leitura. Uma consulta só.
-- ============================================================
with alvo as (
  select rl.id, rl.codigo, rl.descricao, rl.filtro_escopo
    from relatorio_linha rl
    join relatorio r on r.id = rl.relatorio_id
   where r.nome ilike '%DRE Gerencial%'
     and rl.codigo in ('CPESSOAS', 'FDIR', 'FAPOIO')
),
-- os CCs que cada linha recorta (chave `cc` do filtro_escopo)
ccs_linha as (
  select a.codigo, a.descricao, c.cc_id
    from alvo a
    left join lateral jsonb_array_elements_text(coalesce(a.filtro_escopo->'cc', '[]'::jsonb)) c(cc_id) on true
)
select '1 · recorte de cada linha' as secao,
       a.codigo                     as a,
       a.descricao                  as b,
       case when a.filtro_escopo is null or a.filtro_escopo = '{}'::jsonb
            then 'SEM filtro — pega TODOS os centros de custo'
            else coalesce(jsonb_array_length(a.filtro_escopo->'cc'), 0) || ' CC(s) · '
                 || coalesce(jsonb_array_length(a.filtro_escopo->'area'), 0) || ' área(s) · '
                 || coalesce(jsonb_array_length(a.filtro_escopo->'bu'), 0) || ' BU(s)' end as c,
       coalesce(a.filtro_escopo::text, '—') as d
  from alvo a
union all
-- CC que está em FDIR e em FAPOIO ao mesmo tempo: contado duas vezes
select '2 · CC em FDIR **e** FAPOIO (conta duas vezes)', cc.codigo, cc.descricao, '⚠ dupla contagem', ''
  from ccs_linha f
  join ccs_linha p on p.cc_id = f.cc_id and p.codigo = 'FAPOIO'
  join centro_custo cc on cc.id::text = f.cc_id
 where f.codigo = 'FDIR'
union all
-- CC ativo que não está em nenhum dos dois: fica fora da soma
select '3 · CC fora de FDIR e de FAPOIO', cc.codigo, cc.descricao, '⚠ não entra em nenhum dos dois', ''
  from centro_custo cc
 where cc.ativo
   and not exists (select 1 from ccs_linha x where x.cc_id = cc.id::text and x.codigo in ('FDIR','FAPOIO'))
   and exists (select 1 from ccs_linha x where x.codigo = 'FDIR' and x.cc_id is not null)
 order by 1, 2;
