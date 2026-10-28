-- ============================================================
-- Onde dois cenários do formulário realmente diferem
--
-- Compara o `formulario_valor` de DUAS versões, célula a célula, e resume por
-- driver. Serve para responder "mudei só a meta?" — que é a pergunta quando o
-- comparativo mostra diferença em meses onde a meta não pode chegar.
--
-- LEMBRE DO RELÓGIO: a `META` de um mês só vira receita DOIS meses depois
-- (`ANTERIOR([META],2)`). Então uma mudança de meta NÃO pode alterar janeiro
-- nem fevereiro — a receita desses dois vem do `METADEZ`. Se o comparativo
-- acusar diferença lá, mudou outra coisa.
--
-- Ajuste os dois códigos de versão. UMA consulta só.
-- ============================================================

with va as (select id from versao_orcamento where codigo = 'Orçado2027'),     -- <<< cenário A
     vb as (select id from versao_orcamento where codigo = 'Orçado2027_B'),   -- <<< cenário B
f as (
  select id from formulario
   where nome ilike '%recorrente%' and nome not ilike '%não recorrente%'
),
cel as (
  select l.codigo as driver, v.mes,
         coalesce(e.codigo,'?') || '·' || coalesce(fi.codigo,'—') || '·' || coalesce(cc.codigo,'—') as escopo,
         sum(case when v.versao_id = (select id from va) then v.valor end) as a,
         sum(case when v.versao_id = (select id from vb) then v.valor end) as b
    from formulario_valor v
    join formulario_linha l on l.id = v.linha_id
    left join empresa e       on e.id  = v.empresa_id
    left join filial fi       on fi.id = v.filial_id
    left join centro_custo cc on cc.id = v.cc_id
   where v.formulario_id = (select id from f)
     and v.versao_id in ((select id from va), (select id from vb))
     and v.ano = 2027
   group by 1, 2, 3
)
select driver,
       count(*) filter (where coalesce(a,0) <> coalesce(b,0)) as celulas_diferentes,
       count(*)                                               as celulas,
       round(sum(coalesce(b,0) - coalesce(a,0)), 2)           as delta_total,
       -- onde a diferença começa diz MUITO: driver que difere em jan/fev não
       -- pode ser `META`, porque a meta só chega na receita em M+2
       min(mes) filter (where coalesce(a,0) <> coalesce(b,0)) as 1o_mes_diferente,
       string_agg(distinct escopo, ', ' order by escopo)
         filter (where coalesce(a,0) <> coalesce(b,0))        as escopos_afetados
  from cel
 group by driver
having count(*) filter (where coalesce(a,0) <> coalesce(b,0)) > 0
 order by abs(sum(coalesce(b,0) - coalesce(a,0))) desc;
