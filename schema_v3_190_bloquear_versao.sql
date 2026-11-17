-- ============================================================
-- v3_190 — fechar e reabrir a versão de orçamento, de verdade
--
-- POR QUE EXISTE: "fechado o orçamento, a versão vira a meta do ano e não se
-- aplica mais" (decisão do Ricardo, 17/nov). O produto tinha a coluna
-- `bloqueada` desde sempre e **nada para ligá-la**: nenhuma tela escreve `true`,
-- só `false` na criação. Fechar o orçamento hoje exigiria SQL na mão.
--
-- ⚠⚠ E A COLUNA NÃO TRANCAVA NADA. Medido antes: as 4 políticas de `fat_orcado`
-- não citam `bloqueada`, e o `UPDATE` em `versao_orcamento` só exige
-- `pode_escrever()` — que é admin **ou member**. Ou seja, qualquer member
-- bloqueava e desbloqueava pela API, e qualquer um escrevia numa versão
-- bloqueada. As telas respeitavam (Aplicar, grade, formulário); o banco não.
-- É a ACS-02 de novo, e a v3_174 de novo: a intenção no desenho, a porta aberta.
--
-- O QUE ENTRA, nas quatro camadas que o furo exigiu:
--   1. `pode_bloquear_versao()` — a autoridade, no banco
--   2. `bloquear_versao` / `reabrir_versao` — os atos, com motivo
--   3. `versao_bloqueio` — o histórico de quem abriu e fechou, e por quê
--   4. gatilho em `fat_orcado` — o cadeado que vale para a API, não só p/ a tela
--
-- ⚠ ADMIN POR PADRÃO, MEMBER POR LIBERAÇÃO (ajuste do Ricardo). A função copia
-- a forma de `pode_aprovar_cenario()`: `eh_admin() OR override`, com o override
-- vindo de `user_acesso_funcao`. Liberar em Configurações passa a valer no
-- banco, não só na tela — que é a diferença entre controle e teatro.
-- ⚠ É a TERCEIRA repetição deliberada do catálogo em SQL (depois de
-- `pode_ver_folha` e `pode_aprovar_cenario`). Custo aceito e declarado: mudar o
-- padrão de `versao.bloquear` em `lib/capacidades.ts` exige mudar o SQL junto.
--
-- ⚠⚠ REABRIR EXIGE MOTIVO, FECHAR NÃO. Não é assimetria por descuido: fechar é
-- "não mexo mais"; reabrir é **mexer no alvo depois que o ano começou a ser
-- medido contra ele**. Quem acompanha o realizado precisa saber que a meta
-- mudou — senão o desvio de março vira outro número em abril sem explicação.
-- Mesma regra da recusa de cenário na v3_166.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1. a autoridade ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pode_bloquear_versao() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT eh_admin() OR coalesce(
      (SELECT f.permitido FROM user_acesso_funcao f
        WHERE f.user_id = auth.uid() AND f.capacidade = 'versao.bloquear' LIMIT 1),
      false)   -- sem override: só admin. Espelha o padrão de lib/capacidades.ts.
$$;
COMMENT ON FUNCTION pode_bloquear_versao() IS
  'Autoridade para fechar/reabrir versão de orçamento. Repete o padrão de versao.bloquear do catálogo — mudar lá exige mudar aqui.';

-- ── 2. o histórico ────────────────────────────────────────────────────────
-- ⚠ Registro que o auditado pode editar não é registro (lição da v3_174):
-- a escrita fica SÓ nas RPCs; de fora, só leitura.
CREATE TABLE IF NOT EXISTS versao_bloqueio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  versao_id  uuid NOT NULL REFERENCES versao_orcamento(id) ON DELETE CASCADE,
  acao       text NOT NULL CHECK (acao IN ('BLOQUEAR','REABRIR')),
  motivo     text,
  por        uuid,
  em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_versao_bloqueio ON versao_bloqueio (versao_id, em DESC);
ALTER TABLE versao_bloqueio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS versao_bloqueio_sel ON versao_bloqueio;
CREATE POLICY versao_bloqueio_sel ON versao_bloqueio FOR SELECT
  USING (tenant_id = current_tenant_id());
REVOKE INSERT, UPDATE, DELETE ON versao_bloqueio FROM authenticated;
GRANT SELECT ON versao_bloqueio TO authenticated;

-- ── 3. os atos ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bloquear_versao(p_versao uuid, p_motivo text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v versao_orcamento%ROWTYPE;
BEGIN
  IF NOT pode_bloquear_versao() THEN
    RETURN '⛔ sem permissão para fechar versão (capacidade versao.bloquear)';
  END IF;
  SELECT * INTO v FROM versao_orcamento WHERE id = p_versao AND tenant_id = current_tenant_id();
  IF NOT FOUND THEN RETURN '⛔ versão não encontrada'; END IF;
  IF coalesce(v.bloqueada, false) THEN RETURN 'já estava fechada'; END IF;

  UPDATE versao_orcamento SET bloqueada = true WHERE id = p_versao;
  INSERT INTO versao_bloqueio (tenant_id, versao_id, acao, motivo, por)
       VALUES (v.tenant_id, p_versao, 'BLOQUEAR', nullif(trim(p_motivo), ''), auth.uid());
  RETURN 'fechada: ' || v.codigo;
END $$;

CREATE OR REPLACE FUNCTION reabrir_versao(p_versao uuid, p_motivo text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v versao_orcamento%ROWTYPE;
BEGIN
  IF NOT pode_bloquear_versao() THEN
    RETURN '⛔ sem permissão para reabrir versão (capacidade versao.bloquear)';
  END IF;
  -- ⚠ O motivo é OBRIGATÓRIO aqui e opcional no fechar. Ver o cabeçalho: quem
  -- acompanha o realizado contra a meta precisa saber por que a meta mudou.
  IF coalesce(trim(p_motivo), '') = '' THEN
    RETURN '⛔ reabrir exige motivo — a meta já está sendo medida contra o realizado';
  END IF;
  SELECT * INTO v FROM versao_orcamento WHERE id = p_versao AND tenant_id = current_tenant_id();
  IF NOT FOUND THEN RETURN '⛔ versão não encontrada'; END IF;
  IF NOT coalesce(v.bloqueada, false) THEN RETURN 'já estava aberta'; END IF;

  UPDATE versao_orcamento SET bloqueada = false WHERE id = p_versao;
  INSERT INTO versao_bloqueio (tenant_id, versao_id, acao, motivo, por)
       VALUES (v.tenant_id, p_versao, 'REABRIR', trim(p_motivo), auth.uid());
  RETURN 'reaberta: ' || v.codigo;
END $$;

-- ── 4. o cadeado, onde ele precisa valer ──────────────────────────────────
-- ⚠⚠ GATILHO DE COMANDO, não de linha (mesma razão da v3_172): um Aplicar
-- grava 16.500 linhas, e por linha isso seriam 16.500 consultas a
-- `versao_orcamento`. Com tabela de transição é UMA. São três gatilhos porque
-- INSERT só enxerga `NEW TABLE` e DELETE só `OLD TABLE`.
CREATE OR REPLACE FUNCTION fat_orcado_recusa_bloqueada() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cod text;
BEGIN
  SELECT v.codigo INTO cod FROM versao_orcamento v
   WHERE v.bloqueada AND v.id IN (SELECT DISTINCT versao_id FROM alvo) LIMIT 1;
  IF cod IS NOT NULL THEN
    RAISE EXCEPTION 'versão % está FECHADA — reabra antes de alterar o orçado dela', cod
      USING HINT = 'Cadastros → Versões → reabrir (exige motivo)';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fat_orcado_bloq_ins ON fat_orcado;
DROP TRIGGER IF EXISTS fat_orcado_bloq_upd ON fat_orcado;
DROP TRIGGER IF EXISTS fat_orcado_bloq_del ON fat_orcado;
CREATE TRIGGER fat_orcado_bloq_ins AFTER INSERT ON fat_orcado
  REFERENCING NEW TABLE AS alvo FOR EACH STATEMENT EXECUTE FUNCTION fat_orcado_recusa_bloqueada();
CREATE TRIGGER fat_orcado_bloq_upd AFTER UPDATE ON fat_orcado
  REFERENCING NEW TABLE AS alvo FOR EACH STATEMENT EXECUTE FUNCTION fat_orcado_recusa_bloqueada();
CREATE TRIGGER fat_orcado_bloq_del AFTER DELETE ON fat_orcado
  REFERENCING OLD TABLE AS alvo FOR EACH STATEMENT EXECUTE FUNCTION fat_orcado_recusa_bloqueada();

-- ── 5. fechar a porta que a RPC não fecha ─────────────────────────────────
-- ⚠⚠ A RPC não basta — lição da v3_174. `UPDATE` em `versao_orcamento` só exige
-- `pode_escrever()` (admin OU member), então um PATCH com {"bloqueada": true}
-- passava direto. ⚠ E `REVOKE` de coluna só vale depois de tirar o GRANT da
-- TABELA (lição da v3_150): sem isto, o grant de tabela segue cobrindo tudo.
REVOKE UPDATE ON versao_orcamento FROM authenticated;
GRANT UPDATE (codigo, descricao, ano, ativa, origem_versao_id) ON versao_orcamento TO authenticated;
-- `bloqueada`, `aprovado_*`, `mesclado_*` e `semeado_em` ficam de fora: todas
-- são carimbo de DECISÃO, e decisão se escreve por RPC, nunca por PATCH.

-- ---------------- conferência ----------------
SELECT 'quem pode fechar/reabrir' AS secao,
       (SELECT CASE WHEN count(*) = 1 THEN 'pode_bloquear_versao() criada' ELSE '⛔' END
          FROM pg_proc WHERE proname = 'pode_bloquear_versao') AS resultado
UNION ALL
SELECT 'authenticated ainda escreve `bloqueada` direto?',
       (SELECT CASE WHEN has_column_privilege('authenticated','versao_orcamento','bloqueada','UPDATE')
                    THEN '⛔ SIM — o revoke não pegou' ELSE 'não — correto' END)
UNION ALL
SELECT 'e as colunas legítimas continuam?',
       (SELECT CASE WHEN has_column_privilege('authenticated','versao_orcamento','descricao','UPDATE')
                     AND has_column_privilege('authenticated','versao_orcamento','ativa','UPDATE')
                    THEN 'sim — descricao e ativa editáveis' ELSE '⛔ quebrou a edição normal' END)
UNION ALL
SELECT 'gatilhos de cadeado em fat_orcado',
       (SELECT coalesce(string_agg(tgname, ' · ' ORDER BY tgname), '⛔ nenhum')
          FROM pg_trigger WHERE tgrelid = 'fat_orcado'::regclass AND tgname LIKE 'fat_orcado_bloq%')
UNION ALL
SELECT 'versões fechadas hoje',
       (SELECT coalesce(string_agg(codigo, ', '), 'nenhuma — nada mudou de estado')
          FROM versao_orcamento WHERE bloqueada);
