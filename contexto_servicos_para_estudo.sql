-- ============================================================
-- Realizado 2026 de RECEITA DE SERVIÇOS — por empresa · filial · CC · TIPO.
--
-- Irmã da contexto_formulario_para_estudo.sql, que extrai a receita
-- RECORRENTE (conta 10201). Aqui são as contas da família 110 — serviços —,
-- e a diferença importante é que elas são VÁRIAS: 11001 Horas Abertas, 11002
-- Projetos Fechados, 11003 OutSourcing, 11004 Banco de Horas, 11005 Templates,
-- 11006 Sustentação, 11007 Templates Adesão, 11008 Assessoria MKT, 11009 Horas
-- Bolívia, 11011 Template Recorrência, 11020 Reembolso por NF.
--
-- A quebra por TIPO é o ponto: sustentação é estável mês a mês, projetos
-- fechados são irregulares e horas abertas seguem o calendário de férias. A
-- curva do total esconde um tipo crescendo enquanto outro encolhe.
--
-- ⚠ SEM FILTRO DE CENTRO DE CUSTO, de propósito. Na consulta do recorrente o
-- recorte pelos 10 CCs de BU fazia sentido porque sabíamos onde a receita cai.
-- Aqui NÃO sabemos em que CCs o serviço é lançado — filtrar pelo que se supõe
-- esconderia exatamente o que se quer descobrir. O resultado mostra os CCs
-- reais; o recorte vem depois, olhando.
--
-- Mesmo caminho do realizado até a conta orçamentária: fat_realizado.conta_id →
-- conta_linha → conta_orcamentaria (o fat_realizado.linha_id é nullable e quase
-- sempre nulo, por isso não se usa).
--
-- UMA consulta só. Só leitura.
-- ============================================================

with real_sv as (
  select fr.empresa_id, fr.filial_id, fr.cc_id, fr.mes, fr.valor,
         co.codigo as conta, co.descricao as conta_nome
    from fat_realizado fr
    join conta_linha cl        on cl.conta_id = fr.conta_id
    join conta_orcamentaria co on co.id = cl.linha_id
   where co.codigo like '110__'     -- <<< família de serviços (5 posições)
     and fr.ano = 2026              -- <<< ano do histórico
), por_mes as (
  -- um valor por escopo × tipo × mês ANTES do string_agg, senão o mês se
  -- repetiria tantas vezes quantos lançamentos houver nele
  select empresa_id, filial_id, cc_id, conta, conta_nome, mes, sum(valor) as v
    from real_sv group by 1, 2, 3, 4, 5, 6
)
select e.codigo                            as empresa,
       e.descricao                         as empresa_nome,
       coalesce(fi.codigo, '(sem filial)') as filial,
       coalesce(cc.codigo, '(sem cc)')     as cc,
       coalesce(cc.descricao, '—')         as cc_nome,
       m.conta,
       m.conta_nome                        as tipo_servico,
       count(*)                            as n_meses,
       min(m.mes)                          as mes_ini,
       max(m.mes)                          as mes_fim,
       round(sum(m.v), 2)                  as total_ano,
       round(avg(m.v), 2)                  as media_mes,
       -- média dos 3 últimos meses COM dado: base natural para projetar nov/dez
       round(avg(m.v) filter (where m.mes > (select max(mes) from por_mes) - 3), 2) as media_3m,
       -- mês=valor, com sinal (negativo = estorno ou reclassificação)
       string_agg(m.mes || '=' || to_char(m.v, 'FM999G999G990D00'), ' · ' order by m.mes) as por_mes
  from por_mes m
  join empresa e            on e.id  = m.empresa_id
  left join filial fi       on fi.id = m.filial_id
  left join centro_custo cc on cc.id = m.cc_id
 group by m.empresa_id, m.filial_id, m.cc_id, m.conta, m.conta_nome,
          e.codigo, e.descricao, fi.codigo, cc.codigo, cc.descricao
 order by e.codigo, filial, m.conta, cc;
