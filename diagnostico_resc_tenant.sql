-- ============================================================
-- As RESC_* ficaram no tenant CERTO?
--
-- A v3_118 derivou o tenant de `(SELECT tenant_id FROM verba_folha LIMIT 1)`.
-- Com mais de um tenant, o LIMIT 1 pode ter pego o errado — e aí as verbas
-- EXISTEM mas o app não as vê, porque ele filtra por RLS e o SQL Editor não.
-- É a assinatura exata do sintoma: aparecem em todo diagnóstico, somem na tela.
-- Só leitura.
-- ============================================================
select t.nome                                            as tenant,
       count(*) filter (where v.codigo like 'RESC\_%')   as verbas_rescisao,
       count(*) filter (where v.codigo not like 'RESC\_%') as outras_verbas,
       count(*) filter (where v.codigo = '001')          as tem_salario_base,
       (select count(*) from posto p where p.tenant_id = t.id) as postos,
       case
         when count(*) filter (where v.codigo like 'RESC\_%') > 0
          and count(*) filter (where v.codigo not like 'RESC\_%') = 0
           then '*** RESC_* SOZINHAS AQUI: tenant errado ***'
         when count(*) filter (where v.codigo like 'RESC\_%') = 0
          and count(*) filter (where v.codigo not like 'RESC\_%') > 0
           then '*** catalogo SEM as RESC_*: e este o tenant do app? ***'
         else 'ok — rescisao junto com o resto do catalogo'
       end                                               as leitura
  from tenant t
  left join verba_folha v on v.tenant_id = t.id
 group by t.id, t.nome
 order by 2 desc, 3 desc;
