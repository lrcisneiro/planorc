-- ============================================================
-- v3_126 — leitores do wizard de RÉPLICA DE LINHA ORÇAMENTÁRIA.
--
-- O 2º wizard replica uma linha do relatório de um ano para o outro, com
-- acréscimo ou decréscimo. Diferente do de impostos, ele gera UMA LINHA POR
-- CONTA da subárvore escolhida — então os leitores precisam devolver a conta,
-- não só o escopo.
--
-- Dois leitores, porque a origem pode ser o realizado de um ano ou o orçado de
-- outra versão: "replicar 2026 para 2027" tanto pode partir do que aconteceu
-- quanto do que se orçou.
--
-- ⚠ Ambos devolvem jsonb e não SETOF: o PostgREST corta em 1000 linhas SEM
-- ERRO, e aqui são escopos × contas × meses — estoura fácil. (Mesma armadilha
-- do pageAll no CLAUDE.md.)
--
-- IDEMPOTENTE. Só leitura.
-- ============================================================

-- ---------- realizado por escopo × conta × mês ----------
-- Caminho: fat_realizado.conta_id → conta_linha → conta_orcamentaria. O
-- `fat_realizado.linha_id` é nullable e quase sempre nulo (v3_010), por isso
-- não se usa.
--
-- Honra `lote_ignorado` e aplica `conta_linha.sinal`, como faz a
-- relatorio_realizado_agg — senão o número do wizard divergiria do número que
-- o relatório mostra, e divergência silenciosa entre duas telas é pior que
-- erro, porque ninguém sabe qual acreditar.
DROP FUNCTION IF EXISTS wizard_realizado_por_conta(int, uuid[]);
CREATE FUNCTION wizard_realizado_por_conta(
  p_ano     int,
  p_masters uuid[]        -- conta_orcamentaria (masters da subárvore escolhida)
) RETURNS jsonb
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'k', t.master, 'e', t.empresa_id, 'f', t.filial_id,
           'c', t.cc_id, 'm', t.mes, 'v', t.v)), '[]'::jsonb)
    FROM (
      SELECT cl.linha_id AS master, fr.empresa_id, fr.filial_id, fr.cc_id, fr.mes,
             round(sum(fr.valor * cl.sinal), 2) AS v
        FROM fat_realizado fr
        JOIN LATERAL (
          -- uma conta pode estar amarrada a mais de uma linha; o agregado do
          -- relatório usa a mais recente, e aqui tem de ser a mesma
          SELECT c.linha_id, c.sinal FROM conta_linha c
           WHERE c.conta_id = fr.conta_id AND c.tenant_id = current_tenant_id()
             AND c.linha_id = ANY(p_masters)
           ORDER BY c.id DESC LIMIT 1
        ) cl ON true
       WHERE fr.tenant_id = current_tenant_id()
         AND fr.ano = p_ano
         AND NOT EXISTS (
           SELECT 1 FROM lote_ignorado li
            WHERE li.tenant_id = fr.tenant_id AND li.ativo
              AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%'
                        ELSE li.lote = fr.lote END)
              AND (li.sublote    IS NULL OR li.sublote    = fr.sublote)
              AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id))
       GROUP BY cl.linha_id, fr.empresa_id, fr.filial_id, fr.cc_id, fr.mes
      HAVING sum(fr.valor * cl.sinal) <> 0
    ) t
$$;

-- ---------- orçado por escopo × conta × mês ----------
-- Irmã da wizard_orcado_por_escopo (v3_125), que soma SEM quebrar por conta —
-- aquela serve ao imposto, que tributa o total; esta serve à réplica, que
-- precisa devolver cada conta ao seu lugar.
DROP FUNCTION IF EXISTS wizard_orcado_por_conta(uuid, int, uuid[]);
CREATE FUNCTION wizard_orcado_por_conta(
  p_versao  uuid,
  p_ano     int,
  p_masters uuid[]
) RETURNS jsonb
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'k', t.linha_id, 'e', t.empresa_id, 'f', t.filial_id,
           'c', t.cc_id, 'm', t.mes, 'v', t.v)), '[]'::jsonb)
    FROM (
      SELECT fo.linha_id, fo.empresa_id, fo.filial_id, fo.cc_id, fo.mes,
             round(sum(fo.valor), 2) AS v
        FROM fat_orcado fo
       WHERE fo.tenant_id = current_tenant_id()
         AND fo.versao_id = p_versao
         AND fo.ano       = p_ano
         AND fo.linha_id  = ANY(p_masters)
       GROUP BY fo.linha_id, fo.empresa_id, fo.filial_id, fo.cc_id, fo.mes
      HAVING sum(fo.valor) <> 0
    ) t
$$;

-- ---------- conferência ----------
SELECT proname AS funcao, 'criada' AS ok
  FROM pg_proc
 WHERE proname IN ('wizard_realizado_por_conta', 'wizard_orcado_por_conta')
 ORDER BY 1;
