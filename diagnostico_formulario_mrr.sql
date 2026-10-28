-- ============================================================
-- Formulário de receita recorrente (MRR) — estrutura + valores
--
-- UMA consulta só (o SQL Editor mostra o resultado da última instrução) e sem
-- filtro de tenant (lá o current_tenant_id() é NULL).
--
-- Bloco 1 = a estrutura com a FÓRMULA INTEIRA (na tela ela aparece cortada).
-- Bloco 2 = os valores preenchidos, com os 12 meses numa linha por
--           empresa × linha, para caber de uma vez.
--
-- Ajuste o ANO se não for 2026. Se houver mais de um formulário de receita,
-- troque o ILIKE pelo código certo.
-- ============================================================

with f as (
  select id, codigo, nome
    from formulario
   where nome ilike '%recorrente%' or nome ilike '%MRR%' or codigo ilike '%MRR%'
)
select '1 · estrutura'                              as bloco,
       f.nome                                       as formulario,
       l.ordem::text                                as ordem,
       l.codigo,
       l.descricao,
       l.tipo_linha || ' · ' || coalesce(l.natureza, '—') || ' · ' || l.formato as tipo,
       coalesce(l.expressao, '—')                   as detalhe,
       coalesce(c.codigo || ' · ' || c.descricao, '— não vai ao orçado —') as conta_destino
  from f
  join formulario_linha l on l.formulario_id = f.id
  left join conta_orcamentaria c on c.id = l.conta_destino_id

union all

select '2 · valores ' || v.ano::text,
       coalesce(e.codigo, '🌐 global (todas)'),
       coalesce(ver.codigo, '?'),
       l.codigo,
       coalesce(e.descricao, 'premissa global'),
       count(*)::text || ' mês(es)',
       -- os 12 meses em uma linha: jan=1.000 · fev=1.020 · …
       string_agg(
         to_char(v.mes, 'FM00') || '=' ||
         coalesce(to_char(v.valor, 'FM999G999G990D00'), v.expressao, '—'),
         ' · ' order by v.mes),
       coalesce(c.codigo, '—')
  from f
  join formulario_linha l   on l.formulario_id = f.id
  join formulario_valor v   on v.linha_id = l.id
  left join empresa e       on e.id = v.empresa_id
  left join versao_orcamento ver on ver.id = v.versao_id
  left join conta_orcamentaria c on c.id = l.conta_destino_id
 where v.ano = 2026          -- <<< ajuste o ano
 group by v.ano, e.codigo, e.descricao, ver.codigo, l.codigo, l.ordem, c.codigo

order by 1, 2, 3;
