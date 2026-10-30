-- ============================================================
-- Resultado Financeiro realizado de 2026 veio +12,3 mi contra −0,7 mi orçado.
-- O EBITDA ficou 23% ABAIXO do orçado (coerente com o que aconteceu), então a
-- suspeita é de SINAL: se as despesas financeiras (302) entram positivas, elas
-- somam em vez de subtrair e o resultado inverte.
--
-- O realizado chega por `conta_linha`, que tem a coluna `sinal`. Dois lugares
-- onde pode quebrar:
--   1. o razão grava a despesa com sinal trocado;
--   2. a amarração usa sinal +1 onde devia ser −1.
-- A consulta mostra os dois lados: a soma CRUA do razão e a soma COM o sinal,
-- conta a conta.
--
-- ⚠ Ajuste o ANO se precisar. Só leitura. Uma consulta só.
-- ============================================================
with alvo as (   -- as contas orçamentárias sob Receitas/Despesas Financeiras
  select co.id, co.codigo, co.descricao, co.natureza
    from conta_orcamentaria co
   where co.codigo like '301%' or co.codigo like '302%' or co.codigo in ('301','302')
),
mov as (
  select a.codigo       as conta_orc,
         a.descricao    as conta_orc_nome,
         cc.codigo      as conta_contabil,
         cc.descricao   as conta_contabil_nome,
         cl.sinal,
         count(*)                        as lancamentos,
         round(sum(fr.valor), 2)         as soma_crua,
         round(sum(fr.valor * cl.sinal), 2) as soma_com_sinal
    from fat_realizado fr
    join conta_linha cl        on cl.conta_id = fr.conta_id
    join alvo a                on a.id = cl.linha_id
    join conta_contabil cc     on cc.id = fr.conta_id
   where fr.ano = 2026
   group by 1,2,3,4,5
)
select case
         when conta_orc like '302%' and soma_com_sinal > 0
              then '⚠ DESPESA financeira entrando POSITIVA — soma em vez de subtrair'
         when conta_orc like '301%' and soma_com_sinal < 0
              then '⚠ RECEITA financeira entrando NEGATIVA'
         else '✓'
       end                       as alerta,
       conta_orc, conta_orc_nome, conta_contabil, conta_contabil_nome,
       sinal, lancamentos,
       to_char(soma_crua,      'FM999G999G990D00') as soma_no_razao,
       to_char(soma_com_sinal, 'FM999G999G990D00') as soma_com_sinal
  from mov
 order by (case when conta_orc like '302%' and soma_com_sinal > 0 then 0
                when conta_orc like '301%' and soma_com_sinal < 0 then 0 else 1 end),
          abs(soma_com_sinal) desc;
