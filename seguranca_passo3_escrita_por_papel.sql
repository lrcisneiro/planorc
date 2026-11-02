-- ============================================================
-- PASSO 3 — Onde o `viewer` ainda escreve pela API
--
-- O v3_130 protegeu a escrita em SEIS tabelas (os fatos + posto), exigindo
-- `pode_escrever()`. As demais continuam com a política original: `FOR ALL`
-- apenas por tenant. Como `authenticated` tem `GRANT ALL`, um `viewer`
-- autenticado pode alterá-las pela API REST — a tela o barra pelas
-- capacidades, a API não.
--
-- Isto NÃO é dano de leitura: catálogo e estrutura não contêm remuneração. É
-- dano de INTEGRIDADE — apagar um centro de custo, renomear uma conta, mexer
-- numa regra de rateio, alterar a árvore do relatório. Em sistema de
-- orçamento, estrutura errada vale tanto quanto número errado.
--
-- Esta consulta separa o que está protegido do que não está, e ordena pelo que
-- doeria mais. Sempre devolve linha.
--
-- Só leitura.
-- ============================================================
with pol as (
  select c.relname as tabela,
         count(*) FILTER (WHERE p.polcmd = '*')                          as for_all,
         count(*) FILTER (WHERE p.polcmd IN ('a','w','d'))               as por_comando,
         bool_or(coalesce(pg_get_expr(p.polqual, p.polrelid), '')        ilike '%pode_escrever%'
              or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')   ilike '%pode_escrever%') as checa_papel,
         count(*)                                                        as politicas
    from pg_class c
    left join pg_policy p on p.polrelid = c.oid
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r' and c.relrowsecurity
   group by c.relname
),
grant_w as (
  select table_name as tabela, true as escreve
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and privilege_type in ('INSERT','UPDATE','DELETE')
   group by table_name
)
select case when p.checa_papel then '1 · PROTEGIDO — escrita exige papel'
            else '2 · ABERTO ao viewer pela API' end                     as secao,
       p.tabela                                                           as a,
       case when g.escreve then 'authenticated tem INSERT/UPDATE/DELETE' else 'sem grant de escrita' end as b,
       p.politicas || ' política(s)' ||
         case when p.for_all > 0 then ' · ' || p.for_all || ' FOR ALL' else '' end as c,
       case when p.checa_papel then '✓' else '⚠' end                      as d,
       case
         when p.checa_papel then 'ok'
         when not coalesce(g.escreve, false) then 'sem grant — API não alcança'
         when p.tabela in ('centro_custo','empresa','filial','versao_orcamento')
              then '⚠ CATÁLOGO: apagar aqui quebra fato por chave estrangeira'
         when p.tabela in ('relatorio','relatorio_linha','conta_linha','conta_orcamentaria')
              then '⚠ ESTRUTURA: muda a DRE de todo mundo'
         when p.tabela in ('posto_rateio','posto_verba','rateio_regra','rateio_destino','verba_folha')
              then '⚠ MOTOR DA FOLHA: muda o custo calculado'
         when p.tabela like 'user_%' then '⚠ ACESSO: conferir política própria'
         else 'avaliar'
       end                                                                as e
  from pol p left join grant_w g on g.tabela = p.tabela
 order by 1, 5 desc, 2;
