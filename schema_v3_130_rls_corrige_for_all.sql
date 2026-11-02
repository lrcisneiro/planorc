-- ============================================================
-- v3_130 · CORRIGE o v3_129 — `FOR ALL` anulava o escopo na leitura
--
-- DEFEITO MEU, e grave. O v3_129 criou duas políticas por tabela:
--   · `*_sel` FOR SELECT, com o recorte de empresa/filial/CC
--   · `*_wr`  FOR ALL,    com apenas tenant + pode_escrever()
--
-- Em PostgreSQL, `FOR ALL` **inclui SELECT**, e políticas PERMISSIVAS se
-- combinam com **OU**. Resultado: para quem é admin ou member, a leitura
-- passava pela segunda política e o recorte de CC não valia nada. Só o
-- `viewer` ficava restrito — e viewer era justamente quem menos precisava.
--
-- O diretor de área é `member`. Ou seja: o v3_129 sozinho NÃO resolvia o
-- ACS-02 para o caso que motivou tudo isto.
--
-- A conferência do v3_129 também falhou, e vale registrar por quê: ela checava
-- se ALGUMA política menciona `escopo_cc`, o que era verdade. A pergunta certa
-- é se EXISTE alguma política de SELECT que NÃO recorta — é essa que abre o
-- buraco, porque basta uma para o OU liberar tudo. A conferência nova pergunta
-- assim.
--
-- O QUE MUDA: escrita deixa de ser `FOR ALL` e vira três políticas por comando
-- (INSERT, UPDATE, DELETE). Nenhuma delas toca SELECT.
--
-- E a escrita passa a respeitar ESCOPO também, não só o papel. Um member não
-- deve poder editar o orçado do CC da Diretoria — é o que o `canEdit` do
-- frontend já faz, usando o escopo ORCAR com herança do VER.
--
-- Rodar inteiro, app fechado. Idempotente.
-- ============================================================

-- ---------- escopo de EDIÇÃO: ORCAR, herdando de VER ----------
-- Espelha `useUserAccess.canEdit`: regra ORCAR quando existe, senão a de VER.
CREATE OR REPLACE FUNCTION escopo_dim_edit(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean := false;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;

  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'ORCAR'
   LIMIT 1;

  -- Sem regra de ORCAR → herda a de VER, igual ao frontend.
  IF NOT v_tem THEN RETURN escopo_dim(p_dim); END IF;

  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c WHERE c.tenant_id = current_tenant_id() AND NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e      WHERE e.tenant_id = current_tenant_id() AND NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f       WHERE f.tenant_id = current_tenant_id() AND NOT (f.id = ANY(v_deny)))
      ELSE NULL END;
  END IF;
  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

CREATE OR REPLACE FUNCTION edit_empresa() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_edit('empresa') $$;
CREATE OR REPLACE FUNCTION edit_filial() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_edit('filial') $$;
CREATE OR REPLACE FUNCTION edit_cc() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_edit('centro_custo') $$;

REVOKE ALL ON FUNCTION escopo_dim_edit(text) FROM public;
GRANT EXECUTE ON FUNCTION edit_empresa(), edit_filial(), edit_cc() TO authenticated;

-- ---------- troca FOR ALL por políticas POR COMANDO ----------
-- `escrita_ok(empresa, filial, cc)` como expressão inline em cada policy: a
-- linha que se grava ou altera tem de estar no escopo de ORÇAR, e nulo não
-- passa — pelo mesmo motivo da leitura.

DO $mig$
DECLARE
  t text;
  tem_cc boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['fat_orcado','fat_realizado','fat_folha','posto','fat_saldo','fat_apontamento'] LOOP
    tem_cc := EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name=t AND column_name='cc_id');

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_wr', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_del', t);

    -- a expressão de escopo de escrita, montada conforme a tabela tenha cc_id
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR INSERT WITH CHECK (
        tenant_id = current_tenant_id() AND pode_escrever()
        AND (edit_empresa() IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY(edit_empresa())))
        AND (edit_filial()  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY(edit_filial())))
        %s
      )$f$, t || '_ins', t,
      CASE WHEN tem_cc THEN 'AND (edit_cc() IS NULL OR (cc_id IS NOT NULL AND cc_id = ANY(edit_cc())))' ELSE '' END);

    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR UPDATE
      USING (
        tenant_id = current_tenant_id() AND pode_escrever()
        AND (edit_empresa() IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY(edit_empresa())))
        AND (edit_filial()  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY(edit_filial())))
        %s
      ) WITH CHECK (
        tenant_id = current_tenant_id() AND pode_escrever()
        AND (edit_empresa() IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY(edit_empresa())))
        AND (edit_filial()  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY(edit_filial())))
        %s
      )$f$, t || '_upd', t,
      CASE WHEN tem_cc THEN 'AND (edit_cc() IS NULL OR (cc_id IS NOT NULL AND cc_id = ANY(edit_cc())))' ELSE '' END,
      CASE WHEN tem_cc THEN 'AND (edit_cc() IS NULL OR (cc_id IS NOT NULL AND cc_id = ANY(edit_cc())))' ELSE '' END);

    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR DELETE USING (
        tenant_id = current_tenant_id() AND pode_escrever()
        AND (edit_empresa() IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY(edit_empresa())))
        AND (edit_filial()  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY(edit_filial())))
        %s
      )$f$, t || '_del', t,
      CASE WHEN tem_cc THEN 'AND (edit_cc() IS NULL OR (cc_id IS NOT NULL AND cc_id = ANY(edit_cc())))' ELSE '' END);
  END LOOP;
END $mig$;

-- ════════════════════════════════════════════════════════════
-- Conferência — agora pergunta o que importa
-- ════════════════════════════════════════════════════════════
-- A pergunta certa não é "alguma política recorta?" e sim "EXISTE política de
-- SELECT que NÃO recorta?". Basta uma para o OU das permissivas liberar tudo.
-- Sempre devolve linha.
SELECT c.relname                                                   AS tabela,
       count(*) FILTER (WHERE p.polcmd IN ('r','*'))                AS politicas_que_leem,
       count(*) FILTER (WHERE p.polcmd IN ('r','*')
                          AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%escopo_%') AS leem_SEM_recorte,
       count(*) FILTER (WHERE p.polcmd = 'a')                       AS pol_insert,
       count(*) FILTER (WHERE p.polcmd = 'w')                       AS pol_update,
       count(*) FILTER (WHERE p.polcmd = 'd')                       AS pol_delete,
       CASE
         WHEN count(*) FILTER (WHERE p.polcmd = '*') > 0
           THEN '⛔ ainda há política FOR ALL — ela vaza na leitura'
         WHEN count(*) FILTER (WHERE p.polcmd IN ('r','*')
                                AND pg_get_expr(p.polqual, p.polrelid) NOT ILIKE '%escopo_%') > 0
           THEN '⛔ há SELECT sem recorte'
         WHEN count(*) FILTER (WHERE p.polcmd IN ('r','*')) = 0
           THEN '⚠ nenhuma política de leitura'
         ELSE '✓ toda leitura recortada, escrita por comando'
       END                                                          AS veredito
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('fat_orcado','fat_realizado','fat_folha','posto','fat_saldo','fat_apontamento')
 GROUP BY c.relname
 ORDER BY c.relname;
