-- ============================================================
-- SEED 2027 · passo 2 — histórico mês a mês por master de despesa
--
-- Uma linha por master, os 12 meses de 2026 em colunas. É a base para:
--   · calcular a média do período que você escolher
--   · separar recorrente de esporádico (meses zerados saltam à vista)
--   · eu analisar as esporádicas e sugerir valor e competência
--
-- Exclui as 3 famílias que o motor de postos grava (20101, 20201, 20301) —
-- essas você aplica depois. Terceiros Externos (20401) ENTRA: medido, o motor
-- nunca gravou nele.
--
-- Exclui também os lotes ignorados ativos, pela mesma regra do
-- relatorio_realizado_agg — senão o encerramento de exercício entra na média.
--
-- EXPORTE O RESULTADO COMO CSV (botão do SQL Editor) e salve na pasta do
-- projeto como `seed2027_historico.csv`. São ~53 linhas; colar no chat
-- funciona, mas o CSV evita erro de transcrição.
--
-- Só leitura.
-- ============================================================
with mov as (
  select
    co.id                             as master_id,
    co.codigo,
    co.descricao,
    m.mes,
    sum(m.valor * coalesce(cl.sinal, 1)) as valor
  from fat_realizado m
  join conta_linha cl        on cl.conta_id = m.conta_id
  join conta_orcamentaria co on co.id = cl.linha_id
  where m.ano = 2026
    and co.natureza = 'DESPESA'
    and co.codigo not in ('20101', '20201', '20301')   -- folha: vem do motor de postos
    and not exists (
      select 1 from lote_ignorado li
       where li.ativo
         and (li.por_prefixo
              and upper(replace(m.lote, ' ', '')) like upper(replace(li.lote, ' ', '')) || '%'
              or upper(replace(li.lote, ' ', '')) = upper(replace(m.lote, ' ', '')))
         and (li.sublote is null or li.sublote = '' or li.sublote = m.sublote)
         and (li.empresa_id is null or li.empresa_id = m.empresa_id)
    )
  group by co.id, co.codigo, co.descricao, m.mes
)
select
  codigo,
  descricao,
  round(sum(valor) filter (where mes = 1), 2)  as jan,
  round(sum(valor) filter (where mes = 2), 2)  as fev,
  round(sum(valor) filter (where mes = 3), 2)  as mar,
  round(sum(valor) filter (where mes = 4), 2)  as abr,
  round(sum(valor) filter (where mes = 5), 2)  as mai,
  round(sum(valor) filter (where mes = 6), 2)  as jun,
  round(sum(valor) filter (where mes = 7), 2)  as jul,
  round(sum(valor) filter (where mes = 8), 2)  as ago,
  round(sum(valor) filter (where mes = 9), 2)  as set,
  round(sum(valor) filter (where mes = 10), 2) as out,
  round(sum(valor) filter (where mes = 11), 2) as nov,
  round(sum(valor) filter (where mes = 12), 2) as dez,
  count(*) filter (where valor <> 0)           as meses_com_mov,
  round(sum(valor), 2)                         as total_ano
from mov
group by master_id, codigo, descricao
order by abs(sum(valor)) desc;
