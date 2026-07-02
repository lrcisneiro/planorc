-- ============================================================
-- F5 (correção): re-aponta formulario_linha.conta_destino_id para a
-- conta ORÇAMENTÁRIA mestre (conta_orcamentaria), que é o grão de
-- fat_orcado.linha_id.
--
-- Necessário quando a tabela `formulario_linha` já existia de um schema
-- ANTIGO (o arquivo não-numerado schema_v3_relatorio_formulario.sql, onde
-- conta_destino_id → conta_contabil): nesse caso o CREATE TABLE IF NOT EXISTS
-- da 049 pulou a criação e a FK ficou apontando para a tabela errada, gerando
-- "violates foreign key constraint formulario_linha_conta_destino_id_fkey"
-- ao gravar um id de conta_orcamentaria.
--
-- Idempotente: derruba qualquer FK existente sobre conta_destino_id e recria
-- referenciando conta_orcamentaria. Seguro mesmo se a FK já estava correta.
-- ============================================================
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
   WHERE conrelid = 'formulario_linha'::regclass AND contype = 'f'
     AND pg_get_constraintdef(oid) ILIKE '%conta_destino_id%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE formulario_linha DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE formulario_linha
    ADD CONSTRAINT formulario_linha_conta_destino_id_fkey
    FOREIGN KEY (conta_destino_id) REFERENCES conta_orcamentaria ON DELETE SET NULL;
END $$;
