-- ============================================================
-- v3_135 · `viewer` para de escrever em catálogo e estrutura pela API
--
-- O v3_130 protegeu a escrita nos SEIS fatos. As demais tabelas continuaram com
-- a política original — `FOR ALL` só por tenant — e `authenticated` tem
-- `GRANT ALL`. Resultado: a tela barra o `viewer` pelas capacidades, a **API
-- não**. Ele pode apagar um centro de custo, mexer numa regra de rateio ou
-- alterar a árvore do relatório pela REST.
--
-- Não é vazamento — catálogo não tem remuneração. É **integridade**. E em
-- orçamento, estrutura errada vale tanto quanto número errado: uma regra de
-- rateio com a dimensão trocada deslocou 3,57 mi semana passada.
--
-- O QUE FAZ: para cada tabela com RLS cuja política é `FOR ALL` só por tenant,
-- troca por leitura livre (dentro do tenant) + escrita exigindo
-- `pode_escrever()`. A leitura NÃO muda: catálogo é lido por todos.
--
-- ⚠ DUAS EXCEÇÕES, e as duas são deliberadas:
--   · os 6 fatos → já tratados (v3_130/131/134), não entram no laço;
--   · `user_tenant`, `user_acesso_regra`, `user_acesso_funcao` → têm política
--     própria e `user_tenant` **não tem** política de escrita de propósito: é a
--     ausência dela que impede alguém de promover a si mesmo (ACS-03).
--   · `dashboard_card` → tratada à parte LOGO ABAIXO: um `viewer` PRECISA
--     salvar card pessoal. Barrá-lo ali seria tirar função legítima em nome de
--     segurança que o caso não pede.
--
-- Rodar inteiro. O relatório do fim sempre devolve linha.
-- ============================================================

DO $mig$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tabela, p.polname
      FROM pg_class c
      JOIN pg_policy p ON p.polrelid = c.oid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'r' AND c.relrowsecurity
       AND p.polcmd = '*'                                   -- só as FOR ALL
       AND c.relname NOT IN ('fat_orcado','fat_realizado','fat_folha','posto',
                             'fat_saldo','fat_apontamento',  -- já tratados
                             'user_tenant','user_acesso_regra','user_acesso_funcao',
                             'dashboard_card')               -- à parte
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.polname, r.tabela);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = (SELECT current_tenant_id()))',
                   r.tabela || '_sel', r.tabela);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()))',
                   r.tabela || '_ins', r.tabela);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever())) WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()))',
                   r.tabela || '_upd', r.tabela);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()))',
                   r.tabela || '_del', r.tabela);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'tabelas convertidas: %', n;
END $mig$;

-- ---------- dashboard_card: o viewer salva O PRÓPRIO card ----------
-- `owner_id = auth.uid()` → card pessoal; `owner_id IS NULL` → compartilhado,
-- que só admin cria. Ler continua livre: o compartilhado é de todos, e o
-- pessoal já é filtrado pelo próprio dono na consulta da tela.
DROP POLICY IF EXISTS dashboard_card_rls ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_sel ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_ins ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_upd ON dashboard_card;
DROP POLICY IF EXISTS dashboard_card_del ON dashboard_card;

CREATE POLICY dashboard_card_sel ON dashboard_card FOR SELECT
  USING (tenant_id = (SELECT current_tenant_id())
         AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())));

CREATE POLICY dashboard_card_ins ON dashboard_card FOR INSERT
  WITH CHECK (tenant_id = (SELECT current_tenant_id())
              AND (owner_id = (SELECT auth.uid())                 -- o meu
                   OR (owner_id IS NULL AND (SELECT eh_admin()))));  -- compartilhado: só admin

CREATE POLICY dashboard_card_upd ON dashboard_card FOR UPDATE
  USING (tenant_id = (SELECT current_tenant_id())
         AND (owner_id = (SELECT auth.uid()) OR (SELECT eh_admin())))
  WITH CHECK (tenant_id = (SELECT current_tenant_id())
         AND (owner_id = (SELECT auth.uid()) OR (SELECT eh_admin())));

CREATE POLICY dashboard_card_del ON dashboard_card FOR DELETE
  USING (tenant_id = (SELECT current_tenant_id())
         AND (owner_id = (SELECT auth.uid()) OR (SELECT eh_admin())));

-- ---------- conferência — sempre devolve linha ----------
SELECT c.relname                                                   AS tabela,
       count(*) FILTER (WHERE p.polcmd = '*')                       AS ainda_FOR_ALL,
       count(*) FILTER (WHERE p.polcmd = 'r')                       AS le,
       count(*) FILTER (WHERE p.polcmd IN ('a','w','d'))            AS escreve,
       bool_or(coalesce(pg_get_expr(p.polqual, p.polrelid),'')      ilike '%pode_escrever%'
            OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'') ilike '%pode_escrever%'
            OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'') ilike '%auth.uid%')  AS protege_escrita,
       CASE
         WHEN c.relname IN ('user_tenant','user_acesso_regra','user_acesso_funcao')
              THEN 'política própria — não tocada (ACS-03)'
         WHEN count(*) FILTER (WHERE p.polcmd = '*') > 0 THEN '⛔ ainda FOR ALL'
         WHEN bool_or(coalesce(pg_get_expr(p.polqual, p.polrelid),'')      ilike '%pode_escrever%'
                   OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'') ilike '%pode_escrever%'
                   OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'') ilike '%auth.uid%') THEN '✓ escrita protegida'
         ELSE '⚠ conferir'
       END                                                          AS veredito
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind = 'r' AND c.relrowsecurity
 GROUP BY c.relname
 ORDER BY 6 DESC, 1;
