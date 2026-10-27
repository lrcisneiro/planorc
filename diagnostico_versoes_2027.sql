-- ============================================================
-- Comparar orçamento 2026 × 2027 — onde cada coisa está gravada
--
-- O comparativo já sabe pôr duas versões lado a lado quando elas têm ANOS
-- diferentes (modo ciclo: cada versão busca o seu ano e as duas são sobrepostas
-- num ano de referência). Quem escolhe o dado é o CENÁRIO (a versão), não o
-- filtro de Períodos — esse só escolhe os meses.
--
-- Então, se uma coluna vem vazia, é uma destas três:
--   a) a versão escolhida não é a que você pensa
--   b) o Aplicar gravou em outra versão
--   c) as linhas estão com ano diferente do ano da versão  <- o caso traiçoeiro
--
-- Só leitura.
-- ============================================================

-- ─────────── 1 · as versões e o que cada uma tem ───────────
-- `ano_da_versao` é o que o motor usa para buscar. Se `anos_das_linhas` não
-- contiver esse ano, a versão aparece VAZIA na tela, mesmo cheia no banco.
select
  v.codigo,
  v.descricao,
  v.ano                                   as ano_da_versao,
  v.ativa, v.bloqueada,
  count(f.id)                             as linhas,
  string_agg(distinct f.ano::text, ', ' order by f.ano::text) as anos_das_linhas,
  string_agg(distinct f.origem, ', ')     as origens,
  round(sum(f.valor), 2)                  as total,
  case
    when count(f.id) = 0 then '*** sem nenhuma linha ***'
    when not bool_or(f.ano = v.ano) then '*** linhas em ano diferente do da versao ***'
    else 'ok'
  end                                     as situacao
from versao_orcamento v
left join fat_orcado f on f.versao_id = v.id
group by v.id, v.codigo, v.descricao, v.ano, v.ativa, v.bloqueada
order by v.ano, v.codigo;

-- ─────────── 2 · o Aplicar do posto: onde caiu ───────────
-- origem='POSTO' é o que o botão Aplicar grava. Deve estar na versão de 2027
-- e com ano 2027.
select
  v.codigo       as versao,
  v.ano          as ano_da_versao,
  f.ano          as ano_da_linha,
  count(*)       as linhas,
  round(sum(f.valor), 2) as total
from fat_orcado f
join versao_orcamento v on v.id = f.versao_id
where f.origem = 'POSTO'
group by v.codigo, v.ano, f.ano
order by v.ano, f.ano;

-- ─────────── 3 · a versão de 2026 que você validou ───────────
-- Para o comparativo fazer sentido, a versão de 2026 precisa ter o orçamento
-- inteiro (não só o posto). Quebra por origem para ver o que há nela.
select
  v.codigo, v.ano,
  f.origem,
  count(*)                as linhas,
  count(distinct f.linha_id) as linhas_de_relatorio,
  round(sum(f.valor), 2)  as total
from fat_orcado f
join versao_orcamento v on v.id = f.versao_id
where v.ano in (2026, 2027)
group by v.codigo, v.ano, f.origem
order by v.ano, v.codigo, f.origem;
