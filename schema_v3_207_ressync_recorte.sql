-- ============================================================
-- v3_207 · A ressincronização por linha RESPEITA O RECORTE DA TELA
--
-- ⚠⚠ DEFEITO MEDIDO, no mesmo dia em que a v3_206 entrou (26/nov). A RPC não
-- tinha recorte nenhum, então o botão ↺ de uma linha trazia **todas as
-- empresas** de volta — inclusive a que estava DESMARCADA na tela. No
-- `ORCADO_SEM_MS_CEN`, com o MS fora do filtro, a linha *Feiras e eventos*
-- recebeu de volta as **92 células do MS** (R$ 172.600) junto com as 459 que
-- se queria desfazer. A auditoria registra o preço: **dois DELETE de
-- exatamente 92 linhas**, às 12:46 e às 13:00 — o Ricardo teve de limpar o MS
-- à mão, duas vezes, porque na primeira ele voltou de novo.
--
-- ⚠ **O precedente do semear NÃO vale aqui, e a diferença é o ESCOPO DO ATO.**
-- `copiar_versao` ignora o filtro de propósito (v3_175): o cenário é a VERSÃO
-- INTEIRA, e copiar só o recorte faria toda célula de fora parecer proposta de
-- exclusão. Já o ↺ de uma linha é ato **sobre o que se está olhando** — quem
-- clica está desfazendo o que acabou de fazer, e fez dentro do recorte.
-- Trazer de fora dele é trazer o que a pessoa não pediu e não vê.
--
-- ⚠ Nulo fica de FORA quando há filtro (`o.cc_id = ANY(p_ccs)` é falso para
-- `NULL`), que é a mesma regra do drill: a célula consolidada não pertence a
-- filial nem a CC nenhum, logo não pertence ao recorte. Sai de graça pelo
-- próprio `ANY` — não precisa de caso especial, e é bom que não precise.
--
-- ⚠ O recorte vai nas DUAS pontas do `FULL JOIN`. Numa ponta só, a linha de
-- fora do recorte apareceria como `incluir` (se filtrada no cenário) ou
-- `remover` (se filtrada na baseline) — o filtro viraria uma instrução de
-- apagar.
--
-- ⚠⚠ DERRUBA A ASSINATURA DE 3 ARGUMENTOS ANTES DE CRIAR A DE 6 — duas
-- conviventes deixam a RPC ambígua no PostgREST e o erro só aparece no clique
-- (v3_168). É a segunda vez em dois dias; é regra, não coincidência.
--
-- Termina em SELECT. Re-executável.
-- ============================================================

DROP FUNCTION IF EXISTS public.ressincronizar_cenario(uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION public.ressincronizar_cenario(p_versao uuid, p_simular boolean DEFAULT true, p_linha uuid DEFAULT NULL,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL)
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
       AND (p_linha    IS NULL OR o.linha_id   = p_linha)
       AND (p_empresas IS NULL OR o.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR o.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR o.cc_id      = ANY(p_ccs))
  ), b AS (
    SELECT o.*, o.dims::text AS dimst FROM fat_orcado o
     WHERE o.versao_id = v.origem_versao_id AND o.tenant_id = t AND o.ano = v.ano
       AND (p_linha    IS NULL OR o.linha_id   = p_linha)
       AND (p_empresas IS NULL OR o.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR o.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR o.cc_id      = ANY(p_ccs))
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

    -- ⚠⚠ SÓ NA RESSINCRONIZAÇÃO INTEIRA — e "inteira" é SEM RECORTE NENHUM,
    -- não só sem `p_linha`. `semeado_em` afirma "o cenário foi sincronizado com
    -- a baseline"; carimbá-lo depois de tocar um recorte faria o cenário alegar
    -- uma sincronização que não houve, e o resto continuaria com o valor do dia
    -- do semear. A primeira versão desta guarda testava só `p_linha` — fechava
    -- a instância (por linha) e deixava a classe aberta (por empresa/filial/CC,
    -- que ninguém chama HOJE). Condição certa com alcance curto é o defeito que
    -- este arquivo mais repete.
    IF p_linha IS NULL AND p_empresas IS NULL AND p_filiais IS NULL AND p_ccs IS NULL THEN
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
SELECT '1 · assinatura viva' AS secao,
       pg_get_function_identity_arguments(p.oid) AS chave,
       CASE WHEN p.pronargs = 6 THEN '✅ com recorte (6 args)'
            ELSE '⛔ sem recorte — derrube e recrie' END AS info
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.proname = 'ressincronizar_cenario'
UNION ALL
SELECT '2 · quantas assinaturas (tem de ser 1)', count(*)::text,
       CASE WHEN count(*) = 1 THEN '✅ uma só' ELSE '⛔ ambígua no PostgREST' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.proname = 'ressincronizar_cenario'
 ORDER BY 1, 2;
