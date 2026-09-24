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
-- COMO RODAR: as partes 1 a 4 são leitura pura — pode rodar de uma vez.
-- A parte 5 personifica um usuário e escreve dentro de uma transação que
-- termina em ROLLBACK; ela pede que você troque um e-mail em dois lugares, e
-- por isso vai SELECIONADA e rodada à parte. Rodar o arquivo inteiro de uma
-- vez só falha no placeholder — de propósito, para não rodar sem escolher.
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
-- Nenhuma leitura de política substitui isto: quem sabe se a policy barra é o
-- Postgres.
--
-- COMO RODAR: primeiro troque `troque@pelo.email` em TODO o arquivo (o
-- localizar-e-substituir do editor resolve de uma vez). Depois rode os blocos
-- 5.0, 5.A, 5.B e 5.C UM DE CADA VEZ, selecionando cada um.
--
-- Por que um de cada vez: o editor do Supabase mostra só o retorno da última
-- instrução, e um erro no meio aborta o resto. Os blocos de escrita (5.B e
-- 5.C) por isso devolvem a resposta como EXCEÇÃO — em editor de SQL a exceção
-- é a única saída que sempre aparece, e ela ainda garante o rollback de
-- brinde. Ver "ERROR" ali é o funcionamento normal, não falha.
--
-- Escolha um usuário que NÃO deveria ser admin. Se hoje todos forem admin,
-- use o de menor privilégio pretendido: o que se mede é se a POLÍTICA barra,
-- não se a pessoa já é admin.


-- ── 5.0 · leitura ─────────────────────────────────────────────
-- O e-mail existe? Se vier vazio, PARE: os blocos seguintes rodariam com
-- identidade nula e devolveriam "tudo bloqueado" sem ter testado nada.
SELECT u.id, u.email, ut.role AS papel_atual
  FROM auth.users u
  LEFT JOIN user_tenant ut ON ut.user_id = u.id
 WHERE u.email = 'troque@pelo.email';


-- ── 5.A · leitura, personificando ─────────────────────────────
-- Responde três coisas de uma vez. `quem_sou_eu` NULL invalida tudo.
-- user_tenant: esperado 1 (só a própria linha). Mais = vazamento de quem é
-- admin, que é o mapa de quem atacar.
-- user_acesso_regra: além da segurança, o hook useUserAccess lê essa tabela
-- SEM filtrar por user_id — se vier > 1, o usuário pode HERDAR regra alheia.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'troque@pelo.email'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT auth.uid()                              AS quem_sou_eu,
       (SELECT count(*) FROM user_tenant)       AS ve_linhas_de_user_tenant,
       (SELECT count(*) FROM user_acesso_regra) AS ve_linhas_de_user_acesso_regra,
       (SELECT count(*) FROM user_acesso_funcao) AS ve_linhas_de_user_acesso_funcao;
ROLLBACK;


-- ── 5.B · A ESCALADA (resposta vem como ERROR, é esperado) ────
-- Leia a mensagem:
--   "afetou 0 linha(s)"      → a política barrou. É o resultado bom.
--   "afetou 1 linha(s)"      → ESCALADA PROVADA: qualquer usuário logado vira
--                              admin por uma chamada de API. Passa na frente
--                              de todo o resto do plano, inclusive do ACS-02.
--   "violates row-level..."  → a política barrou na escrita. Também é bom.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'troque@pelo.email'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $teste$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: auth.uid() é NULL — confira o e-mail no bloco 5.0';
  END IF;
  UPDATE user_tenant SET role = 'admin' WHERE user_id = auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE EXCEPTION 'RESULTADO 5.B — o UPDATE em user_tenant afetou % linha(s)', n;
END
$teste$;
ROLLBACK;


-- ── 5.C · conceder escopo a si mesmo (idem, ERROR esperado) ───
-- Já sabemos o resultado de uma execução anterior: a política recusou o
-- INSERT ("new row violates row-level security policy"). Fica aqui para o
-- registro do Anexo A e para reconferir depois de qualquer mudança de policy.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'troque@pelo.email'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $teste$
DECLARE n int;
BEGIN
  INSERT INTO user_acesso_regra (user_id, tenant_id, dimensao, escopo, valor_ids, negados)
  VALUES (auth.uid(), '11111111-1111-1111-1111-111111111111', 'centro_custo', 'VER', '{}', '{}');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE EXCEPTION 'RESULTADO 5.C — o INSERT gravou % linha(s): o usuário escreve a própria permissão', n;
END
$teste$;
ROLLBACK;


-- ════════════════════════════════════════════════════════════
-- 6. Confirmação pós-teste — nada ficou gravado
-- ════════════════════════════════════════════════════════════
-- Paranoia barata: repete a contagem de papéis. Tem de bater com a consulta 4.
SELECT role AS papel, count(*) AS usuarios
  FROM user_tenant GROUP BY 1 ORDER BY 2 DESC;
