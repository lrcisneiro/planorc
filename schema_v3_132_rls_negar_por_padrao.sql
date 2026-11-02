-- ============================================================
-- v3_132 · NEGAR POR PADRÃO — falta de cadastro deixa de liberar
--
-- Decisão do Ricardo (02/nov): "deve ver nada para evitar acesso indevido por
-- falta de cadastro de regra".
--
-- O QUE MUDA, e é só isto: a AUSÊNCIA de linha em `user_acesso_regra` deixa de
-- significar "sem restrição" e passa a significar "nada". A distinção vira:
--
--   · sem linha para a dimensão ....... NÃO VÊ NADA
--   · linha com lista vazia ........... VÊ TUDO  (escolha explícita)
--   · linha com lista ................. vê os listados, menos os negados
--
-- "Ver tudo" passa a ser uma decisão que alguém tomou e registrou, em vez do
-- que acontece quando ninguém tomou decisão nenhuma. Era o inverso.
--
-- ⚠ QUEM PERDE ACESSO AO RODAR ISTO: todo não-admin sem linha na dimensão.
-- Pelo levantamento de hoje são duas pessoas. O conserto leva trinta segundos:
-- abrir Configurações → acesso do usuário e **salvar** — a tela grava uma linha
-- por dimensão, e lista vazia significa "vê tudo".
--
-- O ADMIN NÃO É AFETADO (ignora o escopo), então sempre há quem conserte.
--
-- A escrita herda: `escopo_dim_edit` cai no VER quando não há regra de ORCAR, e
-- o VER agora nega — então quem não tem cadastro também não escreve.
--
-- Nada muda nas POLÍTICAS. Só o conteúdo das duas funções de escopo.
-- O relatório do fim diz quem ficou sem acesso. Sempre devolve linha.
-- ============================================================

-- `'{}'::uuid[]` (array vazio) é o que significa "nada": a comparação
-- `cc_id = ANY('{}')` é sempre falsa. NULL continua significando "tudo".
CREATE OR REPLACE FUNCTION escopo_dim(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean := false;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;                 -- admin: sem restrição

  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'VER'
   LIMIT 1;

  -- ⚠ AQUI ESTÁ A MUDANÇA. Antes: `RETURN NULL` (sem regra = tudo).
  IF NOT v_tem THEN RETURN '{}'::uuid[]; END IF;          -- sem regra = NADA

  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');

  -- Lista vazia e sem negados = "vê tudo", agora como escolha explícita de
  -- quem cadastrou. É o que a tela grava quando nada é marcado.
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;

  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c WHERE c.tenant_id = current_tenant_id() AND NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e      WHERE e.tenant_id = current_tenant_id() AND NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f       WHERE f.tenant_id = current_tenant_id() AND NOT (f.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;

  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

CREATE OR REPLACE FUNCTION escopo_dim_edit(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean := false;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;

  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'ORCAR'
   LIMIT 1;

  -- Sem regra de ORCAR herda a de VER, como o `canEdit` do frontend. E o VER
  -- agora nega quando não há cadastro — então a escrita nega junto.
  IF NOT v_tem THEN RETURN escopo_dim(p_dim); END IF;

  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c WHERE c.tenant_id = current_tenant_id() AND NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e      WHERE e.tenant_id = current_tenant_id() AND NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f       WHERE f.tenant_id = current_tenant_id() AND NOT (f.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;
  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

-- ════════════════════════════════════════════════════════════
-- Quem ficou sem acesso AGORA — abrir Configurações → acesso e salvar
-- ════════════════════════════════════════════════════════════
SELECT left(ut.user_id::text, 8) || '…'                            AS usuario,
       ut.role                                                      AS papel,
       count(*) FILTER (WHERE d.dimensao IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM user_acesso_regra r
                                           WHERE r.user_id = ut.user_id
                                             AND r.dimensao = d.dimensao AND r.escopo = 'VER'))
                                                                    AS dimensoes_SEM_regra,
       CASE
         WHEN ut.role = 'admin' THEN 'admin — não é afetado'
         WHEN count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM user_acesso_regra r
                                                  WHERE r.user_id = ut.user_id
                                                    AND r.dimensao = d.dimensao AND r.escopo = 'VER')) > 0
              THEN '⛔ BLOQUEADO nessas dimensões — abrir Configurações → acesso e SALVAR'
         ELSE '✓ tem cadastro nas três'
       END                                                          AS acao
  FROM user_tenant ut
  CROSS JOIN (VALUES ('empresa'), ('filial'), ('centro_custo')) AS d(dimensao)
 WHERE ut.tenant_id = current_tenant_id()
 GROUP BY ut.user_id, ut.role
 ORDER BY 3 DESC, 2;
