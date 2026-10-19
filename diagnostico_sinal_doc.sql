-- ============================================================
-- Sinal trocado num lançamento — onde ele se inverte?
--
-- Há DUAS camadas de sinal no Planorc, e o sintoma "sinal trocado" aparece
-- quando elas discordam:
--
--   1. ARMAZENAMENTO: o import grava `valor = credito - debito`, então uma
--      DESPESA (débito) fica NEGATIVA em fat_realizado. Isso é o esperado.
--   2. EXIBIÇÃO: a DRE multiplica por -1 quando a linha (ou um ancestral dela)
--      tem natureza DESPESA, para a despesa ser lida como número positivo.
--      `lib/refRelatorio.ts`, fatorExibicao().
--
-- Se a conta estiver amarrada a uma linha de natureza errada — ou numa subárvore
-- em que NENHUM ancestral declara natureza — o fator fica +1 e o valor sai
-- invertido na tela, mesmo com o lançamento correto no banco.
--
-- Troque o 388 abaixo se o documento tiver outro número.
-- No SQL Editor current_tenant_id() é NULL — daí a claim no DO e o RAISE.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE
  uid uuid; t uuid; r record; txt text := ''; achou int := 0;
  p_doc text := '388';          -- <<< o documento procurado
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  txt := txt || E'\n=== LANÇAMENTOS COM DOC/HISTÓRICO ~ ' || p_doc || E' ===\n';
  FOR r IN
    SELECT fr.ano, fr.mes, fr.documento, left(coalesce(fr.historico,''), 34) hist,
           fr.debito, fr.credito, fr.valor,
           cc.codigo conta_cod, left(cc.descricao, 22) conta_desc, cc.natureza conta_nat,
           rl.codigo linha_cod, left(rl.descricao, 20) linha_desc, rl.natureza linha_nat,
           -- a natureza EFETIVA: sobe a árvore até achar quem a declara
           (WITH RECURSIVE sobe AS (
              SELECT x.id, x.pai_id, x.natureza FROM relatorio_linha x WHERE x.id = cl.linha_id
              UNION ALL
              SELECT p.id, p.pai_id, p.natureza FROM relatorio_linha p JOIN sobe s ON p.id = s.pai_id
            ) SELECT s.natureza FROM sobe s WHERE s.natureza IN ('RECEITA','DESPESA') LIMIT 1
           ) nat_efetiva
      FROM fat_realizado fr
      JOIN conta_contabil cc ON cc.id = fr.conta_id
      LEFT JOIN conta_linha cl ON cl.conta_id = fr.conta_id AND cl.tenant_id = t
      LEFT JOIN relatorio_linha rl ON rl.id = cl.linha_id
     WHERE fr.tenant_id = t
       AND (btrim(coalesce(fr.documento,'')) = p_doc
            OR btrim(coalesce(fr.documento,'')) = lpad(p_doc, 6, '0')
            OR coalesce(fr.historico,'') ILIKE '%' || p_doc || '%')
     ORDER BY fr.ano, fr.mes LIMIT 25
  LOOP
    achou := achou + 1;
    txt := txt || format('  %s/%s doc %-8s %s', r.mes, r.ano, coalesce(r.documento,'-'), r.hist) || E'\n';
    txt := txt || format('      deb %12s | cre %12s | VALOR GRAVADO %12s',
                         to_char(coalesce(r.debito,0),'FM999G999G990D00'),
                         to_char(coalesce(r.credito,0),'FM999G999G990D00'),
                         to_char(r.valor,'FM999G999G990D00')) || E'\n';
    txt := txt || format('      conta %s %s (natureza da CONTA: %s)',
                         r.conta_cod, r.conta_desc, coalesce(r.conta_nat,'(nula)')) || E'\n';
    txt := txt || format('      linha %s %s (natureza da LINHA: %s | EFETIVA na árvore: %s)',
                         coalesce(r.linha_cod,'SEM AMARRACAO'), coalesce(r.linha_desc,''),
                         coalesce(r.linha_nat,'(nula)'), coalesce(r.nat_efetiva,'*** NENHUMA ***')) || E'\n';
    txt := txt || format('      >>> na DRE aparece como %s  (fator %s)',
                         to_char(r.valor * CASE WHEN r.nat_efetiva = 'DESPESA' THEN -1 ELSE 1 END, 'FM999G999G990D00'),
                         CASE WHEN r.nat_efetiva = 'DESPESA' THEN '-1' ELSE '+1' END) || E'\n\n';
  END LOOP;

  IF achou = 0 THEN
    txt := txt || E'  nenhum lançamento encontrado com esse documento/histórico.\n'
               || E'  (o razão de out/2026 tambem nao tem "388" em DOC nem no historico —\n'
               || E'   entao a NF pode estar em OUTRA tela: Conciliacao > Contabil x Folha,\n'
               || E'   bloco de terceiros, onde a NF vem do lote de contas a pagar)\n';
  END IF;

  RAISE EXCEPTION '%', txt;
END $diag$;
