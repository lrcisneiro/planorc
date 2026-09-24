-- ============================================================
-- PASSO 1 — Quem é admin hoje, e quem consegue virar
-- Requisitos: ACS-03 (adulteração de campos), ACS-04 (menor privilégio), AUT-09 (MFA)
--
-- POR QUE ESTE É O PRIMEIRO PASSO
--
-- "Ligar MFA para admins" não significa nada enquanto não se souber quem é
-- admin. E "o escopo de dados protege a folha" não significa nada se o próprio
-- usuário puder reescrever o seu papel — nesse caso não há política de acesso
-- que resista, porque a vítima e o atacante são a mesma pessoa.
--
-- E há um motivo específico para começar pela conferência em vez de pela
-- correção: `user_tenant` e `user_acesso_regra` NÃO são criadas por nenhuma
-- migration desta pasta. Não existe CREATE TABLE, nem ENABLE ROW LEVEL
-- SECURITY, nem CREATE POLICY para elas no repositório — vieram do painel ou
-- de uma migration que não está versionada aqui. Ou seja: as duas tabelas que
-- governam permissão são exatamente as que não dá para auditar lendo código.
-- Só o banco responde.
--
-- Como referência do que é "certo", o repositório já tem um bom modelo: a
-- v3_046 protegeu `user_acesso_funcao` com duas políticas — o usuário lê só as
-- próprias linhas, e só admin escreve. É essa forma que as consultas abaixo
-- procuram nas outras duas.
--
-- Rode inteiro no SQL Editor do Supabase. As partes 1 a 4 são leitura pura.
-- A parte 5 escreve dentro de uma transação que termina em ROLLBACK.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. RLS está ligado nessas três tabelas?
-- ════════════════════════════════════════════════════════════
-- rls_ligado = false em user_tenant é o pior cenário possível: com o GRANT que
-- o papel `authenticated` costuma ter, qualquer usuário logado lê e escreve a
-- tabela inteira de papéis.
SELECT c.relname                AS tabela,
       c.relrowsecurity         AS rls_ligado,
       c.relforcerowsecurity    AS rls_forcado,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('user_tenant', 'user_acesso_regra', 'user_acesso_funcao')
 ORDER BY 1;


-- ════════════════════════════════════════════════════════════
-- 2. O texto das políticas que existem
-- ════════════════════════════════════════════════════════════
-- Leia com esta pergunta: a política de ESCRITA exige ser admin?
-- Uma política `FOR ALL USING (tenant_id = current_tenant_id())` — que é o
-- padrão usado nas tabelas de dados deste sistema — seria CORRETA para
-- `empresa` e DESASTROSA aqui: ela autoriza o próprio usuário a dar
-- UPDATE no seu papel.
SELECT tablename AS tabela, policyname AS politica, cmd AS comando,
       roles::text AS papeis, qual AS using_, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('user_tenant', 'user_acesso_regra', 'user_acesso_funcao')
 ORDER BY tablename, cmd, policyname;


-- ════════════════════════════════════════════════════════════
-- 3. Que privilégios os papéis do Supabase têm nessas tabelas
-- ════════════════════════════════════════════════════════════
-- Espera-se `anon` sem NADA (a v3_060 revogou, e o teste anônimo confirmou).
-- `authenticated` com UPDATE em user_tenant só é seguro se a política de
-- escrita exigir admin — é a combinação das duas coisas que decide.
SELECT table_name AS tabela, grantee AS papel,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('user_tenant', 'user_acesso_regra', 'user_acesso_funcao')
   AND grantee IN ('anon', 'authenticated')
 GROUP BY 1, 2 ORDER BY 1, 2;


-- ════════════════════════════════════════════════════════════
-- 4. Quem é admin hoje
-- ════════════════════════════════════════════════════════════
-- A migration v3_060 inseriu TODOS os usuários de auth.users como 'admin'
-- (era single-tenant e a intenção era destravar o acesso). Quem entrou depois,
-- pela Edge Function criar-usuario, entra como 'member'. Então a lista abaixo
-- é metade herança e metade decisão — e ninguém revisou qual é qual.
SELECT u.email,
       ut.role                          AS papel,
       u.created_at::date               AS criado_em,
       u.last_sign_in_at::date          AS ultimo_acesso,
       (u.confirmed_at IS NOT NULL)     AS confirmado,
       (SELECT count(*) FROM user_acesso_regra r WHERE r.user_id = u.id) AS regras_de_escopo
  FROM user_tenant ut
  JOIN auth.users u ON u.id = ut.user_id
 ORDER BY ut.role, u.email;

-- Resumo: quantos de cada papel
SELECT role AS papel, count(*) AS usuarios
  FROM user_tenant GROUP BY 1 ORDER BY 2 DESC;


-- ════════════════════════════════════════════════════════════
-- 5. O TESTE QUE DECIDE — um usuário comum consegue virar admin?
-- ════════════════════════════════════════════════════════════
-- Nenhuma leitura de política substitui isto: o Postgres é quem sabe.
-- A transação assume a identidade de um usuário real e tenta a escalada; o
-- ROLLBACK no fim desfaz tudo, inclusive se a tentativa der certo.
--
-- ANTES DE RODAR: troque os dois <UUID> pelo id de um usuário que NÃO deveria
-- ser admin (pegue na consulta 4; se hoje todos forem admin, use o de menor
-- privilégio pretendido). Os dois têm de ser o MESMO id.

BEGIN;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<UUID>', 'role', 'authenticated')::text,
  true);

-- 5.1 Ele enxerga o papel dos OUTROS?
--     Esperado: 1 (só a própria linha). Mais que isso = vazamento de quem é
--     admin, que é o mapa de quem atacar.
SELECT count(*) AS linhas_de_user_tenant_visiveis FROM user_tenant;

-- 5.2 Ele enxerga a regra de escopo dos outros?
--     Importante além da segurança: o hook useUserAccess lê
--     `user_acesso_regra` SEM filtrar por user_id. Se esta conta vier > 1, o
--     usuário não só vê a regra alheia como pode acabar HERDANDO ela na tela.
SELECT count(*) AS linhas_de_user_acesso_regra_visiveis FROM user_acesso_regra;

-- 5.3 A escalada. Se o UPDATE afetar 1 linha, está provado: qualquer usuário
--     logado vira admin com uma chamada de API, e todo o resto do plano de
--     segurança perde o sentido enquanto isto estiver aberto.
UPDATE user_tenant SET role = 'admin' WHERE user_id = '<UUID>';
--     Leia o "UPDATE n" no retorno: n = 0 → bloqueado (bom). n = 1 → ESCALADA.

-- 5.4 E conceder escopo a si mesmo?
INSERT INTO user_acesso_regra (user_id, tenant_id, dimensao, escopo, valor_ids, negados)
VALUES ('<UUID>', '11111111-1111-1111-1111-111111111111', 'centro_custo', 'VER', '{}', '{}');
--     n = 1 → o usuário escreve a própria permissão.

ROLLBACK;   -- <<< desfaz tudo. Confirme que a mensagem "ROLLBACK" apareceu.


-- ════════════════════════════════════════════════════════════
-- 6. Confirmação pós-teste — nada ficou gravado
-- ════════════════════════════════════════════════════════════
-- Paranoia barata: repete a contagem de papéis. Tem de bater com a consulta 4.
SELECT role AS papel, count(*) AS usuarios
  FROM user_tenant GROUP BY 1 ORDER BY 2 DESC;
