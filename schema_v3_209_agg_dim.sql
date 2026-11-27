-- ============================================================
-- v3_209 · AGREGADO COM DIMENSÃO: uma consulta no lugar de N
--
-- POR QUÊ: a visão do relatório ganhou eixo de entidade (empresa · área ·
-- divisão · BU) e a carga fazia UMA RPC POR GRUPO. Isso aguenta 13 empresas e
-- não aguenta mais nada: centro de custo são 86, e CRUZAR os dois eixos (área
-- na linha × empresa na coluna) seria 5 × 13 = 65 chamadas por cenário. Era
-- por isso que a tela só permitia uma entidade por vez.
--
-- Medido no Orçado2027 da DRE Gerencial, em linhas devolvidas (e páginas de
-- 1000 do PostgREST), contra o número de chamadas de hoje:
--     + empresa            4.033 (5)   contra 13 chamadas
--     + área               1.230 (2)   contra  5
--     CRUZADO emp × área   5.554 (6)   contra 65
--     + CC                 3.528 (4)   contra 86
--     CRUZADO emp × CC    13.689 (14)  contra 1.118
--
-- ⚠⚠ O SEGREDO É AGRUPAR NO SERVIDOR PELA DIMENSÃO PEDIDA, não devolver o
-- grão fino e deixar o cliente somar: pedir (linha, empresa, cc, mês) para
-- depois dobrar em área custaria 13.689 linhas onde 5.554 bastam.
--
-- ⚠ O mapa CC → área/divisão/BU entra DEPOIS do primeiro GROUP BY (lição da
-- v3_192): o join existe só para resolver um ATRIBUTO do agrupamento, e
-- dentro do agrupamento ele vira nested loop sobre a tabela de fatos.
--
-- ⚠ `(SELECT current_tenant_id())` e não a chamada crua — lição da v3_193.
-- ⚠ SECURITY INVOKER (padrão): o RLS continua recortando por empresa, filial,
-- CC e versão. Uma função DEFINER aqui entregaria o orçado inteiro.
--
-- ⚠⚠ MUDANÇA DE COMPORTAMENTO DECLARADA: a célula CONSOLIDADA (filial/CC
-- nulos) deixa de sumir. Antes a tela recortava cada grupo por `p_ccs` com a
-- lista de CCs daquele valor, e a célula sem CC não casava com nenhuma lista —
-- ela simplesmente não aparecia em grupo nenhum. Aqui ela cai no balde '',
-- que a tela rotula "(sem área)". Dinheiro que some de todos os grupos é pior
-- que dinheiro num balde nomeado.
-- ============================================================

-- ── Orçado ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.relatorio_orcado_agg_dim(
  p_versao uuid, p_empresas uuid[], p_anos integer[], p_meses integer[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot integer DEFAULT 1,
  p_dim_a text DEFAULT NULL, p_dim_b text DEFAULT NULL)
RETURNS TABLE(linha_id uuid, dim_a text, dim_b text, ano integer, mes integer,
              valor numeric, n bigint, expr text, det boolean)
LANGUAGE plpgsql STABLE SET statement_timeout TO '60s'
AS $function$
BEGIN
  -- ⚠ Dimensão desconhecida NÃO cai em silêncio num balde só: errar o nome
  -- devolveria a tela inteira somada num grupo, com cara de dado.
  IF p_dim_a IS NOT NULL AND p_dim_a NOT IN ('empresa','filial','cc','area','divisao','bu') THEN
    RAISE EXCEPTION 'dimensão inválida: %', p_dim_a USING ERRCODE = '22023';
  END IF;
  IF p_dim_b IS NOT NULL AND p_dim_b NOT IN ('empresa','filial','cc','area','divisao','bu') THEN
    RAISE EXCEPTION 'dimensão inválida: %', p_dim_b USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT fo.linha_id AS l, fo.empresa_id AS e, fo.filial_id AS f, fo.cc_id AS c,
           fo.ano AS a, fo.mes AS m,
           sum(CASE p_slot WHEN 2 THEN fo.val_m2 WHEN 3 THEN fo.val_m3
                           WHEN 4 THEN fo.val_m4 WHEN 5 THEN fo.val_m5 ELSE fo.valor END) AS v,
           count(*) AS qt,
           max(fo.expressao) FILTER (WHERE fo.expressao IS NOT NULL) AS ex,
           bool_or(fo.filial_id IS NOT NULL OR fo.cc_id IS NOT NULL) AS dt
      FROM fat_orcado fo
     WHERE fo.tenant_id = (SELECT current_tenant_id())
       AND fo.versao_id = p_versao AND fo.empresa_id = ANY(p_empresas)
       AND fo.ano = ANY(p_anos) AND fo.mes = ANY(p_meses) AND fo.linha_id = ANY(p_linhas)
       AND (p_filiais IS NULL OR fo.filial_id = ANY(p_filiais))
       AND (p_ccs     IS NULL OR fo.cc_id     = ANY(p_ccs))
     GROUP BY fo.linha_id, fo.empresa_id, fo.filial_id, fo.cc_id, fo.ano, fo.mes
  ), rot AS (
    SELECT b.*, cc.area_cod, cc.divisao_cod, cc.bu_cod
      FROM base b LEFT JOIN centro_custo cc ON cc.id = b.c
  )
  SELECT r.l, 
         coalesce(CASE p_dim_a WHEN 'empresa' THEN r.e::text WHEN 'filial' THEN r.f::text
                               WHEN 'cc' THEN r.c::text WHEN 'area' THEN r.area_cod
                               WHEN 'divisao' THEN r.divisao_cod WHEN 'bu' THEN r.bu_cod END, ''),
         coalesce(CASE p_dim_b WHEN 'empresa' THEN r.e::text WHEN 'filial' THEN r.f::text
                               WHEN 'cc' THEN r.c::text WHEN 'area' THEN r.area_cod
                               WHEN 'divisao' THEN r.divisao_cod WHEN 'bu' THEN r.bu_cod END, ''),
         r.a, r.m, sum(r.v), sum(r.qt),
         -- `expr` só vale quando o grupo é UMA célula: uma expressão que
         -- representasse várias seria uma fórmula que ninguém escreveu.
         CASE WHEN sum(r.qt) = 1 THEN max(r.ex) END,
         bool_or(r.dt)
    FROM rot r
   GROUP BY 1, 2, 3, 4, 5;
END $function$;

-- ── Realizado ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.relatorio_realizado_agg_dim(
  p_empresas uuid[], p_anos integer[], p_meses integer[], p_linhas uuid[],
  p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL, p_slot integer DEFAULT 1,
  p_dim_a text DEFAULT NULL, p_dim_b text DEFAULT NULL)
RETURNS TABLE(linha_id uuid, dim_a text, dim_b text, ano integer, mes integer, valor numeric)
LANGUAGE plpgsql STABLE SET statement_timeout TO '90s'
AS $function$
BEGIN
  IF p_dim_a IS NOT NULL AND p_dim_a NOT IN ('empresa','filial','cc','area','divisao','bu') THEN
    RAISE EXCEPTION 'dimensão inválida: %', p_dim_a USING ERRCODE = '22023';
  END IF;
  IF p_dim_b IS NOT NULL AND p_dim_b NOT IN ('empresa','filial','cc','area','divisao','bu') THEN
    RAISE EXCEPTION 'dimensão inválida: %', p_dim_b USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH cl AS (
    -- ⚠ Mesmo DISTINCT ON do `relatorio_realizado_agg`: a conta amarrada duas
    -- vezes à mesma linha contaria em dobro.
    SELECT DISTINCT ON (c.conta_id) c.conta_id, c.linha_id, c.sinal
      FROM conta_linha c
     WHERE c.tenant_id = (SELECT current_tenant_id()) AND c.linha_id = ANY(p_linhas)
     ORDER BY c.conta_id, c.id DESC
  ), base AS (
    SELECT t.l, t.e, t.f, t.c, t.a, t.m, sum(t.v) AS v
      FROM (
        -- linha já resolvida no fato (hoje nenhuma, mas o caminho existe)
        -- ⚠ Tabela como `fm`, nunca `m`: aqui a coluna de saída também se
        -- chama `m` (o mês), e o mesmo nome para a tabela e para a coluna é
        -- ambiguidade esperando um ajuste futuro para virar erro.
        SELECT fm.linha_id AS l, fm.empresa_id AS e, fm.filial_id AS f, fm.cc_id AS c, fm.ano AS a, fm.mes AS m,
               (CASE p_slot WHEN 2 THEN fm.val_m2 WHEN 3 THEN fm.val_m3
                            WHEN 4 THEN fm.val_m4 WHEN 5 THEN fm.val_m5 ELSE fm.valor END)::numeric AS v
          FROM fat_realizado_mensal fm
         WHERE fm.tenant_id = (SELECT current_tenant_id()) AND fm.linha_id = ANY(p_linhas)
           AND fm.empresa_id = ANY(p_empresas) AND fm.ano = ANY(p_anos) AND fm.mes = ANY(p_meses)
           AND (p_filiais IS NULL OR fm.filial_id = ANY(p_filiais))
           AND (p_ccs IS NULL OR fm.cc_id = ANY(p_ccs))
        UNION ALL
        -- linha resolvida pela AMARRAÇÃO, que é o caminho de 100% do dado
        SELECT cl.linha_id, fm.empresa_id, fm.filial_id, fm.cc_id, fm.ano, fm.mes,
               ((CASE p_slot WHEN 2 THEN fm.val_m2 WHEN 3 THEN fm.val_m3
                             WHEN 4 THEN fm.val_m4 WHEN 5 THEN fm.val_m5 ELSE fm.valor END) * cl.sinal)::numeric
          FROM fat_realizado_mensal fm JOIN cl ON cl.conta_id = fm.conta_id
         WHERE fm.tenant_id = (SELECT current_tenant_id()) AND fm.linha_id IS NULL
           AND fm.empresa_id = ANY(p_empresas) AND fm.ano = ANY(p_anos) AND fm.mes = ANY(p_meses)
           AND (p_filiais IS NULL OR fm.filial_id = ANY(p_filiais))
           AND (p_ccs IS NULL OR fm.cc_id = ANY(p_ccs))
      ) t
     GROUP BY t.l, t.e, t.f, t.c, t.a, t.m
  ), rot AS (
    SELECT b.*, cc.area_cod, cc.divisao_cod, cc.bu_cod
      FROM base b LEFT JOIN centro_custo cc ON cc.id = b.c
  )
  SELECT r.l,
         coalesce(CASE p_dim_a WHEN 'empresa' THEN r.e::text WHEN 'filial' THEN r.f::text
                               WHEN 'cc' THEN r.c::text WHEN 'area' THEN r.area_cod
                               WHEN 'divisao' THEN r.divisao_cod WHEN 'bu' THEN r.bu_cod END, ''),
         coalesce(CASE p_dim_b WHEN 'empresa' THEN r.e::text WHEN 'filial' THEN r.f::text
                               WHEN 'cc' THEN r.c::text WHEN 'area' THEN r.area_cod
                               WHEN 'divisao' THEN r.divisao_cod WHEN 'bu' THEN r.bu_cod END, ''),
         r.a, r.m, sum(r.v)
    FROM rot r
   GROUP BY 1, 2, 3, 4, 5;
END $function$;

-- ---------------- conferência ----------------
-- ⚠ Em arquivo de MIGRATION a prova vai em SELECT, nunca em RAISE: o editor
-- roda tudo numa transação e a exceção desfaria a própria migration.
SELECT '1 · funções criadas' AS secao, p.proname AS chave,
       pg_get_function_result(p.oid) AS info, '' AS det
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('relatorio_orcado_agg_dim','relatorio_realizado_agg_dim')
 ORDER BY 2;
