-- ============================================================
-- URGENTE — as migrations "auto-provadas" sobreviveram?
--
-- O SQL Editor roda o script inteiro em UMA transação. Vimos isso duas vezes
-- hoje: o erro no `rateio_destino` desfez as conversões do v3_135, e o erro no
-- `visao_plano` desfez os seis DROP.
--
-- `RAISE EXCEPTION` é um erro como outro qualquer. Então toda migration que eu
-- terminei com um bloco de prova por exceção **desfez a si mesma** — a prova
-- rodou dentro da transação (por isso o resultado era correto) e o COMMIT nunca
-- aconteceu.
--
-- Suspeitos: v3_133 (IS NOT TRUE), v3_134 (escopo de versão), v3_136
-- (auditoria). Os que terminaram em SELECT — 129, 130, 131, 132, 135 —
-- commitaram normalmente.
--
-- Esta consulta responde olhando o BANCO, não o histórico. Sempre devolve linha.
-- ============================================================
select 'v3_133 · negar por padrão'                              as migration,
       case when pg_get_functiondef('escopo_dim(text)'::regprocedure) ilike '%IS NOT TRUE%'
            then '✓ aplicada'
            else '⛔ NÃO aplicada — a função ainda usa NOT v_tem, que deixa o nulo passar' end as situacao,
       'sem ela, usuário sem regra VÊ TUDO'                      as consequencia
union all
select 'v3_134 · escopo de versão',
       case when exists (
              select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
               where c.relname = 'fat_orcado' and p.polcmd = 'r'
                 and pg_get_expr(p.polqual, p.polrelid) ilike '%escopo_versao%')
            then '✓ aplicada'
            else '⛔ NÃO aplicada — a policy de fat_orcado não menciona versão' end,
       'sem ela, a visão salva fura o filtro de versão'
union all
select 'v3_134 · função escopo_versao',
       case when to_regprocedure('escopo_versao()') is not null
            then '✓ existe' else '⛔ não existe' end,
       'dependência da policy acima'
union all
select 'v3_136 · auditoria',
       case when to_regclass('public.auditoria') is not null
            then '✓ tabela existe' else '⛔ NÃO existe — MON-01 não foi aplicado' end,
       'sem ela, nenhuma ação sensível deixa rastro'
union all
select 'v3_136 · gatilhos de acesso',
       coalesce((select count(*)::text || ' de 3 gatilhos'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where t.tgname like 'trg_aud_%' and not t.tgisinternal
                    and c.relname in ('user_tenant','user_acesso_regra','user_acesso_funcao')), '0'),
       'papel e regra de acesso'
union all
select 'v3_136 · gatilhos de massa',
       coalesce((select count(*)::text || ' de 6 gatilhos'
                   from pg_trigger t where t.tgname like 'trg_aud_massa_%' and not t.tgisinternal), '0'),
       'DELETE em massa nos fatos'
union all
-- Conferência independente do que REALMENTE vale hoje para um usuário sem
-- regra. Se o v3_133 não estiver aplicado, isto devolve linha > 0.
select 'EFEITO REAL · usuário sem regra',
       coalesce((
         select case when count(*) = 0 then 'nenhum usuário sem regra para testar'
                     else count(*)::text || ' usuário(s) sem regra de CC' end
           from user_tenant ut
          where ut.role <> 'admin'
            and not exists (select 1 from user_acesso_regra r
                             where r.user_id = ut.user_id and r.dimensao = 'centro_custo' and r.escopo = 'VER')), '—'),
       'rodar seguranca_passo2_naoregressao.sql para ver o que eles enxergam'
 order by 1;
