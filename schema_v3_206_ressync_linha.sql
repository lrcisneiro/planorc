-- ============================================================
-- v3_206 · Ressincronizar UMA LINHA do cenário, não o cenário inteiro
--
-- Pedido do Ricardo em 26/nov: *"zerei errado umas células, precisava de um
-- botão ressincronizar mas por linha e não o cenário inteiro"*.
--
-- ⚠⚠ ZERAR NESTE PRODUTO É APAGAR — `fat_orcado` guarda **ausência**, não zero
-- (o drill faz `.delete()`, não `valor = null`). Isso é o que torna a
-- ressincronização a ferramenta CERTA para desfazer o acidente: a célula
-- apagada não tem `atualizado_em` para ser classificada como `preservada`, cai
-- em `c.id IS NULL AND b.id IS NOT NULL` e vira **`incluir`** — a função já
-- sabia trazê-la de volta. **O que faltava era só o recorte.**
-- Medido no caso real: em `ORCADO_SEM_MS_CEN` a linha *Feiras e eventos* tem
-- **0 células** contra **551** (R$ 1.770.500) na baseline.
-- ⚠ A consequência é que célula EDITADA para outro valor continua `preservada`
-- e **não** volta — e está certo: ali houve decisão, não acidente. Quem quiser
-- desfazer uma edição deliberada digita o valor de volta.
--
-- ⚠⚠ DERRUBA A ASSINATURA DE 2 ARGUMENTOS ANTES DE CRIAR A DE 3. Duas
-- conviventes tornariam a RPC **ambígua no PostgREST**, e o erro só apareceria
-- no clique — exatamente a lição da v3_168. `CREATE OR REPLACE` com outro
-- número de argumentos cria função NOVA, não substitui.
--
-- Termina em SELECT. Re-executável.
-- ============================================================

DROP FUNCTION IF EXISTS public.ressincronizar_cenario(uuid, boolean);

CREATE OR REPLACE FUNCTION public.ressincronizar_cenario(p_versao uuid, p_simular boolean DEFAULT true, p_linha uuid DEFAULT NULL)
 RETURNS TABLE(acao text, celulas bigint, detalhe text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t uuid := current_tenant_id();
  v record;
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só a controladoria (admin) pode ressincronizar cenário.' USING ERRCODE = '42501';
  END IF;

  SELECT id, origem_versao_id, ano, criado_em, semeado_em, mesclado_em, codigo
    INTO v FROM versao_orcamento WHERE id = p_versao AND tenant_id = t;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Cenário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.origem_versao_id IS NULL THEN
    RAISE EXCEPTION 'A versão % é uma baseline.', v.codigo USING ERRCODE = '22023';
  END IF;
  IF v.semeado_em IS NULL THEN
    RAISE EXCEPTION 'O cenário % nasceu vazio — não há o que ressincronizar.', v.codigo USING ERRCODE = '22023';
  END IF;
  IF v.mesclado_em IS NOT NULL THEN
    RAISE EXCEPTION 'O cenário % já foi liberado.', v.codigo USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _sync;
  CREATE TEMP TABLE _sync ON COMMIT DROP AS
  WITH c AS (
    SELECT o.*, o.dims::text AS dimst FROM fat_orcado o
     WHERE o.versao_id = p_versao AND o.tenant_id = t AND o.ano = v.ano
       AND (p_linha IS NULL OR o.linha_id = p_linha)
  ), b AS (
    SELECT o.*, o.dims::text AS dimst FROM fat_orcado o
     WHERE o.versao_id = v.origem_versao_id AND o.tenant_id = t AND o.ano = v.ano
       AND (p_linha IS NULL OR o.linha_id = p_linha)
  )
  SELECT c.id AS cen_id, b.id AS base_id,
         coalesce(c.linha_id, b.linha_id) AS linha_id,
         CASE
           WHEN c.id IS NOT NULL AND c.atualizado_em > v.criado_em THEN 'preservada'
           WHEN c.id IS NOT NULL AND b.id IS NOT NULL
                AND (c.valor IS DISTINCT FROM b.valor
                  OR c.expressao IS DISTINCT FROM b.expressao
                  OR c.origem IS DISTINCT FROM b.origem
                  OR c.val_m2 IS DISTINCT FROM b.val_m2
                  OR c.val_m3 IS DISTINCT FROM b.val_m3
                  OR c.val_m4 IS DISTINCT FROM b.val_m4
                  OR c.val_m5 IS DISTINCT FROM b.val_m5) THEN 'atualizar'
           WHEN c.id IS NULL AND b.id IS NOT NULL THEN 'incluir'
           WHEN c.id IS NOT NULL AND b.id IS NULL THEN 'remover'
           ELSE 'igual'
         END AS acao
    FROM c FULL JOIN b
      ON  b.linha_id   = c.linha_id
      AND b.empresa_id = c.empresa_id
      AND coalesce(b.filial_id, z) = coalesce(c.filial_id, z)
      AND coalesce(b.cc_id, z)     = coalesce(c.cc_id, z)
      AND b.ano = c.ano AND b.mes = c.mes AND b.dimst = c.dimst;

  IF NOT p_simular THEN
    UPDATE fat_orcado o
       SET valor = bb.valor, expressao = bb.expressao, origem = bb.origem,
           moeda_origem = bb.moeda_origem, dims = bb.dims,
           origem_formulario_linha_id = bb.origem_formulario_linha_id,
           val_m2 = bb.val_m2, val_m3 = bb.val_m3, val_m4 = bb.val_m4, val_m5 = bb.val_m5,
           atualizado_em = v.criado_em
      FROM _sync s JOIN fat_orcado bb ON bb.id = s.base_id
     WHERE o.id = s.cen_id AND s.acao = 'atualizar';

    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, origem_formulario_linha_id, dims, moeda_origem,
       val_m2, val_m3, val_m4, val_m5, atualizado_em)
    SELECT bb.tenant_id, p_versao, bb.linha_id, bb.empresa_id, bb.filial_id, bb.cc_id, bb.ano, bb.mes,
           bb.valor, bb.expressao, bb.origem, bb.origem_formulario_linha_id, bb.dims, bb.moeda_origem,
           bb.val_m2, bb.val_m3, bb.val_m4, bb.val_m5, v.criado_em
      FROM _sync s JOIN fat_orcado bb ON bb.id = s.base_id
     WHERE s.acao = 'incluir';

    -- ⚠ `s.` em tudo: sem o alias, `acao` disputa com o parâmetro de saída.
    DELETE FROM fat_orcado o
     WHERE o.id IN (SELECT s.cen_id FROM _sync s WHERE s.acao = 'remover');

    UPDATE orcado_veredito ov
       SET aprovado = NULL,
           aprov_nota = coalesce(ov.aprov_nota || ' · ', '')
                        || CASE WHEN p_linha IS NULL
                             THEN 'veredito zerado: o cenário foi ressincronizado com a baseline'
                             ELSE 'veredito zerado: esta linha foi ressincronizada com a baseline' END
     WHERE ov.versao_id = p_versao AND ov.tenant_id = t
       AND ov.linha_id IN (SELECT DISTINCT s.linha_id FROM _sync s
                            WHERE s.acao IN ('atualizar', 'incluir', 'remover'));

    -- ⚠⚠ SÓ NA RESSINCRONIZAÇÃO INTEIRA. `semeado_em` afirma "o cenário foi
    -- sincronizado com a baseline"; carimbá-lo depois de mexer em UMA linha
    -- faria o cenário alegar uma sincronização que não houve, e as outras 81
    -- linhas continuariam com o valor do dia do semear.
    IF p_linha IS NULL THEN
      UPDATE versao_orcamento SET semeado_em = now() WHERE id = p_versao;
    END IF;
  END IF;

  RETURN QUERY
  SELECT s.acao, count(*)::bigint,
         CASE s.acao
           WHEN 'preservada' THEN 'Tocadas pela área — a proposta, intocada'
           WHEN 'atualizar'  THEN 'Atualizadas com o valor de hoje da baseline'
           WHEN 'incluir'    THEN 'Trazidas: a baseline ganhou estas depois do semear'
           WHEN 'remover'    THEN 'Retiradas: a baseline não as tem mais'
           ELSE 'Já iguais'
         END
    FROM _sync s WHERE s.acao <> 'igual'
   GROUP BY s.acao ORDER BY s.acao;
END $function$
;

-- ---------------- conferência ----------------
SELECT '1 · assinaturas vivas de ressincronizar_cenario' AS secao,
       pg_get_function_identity_arguments(p.oid) AS chave,
       CASE WHEN pg_get_function_identity_arguments(p.oid) = 'uuid, boolean, uuid'
            THEN '✅ a nova (com p_linha)' ELSE '⛔ ANTIGA — derrube-a, senão a RPC fica ambígua' END AS info,
       '' AS det
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.proname = 'ressincronizar_cenario'
UNION ALL
SELECT '2 · quantas assinaturas (tem de ser 1)', count(*)::text,
       CASE WHEN count(*) = 1 THEN '✅ uma só' ELSE '⛔ ambígua no PostgREST' END, ''
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.proname = 'ressincronizar_cenario'
 ORDER BY 1, 2;
