-- O que cada pessoa tem de override de capacidade, e com que papel.
-- Serve para decidir o que vira PADRÃO do papel (em lib/capacidades.ts) e,
-- portanto, pode sair da tabela de override.
-- Sem filtro por tenant: no SQL Editor current_tenant_id() é NULL.
SELECT
  ut.role                                   AS papel,
  split_part(u.email, '@', 1)               AS quem,
  f.capacidade,
  CASE WHEN f.permitido THEN 'LIBERADO (override)' ELSE 'NEGADO (override)' END AS override,
  -- quantas outras pessoas do MESMO papel não têm override nesta capacidade,
  -- isto é, quantas seriam afetadas se o padrão do papel mudasse
  (SELECT count(*) FROM user_tenant ut2
    WHERE ut2.role = ut.role
      AND ut2.user_id <> f.user_id
      AND NOT EXISTS (SELECT 1 FROM user_acesso_funcao f2
                       WHERE f2.user_id = ut2.user_id AND f2.capacidade = f.capacidade)
  )                                         AS outros_do_papel_no_padrao
FROM user_acesso_funcao f
JOIN user_tenant ut ON ut.user_id = f.user_id
LEFT JOIN auth.users u ON u.id = f.user_id
ORDER BY ut.role, quem, f.permitido DESC, f.capacidade;
