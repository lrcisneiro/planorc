-- ============================================================
-- Mudar o PAPEL de um usuário (viewer ↔ member ↔ admin)
--
-- POR QUE ISTO NÃO ESTÁ NA TELA. `user_tenant` tem RLS com **uma única
-- política, de SELECT**. Sem política de escrita, o Postgres nega UPDATE por
-- padrão — e é exatamente isso que impede alguém de promover a si mesmo. O
-- passo 1 verificou e registrou: ACS-03 conforme por causa desta ausência.
--
-- O SQL Editor roda como DONO das tabelas, que ignora RLS. Por isso funciona
-- aqui e não pela aplicação.
--
-- ⚠ MUDANÇA DE PRIVILÉGIO. Confira a parte 1 antes de rodar a 2.
--
-- Lembre do que o papel decide (CLAUDE.md, "Papel × capacidade"):
--   · viewer  → só consulta. Capacidade de escrita nele NÃO tem efeito.
--   · member  → escreve dentro do escopo de dados dele.
--   · admin   → ignora todo o escopo de dados e vê tudo.
-- Quem preenche orçamento precisa ser member.
-- ============================================================

-- ---------- 1 · como está hoje (rode primeiro, só leitura) ----------
SELECT u.email,
       ut.role                                   AS papel_atual,
       (SELECT count(*) FROM user_acesso_regra r
         WHERE r.user_id = ut.user_id AND r.escopo = 'VER'
           AND r.dimensao IN ('empresa','filial','centro_custo')) AS regras_de_escopo,
       CASE WHEN ut.role = 'viewer'
            THEN 'só consulta — não grava nada'
            WHEN ut.role = 'member'
            THEN 'grava dentro do escopo dele'
            ELSE 'ignora o escopo: vê e grava tudo' END           AS o_que_pode
  FROM user_tenant ut
  JOIN auth.users u ON u.id = ut.user_id
 ORDER BY ut.role, u.email;

-- ---------- 2 · mudar (troque o e-mail e o papel, depois descomente) ----------
-- Recorta por e-mail, não por id: é o que você tem à mão e o que dá para
-- conferir lendo. O RETURNING mostra o resultado em vez de você reconsultar.
--
-- UPDATE user_tenant ut
--    SET role = 'member'                         -- 'viewer' | 'member' | 'admin'
--   FROM auth.users u
--  WHERE u.id = ut.user_id
--    AND u.email = 'lrcisneiro@totvs.com.br'     -- ajuste
--  RETURNING u.email, ut.role AS papel_novo;

-- ---------- 3 · depois de mudar ----------
-- · A aplicação lê o papel ao montar: a pessoa precisa **recarregar a página**
--   (ou sair e entrar). As funções do banco já respondem na hora.
-- · Virou `member`: confira se o ESCOPO dela está cadastrado. Papel dá o
--   direito de escrever; o escopo diz ONDE. Sem regra, desde a v3_133 ela não
--   vê nada — e também não grava nada.
-- · Virou `admin`: ela passa a ignorar todo o escopo de dados. Não há escopo
--   que restrinja admin.
