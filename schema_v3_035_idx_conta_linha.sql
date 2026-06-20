-- ============================================================
-- 035 — Índice p/ acelerar a resolução por relatório (034)
--
-- A RPC resolve conta→linha buscando conta_linha por linha_id (as linhas
-- do relatório). A unique existente é (conta_id, linha_id) — começa por
-- conta_id, então filtrar por linha_id não usa índice bem. Adiciona índice
-- por (tenant_id, linha_id) e atualiza estatísticas.
--
-- IDEMPOTENTE.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conta_linha_linha ON conta_linha (tenant_id, linha_id);

-- ajuda o branch de linha direta (raro) e o filtro do rollup
CREATE INDEX IF NOT EXISTS idx_frm_linha ON fat_realizado_mensal (tenant_id, linha_id) WHERE linha_id IS NOT NULL;

ANALYZE conta_linha;
ANALYZE fat_realizado_mensal;
