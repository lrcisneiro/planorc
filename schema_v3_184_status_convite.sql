-- ============================================================
-- v3_184 — o estado do convite na lista de usuários
--
-- POR QUE: a lista mostrava e-mail, perfil e acesso, e nada sobre o convite
-- ter chegado. Em 09/nov um convite saiu com link de `localhost` (o destino
-- vinha do `window.location.origin` de quem convidava) e NINGUÉM descobriu
-- pela tela — o e-mail sai, a tela diz "enviado", e só a pessoa do outro lado
-- sabe que o link não abre. Com o estado à vista, um convite parado aparece.
--
-- São dois estados e eles pedem e-mails DIFERENTES, que é o que faz o reenvio
-- ingênuo falhar:
--   `pendente`  = nunca confirmou o e-mail, isto é, nunca abriu o convite.
--                 O GoTrue reenvia convite para quem está assim.
--   `sem_senha` = abriu o link mas não definiu senha (`precisa_senha` no
--                 metadata). Aí o convite é RECUSADO ("already registered") e
--                 o que vale é a recuperação de senha.
--   `ativo`     = entrou e tem senha.
--
-- ⚠ Lê `auth.users`, que `authenticated` não alcança — por isso continua
-- SECURITY DEFINER e com a mesma primeira linha: só admin do tenant. Trocar a
-- assinatura exige DROP antes, senão o PostgREST fica com duas e a chamada
-- vira ambígua (lição da v3_168).
--
-- Termina em SELECT.
-- ============================================================

DROP FUNCTION IF EXISTS get_tenant_users();

CREATE OR REPLACE FUNCTION public.get_tenant_users()
RETURNS TABLE(user_id uuid, email text, role text, estado text, ultimo_acesso timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF (SELECT ut.role FROM user_tenant ut
      WHERE ut.user_id = auth.uid()
        AND ut.tenant_id = get_my_tenant_id()) <> 'admin' THEN
    RAISE EXCEPTION 'Acesso negado: somente administradores';
  END IF;

  RETURN QUERY
  SELECT ut.user_id, u.email::text, ut.role,
         CASE
           WHEN u.email_confirmed_at IS NULL                              THEN 'pendente'
           WHEN coalesce(u.raw_user_meta_data->>'precisa_senha','') = 'true' THEN 'sem_senha'
           ELSE 'ativo'
         END::text,
         u.last_sign_in_at
  FROM user_tenant ut
  JOIN auth.users u ON u.id = ut.user_id
  WHERE ut.tenant_id = get_my_tenant_id()
  ORDER BY u.email;
END;
$function$;

REVOKE ALL ON FUNCTION get_tenant_users() FROM public;
GRANT EXECUTE ON FUNCTION get_tenant_users() TO authenticated;

SELECT 'get_tenant_users' AS secao,
       CASE WHEN (SELECT count(*) FROM pg_proc WHERE proname='get_tenant_users') = 1
            THEN 'uma assinatura (correto)' ELSE '⛔ mais de uma — PostgREST fica ambíguo' END AS resultado
UNION ALL
SELECT 'colunas novas',
       CASE WHEN pg_get_function_result((SELECT oid FROM pg_proc WHERE proname='get_tenant_users'))
                 LIKE '%estado%' THEN 'estado + ultimo_acesso' ELSE '⛔ não aplicou' END;
