-- ============================================================
-- Quem inverte o sinal na EXPRESSÃO — e quem depende disso
--
-- Achado: `CPESSOAS` é `=-1*([Salarios e Ordenados]+[Encargos e Benefícios]…)`.
-- O `-1*` existia para a linha aparecer positiva enquanto a natureza era
-- NEUTRA. Com a natureza agora em DESPESA, o `fatorExibicao` já inverte — e a
-- inversão acontece DUAS vezes: a linha passou a exibir −46.483.297 enquanto
-- `Despesas`, que é despesa de verdade, exibe +60.482.237.
--
-- O conserto de raiz é tirar o `-1*` das linhas que agora têm natureza DESPESA.
-- Isso arruma três coisas de uma vez: a exibição volta a positiva, a cor da
-- variação fica certa por qualquer critério, e a PONTE para de somar essas
-- linhas com o sinal trocado (ela usa o valor CRU — hoje um custo de 46 mi
-- entra como contribuição POSITIVA, o que infla o caminho).
--
-- ⚠ Antes de mexer: quem REFERENCIA essas linhas espera o sinal de hoje. Se
-- `Margem bruta` faz `=[RECLIQ]-[CPESSOAS]`, tirar o `-1*` inverte a margem.
-- Por isso a seção 2 — é ela que diz se o conserto é seguro ou se exige ajustar
-- quem depende junto, na mesma mexida.
--
-- Sem filtro de tenant: no SQL Editor o current_tenant_id() é NULL.
-- Só leitura. Uma consulta só.
-- ============================================================
with suspeita as (   -- linhas cuja expressão inverte o sinal à mão
  select l.id, l.relatorio_id, l.codigo, l.descricao, l.natureza,
         l.tipo_linha, l.expressao
    from relatorio_linha l
   where l.expressao is not null
     and (l.expressao ~* '-\s*1\s*\*' or l.expressao ~* '^\s*=\s*-\s*\(')
)
select '1 · inverte o sinal na expressão' as secao,
       r.nome                              as relatorio,
       s.codigo                            as linha,
       s.descricao                         as descricao,
       coalesce(s.natureza, '—') || ' · ' || s.tipo_linha as situacao,
       case when s.natureza = 'DESPESA'
            then '⚠ INVERTE DUAS VEZES (natureza + expressão)'
            else 'ok enquanto a natureza não for DESPESA' end as leitura,
       s.expressao                         as expressao
  from suspeita s join relatorio r on r.id = s.relatorio_id
union all
-- Quem depende: toda linha que cita o código OU a descrição de uma suspeita
select '2 · depende do sinal atual', r.nome, o.codigo, o.descricao,
       coalesce(o.natureza, '—') || ' · ' || o.tipo_linha,
       'cita [' || s.codigo || '] ou [' || s.descricao || ']',
       o.expressao
  from relatorio_linha o
  join relatorio r on r.id = o.relatorio_id
  join suspeita s on s.relatorio_id = o.relatorio_id and s.id <> o.id
 where o.expressao is not null
   and (o.expressao like '%[' || s.codigo || ']%' or o.expressao like '%[' || s.descricao || ']%')
 order by 1, 2, 3;
