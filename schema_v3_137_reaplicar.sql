-- ============================================================
-- v3_137 · REAPLICAR o que as provas desfizeram (133 + 134 + 136)
--
-- ERRO MEU, e o pior desta tarefa. Terminei três migrations com um bloco de
-- prova por `RAISE EXCEPTION`, para não confiar em inspeção. Mas o SQL Editor
-- roda o script inteiro em **uma transação**, e exceção é erro: a prova rodava
-- dentro da transação — por isso o resultado vinha CORRETO — e o COMMIT nunca
-- acontecia. As três se desfizeram exibindo sucesso.
--
-- Verificado no banco em 02/11: `escopo_dim` ainda usava `NOT v_tem`, a policy
-- de `fat_orcado` não mencionava versão, e a tabela `auditoria` não existia.
--
-- A regra que fica: **migration termina em SELECT.** Prova vai em arquivo
-- separado, porque prova e aplicação não podem compartilhar transação. As
-- provas desta leva estão em `prova_rls_escopo.sql` e `prova_auditoria.sql`.
--
-- Consolidado num arquivo só de propósito: uma execução, um commit, uma
-- verificação — menos chance de outro estado parcial. Tudo é idempotente.
--
-- CONTEÚDO
--   1. escopo_dim / escopo_dim_edit  — `IS NOT TRUE` (v3_133) + dimensão versão
--   2. escopo_versao / edit_versao   — funções nulárias
--   3. semeadura de regra de versão  — senão negar-por-padrão tranca o orçado
--   4. policies de fat_orcado e fat_folha com versão
--   5. auditoria: tabela, políticas, gatilhos, e o log no apagar
--   6. conferência final — em SELECT, nunca em exceção
-- ============================================================

-- ════════════ 1 e 2 · funções de escopo ════════════
-- ---------- 2 · a função de escopo de versão ----------
CREATE OR REPLACE FUNCTION escopo_versao() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim('versao') $$;
CREATE OR REPLACE FUNCTION edit_versao() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_edit('versao') $$;
GRANT EXECUTE ON FUNCTION escopo_versao(), edit_versao() TO authenticated;

-- `escopo_dim` não conhecia a dimensão `versao` no ramo "só negados" (ela
-- listava apenas CC, empresa e filial e caía no ELSE, devolvendo vazio = nega
-- tudo). Com negados cadastrados em versão, isso trancaria o orçado inteiro.
CREATE OR REPLACE FUNCTION escopo_dim(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;
  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'VER' LIMIT 1;
  IF v_tem IS NOT TRUE THEN RETURN '{}'::uuid[]; END IF;
  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c     WHERE NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e          WHERE NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f           WHERE NOT (f.id = ANY(v_deny)))
      WHEN 'versao'       THEN array(SELECT v.id FROM versao_orcamento v WHERE NOT (v.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;
  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

CREATE OR REPLACE FUNCTION escopo_dim_edit(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;
  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'ORCAR' LIMIT 1;
  IF v_tem IS NOT TRUE THEN RETURN escopo_dim(p_dim); END IF;
  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c     WHERE NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e          WHERE NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f           WHERE NOT (f.id = ANY(v_deny)))
      WHEN 'versao'       THEN array(SELECT v.id FROM versao_orcamento v WHERE NOT (v.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;
  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

-- ════════════ 3 · semeadura ════════════
-- ---------- 1 · semear "vê todas as versões" para quem não tem regra ----------
-- Lista vazia = vê tudo, como escolha explícita (v3_132). É o que a tela de
-- Configurações grava quando nada é marcado.
INSERT INTO user_acesso_regra (tenant_id, user_id, dimensao, escopo, valor_ids, negados)
SELECT ut.tenant_id, ut.user_id, 'versao', 'VER', '{}'::uuid[], '{}'::uuid[]
  FROM user_tenant ut
 WHERE NOT EXISTS (SELECT 1 FROM user_acesso_regra r
                    WHERE r.user_id = ut.user_id AND r.dimensao = 'versao' AND r.escopo = 'VER')
ON CONFLICT DO NOTHING;

-- ════════════ 4 · policies com versão ════════════
-- ---------- 3 · somar versão ao predicado ----------
DO $mig$
DECLARE t text;
  p_esc text := 'AND ((SELECT escopo_empresa()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT escopo_empresa())::uuid[])))'
             || ' AND ((SELECT escopo_filial())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT escopo_filial())::uuid[])))'
             || ' AND ((SELECT escopo_cc())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT escopo_cc())::uuid[])))'
             || ' AND ((SELECT escopo_versao())  IS NULL OR (versao_id  IS NOT NULL AND versao_id  = ANY((SELECT escopo_versao())::uuid[])))';
  e_esc text := 'AND ((SELECT edit_empresa()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT edit_empresa())::uuid[])))'
             || ' AND ((SELECT edit_filial())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT edit_filial())::uuid[])))'
             || ' AND ((SELECT edit_cc())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT edit_cc())::uuid[])))'
             || ' AND ((SELECT edit_versao())  IS NULL OR (versao_id  IS NOT NULL AND versao_id  = ANY((SELECT edit_versao())::uuid[])))';
BEGIN
  FOREACH t IN ARRAY ARRAY['fat_orcado','fat_folha'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = (SELECT current_tenant_id()) %s)', t || '_sel', t, p_esc);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()) %s)', t || '_ins', t, e_esc);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()) %s) WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()) %s)', t || '_upd', t, e_esc, e_esc);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()) %s)', t || '_del', t, e_esc);
  END LOOP;
END $mig$;

-- ════════════ 5 · auditoria ════════════
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
-- 6 · CONFERÊNCIA — em SELECT, nunca em exceção
-- ════════════════════════════════════════════════════════════
-- Este bloco NÃO pode levantar erro: se levantar, desfaz tudo acima. É
-- exatamente a lição desta migration. Ele apenas relata, e sempre devolve linha.
SELECT 'escopo_dim com IS NOT TRUE'                                   AS item,
       CASE WHEN pg_get_functiondef('escopo_dim(text)'::regprocedure) ILIKE '%IS NOT TRUE%'
            THEN '✓' ELSE '⛔' END                                     AS ok,
       'sem isto, usuário sem regra vê tudo'                           AS porque
UNION ALL
SELECT 'escopo_dim conhece a dimensão versão',
       CASE WHEN pg_get_functiondef('escopo_dim(text)'::regprocedure) ILIKE '%versao_orcamento%'
            THEN '✓' ELSE '⛔' END,
       'ramo de só-negados cairia no ELSE e trancaria tudo'
UNION ALL
SELECT 'funções escopo_versao / edit_versao',
       CASE WHEN to_regprocedure('escopo_versao()') IS NOT NULL
             AND to_regprocedure('edit_versao()')   IS NOT NULL
            THEN '✓' ELSE '⛔' END,
       'dependência das policies'
UNION ALL
SELECT 'regra de versão semeada',
       (SELECT count(*)::text FROM user_acesso_regra WHERE dimensao = 'versao' AND escopo = 'VER')
         || ' de ' || (SELECT count(*)::text FROM user_tenant) || ' usuário(s)',
       'sem regra, negar-por-padrão tranca o orçado'
UNION ALL
SELECT 'policy de fat_orcado recorta versão',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                          WHERE c.relname = 'fat_orcado' AND p.polcmd = 'r'
                            AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%escopo_versao%')
            THEN '✓' ELSE '⛔' END,
       'fecha o furo da visão salva'
UNION ALL
SELECT 'policy de fat_folha recorta versão',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                          WHERE c.relname = 'fat_folha' AND p.polcmd = 'r'
                            AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%escopo_versao%')
            THEN '✓' ELSE '⛔' END,
       'idem na abertura por posto'
UNION ALL
SELECT 'tabela auditoria',
       CASE WHEN to_regclass('public.auditoria') IS NOT NULL THEN '✓' ELSE '⛔' END,
       'MON-01'
UNION ALL
SELECT 'auditoria sem política de escrita',
       CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                   WHERE c.relname = 'auditoria' AND p.polcmd <> 'r') = 0
            THEN '✓ ninguém apaga a trilha' ELSE '⛔ há política de escrita' END,
       'trilha que o auditado apaga não é trilha'
UNION ALL
SELECT 'gatilhos nas tabelas de acesso',
       (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE t.tgname LIKE 'trg_aud_%' AND NOT t.tgisinternal
           AND c.relname IN ('user_tenant','user_acesso_regra','user_acesso_funcao')) || ' de 3',
       'papel e regras, linha a linha'
UNION ALL
SELECT 'gatilhos de destruição em massa',
       (SELECT count(*)::text FROM pg_trigger t
         WHERE t.tgname LIKE 'trg_aud_massa_%' AND NOT t.tgisinternal) || ' de 6',
       'uma linha por comando, com a contagem'
UNION ALL
SELECT 'apagar_orcado_versao registra na auditoria',
       CASE WHEN pg_get_functiondef('apagar_orcado_versao(uuid,int,text)'::regprocedure) ILIKE '%INSERT INTO auditoria%'
            THEN '✓' ELSE '⛔' END,
       'registra a INTENÇÃO, não só o efeito'
ORDER BY 1;
