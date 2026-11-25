-- ============================================================
-- AJUSTE DE DADO (não é migration). Rode no SQL Editor. Re-executável.
-- Termina em SELECT, nunca em RAISE — a exceção aqui só aparece quando a
-- base NÃO está na forma esperada, e aí desfazer é o certo.
--
-- A linha 23001 "Custos empresa avião" no cenário ORCADO2027_PRELIM está
-- R$ 176.301,00 acima da baseline. Medido em 25/nov/2026, são DUAS causas:
--
-- 1 · R$ 153.252,00 — combinação `YY CASCAVEL · filial 2006 · CC 5 Marketing`,
--     12 meses × 12.771, gravada em 24/11 00:33:33. A empresa YY já tinha a
--     linha inteira no CC 411 (trazida pela CÓPIA do cenário, 23/11 17:58:30),
--     então o mesmo custo passou a existir em dois CCs. Essa combinação não
--     existe em nenhuma outra versão nem em nenhuma outra linha.
--
-- 2 · R$ 23.049,00 — GÊMEA de `05 RIO PRETO · filial 2001 · CC 411 · janeiro`.
--     Duas linhas iguais em empresa, filial, CC, moeda e valor, sem expressão,
--     diferindo SÓ no `dims`: uma com {"historico":"Seed 2027 · volatil"} (da
--     importação do seed, 10/11 09:37) e outra com {} (24/11 00:32:10).
--     `dims::text` faz parte de `uq_fat_orcado`, então as duas CONVIVEM e a
--     célula soma 46.098 onde devia ter 23.049.
--
-- ⚠⚠ APAGA-SE A GÊMEA `{}`, NUNCA A DO HISTÓRICO. O Importar Baseline casa a
-- célula existente POR `dims` (`dimsKeyOf`, em `frontend/src/lib/importOrcado.ts`):
-- mantendo a do seed, uma reimportação ATUALIZA essa linha; mantendo a `{}`,
-- ela não casaria e o seed criaria a gêmea outra vez. A escolha de qual das
-- duas fica não é indiferente.
--
-- Causas de código, consertadas no mesmo passo:
--   • DrillCombinacoes.tsx — a combinação criada no "+" vivia na MESMA lista
--     que as do banco e era apagada por qualquer `carregar()` (a linha "sumia"
--     no meio do trabalho); e os seletores ofereciam filial/CC fora do recorte
--     da tela, deixando gravar valor que a tela não consegue mostrar.
--   • OrcarGradePage.tsx — `saveOne` descartava o `error` do `maybeSingle()`,
--     então célula com 2+ lançamentos caía no INSERT e duplicava, calado.
-- ============================================================

DO $$
DECLARE
  v_ver uuid; v_lin uuid;
  v_emp_yy uuid; v_fil_2006 uuid; v_cc_5 uuid;
  v_emp_05 uuid; v_fil_2001 uuid; v_cc_411 uuid;
  n int; n_hist int; n_vazio int;
BEGIN
  -- INTO STRICT de propósito: se algum código deixar de ser único, o ajuste
  -- para em vez de apagar a linha de outra empresa.
  SELECT id INTO STRICT v_ver  FROM versao_orcamento  WHERE codigo = 'ORCADO2027_PRELIM';
  SELECT id INTO STRICT v_lin  FROM conta_orcamentaria WHERE codigo = '23001';
  SELECT id INTO STRICT v_emp_yy   FROM empresa      WHERE codigo = 'YY';
  SELECT id INTO STRICT v_emp_05   FROM empresa      WHERE codigo = '05';
  SELECT id INTO STRICT v_fil_2006 FROM filial       WHERE codigo = '2006';
  SELECT id INTO STRICT v_fil_2001 FROM filial       WHERE codigo = '2001';
  SELECT id INTO STRICT v_cc_5     FROM centro_custo WHERE codigo = '5';
  SELECT id INTO STRICT v_cc_411   FROM centro_custo WHERE codigo = '411';

  IF (SELECT bloqueada FROM versao_orcamento WHERE id = v_ver) THEN
    RAISE EXCEPTION 'ORCADO2027_PRELIM está BLOQUEADA — retrato do que foi aprovado não se reescreve.';
  END IF;

  -- 1 · a combinação no CC errado ------------------------------------------
  SELECT count(*) INTO n FROM fat_orcado
   WHERE versao_id = v_ver AND linha_id = v_lin AND ano = 2027
     AND empresa_id = v_emp_yy AND filial_id = v_fil_2006 AND cc_id = v_cc_5;

  IF n NOT IN (0, 12) THEN
    RAISE EXCEPTION 'Esperava 12 (ou 0) células em YY·2006·CC5 e achei % — confira antes de apagar.', n;
  END IF;

  IF n = 12 THEN
    -- valor gerado não se apaga por aqui: some na origem e o Aplicar o regrava
    IF EXISTS (SELECT 1 FROM fat_orcado
                WHERE versao_id = v_ver AND linha_id = v_lin AND ano = 2027
                  AND empresa_id = v_emp_yy AND filial_id = v_fil_2006 AND cc_id = v_cc_5
                  AND origem <> 'MANUAL') THEN
      RAISE EXCEPTION 'Há célula NÃO-MANUAL em YY·2006·CC5 — isso se resolve na origem (posto/formulário).';
    END IF;

    DELETE FROM fat_orcado
     WHERE versao_id = v_ver AND linha_id = v_lin AND ano = 2027
       AND empresa_id = v_emp_yy AND filial_id = v_fil_2006 AND cc_id = v_cc_5;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 12 THEN RAISE EXCEPTION 'Apaguei % células em vez de 12 — desfazendo tudo.', n; END IF;
  END IF;

  -- 2 · a gêmea de janeiro -------------------------------------------------
  SELECT count(*) FILTER (WHERE dims ? 'historico'),
         count(*) FILTER (WHERE NOT (dims ? 'historico'))
    INTO n_hist, n_vazio
    FROM fat_orcado
   WHERE versao_id = v_ver AND linha_id = v_lin AND ano = 2027 AND mes = 1
     AND empresa_id = v_emp_05 AND filial_id = v_fil_2001 AND cc_id = v_cc_411
     AND origem = 'MANUAL';

  IF n_hist = 1 AND n_vazio = 1 THEN
    DELETE FROM fat_orcado
     WHERE versao_id = v_ver AND linha_id = v_lin AND ano = 2027 AND mes = 1
       AND empresa_id = v_emp_05 AND filial_id = v_fil_2001 AND cc_id = v_cc_411
       AND origem = 'MANUAL' AND NOT (dims ? 'historico');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'Apaguei % gêmeas em vez de 1 — desfazendo tudo.', n; END IF;
  ELSIF n_hist + n_vazio > 1 THEN
    RAISE EXCEPTION 'Janeiro de 05·2001·411 tem % com histórico e % sem — não é o par esperado, nada foi apagado.',
      n_hist, n_vazio;
  END IF;
END $$;

-- ---------------- conferência: o PRELIM tem de ficar IGUAL à baseline -------
WITH o AS (
  SELECT vo.codigo ver, fo.empresa_id, fo.filial_id, fo.cc_id, fo.mes, fo.valor
    FROM fat_orcado fo
    JOIN versao_orcamento vo ON vo.id = fo.versao_id
    JOIN conta_orcamentaria co ON co.id = fo.linha_id AND co.codigo = '23001'
   WHERE fo.ano = 2027 AND vo.codigo IN ('Orçado2027', 'ORCADO2027_PRELIM')
), r AS (
  SELECT ver,
         count(*) cel,
         count(DISTINCT (empresa_id, filial_id, cc_id)) comb,
         sum(valor) * -1 tot
    FROM o GROUP BY ver
)
SELECT '1 · Custos empresa avião · 2027' AS secao, ver AS versao,
       cel::text || ' células · ' || comb::text || ' combinação(ões)' AS forma,
       to_char(tot, 'FM999G999G990D00') AS total
  FROM r
UNION ALL
SELECT '2 · as duas versões batem?', '',
       CASE WHEN (SELECT count(DISTINCT tot) FROM r) = 1
              AND (SELECT count(*) FROM r) = 2
            THEN '✅ SIM — mesmo total nas duas'
            ELSE '⛔ NÃO — diferença de ' || to_char(
                   (SELECT max(tot) - min(tot) FROM r), 'FM999G999G990D00') END,
       to_char((SELECT max(tot) - min(tot) FROM r), 'FM999G999G990D00')
UNION ALL
SELECT '3 · célula com 2+ lançamentos (2027)', '',
       coalesce((SELECT count(*)::text FROM (
         SELECT 1 FROM fat_orcado fo
           JOIN versao_orcamento vo ON vo.id = fo.versao_id
          WHERE fo.ano = 2027 AND vo.codigo IN ('Orçado2027', 'ORCADO2027_PRELIM')
            AND fo.origem = 'MANUAL'
          GROUP BY fo.versao_id, fo.linha_id, fo.empresa_id, fo.filial_id, fo.cc_id, fo.mes
         HAVING count(*) > 1) z), '0') || ' (esperado: 0)', ''
 ORDER BY 1, 2;
