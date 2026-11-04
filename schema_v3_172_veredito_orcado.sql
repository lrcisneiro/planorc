-- ============================================================
-- v3_172 — Veredito por LINHA no cenário de orçamento (B2)
--
-- Irmão de `posto_versao.aprovado` (v3_166), mesma mecânica provada em uso:
-- ✓/✗ por item, recusa exige motivo, dois campos de nota (um de quem propõe,
-- outro de quem aprova), e o carimbo da versão como trava do conjunto.
--
-- **Por LINHA e não por célula.** São 82 linhas com orçado contra ~89 mil
-- células. E a conversa real é "esse aumento de viagens não passa", não "a
-- célula de março da filial 2002 não passa".
--
-- ⚠ `linha_id` é `conta_orcamentaria` (o MASTER), como em `fat_orcado` — não
-- `relatorio_linha`. Veredito preso a relatório morreria ao comparar a mesma
-- proposta por outra DRE, e os dois lados são `uuid`: trocar não dá erro,
-- devolve vazio.
--
-- ⚠ O QUE TRAVA É O PENDENTE, nunca a recusa (lição da v3_169). Recusar é
-- decidir: a linha fica com a baseline. Exigir unanimidade prenderia o
-- aprovador à espera de ação de terceiro.
--
-- ⚠ O conjunto que precisa de veredito é CALCULADO, não cadastrado: são as
-- linhas cujo total difere da baseline. Por isso `cenario_orcado_pendentes`
-- refaz o diff — guardar a lista no momento da proposta a deixaria velha na
-- primeira edição seguinte, e aí o carimbo certificaria um conjunto que não
-- existe mais.
--
-- ⚠ DOIS GATILHOS derrubam o carimbo (v3_165 + v3_170 de uma vez): mexer no
-- `fat_orcado` do cenário e mexer no veredito. Os dois só escrevem quando JÁ
-- existe carimbo — durante a proposta e a revisão não custam nada, e semear
-- 24 mil células numa versão recém-criada não dispara escrita nenhuma.
--
-- Termina em SELECT.
-- ============================================================

CREATE TABLE IF NOT EXISTS orcado_veredito (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  versao_id  uuid NOT NULL REFERENCES versao_orcamento(id) ON DELETE CASCADE,
  linha_id   uuid NOT NULL REFERENCES conta_orcamentaria(id) ON DELETE CASCADE,
  aprovado   boolean,                 -- NULL = pendente, ninguém olhou
  nota       text,                    -- de quem PROPÕE (resposta a uma recusa)
  aprov_nota text,                    -- de quem APROVA (motivo da recusa)
  aprov_em   timestamptz,
  aprov_por  uuid,
  UNIQUE (versao_id, linha_id)
);

CREATE INDEX IF NOT EXISTS idx_orcado_veredito_versao
  ON orcado_veredito (tenant_id, versao_id);

ALTER TABLE orcado_veredito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcado_veredito_sel ON orcado_veredito;
CREATE POLICY orcado_veredito_sel ON orcado_veredito FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

-- Escrita por comando, nunca FOR ALL (armadilha 1 da ACS-02: FOR ALL inclui
-- SELECT e políticas permissivas se combinam com OU).
DROP POLICY IF EXISTS orcado_veredito_ins ON orcado_veredito;
CREATE POLICY orcado_veredito_ins ON orcado_veredito FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()));

DROP POLICY IF EXISTS orcado_veredito_upd ON orcado_veredito;
CREATE POLICY orcado_veredito_upd ON orcado_veredito FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()));

DROP POLICY IF EXISTS orcado_veredito_del ON orcado_veredito;
CREATE POLICY orcado_veredito_del ON orcado_veredito FOR DELETE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()));

GRANT SELECT, INSERT, UPDATE, DELETE ON orcado_veredito TO authenticated;

-- ------------------------------------------------------------
-- O diff: quanto cada linha pesa no cenário contra a baseline
-- ------------------------------------------------------------
-- SECURITY DEFINER de propósito: a completude do conjunto não pode depender do
-- escopo de quem pergunta. Se o aprovador enxergasse metade, carimbaria com a
-- outra metade pendente sem saber — e o carimbo diz "revisei este conjunto".
CREATE OR REPLACE FUNCTION cenario_orcado_diff(p_versao uuid)
RETURNS TABLE(linha_id uuid, base numeric, cenario numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (
    SELECT id, origem_versao_id, ano FROM versao_orcamento
     WHERE id = p_versao AND tenant_id = current_tenant_id()
  ), b AS (
    SELECT o.linha_id, sum(o.valor) AS t FROM fat_orcado o, v
     WHERE o.versao_id = v.origem_versao_id AND o.ano = v.ano
       AND o.tenant_id = current_tenant_id()
     GROUP BY o.linha_id
  ), c AS (
    SELECT o.linha_id, sum(o.valor) AS t FROM fat_orcado o, v
     WHERE o.versao_id = v.id AND o.ano = v.ano
       AND o.tenant_id = current_tenant_id()
     GROUP BY o.linha_id
  )
  -- FULL JOIN porque zerar também é alteração: linha que existe na baseline e
  -- sumiu do cenário é proposta de apagar, e um INNER a perderia calada.
  SELECT coalesce(b.linha_id, c.linha_id), coalesce(b.t, 0), coalesce(c.t, 0)
    FROM b FULL JOIN c ON c.linha_id = b.linha_id
   WHERE abs(coalesce(c.t, 0) - coalesce(b.t, 0)) > 0.005
$$;
REVOKE ALL ON FUNCTION cenario_orcado_diff(uuid) FROM public;
GRANT EXECUTE ON FUNCTION cenario_orcado_diff(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION cenario_orcado_pendentes(p_versao uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM cenario_orcado_diff(p_versao) d
   WHERE NOT EXISTS (
     SELECT 1 FROM orcado_veredito ov
      WHERE ov.versao_id = p_versao AND ov.linha_id = d.linha_id
        AND ov.aprovado IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION cenario_orcado_pendentes(uuid) FROM public;
GRANT EXECUTE ON FUNCTION cenario_orcado_pendentes(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Decidir uma linha (aprovador) e reabrir (quem propõe)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION decidir_linha_orcado(
  p_versao uuid, p_linha uuid, p_aprovado boolean, p_nota text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar cenário.' USING ERRCODE = '42501';
  END IF;
  -- Recusar EXIGE motivo: "não passa" sem razão devolve o trabalho a quem
  -- propôs sem dizer o que mudar.
  IF p_aprovado IS FALSE AND btrim(coalesce(p_nota, '')) = '' THEN
    RAISE EXCEPTION 'Recusar exige motivo.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO orcado_veredito (tenant_id, versao_id, linha_id, aprovado, aprov_nota, aprov_em, aprov_por)
  VALUES (current_tenant_id(), p_versao, p_linha, p_aprovado,
          nullif(btrim(coalesce(p_nota, '')), ''), now(), auth.uid())
  ON CONFLICT (versao_id, linha_id) DO UPDATE
     SET aprovado   = EXCLUDED.aprovado,
         aprov_nota = EXCLUDED.aprov_nota,
         aprov_em   = now(),
         aprov_por  = auth.uid();
END $$;
REVOKE ALL ON FUNCTION decidir_linha_orcado(uuid, uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION decidir_linha_orcado(uuid, uuid, boolean, text) TO authenticated;

-- Responder a uma recusa e reenviar são o MESMO ato (v3_167/168): a resposta
-- costuma ser texto, nenhum número muda, e sem isto o veredito ficaria
-- recusado para sempre. Mantém `aprov_nota` — apagar a objeção faria o
-- aprovador reler sem lembrar o que ele mesmo havia pedido.
CREATE OR REPLACE FUNCTION reabrir_linha_orcado(
  p_versao uuid, p_linha uuid, p_nota text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_escrever() THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar o cenário.' USING ERRCODE = '42501';
  END IF;
  UPDATE orcado_veredito
     SET aprovado = NULL,
         nota     = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota)
   WHERE versao_id = p_versao AND linha_id = p_linha
     AND tenant_id = current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION reabrir_linha_orcado(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION reabrir_linha_orcado(uuid, uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- aprovar_cenario passa a contar as DUAS pendências
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION aprovar_cenario(p_versao uuid, p_nota text DEFAULT NULL)
RETURNS TABLE(aprovado_em timestamptz, aprovado_por uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_posto int; n_orc int;
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar cenário.' USING ERRCODE = '42501';
  END IF;
  -- Só PENDENTE trava. Recusada já foi decidida: fica com a baseline/cadastro.
  SELECT count(*) INTO n_posto FROM posto_versao
   WHERE versao_id = p_versao AND tenant_id = current_tenant_id() AND aprovado IS NULL;
  SELECT cenario_orcado_pendentes(p_versao) INTO n_orc;
  IF n_posto > 0 OR n_orc > 0 THEN
    RAISE EXCEPTION 'Faltam vereditos: % de posto e % de linha de orçamento. Aprove ou recuse cada um antes de fechar o cenário.',
      n_posto, n_orc;
  END IF;
  RETURN QUERY
  UPDATE versao_orcamento v
     SET aprovado_em = now(), aprovado_por = auth.uid(), aprovacao_nota = p_nota
   WHERE v.id = p_versao AND v.tenant_id = current_tenant_id()
  RETURNING v.aprovado_em, v.aprovado_por;
END $$;

-- ------------------------------------------------------------
-- Os dois gatilhos que impedem o carimbo de apodrecer
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION derrubar_carimbo_versao(p_versao uuid, p_motivo text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE versao_orcamento
     SET aprovado_em = NULL, aprovado_por = NULL,
         aprovacao_nota = coalesce(aprovacao_nota || ' · ', '') || p_motivo
   WHERE id = p_versao AND aprovado_em IS NOT NULL
$$;

-- ⚠ GATILHO DE COMANDO, não de linha. Por linha, semear 24 mil células
-- emitiria 24 mil `UPDATE` em `versao_orcamento` — todos afetando zero, mas
-- todos executados. Com tabela de transição o custo é UM comando por comando,
-- qualquer que seja o tamanho do lote. Daí serem três gatilhos: INSERT vê só
-- `NEW TABLE`, DELETE só `OLD TABLE`, UPDATE as duas.
CREATE OR REPLACE FUNCTION trg_orcado_derruba_carimbo_ins() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE versao_orcamento v SET aprovado_em = NULL, aprovado_por = NULL,
         aprovacao_nota = coalesce(v.aprovacao_nota || ' · ', '') || 'aprovação derrubada: o orçado do cenário mudou'
   WHERE v.aprovado_em IS NOT NULL
     AND v.id IN (SELECT DISTINCT versao_id FROM nova);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION trg_orcado_derruba_carimbo_del() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE versao_orcamento v SET aprovado_em = NULL, aprovado_por = NULL,
         aprovacao_nota = coalesce(v.aprovacao_nota || ' · ', '') || 'aprovação derrubada: o orçado do cenário mudou'
   WHERE v.aprovado_em IS NOT NULL
     AND v.id IN (SELECT DISTINCT versao_id FROM velha);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fat_orcado_derruba_carimbo ON fat_orcado;
DROP TRIGGER IF EXISTS fat_orcado_carimbo_ins ON fat_orcado;
DROP TRIGGER IF EXISTS fat_orcado_carimbo_upd ON fat_orcado;
DROP TRIGGER IF EXISTS fat_orcado_carimbo_del ON fat_orcado;

CREATE TRIGGER fat_orcado_carimbo_ins AFTER INSERT ON fat_orcado
  REFERENCING NEW TABLE AS nova
  FOR EACH STATEMENT EXECUTE FUNCTION trg_orcado_derruba_carimbo_ins();

CREATE TRIGGER fat_orcado_carimbo_upd AFTER UPDATE ON fat_orcado
  REFERENCING NEW TABLE AS nova
  FOR EACH STATEMENT EXECUTE FUNCTION trg_orcado_derruba_carimbo_ins();

CREATE TRIGGER fat_orcado_carimbo_del AFTER DELETE ON fat_orcado
  REFERENCING OLD TABLE AS velha
  FOR EACH STATEMENT EXECUTE FUNCTION trg_orcado_derruba_carimbo_del();

CREATE OR REPLACE FUNCTION trg_veredito_orcado_derruba_carimbo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := coalesce(NEW.versao_id, OLD.versao_id);
BEGIN
  -- v3_170: o carimbo certifica o CONJUNTO DE VEREDITOS. Trocar um ✓ por ✗
  -- depois de fechado muda o que será liberado, e o carimbo seguiria dizendo
  -- que aquele conjunto foi revisado.
  PERFORM derrubar_carimbo_versao(v, 'aprovação derrubada: um veredito mudou');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS orcado_veredito_derruba_carimbo ON orcado_veredito;
CREATE TRIGGER orcado_veredito_derruba_carimbo
  AFTER INSERT OR UPDATE OR DELETE ON orcado_veredito
  FOR EACH ROW EXECUTE FUNCTION trg_veredito_orcado_derruba_carimbo();

SELECT 'v3_172 aplicada' AS resultado,
       (SELECT count(*) FROM information_schema.tables WHERE table_name='orcado_veredito') AS tabela,
       (SELECT count(*) FROM pg_proc WHERE proname IN
          ('cenario_orcado_diff','cenario_orcado_pendentes','decidir_linha_orcado','reabrir_linha_orcado')) AS funcoes,
       (SELECT count(*) FROM pg_trigger WHERE tgname IN
          ('fat_orcado_carimbo_ins','fat_orcado_carimbo_upd','fat_orcado_carimbo_del',
           'orcado_veredito_derruba_carimbo')) AS gatilhos;
