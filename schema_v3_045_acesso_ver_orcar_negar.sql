-- ============================================================
-- MIGRATION v3_045 — Acesso por dado: VER × ORÇAR + NEGAR (F2)
-- ============================================================
-- Estende user_acesso_regra (segurança dimensional) para as melhores
-- práticas de FP&A:
--   • escopo VER  → o que o usuário pode CONSULTAR
--   • escopo ORCAR → o que o usuário pode EDITAR/ORÇAR (em geral mais restrito)
--   • negados[]   → exclusões explícitas (esconde um membro mesmo de quem vê "tudo",
--                   ex.: CC da diretoria)
--
-- Modelo da regra (por usuário × dimensão × escopo):
--   valor_ids vazio  = TODOS os membros da dimensão...
--   ...menos os que estiverem em negados[].
--   valor_ids preenchido = APENAS esses... menos negados[].
--
-- CC já é suportado como dimensão via a tabela `dimensao` (tabela_ref='centro_custo').
-- Imposição: por ora no FRONTEND (hook useUserAccess). Endurecimento via RLS/RPC fica p/ depois.
--
-- Backfill: regras existentes viram escopo='VER' (a coluna NOT NULL DEFAULT já preenche).
-- Idempotente.
-- ============================================================

-- 1) Novas colunas
ALTER TABLE user_acesso_regra
  ADD COLUMN IF NOT EXISTS escopo  text   NOT NULL DEFAULT 'VER'
    CHECK (escopo IN ('VER','ORCAR'));

ALTER TABLE user_acesso_regra
  ADD COLUMN IF NOT EXISTS negados uuid[] NOT NULL DEFAULT '{}';

-- 2) Unique passa a incluir escopo (uma regra VER e uma ORCAR por dimensão)
DO $$
DECLARE cname text;
BEGIN
  -- remove o unique antigo (tenant_id, user_id, dimensao) — nome gerado automaticamente
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'user_acesso_regra'::regclass
    AND contype = 'u'
    AND conname <> 'user_acesso_regra_uq'
  LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE user_acesso_regra DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE user_acesso_regra DROP CONSTRAINT IF EXISTS user_acesso_regra_uq;
ALTER TABLE user_acesso_regra
  ADD CONSTRAINT user_acesso_regra_uq UNIQUE (tenant_id, user_id, dimensao, escopo);

-- 3) Índice de apoio (lookup por usuário + escopo)
CREATE INDEX IF NOT EXISTS idx_user_acesso_user_escopo
  ON user_acesso_regra (user_id, escopo);

-- ============================================================
-- Notas de aplicação (frontend — próximo incremento)
-- ------------------------------------------------------------
--  • VER: filtra/trava empresa, filial e CC na Consulta; esconde negados.
--  • ORCAR: se NÃO houver regra ORCAR para a dimensão, o escopo de edição
--    herda o de VER (edita o que vê). Regra ORCAR só serve p/ restringir mais.
--  • negados[] vale para ambos os escopos (some da lista e dos filtros).
-- ============================================================
