-- ============================================================
-- PASSO 2.0 — Raio-X antes de escrever qualquer política
-- Requisito: ACS-02 (escopo de dados aplicado só no frontend)
--
-- POR QUE ESTE PASSO EXISTE
--
-- O passo 1 conferiu as tabelas de CONTROLE (`user_tenant`,
-- `user_acesso_regra`, `user_acesso_funcao`) e o resultado foi bom. Este olha
-- as tabelas de DADOS — é nelas que o escopo precisa passar a valer.
--
-- Decisão do Ricardo em 02/nov: entram diretores que NÃO podem ver o centro de
-- custo da Diretoria. Isso tira `fat_folha` da condição de alvo único: se o CC
-- da Diretoria tem de sumir, a restrição vale também em `fat_orcado`,
-- `fat_realizado`, `fat_saldo` e `posto` — senão o custo dela reaparece na DRE
-- pela porta do orçado ou do razão.
--
-- Só leitura. As quatro partes podem rodar de uma vez; o editor mostra só o
-- resultado da ÚLTIMA, então cada uma vira uma seção da mesma consulta.
-- ============================================================
with alvo(tabela) as (
  values ('fat_orcado'), ('fat_realizado'), ('fat_saldo'), ('fat_folha'),
         ('posto'), ('posto_rateio'), ('posto_verba'), ('fat_apontamento'),
         ('centro_custo'), ('empresa'), ('filial'), ('versao_orcamento'), ('relatorio')
),
rls as (
  select a.tabela,
         c.oid is not null                         as existe,
         coalesce(c.relrowsecurity, false)          as rls_ligado,
         coalesce(c.relforcerowsecurity, false)     as rls_forcado,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as politicas
    from alvo a
    left join pg_class c on c.relname = a.tabela and c.relnamespace = 'public'::regnamespace
),
-- O GRANT é o que decide se a API REST sequer alcança a tabela. RLS ligado com
-- GRANT para `anon` é menos grave que RLS DESLIGADO com GRANT — sem RLS, a
-- policy não existe e o GRANT libera tudo.
grants as (
  select a.tabela,
         string_agg(distinct g.grantee || ':' || g.privilege_type, ', ' order by g.grantee || ':' || g.privilege_type) as concedido
    from alvo a
    join information_schema.role_table_grants g
      on g.table_name = a.tabela and g.table_schema = 'public'
     and g.grantee in ('anon', 'authenticated')
   group by a.tabela
)
select '1 · RLS e políticas por tabela'          as secao,
       r.tabela                                   as a,
       case when not r.existe then '⚠ TABELA NÃO EXISTE'
            when not r.rls_ligado then '⛔ RLS DESLIGADO'
            else '✓ RLS ligado' || case when r.rls_forcado then ' (forçado)' else '' end end as b,
       r.politicas || ' política(s)'              as c,
       coalesce(g.concedido, '(sem grant p/ anon/authenticated)') as d,
       case when r.rls_ligado and r.politicas = 0 then '⚠ ligado SEM política = nega tudo'
            else '' end                           as e
  from rls r left join grants g on g.tabela = r.tabela
union all
-- Aqui está o ACS-02 em uma linha: se toda policy de um fato só menciona
-- tenant_id, o escopo por CC não existe no banco.
select '2 · o que cada política filtra',
       c.relname,
       p.polname,
       case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                     when 'd' then 'DELETE' else 'ALL' end,
       case when pg_get_expr(p.polqual, p.polrelid) ilike '%cc_id%' then '✓ menciona cc_id'
            when pg_get_expr(p.polqual, p.polrelid) ilike '%tenant%' then '⚠ só tenant'
            else '?' end,
       left(coalesce(pg_get_expr(p.polqual, p.polrelid), '(sem USING)'), 120)
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
 where c.relname in (select tabela from alvo)
union all
-- ⚠ NEM TODO FATO TEM cc_id. `fat_saldo` não tem: o balancete é por conta,
-- empresa, filial, ano e mês — o CLAUDE.md já dizia, e eu presumi o contrário.
-- Consequência de desenho: o **Balanço não pode ser recortado por centro de
-- custo**, só por empresa/filial. Para o caso da Diretoria isso é aceitável
-- (balanço é patrimonial, não custo por CC), mas tem de ser dito.
--
-- Esta seção pergunta ao CATÁLOGO quem tem a coluna, em vez de eu listar de
-- memória — foi exatamente assim que este arquivo quebrou na primeira tentativa.
select '3a · quais tabelas têm cc_id',
       c.table_name, c.column_name,
       case when c.is_nullable = 'YES' then 'anulável' else 'NOT NULL' end,
       '', ''
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.column_name in ('cc_id', 'empresa_id', 'filial_id')
   and c.table_name in (select tabela from alvo)
union all
-- Contagem só nas que eu CONFERI que têm a coluna. Se a seção 3a mostrar outra
-- tabela com cc_id anulável, ela precisa entrar aqui.
select '3b · linhas e nulos (armadilha do NULL)',
       t.tabela, '', t.linhas::text, t.cc_nulo::text || ' com cc_id NULO',
       case when t.cc_nulo > 0 then '⚠ a policy precisa tratar NULL explicitamente' else '' end
  from (
    select 'fat_orcado' as tabela, count(*) as linhas, count(*) filter (where cc_id is null) as cc_nulo from fat_orcado
    union all select 'fat_realizado', count(*), count(*) filter (where cc_id is null) from fat_realizado
    union all select 'fat_folha', count(*), count(*) filter (where cc_id is null) from fat_folha
    union all select 'posto', count(*), count(*) filter (where cc_id is null) from posto
  ) t
union all
-- Índice é o que decide se a policy custa caro: a comparação do escopo vira
-- predicado em TODA consulta, inclusive nos agregados pesados.
select '4 · índices que a policy vai usar',
       tablename, indexname, '', '',
       left(indexdef, 110)
  from pg_indexes
 where schemaname = 'public'
   and tablename in (select tabela from alvo)
   and (indexdef ilike '%cc_id%' or indexdef ilike '%empresa_id%')
 order by 1, 2, 3;
