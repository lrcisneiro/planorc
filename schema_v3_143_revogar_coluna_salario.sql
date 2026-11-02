-- ============================================================
-- v3_143 — Tirar o SELECT de coluna que a view substituiu
--
-- ⚠ RODAR DEPOIS DO DEPLOY da v3_142. Até o build subir, as telas Quadro e
-- Memória leem `select('*')` de `posto`; sem o SELECT de tabela elas quebram.
-- Com o deploy no ar, elas leem `posto_v` e isto aqui passa a ser invisível —
-- exceto para quem tentar pedir salário pela API, que é o ponto.
--
-- Por que REVOKE e não só a view: sem isto a view é decoração. Quem conhece a
-- API pede `posto?select=salario_base` e recebe.
--
-- INSERT/UPDATE/DELETE ficam como estão: escrever salário continua podendo,
-- sob as políticas de escrita. Gravar não é ler.
--
-- Termina em SELECT. Depois, rodar `prova_posto_salario.sql`.
-- ============================================================

REVOKE SELECT ON posto FROM authenticated;
GRANT SELECT (
  id, tenant_id, codigo, cargo_id, empresa_id, filial_id, cc_id, sindicato_id,
  funcionario_id, ini_ano, ini_mes, fim_ano, fim_mes, fte, obs, ativo, regime,
  nome, matricula, recurso_cod, recebe_hora, reajuste_mes,
  afast_ini_ano, afast_ini_mes, afast_fim_ano, afast_fim_mes, afast_motivo, admissao
) ON posto TO authenticated;

SELECT 'colunas de posto SEM select p/ authenticated' AS secao,
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma') AS resultado
  FROM information_schema.columns c
 WHERE c.table_schema = 'public' AND c.table_name = 'posto'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name = 'posto' AND g.column_name = c.column_name
                      AND g.grantee = 'authenticated' AND g.privilege_type = 'SELECT');
