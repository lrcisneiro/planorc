-- ============================================================
-- O que a estrutura do relatório consegue DECOMPOR?
--
-- O dashboard de Orçamento deriva os componentes de uma ponte da própria
-- estrutura, sem nome chumbado em código:
--   · FORMULA      → as linhas que a `expressao` referencia  (=[REC] - [CUSTO])
--   · SOMAR_FILHOS → as filhas diretas
--   · demais       → não há o que derivar
--
-- Esta consulta mostra, linha a linha, o que ele vai conseguir fazer — e onde
-- falta fórmula. Serve para decidir o que acrescentar na estrutura.
--
-- ⚠ Referência QUEBRADA é o achado que mais importa: fórmula apontando para um
-- código que não existe no relatório. Ela não quebra a tela (o motor trata o
-- ausente como zero), então some em silêncio — e na ponte vira resíduo sem
-- causa aparente.
--
-- Só leitura. Uma consulta só.
-- ============================================================
with l as (
  select rl.id, rl.relatorio_id, r.nome as relatorio, rl.pai_id, rl.codigo,
         rl.descricao, rl.tipo_linha, rl.expressao, rl.ordem, rl.nivel
    from relatorio_linha rl
    join relatorio r on r.id = rl.relatorio_id
),
refs as (   -- códigos que cada fórmula referencia
  select l.id, l.relatorio_id, m[1] as cod
    from l, lateral regexp_matches(coalesce(l.expressao, ''), '\[([^\]]+)\]', 'g') m
   where l.tipo_linha = 'FORMULA'
),
comp as (
  select l.id,
         case l.tipo_linha
           when 'FORMULA' then (select count(*) from refs r
                                 where r.id = l.id
                                   and exists (select 1 from l x where x.relatorio_id = l.relatorio_id and x.codigo = r.cod))
           when 'SOMAR_FILHOS' then (select count(*) from l f where f.pai_id = l.id)
           else 0 end                                                   as n_comp,
         case l.tipo_linha
           when 'FORMULA' then (select count(*) from refs r
                                 where r.id = l.id
                                   and not exists (select 1 from l x where x.relatorio_id = l.relatorio_id and x.codigo = r.cod))
           else 0 end                                                   as n_quebradas,
         case l.tipo_linha
           when 'FORMULA' then (select string_agg(r.cod, ', ' order by r.cod) from refs r
                                 where r.id = l.id
                                   and not exists (select 1 from l x where x.relatorio_id = l.relatorio_id and x.codigo = r.cod))
           else null end                                                as quebradas
    from l
)
select x.relatorio,
       repeat('   ', greatest(coalesce(x.nivel, 1) - 1, 0)) || coalesce(x.codigo, '—') as linha,
       x.descricao,
       x.tipo_linha,
       c.n_comp                                                         as componentes,
       case
         when c.n_quebradas > 0 then '⚠ fórmula aponta para código inexistente: ' || c.quebradas
         when x.tipo_linha in ('ESPACO') then ''
         when c.n_comp > 0 then '✓ a ponte decompõe esta linha'
         when x.tipo_linha = 'FORMULA' then '⚠ FORMULA sem referência a linha (só números?)'
         when x.tipo_linha = 'SOMAR_FILHOS' then '⚠ subtotal sem filhas'
         when x.pai_id is null then '— nível 1 sem componentes: a ponte não decompõe'
         else ''
       end                                                              as diagnostico,
       coalesce(left(x.expressao, 70), '')                              as formula
  from l x
  join comp c on c.id = x.id
 where x.tipo_linha <> 'ESPACO'
 order by x.relatorio, x.nivel nulls first, x.ordem;
