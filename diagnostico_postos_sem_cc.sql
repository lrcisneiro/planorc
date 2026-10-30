-- ============================================================
-- Quais POSTOS geram o orçado sem centro de custo
--
-- O diagnóstico anterior fechou a origem: os 3,57 mi "Sem CC" vêm inteiros do
-- motor da folha (`origem = POSTO`), em três contas — Terceiros Internos,
-- Salários e Encargos — e quatro filiais.
--
-- O Aplicar grava o CC de DESTINO do rateio; sem regra de rateio, cai no CC do
-- próprio posto; sem nenhum dos dois, grava NULO. Então o conserto é no
-- cadastro do posto, não no orçado — reaplicar depois de corrigir resolve.
--
-- Sem nome de ninguém de propósito: código do posto, matrícula, cargo e filial
-- bastam para achar cada um na tela de Postos, e este resultado costuma ser
-- colado em conversa.
--
-- Só leitura. Uma consulta só.
-- ============================================================
select e.codigo                                   as empresa,
       coalesce(f.codigo, '(sem filial)')         as filial,
       p.codigo                                   as posto,
       coalesce(p.matricula, '—')                 as matricula,
       coalesce(c.nome, '—')                      as cargo,
       coalesce(p.regime, '—')                    as regime,
       case when p.cc_id is null then '⚠ posto SEM centro de custo' else cc.codigo || ' · ' || cc.descricao end as centro_custo,
       case when exists (select 1 from posto_rateio pr where pr.posto_id = p.id)
            then 'tem regra de rateio — conferir se os destinos têm CC'
            else '⚠ sem regra de rateio' end      as rateio,
       coalesce(p.ini_ano::text, '—') || '/' || coalesce(lpad(p.ini_mes::text, 2, '0'), '--') ||
       ' → ' || coalesce(p.fim_ano::text, 'aberto')                                  as vigencia
  from posto p
  join empresa e            on e.id = p.empresa_id
  left join filial f        on f.id = p.filial_id
  left join centro_custo cc on cc.id = p.cc_id
  left join cargo c         on c.id = p.cargo_id
 where p.cc_id is null
    or not exists (
         select 1 from posto_rateio pr
           join rateio_destino rd on rd.regra_id = pr.regra_id
          where pr.posto_id = p.id and rd.cc_id is not null)
 order by e.codigo, f.codigo, p.codigo;
