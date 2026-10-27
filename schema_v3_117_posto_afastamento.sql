-- ============================================================
-- 117 — Afastamento do posto (quem já está afastado e segue no ano orçado)
--
-- Escopo deliberadamente estreito (Ricardo, out/2026): o caso é a pessoa que
-- JÁ está afastada hoje e continuará durante o ano que se orça. Absenteísmo
-- esperado é premissa percentual, não cadastro por pessoa; e licença-
-- maternidade é outro problema — ali a empresa paga tudo e compensa na GPS,
-- então é efeito de CAIXA, não despesa, e o FGTS continua sem compensação.
-- Nenhum dos dois entra aqui.
--
-- O QUE A EMPRESA DEIXA DE PAGAR (auxílio por incapacidade, do 16º dia):
--   salário    — passa a ser do INSS
--   INSS patronal — não há base sobre a qual incidir
--   FGTS       — suspenso em doença comum (B31). Em acidente de trabalho (B91)
--                CONTINUA; se esse caso aparecer, é verba na exceção (ver abaixo)
--   provisões de 13º/férias — acompanham a base, que é zero
--
-- O QUE CONTINUA:
--   benefícios de VALOR FIXO — plano de saúde, seguro de vida: seguem devidos
--   por CCT ou contrato e não dependem do salário
--
-- Daí a regra: no mês afastado o motor mantém só as verbas `VALOR_FIXO`. Ela
-- sai do tipo_calculo que já existe, em vez de codificar a lei — quando a
-- regra mudar, muda o cadastro da verba.
--
-- `afast_fim_*` nulo = indeterminado (afastado até o fim do ano orçado), que é
-- o caso comum de quem está em benefício sem alta prevista.
-- IDEMPOTENTE.
-- ============================================================

ALTER TABLE posto
  ADD COLUMN IF NOT EXISTS afast_ini_ano smallint,
  ADD COLUMN IF NOT EXISTS afast_ini_mes smallint,
  ADD COLUMN IF NOT EXISTS afast_fim_ano smallint,
  ADD COLUMN IF NOT EXISTS afast_fim_mes smallint,
  ADD COLUMN IF NOT EXISTS afast_motivo  text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posto_afast_mes_chk') THEN
    ALTER TABLE posto ADD CONSTRAINT posto_afast_mes_chk CHECK (
      (afast_ini_mes IS NULL OR afast_ini_mes BETWEEN 1 AND 12)
      AND (afast_fim_mes IS NULL OR afast_fim_mes BETWEEN 1 AND 12)
    );
  END IF;
  -- início exige ano E mês: um dos dois sozinho não define janela, e o motor
  -- o ignoraria em silêncio — o mesmo cuidado da v3_116
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posto_afast_ini_chk') THEN
    ALTER TABLE posto ADD CONSTRAINT posto_afast_ini_chk CHECK (
      num_nonnulls(afast_ini_ano, afast_ini_mes) <> 1
    );
  END IF;
END $$;

COMMENT ON COLUMN posto.afast_ini_ano IS
  'Afastado desde (ano). NULL = não afastado. Pode ser anterior ao ano orçado: quem já está afastado entra em janeiro.';
COMMENT ON COLUMN posto.afast_fim_ano IS
  'Previsão de retorno (ano). NULL = indeterminado — afastado até o fim do ano orçado.';
COMMENT ON COLUMN posto.afast_motivo IS
  'Texto livre (ex.: "auxílio-doença desde 08/2026, sem alta prevista"). Vira o rastro de por que o custo caiu.';

-- ------------------------------------------------------------
-- Qual benefício continua devido durante o afastamento
-- ------------------------------------------------------------
-- Salário, INSS, FGTS e provisões caem sozinhos: o motor zera a base do mês
-- afastado e a cascata inteira segue a base. Os `VALOR_FIXO` são os únicos que
-- não dependem dela, e aí a regra é verba a verba, não uma lei só:
--   continua  — plano de saúde, seguro de vida (devidos por CCT/contrato)
--   para      — vale-transporte, VA/VR (per capita por dia trabalhado)
-- Default `true` porque o erro conservador no orçamento é sobrar custo, não
-- faltar; o DP desmarca VT e VA/VR em Postos → Regras.
ALTER TABLE verba_folha
  ADD COLUMN IF NOT EXISTS mantem_afastado boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN verba_folha.mantem_afastado IS
  'VALOR_FIXO: o benefício continua devido no mês em que a pessoa está afastada? Ignorado nos outros tipos — eles seguem a base, que é zero.';

NOTIFY pgrst, 'reload schema';
