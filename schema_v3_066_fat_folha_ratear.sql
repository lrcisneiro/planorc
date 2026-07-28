-- ============================================================
-- fat_folha.ratear — flag da coluna `rateio` do template de import da folha
-- (decisões de 28/jul, docs/DESIGN_posto_trabalho.md).
--
-- Define se a CONCILIAÇÃO aplica o motor de rateio à linha do realizado:
--   false (default, coluna `rateio` branca ou 'N') = a linha JÁ está rateada —
--          o CC/empresa da linha é o destino final (como a contabilidade lançou);
--   true  (coluna `rateio` = 'S')                  = ratear pelo cadastro do posto
--          (rateio_regra/rateio_destino) na conciliação.
--
-- Gravado aqui para a conciliação não depender de reprocessar o arquivo.
-- O default NUNCA rateia por acidente — ratear é decisão explícita do arquivo.
-- ============================================================
ALTER TABLE fat_folha
  ADD COLUMN IF NOT EXISTS ratear boolean NOT NULL DEFAULT false;
