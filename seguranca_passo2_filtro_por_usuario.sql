-- ============================================================
-- PASSO 2 — O filtro de cada usuário, sem saber o que ele significa
--
-- ⚠ CORREÇÃO DE RUMO. A versão anterior deste arquivo procurava centro de
-- custo com `ilike '%diretoria%'` e perguntava qual critério adotar. Errado por
-- princípio: a aplicação **não deve saber** o que é "Diretoria". Ela bloqueia o
-- que o filtro de cada usuário disser, e o significado dos códigos é cadastro
-- deste tenant — não pertence nem ao código nem à política.
--
-- O mecanismo (v3_129/130/131) já é assim: a policy lê `user_acesso_regra` e
-- compara ids. Não há nome de área, divisão ou centro de custo em lugar nenhum
-- dela.
--
-- A pergunta que importa, e que esta consulta responde, é outra: **o filtro de
-- cada usuário está cadastrado, e qual é o alcance dele?** Quem revisa decide o
-- que fazer com a resposta, porque só quem revisa sabe quem deveria ver o quê.
--
-- Serve como conferência recorrente: rodar a cada usuário novo, antes de
-- liberar o acesso. Sempre devolve linha.
--
-- Só leitura.
-- ============================================================
with dims(dimensao, total) as (
  select 'empresa',      (select count(*) from empresa      where tenant_id = current_tenant_id())
  union all select 'filial',       (select count(*) from filial       where tenant_id = current_tenant_id())
  union all select 'centro_custo', (select count(*) from centro_custo where tenant_id = current_tenant_id())
),
u as (select user_id, role from user_tenant where tenant_id = current_tenant_id()),
r as (
  select u.user_id, u.role, d.dimensao, d.total,
         reg.valor_ids, reg.negados,
         reg.user_id is not null as tem_regra
    from u cross join dims d
    left join user_acesso_regra reg
      on reg.user_id = u.user_id and reg.dimensao = d.dimensao and reg.escopo = 'VER'
)
select '1 · alcance do filtro, por usuário e dimensão'   as secao,
       left(r.user_id::text, 8) || '…'                   as a,
       r.role                                            as b,
       r.dimensao                                        as c,
       case
         when r.role = 'admin'  then 'ignora o escopo (admin)'
         when not r.tem_regra   then 'sem regra → VÊ TUDO (' || r.total || ')'
         when coalesce(array_length(r.valor_ids,1),0) = 0
              and coalesce(array_length(r.negados,1),0) = 0 then 'regra vazia → VÊ TUDO (' || r.total || ')'
         when coalesce(array_length(r.valor_ids,1),0) = 0
              then 'tudo MENOS ' || array_length(r.negados,1) || ' → ' || (r.total - array_length(r.negados,1)) || ' de ' || r.total
         else array_length(r.valor_ids,1)
              - coalesce((select count(*) from unnest(r.valor_ids) v where v = any(coalesce(r.negados,'{}'))), 0)
              || ' de ' || r.total || ' permitidos'
       end                                               as d,
       case
         when r.role = 'admin' then ''
         when not r.tem_regra or (coalesce(array_length(r.valor_ids,1),0) = 0 and coalesce(array_length(r.negados,1),0) = 0)
              then '⚠ sem restrição nesta dimensão'
         else '✓ restrito'
       end                                               as e
  from r
union all
-- Resumo por usuário: quantas dimensões ficaram sem restrição. É o número que
-- interessa antes de liberar acesso — não QUAIS códigos, QUANTAS dimensões
-- estão abertas.
select '2 · resumo — dimensões sem restrição',
       left(r.user_id::text, 8) || '…', r.role, '',
       count(*) FILTER (WHERE r.role <> 'admin' AND (NOT r.tem_regra OR
              (coalesce(array_length(r.valor_ids,1),0) = 0 AND coalesce(array_length(r.negados,1),0) = 0)))
         || ' de 3 dimensões abertas',
       case when r.role = 'admin' then 'admin'
            when count(*) FILTER (WHERE NOT r.tem_regra OR
                   (coalesce(array_length(r.valor_ids,1),0) = 0 AND coalesce(array_length(r.negados,1),0) = 0)) = 3
                 then '⛔ nenhum filtro: revisar antes de liberar'
            else '— conferir se o recorte é o pretendido' end
  from r group by r.user_id, r.role
 order by 1, 2, 4;
