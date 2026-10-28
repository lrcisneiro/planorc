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
), no_escopo as (
  -- Recorta o universo do estudo: as 6 empresas e os 10 CCs (5 BUs × Base/Novos).
  -- A FILIAL fica de fora do filtro DE PROPÓSITO: a empresa 25 migrou da 2101
  -- para a 2501 no meio de 2026, e sem o histórico das duas o estudo teria 4
  -- meses para calibrar o churn de uma operação de 1,3 mi. As linhas em filiais
  -- antigas (2002, 2003, 2005, 2006) também carregam os pares de transferência
  -- da cisão da 25 — o prompt manda ignorá-los, mas é preciso vê-los.
  select r.*
    from real_rec r
    join empresa e        on e.id  = r.empresa_id
    left join centro_custo cc on cc.id = r.cc_id
   where e.codigo in ('01', '05', '06', '25', 'YY', 'ZZ')
     and cc.codigo in ('211','212','214','215','216','221','222','224','225','226')
), por_mes as (
  -- um valor por escopo × mês ANTES de montar a linha, senão o string_agg
  -- repetiria o mês tantas vezes quantos lançamentos houver nele
  select empresa_id, filial_id, cc_id, mes, sum(valor) as v
    from no_escopo group by 1, 2, 3, 4
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
