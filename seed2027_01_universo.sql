-- ============================================================
-- SEED 2027 · passo 1 — sinal e universo
--
-- ⚠ Correção importante: `fat_orcado.linha_id` referencia **conta_orcamentaria**
-- (o master), NÃO `relatorio_linha`. A v3_010 repontou a FK para
-- linha_orcamentaria, que depois virou conta_orcamentaria. Um join com
-- relatorio_linha nunca casa e devolve zero linhas em silêncio — foi o que
-- aconteceu no diagnóstico anterior.
--
-- Isso é bom para o seed: gravando no master, o valor aparece em qualquer
-- relatório que use aquele master. Não precisamos escolher a DRE.
--
-- Só leitura.
-- ============================================================

-- ─────────── 1 · O SINAL · como cada origem grava despesa ───────────
-- O realizado vem do ERP como `crédito - débito`, então despesa é NEGATIVA.
-- Preciso saber se o orçado MANUAL de 2026 — o que você validou mês a mês —
-- segue a mesma convenção. O seed tem de nascer igual a ele.
select
  v.codigo                                as versao,
  f.origem,
  co.natureza,
  count(*)                                as lancamentos,
  count(*) filter (where f.valor > 0)     as positivos,
  count(*) filter (where f.valor < 0)     as negativos,
  round(sum(f.valor), 2)                  as total
from fat_orcado f
join versao_orcamento v    on v.id = f.versao_id
join conta_orcamentaria co on co.id = f.linha_id
where v.ano in (2026, 2027)
group by v.codigo, f.origem, co.natureza
order by v.codigo, co.natureza, f.origem;

-- ─────────── 2 · o mesmo no REALIZADO, para comparar ───────────
select
  co.natureza,
  count(*)                                as lancamentos,
  count(*) filter (where m.valor > 0)     as positivos,
  count(*) filter (where m.valor < 0)     as negativos,
  round(sum(m.valor), 2)                  as total_2026
from fat_realizado m
join conta_linha cl        on cl.conta_id = m.conta_id
join conta_orcamentaria co on co.id = cl.linha_id
where m.ano = 2026
group by co.natureza
order by co.natureza;

-- ─────────── 3 · o universo de masters de DESPESA ───────────
-- Lista o que o seed cobriria, com o realizado de 2026 e quantos meses tiveram
-- movimento. `meses_com_mov` é o que separa a despesa administrativa recorrente
-- (12/12) da esporádica (1 ou 2) — na esporádica a média mente.
-- As famílias de FOLHA aparecem marcadas: são as que o motor de postos grava.
select
  co.codigo,
  co.descricao,
  co.natureza,
  case when exists (
      select 1 from fat_orcado fo
       where fo.linha_id = co.id and fo.origem = 'POSTO'
  ) then '*** FOLHA — excluir do seed ***' else '' end        as folha,
  count(distinct m.ano || '-' || lpad(m.mes::text,2,'0'))     as meses_com_mov,
  count(*)                                                    as lancamentos,
  round(sum(m.valor), 2)                                      as realizado_2026,
  round(avg(mensal.v), 2)                                     as media_mensal
from conta_orcamentaria co
join conta_linha cl        on cl.linha_id = co.id
join fat_realizado m       on m.conta_id = cl.conta_id and m.ano = 2026
join lateral (
  select sum(m2.valor) v
    from fat_realizado m2
    join conta_linha cl2 on cl2.conta_id = m2.conta_id
   where cl2.linha_id = co.id and m2.ano = m.ano and m2.mes = m.mes
) mensal on true
where co.natureza = 'DESPESA'
group by co.id, co.codigo, co.descricao, co.natureza
order by abs(sum(m.valor)) desc;
