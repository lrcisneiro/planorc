-- ============================================================
-- É SÓ um lançamento, ou o plano de contas inteiro do Paraguai veio em guarani?
--
-- O que já se sabe: empresa XX (PARAGUAI), lote 008850, importado 19/out.
-- A conta 1304 tem 1 lançamento de 12.857.665,55; a 0805, de mesmo nome, tem
-- 87 somando 67 mil. A razão entre os maiores de cada uma é ~1.173 — a faixa
-- do guarani por real. Ou seja: a 0805 está convertida e a 1304 não.
--
-- Se isso valer para TODO o plano em que a 1304 vive, o problema é muito maior
-- que o Resultado Financeiro — qualquer linha da DRE que use contas desse
-- plano estaria mil vezes inflada.
--
-- As três seções respondem: a que plano cada conta pertence, qual a ordem de
-- grandeza de cada plano, e quais contas do exterior passam de R$ 100 mil
-- (candidatas a não-convertidas).
--
-- Só leitura. Uma consulta só.
-- ============================================================
with mov as (
  select coalesce(pc.nome, '(sem plano)')         as plano,
         cco.codigo                                as conta,
         cco.descricao                             as conta_nome,
         e.codigo                                  as empresa,
         count(*)                                  as lancamentos,
         round(sum(fr.valor), 2)                   as soma,
         round(max(abs(fr.valor)), 2)              as maior
    from fat_realizado fr
    join conta_contabil cco  on cco.id = fr.conta_id
    left join plano_contas pc on pc.id = cco.plano_id
    join empresa e            on e.id = fr.empresa_id
   where fr.ano = 2026
   group by 1,2,3,4
)
select '1 · por plano de contas' as secao,
       plano as a, '' as b,
       count(*)::text || ' conta(s)' as c,
       to_char(sum(soma), 'FM999G999G990D00') as d,
       'maior lançamento: ' || to_char(max(maior), 'FM999G999G990D00') as e
  from mov group by plano
union all
select '2 · as duas contas de câmbio', conta, conta_nome, plano,
       to_char(soma, 'FM999G999G990D00'),
       lancamentos || ' lanç. · maior ' || to_char(maior, 'FM999G999G990D00')
  from mov where conta in ('1304', '0805')
union all
-- no exterior, lançamento acima de 100 mil é suspeito: a operação é pequena
select '3 · exterior com lançamento > 100 mil', conta, conta_nome, plano,
       to_char(soma, 'FM999G999G990D00'),
       '⚠ maior lançamento ' || to_char(maior, 'FM999G999G990D00')
  from mov
 where empresa in ('XX', 'BO', '01', '0101', 'BO01') and maior > 100000
 order by 1, 5 desc;
