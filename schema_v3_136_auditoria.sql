-- ⛔⛔ NÃO RODAR ESTE ARQUIVO. ⛔⛔
-- Ele terminava com um bloco de prova por `RAISE EXCEPTION`, e o SQL Editor
-- roda o script inteiro em UMA transação — então a exceção DESFAZIA a própria
-- migration. A prova rodava dentro da transação (por isso exibia sucesso) e o
-- COMMIT nunca acontecia. Verificado no banco em 02/11: nada aqui foi aplicado.
--
-- ➜ O conteúdo está CONSOLIDADO em `schema_v3_137_reaplicar.sql`, que termina
--   em SELECT. As provas viraram arquivos separados, porque prova e aplicação
--   não podem compartilhar transação.

-- ============================================================
-- v3_136 · MON-01 — rastro do que acontece
--
-- Hoje nada deixa registro. O episódio de 02/11 é o exemplo: o papel de um
-- usuário foi alterado por SQL e não há como dizer quem, quando nem o quê.
-- Teste com usuários sem auditoria não é auditável por definição — se algo for
-- visto indevidamente, resta suspeita, não fato.
--
-- ─────────────────────────────────────────────────────────────
-- A DECISÃO DE DESENHO QUE MAIS IMPORTA: o que NÃO auditar.
--
-- Linha a linha num fato de 1,07 milhão de registros produziria uma tabela
-- maior que o dado auditado, e ninguém leria. Então:
--
--   · ACESSO (quem pode o quê) → linha a linha, com antes e depois. É pouco
--     volume e é exatamente o que precisa de prova.
--   · OPERAÇÃO DESTRUTIVA em massa → UMA linha por comando, com a contagem.
--     Gatilho de instrução (`FOR EACH STATEMENT`) com tabela de transição faz
--     isso sem percorrer registro por registro.
--
-- Auditar a edição de célula do orçado ficou FORA de propósito: é a operação
-- mais frequente do sistema e a menos sensível — quem orça está autorizado a
-- orçar, e o valor anterior já vive no histórico da própria célula.
-- ─────────────────────────────────────────────────────────────
--
-- ⚠ `auth.uid()` é NULL quando a mudança vem do SQL Editor. O registro grava
-- NULL e marca a origem como privilegiada — é honesto e é informação: diz que
-- a atribuição depende dos logs do próprio Supabase. Melhor do que inventar.
--
-- ⚠ NINGUÉM APAGA A AUDITORIA. A tabela tem política só de SELECT (admin), e
-- nenhuma de INSERT/UPDATE/DELETE. Os gatilhos escrevem por SECURITY DEFINER,
-- contornando a RLS. Trilha que o auditado pode apagar não é trilha.
--
-- Rodar inteiro. O bloco final sempre devolve linha.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditoria (
  id          bigserial PRIMARY KEY,
  quando      timestamptz NOT NULL DEFAULT now(),
  tenant_id   uuid,
  quem        uuid,          -- auth.uid(); NULL = sessão privilegiada (SQL Editor)
  quem_papel  text,
  origem      text NOT NULL, -- 'app' | 'privilegiada'
  tabela      text NOT NULL,
  operacao    text NOT NULL, -- INSERT | UPDATE | DELETE | <nome da função>
  chave       text,          -- id do registro, quando é linha a linha
  linhas      int,           -- quantidade, quando é operação em massa
  antes       jsonb,
  depois      jsonb,
  detalhe     text
);

CREATE INDEX IF NOT EXISTS ix_auditoria_quando ON auditoria (quando DESC);
CREATE INDEX IF NOT EXISTS ix_auditoria_quem   ON auditoria (quem, quando DESC);
CREATE INDEX IF NOT EXISTS ix_auditoria_tabela ON auditoria (tabela, quando DESC);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auditoria_sel ON auditoria;
-- Só admin lê. E NÃO existe política de escrita: sem ela o Postgres nega
-- INSERT, UPDATE e DELETE para todo cliente, inclusive admin. Quem escreve são
-- os gatilhos, por SECURITY DEFINER.
CREATE POLICY auditoria_sel ON auditoria FOR SELECT
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));
REVOKE ALL ON auditoria FROM anon;
GRANT SELECT ON auditoria TO authenticated;

-- ---------- quem está agindo ----------
CREATE OR REPLACE FUNCTION auditoria_quem()
RETURNS TABLE (uid uuid, papel text, origem text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid(),
         (SELECT ut.role FROM user_tenant ut WHERE ut.user_id = auth.uid() LIMIT 1),
         CASE WHEN auth.uid() IS NULL THEN 'privilegiada' ELSE 'app' END
$$;

-- ---------- gatilho de LINHA: tabelas de acesso ----------
CREATE OR REPLACE FUNCTION auditar_linha() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q      record;
  j_old  jsonb;
  j_new  jsonb;
BEGIN
  -- ⚠ Nada de `OLD.role` aqui. Esta função serve a TRÊS tabelas, e o PL/pgSQL
  -- resolve o campo do registro ANTES de o CASE rodar — então `OLD.role` numa
  -- tabela sem `role` falha mesmo com a condição protegendo. Foi assim que a
  -- primeira versão quebrou em `user_acesso_regra`.
  --
  -- Converter para jsonb primeiro resolve de vez: `->>` sobre chave ausente
  -- devolve NULL em vez de erro, e vale para qualquer tabela.
  --
  -- As conversões também ficam em IF separados: referenciar OLD num gatilho de
  -- INSERT (ou NEW num de DELETE) é registro não atribuído, não nulo.
  IF TG_OP <> 'INSERT' THEN j_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN j_new := to_jsonb(NEW); END IF;

  SELECT * INTO q FROM auditoria_quem();

  INSERT INTO auditoria (tenant_id, quem, quem_papel, origem, tabela, operacao, chave, antes, depois, detalhe)
  VALUES (
    coalesce((j_new ->> 'tenant_id')::uuid, (j_old ->> 'tenant_id')::uuid),
    q.uid, q.papel, q.origem, TG_TABLE_NAME, TG_OP,
    coalesce(j_new ->> 'id', j_old ->> 'id'),
    j_old, j_new,
    -- O caso que motivou tudo: mudança de papel em destaque, para aparecer numa
    -- leitura rápida sem abrir o jsonb.
    CASE WHEN TG_TABLE_NAME = 'user_tenant'
              AND (j_old ->> 'role') IS DISTINCT FROM (j_new ->> 'role')
         THEN 'PAPEL: ' || coalesce(j_old ->> 'role', '(novo)')
                        || ' → ' || coalesce(j_new ->> 'role', '(removido)') END
  );
  RETURN NULL;   -- AFTER trigger
END $$;

DROP TRIGGER IF EXISTS trg_aud_user_tenant        ON user_tenant;
DROP TRIGGER IF EXISTS trg_aud_user_acesso_regra  ON user_acesso_regra;
DROP TRIGGER IF EXISTS trg_aud_user_acesso_funcao ON user_acesso_funcao;
CREATE TRIGGER trg_aud_user_tenant        AFTER INSERT OR UPDATE OR DELETE ON user_tenant        FOR EACH ROW EXECUTE FUNCTION auditar_linha();
CREATE TRIGGER trg_aud_user_acesso_regra  AFTER INSERT OR UPDATE OR DELETE ON user_acesso_regra  FOR EACH ROW EXECUTE FUNCTION auditar_linha();
CREATE TRIGGER trg_aud_user_acesso_funcao AFTER INSERT OR UPDATE OR DELETE ON user_acesso_funcao FOR EACH ROW EXECUTE FUNCTION auditar_linha();

-- ---------- gatilho de INSTRUÇÃO: destruição em massa ----------
-- `REFERENCING OLD TABLE` dá a contagem sem percorrer linha a linha — é o que
-- torna viável auditar um DELETE de 60 mil registros sem gerar 60 mil logs.
CREATE OR REPLACE FUNCTION auditar_massa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record; n int; amostra jsonb;
BEGIN
  SELECT * INTO q FROM auditoria_quem();
  EXECUTE 'SELECT count(*) FROM removidas' INTO n;
  IF coalesce(n, 0) = 0 THEN RETURN NULL; END IF;
  -- Uma amostra de até 3 linhas: dá para reconhecer o que saiu sem guardar tudo.
  EXECUTE 'SELECT jsonb_agg(t) FROM (SELECT * FROM removidas LIMIT 3) t' INTO amostra;
  INSERT INTO auditoria (tenant_id, quem, quem_papel, origem, tabela, operacao, linhas, antes, detalhe)
  VALUES ((SELECT current_tenant_id()), q.uid, q.papel, q.origem,
          TG_TABLE_NAME, 'DELETE', n, amostra,
          n || ' linha(s) removida(s) em um comando');
  RETURN NULL;
END $$;

DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fat_orcado','fat_realizado','fat_folha','fat_saldo','posto','fat_apontamento'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_aud_massa_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS removidas FOR EACH STATEMENT EXECUTE FUNCTION auditar_massa()',
      'trg_aud_massa_' || t, t);
  END LOOP;
END $t$;

-- ---------- registro explícito dentro do apagar ----------
-- O gatilho de massa já pega o DELETE, mas aqui se registra a INTENÇÃO: quem
-- confirmou, em que versão e ano. O gatilho diz "60 mil linhas sumiram"; isto
-- diz "fulano mandou apagar a versão X".
CREATE OR REPLACE FUNCTION apagar_orcado_versao(p_versao uuid, p_ano int, p_confirmacao text)
RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout = '300s'
AS $$
DECLARE
  v_cod text; v_bloq boolean; v_tenant uuid;
  n_fat int; n_apl int; n_folha int; q record;
BEGIN
  v_tenant := current_tenant_id();
  SELECT codigo, coalesce(bloqueada, false) INTO v_cod, v_bloq
    FROM versao_orcamento WHERE id = p_versao AND tenant_id = v_tenant;

  IF v_cod IS NULL THEN RAISE EXCEPTION 'Versão não encontrada.'; END IF;
  IF v_bloq THEN
    RAISE EXCEPTION 'A versão % está BLOQUEADA. Desbloqueie antes, se é mesmo isso que você quer.', v_cod;
  END IF;
  IF p_confirmacao IS DISTINCT FROM v_cod THEN
    RAISE EXCEPTION 'Confirmação não confere: digite exatamente o código da versão (%).', v_cod;
  END IF;

  DELETE FROM fat_orcado WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_fat = ROW_COUNT;
  DELETE FROM formulario_aplicacao WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_apl = ROW_COUNT;
  DELETE FROM fat_folha WHERE tenant_id = v_tenant AND tipo = 'ORCADO' AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_folha = ROW_COUNT;

  SELECT * INTO q FROM auditoria_quem();
  INSERT INTO auditoria (tenant_id, quem, quem_papel, origem, tabela, operacao, chave, linhas, detalhe)
  VALUES (v_tenant, q.uid, q.papel, q.origem, 'fat_orcado', 'apagar_orcado_versao',
          p_versao::text, n_fat,
          format('versão %s, ano %s — %s linha(s) de orçado, %s aplicação(ões), %s linha(s) de folha',
                 v_cod, p_ano, n_fat, n_apl, n_folha));

  RETURN jsonb_build_object('versao', v_cod, 'ano', p_ano,
                            'linhas_apagadas', n_fat, 'aplicacoes_apagadas', n_apl,
                            'folha_apagada', n_folha);
END $$;

-- ════════════════════════════════════════════════════════════
-- PROVA — o gatilho registra mesmo? Escreve, confere e desfaz.
-- ════════════════════════════════════════════════════════════
-- Conferir que o gatilho EXISTE não prova que ele grava. Este bloco faz uma
-- alteração real numa tabela de acesso, lê a auditoria e desfaz tudo.
DO $prova$
DECLARE
  v_user uuid; n_antes bigint; n_depois bigint; reg record;
BEGIN
  SELECT user_id INTO v_user FROM user_tenant ORDER BY user_id LIMIT 1;
  SELECT count(*) INTO n_antes FROM auditoria;

  -- mexe de verdade numa regra, e volta ao estado anterior logo em seguida
  INSERT INTO user_acesso_regra (tenant_id, user_id, dimensao, escopo, valor_ids, negados)
  VALUES ((SELECT tenant_id FROM user_tenant WHERE user_id = v_user LIMIT 1),
          v_user, '__teste_auditoria__', 'VER', '{}'::uuid[], '{}'::uuid[]);
  DELETE FROM user_acesso_regra WHERE user_id = v_user AND dimensao = '__teste_auditoria__';

  SELECT count(*) INTO n_depois FROM auditoria;
  SELECT tabela, operacao, origem, coalesce(quem::text, '(privilegiada)') AS quem
    INTO reg FROM auditoria ORDER BY id DESC LIMIT 1;

  -- limpa os dois registros do teste, para não sujar a trilha real
  DELETE FROM auditoria WHERE tabela = 'user_acesso_regra'
     AND (antes ->> 'dimensao' = '__teste_auditoria__' OR depois ->> 'dimensao' = '__teste_auditoria__');

  RAISE EXCEPTION E'=== PROVA DA AUDITORIA ===\n\nregistros antes ...... %\nregistros depois ..... %  (esperado: +2, um INSERT e um DELETE)\núltimo registro ...... % · % · origem %\nquem ................. %\n\nSe "depois" não subiu 2, o gatilho não está gravando.\nOrigem "privilegiada" aqui é o ESPERADO: este bloco roda no SQL Editor,\nonde auth.uid() é NULL — exatamente o caso que motivou o MON-01.\n\nOs 2 registros de teste foram removidos; a trilha real está intacta.',
    n_antes, n_depois, reg.tabela, reg.operacao, reg.origem, reg.quem;
END $prova$;
