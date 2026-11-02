-- ============================================================
-- v3_140 — Uma pessoa, um papel por tenant
--
-- ACHADO: `lrcisneiro` tem TRÊS linhas em `user_tenant` no mesmo tenant —
-- admin, member e viewer. Vieram dos testes de perfil (a troca foi feita por
-- INSERT onde cabia UPDATE), e `user_tenant` não tem unique que impeça.
--
-- POR QUE IMPORTA, e é pior do que parece: o frontend lê o papel com
--   supabase.from('user_tenant').select('role')  →  pega [0]
-- sem ORDER BY. Com três linhas, qual delas vem é **indefinido** — decidido
-- pelo plano de execução, não por regra. A mesma pessoa pode abrir o app como
-- admin numa sessão e como viewer na outra, e aí perde Configurações sem nada
-- ter mudado. O banco, por outro lado, resolve por EXISTS (`eh_admin()`), então
-- ele diz admin sempre. Frontend e banco discordando sobre quem a pessoa é.
--
-- Não é bug de hoje: é o que acontece quando o modelo permite um estado que o
-- código assume impossível. A trava tem de estar no banco.
--
-- O QUE FAZ: mantém o papel MAIS PRIVILEGIADO de cada pessoa por tenant (que é
-- o que o banco já pratica via eh_admin), apaga os outros, e cria o UNIQUE para
-- não recorrer. ⚠ APAGA LINHAS DE ACESSO — e com a auditoria da v3_137 de pé,
-- cada DELETE fica registrado, o que aqui é bom: é mudança de quem-é-quem.
--
-- ⚠ Isto também TIRA a sua conta de teste `viewer`/`member`. Era assim que você
-- conferia o que cada perfil vê. Se quiser manter o teste, o jeito certo é um
-- e-mail separado por perfil — a mesma pessoa não pode ser dois papéis, porque
-- o código inteiro pergunta "qual o seu papel?" esperando uma resposta.
--
-- Termina em SELECT.
-- ============================================================

-- 1. Fica só o mais privilegiado por (tenant, pessoa).
DELETE FROM user_tenant ut
 WHERE EXISTS (
   SELECT 1 FROM user_tenant m
    WHERE m.tenant_id = ut.tenant_id
      AND m.user_id   = ut.user_id
      AND CASE m.role WHEN 'admin' THEN 3 WHEN 'member' THEN 2 ELSE 1 END
        > CASE ut.role WHEN 'admin' THEN 3 WHEN 'member' THEN 2 ELSE 1 END
 );

-- 2. A trava, para o estado impossível voltar a ser impossível.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_tenant_pessoa
  ON user_tenant (tenant_id, user_id);

SELECT t.nome                     AS tenant,
       split_part(u.email,'@',1)  AS quem,
       ut.role                    AS papel,
       count(*) OVER (PARTITION BY ut.tenant_id, ut.user_id) AS linhas_da_pessoa
  FROM user_tenant ut
  JOIN tenant t ON t.id = ut.tenant_id
  LEFT JOIN auth.users u ON u.id = ut.user_id
 ORDER BY 1, 3, 2;
