-- ============================================================
-- v3_131 · DESEMPENHO — envolver as funções em subconsulta escalar
--
-- DEFEITO MEU, e previsto na própria memória do projeto: "buscar o escopo uma
-- vez como array". Eu escrevi as funções sem argumento achando que isso
-- bastava. Não basta.
--
-- Em PostgreSQL, função STABLE dentro de um predicado de RLS é avaliada **por
-- linha**. Para virar avaliação única, ela precisa estar numa SUBCONSULTA
-- ESCALAR — `(SELECT f())` —, que o planner transforma em InitPlan.
--
-- Sem isso, cada uma das 1,07 milhão de linhas de `fat_realizado` chamava uma
-- função PL/pgSQL que consulta `user_acesso_regra`. O teste de não-regressão
-- ficou pendurado; foi assim que apareceu.
--
-- É a mesma otimização que a documentação do Supabase recomenda para
-- `auth.uid()`. Vale também para `current_tenant_id()`, que já era chamado
-- assim nas políticas originais — então este arquivo melhora algo que era
-- anterior a mim.
--
-- Nada muda na SEMÂNTICA: as mesmas condições, só envelopadas.
--
-- Rodar inteiro, app fechado. Idempotente. Depois, repetir o teste de
-- não-regressão — ele deve responder em segundos.
-- ============================================================

DO $mig$
DECLARE
  t       text;
  tem_cc  boolean;
  p_emp   text; p_fil text; p_cc text;      -- leitura (escopo VER)
  e_emp   text; e_fil text; e_cc text;      -- escrita (escopo ORCAR)
  tenant  text := '(SELECT current_tenant_id())';
BEGIN
  FOREACH t IN ARRAY ARRAY['fat_orcado','fat_realizado','fat_folha','posto','fat_saldo','fat_apontamento'] LOOP
    tem_cc := EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name=t AND column_name='cc_id');

    -- `(SELECT f())` nos DOIS lados: no teste de nulidade e na comparação.
    -- Deixar um só envelopado ainda chamaria a função por linha no outro.
    --
    -- ⚠ O `::uuid[]` não é decoração. Sem ele, `ANY((SELECT f()))` é lido como
    -- a forma de SUBCONSULTA do ANY — que espera um conjunto de uuid — e a
    -- função devolve UM valor do tipo uuid[]. O erro é
    -- `operator does not exist: uuid = uuid[]`, e está documentado no
    -- CLAUDE.md desde a otimização do v3_123. Caí nele de novo.
    p_emp := 'AND ((SELECT escopo_empresa()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT escopo_empresa())::uuid[])))';
    p_fil := 'AND ((SELECT escopo_filial())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT escopo_filial())::uuid[])))';
    p_cc  := CASE WHEN tem_cc THEN
             'AND ((SELECT escopo_cc())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT escopo_cc())::uuid[])))'
             ELSE '' END;
    e_emp := 'AND ((SELECT edit_empresa()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT edit_empresa())::uuid[])))';
    e_fil := 'AND ((SELECT edit_filial())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT edit_filial())::uuid[])))';
    e_cc  := CASE WHEN tem_cc THEN
             'AND ((SELECT edit_cc())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT edit_cc())::uuid[])))'
             ELSE '' END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_del', t);

    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = %s %s %s %s)',
                   t || '_sel', t, tenant, p_emp, p_fil, p_cc);

    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = %s AND (SELECT pode_escrever()) %s %s %s)',
                   t || '_ins', t, tenant, e_emp, e_fil, e_cc);

    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = %s AND (SELECT pode_escrever()) %s %s %s) WITH CHECK (tenant_id = %s AND (SELECT pode_escrever()) %s %s %s)',
                   t || '_upd', t, tenant, e_emp, e_fil, e_cc, tenant, e_emp, e_fil, e_cc);

    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = %s AND (SELECT pode_escrever()) %s %s %s)',
                   t || '_del', t, tenant, e_emp, e_fil, e_cc);
  END LOOP;
END $mig$;

-- ════════════════════════════════════════════════════════════
-- Conferência — sempre devolve linha
-- ════════════════════════════════════════════════════════════
-- Checa as duas coisas juntas: que não sobrou política FOR ALL (o defeito do
-- v3_129) e que toda função de escopo está dentro de subconsulta (o deste).
-- Função solta aparece como `escopo_x()` sem o `SELECT` à frente.
SELECT c.relname                                                  AS tabela,
       count(*) FILTER (WHERE p.polcmd = '*')                      AS for_all_restante,
       count(*) FILTER (WHERE p.polcmd IN ('r','*')
                          AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%escopo_%') AS leem_SEM_recorte,
       count(*) FILTER (WHERE pg_get_expr(p.polqual, p.polrelid)   ~ '(?<!select )escopo_(cc|empresa|filial)\(\)'
                           OR pg_get_expr(p.polwithcheck, p.polrelid) ~ '(?<!select )edit_(cc|empresa|filial)\(\)')
                                                                   AS funcao_SOLTA,
       CASE
         WHEN count(*) FILTER (WHERE p.polcmd = '*') > 0 THEN '⛔ FOR ALL ainda vaza na leitura'
         WHEN count(*) FILTER (WHERE p.polcmd IN ('r','*')
                                AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%escopo_%') > 0 THEN '⛔ SELECT sem recorte'
         ELSE '✓ recortado e envelopado em InitPlan'
       END                                                         AS veredito
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('fat_orcado','fat_realizado','fat_folha','posto','fat_saldo','fat_apontamento')
 GROUP BY c.relname
 ORDER BY c.relname;
