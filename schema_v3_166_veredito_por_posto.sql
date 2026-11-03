-- ============================================================
-- v3_166 — Veredito por posto, carimbo por cenário
--
-- O veredito por posto é a CONVERSA (o controller diz o que não passa e por
-- quê); o carimbo do cenário continua sendo a TRAVA (é ele que libera o
-- Aplicar). A v3_165 só tinha a trava, e o ciclo ficava mudo: não havia como
-- devolver dizendo o que mudar.
--
-- ⚠ REGRA QUE MANTÉM OS DOIS COERENTES: o cenário só é aprovável quando TODO
-- posto decidido estiver aprovado. Sem ela daria para carimbar um cenário que
-- contém decisão reprovada — e ela seria aplicada assim mesmo. Com ela, cada
-- reprovação tem duas saídas: corrigir ou abandonar a decisão.
--
-- ⚠ O GATILHO DA v3_165 DISPARAVA NO PRÓPRIO ATO DE APROVAR. Ele derrubava o
-- carimbo a cada UPDATE em `posto_versao`, e gravar o veredito É um UPDATE.
-- Não doía enquanto a aprovação morava só em `versao_orcamento`; com os
-- vereditos na mesma tabela, aprovar derrubaria a aprovação recém-dada. Agora
-- ele compara **só os campos de decisão** — veredito mudando não é decisão
-- mudando.
--
-- ⚠ Reprovar NÃO apaga a decisão: o gerente precisa ver o que propôs junto com
-- o motivo da recusa. O veredito é carimbo ao lado, nunca desfazer.
--
-- Decisão ALTERADA zera o veredito: o "não" anterior era sobre outro número.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE posto_versao ADD COLUMN IF NOT EXISTS aprovado   boolean;      -- null = pendente
ALTER TABLE posto_versao ADD COLUMN IF NOT EXISTS aprov_nota text;
ALTER TABLE posto_versao ADD COLUMN IF NOT EXISTS aprov_em   timestamptz;
ALTER TABLE posto_versao ADD COLUMN IF NOT EXISTS aprov_por  uuid;

-- ── 1 · decisão alterada zera o veredito (BEFORE, na própria linha) ──
CREATE OR REPLACE FUNCTION decisao_alterada_zera_veredito() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.salario_base, OLD.fte, OLD.cargo_id, OLD.ativo,
      OLD.ini_ano, OLD.ini_mes, OLD.fim_ano, OLD.fim_mes,
      OLD.reajuste_mes, OLD.reajuste_pct, OLD.reajuste_valor,
      OLD.afast_ini_ano, OLD.afast_ini_mes, OLD.afast_fim_ano, OLD.afast_fim_mes,
      OLD.limpos)
     IS DISTINCT FROM
     (NEW.salario_base, NEW.fte, NEW.cargo_id, NEW.ativo,
      NEW.ini_ano, NEW.ini_mes, NEW.fim_ano, NEW.fim_mes,
      NEW.reajuste_mes, NEW.reajuste_pct, NEW.reajuste_valor,
      NEW.afast_ini_ano, NEW.afast_ini_mes, NEW.afast_fim_ano, NEW.afast_fim_mes,
      NEW.limpos)
  THEN
    NEW.aprovado := NULL; NEW.aprov_nota := NULL; NEW.aprov_em := NULL; NEW.aprov_por := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_decisao_zera_veredito ON posto_versao;
CREATE TRIGGER trg_decisao_zera_veredito
  BEFORE UPDATE ON posto_versao
  FOR EACH ROW EXECUTE FUNCTION decisao_alterada_zera_veredito();

-- ── 2 · o carimbo do cenário cai só quando a DECISÃO muda ──
CREATE OR REPLACE FUNCTION cenario_alterado_derruba_aprovacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := coalesce(NEW.versao_id, OLD.versao_id); mudou boolean := true;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    mudou := (OLD.salario_base, OLD.fte, OLD.cargo_id, OLD.ativo,
              OLD.ini_ano, OLD.ini_mes, OLD.fim_ano, OLD.fim_mes,
              OLD.reajuste_mes, OLD.reajuste_pct, OLD.reajuste_valor,
              OLD.afast_ini_ano, OLD.afast_ini_mes, OLD.afast_fim_ano, OLD.afast_fim_mes,
              OLD.limpos)
             IS DISTINCT FROM
             (NEW.salario_base, NEW.fte, NEW.cargo_id, NEW.ativo,
              NEW.ini_ano, NEW.ini_mes, NEW.fim_ano, NEW.fim_mes,
              NEW.reajuste_mes, NEW.reajuste_pct, NEW.reajuste_valor,
              NEW.afast_ini_ano, NEW.afast_ini_mes, NEW.afast_fim_ano, NEW.afast_fim_mes,
              NEW.limpos);
  END IF;
  IF NOT mudou THEN RETURN NULL; END IF;
  UPDATE versao_orcamento
     SET aprovado_em = NULL, aprovado_por = NULL,
         aprovacao_nota = coalesce(aprovacao_nota || ' ', '')
                        || '[aprovação derrubada por alteração no cenário em '
                        || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']'
   WHERE id = v AND aprovado_em IS NOT NULL;
  RETURN NULL;
END $$;

-- ── 3 · veredito por posto ──
CREATE OR REPLACE FUNCTION decidir_posto_cenario(p_id uuid, p_aprovado boolean, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar ou reprovar decisões.' USING ERRCODE = '42501';
  END IF;
  -- Escreve SÓ as colunas de veredito: o gatilho de cima vê que nenhuma decisão
  -- mudou e não zera o que acabamos de gravar.
  UPDATE posto_versao
     SET aprovado = p_aprovado, aprov_nota = p_nota,
         aprov_em = CASE WHEN p_aprovado IS NULL THEN NULL ELSE now() END,
         aprov_por = CASE WHEN p_aprovado IS NULL THEN NULL ELSE auth.uid() END
   WHERE id = p_id AND tenant_id = current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION decidir_posto_cenario(uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION decidir_posto_cenario(uuid, boolean, text) TO authenticated;

-- ── 4 · o carimbo do cenário exige unanimidade ──
CREATE OR REPLACE FUNCTION aprovar_cenario(p_versao uuid, p_nota text DEFAULT NULL)
RETURNS TABLE(aprovado_em timestamptz, aprovado_por uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_falta int;
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar cenário.' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO n_falta FROM posto_versao
   WHERE versao_id = p_versao AND tenant_id = current_tenant_id()
     AND aprovado IS DISTINCT FROM true;
  IF n_falta > 0 THEN
    RAISE EXCEPTION 'Faltam % decisão(ões) sem aprovação. Aprove ou peça para o responsável corrigir antes de carimbar o cenário.', n_falta;
  END IF;
  RETURN QUERY
  UPDATE versao_orcamento v
     SET aprovado_em = now(), aprovado_por = auth.uid(), aprovacao_nota = p_nota
   WHERE v.id = p_versao AND v.tenant_id = current_tenant_id()
  RETURNING v.aprovado_em, v.aprovado_por;
END $$;
REVOKE ALL ON FUNCTION aprovar_cenario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION aprovar_cenario(uuid, text) TO authenticated;

SELECT 'colunas de veredito em posto_versao' AS secao,
       (SELECT string_agg(column_name, ', ' ORDER BY column_name)
          FROM information_schema.columns WHERE table_name='posto_versao'
           AND column_name LIKE 'aprov%') AS resultado
UNION ALL SELECT 'gatilho que zera veredito ao mudar decisão',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_decisao_zera_veredito') THEN 'criado' ELSE '⛔ não' END
UNION ALL SELECT 'gatilho do carimbo compara só decisão',
  CASE WHEN pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='cenario_alterado_derruba_aprovacao')) LIKE '%mudou%'
       THEN 'sim' ELSE '⛔ ainda derruba em qualquer UPDATE' END
UNION ALL SELECT 'aprovar_cenario exige unanimidade',
  CASE WHEN pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='aprovar_cenario')) LIKE '%n_falta%'
       THEN 'sim' ELSE '⛔ não' END
UNION ALL SELECT 'decisões sem veredito hoje',
  (SELECT count(*)::text FROM posto_versao WHERE aprovado IS DISTINCT FROM true);
