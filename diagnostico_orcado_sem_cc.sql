-- ============================================================
-- O que é o "Sem CC" do gráfico por centro de custo
--
-- É orçado gravado com `cc_id` NULO. A grade de Orçar permite lançar por
-- empresa/filial sem descer ao centro de custo, e a importação de baseline
-- aceita a coluna de CC vazia — então "Sem CC" não é defeito por si. Vira
-- problema quando esconde despesa que deveria ter dono.
--
-- Troque a versão no topo se quiser outro cenário.
--
-- Só leitura. Uma consulta só (o editor mostra o resultado do ÚLTIMO select).
-- ============================================================
with v as (
  select id, codigo, ano from versao_orcamento where codigo = 'Orçado2027'   -- ajuste aqui
),
sem as (
  select f.*, co.codigo as conta, co.descricao as conta_nome, co.natureza,
         e.codigo as empresa, fl.codigo as filial
    from fat_orcado f
    join v                      on v.id = f.versao_id
    join conta_orcamentaria co  on co.id = f.linha_id
    join empresa e              on e.id = f.empresa_id
    left join filial fl         on fl.id = f.filial_id
   where f.cc_id is null
)
select '1 · total sem CC'                      as secao,
       ''                                      as a,
       ''                                      as b,
       count(*)::text || ' lançamento(s)'      as c,
       to_char(sum(valor), 'FM999G999G990D00') as d,
       count(distinct linha_id) || ' conta(s) · ' || count(distinct empresa_id) || ' empresa(s)' as e
  from sem
union all
select '2 · por conta orçamentária', conta, conta_nome,
       coalesce(natureza, '—') || ' · ' || origem,
       to_char(sum(valor), 'FM999G999G990D00'),
       count(*) || ' lanç. · ' || count(distinct empresa_id) || ' empresa(s)'
  from sem group by conta, conta_nome, natureza, origem
union all
select '3 · por empresa e filial', empresa, coalesce(filial, '(sem filial)'), origem,
       to_char(sum(valor), 'FM999G999G990D00'), count(*) || ' lanç.'
  from sem group by empresa, filial, origem
union all
-- A origem é o que diz COMO entrou: MANUAL (digitado), FORMULARIO (aplicado de
-- um formulário de drivers), POSTO (motor da folha) ou IMPORT (baseline).
-- Saber isso decide onde corrigir — na tela, no formulário ou no arquivo.
select '4 · por origem', origem, '', '',
       to_char(sum(valor), 'FM999G999G990D00'), count(*) || ' lanç.'
  from sem group by origem
 order by 1, 5;
