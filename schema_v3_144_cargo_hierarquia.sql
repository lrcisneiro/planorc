-- ============================================================
-- v3_144 — Cargo ganha hierarquia e nível
--
-- `cargo` era catálogo plano criado pelo import do RH (upsert por código) e
-- lido em dropdown — sem tela, sem estrutura. Agora:
--
--   `pai_id` — a árvore de carreira ("ANAL. NEGOCIO I → II → III → Coord").
--   `nivel`  — senioridade COMPARÁVEL entre ramos. É o que a profundidade da
--              árvore não dá: um "Analista III" de TI e um do Comercial são o
--              mesmo nível em subárvores diferentes. É também o que torna a
--              futura hierarquia de PESSOAS conferível ("este analista reporta
--              a outro do mesmo nível, confere?") em vez de só desenhável.
--
-- ⚠ CICLO é o único defeito grave possível aqui. Nada impede pôr o pai abaixo
-- do próprio filho, e aí a árvore vira laço: a tela recursa até travar e
-- qualquer consulta recursiva nunca termina. A tela barra no drop (ela conhece
-- os descendentes), mas a API é outro caminho — então a trava tem de estar no
-- banco. Gatilho, não CHECK: a verificação precisa subir a árvore, e CHECK não
-- enxerga outras linhas.
--
-- `ON DELETE SET NULL`: apagar um cargo pai promove os filhos à raiz, em vez de
-- apagá-los junto. Cargo tem posto apontando para ele; sumir com a subárvore
-- inteira por um delete é desproporcional.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE cargo ADD COLUMN IF NOT EXISTS pai_id uuid REFERENCES cargo(id) ON DELETE SET NULL;
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS nivel  smallint;

CREATE INDEX IF NOT EXISTS idx_cargo_pai ON cargo (pai_id) WHERE pai_id IS NOT NULL;

-- Sobe a árvore a partir do pai proposto: se reencontrar a própria linha, o
-- movimento fecha um laço. O limite de saltos é cinto de segurança — se um
-- ciclo já existisse (vindo de antes deste gatilho), o laço aqui não pararia.
CREATE OR REPLACE FUNCTION cargo_sem_ciclo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_pai uuid := NEW.pai_id; v_saltos int := 0;
BEGIN
  IF NEW.pai_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.pai_id = NEW.id THEN
    RAISE EXCEPTION 'Um cargo não pode ser pai de si mesmo.';
  END IF;
  WHILE v_pai IS NOT NULL AND v_saltos < 50 LOOP
    IF v_pai = NEW.id THEN
      RAISE EXCEPTION 'Movimento criaria um ciclo na árvore de cargos: % já está abaixo de %.',
        (SELECT nome FROM cargo WHERE id = NEW.pai_id), NEW.nome;
    END IF;
    SELECT pai_id INTO v_pai FROM cargo WHERE id = v_pai;
    v_saltos := v_saltos + 1;
  END LOOP;
  IF v_saltos >= 50 THEN
    RAISE EXCEPTION 'Árvore de cargos profunda demais ou já com ciclo — corrija antes de mover.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cargo_sem_ciclo ON cargo;
CREATE TRIGGER trg_cargo_sem_ciclo
  BEFORE INSERT OR UPDATE OF pai_id ON cargo
  FOR EACH ROW EXECUTE FUNCTION cargo_sem_ciclo();

SELECT 'colunas novas em cargo' AS secao,
       string_agg(column_name, ', ' ORDER BY column_name) AS resultado
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='cargo' AND column_name IN ('pai_id','nivel')
UNION ALL
SELECT 'gatilho anti-ciclo',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_cargo_sem_ciclo')
            THEN 'criado' ELSE '⛔ não criado' END
UNION ALL
SELECT 'cargos cadastrados', count(*)::text FROM cargo;
