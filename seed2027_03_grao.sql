-- ============================================================
-- SEED 2027 · passo 3 — o mesmo histórico, no grão empresa · filial · CC
--
-- A planilha de fatores (seed2027_plano.xlsx) é por MASTER, porque o fator é
-- decisão humana. O que é gravado precisa ser granular: cada combinação recebe
-- a SUA média, e o fator do master multiplica todas. Assim a distribuição entre
-- CCs de 2026 é preservada, em vez de ser rateada por cima.
--
-- Mesmas exclusões do passo 2: folha (20101/20201/20301) e lotes ignorados.
-- Outubro entra como coluna mas NÃO deve ser usado em média — o mês não fechou.
--
-- Rode a PARTE 1 primeiro para ver o tamanho. Se passar de alguns milhares de
-- linhas, melhor eu trabalhar direto do CSV.
-- ============================================================

-- ─────────── PARTE 1 · quantas combinações existem ───────────
select
  count(*)                                                  as combinacoes,
  count(distinct co.id)                                     as masters,
  count(distinct m.empresa_id)                              as empresas,
  count(distinct m.filial_id)                               as filiais,
  count(distinct m.cc_id)                                   as ccs,
  count(*) filter (where m.cc_id is null)                   as sem_cc
from (
  select distinct cl.linha_id, m.empresa_id, m.filial_id, m.cc_id
    from fat_realizado m
    join conta_linha cl        on cl.conta_id = m.conta_id
    join conta_orcamentaria co on co.id = cl.linha_id
   where m.ano = 2026 and co.natureza = 'DESPESA'
     and co.codigo not in ('20101','20201','20301')
) m
join conta_orcamentaria co on co.id = m.linha_id;


-- ─────────── PARTE 2 · o histórico no grão (exportar como CSV) ───────────
-- Salve como `seed2027_grao.csv` na pasta do projeto.
with mov as (
  select
    co.codigo                            as master,
    co.descricao                         as master_desc,
    e.codigo                             as empresa,
    coalesce(f.codigo, '(sem filial)')   as filial,
    coalesce(c.codigo, '(sem cc)')       as cc,
    coalesce(c.descricao, '')            as cc_desc,
    m.mes,
    sum(m.valor * coalesce(cl.sinal, 1)) as valor
  from fat_realizado m
  join conta_linha cl        on cl.conta_id = m.conta_id
  join conta_orcamentaria co on co.id = cl.linha_id
  join empresa e             on e.id = m.empresa_id
  left join filial f         on f.id = m.filial_id
  left join centro_custo c   on c.id = m.cc_id
  where m.ano = 2026
    and co.natureza = 'DESPESA'
    and co.codigo not in ('20101','20201','20301')
    and not exists (
      select 1 from lote_ignorado li
       where li.ativo
         and (li.por_prefixo
              and upper(replace(m.lote,' ','')) like upper(replace(li.lote,' ','')) || '%'
              or upper(replace(li.lote,' ','')) = upper(replace(m.lote,' ','')))
         and (li.sublote is null or li.sublote = '' or li.sublote = m.sublote)
         and (li.empresa_id is null or li.empresa_id = m.empresa_id)
    )
  group by co.codigo, co.descricao, e.codigo, f.codigo, c.codigo, c.descricao, m.mes
)
select
  master, master_desc, empresa, filial, cc, cc_desc,
  round(sum(valor) filter (where mes = 1), 2)  as jan,
  round(sum(valor) filter (where mes = 2), 2)  as fev,
  round(sum(valor) filter (where mes = 3), 2)  as mar,
  round(sum(valor) filter (where mes = 4), 2)  as abr,
  round(sum(valor) filter (where mes = 5), 2)  as mai,
  round(sum(valor) filter (where mes = 6), 2)  as jun,
  round(sum(valor) filter (where mes = 7), 2)  as jul,
  round(sum(valor) filter (where mes = 8), 2)  as ago,
  round(sum(valor) filter (where mes = 9), 2)  as set,
  round(sum(valor) filter (where mes = 10), 2) as out_incompleto,
  round(sum(valor) filter (where mes <= 9), 2) as total_jan_set,
  count(*) filter (where mes <= 9 and valor <> 0) as meses_com_mov
from mov
group by master, master_desc, empresa, filial, cc, cc_desc
order by master, abs(sum(valor)) desc;
