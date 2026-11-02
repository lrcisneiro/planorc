-- ============================================================
-- v3_139 — Apagar as negações que o padrão novo tornou redundantes
--
-- ⚠ RODAR DEPOIS DO DEPLOY da v3_138, nunca antes. A ordem é o ponto:
-- o padrão novo vive no CÓDIGO e só vale quando o build sobe. Apagar as
-- negações da Andrea antes disso a deixaria, na janela entre as duas coisas,
-- com o acesso ANTIGO de member — tudo liberado.
--
-- Por que apagar: com `member` já nascendo fechado nestas 12, a negação
-- explícita não muda nada hoje — e amanhã mente. Se alguém reabrir o padrão,
-- a Andrea continua negada por um override que ninguém lembra de ter posto, e
-- o motivo não está em lugar nenhum. Uma verdade só: o padrão é a regra, o
-- override é a exceção, e exceção que repete a regra não é exceção.
--
-- Mexe só em negação (permitido = false) e só nas 12 chaves viradas. O que
-- alguém liberou de propósito fica.
--
-- Termina em SELECT.
-- ============================================================

DELETE FROM user_acesso_funcao f
 USING user_tenant ut
 WHERE ut.tenant_id = f.tenant_id
   AND ut.user_id   = f.user_id
   AND ut.role      = 'member'
   AND f.permitido  = false
   AND f.capacidade IN ('apontamento.importar','dash.anual','dash.cagr','dash.indicadores',
                        'formulario.importar','indicador.meta','menu.amarracao','menu.cadastros',
                        'menu.formularios','menu.orcamento','menu.realizado','menu.saldos');

-- O que sobrou de override, por pessoa. Esperado: nenhuma negação nas 12 acima.
SELECT split_part(u.email,'@',1) AS quem,
       ut.role                   AS papel,
       count(*) FILTER (WHERE f.permitido)       AS liberados,
       count(*) FILTER (WHERE NOT f.permitido)   AS negados
  FROM user_tenant ut
  LEFT JOIN user_acesso_funcao f ON f.user_id = ut.user_id AND f.tenant_id = ut.tenant_id
  LEFT JOIN auth.users u ON u.id = ut.user_id
 GROUP BY 1, 2 ORDER BY 2, 1;
