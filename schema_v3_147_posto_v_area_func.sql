-- ============================================================
-- v3_147 — `posto_v` precisa enxergar `area_func_id`
--
-- A v3_146 adicionou a coluna em `posto` e esqueceu a view. Como `posto_v`
-- lista as colunas uma a uma (de propósito: coluna nova não vaza calada), ela
-- não tinha `area_func_id` — e as sete telas de Postos leem a VIEW, não a
-- tabela. Resultado: o Organograma pedia uma coluna inexistente, a consulta
-- falhava, e a tela ficava em "Carregando…" para sempre com tudo zerado.
--
-- A própria v3_142 avisava que isto aconteceria. O aviso estava certo; faltou
-- eu aplicá-lo na migration seguinte.
--
-- ⚠ REGRA, daqui em diante: **toda coluna nova em `posto` entra em `posto_v` na
-- MESMA migration.** A escolha de listar colunas (em vez de `SELECT *`) troca
-- vazamento silencioso por quebra visível — e vale a troca, mas só se quem
-- adiciona coluna lembrar das duas pontas.
--
-- `CREATE OR REPLACE VIEW` e não `DROP`+`CREATE`: REPLACE permite acrescentar
-- coluna **no fim** mantendo os GRANTs, então não há janela sem permissão nem
-- risco de esquecer de reconceder. Por isso `area_func_id` vai no fim, mesmo
-- não sendo onde ela "caberia" logicamente.
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
       p.area_func_id   -- v3_147: no FIM, para o REPLACE manter os GRANTs
  FROM posto p
 WHERE p.tenant_id = (SELECT current_tenant_id())
   AND ((SELECT escopo_empresa()) IS NULL
        OR (p.empresa_id IS NOT NULL AND p.empresa_id = ANY((SELECT escopo_empresa())::uuid[])))
   AND ((SELECT escopo_filial()) IS NULL
        OR (p.filial_id IS NOT NULL AND p.filial_id = ANY((SELECT escopo_filial())::uuid[])))
   AND ((SELECT escopo_cc()) IS NULL
        OR (p.cc_id IS NOT NULL AND p.cc_id = ANY((SELECT escopo_cc())::uuid[])));

-- Conferência: a view tem a coluna nova, e as três sensíveis seguem fora do
-- alcance direto na tabela (o REPLACE não mexeu nos privilégios de coluna).
SELECT 'area_func_id em posto_v' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='posto_v' AND column_name='area_func_id')
            THEN 'sim' ELSE '⛔ não' END AS resultado
UNION ALL
SELECT 'colunas de posto sem SELECT p/ authenticated',
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma')
  FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='posto'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name='posto' AND g.column_name=c.column_name
                      AND g.grantee='authenticated' AND g.privilege_type='SELECT')
UNION ALL
SELECT 'SELECT em posto_v p/ authenticated',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants
                          WHERE table_name='posto_v' AND grantee='authenticated'
                            AND privilege_type='SELECT')
            THEN 'mantido' ELSE '⛔ perdido — reconceder' END;
