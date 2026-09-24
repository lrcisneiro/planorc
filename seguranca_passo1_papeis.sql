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
-- A parte 5 não tem nada para editar: cada bloco escolhe sozinho o usuário a
-- personificar e diz na resposta quem usou. Rode um bloco de cada vez; eles
-- respondem de propósito com ERROR, que é a única saída que o editor sempre
-- mostra. Não rode o arquivo inteiro de uma vez — o editor exibe só o retorno
-- da última instrução.
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
-- COMO RODAR: nada para editar. Selecione o bloco 5.A e rode; depois o 5.B.
-- Cada bloco escolhe sozinho o usuário a personificar — de preferência um que
-- NÃO seja admin — e diz na resposta quem usou.
--
-- POR QUE CADA BLOCO É UM `DO` SÓ: o editor do Supabase não garante que um
-- `BEGIN;` agrupe as instruções seguintes; cada uma pode ir em transação
-- própria, e a identidade definida numa se perde antes de a outra rodar. Um
-- bloco `DO` é UMA instrução: identidade, papel e teste na mesma transação,
-- por construção.
--
-- E POR QUE A RESPOSTA VEM COMO `ERROR`: é a única saída que o editor sempre
-- mostra, e a exceção ainda garante o rollback de tudo que o bloco escreveu.
-- Ver "ERROR" aqui é o funcionamento normal. O que importa é a MENSAGEM.


-- ── 5.A · o que esse usuário ENXERGA (resposta vem como ERROR) ──
-- A resposta vem como "vê X de Y": sem o denominador, o número sozinho não
-- diz nada — "vê 3" tanto pode ser "as 3 dele" quanto "as 3 que existem".
--   vê 1 de N   → restrito às próprias linhas. É o esperado.
--   vê N de N   → enxerga as de todo mundo. Para um não-admin, é vazamento;
--                 em user_acesso_regra, também faz o useUserAccess (que lê a
--                 tabela sem filtrar por user_id) poder HERDAR regra alheia.
DO $teste$
DECLARE uid uuid; mail text; papel text;
        ta int; tb int; tc int; va int; vb int; vc int;
BEGIN
  -- Alvo: escolhido pelo próprio bloco, para não depender de edição à mão.
  -- Preferência: quem NÃO é admin; entre eles, o mais recente. Se todos forem
  -- admin, pega o mais recente — o teste continua válido, porque o que se mede
  -- é se a POLÍTICA barra, não se a pessoa já tem o papel.
  SELECT ut.user_id, u.email, ut.role INTO uid, mail, papel
    FROM user_tenant ut
    JOIN auth.users u ON u.id = ut.user_id
   ORDER BY (ut.role = 'admin'), u.created_at DESC
   LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário em user_tenant — não há o que testar';
  END IF;

  -- Totais reais, medidos AINDA COMO DONO (sem RLS). São o denominador.
  SELECT count(*) INTO ta FROM user_tenant;
  SELECT count(*) INTO tb FROM user_acesso_regra;
  SELECT count(*) INTO tc FROM user_acesso_funcao;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: a personificação não pegou (auth.uid() nulo)';
  END IF;

  SELECT count(*) INTO va FROM user_tenant;
  SELECT count(*) INTO vb FROM user_acesso_regra;
  SELECT count(*) INTO vc FROM user_acesso_funcao;

  RAISE EXCEPTION 'RESULTADO 5.A — como % (papel: %) · user_tenant: vê % de % · user_acesso_regra: vê % de % · user_acesso_funcao: vê % de %',
    mail, papel, va, ta, vb, tb, vc, tc;
END
$teste$;


-- ── 5.B · A ESCALADA (resposta vem como ERROR, é esperado) ──
-- Leia a mensagem:
--   "afetou 0 linha(s)"     → a política barrou. É o resultado bom.
--   "afetou 1 linha(s)"     → ESCALADA PROVADA: qualquer usuário logado vira
--                             admin por uma chamada de API. Passa na frente de
--                             todo o resto do plano, inclusive do ACS-02.
--   "violates row-level..." → a política barrou na escrita. Também é bom.
DO $teste$
DECLARE uid uuid; mail text; n int;
BEGIN
  -- Alvo: escolhido pelo próprio bloco, para não depender de edição à mão.
  -- Preferência: quem NÃO é admin; entre eles, o mais recente. Se todos forem
  -- admin, pega o mais recente — o teste continua válido, porque o que se mede
  -- é se a POLÍTICA barra, não se a pessoa já tem o papel.
  SELECT ut.user_id, u.email INTO uid, mail
    FROM user_tenant ut
    JOIN auth.users u ON u.id = ut.user_id
   ORDER BY (ut.role = 'admin'), u.created_at DESC
   LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário em user_tenant — não há o que testar';
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: a personificação não pegou (auth.uid() nulo)';
  END IF;
  UPDATE user_tenant SET role = 'admin' WHERE user_id = auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE EXCEPTION 'RESULTADO 5.B — como % · o UPDATE em user_tenant afetou % linha(s)', mail, n;
END
$teste$;


-- ── 5.C · conceder escopo a si mesmo (idem, ERROR esperado) ──
-- Já sabemos de uma execução anterior que a política recusou este INSERT
-- ("new row violates row-level security policy"). Fica para o registro do
-- Anexo A e para reconferir depois de qualquer mudança de política.
DO $teste$
DECLARE uid uuid; mail text; n int;
BEGIN
  -- Alvo: escolhido pelo próprio bloco, para não depender de edição à mão.
  -- Preferência: quem NÃO é admin; entre eles, o mais recente. Se todos forem
  -- admin, pega o mais recente — o teste continua válido, porque o que se mede
  -- é se a POLÍTICA barra, não se a pessoa já tem o papel.
  SELECT ut.user_id, u.email INTO uid, mail
    FROM user_tenant ut
    JOIN auth.users u ON u.id = ut.user_id
   ORDER BY (ut.role = 'admin'), u.created_at DESC
   LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário em user_tenant — não há o que testar';
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: a personificação não pegou (auth.uid() nulo)';
  END IF;
  INSERT INTO user_acesso_regra (user_id, tenant_id, dimensao, escopo, valor_ids, negados)
  VALUES (auth.uid(), '11111111-1111-1111-1111-111111111111', 'centro_custo', 'VER', '{}', '{}');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE EXCEPTION 'RESULTADO 5.C — como % · o INSERT gravou % linha(s)', mail, n;
END
$teste$;


-- ════════════════════════════════════════════════════════════
-- 6. Confirmação pós-teste — nada ficou gravado
-- ════════════════════════════════════════════════════════════
-- Paranoia barata: repete a contagem de papéis. Tem de bater com a consulta 4.
SELECT role AS papel, count(*) AS usuarios
  FROM user_tenant GROUP BY 1 ORDER BY 2 DESC;
