-- ============================================================
-- v3_201 — terceiro papel: ESTRUTURA
--
-- A v3_199 nasceu com dois papéis e isso fundiu duas naturezas diferentes num
-- grupo só. O apontamento as separa sozinho, dentro do mesmo `COORDENACAO`:
--
--   Coordenador de Projetos      15 pessoas    99 h/mês    R$ 3.080.199
--   Coordenador de Projetos II    1              162 h     R$   179.602
--   Gerente de Projeto            4              100 h     R$   939.365
--   Gerente de Portfólio          1               14 h     R$   406.580
--   ─────────────────────────────────────────────────────────────────────
--   Diretor de Serviços           3             ZERO       R$ 1.189.366
--   Gerente Executivo de Projetos 5             ZERO       R$ 1.465.015
--
-- ⚠⚠ ZERO CONTRA 99 h/mês NÃO É GRADAÇÃO, É OUTRA COISA. Com os dois no mesmo
-- grupo a R$ 250/h, o quadro criaria **R$ 5,8 mi de capacidade que não
-- existe** — e o erro seria invisível, porque a conta fecharia.
--
-- Os três papéis e o que cada um faz:
--   PRODUCAO     analista, especialista, suporte, qualidade  → vende hora (200)
--   COORDENACAO  coordenador e gerente DE PROJETO            → vende hora (250)
--   ESTRUTURA    diretor, gerente executivo, de unidade      → não vende
-- `PRODUCAO` e `COORDENACAO` entram na capacidade e na margem DIRETA;
-- `ESTRUTURA` entra só na margem da ÁREA. A diferença entre as duas margens é
-- justamente o custo de quem não vende hora.
--
-- ⚠ Reclassifica só quem ainda está no valor semeado pela regra antiga: ajuste
-- manual feito entre a v3_199 e esta não é desfeito.
-- ⚠ `Gerente de Portfólio` (14 h/mês) é o caso de FRONTEIRA e fica em
-- COORDENACAO de propósito — ele aponta, ainda que pouco. Quem decide é o
-- dono da área, pela tela; a regra de nome não tem como saber.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1 · o CHECK passa a aceitar o terceiro valor ────────────────────────
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_papel_servico_check;
ALTER TABLE cargo ADD  CONSTRAINT cargo_papel_servico_check
  CHECK (papel_servico IN ('PRODUCAO', 'COORDENACAO', 'ESTRUTURA'));
ALTER TABLE posto DROP CONSTRAINT IF EXISTS posto_papel_servico_check;
ALTER TABLE posto ADD  CONSTRAINT posto_papel_servico_check
  CHECK (papel_servico IN ('PRODUCAO', 'COORDENACAO', 'ESTRUTURA'));

COMMENT ON COLUMN cargo.papel_servico IS
  'Papel na capacidade de serviços: PRODUCAO e COORDENACAO vendem hora (e entram na margem direta); ESTRUTURA não vende e entra só na margem da área.';

-- ── 2 · reclassificar a estrutura ───────────────────────────────────────
-- ⚠ `EXECUTIVO` sem `GERENTE` ao lado não bastaria, e `GERENTE` sozinho pegaria
-- o gerente de projeto — que vende hora. O que distingue é o par.
UPDATE cargo SET papel_servico = 'ESTRUTURA'
 WHERE papel_servico = 'COORDENACAO'
   AND (nome ~* 'DIRETOR'
     OR nome ~* 'GERENTE\s+EXECUTIVO'
     OR nome ~* 'SUPERVISOR'
     OR nome ~* 'HEAD');

-- ---------------- conferência ----------------
SELECT '1·cargos por papel' AS secao,
       (SELECT string_agg(coalesce(papel_servico, '(nulo)') || ' = ' || n::text, ' · ' ORDER BY n DESC)
          FROM (SELECT papel_servico, count(*) n FROM cargo GROUP BY 1) x) AS resultado
UNION ALL
SELECT '2·na área 3 · 2027 · pessoas · custo · h/mês medida',
       (SELECT string_agg(papel || ': ' || pes::text || 'p · R$ ' || to_char(custo, 'FM999G999G999')
                          || ' · ' || coalesce(round(hm)::text || 'h', 'sem apontamento'), E'\n                                                     ' ORDER BY papel)
          FROM (
            SELECT coalesce(p.papel_servico, c.papel_servico, 'SEM_PAPEL') papel,
                   count(DISTINCT p.codigo) pes, sum(x.v) custo, avg(h.hm) hm
              FROM posto p
              LEFT JOIN cargo c ON c.id = p.cargo_id
              LEFT JOIN centro_custo cc ON cc.id = p.cc_id
              LEFT JOIN (SELECT posto_id, avg(hm) hm FROM
                          (SELECT posto_id, ano, mes, sum(horas) hm FROM fat_apontamento
                            WHERE ano = 2026 AND NOT coalesce(intercambio, false) AND posto_id IS NOT NULL
                            GROUP BY 1, 2, 3) q GROUP BY 1) h ON h.posto_id = p.id
              JOIN LATERAL (SELECT coalesce(sum(-f.valor), 0) v FROM fat_orcado f
                             WHERE f.dims->>'posto' = p.codigo AND f.ano = 2027 AND f.origem = 'POSTO'
                               AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')) x ON true
             WHERE cc.codigo LIKE '3%' AND x.v > 0
             GROUP BY 1) y)
UNION ALL
SELECT '3·ESTRUTURA aponta? (deve ser ~zero)',
       (SELECT coalesce(round(avg(h.hm), 1)::text || ' h/mês', 'nenhuma hora')
          FROM posto p
          JOIN cargo c ON c.id = p.cargo_id
          LEFT JOIN centro_custo cc ON cc.id = p.cc_id
          LEFT JOIN (SELECT posto_id, avg(hm) hm FROM
                      (SELECT posto_id, ano, mes, sum(horas) hm FROM fat_apontamento
                        WHERE ano = 2026 AND NOT coalesce(intercambio, false) AND posto_id IS NOT NULL
                        GROUP BY 1, 2, 3) q GROUP BY 1) h ON h.posto_id = p.id
         WHERE cc.codigo LIKE '3%' AND coalesce(p.papel_servico, c.papel_servico) = 'ESTRUTURA');
