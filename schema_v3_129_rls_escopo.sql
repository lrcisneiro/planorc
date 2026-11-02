-- ============================================================
-- v3_129 · ACS-02 — o escopo de dados passa a valer no BANCO
--
-- O PROBLEMA, em uma frase: toda política dos fatos é `FOR ALL` com
-- `tenant_id = current_tenant_id()` e mais nada. O escopo por empresa/filial/CC
-- e as capacidades vivem só no frontend, então qualquer usuário autenticado lê
-- — e ESCREVE — a base inteira do tenant pela API REST.
--
-- Decisões do Ricardo (02/nov/2026), que fecham o desenho:
--   · entram diretores que NÃO podem ver o CC da Diretoria → isto é
--     pré-requisito de release, não dívida;
--   · o usuário restrito vê uma DRE MENOR, que não bate com a da empresa, e
--     isso está certo — é o que o frontend já faz;
--   · CC nulo só é defeito em conta de RESULTADO; em balanço é normal e
--     abundante (562 mil de 1,07 milhão de linhas do razão).
--
-- POR QUE A NÃO-REGRESSÃO DEVE DAR EMPATE
-- As RPCs já filtram com `(p_ccs IS NULL OR cc_id = ANY(p_ccs))`, e em SQL
-- `NULL = ANY(...)` não é verdadeiro. Logo o frontend JÁ esconde linha sem CC
-- de quem tem restrição. A política abaixo repete essa semântica de propósito:
-- se o que o usuário vê mudar, ou a política divergiu do `useUserAccess`, ou o
-- `useUserAccess` estava errado — e aí é bug achado, não regressão.
--
-- DUAS DESCOBERTAS DO RAIO-X que ampliaram o escopo original:
--   1. `authenticated` tem GRANT ALL nos fatos. Com policy `FOR ALL`, um
--      `viewer` pode APAGAR o orçado pela API. Por isso aqui a leitura e a
--      escrita viram políticas separadas.
--   2. `fat_saldo` e `fat_apontamento` NÃO têm `cc_id`. Nelas o recorte é só
--      por empresa/filial — o Balanço não é recortável por centro de custo.
--      Tem de constar no Anexo A.
--
-- COMO APLICAR: rode o arquivo inteiro, de preferência com o app fechado. O
-- bloco final CONFERE e sempre devolve linha. Se algo sair errado, o bloco de
-- ROLLBACK comentado no fim devolve o estado anterior em um comando por tabela.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. Funções de escopo
-- ════════════════════════════════════════════════════════════
-- Por que SEM argumento: função STABLE nulária é avaliada UMA vez por
-- consulta (vira InitPlan), não por linha. Com argumento, o planner não tem
-- essa garantia — e a policy entra no predicado de TODA leitura, inclusive dos
-- agregados de 1 milhão de linhas.
--
-- Por que SECURITY DEFINER: a própria `user_acesso_regra` tem RLS. Sem isto, a
-- função leria pela política do usuário e a recursão seria sutil.
--
-- ⚠ O `user_id = auth.uid()` é OBRIGATÓRIO e não é redundante: a policy
-- "admin manage" de `user_acesso_regra` é FOR ALL, então o admin enxerga as
-- regras de TODOS. Sem o filtro ele herdaria restrição alheia e passaria a ver
-- MENOS, não mais.
--
-- Convenção de retorno: NULL = SEM RESTRIÇÃO. Array = exatamente estes ids.

CREATE OR REPLACE FUNCTION eh_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_tenant
                  WHERE user_id = auth.uid() AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION escopo_dim(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean := false;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;      -- admin ignora o escopo de dados

  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'VER'
   LIMIT 1;

  IF NOT v_tem THEN RETURN NULL; END IF;       -- sem regra = sem restrição
  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;   -- regra vazia = tudo

  -- Só negados: permitido é "tudo menos". Precisa listar a dimensão, mas são
  -- catálogos pequenos (centena de CCs), e a função roda uma vez por consulta.
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c
                                      WHERE c.tenant_id = current_tenant_id() AND NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e
                                      WHERE e.tenant_id = current_tenant_id() AND NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f
                                      WHERE f.tenant_id = current_tenant_id() AND NOT (f.id = ANY(v_deny)))
      ELSE NULL END;
  END IF;

  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

-- Envelopes nulários: é a forma que garante uma avaliação por consulta.
CREATE OR REPLACE FUNCTION escopo_empresa() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim('empresa') $$;
CREATE OR REPLACE FUNCTION escopo_filial() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim('filial') $$;
CREATE OR REPLACE FUNCTION escopo_cc() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT escopo_dim('centro_custo') $$;

-- Pode escrever? `viewer` não escreve nada; admin e member sim.
-- Isto fecha a descoberta nº 1: hoje um viewer apaga o orçado pela API.
CREATE OR REPLACE FUNCTION pode_escrever() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_tenant
                  WHERE user_id = auth.uid() AND role IN ('admin', 'member'))
$$;

REVOKE ALL ON FUNCTION escopo_dim(text) FROM public;
GRANT EXECUTE ON FUNCTION eh_admin(), escopo_empresa(), escopo_filial(), escopo_cc(), pode_escrever() TO authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. Políticas — leitura com escopo, escrita separada
-- ════════════════════════════════════════════════════════════
-- O predicado de escopo, repetido em cada fato que tem a dimensão.
-- `cc_id IS NOT NULL AND ...`: quem tem restrição NÃO vê linha sem CC. É a
-- escolha conservadora, e é a mesma que a RPC já faz hoje.

-- ---------- fat_orcado ----------
DROP POLICY IF EXISTS fat_orcado_rls ON fat_orcado;
DROP POLICY IF EXISTS fat_orcado_sel ON fat_orcado;
DROP POLICY IF EXISTS fat_orcado_wr  ON fat_orcado;
CREATE POLICY fat_orcado_sel ON fat_orcado FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (escopo_empresa() IS NULL OR empresa_id = ANY(escopo_empresa()))
  AND (escopo_filial()  IS NULL OR (filial_id IS NOT NULL AND filial_id = ANY(escopo_filial())))
  AND (escopo_cc()      IS NULL OR (cc_id     IS NOT NULL AND cc_id     = ANY(escopo_cc())))
);
CREATE POLICY fat_orcado_wr ON fat_orcado FOR ALL
  USING (tenant_id = current_tenant_id() AND pode_escrever())
  WITH CHECK (tenant_id = current_tenant_id() AND pode_escrever());

-- ---------- fat_realizado ----------
-- ⚠ 1,07 milhão de linhas. É aqui que o custo da política aparece, se aparecer.
-- Medir antes e depois: ver o bloco 4.
DROP POLICY IF EXISTS fat_realizado_rls ON fat_realizado;
DROP POLICY IF EXISTS fat_realizado_sel ON fat_realizado;
DROP POLICY IF EXISTS fat_realizado_wr  ON fat_realizado;
CREATE POLICY fat_realizado_sel ON fat_realizado FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (escopo_empresa() IS NULL OR empresa_id = ANY(escopo_empresa()))
  AND (escopo_filial()  IS NULL OR (filial_id IS NOT NULL AND filial_id = ANY(escopo_filial())))
  AND (escopo_cc()      IS NULL OR (cc_id     IS NOT NULL AND cc_id     = ANY(escopo_cc())))
);
CREATE POLICY fat_realizado_wr ON fat_realizado FOR ALL
  USING (tenant_id = current_tenant_id() AND pode_escrever())
  WITH CHECK (tenant_id = current_tenant_id() AND pode_escrever());

-- ---------- fat_folha ----------
-- A mais sensível: remuneração nominal, incluindo o lote da diretoria.
DROP POLICY IF EXISTS fat_folha_rls ON fat_folha;
DROP POLICY IF EXISTS fat_folha_sel ON fat_folha;
DROP POLICY IF EXISTS fat_folha_wr  ON fat_folha;
CREATE POLICY fat_folha_sel ON fat_folha FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (escopo_empresa() IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY(escopo_empresa())))
  AND (escopo_filial()  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY(escopo_filial())))
  AND (escopo_cc()      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY(escopo_cc())))
);
CREATE POLICY fat_folha_wr ON fat_folha FOR ALL
  USING (tenant_id = current_tenant_id() AND pode_escrever())
  WITH CHECK (tenant_id = current_tenant_id() AND pode_escrever());

-- ---------- posto ----------
DROP POLICY IF EXISTS posto_rls ON posto;
DROP POLICY IF EXISTS posto_sel ON posto;
DROP POLICY IF EXISTS posto_wr  ON posto;
CREATE POLICY posto_sel ON posto FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (escopo_empresa() IS NULL OR empresa_id = ANY(escopo_empresa()))
  AND (escopo_filial()  IS NULL OR (filial_id IS NOT NULL AND filial_id = ANY(escopo_filial())))
  AND (escopo_cc()      IS NULL OR (cc_id     IS NOT NULL AND cc_id     = ANY(escopo_cc())))
);
CREATE POLICY posto_wr ON posto FOR ALL
  USING (tenant_id = current_tenant_id() AND pode_escrever())
  WITH CHECK (tenant_id = current_tenant_id() AND pode_escrever());

-- ---------- fat_saldo e fat_apontamento: SEM cc_id ----------
-- Recorte só por empresa/filial. O Balanço não é recortável por centro de
-- custo porque o balancete não tem a dimensão — não é omissão desta migration.
DROP POLICY IF EXISTS fat_saldo_rls ON fat_saldo;
DROP POLICY IF EXISTS fat_saldo_sel ON fat_saldo;
DROP POLICY IF EXISTS fat_saldo_wr  ON fat_saldo;
CREATE POLICY fat_saldo_sel ON fat_saldo FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (escopo_empresa() IS NULL OR empresa_id = ANY(escopo_empresa()))
  AND (escopo_filial()  IS NULL OR (filial_id IS NOT NULL AND filial_id = ANY(escopo_filial())))
);
CREATE POLICY fat_saldo_wr ON fat_saldo FOR ALL
  USING (tenant_id = current_tenant_id() AND pode_escrever())
  WITH CHECK (tenant_id = current_tenant_id() AND pode_escrever());

DROP POLICY IF EXISTS fat_apontamento_rls ON fat_apontamento;
DROP POLICY IF EXISTS fat_apontamento_sel ON fat_apontamento;
DROP POLICY IF EXISTS fat_apontamento_wr  ON fat_apontamento;
CREATE POLICY fat_apontamento_sel ON fat_apontamento FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (escopo_empresa() IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY(escopo_empresa())))
  AND (escopo_filial()  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY(escopo_filial())))
);
CREATE POLICY fat_apontamento_wr ON fat_apontamento FOR ALL
  USING (tenant_id = current_tenant_id() AND pode_escrever())
  WITH CHECK (tenant_id = current_tenant_id() AND pode_escrever());

-- ════════════════════════════════════════════════════════════
-- 3. Conferência — SEMPRE devolve linha
-- ════════════════════════════════════════════════════════════
-- Vazio aqui não distinguiria "deu certo" de "a consulta está cega".
SELECT c.relname                                         AS tabela,
       count(*) FILTER (WHERE p.polcmd = 'r')             AS politicas_select,
       count(*) FILTER (WHERE p.polcmd <> 'r')            AS politicas_escrita,
       bool_or(pg_get_expr(p.polqual, p.polrelid) ILIKE '%escopo_cc%')      AS recorta_cc,
       bool_or(pg_get_expr(p.polqual, p.polrelid) ILIKE '%escopo_empresa%') AS recorta_empresa,
       bool_or(pg_get_expr(p.polqual, p.polrelid) ILIKE '%pode_escrever%')  AS protege_escrita,
       CASE WHEN c.relname IN ('fat_saldo','fat_apontamento')
            THEN 'sem cc_id — recorte por empresa/filial, por desenho'
            WHEN bool_or(pg_get_expr(p.polqual, p.polrelid) ILIKE '%escopo_cc%') THEN '✓ ok'
            ELSE '⛔ sem recorte de CC' END               AS leitura
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('fat_orcado','fat_realizado','fat_folha','posto','fat_saldo','fat_apontamento')
 GROUP BY c.relname
 ORDER BY c.relname;

-- ════════════════════════════════════════════════════════════
-- 4. O que fazer DEPOIS de aplicar (não automatizável)
-- ════════════════════════════════════════════════════════════
-- a) NÃO-REGRESSÃO: entrar com um usuário restrito e conferir que os totais
--    das telas são os MESMOS de antes. Se mudaram, comparar com o
--    `useUserAccess` — um dos dois está errado, e agora dá para saber qual.
-- b) DESEMPENHO em fat_realizado: abrir o dash de acompanhamento e cronometrar.
--    Se piorar, o caminho é um índice com cc_id à frente, não afrouxar a policy.
-- c) ADMIN continua vendo tudo: confirmar, senão o `eh_admin()` não está
--    enxergando o papel.
--
-- ROLLBACK (um por tabela, se precisar voltar):
--   DROP POLICY IF EXISTS fat_orcado_sel ON fat_orcado;
--   DROP POLICY IF EXISTS fat_orcado_wr  ON fat_orcado;
--   CREATE POLICY fat_orcado_rls ON fat_orcado FOR ALL
--     USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--   -- idem para fat_realizado, fat_folha, posto, fat_saldo, fat_apontamento
