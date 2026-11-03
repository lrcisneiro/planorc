-- ============================================================
-- v3_167 — Reabrir uma decisão recusada
--
-- Caso real: o aprovador recusou pedindo "justifique". A resposta é TEXTO, não
-- número — nenhum campo de decisão muda, o gatilho da v3_166 não dispara, e o
-- veredito ficaria recusado para sempre. Quem propôs não tinha como dizer
-- "respondi, olhe de novo".
--
-- `reabrir_decisao` devolve o posto para PENDENTE. Nada mais: a justificativa
-- continua no campo `nota` do próprio cenário, que já existe e já é editável.
--
-- ⚠ Mantém `aprov_nota` de propósito. Apagar a recusa ao reabrir faria o
-- aprovador reler a decisão sem lembrar o que ele mesmo objetou — e é
-- justamente isso que ele precisa conferir se foi respondido.
--
-- ⚠ Quem reabre é quem PROPÕE, não quem aprova: por isso a guarda é
-- `pode_escrever()` e não `pode_aprovar_cenario()`. Reabrir não aprova nada —
-- devolve à fila.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION reabrir_decisao(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_escrever() THEN
    RAISE EXCEPTION 'Sem permissão de escrita neste orçamento.' USING ERRCODE = '42501';
  END IF;
  UPDATE posto_versao
     SET aprovado = NULL, aprov_em = NULL, aprov_por = NULL   -- aprov_nota FICA: é o que o aprovador vai reconferir
   WHERE id = p_id AND tenant_id = current_tenant_id() AND aprovado = false;
END $$;
REVOKE ALL ON FUNCTION reabrir_decisao(uuid) FROM public;
GRANT EXECUTE ON FUNCTION reabrir_decisao(uuid) TO authenticated;

SELECT 'função reabrir_decisao' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='reabrir_decisao') THEN 'criada' ELSE '⛔ não' END AS resultado
UNION ALL SELECT 'executável por anon (esperado: não)',
  CASE WHEN has_function_privilege('anon', 'reabrir_decisao(uuid)', 'EXECUTE') THEN '⛔ SIM' ELSE 'não' END
UNION ALL SELECT 'decisões recusadas hoje',
  (SELECT count(*)::text FROM posto_versao WHERE aprovado = false);
