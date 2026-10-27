-- ============================================================
-- Rescisão (v3_118) — conferência pós-migration
--
-- O SQL Editor do Supabase NÃO mostra RAISE NOTICE: só "Success". Então aqui a
-- resposta vem como LINHA. Sem filtro de tenant de propósito — no editor
-- current_tenant_id() é NULL e qualquer WHERE por tenant volta vazio.
--
-- Rode as três partes e me manda o resultado.
-- ============================================================

-- ─────────── 1 · as cinco verbas foram criadas? ───────────
-- Esperado: 5 linhas, regime BR-CLT, categoria RESCISAO, ordem 70..74.
-- `conta_destino` NULO é o normal agora — é o que você precisa amarrar.
select v.codigo, v.descricao, v.tipo_calculo, v.parametro, v.verba_ref,
       v.ordem, v.regime, v.pais, v.categoria, v.ativo,
       c.codigo as conta_destino
  from verba_folha v
  left join conta_orcamentaria c on c.id = v.conta_destino_id
 where v.codigo like 'RESC_%'
 order by v.ordem;


-- ─────────── 2 · RISCO DE DUPLA CONTAGEM ───────────
-- Verba que JÁ provisiona rescisão mês a mês. Se vier alguma linha, ela e as
-- RESC_* se SOMAM: escolha um caminho (provisão mensal OU evento no mês da
-- saída) e desative o outro em Postos → Regras.
-- Linha nenhuma = sem risco.
select v.codigo, v.descricao, v.tipo_calculo, v.parametro, v.regime, v.ativo,
       '*** confira: parece provisionar rescisão todo mês ***' as alerta
  from verba_folha v
 where v.ativo
   and v.codigo not like 'RESC_%'
   and v.tipo_calculo in ('PROVISAO_1_12', 'PCT_BASE')
   and (v.descricao ilike '%resc%'  or v.descricao ilike '%multa%'
     or v.descricao ilike '%40%%'   or v.descricao ilike '%demiss%'
     or v.descricao ilike '%indeniz%' or v.descricao ilike '%aviso%')
 order by v.ordem;

-- Rede de segurança do item 2: o catálogo BR inteiro, para eu olhar com você.
-- (As provisões de 13º e férias são esperadas e NÃO são rescisão.)
select codigo, descricao, tipo_calculo, parametro, verba_ref, incide_encargos,
       categoria, regime, ordem, ativo
  from verba_folha
 where coalesce(pais, 'BR') = 'BR'
 order by ordem nulls last, codigo;


-- ─────────── 3 · verba com valor e SEM conta destino ───────────
-- Verba sem conta aparece na grade de Postos e NÃO chega ao fat_orcado.
-- Precisa amarrar as RESC_* antes de aplicar o orçado.
select codigo, descricao, tipo_calculo, regime,
       '*** sem conta destino: NÃO vai ao orçado ***' as alerta
  from verba_folha
 where ativo and conta_destino_id is null
   and tipo_calculo <> 'INFORMATIVA'
 order by ordem nulls last, codigo;
