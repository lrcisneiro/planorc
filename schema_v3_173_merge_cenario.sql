-- ============================================================
-- v3_173 — Liberar o cenário na baseline (B3): o merge
--
-- A parte perigosa. Escreve no orçamento oficial, então todas as decisões
-- daqui são sobre o que NÃO fazer.
--
-- ⚠⚠ PRIMEIRO, UMA CORREÇÃO: `fat_orcado.atualizado_em` NUNCA ERA ATUALIZADO.
-- Tinha default `now()` e nenhum caminho de escrita o tocava — nem a grade nem
-- o drill o enviam no `update`. Isto é, uma coluna chamada "atualizado_em" que
-- só sabia a hora do INSERT. `formulario_valor` já tinha o gatilho de touch;
-- esta não. O merge DEPENDE dela (é como se distingue a célula que o cenário
-- propôs da que veio no semear), então o gatilho entra aqui.
--
-- **Como se sabe o que o cenário propôs.** `copiar_versao` cria a versão e
-- semeia na MESMA transação, então `now()` é idêntico nos dois: a célula
-- semeada nasce com `atualizado_em = versao.criado_em`, exatamente. Toda
-- escrita posterior move a coluna. Logo: `atualizado_em > criado_em` é "esta
-- célula foi mexida depois do semear" — e não "difere da baseline", que é o
-- teste ingênuo e **devolve a célula errada**:
--
-- > Baseline *Viagens* jan 10 mil, semeada igual. O gerente muda janeiro para
-- > 12; a controladoria ajusta MARÇO da baseline para 15. Em março o cenário
-- > (10) difere da baseline (15) — e "o que difere" devolveria março para 10,
-- > apagando o ajuste da controladoria sem dizer nada.
--
-- ⚠ SÓ ORIGEM `MANUAL`. Em 2027 o orçado é POSTO 13.140 · FORMULARIO 5.680 ·
-- MANUAL 5.634: 70% é gerado, e gerado é regerado — o *Aplicar* dos postos
-- substitui tudo que é POSTO da versão. Mergear valor gerado criaria um número
-- que passa pela aprovação e some na próxima aplicação, calado.
--
-- ⚠ ZERAR TAMBÉM É ALTERAÇÃO: célula que existe na baseline e não existe no
-- cenário é proposta de APAGAR. Tratar só o que existe no cenário a perderia.
-- Mas só se ela já existia no semear — baseline criada DEPOIS é trabalho novo
-- da controladoria, não proposta de exclusão, e essa fica e é reportada.
--
-- ⚠ PRÉVIA ANTES: `p_simular` é o DEFAULT. Importação sem prévia é importação
-- que se descobre pelo estrago (lição da v3_149).
--
-- Termina em SELECT.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A coluna que mentia
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fat_orcado_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS fat_orcado_touch ON fat_orcado;
-- Só no UPDATE: o INSERT já tem o default, e assim o semear de 24 mil células
-- não paga chamada de função nenhuma.
CREATE TRIGGER fat_orcado_touch BEFORE UPDATE ON fat_orcado
  FOR EACH ROW EXECUTE FUNCTION trg_fat_orcado_touch();

-- ------------------------------------------------------------
-- 2. Carimbo de liberação, para não mesclar duas vezes
-- ------------------------------------------------------------
ALTER TABLE versao_orcamento ADD COLUMN IF NOT EXISTS mesclado_em  timestamptz;
ALTER TABLE versao_orcamento ADD COLUMN IF NOT EXISTS mesclado_por uuid;

-- ------------------------------------------------------------
-- 3. O merge
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mesclar_cenario_orcado(
  p_versao uuid, p_simular boolean DEFAULT true
) RETURNS TABLE(acao text, celulas bigint, valor numeric, detalhe text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := current_tenant_id();
  v record;
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- Quem libera é quem aprova: escrever na baseline é ato da controladoria.
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para liberar cenário.' USING ERRCODE = '42501';
  END IF;

  SELECT id, origem_versao_id, ano, aprovado_em, criado_em, mesclado_em, codigo
    INTO v FROM versao_orcamento WHERE id = p_versao AND tenant_id = t;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Cenário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.origem_versao_id IS NULL THEN
    RAISE EXCEPTION 'A versão % é uma baseline, não um cenário.', v.codigo USING ERRCODE = '22023';
  END IF;
  IF v.aprovado_em IS NULL THEN
    RAISE EXCEPTION 'O cenário % ainda não foi fechado. Feche a aprovação antes de liberar.', v.codigo
      USING ERRCODE = '22023';
  END IF;
  IF v.mesclado_em IS NOT NULL AND NOT p_simular THEN
    RAISE EXCEPTION 'O cenário % já foi liberado em %.', v.codigo, v.mesclado_em USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM versao_orcamento b WHERE b.id = v.origem_versao_id AND b.bloqueada) THEN
    RAISE EXCEPTION 'A baseline está bloqueada.' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _merge;
  CREATE TEMP TABLE _merge ON COMMIT DROP AS
  WITH aprovadas AS (
    SELECT ov.linha_id FROM orcado_veredito ov
     WHERE ov.versao_id = p_versao AND ov.tenant_id = t AND ov.aprovado IS TRUE
  ),
  c AS (   -- lado do cenário: só MANUAL, só linha aprovada
    SELECT o.id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
           o.dims::text AS dimst, o.valor, o.atualizado_em
      FROM fat_orcado o JOIN aprovadas a ON a.linha_id = o.linha_id
     WHERE o.versao_id = p_versao AND o.tenant_id = t AND o.ano = v.ano
       AND o.origem = 'MANUAL'
  ),
  b AS (   -- lado da baseline: TODAS as origens, porque é preciso reconhecer
           -- quando a proposta cai em cima de valor gerado
    SELECT o.id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
           o.dims::text AS dimst, o.valor, o.atualizado_em, o.origem
      FROM fat_orcado o JOIN aprovadas a ON a.linha_id = o.linha_id
     WHERE o.versao_id = v.origem_versao_id AND o.tenant_id = t AND o.ano = v.ano
  )
  SELECT
    c.id AS cen_id, b.id AS base_id,
    coalesce(c.linha_id, b.linha_id) AS linha_id,
    coalesce(c.valor, 0) - coalesce(b.valor, 0) AS delta,
    CASE
      -- proposta: a célula do cenário foi mexida depois do semear
      WHEN c.id IS NOT NULL AND c.atualizado_em > v.criado_em THEN
        CASE
          WHEN b.id IS NOT NULL AND b.origem <> 'MANUAL'          THEN 'sobre_gerada'
          WHEN b.id IS NOT NULL AND b.atualizado_em > v.criado_em THEN 'conflito'
          ELSE 'gravar'
        END
      -- sumiu do cenário: proposta de apagar, se já existia no semear
      WHEN c.id IS NULL AND b.id IS NOT NULL AND b.origem = 'MANUAL' THEN
        CASE WHEN b.atualizado_em > v.criado_em THEN 'nao_apagada' ELSE 'apagar' END
      ELSE 'ignorar'
    END AS acao
  FROM c FULL JOIN b
    ON  b.linha_id   = c.linha_id
    AND b.empresa_id = c.empresa_id
    AND coalesce(b.filial_id, z) = coalesce(c.filial_id, z)
    AND coalesce(b.cc_id, z)     = coalesce(c.cc_id, z)
    AND b.ano = c.ano AND b.mes = c.mes AND b.dimst = c.dimst;

  IF NOT p_simular THEN
    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, dims, moeda_origem, val_m2, val_m3, val_m4, val_m5)
    SELECT o.tenant_id, v.origem_versao_id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id,
           o.ano, o.mes, o.valor, o.expressao, 'MANUAL', o.dims, o.moeda_origem,
           o.val_m2, o.val_m3, o.val_m4, o.val_m5
      FROM _merge m JOIN fat_orcado o ON o.id = m.cen_id
     WHERE m.acao IN ('gravar', 'conflito', 'sobre_gerada')
    ON CONFLICT (versao_id, linha_id, empresa_id,
                 COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(cc_id,     '00000000-0000-0000-0000-000000000000'::uuid),
                 ano, mes, ((dims)::text))
    DO UPDATE SET valor = EXCLUDED.valor, expressao = EXCLUDED.expressao,
                  origem = 'MANUAL', moeda_origem = EXCLUDED.moeda_origem,
                  val_m2 = EXCLUDED.val_m2, val_m3 = EXCLUDED.val_m3,
                  val_m4 = EXCLUDED.val_m4, val_m5 = EXCLUDED.val_m5;

    DELETE FROM fat_orcado o
     WHERE o.id IN (SELECT base_id FROM _merge WHERE acao = 'apagar');

    UPDATE versao_orcamento SET mesclado_em = now(), mesclado_por = auth.uid()
     WHERE id = p_versao;
  END IF;

  RETURN QUERY
  SELECT m.acao,
         count(*)::bigint,
         round(sum(m.delta)::numeric, 2),
         CASE m.acao
           WHEN 'gravar'       THEN 'Gravadas na baseline'
           WHEN 'conflito'     THEN 'Gravadas — ⚠ a baseline havia mudado desde o semear; confira o que foi sobrescrito'
           WHEN 'sobre_gerada' THEN 'Gravadas — ⚠ por cima de valor gerado (posto/formulário): a próxima aplicação daquela origem sobrescreve'
           WHEN 'apagar'       THEN 'Apagadas da baseline (a proposta era zerar)'
           WHEN 'nao_apagada'  THEN 'NÃO apagadas — a baseline mudou depois do semear; é trabalho novo da controladoria'
           ELSE 'Sem alteração'
         END
    FROM _merge m
   WHERE m.acao <> 'ignorar'
   GROUP BY m.acao
   ORDER BY m.acao;
END $$;

REVOKE ALL ON FUNCTION mesclar_cenario_orcado(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION mesclar_cenario_orcado(uuid, boolean) TO authenticated;

SELECT 'v3_173 aplicada' AS resultado,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'fat_orcado_touch') AS gatilho_touch,
       (SELECT count(*) FROM pg_proc WHERE proname = 'mesclar_cenario_orcado') AS fn_merge,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='versao_orcamento' AND column_name='mesclado_em') AS col_mesclado;
