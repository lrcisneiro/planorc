-- ============================================================
-- 110 — Quantidade na folha (horas)
--
-- A folha grava as verbas de hora com QUANTIDADE e valor separados: a 222
-- (hora normal) e a 223 (traslado) entram com quantidade = horas apontadas e
-- valor = valor-hora do CADASTRO do funcionário (OEFOLM02.PRW, RetValHr).
--
-- Isso importa porque a conciliação contra o apontamento é em HORAS, não em
-- valor: o extrato de apontamento traz CUSTO_HORA, que é outra taxa para a
-- mesma hora. Comparar valor compara duas moedas diferentes — medido, deixava
-- ~353 mil sem explicação; em horas, a diferença cai para 1,4 hora.
--
-- O `prgper02` sempre trouxe HORAS_DIAS; era o conversor que descartava.
--
-- Idempotente. Depois de rodar, reimporte a competência para preencher.
-- ============================================================

ALTER TABLE fat_folha
  ADD COLUMN IF NOT EXISTS horas numeric(14,2);

COMMENT ON COLUMN fat_folha.horas IS
  'Quantidade da verba (HORAS_DIAS do prgper02). Nas verbas de hora (222/223) é a hora apontada; nas demais, a quantidade que a folha usou.';
