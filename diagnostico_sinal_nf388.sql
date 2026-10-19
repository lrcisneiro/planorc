-- ============================================================
-- NF 388 com sinal trocado — é o SINAL DA AMARRAÇÃO
--
-- JÁ VERIFICADO fora do banco (não refazer):
--   · razão do ERP correto: clientes 11021001 a DÉBITO, receita a CRÉDITO,
--     28.852,55 dos dois lados;
--   · lote gerado correto: as receitas vêm a crédito, o que dá
--     valor = credito - debito = +28.852,55.
-- Então o dado chega certo. O sinal vira na LEITURA.
--
-- O drill do razão calcula:  valor exibido = fat_realizado.valor * conta_linha.sinal
-- (RelatorioEditorPage, RazaoModal). `sinal` é coluna da AMARRAÇÃO — serve para
-- conta que entra na linha invertida (ex.: dedução dentro de um bloco de
-- receita). Se as contas da NF 388 estiverem amarradas com sinal -1 sem motivo,
-- a receita positiva aparece negativa — e só nelas.
--
-- Pista: a 388 usa contas DIFERENTES das NFs que saem certas no mesmo mês.
--   388          -> 31041006, 31011006   (negativa)
--   365/367/368  -> 31041002, 31041001, 31031001  (positivas)
--
-- No SQL Editor current_tenant_id() é NULL — daí a claim no DO e o RAISE.
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE
  uid uuid; t uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  -- ── 1. O valor GRAVADO (sem a leitura) ──
  -- credito preenchido + valor positivo = gravação correta; o problema é adiante.
  txt := txt || E'\n=== 1. NF 388 ago/2026 — como esta GRAVADO ===\n';
  FOR r IN
    SELECT cc.codigo conta, count(*) n,
           sum(coalesce(fr.debito,0)) deb, sum(coalesce(fr.credito,0)) cre, sum(fr.valor) val
      FROM fat_realizado fr JOIN conta_contabil cc ON cc.id = fr.conta_id
     WHERE fr.tenant_id = t AND fr.ano = 2026 AND fr.mes = 8
       AND fr.historico ILIKE '%000000388%'
     GROUP BY cc.codigo ORDER BY cc.codigo
  LOOP
    txt := txt || format('  %-10s %3s linhas | deb %12s | cre %12s | valor %13s %s',
             r.conta, r.n, to_char(r.deb,'FM999G999G990D00'), to_char(r.cre,'FM999G999G990D00'),
             to_char(r.val,'FM999G999G990D00'),
             CASE WHEN r.cre > 0 AND r.val < 0 THEN '<<< gravacao invertida' ELSE 'ok' END) || E'\n';
  END LOOP;

  -- ── 2. O SINAL DA AMARRAÇÃO — o suspeito ──
  txt := txt || E'\n=== 2. conta_linha.SINAL (388 x as que saem certas) ===\n';
  FOR r IN
    SELECT cc.codigo conta, left(cc.descricao,24) cdesc, cc.natureza conta_nat,
           cl.sinal, rl.codigo lcod, left(rl.descricao,24) ldesc, rl.natureza lnat,
           rel.nome relatorio
      FROM conta_contabil cc
      LEFT JOIN conta_linha cl ON cl.conta_id = cc.id AND cl.tenant_id = t
      LEFT JOIN relatorio_linha rl ON rl.id = cl.linha_id
      LEFT JOIN relatorio rel ON rel.id = rl.relatorio_id
     WHERE cc.codigo IN ('31041006','31011006','31041002','31041001','31031001')
     ORDER BY cc.codigo, rel.nome
  LOOP
    txt := txt || format('  %-10s %-24s nat=%-8s SINAL=%-4s linha %s %s  [%s]',
             r.conta, r.cdesc, coalesce(r.conta_nat,'(nula)'),
             coalesce(r.sinal::text,'(sem amarr.)'),
             coalesce(r.lcod,'-'), coalesce(r.ldesc,''), coalesce(r.relatorio,'-')) || E'\n';
  END LOOP;

  -- ── 3. Varredura: TODA amarração com sinal negativo ──
  -- Se houver poucas, dá para conferir uma a uma se a inversão é proposital.
  txt := txt || E'\n=== 3. TODAS as amarracoes com sinal negativo ===\n';
  FOR r IN
    SELECT cc.codigo conta, left(cc.descricao,26) cdesc, rl.codigo lcod,
           left(rl.descricao,24) ldesc, rel.nome relatorio
      FROM conta_linha cl
      JOIN conta_contabil cc ON cc.id = cl.conta_id
      JOIN relatorio_linha rl ON rl.id = cl.linha_id
      LEFT JOIN relatorio rel ON rel.id = rl.relatorio_id
     WHERE cl.tenant_id = t AND cl.sinal < 0
     ORDER BY cc.codigo LIMIT 40
  LOOP
    txt := txt || format('  %-10s %-26s -> %s %s  [%s]', r.conta, r.cdesc,
             coalesce(r.lcod,'-'), coalesce(r.ldesc,''), coalesce(r.relatorio,'-')) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $diag$;
