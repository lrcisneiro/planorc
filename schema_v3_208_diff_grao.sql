-- ============================================================
-- v3_208 · O comparativo enxerga MUDANÇA DE GRÃO, não só de valor
--
-- Pedido do Ricardo (26/nov): *"quando trocamos o CC ele não tem divergência
-- de valor mas preciso sincronizar. Se puder fazer uma marca quando o grão for
-- diferente mesmo o número sendo igual."*
--
-- ⚠⚠ ERA UM FURO DE GOVERNANÇA, não só de tela. `cenario_orcado_diff`
-- agrupava por `linha_id` e filtrava `abs(cenário − base) > 0.005` — então
-- **mover R$ 1 milhão do CC A para o CC B não aparecia em lugar nenhum**: a
-- linha soma igual. E como esta é a MESMA função que `cenario_orcado_pendentes`
-- usa para contar o que falta decidir, o cenário **fechava sem que ninguém
-- tivesse decidido aquilo**. É a mesma razão que já justificava o `FULL JOIN`
-- daqui — *"zerar também é alteração"* —, só que um nível abaixo: **mudar de
-- onde o dinheiro cai também é alteração.**
--
-- ⚠⚠ O GRÃO COMPARADO É `empresa · filial · cc · mês`, E `dims` FICA SOMADO
-- POR DENTRO — de propósito. Comparar `dims::text` cru daria falso positivo em
-- massa: o Aplicar carimba `dims->>'nome'` no instante em que roda, e duas
-- aplicações grafam a mesma pessoa de jeitos diferentes (está registrado no
-- CLAUDE.md: *"o orçado guarda o nome de quando o Aplicar rodou"*). A linha
-- inteira de folha viraria "grão diferente" por causa de uma grafia, e um
-- alarme que toca sempre ninguém lê.
--
-- ⚠ `celulas_dif` é ADITIVA na assinatura de saída: `cenario_orcado_pendentes`
-- referencia só `d.linha_id`, então nada quebra. Mas o RETURNS TABLE muda, e
-- isso exige DROP — `CREATE OR REPLACE` recusa mudança de tipo de retorno.
--
-- ⚠⚠ CONSEQUÊNCIA QUE VALE SABER ANTES DE RODAR: linhas que só mudaram de grão
-- passam a EXIGIR VEREDITO. Num cenário já em revisão, o contador de pendentes
-- pode subir — e isso é o conserto, não o efeito colateral: eram decisões que
-- ninguém tomou porque ninguém viu. A tela nomeia as pendentes, então elas
-- aparecem, não somem num contador.
--
-- Termina em SELECT. Re-executável.
-- ============================================================

DROP FUNCTION IF EXISTS public.cenario_orcado_diff(uuid);

CREATE OR REPLACE FUNCTION public.cenario_orcado_diff(p_versao uuid)
 RETURNS TABLE(linha_id uuid, base numeric, cenario numeric, celulas_dif bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT id, origem_versao_id, ano FROM versao_orcamento
     WHERE id = p_versao AND tenant_id = (SELECT current_tenant_id())
       AND origem_versao_id IS NOT NULL      -- só cenário de orçamento tem Δ
  ), b AS (
    -- agrega ANTES de juntar: 24 mil células viram ~poucos milhares de grãos,
    -- e o `dims` some aqui dentro, que é o ponto.
    SELECT o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.mes, sum(o.valor) AS t
      FROM fat_orcado o, v
     WHERE o.versao_id = v.origem_versao_id AND o.ano = v.ano
       AND o.tenant_id = (SELECT current_tenant_id())
     GROUP BY o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.mes
  ), c AS (
    SELECT o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.mes, sum(o.valor) AS t
      FROM fat_orcado o, v
     WHERE o.versao_id = v.id AND o.ano = v.ano
       AND o.tenant_id = (SELECT current_tenant_id())
     GROUP BY o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.mes
  ), j AS (
    SELECT coalesce(b.linha_id, c.linha_id) AS lid,
           coalesce(b.t, 0) AS bt, coalesce(c.t, 0) AS ct
      FROM b FULL JOIN c
        ON  c.linha_id   = b.linha_id
        AND c.empresa_id = b.empresa_id
        -- sentinela nos nulos: a célula consolidada (filial/cc nulos) é um grão
        -- legítimo e tem de casar com o seu par, não virar duas linhas soltas.
        AND coalesce(c.filial_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(b.filial_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND coalesce(c.cc_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(b.cc_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND c.mes = b.mes
  )
  SELECT lid, sum(bt), sum(ct),
         count(*) FILTER (WHERE abs(ct - bt) > 0.005)
    FROM j
   GROUP BY lid
  HAVING count(*) FILTER (WHERE abs(ct - bt) > 0.005) > 0
$function$;

-- ---------------- conferência ----------------
WITH cen AS (
  SELECT id, codigo FROM versao_orcamento WHERE origem_versao_id IS NOT NULL
)
SELECT '1 · o que o comparativo passa a exigir' AS secao,
       cen.codigo AS chave,
       (SELECT count(*)::text FROM cenario_orcado_diff(cen.id))||' linha(s) alteradas' AS info,
       (SELECT count(*)::text FROM cenario_orcado_diff(cen.id) d
         WHERE abs(d.cenario - d.base) <= 0.005)||' delas SÓ por grão (valor igual)' AS det
  FROM cen
UNION ALL
SELECT '2 · pendentes de veredito', cen.codigo,
       cenario_orcado_pendentes(cen.id)::text||' pendente(s)',
       'o fechamento exige zero'
  FROM cen
UNION ALL
SELECT '3 · assinatura', 'cenario_orcado_diff',
       p.pronargs::text||' arg · '||
       CASE WHEN pg_get_function_result(p.oid) ILIKE '%celulas_dif%' THEN '✅ com celulas_dif'
            ELSE '⛔ sem celulas_dif' END, ''
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
 WHERE p.proname='cenario_orcado_diff'
 ORDER BY 1,2;
