-- ============================================================
-- F5 · Posto de Trabalho — categoria da verba (sobrescreve o padrão)
--
-- Por padrão a composição do custo classifica pela natureza do tipo_calculo
-- (BASE→Salário, PCT_BASE→Encargos, PROVISAO_1_12→Provisões, VALOR_FIXO→Benefícios).
-- Mas há casos como um VALOR_FIXO que COMPÕE o salário (entra na base de encargos):
-- nesse caso queremos que ele conte como "Salário" na composição, não "Benefícios".
-- `categoria` (opcional) força a classificação; NULL = usa o padrão do tipo_calculo.
-- Idempotente.
-- ============================================================

ALTER TABLE verba_folha
  ADD COLUMN IF NOT EXISTS categoria text
    CHECK (categoria IN ('SALARIO', 'ENCARGOS', 'PROVISOES', 'BENEFICIOS'));
