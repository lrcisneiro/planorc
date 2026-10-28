-- ============================================================
-- Contexto para o estudo do baseline (Claude Desktop) — ESCOPOS REAIS
--
-- A versão anterior desta consulta fazia CROSS JOIN de empresa × filial × CC,
-- e devolvia o universo TEÓRICO: centenas de combinações que não existem.
-- A lista que interessa é onde a receita recorrente REALMENTE cai, e ela sai
-- do realizado — que, de quebra, é o próprio baseline a calibrar.
--
-- Caminho do realizado até a conta orçamentária: fat_realizado.conta_id →
-- conta_linha → conta_orcamentaria. O `fat_realizado.linha_id` é nullable e
-- quase sempre nulo (v3_010), por isso NÃO se usa ele.
--
-- UMA consulta só. Ajuste o ANO e o código da conta se precisar.
-- ============================================================

with real_rec as (
  select fr.empresa_id, fr.filial_id, fr.cc_id, fr.mes, fr.valor
    from fat_realizado fr
    join conta_linha cl        on cl.conta_id = fr.conta_id
    join conta_orcamentaria co on co.id = cl.linha_id
   where co.codigo = '10201'        -- <<< Receita Recorrente
     and fr.ano = 2026              -- <<< ano do baseline
), por_mes as (
  -- um valor por escopo × mês ANTES de montar a linha, senão o string_agg
  -- repetiria o mês tantas vezes quantos lançamentos houver nele
  select empresa_id, filial_id, cc_id, mes, sum(valor) as v
    from real_rec group by 1, 2, 3, 4
)
select e.codigo                                  as empresa,
       e.descricao                               as empresa_nome,
       coalesce(fi.codigo, '(sem filial)')       as filial,
       coalesce(fi.descricao, '—')               as filial_nome,
       coalesce(cc.codigo, '(sem cc)')           as cc,
       coalesce(cc.descricao, '—')               as cc_nome,
       coalesce(cc.bu_cod || ' · ' || cc.bu_nome, '—') as bu,
       case when cc.descricao ilike '%novo%' then 'NOVOS'
            when cc.descricao ilike '%base%' then 'BASE' else '?' end as classe,
       count(*)                                  as n_meses,
       min(m.mes)                                as mes_ini,
       max(m.mes)                                as mes_fim,
       round(sum(m.v), 2)                        as total_ano,
       -- O BASE do orçamento é o estoque no FIM do histórico, não a média do
       -- ano: carteira que migrou de filial no meio de 2026 tem média sem
       -- sentido e último mês correto.
       round(max(m.v) filter (where m.mes = (select max(mes) from por_mes p2
             where p2.empresa_id is not distinct from m.empresa_id
               and p2.filial_id  is not distinct from m.filial_id
               and p2.cc_id      is not distinct from m.cc_id)), 2) as ultimo_valor,
       -- mês=valor, COM o mês e COM o sinal (negativo = estorno/transferência)
       string_agg(m.mes || '=' || to_char(m.v, 'FM999G999G990D00'), ' · ' order by m.mes) as por_mes
  from por_mes m
  join empresa e            on e.id  = m.empresa_id
  left join filial fi       on fi.id = m.filial_id
  left join centro_custo cc on cc.id = m.cc_id
 group by m.empresa_id, m.filial_id, m.cc_id, e.codigo, e.descricao, fi.codigo, fi.descricao,
          cc.codigo, cc.descricao, cc.bu_cod, cc.bu_nome
 order by e.codigo, filial, cc;
