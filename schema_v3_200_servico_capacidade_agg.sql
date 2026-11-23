-- ============================================================
-- v3_200 — agregação do quadro "Capacidade produtiva · Serviços"
--
-- Devolve, por PAPEL (produção × coordenação), o que o quadro precisa para
-- confrontar o tamanho da equipe com a receita orçada:
--   · pessoas e FTE do ANO DA VERSÃO (por vigência, não pelo quadro de hoje)
--   · custo de pessoal daquele ano
--   · horas/mês MEDIDAS no apontamento, para calibrar o fator
--
-- ⚠⚠ DUAS DEFINIÇÕES DE HEADCOUNT, e aqui vale a do ORÇADO. "Postos conta por
-- situação; o orçado sai por vigência" (CLAUDE.md): quem tem vigência até
-- 11/2026 aparece no quadro de hoje e gera ZERO em 2027. Num quadro de
-- capacidade de 2027, contá-lo seria prometer hora que o orçamento não paga.
-- Por isso o headcount sai de quem TEM célula em `fat_orcado`, e o FTE sai dos
-- meses em que ela existe — quem entra em julho vale 0,5.
--
-- ⚠⚠ INTERCÂMBIO FORA DAS HORAS. São 8.754h de 82.879 em 2026 (10,6%), com
-- peso de até 50% em algumas pessoas: hora que vira receita de OUTRA empresa
-- do grupo, com contrapartida na linha "Repasses receitas outras unidades".
-- Deixá-la dentro infla a capacidade de quem mais troca.
--
-- ⚠ O apontamento tem outro ANO que o orçamento: calibra-se o fator com o
-- passado e aplica-se ao futuro. `p_ano_apont` é explícito justamente para que
-- essa defasagem não fique implícita.
--
-- ⚠ `SECURITY INVOKER`, como as demais: o RLS de `fat_orcado` e de `posto`
-- recorta sozinho, e quem não alcança o CC não soma o custo dele.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

DROP FUNCTION IF EXISTS servico_capacidade_agg(uuid, integer, uuid[], uuid[], uuid[], integer);
CREATE FUNCTION servico_capacidade_agg(
  p_versao     uuid,
  p_ano        integer,
  p_empresas   uuid[],                    -- obrigatório: ver v3_191
  p_filiais    uuid[] DEFAULT NULL,
  p_ccs        uuid[] DEFAULT NULL,
  p_ano_apont  integer DEFAULT NULL       -- ano do apontamento; NULL = p_ano - 1
) RETURNS TABLE (
  papel        text,
  pessoas      integer,
  fte          numeric,
  custo        numeric,
  horas_mes    numeric,
  com_hora     integer
) LANGUAGE sql STABLE AS $$
  WITH
  -- ⚠ AGREGA ANTES DE JUNTAR (lição da v3_192): são ~16 mil células de origem
  -- POSTO por versão/ano, e o elo com `posto` é `dims->>'posto'`, texto e sem
  -- índice. Somando primeiro, o join vira algumas centenas de linhas.
  orc AS (
    SELECT f.dims->>'posto' AS cod,
           sum(-f.valor)    AS custo,
           count(DISTINCT f.mes) AS meses
      FROM fat_orcado f
     WHERE f.tenant_id = (SELECT current_tenant_id())
       AND f.versao_id = p_versao AND f.ano = p_ano AND f.origem = 'POSTO'
       AND f.empresa_id = ANY (p_empresas)
       AND (p_filiais IS NULL OR f.filial_id = ANY (p_filiais))
       AND (p_ccs     IS NULL OR f.cc_id     = ANY (p_ccs))
       AND f.dims->>'posto' IS NOT NULL
     GROUP BY 1
  ),
  -- horas por posto/mês, média dos meses apontados; intercâmbio fora
  hrs AS (
    SELECT posto_id, avg(h) AS hm FROM (
      SELECT a.posto_id, a.ano, a.mes, sum(a.horas) AS h
        FROM fat_apontamento a
       WHERE a.tenant_id = (SELECT current_tenant_id())
         AND a.ano = coalesce(p_ano_apont, p_ano - 1)
         AND NOT coalesce(a.intercambio, false)
         AND a.posto_id IS NOT NULL
       GROUP BY 1, 2, 3
    ) x GROUP BY 1
  )
  SELECT
    -- ⚠ PRECEDÊNCIA posto → cargo: nulo no posto é "siga o cargo", não "sem
    -- papel". Mesma forma de `posto.recebe_hora` sobre `apontamento_funcao`.
    coalesce(p.papel_servico, c.papel_servico, 'SEM_PAPEL')::text,
    count(DISTINCT p.codigo)::integer,
    round(sum(o.meses) / 12.0, 2),
    sum(o.custo),
    round(avg(h.hm), 1),
    count(DISTINCT h.posto_id)::integer
    FROM orc o
    JOIN posto p ON p.codigo = o.cod AND p.tenant_id = (SELECT current_tenant_id())
    LEFT JOIN cargo c ON c.id = p.cargo_id
    LEFT JOIN hrs  h ON h.posto_id = p.id
   GROUP BY 1
$$;

COMMENT ON FUNCTION servico_capacidade_agg IS
  'Capacidade de serviços por papel: headcount/FTE por VIGÊNCIA do ano da versão, custo e horas medidas no apontamento (sem intercâmbio). SECURITY INVOKER.';

GRANT EXECUTE ON FUNCTION servico_capacidade_agg(uuid, integer, uuid[], uuid[], uuid[], integer) TO authenticated;

-- ---------------- conferência ----------------
-- ⚠ A função NÃO pode ser chamada aqui: ela filtra por `current_tenant_id()`,
-- que é NULO no SQL Editor — a chamada voltaria zero linhas, o que parece
-- defeito e não é (lição da v3_191). O que se confere é a assinatura e os
-- números ESPERADOS, por consulta direta.
SELECT 'função criada' AS secao,
       coalesce((SELECT 'sim · ' || pg_get_function_arguments(oid)
                   FROM pg_proc WHERE proname = 'servico_capacidade_agg'), '⛔ não') AS resultado
UNION ALL
SELECT '— esperado: papel · pessoas · custo 2027 (CC 3x)',
       (SELECT string_agg(papel || ' ' || pes::text || 'p R$' || to_char(custo, 'FM999G999') , ' | ' ORDER BY papel)
          FROM (
            SELECT coalesce(p.papel_servico, c.papel_servico, 'SEM_PAPEL') papel,
                   count(DISTINCT p.codigo) pes, sum(x.v) custo
              FROM posto p
              LEFT JOIN cargo c ON c.id = p.cargo_id
              LEFT JOIN centro_custo cc ON cc.id = p.cc_id
              JOIN LATERAL (SELECT coalesce(sum(-f.valor), 0) v FROM fat_orcado f
                             WHERE f.dims->>'posto' = p.codigo AND f.ano = 2027 AND f.origem = 'POSTO'
                               AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')) x ON true
             WHERE cc.codigo LIKE '3%' AND x.v > 0 GROUP BY 1) y)
UNION ALL
SELECT '— esperado: horas/mês medidas 2026 (sem intercâmbio)',
       (SELECT round(avg(h), 1)::text || ' h · ' || count(DISTINCT posto_id)::text || ' postos'
          FROM (SELECT posto_id, ano, mes, sum(horas) h FROM fat_apontamento
                 WHERE ano = 2026 AND NOT coalesce(intercambio, false) AND posto_id IS NOT NULL
                 GROUP BY 1, 2, 3) z);
