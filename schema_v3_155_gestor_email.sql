-- ============================================================
-- v3_155 — Liderança e e-mail no cadastro de pessoas
--
-- O RH entregou a relação com LÍDER IMEDIATO e e-mail. Isso destrava o
-- organograma de chefia, que era o pedido original — e que ficou parado porque
-- `posto` não guardava gestor e não havia de onde tirar.
--
-- **Na PESSOA e não no posto**, como decidido: o Marco tem quatro postos
-- (pró-labore em quatro empresas) e UM gestor. Guardar no posto faria quatro
-- respostas para uma pergunta só, e é o mesmo erro que a matrícula cometia.
-- ⚠ O custo: matricial de verdade — reportar a chefes diferentes conforme o
-- vínculo — não é representável. Nos dados de hoje não ocorre.
--
-- `email` entra junto porque é a CHAVE da relação: o arquivo identifica o líder
-- pelo e-mail dele, não por nome. Sem guardar, toda carga futura volta a
-- depender de casar nome com nome — que foi o trabalho desta.
-- Corporativo, não documento: fica legível (diferente de `cpf`, revogado na
-- v3_150), porque identifica pessoa na tela e não serve de dado sensível.
--
-- ⚠ CICLO: A reporta a B que reporta a A trava qualquer árvore. Mesma trava de
-- `cargo` e `area_funcional`, pelo mesmo motivo — e aqui é mais provável, já
-- que a hierarquia vem de planilha preenchida à mão.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS email     text;
ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS gestor_id uuid REFERENCES funcionario(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE funcionario ADD CONSTRAINT funcionario_email_uq UNIQUE (tenant_id, email);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_funcionario_gestor ON funcionario (gestor_id) WHERE gestor_id IS NOT NULL;

-- Privilégio por regra, como em `posto` (v3_148): nega o que É sensível e
-- concede o resto. Re-executável — é o que impede coluna nova de cair no balde
-- dos negados por omissão, que foi o que houve com `area_func_id`.
DO $$
DECLARE c record; sensiveis text[] := ARRAY['cpf'];
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='funcionario'
              AND NOT (column_name = ANY(sensiveis))
  LOOP EXECUTE format('GRANT SELECT (%I) ON funcionario TO authenticated', c.column_name); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION funcionario_sem_ciclo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v uuid := NEW.gestor_id; n int := 0;
BEGIN
  IF NEW.gestor_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.gestor_id = NEW.id THEN
    RAISE EXCEPTION 'Uma pessoa não pode ser gestora de si mesma (%).', NEW.nome;
  END IF;
  WHILE v IS NOT NULL AND n < 60 LOOP
    IF v = NEW.id THEN
      RAISE EXCEPTION 'Ciclo na hierarquia: % já está abaixo de %.',
        (SELECT nome FROM funcionario WHERE id = NEW.gestor_id), NEW.nome;
    END IF;
    SELECT gestor_id INTO v FROM funcionario WHERE id = v;
    n := n + 1;
  END LOOP;
  IF n >= 60 THEN RAISE EXCEPTION 'Hierarquia profunda demais ou já com ciclo — corrija antes.'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_funcionario_sem_ciclo ON funcionario;
CREATE TRIGGER trg_funcionario_sem_ciclo
  BEFORE INSERT OR UPDATE OF gestor_id ON funcionario
  FOR EACH ROW EXECUTE FUNCTION funcionario_sem_ciclo();

SELECT 'colunas novas' AS secao,
       string_agg(column_name, ', ' ORDER BY column_name) AS resultado
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='funcionario' AND column_name IN ('email','gestor_id')
UNION ALL
SELECT 'gatilho anti-ciclo',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_funcionario_sem_ciclo')
            THEN 'criado' ELSE '⛔ não' END
UNION ALL
SELECT 'colunas de funcionario sem SELECT (esperado: cpf)',
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma')
  FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='funcionario'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name='funcionario' AND g.column_name=c.column_name
                      AND g.grantee='authenticated' AND g.privilege_type='SELECT');
