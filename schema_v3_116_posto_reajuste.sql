-- ============================================================
-- 116 — Reajuste individual do posto (promoção, mérito, enquadramento)
--
-- O motor já sabia reajustar a partir de um mês, mas só pelo DISSÍDIO, que vem
-- de premissa_dissidio (versão × sindicato) e vale para todo mundo do sindicato:
--
--   const comDissidio = dissidioPct > 0 && mes >= mesBase
--   const base = salBase * fte * (comDissidio ? 1 + dissidioPct/100 : 1)
--
-- Faltava o caso individual. Sem ele, planejar um aumento em março obrigava a
-- escolher entre errar o ano inteiro (salário novo desde janeiro) ou errar o
-- resto do ano (salário velho até dezembro).
--
-- COMPÕE com o dissídio (decidido com Ricardo, out/2026): promovido em março e
-- reajustado pelo sindicato em setembro leva os dois, multiplicativos — é como
-- o ERP faz.
--
-- Vale só para o SALÁRIO. Encargos e provisões acompanham por serem percentuais
-- sobre a base; benefício de VALOR FIXO (VR, plano) não muda com salário.
--
-- `reajuste_pct` OU `reajuste_valor`, nunca os dois: percentual quando a
-- negociação é "+8%", valor quando a faixa do cargo já diz o número.
-- IDEMPOTENTE.
-- ============================================================

ALTER TABLE posto
  ADD COLUMN IF NOT EXISTS reajuste_mes   smallint,
  ADD COLUMN IF NOT EXISTS reajuste_pct   numeric(6,3),
  ADD COLUMN IF NOT EXISTS reajuste_valor numeric(14,2);

DO $$
BEGIN
  -- mês dentro do ano
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posto_reajuste_mes_chk') THEN
    ALTER TABLE posto ADD CONSTRAINT posto_reajuste_mes_chk
      CHECK (reajuste_mes IS NULL OR reajuste_mes BETWEEN 1 AND 12);
  END IF;
  -- percentual e valor são alternativos, e qualquer um deles exige o mês:
  -- um reajuste sem data não tem como ser aplicado e viraria silêncio no motor
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posto_reajuste_coerente_chk') THEN
    ALTER TABLE posto ADD CONSTRAINT posto_reajuste_coerente_chk CHECK (
      (reajuste_pct IS NULL AND reajuste_valor IS NULL)
      OR (reajuste_mes IS NOT NULL AND num_nonnulls(reajuste_pct, reajuste_valor) = 1)
    );
  END IF;
END $$;

COMMENT ON COLUMN posto.reajuste_mes IS
  'Mês (1-12) a partir do qual o reajuste individual vale, no ano da versão. NULL = sem reajuste.';
COMMENT ON COLUMN posto.reajuste_pct IS
  'Reajuste individual em %, a partir de reajuste_mes. COMPÕE com o dissídio do sindicato.';
COMMENT ON COLUMN posto.reajuste_valor IS
  'Salário novo (absoluto) a partir de reajuste_mes. Alternativo ao pct; substitui a base em vez de multiplicá-la, mas o dissídio ainda se aplica por cima.';
