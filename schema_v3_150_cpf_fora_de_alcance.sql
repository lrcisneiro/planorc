-- ============================================================
-- v3_150 — Agora sim: o CPF fora do alcance da API
--
-- A v3_149 fez `REVOKE SELECT (cpf) ON funcionario` e **não teve efeito**, como
-- a própria conferência dela mostrou. Motivo: existe um `GRANT SELECT` de
-- TABELA INTEIRA para `authenticated`, e enquanto ele existe, revogar uma
-- coluna não tira nada — o privilégio amplo continua cobrindo todas.
--
-- É exatamente o mecanismo que a v3_143 já tinha enfrentado em `posto`: lá eu
-- revoguei a tabela primeiro e concedi coluna a coluna. Aqui esqueci, e a
-- conferência pegou. Vale a lição: **`REVOKE` de coluna só funciona depois de
-- tirar o `GRANT` de tabela.**
--
-- Como na v3_148, o privilégio vai por REGRA e não por lista: nega o que É
-- sensível, concede o resto. Re-executável — rodar de novo depois de
-- acrescentar coluna regulariza; rodar à toa não faz nada.
--
-- ⚠ Consequência para quem escreve tela: `select('*')` em `funcionario` passa a
-- FALHAR, porque `*` expande para todas as colunas, `cpf` inclusive. Isso é
-- recurso, não defeito — a quebra é visível e imediata, em vez de o CPF vazar
-- calado para qualquer consulta que pedisse tudo. A aba Cadastros → Funcionários
-- foi ajustada para listar as colunas.
--
-- INSERT/UPDATE seguem: `importar_funcionarios` grava o CPF (e roda como DEFINER
-- de qualquer forma). Gravar não é ler.
--
-- Termina em SELECT.
-- ============================================================

REVOKE SELECT ON funcionario FROM authenticated;

DO $$
DECLARE c record; sensiveis text[] := ARRAY['cpf'];
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'funcionario'
              AND NOT (column_name = ANY(sensiveis))
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON funcionario TO authenticated', c.column_name);
  END LOOP;
END $$;

SELECT 'colunas de funcionario SEM select (esperado: cpf)' AS secao,
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma') AS resultado
  FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='funcionario'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name='funcionario' AND g.column_name=c.column_name
                      AND g.grantee='authenticated' AND g.privilege_type='SELECT')
UNION ALL
SELECT 'select de TABELA ainda concedido?',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants
                          WHERE table_name='funcionario' AND grantee='authenticated'
                            AND privilege_type='SELECT')
            THEN '⛔ sim — o revoke de coluna não vale' ELSE 'não (correto)' END;
