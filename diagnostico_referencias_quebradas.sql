-- ============================================================
-- Referência quebrada em fórmula: o erro que vale ZERO e não reclama
--
-- O motor (lib/engine.ts) resolve `[COD]` assim:
--     s.replace(/\[([^\]]+)\]/g, c => String(cur[codeToId[c]] ?? 0))
-- Se o código não existe, `codeToId[c]` é undefined, `cur[undefined]` é
-- undefined, e o `?? 0` entrega ZERO. Sem erro, sem aviso, sem célula vermelha.
--
-- O estrago varia com a posição: no numerador a linha vira zero o ano inteiro;
-- numa soma, some uma parcela; num denominador, vira divisão por zero (que o
-- motor devolve como 0 pelo isFinite). Nenhum desses casos aparece na tela como
-- defeito — aparecem como um número plausível e errado.
--
-- Isto apareceu de rebote: a linha LER cita `[Lmqkt33oc]`, que não tem cara de
-- código de linha. Se existe um, é provável que existam outros.
--
-- A consulta quebra TODA expressão nas referências que ela cita e confronta com
-- os códigos e descrições que existem no MESMO relatório — que são as duas
-- formas que o editor aceita entre colchetes.
--
-- Sem filtro de tenant: no SQL Editor o current_tenant_id() é NULL.
-- Só leitura. Uma consulta só.
-- ============================================================
with refs as (
  select l.relatorio_id, l.codigo as de, l.descricao as de_nome, l.expressao,
         trim(m[1]) as ref
    from relatorio_linha l,
         lateral regexp_matches(l.expressao, '\[([^\]]+)\]', 'g') m
   where l.expressao is not null
),
checada as (
  select r.*,
         exists (select 1 from relatorio_linha x
                  where x.relatorio_id = r.relatorio_id
                    and (x.codigo = r.ref or x.descricao = r.ref)) as existe
    from refs r
)
select rel.nome                          as relatorio,
       c.de                              as linha,
       c.de_nome                         as descricao,
       '[' || c.ref || ']'               as referencia,
       case when c.existe then '✓ existe'
            else '⚠ NÃO EXISTE → vale ZERO em silêncio' end as leitura,
       c.expressao                       as expressao
  from checada c
  join relatorio rel on rel.id = c.relatorio_id
 where not c.existe          -- só o que está quebrado; trocar por `true` para ver tudo
 order by rel.nome, c.de, c.ref;
