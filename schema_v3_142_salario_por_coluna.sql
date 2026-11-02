-- ============================================================
-- v3_142 — Salário deixa de ser legível por quem vê o posto
--
-- O PROBLEMA: RLS limita LINHA, não COLUNA. Quem pode ver um posto podia pedir
-- `salario_base` à API, independente do que a tela mostra — e as telas já se
-- comportavam: das sete leituras de `posto` no frontend, cinco pedem colunas
-- explícitas e nenhuma pedia salário. O furo nunca foi a tela, era a API.
--
-- POR QUE NÃO DÁ COM GRANT SOZINHO: existe um papel só (`authenticated`) para
-- todas as pessoas, então privilégio de coluna não distingue quem é quem. A
-- distinção precisa estar em função, lida em tempo de consulta.
--
-- ⚠ TRÊS PASSOS, e a ordem é o ponto (de novo): esta migration só ADICIONA —
-- cria a função e a view, sem tirar nada. Depois vem o DEPLOY, que faz as telas
-- lerem a view. Só então a `v3_143` tira o SELECT de `posto`. Fazer o REVOKE
-- antes do deploy derruba Quadro e Memória, que hoje leem `select('*')` da
-- tabela; fazer o deploy antes da view derruba as sete telas de Postos.
--
-- COMO FICA, em duas peças que se sustentam:
--   1. `GRANT SELECT` passa a ser POR COLUNA em `posto`, sem as três sensíveis
--      (`salario_base`, `reajuste_pct`, `reajuste_valor`). Pedir uma delas
--      direto na tabela agora dá ERRO — não devolve nulo em silêncio, o que
--      importa: quem tenta, descobre que tentou.
--   2. A view `posto_v` devolve as três **mascaradas por `pode_ver_folha()`**.
--      É por onde o frontend lê.
--
-- ⚠ A view roda como DONO (sem `security_invoker`), e tem de ser assim: com
-- `security_invoker` ela herdaria o privilégio de coluna do chamador e ficaria
-- sem acesso ao salário também — mascararia para todo mundo, inclusive admin.
-- Rodando como dono, o RLS de `posto` NÃO se aplica, então o recorte de linha
-- vai EXPLÍCITO no WHERE da view, com as mesmas funções da política
-- (`escopo_empresa/filial/cc`). O que se repete é a forma do predicado, três
-- linhas; a regra continua morando só em `escopo_dim()`. Mexer no escopo muda
-- os dois juntos, porque os dois chamam a mesma coisa.
--
-- A view lista as colunas uma a uma de propósito: coluna nova em `posto` não
-- aparece nela, e a tela quebra à vista — melhor que vazar em silêncio.
--
-- QUEM VÊ SALÁRIO: admin sempre; demais por `user_acesso_funcao`
-- ('posto.salario'); sem override, `member` vê e `viewer` não. Esses três
-- booleanos repetem o `padrao` do catálogo em `lib/capacidades.ts` — repetição
-- deliberada e a única do tipo: para ser decisão de segurança ela tem de ser
-- tomada no banco, e o catálogo não existe aqui. Se mudar lá, mudar aqui.
--
-- Termina em SELECT. Prova (depois da v3_143) em `prova_posto_salario.sql`.
-- ============================================================

CREATE OR REPLACE FUNCTION pode_ver_folha() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT eh_admin() OR coalesce(
    -- override explícito decide, liberando ou negando
    (SELECT f.permitido FROM user_acesso_funcao f
      WHERE f.user_id = auth.uid() AND f.capacidade = 'posto.salario' LIMIT 1),
    -- sem override: member vê, viewer não
    EXISTS (SELECT 1 FROM user_tenant ut
             WHERE ut.user_id = auth.uid() AND ut.role = 'member')
  )
$$;

DROP VIEW IF EXISTS posto_v;
CREATE VIEW posto_v AS
SELECT p.id, p.tenant_id, p.codigo, p.cargo_id, p.empresa_id, p.filial_id, p.cc_id,
       p.sindicato_id, p.funcionario_id,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.salario_base   END AS salario_base,
       p.ini_ano, p.ini_mes, p.fim_ano, p.fim_mes, p.fte, p.obs, p.ativo, p.regime,
       p.nome, p.matricula, p.recurso_cod, p.recebe_hora, p.reajuste_mes,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_pct   END AS reajuste_pct,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_valor END AS reajuste_valor,
       p.afast_ini_ano, p.afast_ini_mes, p.afast_fim_ano, p.afast_fim_mes,
       p.afast_motivo, p.admissao
  FROM posto p
 WHERE p.tenant_id = (SELECT current_tenant_id())
   AND ((SELECT escopo_empresa()) IS NULL
        OR (p.empresa_id IS NOT NULL AND p.empresa_id = ANY((SELECT escopo_empresa())::uuid[])))
   AND ((SELECT escopo_filial()) IS NULL
        OR (p.filial_id IS NOT NULL AND p.filial_id = ANY((SELECT escopo_filial())::uuid[])))
   AND ((SELECT escopo_cc()) IS NULL
        OR (p.cc_id IS NOT NULL AND p.cc_id = ANY((SELECT escopo_cc())::uuid[])));

GRANT SELECT ON posto_v TO authenticated;

-- NÃO revoga nada aqui: o REVOKE vive na v3_143, para rodar DEPOIS do deploy.
-- Esta migration é puramente aditiva — o frontend em produção, que ainda lê
-- `posto` direto, continua funcionando.
SELECT 'view posto_v' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE viewname='posto_v')
            THEN 'criada — pode fazer o deploy' ELSE '⛔ não criada' END AS resultado
UNION ALL
SELECT 'mascara o salário?',
       CASE WHEN pg_get_viewdef('posto_v'::regclass) LIKE '%pode_ver_folha%'
            THEN 'sim' ELSE '⛔ não' END;
