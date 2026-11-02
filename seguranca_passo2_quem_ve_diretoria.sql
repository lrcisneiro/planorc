-- ============================================================
-- PASSO 2 — Quem ainda enxerga o CC da Diretoria
--
-- O v3_129/130/131 fechou o MECANISMO: o escopo vale no banco. O teste de
-- não-regressão provou que um `member` com regra vê menos que o admin.
--
-- Mas provou outra coisa junto, e ela é o que falta: **sem regra cadastrada, o
-- usuário vê tudo** — inclusive um `viewer`. E o `member` com três regras vê
-- 99,8% da folha, porque as regras dele não excluem a Diretoria.
--
-- Política correta, configuração permissiva. Esta consulta responde a pergunta
-- que a release depende: QUEM, hoje, enxerga o centro de custo da Diretoria?
--
-- Ela não personifica nem depende de RLS: lê `user_acesso_regra` e aplica a
-- mesma regra do `useUserAccess` — allow-list (vazia = tudo) menos negados,
-- admin ignora tudo. Por isso roda rápido e pode ser repetida a cada usuário
-- novo, como conferência antes de liberar acesso.
--
-- Só leitura. Sempre devolve linha.
-- ============================================================
with dir as (   -- os CCs da Diretoria, pelo atributo de área, não por nome solto
  select c.id, c.codigo, c.descricao
    from centro_custo c
   where c.area_nome ilike '%diretoria%' or c.descricao ilike '%diretoria%'
),
usr as (
  select ut.user_id, ut.role,
         (select valor_ids from user_acesso_regra r
           where r.user_id = ut.user_id and r.dimensao = 'centro_custo' and r.escopo = 'VER' limit 1) as allow,
         (select negados    from user_acesso_regra r
           where r.user_id = ut.user_id and r.dimensao = 'centro_custo' and r.escopo = 'VER' limit 1) as deny,
         exists (select 1 from user_acesso_regra r
                  where r.user_id = ut.user_id and r.dimensao = 'centro_custo' and r.escopo = 'VER') as tem_regra_cc
    from user_tenant ut
)
select '1 · os CC da Diretoria'                      as secao,
       d.codigo                                       as a,
       d.descricao                                    as b,
       ''                                             as c,
       ''                                             as d,
       ''                                             as e
  from dir d
union all
select '2 · quem enxerga a Diretoria',
       left(u.user_id::text, 8) || '…',
       u.role,
       case when u.tem_regra_cc then 'regra de CC cadastrada' else '⚠ SEM regra de CC' end,
       (select count(*)::text from dir d
         where u.role = 'admin'                                   -- admin ignora escopo
            or not u.tem_regra_cc                                 -- sem regra = tudo
            or (coalesce(array_length(u.allow,1),0) = 0 and not (d.id = any(coalesce(u.deny,'{}'))))
            or (d.id = any(coalesce(u.allow,'{}')) and not (d.id = any(coalesce(u.deny,'{}'))))
       ) || ' de ' || (select count(*) from dir)::text || ' CC da Diretoria visíveis',
       case when u.role = 'admin' then 'admin — por desenho vê tudo'
            when not u.tem_regra_cc then '⛔ VÊ TUDO: cadastrar regra antes de liberar'
            when (select count(*) from dir d
                   where (coalesce(array_length(u.allow,1),0) = 0 and not (d.id = any(coalesce(u.deny,'{}'))))
                      or (d.id = any(coalesce(u.allow,'{}')) and not (d.id = any(coalesce(u.deny,'{}'))))) > 0
                 then '⛔ enxerga a Diretoria'
            else '✓ Diretoria bloqueada' end
  from usr u
 order by 1, 5 desc;
