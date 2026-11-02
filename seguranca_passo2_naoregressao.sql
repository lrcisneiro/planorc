-- ============================================================
-- PASSO 2 — Teste de não-regressão: o que cada usuário VÊ, agora
--
-- A promessa do v3_129/130 é que NADA muda para o usuário: o frontend já
-- aplicava o mesmo recorte, então os totais por usuário devem ser idênticos aos
-- de antes. Se mudaram, ou a política divergiu do `useUserAccess`, ou o
-- `useUserAccess` estava errado — e aí é bug achado, não regressão causada.
--
-- COMO ISTO FUNCIONA, e por que não é opcional:
--
-- 1. No SQL Editor você roda como dono das tabelas, e **dono ignora RLS**
--    (`FORCE ROW LEVEL SECURITY` não está ligado). Sem `SET LOCAL ROLE
--    authenticated`, toda contagem volta cheia e o teste mente dizendo que está
--    tudo bem.
-- 2. `auth.uid()` sai de `request.jwt.claims`. Definindo o `sub`, o
--    `current_tenant_id()` da v3_060 resolve o tenant a partir de
--    `user_tenant` — por isso a personificação funciona aqui.
-- 3. O relatório sai por RAISE EXCEPTION porque o editor mostra só o resultado
--    da última instrução, e um loop não tem "última". A exceção sempre aparece.
--    **ELA É O RESULTADO ESPERADO, não um erro.**
--
-- Recorte em 2026 de propósito: `fat_realizado` tem 1,07 milhão de linhas e a
-- contagem cheia estoura o tempo do editor. O ano usa os índices existentes.
--
-- Nada é escrito. Rode o bloco inteiro de uma vez.
-- ============================================================
DO $teste$
DECLARE
  u            record;
  rel          text := '';
  v_orc        numeric; v_real numeric; v_folha numeric; v_posto bigint;
  n_orc        bigint;  n_real bigint;
BEGIN
  -- Lista os usuários ANTES de trocar de papel: depois de virar
  -- `authenticated`, a leitura de user_tenant passa a ser a do personificado.
  FOR u IN SELECT ut.user_id, ut.role,
                  (SELECT count(*) FROM user_acesso_regra r
                    WHERE r.user_id = ut.user_id AND r.escopo = 'VER') AS regras
             FROM user_tenant ut ORDER BY ut.role, ut.user_id
  LOOP
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    EXECUTE 'SELECT coalesce(sum(valor),0), count(*) FROM fat_orcado    WHERE ano = 2026' INTO v_orc,  n_orc;
    EXECUTE 'SELECT coalesce(sum(valor),0), count(*) FROM fat_realizado WHERE ano = 2026' INTO v_real, n_real;
    EXECUTE 'SELECT coalesce(sum(valor),0)          FROM fat_folha      WHERE ano = 2026' INTO v_folha;
    EXECUTE 'SELECT count(*)                        FROM posto'                            INTO v_posto;

    RESET ROLE;

    rel := rel || format(
      E'\n%s  regras_VER=%s\n    orçado 2026 ....... %s linha(s)  %s'
      || E'\n    realizado 2026 .... %s linha(s)  %s'
      || E'\n    folha 2026 ........ %s'
      || E'\n    postos visíveis ... %s',
      rpad(u.role, 7), u.regras,
      to_char(n_orc, 'FM999G999'),  to_char(v_orc,  'FM999G999G990D00'),
      to_char(n_real, 'FM999G999'), to_char(v_real, 'FM999G999G990D00'),
      to_char(v_folha, 'FM999G999G990D00'),
      to_char(v_posto, 'FM999G999'));
  END LOOP;

  RAISE EXCEPTION E'=== O QUE CADA USUÁRIO VÊ (RLS aplicado) ===%\n\nCOMO LER:\n  · admin deve ver TUDO (sem recorte).\n  · quem tem regras_VER > 0 deve ver MENOS, e tem de bater com a tela.\n  · se um member com regra vê o mesmo que o admin, o escopo NÃO está pegando.\n  · se alguém vê ZERO em tudo, o tenant não resolveu — conferir user_tenant.', rel;
END $teste$;
