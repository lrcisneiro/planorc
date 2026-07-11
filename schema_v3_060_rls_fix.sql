-- ============================================================
-- MIGRATION 057 — CORREÇÃO CRÍTICA DE RLS
--
-- Problema corrigido:
--   A função current_tenant_id() (usada pelas policies da linhagem v3)
--   fazia COALESCE(auth.jwt()->>'tenant_id', '1111...') — ou seja,
--   quando NÃO havia claim tenant_id no JWT (o caso NORMAL do Supabase,
--   inclusive em requisições ANÔNIMAS só com a anon key), ela caía para
--   o tenant fixo '11111111-...' — que é exatamente onde estão os dados.
--
--   Resultado: qualquer requisição com a anon key (pública, presente no
--   bundle do frontend), SEM login, resolvia para o tenant real e as
--   policies "FOR ALL USING (tenant_id = current_tenant_id())" liberavam
--   leitura E escrita de TODOS os dados financeiros.
--
-- Correção:
--   1. Reconcilia user_tenant: mapeia os usuários reais ao tenant canônico
--      (1111...), que é o que o frontend usa em todos os inserts.
--   2. Redefine current_tenant_id() para resolver o tenant a partir do
--      usuário autenticado (user_tenant), SEM fallback fixo. Requisição
--      anônima => auth.uid() NULL => retorna NULL => RLS NEGA tudo.
--   3. (Opcional) Defesa em profundidade: revoga privilégios do role anon.
--
-- COMO USAR:
--   - Rode a PARTE 0 (diagnóstico) primeiro e confira os resultados.
--   - Depois rode a PARTE 1 (correção). É idempotente.
--   - Avalie a PARTE 2 (hardening anon) — recomendada.
--   - PARTE 3 é o rollback, caso precise reverter.
--
-- Rodar no Supabase SQL Editor.
-- ============================================================

-- Tenant canônico = o que o frontend grava em todos os inserts
-- (lib/supabase.ts: TENANT_ID) e o que os seeds v3 usam.
-- 11111111-1111-1111-1111-111111111111


-- ============================================================
-- PARTE 0 — DIAGNÓSTICO (rode e leia ANTES de aplicar a correção)
-- ============================================================

-- 0.1 Em quais tenants estão os dados de fato?
--     Esperado: praticamente tudo em 1111...
-- SELECT 'fat_realizado' t, tenant_id, count(*) FROM fat_realizado GROUP BY tenant_id
-- UNION ALL SELECT 'fat_orcado',  tenant_id, count(*) FROM fat_orcado  GROUP BY tenant_id
-- UNION ALL SELECT 'relatorio',   tenant_id, count(*) FROM relatorio   GROUP BY tenant_id
-- UNION ALL SELECT 'empresa',     tenant_id, count(*) FROM empresa     GROUP BY tenant_id
-- ORDER BY 1,2;

-- 0.2 Para qual tenant os usuários estão mapeados hoje?
--     (a migration 005 mapeou para 0000...0001 'TOTVS Oeste' — divergente!)
-- SELECT u.email, ut.tenant_id, ut.role
-- FROM user_tenant ut JOIN auth.users u ON u.id = ut.user_id
-- ORDER BY u.email;

-- Se 0.1 mostrar dados fora de 1111..., ajuste a PARTE 1.4 (migração de dados).


-- ============================================================
-- PARTE 1 — CORREÇÃO (idempotente)
-- ============================================================

BEGIN;

-- 1.1 Garante que o tenant canônico existe
INSERT INTO tenant (id, nome, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Planorc', 'planorc')
ON CONFLICT (id) DO NOTHING;

-- 1.2 Mapeia TODOS os usuários de auth ao tenant canônico como admin.
--     (single-tenant hoje; ajuste papéis depois em Configurações.)
INSERT INTO user_tenant (user_id, tenant_id, role)
SELECT id, '11111111-1111-1111-1111-111111111111', 'admin'
FROM auth.users
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- 1.3 Remove mapeamentos para tenants DIVERGENTES (ex.: 0000...0001).
--     Evita que get_my_tenant_id() (LIMIT 1) escolha o tenant errado.
--     >>> Se você usa múltiplos tenants de verdade, NÃO rode este DELETE. <<<
DELETE FROM user_tenant
WHERE tenant_id <> '11111111-1111-1111-1111-111111111111';

-- 1.4 (Opcional) Migra dados órfãos de outro tenant para o canônico.
--     Descomente SÓ se a PARTE 0.1 mostrar linhas fora de 1111...
--     e você tiver certeza de que pertencem a este cliente.
-- DO $$
-- DECLARE tbl text; canon uuid := '11111111-1111-1111-1111-111111111111';
-- BEGIN
--   FOREACH tbl IN ARRAY ARRAY[
--     'empresa','filial','centro_custo','conta_contabil','versao_orcamento',
--     'relatorio','categoria_relatorio','conta_linha','conta_orcamentaria',
--     'fat_orcado','fat_realizado','fat_saldo','formulario','formulario_valor'
--   ] LOOP
--     EXECUTE format('UPDATE %I SET tenant_id = $1 WHERE tenant_id <> $1', tbl) USING canon;
--   END LOOP;
-- END $$;

-- 1.5 *** O CORE DA CORREÇÃO ***
--     current_tenant_id() sem fallback fixo. Resolve pelo usuário logado.
--     Anon (auth.uid() NULL) => NULL => "tenant_id = NULL" nunca é true => nega.
--     SECURITY DEFINER para ler user_tenant de forma confiável.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM user_tenant
  WHERE user_id = auth.uid()
  ORDER BY (tenant_id = '11111111-1111-1111-1111-111111111111') DESC
  LIMIT 1
$$;

-- 1.6 Unifica get_my_tenant_id() (migration 005) com a mesma lógica,
--     para não haver duas fontes de verdade divergentes.
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_tenant_id()
$$;

COMMIT;


-- ============================================================
-- PARTE 2 — HARDENING (defesa em profundidade) — RECOMENDADO
--
-- Mesmo com a função corrigida, negar explicitamente o role anon
-- garante que nenhuma policy futura mal configurada exponha dados.
-- O app só usa endpoints de /auth com a anon key ANTES do login;
-- nenhuma tabela é lida por usuário não autenticado.
-- ============================================================

-- 2.1 Revoga qualquer privilégio de tabela/rotina do role anon no schema public.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2.2 E para objetos criados no futuro:
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- Obs.: NÃO revogue do role authenticated — o app depende dele.
-- Obs.: no painel do Supabase, confirme que "Anonymous sign-ins" está
--       DESLIGADO (Authentication > Providers), e reveja se o signup
--       público deve ficar aberto (Authentication > Sign In / Providers).


-- ============================================================
-- PARTE 3 — ROLLBACK (apenas se algo quebrar)
-- Restaura o comportamento antigo da função (INSEGURO — só emergência).
-- ============================================================
-- CREATE OR REPLACE FUNCTION current_tenant_id()
-- RETURNS uuid LANGUAGE sql STABLE AS $$
--   SELECT COALESCE(
--     (auth.jwt() ->> 'tenant_id')::uuid,
--     '11111111-1111-1111-1111-111111111111'::uuid
--   )
-- $$;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;


-- ============================================================
-- VALIDAÇÃO PÓS-APLICAÇÃO
-- ============================================================
-- 1) No terminal, SEM login, deve retornar [] (ou 401), NÃO dados:
--    curl "https://okzzrmafldabhwlsgizg.supabase.co/rest/v1/fat_realizado?select=id&limit=1" \
--         -H "apikey: SUA_ANON_KEY"
--
-- 2) Logado no app (planorc.com), tudo deve continuar funcionando
--    normalmente (relatórios, orçar, dashboards).
--    Se aparecer vazio: a PARTE 1.2/1.3 não mapeou seu usuário ao
--    tenant 1111... — rode a PARTE 0.2 e ajuste.
-- ============================================================
