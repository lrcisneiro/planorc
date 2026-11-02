-- Devolver a conta de teste `member` ao padrão novo.
--
-- A v3_138 preservou o acesso de TODO member sem override — o que inclui a
-- conta de teste. Correto para gente de verdade (ninguém perde acesso sem
-- decisão), mas para a conta de teste é o contrário do que ela serve: com os
-- 12 liberados explicitamente, ela deixa de mostrar o que um member NOVO vê.
--
-- A conta é `lrcisneiro@totvs.com.br` (member de teste). Ela tinha 10 liberações
-- postas de propósito para testar; só apaga as 12 que a v3_138 inseriu, então
-- aquelas 10 ficam.
--
-- ⚠ RODAR DEPOIS DO DEPLOY, junto da v3_139 — antes dele o padrão novo não
-- existe e a conta ficaria com MENOS que um member novo.
--
-- Termina em SELECT.
-- ============================================================
DELETE FROM user_acesso_funcao f
 USING auth.users u
 WHERE u.id = f.user_id
   AND u.email = 'lrcisneiro@totvs.com.br'      -- member de teste
   AND f.permitido
   AND f.capacidade IN ('apontamento.importar','dash.anual','dash.cagr','dash.indicadores',
                        'formulario.importar','indicador.meta','menu.amarracao','menu.cadastros',
                        'menu.formularios','menu.orcamento','menu.realizado','menu.saldos');

SELECT u.email, ut.role AS papel,
       count(*) FILTER (WHERE f.permitido)     AS liberados,
       count(*) FILTER (WHERE NOT f.permitido) AS negados
  FROM user_tenant ut
  LEFT JOIN user_acesso_funcao f ON f.user_id = ut.user_id AND f.tenant_id = ut.tenant_id
  LEFT JOIN auth.users u ON u.id = ut.user_id
 GROUP BY 1,2 ORDER BY 2,1;
