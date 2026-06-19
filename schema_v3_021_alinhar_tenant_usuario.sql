-- ============================================================
-- Alinha os usuários à tenant onde os dados realmente estão.
-- Situação encontrada: a tabela `tenant` só tem 11111111-… (a nossa,
-- onde está TODO o dado), mas os usuários em `user_tenant` apontavam
-- para 00000000-…-001 (que nem existe na tabela tenant → órfã).
-- Solução: repontar os usuários (e regras de acesso) para a 111….
-- Não há dados de outra tenant para apagar.
-- ============================================================
UPDATE user_tenant
   SET tenant_id = '11111111-1111-1111-1111-111111111111'
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- Regras de acesso por usuário (se houver) seguem para a mesma tenant
UPDATE user_acesso_regra
   SET tenant_id = '11111111-1111-1111-1111-111111111111'
 WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- conferência
-- select user_id, tenant_id, role from user_tenant;
