-- ============================================================
-- As empresas XX e BO recebem lançamento de DUAS origens
--
--   (a) razão do próprio país  -> conta do plano PYTOP/BOTOP, moeda USD
--   (b) razão BRASILEIRO       -> linhas que o item contábil reclassifica
--                                 para XX/BO; conta do plano BRTOP, moeda BRL
--
-- O modo Substituir apaga por (ano, mes, empresa) e não distingue as duas.
-- Reimportar o PY em Substituir apaga junto o que veio do razão brasileiro.
--
-- Só leitura. A pergunta: ainda existe (b)?
-- ============================================================

select
  e.codigo                                   as empresa,
  pc.codigo                                  as plano_da_conta,
  case f.moeda_origem when 1 then 'BRL' when 2 then 'USD' else '?' end as moeda,
  case when pc.codigo = 'BRTOP' then 'veio do razão BRASILEIRO'
       else 'veio do razão local' end        as origem,
  count(*)                                   as linhas,
  min(f.ano || '-' || lpad(f.mes::text,2,'0')) as de,
  max(f.ano || '-' || lpad(f.mes::text,2,'0')) as ate,
  round(sum(f.valor), 2)                     as total_brl
from fat_realizado f
join empresa e          on e.id = f.empresa_id
join conta_contabil cc  on cc.id = f.conta_id
join plano_contas pc    on pc.id = cc.plano_id
where e.codigo in ('XX','BO')
group by e.codigo, pc.codigo, f.moeda_origem
order by e.codigo, pc.codigo;

-- Esperado se nada se perdeu:
--   XX | PYTOP | USD | razão local      | 6.809
--   XX | BRTOP | BRL | razão BRASILEIRO | ~467 por ano   <- se esta linha sumiu, foi o Substituir
--   BO | BRTOP | BRL | razão BRASILEIRO | 10
