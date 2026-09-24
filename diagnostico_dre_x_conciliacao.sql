-- ============================================================
-- Por que a DRE e a Conciliação Orçado × Folha não batem com o MESMO filtro
-- Recorte do caso: Ago/2026, todas as empresas, Área 3 (Serviços) + Divisão 1
-- (Base) — ou seja, CC cujo código começa com '31'.
--
-- Números da tela, para comparar:
--   DRE, 3 linhas       orçado 1.913.105   realizado 1.738.880
--   Conciliação         orçado ~1,62 mi    realizado 1.776.514,20
--
-- Há DUAS diferenças estruturais, e elas puxam para lados opostos:
--
--  1. ORÇADO — o Aplicar grava em dois lugares, com grãos diferentes:
--     · fat_orcado  (o que a DRE lê) = RATEADO, na empresa/CC de DESTINO
--     · fat_folha tipo=ORCADO (o que a conciliação lê) = NÃO rateado, na
--       empresa/CC de ORIGEM do posto
--     Com filtro por CC, os dois recortam populações diferentes.
--
--  2. REALIZADO — a DRE lê o RAZÃO; a conciliação lê a FOLHA. E no modo
--     "por posto" o filtro da conciliação é pela ORIGEM do posto, então ela
--     traz a folha inteira de quem é de '31' e ignora quem é de fora e caiu
--     em '31'. A DRE filtra lançamento a lançamento.
--
-- Rode inteiro. Só leitura.
-- ============================================================

-- 0) O conjunto de CC do filtro e a versão usada — confira antes de ler o resto
WITH cc31 AS (SELECT id, codigo, descricao FROM centro_custo
               WHERE tenant_id = current_tenant_id() AND codigo LIKE '31%')
SELECT (SELECT count(*) FROM cc31) AS ccs_no_filtro,
       (SELECT string_agg(codigo, ', ' ORDER BY codigo) FROM cc31) AS codigos;

SELECT id, codigo, descricao, ano, ativa FROM versao_orcamento
 WHERE tenant_id = current_tenant_id() ORDER BY codigo;

-- ── 1. O orçado da DRE nos 3 itens, e quanto dele veio de FORA por rateio ──
-- dims->>'cc_origem' é o CC do posto que gerou a linha. Se ele não é '31' e o
-- cc_id é, aquele dinheiro entrou por rateio: está na DRE e NÃO está na
-- conciliação em modo posto. O inverso (saiu) é o contrário.
WITH cc31 AS (SELECT id FROM centro_custo
               WHERE tenant_id = current_tenant_id() AND codigo LIKE '31%'),
mestres AS (
  SELECT id, codigo, descricao FROM conta_orcamentaria
   WHERE tenant_id = current_tenant_id()
     AND (descricao ILIKE '%salario%' OR descricao ILIKE '%encargo%' OR descricao ILIKE '%terceiro%interno%')
),
o AS (
  -- TODAS as origens: se houver orcado MANUAL ou de FORMULARIO nestes itens,
  -- ele esta na DRE e nunca estara na conciliacao, que so conhece posto.
  SELECT fo.*, (fo.dims->>'cc_origem')::uuid AS cc_origem
    FROM fat_orcado fo
   WHERE fo.tenant_id = current_tenant_id() AND fo.ano = 2026 AND fo.mes = 8
     AND fo.linha_id IN (SELECT id FROM mestres)
),
d AS (SELECT * FROM o WHERE cc_id IN (SELECT id FROM cc31))
SELECT m.codigo, left(m.descricao, 26) AS item,
       to_char(sum(d.valor), 'FM999G999G990D00') AS dre_no_filtro,
       to_char(sum(d.valor) FILTER (WHERE d.origem <> 'POSTO'), 'FM999G999G990D00') AS nao_veio_de_posto,
       to_char(sum(d.valor) FILTER (WHERE d.origem = 'POSTO'
                                      AND (d.cc_origem IS NULL OR d.cc_origem NOT IN (SELECT id FROM cc31))), 'FM999G999G990D00') AS entrou_por_rateio,
       to_char((SELECT sum(o2.valor) FROM o o2
                 WHERE o2.linha_id = m.id AND o2.origem = 'POSTO'
                   AND o2.cc_id NOT IN (SELECT id FROM cc31)
                   AND o2.cc_origem IN (SELECT id FROM cc31)), 'FM999G999G990D00') AS saiu_por_rateio
  FROM d JOIN mestres m ON m.id = d.linha_id
 GROUP BY 1, 2, m.id ORDER BY 1;

-- ── 2. O orçado da conciliação (fat_folha ORCADO), pela ORIGEM ──
-- É o mesmo Aplicar, gravado sem rateio. A diferença para a consulta 1 é o
-- grão, não o cálculo. A última coluna é o furo do outro lado: verba sem conta
-- de destino entra aqui e NÃO entra na DRE.
SELECT v.codigo AS versao,
       to_char(sum(ff.valor), 'FM999G999G990D00') AS orcado_origem_31,
       to_char(sum(ff.valor) FILTER (WHERE ff.item_orc_id IS NULL), 'FM999G999G990D00') AS sem_item_orcamentario
  FROM fat_folha ff
  JOIN versao_orcamento v ON v.id = ff.versao_id
  JOIN centro_custo cc ON cc.id = ff.cc_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'ORCADO'
   AND ff.ano = 2026 AND ff.mes = 8 AND cc.codigo LIKE '31%'
 GROUP BY 1 ORDER BY 1;

-- ── 3. O realizado da folha: quanto é dos 3 itens e quanto é de outros ──
-- A aba avulsa da conciliação roda com TODAS as contas; a DRE tem 3 linhas.
-- Aqui pelo CC da própria linha da folha (não pela origem do posto).
WITH mestres AS (
  SELECT id FROM conta_orcamentaria
   WHERE tenant_id = current_tenant_id()
     AND (descricao ILIKE '%salario%' OR descricao ILIKE '%encargo%' OR descricao ILIKE '%terceiro%interno%')
)
SELECT CASE WHEN ff.item_orc_id IN (SELECT id FROM mestres) THEN 'nos 3 itens da DRE'
            WHEN ff.item_orc_id IS NULL THEN 'sem item orçamentário'
            ELSE 'outros itens' END AS onde,
       count(*) AS linhas,
       to_char(sum(ff.valor), 'FM999G999G990D00') AS valor
  FROM fat_folha ff
  JOIN centro_custo cc ON cc.id = ff.cc_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
   AND ff.ano = 2026 AND ff.mes = 8 AND cc.codigo LIKE '31%'
   AND coalesce(ff.tipo_verba, '') NOT LIKE 'Desconto%'
 GROUP BY 1 ORDER BY 3 DESC;

-- ── 4. Origem do posto × CC da linha da folha ──
-- Mede direto o efeito do modo "por posto": o que ele inclui a mais (posto de
-- '31' cuja folha caiu fora) e o que ele deixa de fora (folha caiu em '31',
-- posto é de outro CC). São as duas pontas do descasamento com a DRE.
WITH cc31 AS (SELECT id FROM centro_custo
               WHERE tenant_id = current_tenant_id() AND codigo LIKE '31%')
SELECT CASE
         WHEN p.cc_id IN (SELECT id FROM cc31) AND ff.cc_id IN (SELECT id FROM cc31) THEN 'origem 31 · caiu em 31'
         WHEN p.cc_id IN (SELECT id FROM cc31) THEN 'origem 31 · caiu FORA (só a conciliação conta)'
         WHEN ff.cc_id IN (SELECT id FROM cc31) THEN 'origem fora · caiu em 31 (só a DRE conta)'
         ELSE 'fora dos dois' END AS caso,
       count(*) AS linhas,
       to_char(sum(ff.valor), 'FM999G999G990D00') AS valor
  FROM fat_folha ff
  LEFT JOIN posto p ON p.id = ff.posto_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
   AND ff.ano = 2026 AND ff.mes = 8
   AND coalesce(ff.tipo_verba, '') NOT LIKE 'Desconto%'
   AND (p.cc_id IN (SELECT id FROM cc31) OR ff.cc_id IN (SELECT id FROM cc31))
 GROUP BY 1 ORDER BY 3 DESC;

-- ── 5. O realizado da DRE (razão) nos 3 itens, no mesmo recorte ──
-- Este é o 1.738.880 da tela. Contra a folha, a diferença é a conciliação
-- Contábil × Folha — não é assunto da tela de Orçado × Folha.
WITH mestres AS (
  SELECT id, codigo, descricao FROM conta_orcamentaria
   WHERE tenant_id = current_tenant_id()
     AND (descricao ILIKE '%salario%' OR descricao ILIKE '%encargo%' OR descricao ILIKE '%terceiro%interno%')
),
amarr AS (
  SELECT c.conta_id, c.linha_id, max(c.sinal) AS sinal FROM conta_linha c
   WHERE c.tenant_id = current_tenant_id() AND c.linha_id IN (SELECT id FROM mestres)
   GROUP BY 1, 2
)
SELECT m.codigo, left(m.descricao, 26) AS item,
       count(*) AS lancamentos,
       to_char(sum(-fr.valor * coalesce(a.sinal, 1)), 'FM999G999G990D00') AS razao_no_filtro
  FROM fat_realizado fr
  JOIN amarr a ON a.conta_id = fr.conta_id
  JOIN mestres m ON m.id = a.linha_id
  JOIN centro_custo cc ON cc.id = fr.cc_id
 WHERE fr.tenant_id = current_tenant_id() AND fr.ano = 2026 AND fr.mes = 8
   AND cc.codigo LIKE '31%'
 GROUP BY 1, 2 ORDER BY 1;
