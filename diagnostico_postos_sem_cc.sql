-- ============================================================
-- Quais POSTOS produziram orçado sem centro de custo
--
-- ⚠ A versão anterior deste arquivo estava errada e devolvia ~200 linhas de
-- ruído: eu listei postos sem CC **OU** sem regra de rateio, quando o que
-- produz nulo é sem CC **E** sem destino de rateio com CC. Posto com CC
-- próprio e sem rateio está correto — o motor usa o CC dele.
--
-- Esta versão não adivinha pelo cadastro: vai pelo que o motor REALMENTE
-- gravou. `fat_folha` tipo ORCADO é a abertura por posto que o Aplicar escreve
-- junto com o fato, e nela o `cc_id` nulo é o próprio sintoma.
--
-- As duas causas possíveis aparecem separadas, porque o conserto difere:
--   · posto sem CC e sem rateio      → preencher o CC no cadastro do posto
--   · rateio com destino sem CC      → corrigir a regra em Postos → Rateio
--
-- Sem nome de ninguém: posto, matrícula, cargo e filial bastam para achar na
-- tela, e resultado de diagnóstico costuma ser colado em conversa.
--
-- Só leitura. Uma consulta só.
-- ============================================================
with v as (
  select id, codigo from versao_orcamento where codigo = 'Orçado2027'   -- ajuste aqui
),
culpados as (
  select g.posto_id, round(sum(g.valor), 2) as valor, count(*) as lancamentos
    from fat_folha g
    join v on v.id = g.versao_id
   where g.tipo = 'ORCADO' and g.cc_id is null
   group by g.posto_id
)
select e.codigo                              as empresa,
       coalesce(f.codigo, '(sem filial)')    as filial,
       p.codigo                              as posto,
       coalesce(p.matricula, '—')            as matricula,
       coalesce(c.nome, '—')                 as cargo,
       coalesce(p.regime, '—')               as regime,
       to_char(cu.valor, 'FM999G999G990D00') as valor_sem_cc,
       cu.lancamentos                        as lanc,
       case
         when p.cc_id is null and not exists (select 1 from posto_rateio pr where pr.posto_id = p.id)
              then '① posto sem CC e sem rateio → preencher o CC no posto'
         when exists (select 1 from posto_rateio pr
                        join rateio_destino rd on rd.regra_id = pr.regra_id
                       where pr.posto_id = p.id and rd.cc_id is null)
              then '② regra de rateio com destino SEM CC → corrigir a regra'
         when p.cc_id is null
              then '① posto sem CC (tem rateio, mas não resolveu) → preencher o CC'
         else '③ nem uma nem outra — investigar à parte'
       end                                   as causa
  from culpados cu
  join posto p              on p.id = cu.posto_id
  join empresa e            on e.id = p.empresa_id
  left join filial f        on f.id = p.filial_id
  left join cargo c         on c.id = p.cargo_id
 order by abs(cu.valor) desc;
