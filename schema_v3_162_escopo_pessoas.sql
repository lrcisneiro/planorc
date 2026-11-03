-- ============================================================
-- v3_162 — Escopo PESSOAS: o recorte de gente deixa de ser o do orçamento
--
-- Uma gestora de RH orça o próprio centro de custo e é responsável pelas
-- pessoas da empresa inteira. O escopo era por PESSOA; o que faltava é escopo
-- por ASSUNTO — e o modelo já tinha a forma: `escopo ∈ VER | ORCAR`, com
-- `escopo_dim_edit()` caindo em `escopo_dim()` quando não há regra de ORCAR.
-- Entra o terceiro valor, copiando essa mecânica.
--
-- ⚠ A REGRA DE CONVIVÊNCIA É O PONTO. Pela v3_132, ausência de regra = não vê
-- nada. Se PESSOAS seguisse isso, TODO usuário perderia os postos no dia do
-- deploy. Então: **sem regra PESSOAS, cai no VER** (leitura) e no
-- ORCAR→VER (escrita) — ninguém muda de acesso até alguém cadastrar. Regra
-- PESSOAS com lista vazia = vê tudo, que é a escolha explícita da v3_132.
--
-- Vale para LEITURA e ESCRITA das tabelas de gente, com o papel continuando a
-- ser a trava grossa: um `viewer` com PESSOAS global vê tudo e grava nada,
-- porque `pode_escrever()` o barra antes. É o que permite a coordenadora de RH
-- conferir a empresa inteira sem poder alterá-la — a estrutura é mantida no
-- ERP, e o Planorc confere.
--
-- Alcança `posto`, `posto_v`, `fat_folha` e `fat_apontamento`. **Não** alcança
-- `fat_orcado`, `fat_realizado` nem `fat_saldo`: orçamento e contábil seguem no
-- VER/ORCAR, que é exatamente a separação que motivou isto. `fat_folha` mantém
-- o recorte por VERSÃO inalterado — versão é eixo de orçamento.
--
-- ⚠ Função STABLE em policy roda POR LINHA: toda chamada vai dentro de
-- `(SELECT f())` e todo ANY leva `::uuid[]`, senão é lido como subconsulta.
--
-- Prova por personificação em `prova_escopo_pessoas.sql` — rodar DEPOIS.
-- Termina em SELECT.
-- ============================================================

DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'user_acesso_regra'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%escopo%'
  LOOP EXECUTE format('ALTER TABLE user_acesso_regra DROP CONSTRAINT %I', c); END LOOP;
END $$;
ALTER TABLE user_acesso_regra
  ADD CONSTRAINT user_acesso_regra_escopo_chk
  CHECK (escopo = ANY (ARRAY['VER','ORCAR','PESSOAS']));

-- Leitura: regra PESSOAS, ou o VER de hoje.
CREATE OR REPLACE FUNCTION escopo_dim_pessoas(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;
  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'PESSOAS' LIMIT 1;
  IF v_tem IS NOT TRUE THEN RETURN escopo_dim(p_dim); END IF;
  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c WHERE NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e      WHERE NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f       WHERE NOT (f.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;
  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

-- Escrita: a MESMA regra PESSOAS (quem gere gente, gere onde gere), ou o
-- comportamento de hoje. O papel continua barrando antes, via pode_escrever().
CREATE OR REPLACE FUNCTION edit_dim_pessoas(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tem boolean;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;
  SELECT true INTO v_tem FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'PESSOAS' LIMIT 1;
  IF v_tem IS NOT TRUE THEN RETURN escopo_dim_edit(p_dim); END IF;
  RETURN escopo_dim_pessoas(p_dim);
END $$;

CREATE OR REPLACE FUNCTION escopo_empresa_pessoas() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_pessoas('empresa') $$;
CREATE OR REPLACE FUNCTION escopo_filial_pessoas() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_pessoas('filial') $$;
CREATE OR REPLACE FUNCTION escopo_cc_pessoas() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim_pessoas('centro_custo') $$;
CREATE OR REPLACE FUNCTION edit_empresa_pessoas() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT edit_dim_pessoas('empresa') $$;
CREATE OR REPLACE FUNCTION edit_filial_pessoas() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT edit_dim_pessoas('filial') $$;
CREATE OR REPLACE FUNCTION edit_cc_pessoas() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT edit_dim_pessoas('centro_custo') $$;

DO $$ DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['escopo_dim_pessoas(text)','edit_dim_pessoas(text)',
    'escopo_empresa_pessoas()','escopo_filial_pessoas()','escopo_cc_pessoas()',
    'edit_empresa_pessoas()','edit_filial_pessoas()','edit_cc_pessoas()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ── posto ───────────────────────────────────────────────────
-- ⚠ Escrita por comando, NUNCA FOR ALL: FOR ALL inclui SELECT e políticas
-- permissivas se combinam com OU — a de escrita vazaria a leitura inteira.
DROP POLICY IF EXISTS posto_sel ON posto;
CREATE POLICY posto_sel ON posto FOR SELECT TO authenticated USING (
  tenant_id = (SELECT current_tenant_id())
  AND ((SELECT escopo_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT escopo_empresa_pessoas())::uuid[])))
  AND ((SELECT escopo_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT escopo_filial_pessoas())::uuid[])))
  AND ((SELECT escopo_cc_pessoas())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT escopo_cc_pessoas())::uuid[]))));

DO $$ DECLARE cmd text; pol text;
BEGIN
  FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    pol := 'posto_' || lower(left(cmd,3));
    EXECUTE format('DROP POLICY IF EXISTS %I ON posto', pol);
    EXECUTE format($f$CREATE POLICY %I ON posto FOR %s TO authenticated %s (
      tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever())
      AND ((SELECT edit_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT edit_empresa_pessoas())::uuid[])))
      AND ((SELECT edit_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT edit_filial_pessoas())::uuid[])))
      AND ((SELECT edit_cc_pessoas())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT edit_cc_pessoas())::uuid[]))))$f$,
      pol, cmd, CASE WHEN cmd = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END);
  END LOOP;
END $$;

-- ── fat_folha (versão segue no escopo de orçamento) ─────────
DROP POLICY IF EXISTS fat_folha_sel ON fat_folha;
CREATE POLICY fat_folha_sel ON fat_folha FOR SELECT TO authenticated USING (
  tenant_id = (SELECT current_tenant_id())
  AND ((SELECT escopo_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT escopo_empresa_pessoas())::uuid[])))
  AND ((SELECT escopo_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT escopo_filial_pessoas())::uuid[])))
  AND ((SELECT escopo_cc_pessoas())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT escopo_cc_pessoas())::uuid[])))
  AND ((SELECT escopo_versao())          IS NULL OR (versao_id  IS NOT NULL AND versao_id  = ANY((SELECT escopo_versao())::uuid[]))));

DO $$ DECLARE cmd text; pol text;
BEGIN
  FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    pol := 'fat_folha_' || lower(left(cmd,3));
    EXECUTE format('DROP POLICY IF EXISTS %I ON fat_folha', pol);
    EXECUTE format($f$CREATE POLICY %I ON fat_folha FOR %s TO authenticated %s (
      tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever())
      AND ((SELECT edit_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT edit_empresa_pessoas())::uuid[])))
      AND ((SELECT edit_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT edit_filial_pessoas())::uuid[])))
      AND ((SELECT edit_cc_pessoas())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT edit_cc_pessoas())::uuid[])))
      AND ((SELECT edit_versao())          IS NULL OR (versao_id  IS NOT NULL AND versao_id  = ANY((SELECT edit_versao())::uuid[]))))$f$,
      pol, cmd, CASE WHEN cmd = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END);
  END LOOP;
END $$;

-- ── fat_apontamento (não tem cc_id) ─────────────────────────
DROP POLICY IF EXISTS fat_apontamento_sel ON fat_apontamento;
CREATE POLICY fat_apontamento_sel ON fat_apontamento FOR SELECT TO authenticated USING (
  tenant_id = (SELECT current_tenant_id())
  AND ((SELECT escopo_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT escopo_empresa_pessoas())::uuid[])))
  AND ((SELECT escopo_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT escopo_filial_pessoas())::uuid[]))));

DO $$ DECLARE cmd text; pol text;
BEGIN
  FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    pol := 'fat_apontamento_' || lower(left(cmd,3));
    EXECUTE format('DROP POLICY IF EXISTS %I ON fat_apontamento', pol);
    EXECUTE format($f$CREATE POLICY %I ON fat_apontamento FOR %s TO authenticated %s (
      tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever())
      AND ((SELECT edit_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT edit_empresa_pessoas())::uuid[])))
      AND ((SELECT edit_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT edit_filial_pessoas())::uuid[]))))$f$,
      pol, cmd, CASE WHEN cmd = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END);
  END LOOP;
END $$;

-- ── posto_v ─────────────────────────────────────────────────
-- A view roda como DONO (sem security_invoker, por necessidade: com ele
-- herdaria o privilégio de coluna do chamador e mascararia para todo mundo),
-- então o RLS de `posto` não a alcança e o recorte vai explícito aqui.
-- Repete a FORMA do predicado, não a regra — ela continua só nas funções.
-- ⚠ Colunas na MESMA ordem, `cargo_step_id` no fim: é o que faz o REPLACE
-- manter os GRANTs de coluna.
CREATE OR REPLACE VIEW posto_v AS
SELECT p.id, p.tenant_id, p.codigo, p.cargo_id, p.empresa_id, p.filial_id, p.cc_id,
       p.sindicato_id, p.funcionario_id,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.salario_base   END AS salario_base,
       p.ini_ano, p.ini_mes, p.fim_ano, p.fim_mes, p.fte, p.obs, p.ativo, p.regime,
       p.nome, p.matricula, p.recurso_cod, p.recebe_hora, p.reajuste_mes,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_pct   END AS reajuste_pct,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_valor END AS reajuste_valor,
       p.afast_ini_ano, p.afast_ini_mes, p.afast_fim_ano, p.afast_fim_mes,
       p.afast_motivo, p.admissao,
       p.area_func_id,   -- v3_147
       p.sit_folha,      -- v3_152
       p.cargo_step_id   -- v3_159
  FROM posto p
 WHERE p.tenant_id = (SELECT current_tenant_id())
   AND ((SELECT escopo_empresa_pessoas()) IS NULL
        OR (p.empresa_id IS NOT NULL AND p.empresa_id = ANY((SELECT escopo_empresa_pessoas())::uuid[])))
   AND ((SELECT escopo_filial_pessoas()) IS NULL
        OR (p.filial_id IS NOT NULL AND p.filial_id = ANY((SELECT escopo_filial_pessoas())::uuid[])))
   AND ((SELECT escopo_cc_pessoas()) IS NULL
        OR (p.cc_id IS NOT NULL AND p.cc_id = ANY((SELECT escopo_cc_pessoas())::uuid[])));

SELECT 'escopos aceitos' AS secao,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid='user_acesso_regra'::regclass AND conname='user_acesso_regra_escopo_chk') AS resultado
UNION ALL SELECT 'funções _pessoas criadas',
  (SELECT count(*)::text FROM pg_proc WHERE proname LIKE '%\_pessoas')
UNION ALL SELECT 'políticas já no escopo PESSOAS',
  (SELECT count(*)::text FROM pg_policies
    WHERE tablename IN ('posto','fat_folha','fat_apontamento')
      AND coalesce(qual, with_check) LIKE '%\_pessoas%')
UNION ALL SELECT '⛔ políticas de gente AINDA no escopo antigo (esperado: 0)',
  (SELECT count(*)::text FROM pg_policies
    WHERE tablename IN ('posto','fat_folha','fat_apontamento')
      AND coalesce(qual, with_check) ~ '(escopo|edit)_(empresa|filial|cc)\(\)')
UNION ALL SELECT 'posto_v recorta por PESSOAS',
  CASE WHEN (SELECT pg_get_viewdef('posto_v'::regclass)) LIKE '%escopo_cc_pessoas%'
       THEN 'sim' ELSE '⛔ não' END
UNION ALL SELECT 'colunas de posto sem SELECT (esperado: as 3 de remuneração)',
  (SELECT string_agg(c.column_name, ', ' ORDER BY c.column_name)
     FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name='posto'
      AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                       WHERE g.table_name='posto' AND g.column_name=c.column_name
                         AND g.grantee='authenticated' AND g.privilege_type='SELECT'));
