-- ============================================================
-- F2 — Repontar os fatos para a estrutura compartilhada.
-- fat_orcado.linha_id e conta_linha.linha_id passam a referenciar
-- linha_orcamentaria (em vez de relatorio_linha), casando pelo
-- relatorio_linha.linha_orc_id preenchido na F1.
-- Rodar SÓ depois da F1 (009) e com a verificação (008) limpa.
-- IMPORTANTE: rode junto com o deploy do código novo do app.
-- ============================================================
BEGIN;

-- ---------- fat_orcado ----------
-- 1) remove a FK antiga (qualquer nome) que aponta p/ relatorio_linha
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'fat_orcado'::regclass AND contype = 'f'
             AND confrelid = 'relatorio_linha'::regclass
  LOOP EXECUTE format('ALTER TABLE fat_orcado DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;

-- 2) repontar os valores (linha do relatório -> linha mestre)
UPDATE fat_orcado fo
SET linha_id = rl.linha_orc_id
FROM relatorio_linha rl
WHERE rl.id = fo.linha_id AND rl.linha_orc_id IS NOT NULL;

-- 3) nova FK -> linha_orcamentaria
ALTER TABLE fat_orcado
  ADD CONSTRAINT fat_orcado_linha_id_fkey
  FOREIGN KEY (linha_id) REFERENCES linha_orcamentaria ON DELETE CASCADE;

-- ---------- conta_linha ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'conta_linha'::regclass AND contype = 'f'
             AND confrelid = 'relatorio_linha'::regclass
  LOOP EXECUTE format('ALTER TABLE conta_linha DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;

UPDATE conta_linha cl
SET linha_id = rl.linha_orc_id
FROM relatorio_linha rl
WHERE rl.id = cl.linha_id AND rl.linha_orc_id IS NOT NULL;

ALTER TABLE conta_linha
  ADD CONSTRAINT conta_linha_linha_id_fkey
  FOREIGN KEY (linha_id) REFERENCES linha_orcamentaria ON DELETE CASCADE;

-- ---------- fat_realizado (linha_id é nullable; quase sempre null) ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'fat_realizado'::regclass AND contype = 'f'
             AND confrelid = 'relatorio_linha'::regclass
  LOOP EXECUTE format('ALTER TABLE fat_realizado DROP CONSTRAINT %I', r.conname); END LOOP;
END $$;

UPDATE fat_realizado fr
SET linha_id = rl.linha_orc_id
FROM relatorio_linha rl
WHERE rl.id = fr.linha_id AND rl.linha_orc_id IS NOT NULL;

ALTER TABLE fat_realizado
  ADD CONSTRAINT fat_realizado_linha_id_fkey
  FOREIGN KEY (linha_id) REFERENCES linha_orcamentaria ON DELETE SET NULL;

COMMIT;

-- Conferência (devem dar 0):
-- SELECT count(*) FROM fat_orcado fo  LEFT JOIN linha_orcamentaria lo ON lo.id = fo.linha_id WHERE lo.id IS NULL;
-- SELECT count(*) FROM conta_linha cl LEFT JOIN linha_orcamentaria lo ON lo.id = cl.linha_id WHERE lo.id IS NULL;
