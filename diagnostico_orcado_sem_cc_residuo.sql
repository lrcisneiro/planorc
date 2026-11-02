-- ============================================================
-- Sobrou CC nulo no orçado? Por versão, origem e posto
--
-- Depois de corrigir a RATEMP03 e reaplicar, o gráfico por CC não mostra mais
-- "Sem CC" — mas o levantamento geral ainda acusa 479 linhas: 379 de origem
-- POSTO (YY e 05, −2,71 mi) e 100 MANUAL de exatamente −20.000 em cinco
-- empresas.
--
-- Duas explicações possíveis, e a diferença importa:
--   · está em OUTRA versão (Orçado2027_B, por exemplo) → não é problema no
--     orçamento que você está montando;
--   · sobrou na Orçado2027 → a correção não cobriu tudo e falta um segundo
--     caso, talvez outra regra ou posto sem CC e sem rateio.
--
-- O recorte por VERSÃO é o que separa uma da outra — foi o que faltou na
-- consulta anterior.
--
-- As 100 linhas MANUAL de −20.000 redondos têm cara de valor digitado como
-- reserva. Aparecem à parte porque o conserto é outro: alguém precisa dizer a
-- que centro de custo elas pertencem.
--
-- Só leitura. Uma consulta só; a seção 1 sempre devolve linha.
-- ============================================================
with nulo as (
  select f.*, v.codigo as versao, e.codigo as empresa
    from fat_orcado f
    join versao_orcamento v on v.id = f.versao_id
    join empresa e on e.id = f.empresa_id
   where f.cc_id is null
)
select '1 · por versão e origem'                       as secao,
       coalesce(n.versao, '(nenhuma)')                  as a,
       coalesce(n.origem, '')                           as b,
       coalesce(min(n.ano)::text, '')                   as c,
       count(*)::text || ' linha(s)'                    as d,
       to_char(coalesce(sum(n.valor), 0), 'FM999G999G990D00') as e
  from nulo n group by n.versao, n.origem
union all
-- Quem ainda produz nulo pela folha. `dims->>'posto'` é o que o Aplicar grava.
select '2 · POSTO: quem ainda produz nulo',
       n.versao, coalesce(n.dims->>'posto', '(sem posto no dims)'), n.empresa,
       count(*)::text || ' linha(s)',
       to_char(sum(n.valor), 'FM999G999G990D00')
  from nulo n
 where n.origem = 'POSTO'
 group by n.versao, n.dims->>'posto', n.empresa
union all
-- As MANUAL, por conta: conserto diferente, alguém tem de dizer o CC.
select '3 · MANUAL: digitado sem CC',
       n.versao, co.codigo || ' · ' || co.descricao, n.empresa,
       count(*)::text || ' linha(s)',
       to_char(sum(n.valor), 'FM999G999G990D00')
  from nulo n
  join conta_orcamentaria co on co.id = n.linha_id
 where n.origem = 'MANUAL'
 group by n.versao, co.codigo, co.descricao, n.empresa
 order by 1, 5 desc;
