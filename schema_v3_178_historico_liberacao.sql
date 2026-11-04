-- ============================================================
-- v3_178 — Histórico do que foi liberado na baseline
--
-- ⚠ LACUNA: o merge gravava em `fat_orcado` e deixava como rastro apenas
-- `mesclado_em`/`mesclado_por` na versão — "alguém liberou, tal dia". O QUE
-- foi escrito sumia. E a tabela `auditoria` não cobre: o gatilho de
-- `fat_orcado` só registra DELETE em massa, então um merge que grava 400
-- células não aparece em lugar nenhum.
--
-- Isto é pior do que parece: a liberação **não tem desfazer**. Sem registro,
-- a pergunta "por que esta linha da baseline mudou?" não tinha resposta — nem
-- para quem aprovou.
--
-- Guarda-se o relatório que a prévia já calculava: cabeçalho (quem, quando,
-- contra qual baseline, quem havia aprovado) e uma linha por LINHA do
-- relatório, com a ação e o Δ. Não é cópia das células — são ~200 linhas por
-- liberação, não 24 mil — e responde o que se pergunta de verdade: quais
-- linhas mudaram, quanto, e com qual aviso.
--
-- ⚠ Escrita SÓ pela RPC (lição da v3_174): `authenticated` tem `SELECT` e mais
-- nada. Registro de auditoria que o auditado pode editar não é registro.
--
-- Termina em SELECT.
-- ============================================================

CREATE TABLE IF NOT EXISTS cenario_liberacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  versao_id     uuid NOT NULL REFERENCES versao_orcamento(id) ON DELETE CASCADE,
  baseline_id   uuid NOT NULL REFERENCES versao_orcamento(id),
  quando        timestamptz NOT NULL DEFAULT now(),
  quem          uuid,
  aprovado_em   timestamptz,     -- o carimbo que autorizou esta liberação
  aprovado_por  uuid,
  celulas       bigint NOT NULL DEFAULT 0,
  delta_total   numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cenario_liberacao_linha (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  liberacao_id uuid NOT NULL REFERENCES cenario_liberacao(id) ON DELETE CASCADE,
  linha_id     uuid REFERENCES conta_orcamentaria(id),
  acao         text NOT NULL,
  celulas      bigint NOT NULL,
  delta        numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cen_liberacao_versao ON cenario_liberacao (tenant_id, versao_id);
CREATE INDEX IF NOT EXISTS idx_cen_liberacao_linha  ON cenario_liberacao_linha (liberacao_id);

ALTER TABLE cenario_liberacao       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cenario_liberacao_linha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cenario_liberacao_sel ON cenario_liberacao;
CREATE POLICY cenario_liberacao_sel ON cenario_liberacao FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

DROP POLICY IF EXISTS cenario_liberacao_linha_sel ON cenario_liberacao_linha;
CREATE POLICY cenario_liberacao_linha_sel ON cenario_liberacao_linha FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

-- Só leitura: quem escreve é a função, que roda como dono.
REVOKE ALL ON cenario_liberacao       FROM authenticated;
REVOKE ALL ON cenario_liberacao_linha FROM authenticated;
GRANT SELECT ON cenario_liberacao       TO authenticated;
GRANT SELECT ON cenario_liberacao_linha TO authenticated;

-- ------------------------------------------------------------
-- O merge passa a registrar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mesclar_cenario_orcado(
  p_versao uuid, p_simular boolean DEFAULT true
) RETURNS TABLE(acao text, celulas bigint, valor numeric, detalhe text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := current_tenant_id();
  v record;
  z uuid := '00000000-0000-0000-0000-000000000000';
  v_lib uuid;
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para liberar cenário.' USING ERRCODE = '42501';
  END IF;

  SELECT id, origem_versao_id, ano, aprovado_em, aprovado_por, criado_em,
         mesclado_em, semeado_em, codigo
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
  IF EXISTS (SELECT 1 FROM versao_orcamento bl WHERE bl.id = v.origem_versao_id AND bl.bloqueada) THEN
    RAISE EXCEPTION 'A baseline está bloqueada.' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _merge;
  CREATE TEMP TABLE _merge ON COMMIT DROP AS
  WITH aprovadas AS (
    SELECT ov.linha_id FROM orcado_veredito ov
     WHERE ov.versao_id = p_versao AND ov.tenant_id = t AND ov.aprovado IS TRUE
  ),
  c AS (
    SELECT o.id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
           o.dims::text AS dimst, o.valor, o.atualizado_em
      FROM fat_orcado o JOIN aprovadas a ON a.linha_id = o.linha_id
     WHERE o.versao_id = p_versao AND o.tenant_id = t AND o.ano = v.ano
       AND o.origem = 'MANUAL'
  ),
  b AS (
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
      WHEN c.id IS NOT NULL AND c.atualizado_em > v.criado_em THEN
        CASE
          WHEN b.id IS NOT NULL AND b.origem <> 'MANUAL'          THEN 'sobre_gerada'
          WHEN b.id IS NOT NULL AND b.atualizado_em > v.criado_em THEN 'conflito'
          ELSE 'gravar'
        END
      WHEN v.semeado_em IS NOT NULL
           AND c.id IS NULL AND b.id IS NOT NULL AND b.origem = 'MANUAL' THEN
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
     WHERE o.id IN (SELECT m.base_id FROM _merge m WHERE m.acao = 'apagar');

    -- O registro vai ANTES de carimbar: se algo falhar aqui, a transação
    -- inteira volta e a versão não fica marcada como liberada sem histórico.
    INSERT INTO cenario_liberacao
      (tenant_id, versao_id, baseline_id, quem, aprovado_em, aprovado_por, celulas, delta_total)
    SELECT t, p_versao, v.origem_versao_id, auth.uid(), v.aprovado_em, v.aprovado_por,
           count(*), coalesce(round(sum(m.delta)::numeric, 2), 0)
      FROM _merge m WHERE m.acao <> 'ignorar'
    RETURNING id INTO v_lib;

    INSERT INTO cenario_liberacao_linha (tenant_id, liberacao_id, linha_id, acao, celulas, delta)
    SELECT t, v_lib, m.linha_id, m.acao, count(*), coalesce(round(sum(m.delta)::numeric, 2), 0)
      FROM _merge m WHERE m.acao <> 'ignorar'
     GROUP BY m.linha_id, m.acao;

    UPDATE versao_orcamento SET mesclado_em = now(), mesclado_por = auth.uid()
     WHERE id = p_versao;
  END IF;

  RETURN QUERY
  SELECT m.acao, count(*)::bigint, round(sum(m.delta)::numeric, 2),
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

-- Leitura do histórico, com o código da linha resolvido para a tela.
CREATE OR REPLACE VIEW vw_cenario_liberacao AS
SELECT l.id, l.tenant_id, l.versao_id, l.quando, l.quem, l.aprovado_em, l.aprovado_por,
       l.celulas, l.delta_total,
       bl.codigo AS baseline_codigo, cz.codigo AS cenario_codigo
  FROM cenario_liberacao l
  JOIN versao_orcamento bl ON bl.id = l.baseline_id
  JOIN versao_orcamento cz ON cz.id = l.versao_id
 WHERE l.tenant_id = (SELECT current_tenant_id());

GRANT SELECT ON vw_cenario_liberacao TO authenticated;

SELECT 'v3_178 aplicada' AS resultado,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_name IN ('cenario_liberacao','cenario_liberacao_linha')) AS tabelas,
       (SELECT CASE WHEN prosrc LIKE '%cenario_liberacao%' THEN 'sim' ELSE 'NÃO' END
          FROM pg_proc WHERE proname='mesclar_cenario_orcado') AS merge_registra;
