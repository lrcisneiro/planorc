-- ============================================================
-- v3_140 — Um papel por pessoa, por tenant (só a trava)
--
-- NÃO há duplicata hoje: cada pessoa tem uma linha. O que não há é o que
-- IMPEDE de ter. `user_tenant` não tem unique por (tenant_id, user_id), e o
-- código inteiro — 7 pontos — pergunta "qual o papel desta pessoa?" esperando
-- uma resposta só. Trocar papel por INSERT em vez de UPDATE criaria duas
-- linhas, e aí qual delas vale passa a ser escolha do plano de execução: a
-- mesma pessoa abriria como admin numa sessão e viewer na outra, enquanto o
-- banco responde pelo mais privilegiado (`eh_admin()` é EXISTS). Frontend e
-- banco discordando sobre quem a pessoa é — e sem erro nenhum para avisar.
--
-- Não apaga nada. Se falhar, é porque a duplicata já existe — e então o
-- diagnóstico abaixo mostra quem, para decidir à mão qual linha fica.
--
-- Termina em SELECT.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_tenant_pessoa
  ON user_tenant (tenant_id, user_id);

SELECT u.email                AS quem,
       ut.role                AS papel,
       count(*) OVER (PARTITION BY ut.tenant_id, ut.user_id) AS linhas_da_pessoa
  FROM user_tenant ut
  LEFT JOIN auth.users u ON u.id = ut.user_id
 ORDER BY 2, 1;
