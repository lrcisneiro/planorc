-- ============================================================
-- v3_141 — Quatro cadastros de fundação passam a exigir admin
--
-- `tenant`, `dimensao`, `dimensao_config` e `grupo_empresarial` aceitavam
-- escrita de qualquer `member` (`pode_escrever()`), folga que entrou na v3_135
-- sem necessidade: são as tabelas que definem o que o resto do sistema É.
-- `dimensao` cria dimensão de DADOS — quem a cria define por onde o escopo
-- recorta, então escrever nela é, de fato, mexer no controle de acesso.
--
-- Nenhuma delas é editada em operação do dia. Troca `pode_escrever()` por
-- `eh_admin()` nas 12 políticas de escrita; a LEITURA não muda.
--
-- O predicado de tenant vai COPIADO de cada tabela, não padronizado: duas usam
-- `get_my_tenant_id()` e duas `current_tenant_id()`. Uniformizar aqui seria
-- mudar duas coisas numa migration que deveria mudar uma — e já me custou uma
-- migration presumir que todas as tabelas eram iguais.
--
-- `(SELECT eh_admin())` e não `eh_admin()`: função em política roda POR LINHA;
-- só dentro de subconsulta escalar vira avaliação única.
--
-- Termina em SELECT.
-- ============================================================

-- ── tenant (chave é `id`, não `tenant_id`) ──
DROP POLICY IF EXISTS tenant_ins ON tenant;
CREATE POLICY tenant_ins ON tenant FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));
DROP POLICY IF EXISTS tenant_upd ON tenant;
CREATE POLICY tenant_upd ON tenant FOR UPDATE TO authenticated
  USING (id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));
DROP POLICY IF EXISTS tenant_del ON tenant;
CREATE POLICY tenant_del ON tenant FOR DELETE TO authenticated
  USING (id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));

-- ── dimensao (get_my_tenant_id) ──
DROP POLICY IF EXISTS dimensao_ins ON dimensao;
CREATE POLICY dimensao_ins ON dimensao FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id() AND (SELECT eh_admin()));
DROP POLICY IF EXISTS dimensao_upd ON dimensao;
CREATE POLICY dimensao_upd ON dimensao FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND (SELECT eh_admin()));
DROP POLICY IF EXISTS dimensao_del ON dimensao;
CREATE POLICY dimensao_del ON dimensao FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND (SELECT eh_admin()));

-- ── dimensao_config (current_tenant_id) ──
DROP POLICY IF EXISTS dimensao_config_ins ON dimensao_config;
CREATE POLICY dimensao_config_ins ON dimensao_config FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND (SELECT eh_admin()));
DROP POLICY IF EXISTS dimensao_config_upd ON dimensao_config;
CREATE POLICY dimensao_config_upd ON dimensao_config FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND (SELECT eh_admin()));
DROP POLICY IF EXISTS dimensao_config_del ON dimensao_config;
CREATE POLICY dimensao_config_del ON dimensao_config FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (SELECT eh_admin()));

-- ── grupo_empresarial (get_my_tenant_id) ──
DROP POLICY IF EXISTS grupo_empresarial_ins ON grupo_empresarial;
CREATE POLICY grupo_empresarial_ins ON grupo_empresarial FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_my_tenant_id() AND (SELECT eh_admin()));
DROP POLICY IF EXISTS grupo_empresarial_upd ON grupo_empresarial;
CREATE POLICY grupo_empresarial_upd ON grupo_empresarial FOR UPDATE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND (SELECT eh_admin()));
DROP POLICY IF EXISTS grupo_empresarial_del ON grupo_empresarial;
CREATE POLICY grupo_empresarial_del ON grupo_empresarial FOR DELETE TO authenticated
  USING (tenant_id = get_my_tenant_id() AND (SELECT eh_admin()));

-- Conferência: as 12 de escrita devem citar eh_admin, e nenhuma pode_escrever.
SELECT tablename, cmd, policyname,
       CASE WHEN coalesce(qual, with_check) LIKE '%eh_admin%'      THEN 'admin'
            WHEN coalesce(qual, with_check) LIKE '%pode_escrever%' THEN '⛔ ainda member'
            ELSE 'leitura' END AS exige
  FROM pg_policies
 WHERE tablename IN ('tenant','dimensao','dimensao_config','grupo_empresarial')
 ORDER BY tablename, cmd;
