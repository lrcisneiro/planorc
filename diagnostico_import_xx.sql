-- ============================================================
-- As linhas da empresa XX (item PY) chegaram ao banco?
--
-- JÁ VERIFICADO no arquivo (não refazer): o lote lancamentos_2026_09.xlsx TEM
-- as 4 linhas do Mauricio na empresa XX (conta 41021002, cc 314, item PY),
-- somando 7.411,59 de débito. A separação mensal e o de-para de item contábil
-- funcionaram. Se o razão dele aparece 0,00 na tela, a perda foi na IMPORTAÇÃO.
--
-- O importador descarta linha em silêncio (conta um "ignorado") quando:
--   · a empresa do arquivo não existe no cadastro;
--   · a conta contábil não existe no plano daquela empresa;
--   · não há cotação de câmbio para a data — e XX é Paraguai, moeda diferente;
--   · o lote está na lista de lotes ignorados.
-- O import de 12 arquivos reportou 18.365 ignorados; estas consultas dizem se
-- os dele estão nesse bolo e por quê.
--
-- No SQL Editor current_tenant_id() é NULL — daí a claim no DO e o RAISE.
-- Só leitura.
-- ============================================================
DO $d$
DECLARE uid uuid; t uuid; r record; txt text := ''; n int;
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role='admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  t := current_tenant_id();
  IF t IS NULL THEN RAISE EXCEPTION 'current_tenant_id() nulo'; END IF;

  -- 1. ele está em fat_realizado?
  txt := txt || E'\n=== 1. MAURICIO em fat_realizado (ago/set) ===\n';
  FOR r IN
    SELECT fr.ano, fr.mes, e.codigo emp, f.codigo fil, cc.codigo conta,
           count(*) n, sum(fr.valor) val
      FROM fat_realizado fr
      JOIN conta_contabil cc ON cc.id = fr.conta_id
      LEFT JOIN empresa e ON e.id = fr.empresa_id
      LEFT JOIN filial f ON f.id = fr.filial_id
     WHERE fr.tenant_id = t AND fr.ano = 2026 AND fr.mes IN (8,9)
       AND fr.historico ILIKE '%MAURICIO FERNAND%'
     GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,5
  LOOP
    txt := txt || format('  %s/%s emp=%-4s fil=%-5s conta=%-10s %2s linhas  valor %12s',
             r.mes, r.ano, coalesce(r.emp,'-'), coalesce(r.fil,'-'), r.conta, r.n,
             to_char(r.val,'FM999G999G990D00')) || E'\n';
  END LOOP;
  IF txt NOT LIKE '%linhas%' THEN txt := txt || E'  *** NENHUMA linha dele no banco ***\n'; END IF;

  -- 2. a empresa XX existe? em que moeda?
  txt := txt || E'\n=== 2. A EMPRESA XX ===\n';
  FOR r IN
    SELECT e.codigo, e.descricao, e.pais, e.moeda_slot, e.ativo,
           (SELECT count(*) FROM fat_realizado x WHERE x.tenant_id=t AND x.empresa_id=e.id AND x.ano=2026 AND x.mes=9) n_set,
           (SELECT count(*) FROM fat_folha y WHERE y.tenant_id=t AND y.empresa_id=e.id AND y.ano=2026 AND y.mes=9) n_folha
      FROM empresa e WHERE e.tenant_id = t AND e.codigo IN ('XX','YY','BO','40')
     ORDER BY e.codigo
  LOOP
    txt := txt || format('  %-4s %-22s pais=%-4s moeda_slot=%s ativo=%s | razao set=%s | folha set=%s',
             r.codigo, left(r.descricao,22), coalesce(r.pais,'-'), r.moeda_slot, r.ativo, r.n_set, r.n_folha) || E'\n';
  END LOOP;

  -- 3. a conta 41021002 existe no plano da XX?
  -- conta é por PLANO; se a XX aponta para outro plano sem essa conta, a linha cai.
  txt := txt || E'\n=== 3. A CONTA 41021002 POR PLANO ===\n';
  FOR r IN
    SELECT pc.codigo plano, cc.codigo, left(cc.descricao,26) d,
           (SELECT string_agg(e.codigo, ',' ORDER BY e.codigo) FROM empresa e WHERE e.plano_id = pc.id AND e.tenant_id=t) empresas
      FROM conta_contabil cc JOIN plano_contas pc ON pc.id = cc.plano_id
     WHERE cc.codigo IN ('41021002','41021001') ORDER BY cc.codigo, pc.codigo
  LOOP
    txt := txt || format('  conta %-10s plano=%-10s %-26s empresas do plano: %s',
             r.codigo, r.plano, r.d, coalesce(r.empresas,'(nenhuma)')) || E'\n';
  END LOOP;

  RAISE EXCEPTION '%', txt;
END $d$;
