-- ============================================================
-- v3_168 — Reabrir escrevendo a justificativa no mesmo gesto
--
-- A v3_167 só devolvia à fila; a justificativa tinha de ser escrita antes, no
-- formulário do cenário, noutra tela. Na prática são o MESMO ato: responder é
-- justificar e pedir nova análise. Separar os dois obrigava a sair do
-- comparativo — onde está a recusa que se quer responder.
--
-- A justificativa vai para `nota` (o campo de quem PROPÕE) e a recusa continua
-- em `aprov_nota` (o campo de quem APROVA). Dois lados, dois campos: é o que
-- deixa a linha contar a conversa inteira — o que foi proposto, por que foi
-- recusado, e o que foi respondido.
--
-- ⚠ Troca a assinatura: a versão de 1 argumento é DERRUBADA antes. Deixar as
-- duas conviverem tornaria `reabrir_decisao(uuid)` ambígua no PostgREST.
--
-- Termina em SELECT.
-- ============================================================

DROP FUNCTION IF EXISTS reabrir_decisao(uuid);

CREATE OR REPLACE FUNCTION reabrir_decisao(p_id uuid, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_escrever() THEN
    RAISE EXCEPTION 'Sem permissão de escrita neste orçamento.' USING ERRCODE = '42501';
  END IF;
  UPDATE posto_versao
     SET aprovado = NULL, aprov_em = NULL, aprov_por = NULL,   -- aprov_nota FICA: é o que o aprovador reconfere
         nota = coalesce(p_nota, nota)
   WHERE id = p_id AND tenant_id = current_tenant_id() AND aprovado = false;
END $$;
REVOKE ALL ON FUNCTION reabrir_decisao(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION reabrir_decisao(uuid, text) TO authenticated;

SELECT 'assinaturas de reabrir_decisao' AS secao,
       (SELECT string_agg(pg_get_function_identity_arguments(oid), ' | ')
          FROM pg_proc WHERE proname='reabrir_decisao') AS resultado
UNION ALL SELECT 'só uma (esperado: sim)',
  CASE WHEN (SELECT count(*) FROM pg_proc WHERE proname='reabrir_decisao') = 1 THEN 'sim' ELSE '⛔ há ambiguidade' END
UNION ALL SELECT 'executável por anon (esperado: não)',
  CASE WHEN has_function_privilege('anon', 'reabrir_decisao(uuid, text)', 'EXECUTE') THEN '⛔ SIM' ELSE 'não' END;
