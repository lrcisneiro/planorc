-- ============================================================
-- Onde está a diferença entre a DRE e a Conciliação Orçado × Folha
-- Recorte: Ago/2026, todas as empresas, Área 3 · Divisão 1 → CC LIKE '31%'
--
-- Medido na tela, item a item:
--
--                        ORÇADO                      REALIZADO
--                    DRE      concil    dif       DRE      concil     dif
--  Salarios      233.129    99.933   -133.196   157.817   144.057   -13.760
--  Encargos       95.651    57.045    -38.606   116.056    96.886   -19.170
--  Terceiros   1.584.325 1.234.699   -349.626 1.465.007 1.493.260   +28.253
--  ─────────────────────────────────────────────────────────────────────────
--  Total       1.913.105 1.391.677   -521.428 1.738.880 1.734.203    -4.677
--
-- O REALIZADO praticamente fecha: 4.677 em 1,7 milhão, e é a troca de item
-- entre a folha e o razão (a verba aponta um item, a contabilização lançou em
-- outro) — assunto da conciliação Contábil × Folha, que já mede isso.
--
-- O ORÇADO é que está 521 mil abaixo, e é isto que as consultas abaixo
-- perseguem, em ordem de suspeita:
--   1. a DRE está em OUTRA VERSÃO de orçamento
--   2. a linha da DRE é Σ (SOMAR_FILHOS) e agrega MAIS masters que os 3 que o
--      motor de folha usa
--   3. há orçado de origem MANUAL/FORMULARIO nessas linhas — está na DRE e
--      nunca estará na conciliação, que só conhece posto
--   4. rateio: a DRE lê o orçado no CC de DESTINO, a conciliação na ORIGEM
--
-- Rode inteiro. Só leitura.
-- ============================================================

-- ── 0. O recorte, para conferir antes de acreditar no resto ──
SELECT count(*) AS ccs_no_filtro,
       string_agg(codigo, ', ' ORDER BY codigo) AS codigos
  FROM centro_custo
 WHERE tenant_id = current_tenant_id() AND codigo LIKE '31%';

-- ── 1. A DRE está na mesma versão? ──
-- Se aparecer mais de uma versão com valor, confirme no seletor da DRE qual
-- está selecionada. Versão diferente explica a diferença inteira sozinha.
SELECT v.codigo AS versao, v.descricao, fo.origem,
       count(*) AS linhas,
       to_char(sum(fo.valor), 'FM999G999G990D00') AS orcado_no_filtro
  FROM fat_orcado fo
  JOIN versao_orcamento v ON v.id = fo.versao_id
  JOIN centro_custo cc ON cc.id = fo.cc_id
 WHERE fo.tenant_id = current_tenant_id() AND fo.ano = 2026 AND fo.mes = 8
   AND cc.codigo LIKE '31%'
 GROUP BY 1, 2, 3 ORDER BY 1, 3;

-- ── 2. O que cada linha da DRE realmente agrega ──
-- Σ (SOMAR_FILHOS) soma as filhas, e CADA filha tem o seu próprio master. Se a
-- linha tiver filhas apontando para masters fora dos 3 que o motor usa, a DRE é
-- maior por construção — não é divergência, é escopo de linha.
WITH RECURSIVE raiz AS (
  SELECT rl.id, rl.relatorio_id, rl.descricao AS raiz_desc
    FROM relatorio_linha rl
   WHERE rl.descricao ILIKE '%salario%ordenado%'
      OR rl.descricao ILIKE '%encargo%benef%'
      OR rl.descricao ILIKE '%terceiro%interno%'
),
arv AS (
  SELECT r.id, r.relatorio_id, r.raiz_desc, r.id AS no_id, 0 AS prof FROM raiz r
  UNION ALL
  SELECT a.id, a.relatorio_id, a.raiz_desc, f.id, a.prof + 1
    FROM arv a JOIN relatorio_linha f ON f.pai_id = a.no_id
)
SELECT rel.nome AS relatorio, a.raiz_desc AS linha_da_dre, a.prof AS nivel,
       n.codigo AS linha_cod, left(n.descricao, 30) AS linha_desc, n.tipo_linha,
       co.codigo AS master_cod, left(co.descricao, 26) AS master_desc
  FROM arv a
  JOIN relatorio_linha n ON n.id = a.no_id
  JOIN relatorio rel ON rel.id = a.relatorio_id
  LEFT JOIN conta_orcamentaria co ON co.id = n.linha_orc_id
 ORDER BY rel.nome, a.raiz_desc, a.prof, n.ordem;

-- ── 3. O orçado no recorte, por master e por origem ──
-- Só os masters que aparecem na árvore acima. `entrou_por_rateio` é orçado de
-- posto de OUTRO CC que a cascata trouxe para '31' — está na DRE e não está na
-- conciliação; `saiu_por_rateio` é o contrário.
WITH cc31 AS (SELECT id FROM centro_custo
               WHERE tenant_id = current_tenant_id() AND codigo LIKE '31%'),
masters AS (
  SELECT DISTINCT rl.linha_orc_id AS id
    FROM relatorio_linha rl
   WHERE rl.linha_orc_id IS NOT NULL
),
o AS (
  SELECT fo.*, (fo.dims->>'cc_origem')::uuid AS cc_origem
    FROM fat_orcado fo
   WHERE fo.tenant_id = current_tenant_id() AND fo.ano = 2026 AND fo.mes = 8
     AND fo.linha_id IN (SELECT id FROM masters)
)
SELECT co.codigo AS master, left(co.descricao, 26) AS item,
       to_char(sum(o.valor) FILTER (WHERE o.cc_id IN (SELECT id FROM cc31)), 'FM999G999G990D00') AS no_filtro,
       to_char(sum(o.valor) FILTER (WHERE o.cc_id IN (SELECT id FROM cc31) AND o.origem <> 'POSTO'), 'FM999G999G990D00') AS nao_veio_de_posto,
       to_char(sum(o.valor) FILTER (WHERE o.cc_id IN (SELECT id FROM cc31) AND o.origem = 'POSTO'
                                      AND (o.cc_origem IS NULL OR o.cc_origem NOT IN (SELECT id FROM cc31))), 'FM999G999G990D00') AS entrou_por_rateio,
       to_char(sum(o.valor) FILTER (WHERE o.cc_id NOT IN (SELECT id FROM cc31) AND o.origem = 'POSTO'
                                      AND o.cc_origem IN (SELECT id FROM cc31)), 'FM999G999G990D00') AS saiu_por_rateio
  FROM o JOIN conta_orcamentaria co ON co.id = o.linha_id
 GROUP BY 1, 2
HAVING sum(o.valor) FILTER (WHERE o.cc_id IN (SELECT id FROM cc31)) IS NOT NULL
 ORDER BY 1;

-- ── 4. O orçado que a conciliação lê, pelo mesmo recorte ──
-- fat_folha ORCADO: por verba, na ORIGEM do posto. Compare master a master com
-- a consulta 3 — a diferença que sobrar depois do rateio e da origem é o que
-- ainda não tem explicação.
SELECT v.codigo AS versao,
       coalesce(co.codigo, '(sem item)') AS master, left(coalesce(co.descricao, ''), 26) AS item,
       count(*) AS linhas,
       to_char(sum(ff.valor), 'FM999G999G990D00') AS orcado_origem_31
  FROM fat_folha ff
  JOIN versao_orcamento v ON v.id = ff.versao_id
  JOIN centro_custo cc ON cc.id = ff.cc_id
  LEFT JOIN conta_orcamentaria co ON co.id = ff.item_orc_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'ORCADO'
   AND ff.ano = 2026 AND ff.mes = 8 AND cc.codigo LIKE '31%'
 GROUP BY 1, 2, 3 ORDER BY 1, 2;

-- ── 5. O mesmo Aplicar, os dois destinos, sem recorte nenhum ──
-- Sem filtro de CC os dois TÊM de dar o mesmo total (é o mesmo cálculo gravado
-- duas vezes). Se já divergirem aqui, o problema não é o filtro nem o rateio:
-- é a verba sem conta de destino, que entra na folha e não chega à DRE.
SELECT 'fat_orcado (DRE)' AS onde, v.codigo AS versao,
       to_char(sum(fo.valor), 'FM999G999G990D00') AS total_ago
  FROM fat_orcado fo JOIN versao_orcamento v ON v.id = fo.versao_id
 WHERE fo.tenant_id = current_tenant_id() AND fo.ano = 2026 AND fo.mes = 8
   AND fo.origem = 'POSTO'
 GROUP BY 1, 2
UNION ALL
SELECT 'fat_folha ORCADO (concil)', v.codigo,
       to_char(sum(ff.valor), 'FM999G999G990D00')
  FROM fat_folha ff JOIN versao_orcamento v ON v.id = ff.versao_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'ORCADO'
   AND ff.ano = 2026 AND ff.mes = 8
 GROUP BY 1, 2
UNION ALL
SELECT 'fat_folha ORCADO — verba sem conta de destino', v.codigo,
       to_char(sum(ff.valor), 'FM999G999G990D00')
  FROM fat_folha ff JOIN versao_orcamento v ON v.id = ff.versao_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'ORCADO'
   AND ff.ano = 2026 AND ff.mes = 8 AND ff.item_orc_id IS NULL
 GROUP BY 1, 2
 ORDER BY 2, 1;
