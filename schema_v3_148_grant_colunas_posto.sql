-- ============================================================
-- v3_148 — O GRANT de coluna de `posto` passa a ser por REGRA, não por lista
--
-- A v3_143 concedeu `SELECT` coluna a coluna numa lista escrita à mão. Isso
-- fez o recorte funcionar, mas deixou uma armadilha: **toda coluna nova cai no
-- balde dos negados por omissão**, sem erro e sem aviso. Foi o que aconteceu
-- com `area_func_id` (v3_146) — ninguém negou, ela só não estava na lista.
--
-- Hoje isso é inofensivo porque as telas leem `posto_v` (que roda como dono) e
-- escrever não exige `SELECT` na coluna escrita. Mas é estado acidental: daqui
-- a seis meses alguém lê a lista de negados, vê `area_func_id` ali e conclui
-- que é sensível. E a primeira consulta que ler `posto` direto quebra.
--
-- A regra inverte a lógica: nega-se o que É sensível, concede-se o resto.
-- É RE-EXECUTÁVEL de propósito — rodar de novo depois de acrescentar coluna em
-- `posto` basta para regularizar, e rodar sem necessidade não faz nada.
--
-- ⚠ Isto NÃO substitui atualizar `posto_v` (v3_147): são as duas pontas da
-- mesma escolha. O GRANT diz o que pode ser lido na tabela; a view diz o que as
-- telas enxergam.
--
-- Termina em SELECT.
-- ============================================================

DO $$
DECLARE c record; sensiveis text[] := ARRAY['salario_base','reajuste_pct','reajuste_valor'];
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'posto'
              AND NOT (column_name = ANY(sensiveis))
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON posto TO authenticated', c.column_name);
  END LOOP;
  -- Garante que as sensíveis continuam fora, mesmo que algum GRANT de tabela
  -- tenha sido reaplicado por outra migration no meio do caminho.
  FOR c IN SELECT unnest(sensiveis) AS column_name LOOP
    EXECUTE format('REVOKE SELECT (%I) ON posto FROM authenticated', c.column_name);
  END LOOP;
END $$;

SELECT 'negadas (esperado: as 3 de remuneração)' AS secao,
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma') AS resultado
  FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='posto'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name='posto' AND g.column_name=c.column_name
                      AND g.grantee='authenticated' AND g.privilege_type='SELECT')
UNION ALL
SELECT 'concedidas', count(*)::text
  FROM information_schema.column_privileges g
 WHERE g.table_name='posto' AND g.grantee='authenticated' AND g.privilege_type='SELECT';
