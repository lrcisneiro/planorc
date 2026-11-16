-- ============================================================
-- SEED — rateio do CC 5xx (Marketing), igual ao do posto 2001-900082
--
-- O QUE: a cascata do THIAGO SOARES (2001-900082) replicada para todo posto
-- cujo centro de custo comece com 5:
--     ordem 1 · RATEMP01 - Empresa Padrão Geral   (dimensão EMPRESA)
--     ordem 2 · RATCC04  - MKT Base Novos          (dimensão CC)
--
-- A ORDEM É A CASCATA e não é enfeite: primeiro distribui por empresa, depois
-- o que sobrou por centro de custo. Inverter muda o resultado.
--
-- ⚠⚠ ESTE SEED SOZINHO NÃO DURA. A importação de postos RE-SINCRONIZA o
-- rateio: apaga `posto_rateio` dos postos do arquivo e recria pela coluna
-- `RATEIO`. Como `RATEIO_POR_CC` no `converter_funcionarios.py` não tinha o
-- 524, a coluna vinha vazia e a próxima carga APAGARIA tudo isto, em silêncio.
-- A regra foi acrescentada lá no mesmo commit — este seed arruma o agora, a
-- regra mantém. Rodar um sem o outro é trabalho que evapora.
--
-- ⚠ ALCANCE MEDIDO (16/nov/2026): dos CCs que começam com 5, só o **524 Novos
-- ERP Tradicional** tem gente — 23 postos. Os outros 17 (511-518, 521-528)
-- estão vazios. O filtro vai por PREFIXO mesmo assim, porque é o que foi
-- pedido e porque expressa a intenção: se amanhã alguém entrar no 514, a
-- regra já diz o que fazer.
--
-- ⚠ ENTRA TAMBÉM EM DEMITIDO E FÉRIAS (10 + 2 dos 23). Rateio é atributo de
-- cadastro e não custa nada em quem está fora do Aplicar; excluí-los criaria
-- uma diferença invisível para quem for reativado depois.
--
-- ⚠ Os 4 que JÁ têm a cascata (Andressa, Mateus 2001-900063, Simone e o
-- próprio Thiago) não são tocados — `ON CONFLICT DO NOTHING` sobre
-- (tenant, posto, regra). Conferido: os quatro têm exatamente esta cascata,
-- nenhum tem rateio diferente que fosse ser misturado com este.
--
-- ⚠ Tenant vem da tabela `tenant`: no SQL Editor `current_tenant_id()` é NULL.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

INSERT INTO posto_rateio (tenant_id, posto_id, regra_id, ordem)
SELECT t.id, p.id, r.id, v.ordem
  FROM (SELECT id FROM tenant ORDER BY criado_em LIMIT 1) t
  JOIN posto p          ON p.tenant_id = t.id
  JOIN centro_custo cc  ON cc.id = p.cc_id AND cc.codigo LIKE '5%'
  CROSS JOIN (VALUES ('RATEMP01', 1), ('RATCC04', 2)) AS v(cod, ordem)
  JOIN rateio_regra r   ON r.tenant_id = t.id
                       AND split_part(r.nome, ' - ', 1) = v.cod
ON CONFLICT (tenant_id, posto_id, regra_id) DO NOTHING;

-- ---------------- conferência ----------------
WITH alvo AS (
  SELECT p.id, p.codigo
    FROM posto p JOIN centro_custo cc ON cc.id = p.cc_id
   WHERE cc.codigo LIKE '5%'
), casc AS (
  SELECT a.codigo,
         string_agg(split_part(r.nome, ' - ', 1), ' → ' ORDER BY pr.ordem) AS cascata
    FROM alvo a
    LEFT JOIN posto_rateio pr ON pr.posto_id = a.id
    LEFT JOIN rateio_regra r  ON r.id = pr.regra_id
   GROUP BY a.codigo
)
SELECT 'postos com CC 5xx' AS secao, count(*)::text AS resultado FROM alvo
UNION ALL
SELECT 'com a cascata completa',
       count(*)::text FROM casc WHERE cascata = 'RATEMP01 → RATCC04'
UNION ALL
SELECT 'com cascata DIFERENTE (olhar)',
       coalesce(string_agg(codigo || ': ' || coalesce(cascata, 'nenhuma'), ' · '), 'nenhum')
  FROM casc WHERE cascata IS DISTINCT FROM 'RATEMP01 → RATCC04';
