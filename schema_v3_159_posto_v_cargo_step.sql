-- ============================================================
-- v3_159 — `posto_v` enxerga `cargo_step_id`
--
-- Segunda ponta da coluna nova (regra da v3_147): as telas de Postos leem a
-- VIEW, não a tabela, e a view lista colunas uma a uma — coluna que não entra
-- aqui não existe para elas.
--
-- `CREATE OR REPLACE` com a coluna no FIM, que é o único jeito de acrescentar
-- mantendo os GRANTs: sem janela sem permissão e sem risco de esquecer de
-- reconceder.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE VIEW posto_v AS
SELECT p.id, p.tenant_id, p.codigo, p.cargo_id, p.empresa_id, p.filial_id, p.cc_id,
       p.sindicato_id, p.funcionario_id,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.salario_base   END AS salario_base,
       p.ini_ano, p.ini_mes, p.fim_ano, p.fim_mes, p.fte, p.obs, p.ativo, p.regime,
       p.nome, p.matricula, p.recurso_cod, p.recebe_hora, p.reajuste_mes,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_pct   END AS reajuste_pct,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_valor END AS reajuste_valor,
       p.afast_ini_ano, p.afast_ini_mes, p.afast_fim_ano, p.afast_fim_mes,
       p.afast_motivo, p.admissao,
       p.area_func_id,   -- v3_147
       p.sit_folha,      -- v3_152
       p.cargo_step_id   -- v3_159: no FIM, para o REPLACE manter os GRANTs
  FROM posto p
 WHERE p.tenant_id = (SELECT current_tenant_id())
   AND ((SELECT escopo_empresa()) IS NULL
        OR (p.empresa_id IS NOT NULL AND p.empresa_id = ANY((SELECT escopo_empresa())::uuid[])))
   AND ((SELECT escopo_filial()) IS NULL
        OR (p.filial_id IS NOT NULL AND p.filial_id = ANY((SELECT escopo_filial())::uuid[])))
   AND ((SELECT escopo_cc()) IS NULL
        OR (p.cc_id IS NOT NULL AND p.cc_id = ANY((SELECT escopo_cc())::uuid[])));

SELECT 'cargo_step_id em posto_v' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='posto_v' AND column_name='cargo_step_id')
            THEN 'sim' ELSE '⛔ não' END AS resultado
UNION ALL
SELECT 'colunas de posto sem SELECT (esperado: as 3 de remuneração)',
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma')
  FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='posto'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name='posto' AND g.column_name=c.column_name
                      AND g.grantee='authenticated' AND g.privilege_type='SELECT');
