-- ============================================================
-- v3_192 — `analise_pessoas_agg`: agregar ANTES de juntar
--
-- SINTOMA: a aba Análise Pessoas levava a tela ao `statement timeout` (o
-- `authenticated` tem 8 s) e, quando não estourava, somava 3,4 s a uma tela que
-- já faz 6 a 8 chamadas.
--
-- ⚠⚠ MEDIR COMO DONO NÃO MEDE A TELA. A perna de despesa levava **36 ms** no
-- meu usuário e **~2,5 s** personificando quem usa: o dono ignora RLS, e é o
-- RLS que custa. Toda medição de desempenho aqui vai com
-- `set_config('request.jwt.claims',…)` + `SET ROLE authenticated`.
--
-- A CAUSA, no plano: `LEFT JOIN centro_custo` virava **nested loop com 17.712
-- iterações** numa tabela de **85 linhas** — 53 mil buffers —, e cada iteração
-- reavaliava `current_tenant_id()` no filtro da política de `centro_custo`.
-- É a armadilha nº 2 da v3_129 outra vez (função STABLE em policy roda por
-- linha), só que vista do lado de fora: em vez de mexer na política dos outros,
-- some-se com as iterações.
--
-- O CONSERTO: agregar o fato PRIMEIRO, por `cc_id`, e só então juntar.
--   · pessoas: 17.712 células → ~600 grupos antes do join
--   · despesa: 29.396 células → ~85 grupos antes do join
-- E a conta de despesa deixa de ser um JOIN por linha: o conjunto de contas
-- do bloco 2 é resolvido UMA vez num InitPlan.
-- ⚠ O `::uuid[]` não é enfeite — sem ele o `ANY` é lido como subconsulta e
-- nem roda (lição do v3_123).
--
-- RESULTADO IDÊNTICO: o grão final continua (área, regime, pessoa). Agrupar
-- por `cc_id` antes e por área depois dá o mesmo número, porque a área é
-- função do CC — e a pessoa que aparece em dois CCs da mesma área continua
-- somando numa linha só, no GROUP BY de fora.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION analise_pessoas_agg(
  p_versao   uuid,
  p_ano      integer,
  p_empresas uuid[],
  p_filiais  uuid[]   DEFAULT NULL,
  p_ccs      uuid[]   DEFAULT NULL
) RETURNS TABLE (
  tipo      text,
  area_cod  text,
  area_nome text,
  regime    text,
  pessoa    text,
  valor     numeric
) LANGUAGE sql STABLE AS $$
  WITH pes AS (
    SELECT f.cc_id,
           f.dims->>'posto' AS posto_cod,
           -- mesma precedência do lib/pessoaChave.ts: nome → matrícula → posto
           coalesce(nullif(upper(trim(f.dims->>'nome')), ''),
                    nullif(trim(f.dims->>'matricula'), ''),
                    f.dims->>'posto') AS pessoa,
           sum(-f.valor) AS valor
      FROM fat_orcado f
     WHERE f.tenant_id = current_tenant_id()
       AND f.versao_id = p_versao AND f.ano = p_ano AND f.origem = 'POSTO'
       AND f.empresa_id = ANY (p_empresas)
       AND (p_filiais IS NULL OR f.filial_id = ANY (p_filiais))
       AND (p_ccs     IS NULL OR f.cc_id     = ANY (p_ccs))
     GROUP BY 1, 2, 3
  ),
  desp AS (
    SELECT f.cc_id, sum(-f.valor) AS valor
      FROM fat_orcado f
     WHERE f.tenant_id = current_tenant_id()
       AND f.versao_id = p_versao AND f.ano = p_ano
       AND f.linha_id = ANY ((SELECT array_agg(co.id) FROM conta_orcamentaria co
                               WHERE co.tenant_id = current_tenant_id()
                                 AND co.codigo LIKE '2%')::uuid[])
       AND f.empresa_id = ANY (p_empresas)
       AND (p_filiais IS NULL OR f.filial_id = ANY (p_filiais))
       AND (p_ccs     IS NULL OR f.cc_id     = ANY (p_ccs))
     GROUP BY 1
  )
  SELECT 'PESSOA'::text, cc.area_cod, coalesce(cc.area_nome, '(sem área)'),
         coalesce(p.regime, '(sem regime)'), pes.pessoa, sum(pes.valor)
    FROM pes
    LEFT JOIN centro_custo cc ON cc.id = pes.cc_id
    LEFT JOIN posto p ON p.codigo = pes.posto_cod AND p.tenant_id = current_tenant_id()
   GROUP BY 1, 2, 3, 4, 5

  UNION ALL

  SELECT 'DESPESA'::text, cc.area_cod, coalesce(cc.area_nome, '(sem área)'),
         NULL, NULL, sum(desp.valor)
    FROM desp
    LEFT JOIN centro_custo cc ON cc.id = desp.cc_id
   GROUP BY 1, 2, 3
$$;

COMMENT ON FUNCTION analise_pessoas_agg IS
  'Custo de pessoal e despesa operacional por área, para a aba Análise Pessoas. '
  'Agrega o fato por cc_id ANTES de juntar centro_custo: o nested loop por linha '
  'levava a função a 3,4 s sob RLS (v3_192).';

GRANT EXECUTE ON FUNCTION analise_pessoas_agg(uuid, integer, uuid[], uuid[], uuid[]) TO authenticated;

SELECT 'função atualizada' AS secao,
       (SELECT CASE WHEN prosrc LIKE '%WITH pes AS%' THEN 'sim — agrega antes de juntar'
                    ELSE '⛔ ainda é a versão antiga' END
          FROM pg_proc WHERE proname = 'analise_pessoas_agg') AS resultado;
