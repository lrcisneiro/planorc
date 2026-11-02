-- ============================================================
-- As sete tabelas com RLS e ZERO política — estão vivas?
--
-- `dim_definition`, `dim_value`, `fat_lancamento_verba`, `map_conta_linha`,
-- `map_rubrica_verba`, `verba_orcamentaria`, `visao_plano`.
--
-- RLS ligado sem nenhuma política **nega tudo**: elas são inacessíveis pela API
-- hoje. Ninguém reclamou, o que sugere linhagem antiga — o protótipo
-- `plano_orcamentario`/`fat_lancamento` que o CLAUDE.md já marca como legado.
--
-- Mas "provavelmente morta" não é "morta". Esta consulta responde com fato:
-- tem linha? alguém referencia? Se vazia e sem dependente, é resíduo para
-- derrubar — e tabela morta no schema é pior que inútil, porque alguém vai
-- achar que serve para alguma coisa.
--
-- Só leitura. Sempre devolve linha.
-- ============================================================
with alvo(t) as (
  values ('dim_definition'), ('dim_value'), ('fat_lancamento_verba'),
         ('map_conta_linha'), ('map_rubrica_verba'), ('verba_orcamentaria'), ('visao_plano')
),
contagem as (
  select 'dim_definition' t, count(*) n from dim_definition
  union all select 'dim_value', count(*) from dim_value
  union all select 'fat_lancamento_verba', count(*) from fat_lancamento_verba
  union all select 'map_conta_linha', count(*) from map_conta_linha
  union all select 'map_rubrica_verba', count(*) from map_rubrica_verba
  union all select 'verba_orcamentaria', count(*) from verba_orcamentaria
  union all select 'visao_plano', count(*) from visao_plano
)
select c.t                                                      as tabela,
       c.n                                                      as linhas,
       (select count(*) from pg_constraint fk
         where fk.contype = 'f' and fk.confrelid = c.t::regclass) as quem_aponta_pra_ela,
       (select count(*) from pg_constraint fk
         where fk.contype = 'f' and fk.conrelid  = c.t::regclass) as pra_quem_ela_aponta,
       case when c.n = 0 and (select count(*) from pg_constraint fk
                               where fk.contype='f' and fk.confrelid = c.t::regclass) = 0
            then '✓ vazia e sem dependente → resíduo, pode derrubar'
            when c.n = 0 then '⚠ vazia, mas tem FK apontando — derrubar em ordem'
            else '⛔ TEM DADO (' || c.n || ') — inacessível pela API desde sempre; investigar antes' end as leitura
  from contagem c
 order by c.n desc, 1;
