-- ============================================================
-- Contexto do formulário para o estudo do baseline (Claude Desktop)
--
-- A saída desta consulta é o que vai ANEXADO ao prompt: o Desktop não enxerga
-- o banco, então precisa receber a estrutura e os códigos de escopo prontos.
-- Sem isso ele inventaria UUID e código de empresa/filial/CC.
--
-- UMA consulta só (o SQL Editor mostra só a última instrução). Cole o resultado
-- inteiro — os três blocos.
-- ============================================================

-- 1 · estrutura do formulário: o que preencher e o que é calculado
select '1 · linhas do formulário'                          as bloco,
       l.ordem::text                                       as ord,
       l.codigo                                            as cod,
       l.descricao                                         as nome,
       l.tipo_linha                                        as tipo,
       l.formato || ' · ' || coalesce(l.natureza,'—')      as unidade,
       case when l.tipo_linha = 'ANALITICA' then 'PREENCHER' else 'calculada' end as papel,
       coalesce(l.expressao, '')                           as detalhe
  from formulario f
  join formulario_linha l on l.formulario_id = f.id
 where f.nome ilike '%recorrente%' and f.nome not ilike '%não recorrente%'

union all

-- 2 · escopos possíveis: empresa × filial × CC (o CC é a BU/produto)
--    Só filial ATIVA e CC ATIVO; é o universo onde o estudo pode lançar.
select '2 · escopo empresa/filial/CC',
       e.codigo,
       fi.codigo,
       cc.codigo,
       e.descricao,
       fi.descricao,
       cc.descricao,
       coalesce(cc.bu_cod || ' · ' || cc.bu_nome, '')
  from empresa e
  join filial fi       on fi.empresa_id = e.id
  cross join centro_custo cc
 where e.ativo and cc.ativo
   and cc.codigo in (
     -- <<< AJUSTE AQUI: só os CCs que são BU de produto.
     -- Sem este filtro o cruzamento vira centenas de linhas sem sentido.
     select codigo from centro_custo where ativo and bu_cod is not null
   )

union all

-- 3 · o que JÁ existe lançado (para não gerar em cima)
select '3 · já preenchido',
       coalesce(e.codigo, '🌐 global'),
       coalesce(fi.codigo, '—'),
       coalesce(cc.codigo, '—'),
       ver.codigo,
       v.ano::text,
       l.codigo,
       count(*)::text || ' célula(s), meses ' || string_agg(distinct v.mes::text, ',' order by v.mes::text)
  from formulario f
  join formulario_linha l on l.formulario_id = f.id
  join formulario_valor v on v.linha_id = l.id
  left join empresa e      on e.id = v.empresa_id
  left join filial fi      on fi.id = v.filial_id
  left join centro_custo cc on cc.id = v.cc_id
  left join versao_orcamento ver on ver.id = v.versao_id
 where f.nome ilike '%recorrente%' and f.nome not ilike '%não recorrente%'
 group by e.codigo, fi.codigo, cc.codigo, ver.codigo, v.ano, l.codigo

order by 1, 2, 3, 4;
