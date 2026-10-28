-- ============================================================
-- v3_123 — índice de cobertura para relatorio_orcado_agg.
--
-- DIAGNÓSTICO (out/2026). A agregação do orçado levava 0,8–1,8s por chamada
-- contra 122–383ms da do realizado. EXPLAIN (ANALYZE, BUFFERS) mostrou o
-- motivo: o planner escolhia o uq_fat_orcado — 83 MB, chave
-- (versao, linha, empresa, filial, cc, ano, mes, dims::text) — porque é o
-- ÚNICO índice que contém linha_id. Mas a consulta filtra versao, linha,
-- empresa, ano e mes e PULA filial e cc, que estão no meio da chave; o scan
-- vira milhares de descidas na árvore:
--
--   Index Scan using uq_fat_orcado  (rows=1840 estimado → 53705 real)
--     Buffers: shared hit=194461          ← 1,5 GB de tráfego p/ 53 mil linhas
--   Execution Time: 770 ms
--
-- O idx_fat_orcado_filtro (tenant, versao, empresa, ano, mes) é rápido — nos
-- InitPlans varreu as 101 mil linhas em 32ms por Index Only Scan — mas não tem
-- linha_id nem as colunas somadas, então não serve ao agregado.
--
-- CONSERTO: um índice com exatamente as colunas do predicado na chave e o
-- payload no INCLUDE, para o agregado virar Index Only Scan sem ir ao heap.
-- É barato porque `expressao` está NULL em 100% das linhas hoje (conferido) e
-- val_m2..m5 só existem em tenant multimoeda — NULL não ocupa espaço na tupla.
--
-- Serve relatorio_orcado_agg, relatorio_orcado_anual e relatorio_linha_empresa_agg.
-- Não altera dado nenhum. IDEMPOTENTE.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_fat_orcado_agg_cov
  ON fat_orcado (tenant_id, versao_id, empresa_id, ano, mes, linha_id)
  INCLUDE (valor, val_m2, val_m3, val_m4, val_m5, filial_id, cc_id, expressao);

-- O idx_fat_orcado_filtro passa a ser PREFIXO ESTRITO do novo índice: tudo que
-- ele atendia o novo atende igual ou melhor. Mantê-lo só custaria escrita em
-- cada INSERT do Aplicar.
DROP INDEX IF EXISTS idx_fat_orcado_filtro;

ANALYZE fat_orcado;

-- Confirmação: o agregado agora é Index Only Scan no índice novo?
SELECT 'índice criado' AS secao,
       pg_size_pretty(pg_relation_size('idx_fat_orcado_agg_cov')) AS tamanho,
       (SELECT pg_size_pretty(pg_relation_size('uq_fat_orcado'))) AS unique_antigo;
