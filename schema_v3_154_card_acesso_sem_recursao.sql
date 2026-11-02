-- ============================================================
-- v3_154 — Quebrar a recursão entre as duas políticas
--
-- "infinite recursion detected in policy for relation dashboard_card_acesso".
--
-- Eu criei um ciclo: a política de ESCRITA em `dashboard_card_acesso` pergunta
-- "sou dono do card?" lendo `dashboard_card` — e a política de LEITURA de
-- `dashboard_card` pergunta "este card é dirigido a mim?" lendo
-- `dashboard_card_acesso`. Avaliar uma reentra na outra, e o Postgres aborta
-- em vez de girar.
--
-- Não é preciso que o ciclo se feche de verdade para dar erro: basta a
-- reentrada. É a armadilha de políticas que se consultam entre si, e a saída é
-- sempre a mesma — **uma das pontas tem de sair do RLS**.
--
-- `eh_dono_card()` é `SECURITY DEFINER`: roda como dono da função, então lê
-- `dashboard_card` sem acionar a política dela, e o ciclo se abre. Ela não
-- afrouxa nada — responde exatamente o que o `EXISTS` respondia (dono do card,
-- no meu tenant, ou admin), só que sem reentrar.
--
-- `STABLE` e chamada dentro de `(SELECT …)`: função em política roda por
-- linha; a subconsulta escalar a transforma em InitPlan, avaliado uma vez.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION eh_dono_card(p_card uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dashboard_card c
     WHERE c.id = p_card
       AND c.tenant_id = current_tenant_id()
       AND (c.owner_id = auth.uid() OR eh_admin())
  )
$$;
REVOKE ALL ON FUNCTION eh_dono_card(uuid) FROM public;
GRANT EXECUTE ON FUNCTION eh_dono_card(uuid) TO authenticated;

DROP POLICY IF EXISTS dca_ins ON dashboard_card_acesso;
CREATE POLICY dca_ins ON dashboard_card_acesso FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND eh_dono_card(card_id));

DROP POLICY IF EXISTS dca_del ON dashboard_card_acesso;
CREATE POLICY dca_del ON dashboard_card_acesso FOR DELETE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND eh_dono_card(card_id));

SELECT 'políticas de escrita ainda leem dashboard_card?' AS secao,
       CASE WHEN bool_or(coalesce(qual, with_check) LIKE '%FROM dashboard_card %')
            THEN '⛔ sim — a recursão volta' ELSE 'não (correto)' END AS resultado
  FROM pg_policies WHERE tablename = 'dashboard_card_acesso'
UNION ALL
SELECT 'função eh_dono_card',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_dono_card')
            THEN 'criada (SECURITY DEFINER)' ELSE '⛔ não' END;
