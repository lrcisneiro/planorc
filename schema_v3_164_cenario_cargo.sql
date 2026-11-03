-- ============================================================
-- v3_164 — O cenário passa a decidir CARGO
--
-- A v3_120 deixou cargo fora de propósito: era FATO, do cadastro. Mas o fluxo
-- de aprovação mudou a conta. **Promover é reajuste MAIS cargo**, e com a
-- edição do cadastro fechada para o gerente de área (`posto.cadastro.editar`,
-- nov/2026) a metade do cargo ficaria sem lugar — obrigando a reabrir
-- exatamente a porta que acabamos de fechar.
--
-- Então cargo vira decisão de planejamento, como salário. O que continua sendo
-- fato e mora só no mestre: nome, matrícula, admissão, regime, sindicato,
-- empresa/filial/CC, recurso_cod, benefícios e rateio.
--
-- ⚠ Risco baixo no motor: `calcularPosto` usa `posto.salario_base`, não o
-- cargo. O `salario_ref` do cargo é referência para quem decide, não entrada de
-- cálculo — e a tela SUGERE o valor ao trocar, sem preencher calado: aplicar
-- automático decidiria pelo gerente.
--
-- ⚠ Quem lê o cargo do POSTO tem de ler por `cargo_id` resolvido, não pelo
-- embed `cargo(nome)` da consulta: o embed vem do mestre e não enxerga a
-- sobreposição. Três pontos da grade liam o embed e foram corrigidos.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE posto_versao ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES cargo(id) ON DELETE SET NULL;

SELECT 'cargo_id em posto_versao' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='posto_versao' AND column_name='cargo_id')
            THEN 'sim' ELSE '⛔ não' END AS resultado
UNION ALL SELECT 'sobreposições existentes (não mudam)',
  (SELECT count(*)::text FROM posto_versao)
UNION ALL SELECT 'dessas, já decidindo cargo (esperado: 0)',
  (SELECT count(*)::text FROM posto_versao WHERE cargo_id IS NOT NULL);
