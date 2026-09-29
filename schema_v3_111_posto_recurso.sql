-- ============================================================
-- 111 — Código do recurso no posto
--
-- O apontamento de horas identifica a pessoa pelo RECURSO (`TL0011`, `001075`),
-- não pela matrícula. O de-para é do próprio Protheus — `SRA.RA_X_RECUR`, que é
-- o campo que o integrador OEFOLM02.PRW usa para buscar as horas — e o export
-- `Funcionarios.csv` já o traz em `BK_RECURSO`.
--
-- Só que ele se perdia no caminho: o conversor não exportava e `posto` não tinha
-- onde guardar. Sem isso não há como ligar o extrato de apontamento à folha, que
-- é a base da terceira pill da conciliação.
--
-- Nullable de propósito: vaga planejada não tem recurso, e nem todo funcionário
-- aponta horas (medido: 316 de 559 linhas do cadastro têm recurso).
--
-- O índice é parcial — só interessa procurar quem TEM recurso.
-- Idempotente.
-- ============================================================

ALTER TABLE posto
  ADD COLUMN IF NOT EXISTS recurso_cod text;

COMMENT ON COLUMN posto.recurso_cod IS
  'Código do recurso no apontamento de horas (SRA.RA_X_RECUR / BK_RECURSO). Liga o posto ao Extrato de Horas Apontadas. Nulo em vaga planejada e em quem não aponta.';

CREATE INDEX IF NOT EXISTS ix_posto_recurso
  ON posto (tenant_id, recurso_cod) WHERE recurso_cod IS NOT NULL;
