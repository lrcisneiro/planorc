-- ============================================================
-- 026 — Índices enxutos (substitui os INCLUDE pesados da 025)
--
-- Os índices "cobrindo" (INCLUDE) da 025 ocupavam muito disco e
-- ajudaram a encher a instância. Aqui trocamos por índices compostos
-- enxutos, que dão ~a mesma performance com uma fração do tamanho.
-- A RPC com exclusão de lote inline (025) permanece.
--
-- Rodar DEPOIS que o banco voltar a aceitar conexões (upgrade/limpeza).
-- IDEMPOTENTE.
-- ============================================================

-- 1) remove os índices pesados da 025 (libera disco)
DROP INDEX IF EXISTS idx_fat_realizado_agg;
DROP INDEX IF EXISTS idx_fat_orcado_agg;

-- 2) índices compostos enxutos (sem INCLUDE) casados com os filtros
CREATE INDEX IF NOT EXISTS idx_fat_realizado_filtro
  ON fat_realizado (tenant_id, empresa_id, ano, mes);

-- mantém o lookup por conta (branch do conta_linha); lean, já da 025
CREATE INDEX IF NOT EXISTS idx_fat_realizado_conta_per
  ON fat_realizado (tenant_id, conta_id, ano, mes);

CREATE INDEX IF NOT EXISTS idx_fat_orcado_filtro
  ON fat_orcado (tenant_id, versao_id, empresa_id, ano, mes);

-- 3) (opcional) limpar índices antigos redundantes p/ recuperar mais disco.
--    Descomente se precisar de espaço — os novos acima já cobrem esses filtros.
-- DROP INDEX IF EXISTS fat_realizado_empresa_id_ano_mes_idx;   -- coberto por idx_fat_realizado_filtro
-- DROP INDEX IF EXISTS fat_realizado_tenant_id_ano_mes_idx;    -- coberto por idx_fat_realizado_filtro

ANALYZE fat_realizado;
ANALYZE fat_orcado;
