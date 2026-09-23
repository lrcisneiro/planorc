-- ============================================================
-- 106 — Irmã de DRE não pode ser conta de CLT (e o item só entra se for dele)
--
-- Ricardo, vendo "Salarios e Ordenados · bloco −10.868,27 · DRE 657.457,59 ·
-- fora 668.325,86" no cabeçalho dos TERCEIROS: "esses casos de pegar dados de
-- outro item orçamentário não entendi, acho que está fazendo um caminho errado".
--
-- Estava. Dois erros somados:
--
-- 1. QUEBRA DA PARTIÇÃO. A expansão "irmãs de DRE" existe para um caso só: a
--    nota cai numa conta vizinha da que a folha aponta (41021001 → 41021002).
--    Mas ela trazia TODAS as contas do item, inclusive as de CLT. Essas contas
--    passavam a ser contadas nos DOIS blocos — como "outros" no CLT e como
--    atribuição no terceiro. Dinheiro em dobro, que é o oposto do que esta
--    conferência promete. Agora a irmã entra só se não for conta de CLT.
--
-- 2. O ITEM INTEIRO VIRAVA PAR. Bastava uma conta de Salários ter folha de verba
--    não lançada para o master virar "master de terceiro" e a DRE do item
--    inteiro (657 mil) aparecer como par de um bloco que cobre 10 mil. O número
--    era verdadeiro e a comparação, sem sentido.
--    Agora o par é o razão das contas do item QUE ESTÃO no universo do terceiro,
--    e a tela diz quando isso é o item completo (aí tem par na DRE) ou só uma
--    parte dele (o resto está no bloco de CLT).
-- ============================================================

CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  com_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM clt)
  ),
  masters AS (
    SELECT DISTINCT c.linha_id FROM conta_linha c
      JOIN com_folha f ON f.conta_id = c.conta_id
     WHERE c.tenant_id = current_tenant_id()
  )
  -- a irmã entra pela amarração, sem filtro de natureza (a 950001 é série 9 e
  -- compõe Terceiros Internos), mas NUNCA se for conta de CLT: essa já tem dono
  -- no outro bloco, e contar nos dois é contar duas vezes
  SELECT c.conta_id FROM conta_linha c
   WHERE c.tenant_id = current_tenant_id()
     AND c.linha_id IN (SELECT linha_id FROM masters)
     AND c.conta_id NOT IN (SELECT conta_id FROM clt)
  UNION
  SELECT conta_id FROM com_folha
$$;

-- ── O total por item: o par é a parte do item que é do terceiro ──
DROP FUNCTION IF EXISTS conciliacao_terceiros_total(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_total(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  linha_id uuid, linha_cod text, linha_desc text, linha_ordem int,
  razao_item numeric, razao_bloco numeric, item_completo boolean
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  atr AS MATERIALIZED (SELECT * FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs)),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  ),
  bloco AS (
    SELECT coalesce(i.linha_id::text, '') AS k, sum(a.valor)::numeric AS valor
      FROM atr a LEFT JOIN item i ON i.conta_id = a.conta_id
     GROUP BY 1
  ),
  -- o razão do item, separado entre a parte que é do terceiro e o resto
  dre AS (
    SELECT coalesce(i.linha_id::text, '') AS k,
           (array_agg(i.linha_id))[1] AS linha_id,
           max(i.linha_cod) AS cod, max(i.linha_desc) AS desc_, max(i.linha_ordem) AS ordem,
           sum(-fr.valor * coalesce(s.sinal, 1)) FILTER (
             WHERE fr.conta_id IN (SELECT conta_id FROM ct))::numeric AS valor_terceiro,
           count(*) FILTER (WHERE fr.conta_id NOT IN (SELECT conta_id FROM ct)) AS fora_do_terceiro
      FROM fat_realizado fr
      JOIN item i ON i.conta_id = fr.conta_id
      LEFT JOIN sinal s ON s.conta_id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND coalesce(i.linha_id::text, '') IN (SELECT k FROM bloco)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1
  )
  SELECT d.linha_id, d.cod, d.desc_, d.ordem,
         coalesce(d.valor_terceiro, 0)::numeric, coalesce(b.valor, 0)::numeric,
         coalesce(d.fora_do_terceiro, 0) = 0
    FROM bloco b LEFT JOIN dre d ON d.k = b.k
   -- item sem nada no bloco não é assunto do terceiro
   WHERE coalesce(b.valor, 0) <> 0
   ORDER BY d.ordem NULLS LAST, d.cod;
$$;

-- ── E o "fora" de um item: só o que está em conta de terceiro ──
-- Conta de CLT não aparece mais aqui: ela tem dono no outro bloco, e listá-la
-- como "faltando no terceiro" foi o que deixou o cabeçalho sem sentido.
DROP FUNCTION IF EXISTS conciliacao_terceiros_fora(int, int, uuid, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_fora(
  p_ano int, p_mes int, p_relatorio_id uuid, p_linha_id uuid DEFAULT NULL,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_cod text, conta_desc text, motivo text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  )
  SELECT cc.codigo, cc.descricao,
         'veio da contabilização da folha — o bloco de terceiros só olha nota fiscal',
         count(*)::bigint, sum(-fr.valor * coalesce(s.sinal, 1))::numeric
    FROM fat_realizado fr
    JOIN item i ON i.conta_id = fr.conta_id
    JOIN ct ON ct.conta_id = fr.conta_id
    JOIN conta_contabil cc ON cc.id = fr.conta_id
    LEFT JOIN sinal s ON s.conta_id = fr.conta_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND (p_linha_id IS NULL OR i.linha_id = p_linha_id)
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   GROUP BY 1, 2, 3
   ORDER BY abs(sum(-fr.valor * coalesce(s.sinal, 1))) DESC;
$$;
