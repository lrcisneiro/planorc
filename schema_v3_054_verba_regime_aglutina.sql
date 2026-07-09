-- ============================================================
-- F5 · Posto de Trabalho — AJUSTES 09/jul: regime + aglutina_em
--
-- verba_folha.regime      : a que regime a regra se aplica (CLT/PRESTADOR/PROLABORE).
--                           Encargos/provisões/benefícios = CLT; terceiros = PRESTADOR.
-- verba_folha.aglutina_em : de-para código ERP → CÓDIGO da verba orçamentária
--                           AGREGADA (ex.: bônus/comissões → VAR). Orçamento limpo
--                           nas agregadas; realizado abre por código e a conciliação
--                           usa este de-para. Verbas de-para = tipo INFORMATIVA.
-- posto.regime            : define QUAIS verbas o motor aplica ao posto (a VERBA é
--                           quem direciona a conta orçamentária destino).
--
-- Idempotente. Ref.: docs/DESIGN_posto_trabalho.md (AJUSTES 09/jul).
-- ============================================================

ALTER TABLE verba_folha
  ADD COLUMN IF NOT EXISTS regime      text CHECK (regime IN ('CLT','PRESTADOR','PROLABORE')),
  ADD COLUMN IF NOT EXISTS aglutina_em text;   -- código da verba agregada (de-para conciliação)

ALTER TABLE posto
  ADD COLUMN IF NOT EXISTS regime text CHECK (regime IN ('CLT','PRESTADOR','PROLABORE'));
