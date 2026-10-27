-- ============================================================
-- Rescisão (v3_118) — conferência pós-migration
--
-- DUAS armadilhas do SQL Editor do Supabase, as duas já me pegaram aqui:
--   · `RAISE NOTICE` não é exibido — a tela mostra só "Success";
--   · com várias instruções, mostra o resultado da ÚLTIMA. As anteriores rodam
--     e a resposta se perde.
-- Daí este arquivo ser UMA consulta só, com uma coluna `secao` separando os
-- blocos. Rode tudo e me manda o resultado inteiro.
--
-- Sem filtro de tenant de propósito: no editor current_tenant_id() é NULL e
-- qualquer WHERE por tenant volta vazio.
-- ============================================================

with v as (
  select b.*, c.codigo as conta_destino
    from verba_folha b
    left join conta_orcamentaria c on c.id = b.conta_destino_id
)
-- ─── 1 · as cinco verbas de rescisão foram criadas? ───
-- Esperado: 5 linhas, regime BR-CLT, categoria RESCISAO, ordem 70..74.
select '1 · RESC criadas' as secao, codigo, descricao, tipo_calculo,
       parametro, verba_ref, regime, categoria, ordem, ativo, conta_destino,
       case when conta_destino is null then 'amarrar a conta' else 'ok' end as alerta
  from v where codigo like 'RESC_%'

union all
-- ─── 2 · RISCO DE DUPLA CONTAGEM ───
-- Verba que JÁ provisiona rescisão mês a mês. Se vier linha aqui, ela e as
-- RESC_* se SOMAM: escolha um caminho (provisão mensal OU evento no mês da
-- saída) e desative o outro em Postos → Regras. Nenhuma linha = sem risco.
select '2 · DUPLA CONTAGEM?', codigo, descricao, tipo_calculo,
       parametro, verba_ref, regime, categoria, ordem, ativo, conta_destino,
       '*** parece provisionar rescisão todo mês ***'
  from v
 where ativo and codigo not like 'RESC_%'
   and tipo_calculo in ('PROVISAO_1_12', 'PCT_BASE')
   and (descricao ilike '%resc%'  or descricao ilike '%multa%'
     or descricao ilike '%40%%'   or descricao ilike '%demiss%'
     or descricao ilike '%indeniz%' or descricao ilike '%aviso%')

union all
-- ─── 3 · catálogo BR inteiro ───
-- Rede de segurança do item 2: em vez de confiar no meu ilike, olho com você.
-- As provisões de 13º e férias são esperadas e NÃO são rescisão.
select '3 · catálogo BR', codigo, descricao, tipo_calculo,
       parametro, verba_ref, regime, categoria, ordem, ativo, conta_destino,
       case when not ativo then 'inativa' else '' end
  from v where coalesce(pais, 'BR') = 'BR' and codigo not like 'RESC_%'

union all
-- ─── 4 · verba com valor e SEM conta destino ───
-- Verba sem conta aparece na grade de Postos e NÃO chega ao fat_orcado.
select '4 · sem conta destino', codigo, descricao, tipo_calculo,
       parametro, verba_ref, regime, categoria, ordem, ativo, conta_destino,
       '*** NÃO vai ao orçado ***'
  from v
 where ativo and conta_destino_id is null and tipo_calculo <> 'INFORMATIVA'

order by 1, coalesce(ordem, 9999), codigo;
