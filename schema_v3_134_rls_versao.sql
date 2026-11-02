-- ============================================================
-- v3_134 · Escopo de VERSÃO no banco — fecha o furo da visão salva
--
-- O FURO (achado em 02/nov): o seletor de versão está filtrado, mas
-- `view_config.cenarios` é um `text[]` com **ids de versão direto**, aplicado
-- sem passar pelo filtro. E `view_config` tem RLS só por tenant, então todo
-- usuário enxerga toda visão salva — basta escolher uma para trazer a versão
-- que ela nomeia. Um viewer restrito a uma versão via outra assim.
--
-- Com a versão no predicado, visão proibida simplesmente volta **sem dado**.
-- Resolve a causa em vez da aparência.
--
-- ⚠ ARMADILHA TRATADA AQUI. Desde o v3_133 a ausência de regra NEGA. Somar
-- `versao_id` ao predicado trancaria o orçado de todo usuário que não tem regra
-- de versão — e a dimensão `versao` nasceu há três dias, então quase ninguém
-- tem. A parte 1 **semeia** regra vazia (= vê todas, explícito) para quem não
-- tem, preservando o estado atual. Quem JÁ restringiu versão não é tocado.
--
-- Só `fat_orcado` e `fat_folha`: são os únicos fatos com `versao_id`.
-- `fat_realizado` não tem — realizado não pertence a cenário nenhum.
--
-- Rodar inteiro. O relatório do fim sempre devolve linha.
-- ============================================================

-- ---------- 1 · semear "vê todas as versões" para quem não tem regra ----------
-- Lista vazia = vê tudo, como escolha explícita (v3_132). É o que a tela de
-- Configurações grava quando nada é marcado.
INSERT INTO user_acesso_regra (tenant_id, user_id, dimensao, escopo, valor_ids, negados)
SELECT ut.tenant_id, ut.user_id, 'versao', 'VER', '{}'::uuid[], '{}'::uuid[]
  FROM user_tenant ut
 WHERE NOT EXISTS (SELECT 1 FROM user_acesso_regra r
                    WHERE r.user_id = ut.user_id AND r.dimensao = 'versao' AND r.escopo = 'VER')
ON CONFLICT DO NOTHING;

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

-- ---------- 4 · PROVA: personifica e conta por versão ----------
DO $prova$
DECLARE u record; n_orc bigint; n_ver int; rel text := '';
BEGIN
  FOR u IN SELECT user_id, role FROM user_tenant ORDER BY role, user_id LOOP
    SELECT coalesce(array_length(valor_ids,1),0) INTO n_ver FROM user_acesso_regra
     WHERE user_id = u.user_id AND dimensao = 'versao' AND escopo = 'VER';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT count(DISTINCT versao_id) FROM fat_orcado' INTO n_orc;
    RESET ROLE;

    rel := rel || format(E'\n%s  %s  versões marcadas=%s  →  enxerga %s versão(ões) no orçado',
      rpad(u.role,7), left(u.user_id::text,8) || '…',
      CASE WHEN n_ver = 0 THEN 'todas' ELSE n_ver::text END, n_orc);
  END LOOP;
  RAISE EXCEPTION E'=== ESCOPO DE VERSÃO ===%\n\nESPERADO:\n  · admin ............... todas\n  · "marcadas=todas" .... todas (regra vazia = explícito)\n  · "marcadas=1" ........ 1\n\nSe quem marcou 1 enxerga mais de 1, o predicado de versão não pegou.', rel;
END $prova$;
