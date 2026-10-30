-- ============================================================
-- Quanto do exterior entra na DRE — e em que linha
--
-- O que o diagnóstico anterior estabeleceu: o razão do Paraguai está EM
-- GUARANI, e isso é o normal dele. A prova está no próprio cadastro — a conta
-- `01010120 BANCO ITAU GUARANI` tem um lançamento de 149.972.690,71, e
-- `02010101 PROVEEDORES LOCALES` soma −14,1 milhões em 1.368 lançamentos.
-- Valor em guarani não é defeito de carga; é a moeda do livro.
--
-- Então a pergunta deixou de ser "qual lançamento escapou da conversão" e
-- passou a ser: QUAIS contas do exterior estão amarradas na DRE? Só essas
-- podem distorcer o resultado consolidado. A `1304` vazou porque é conta de
-- RESULTADO e está amarrada; as de banco e fornecedor são de balanço e a DRE
-- nem as lê — é por isso que o estrago apareceu só no Resultado Financeiro.
--
-- Caminho da amarração (o mesmo da wizard_realizado_por_conta, v3_126):
--   fat_realizado.conta_id → conta_linha.linha_id → conta_orcamentaria (master)
--   → relatorio_linha.linha_orc_id → a linha que a pessoa vê na DRE
--
-- Sem filtro de tenant de propósito: no SQL Editor o current_tenant_id() é
-- NULL e qualquer filtro por ele devolve VAZIO, que se lê como "nada aqui".
--
-- Só leitura. Uma consulta só.
-- ============================================================
with ext as (   -- contas dos planos do exterior com movimento em 2026
  select cco.id, cco.codigo, cco.descricao, pc.nome as plano,
         count(*)                      as lancamentos,
         round(sum(fr.valor), 2)       as soma,
         round(max(abs(fr.valor)), 2)  as maior
    from fat_realizado fr
    join conta_contabil cco   on cco.id = fr.conta_id
    join plano_contas pc      on pc.id  = cco.plano_id
   where fr.ano = 2026
     and pc.nome not ilike '%protheus top%'   -- o que não é o plano brasileiro
   group by 1,2,3,4
),
amarrada as (   -- a amarração vigente: a MAIS RECENTE, como faz o agregado
  select e.*, cl.linha_id as master, cl.sinal
    from ext e
    join lateral (
      select c.linha_id, c.sinal from conta_linha c
       where c.conta_id = e.id order by c.id desc limit 1
    ) cl on true
)
-- 1 · o que ENTRA na DRE: estas são as que podem distorcer o consolidado
select '1 · exterior AMARRADO (entra na DRE)' as secao,
       a.plano || ' · ' || a.codigo           as a,
       a.descricao                            as b,
       co.codigo || ' ' || co.descricao       as c,
       to_char(a.soma * a.sinal, 'FM999G999G990D00') as d,
       a.lancamentos || ' lanç. · maior ' || to_char(a.maior, 'FM999G999G990D00')
         || case when a.sinal = -1 then ' · sinal invertido' else '' end as e
  from amarrada a
  join conta_orcamentaria co on co.id = a.master
union all
-- 2 · em QUE LINHA de qual relatório esse master aparece
select '2 · a linha que exibe o master', co.codigo, co.descricao,
       r.nome, rl.codigo || ' ' || rl.descricao, rl.tipo_linha
  from amarrada a
  join conta_orcamentaria co on co.id = a.master
  join relatorio_linha rl    on rl.linha_orc_id = a.master
  join relatorio r           on r.id = rl.relatorio_id
union all
-- 3 · movimento do exterior que a DRE NÃO vê (sem amarração)
-- Não é problema por si — balanço não entra na DRE. Serve para dimensionar o
-- que ficaria de fora se um dia o consolidado passar a ler estas contas.
select '3 · exterior SEM amarração (fora da DRE)',
       e.plano || ' · ' || e.codigo, e.descricao, '—',
       to_char(e.soma, 'FM999G999G990D00'),
       e.lancamentos || ' lanç. · maior ' || to_char(e.maior, 'FM999G999G990D00')
  from ext e
 where not exists (select 1 from conta_linha c where c.conta_id = e.id)
 order by 1, 5 desc;
