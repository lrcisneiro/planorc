-- ============================================================
-- De onde vem o sinal de cada linha da DRE?
--
-- A cor da variação deveria sair do `fatorExibicao`, que inverte a linha de
-- natureza DESPESA. Funcionou em `Despesas` (ficou verde) e NÃO funcionou em
-- `Custo Pessoas (fully loaded)`, `Folha direta` e `Folha apoio`, que seguiram
-- vermelhas caindo quase 10 milhões.
--
-- A hipótese é que essas três sejam INDICADOR cujo sinal positivo vem da
-- EXPRESSÃO, não da natureza — e aí o fatorExibicao devolve 1 e a regra erra.
-- Esta consulta mostra, para cada linha, o que de fato decide o sinal:
-- tipo_linha, natureza própria, a natureza HERDADA (o que o fatorExibicao
-- enxerga subindo pelos pais) e a expressão.
--
-- Sem filtro de tenant: no SQL Editor o current_tenant_id() é NULL.
-- Só leitura. Uma consulta só.
-- ============================================================
with recursive sobe as (
  -- para cada linha, sobe pela árvore até achar quem tem natureza decidida —
  -- exatamente o que fatorExibicao() faz em lib/refRelatorio.ts
  select l.id, l.relatorio_id, l.pai_id, l.codigo, l.descricao, l.tipo_linha,
         l.natureza, l.expressao, l.ordem, l.nivel,
         l.id as cur, l.natureza as achada, 0 as saltos
    from relatorio_linha l
  union all
  select s.id, s.relatorio_id, s.pai_id, s.codigo, s.descricao, s.tipo_linha,
         s.natureza, s.expressao, s.ordem, s.nivel,
         p.id, p.natureza, s.saltos + 1
    from sobe s
    join relatorio_linha f on f.id = s.cur
    join relatorio_linha p on p.id = f.pai_id
   where s.achada not in ('RECEITA', 'DESPESA') and s.saltos < 20
),
herda as (
  select distinct on (id) id, relatorio_id, codigo, descricao, tipo_linha,
         natureza, expressao, ordem, nivel, achada, saltos
    from sobe
   order by id, (case when achada in ('RECEITA','DESPESA') then 0 else 1 end), saltos
)
select r.nome                                  as relatorio,
       h.nivel                                 as nivel,
       h.codigo                                as codigo,
       h.descricao                             as linha,
       h.tipo_linha                            as tipo,
       coalesce(h.natureza, '—')               as natureza_propria,
       case when h.achada in ('RECEITA','DESPESA')
            then h.achada || case when h.saltos > 0 then ' (do pai)' else '' end
            else 'nenhuma → fator 1' end       as natureza_que_vale,
       case when h.achada = 'DESPESA' then -1 else 1 end as fator_exibicao,
       coalesce(h.expressao, '')               as expressao
  from herda h
  join relatorio r on r.id = h.relatorio_id
 where h.nivel <= 2            -- as linhas que aparecem na análise
 order by r.nome, h.ordem;
