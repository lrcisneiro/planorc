-- ============================================================
-- v3_199 — PAPEL NA ÁREA DE SERVIÇOS (produção × coordenação)
--
-- POR QUE EXISTE: a análise de capacidade produtiva precisa separar quem
-- **vende hora** de quem **coordena**, e os dois eixos que o produto já tem não
-- servem para isso:
--   · o CENTRO DE CUSTO não distingue — analista e coordenador estão no mesmo;
--   · a ÁREA FUNCIONAL também não — todos em "SERVIÇOS DE IMPLANTAÇÃO".
-- Quem distingue é o CARGO. Medido em 23/nov no CC da área 3: **144 de
-- produção** (R$ 24,7 mi em 2027) e **29 de coordenação** (R$ 7,3 mi), e a
-- diferença aparece sozinha no apontamento — produção 162 h/mês contra 98 h/mês
-- da coordenação.
--
-- ⚠⚠ A REGRA DE NOME SEMEIA, NÃO GOVERNA. O `~*` abaixo roda **uma vez**, aqui.
-- Resolver cargo por nome em código é erro já registrado duas vezes neste
-- projeto (v3_157, v3_161): são quatro `ESPECIALISTA DE DESENVOLVIMENTO DE
-- SOFTWARE I` nesta base, e nome deixou de identificar cargo. Depois da
-- semeadura, quem manda é o campo — e ele se ajusta na tela.
--
-- ⚠ DOIS NÍVEIS, com precedência `posto → cargo`, igual a `posto.recebe_hora`
-- sobre `apontamento_funcao`: o cargo é a REGRA (vale para quem entrar amanhã)
-- e o posto é a EXCEÇÃO (o coordenador que na prática entrega projeto).
--
-- ⚠ `NULL` no posto NÃO é "sem papel": é "siga o cargo". Por isso a coluna do
-- posto nasce nula em todo mundo e só é preenchida por quem for exceção —
-- semear os 570 postos com o valor do cargo congelaria a regra no momento da
-- carga e a mudança de cargo deixaria de surtir efeito, calada.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1 · as colunas ──────────────────────────────────────────────────────
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS papel_servico text
  CHECK (papel_servico IN ('PRODUCAO', 'COORDENACAO'));
ALTER TABLE posto ADD COLUMN IF NOT EXISTS papel_servico text
  CHECK (papel_servico IN ('PRODUCAO', 'COORDENACAO'));

COMMENT ON COLUMN cargo.papel_servico IS
  'Papel na capacidade de serviços: PRODUCAO vende hora, COORDENACAO não. Regra por cargo.';
COMMENT ON COLUMN posto.papel_servico IS
  'Exceção por pessoa; NULL = siga o cargo. Não semear em massa: nulo é "herda".';

-- ── 2 · semeadura, UMA vez ──────────────────────────────────────────────
-- Só onde ainda está nulo: rodar de novo não desfaz ajuste manual.
-- ⚠ Alcança TODOS os cargos, não só os de serviços — o campo é barato e um
-- cargo pode migrar de área; o recorte de quem entra na conta é da tela.
UPDATE cargo SET papel_servico =
  CASE WHEN nome ~* '(COORDENADOR|GERENTE|DIRETOR|SUPERVISOR|HEAD)' THEN 'COORDENACAO'
       ELSE 'PRODUCAO' END
 WHERE papel_servico IS NULL;

-- ── 3 · a view, na MESMA migration (lição da v3_146/147) ────────────────
-- ⚠ Coluna nova em `posto` entra em `posto_v` aqui, no FIM da lista: é o único
-- jeito de acrescentar mantendo os GRANTs, sem janela sem permissão. Esquecer
-- isso deixou o Organograma em "Carregando…" para sempre em out/2026.
-- ⚠ A definição vai EXPLÍCITA, não injetada por regex sobre
-- `pg_get_viewdef`: hoje o `FROM` aparece uma vez só e a substituição
-- funcionaria, mas a próxima coluna com subconsulta quebraria em silêncio —
-- e o sintoma seria a view perdendo o recorte de escopo.
-- ⚠ Sem `security_invoker`, de propósito: com ele a view herdaria o
-- privilégio de coluna do chamador e mascararia o salário para todo mundo,
-- admin incluído. Rodando como dono, o recorte de linha vai no WHERE.
CREATE OR REPLACE VIEW posto_v AS
 SELECT id, tenant_id, codigo, cargo_id, empresa_id, filial_id, cc_id,
        sindicato_id, funcionario_id,
        CASE WHEN (SELECT pode_ver_folha()) THEN salario_base ELSE NULL::numeric END AS salario_base,
        ini_ano, ini_mes, fim_ano, fim_mes, fte, obs, ativo, regime, nome,
        matricula, recurso_cod, recebe_hora, reajuste_mes,
        CASE WHEN (SELECT pode_ver_folha()) THEN reajuste_pct ELSE NULL::numeric END AS reajuste_pct,
        CASE WHEN (SELECT pode_ver_folha()) THEN reajuste_valor ELSE NULL::numeric END AS reajuste_valor,
        afast_ini_ano, afast_ini_mes, afast_fim_ano, afast_fim_mes, afast_motivo,
        admissao, area_func_id, sit_folha, cargo_step_id,
        papel_servico                                   -- ← nova, no FIM
   FROM posto p
  WHERE tenant_id = (SELECT current_tenant_id())
    AND ((SELECT escopo_empresa_pessoas()) IS NULL
         OR empresa_id IS NOT NULL AND (empresa_id = ANY ((SELECT escopo_empresa_pessoas())::uuid[])))
    AND ((SELECT escopo_filial_pessoas()) IS NULL
         OR filial_id IS NOT NULL AND (filial_id = ANY ((SELECT escopo_filial_pessoas())::uuid[])))
    AND ((SELECT escopo_cc_pessoas()) IS NULL
         OR cc_id IS NOT NULL AND (cc_id = ANY ((SELECT escopo_cc_pessoas())::uuid[])));

-- ── 4 · GRANT por REGRA, não por lista (lição da v3_148) ────────────────
-- A lista fixa da v3_143 fazia toda coluna nova cair no balde dos negados por
-- omissão. Aqui: nega as três de remuneração, concede o resto — inclusive a
-- que acabou de nascer.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
            WHERE table_name = 'posto' AND table_schema = 'public'
              AND column_name NOT IN ('salario_base', 'reajuste_pct', 'reajuste_valor')
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON posto TO authenticated', c.column_name);
  END LOOP;
  -- escrita da coluna nova: a tela de postos ajusta a exceção
  EXECUTE 'GRANT UPDATE (papel_servico) ON posto TO authenticated';
  EXECUTE 'GRANT UPDATE (papel_servico) ON cargo TO authenticated';
END $$;

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO: quantos cargos de cada papel, o headcount que isso produz na
-- área 3 e o custo de 2027 — os números que o quadro vai mostrar.
SELECT '1·cargos por papel' AS secao,
       (SELECT string_agg(coalesce(papel_servico, '(nulo)') || ' = ' || n::text, ' · ' ORDER BY n DESC)
          FROM (SELECT papel_servico, count(*) n FROM cargo GROUP BY 1) x) AS resultado
UNION ALL
SELECT '2·posto.papel_servico preenchido (deve ser 0)',
       (SELECT count(*)::text FROM posto WHERE papel_servico IS NOT NULL)
UNION ALL
SELECT '3·papel efetivo na área 3 · 2027',
       (SELECT string_agg(papel || ': ' || pes::text || ' pessoas · R$ ' || to_char(custo, 'FM999G999G999'), '  |  ' ORDER BY papel)
          FROM (
            SELECT coalesce(p.papel_servico, c.papel_servico, '(sem cargo)') papel,
                   count(DISTINCT p.codigo) pes, sum(o.v) custo
              FROM posto p
              LEFT JOIN cargo c ON c.id = p.cargo_id
              LEFT JOIN centro_custo cc ON cc.id = p.cc_id
              JOIN LATERAL (SELECT coalesce(sum(-f.valor), 0) v FROM fat_orcado f
                             WHERE f.dims->>'posto' = p.codigo AND f.ano = 2027 AND f.origem = 'POSTO'
                               AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')) o ON true
             WHERE cc.codigo LIKE '3%' AND o.v > 0
             GROUP BY 1) y)
UNION ALL
SELECT '4·posto_v enxerga a coluna?',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'posto_v' AND column_name = 'papel_servico')
            THEN 'sim' ELSE '⛔ não — a tela ficaria cega' END
UNION ALL
SELECT '5·salário continua fechado na tabela?',
       CASE WHEN has_column_privilege('authenticated', 'posto', 'salario_base', 'SELECT')
            THEN '⛔ ABERTO' ELSE 'sim — o GRANT por regra não reabriu' END;
