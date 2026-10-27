-- ============================================================
-- 119 — Rescisão: ajustes depois de ver o catálogo BR real (out/2026)
--
-- O catálogo do tenant mostrou três coisas que a v3_118 não previu:
--
-- 1) FALTAVA O INSS SOBRE O 13º PROPORCIONAL.
--    O padrão da casa é explícito: `A37 INSS s/ prov. 13º` = 26,8% sobre A36
--    (20 INSS + 1 RAT + 5,8 Terceiros). Na rescisão o 13º proporcional tem INSS
--    igual; o que NÃO tem é o aviso prévio indenizado (não integra o salário de
--    contribuição) nem as férias indenizadas. Daí a nova verba incidir SÓ sobre
--    RESC_13 — e o FGTS (RESC_FGTS_V) continuar sobre aviso + 13º, porque esse
--    é devido nos dois.
--
-- 2) COLISÃO DE ORDEM: RESC_AVISO nasceu em 70, igual a `A36 Provisão 13º`.
--    Hoje não quebra (ninguém referencia ninguém ali), mas a cascata resolve
--    referência PELA ORDEM e empate é bug esperando. Vão para 200+.
--
-- 3) NÃO HÁ PROVISÃO MENSAL DE RESCISÃO — `RESC (interna Planorc)` está
--    inativa, e o Ricardo confirmou: "não fazemos provisão de rescisão".
--    Então sem risco de dupla contagem; o custo cai no mês da saída.
--
-- Mais: as verbas de rescisão do ERP já existem como INFORMATIVA (`057` Aviso
-- Previo Indeniz, `A28` Fgts Mes Rescisao, `A29` Fgts-Art.22 40% Mult). São o
-- lado REALIZADO. Este script (a) herda a conta de destino delas quando têm, e
-- (b) grava o de-para em `aglutina_em` — ERP → verba orçamentária, a direção
-- que a v3_054 definiu. ⚠ `aglutina_em` hoje é só CADASTRO: nenhuma tela o
-- consome ainda. Fica registrado para quando a conciliação por verba usar.
--
-- IDEMPOTENTE. Termina com UM select de conferência (o SQL Editor só mostra o
-- resultado da última instrução).
-- ============================================================

-- ---------- 1 · INSS sobre o 13º proporcional da rescisão ----------
INSERT INTO verba_folha
  (tenant_id, codigo, descricao, tipo_calculo, parametro, verba_ref, incide_encargos, mantem_afastado, ordem, regime, pais, categoria, ativo)
SELECT tenant_id, 'RESC_INSS_13', 'INSS 26,8% sobre o 13º proporcional (rescisão)',
       'PCT_VERBA', 26.8, 'RESC_13', false, true, 204, 'BR-CLT', 'BR', 'RESCISAO', true
  FROM verba_folha WHERE codigo = 'RESC_13'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- ---------- 2 · ordem sem colisão ----------
UPDATE verba_folha v SET ordem = o.ordem
  FROM (VALUES ('RESC_AVISO', 200), ('RESC_13', 201), ('RESC_FER', 202),
               ('RESC_FGTS40', 203), ('RESC_INSS_13', 204), ('RESC_FGTS_V', 205)
  ) AS o(codigo, ordem)
 WHERE v.codigo = o.codigo AND v.ordem IS DISTINCT FROM o.ordem;

-- ---------- 3 · conta de destino, herdada da verba análoga ----------
-- Só preenche o que está NULO — nunca sobrescreve uma amarração sua.
-- A ordem do COALESCE é a preferência: primeiro a verba do ERP que recebe o
-- REALIZADO daquela parcela (para orçado e realizado caírem na mesma conta da
-- DRE), depois a provisão mensal equivalente, e por último o salário.
WITH c AS (
  SELECT codigo, conta_destino_id FROM verba_folha WHERE conta_destino_id IS NOT NULL
), alvo AS (
  SELECT 'RESC_AVISO'   AS cod, COALESCE((SELECT conta_destino_id FROM c WHERE codigo = '057'),
                                         (SELECT conta_destino_id FROM c WHERE codigo = '001')) AS conta
  UNION ALL SELECT 'RESC_13',    COALESCE((SELECT conta_destino_id FROM c WHERE codigo = 'A36'),
                                          (SELECT conta_destino_id FROM c WHERE codigo = '001'))
  UNION ALL SELECT 'RESC_FER',   COALESCE((SELECT conta_destino_id FROM c WHERE codigo = 'A30'),
                                          (SELECT conta_destino_id FROM c WHERE codigo = '001'))
  UNION ALL SELECT 'RESC_FGTS40',COALESCE((SELECT conta_destino_id FROM c WHERE codigo = 'A29'),
                                          (SELECT conta_destino_id FROM c WHERE codigo = 'A09'))
  UNION ALL SELECT 'RESC_FGTS_V',COALESCE((SELECT conta_destino_id FROM c WHERE codigo = 'A28'),
                                          (SELECT conta_destino_id FROM c WHERE codigo = 'A38'),
                                          (SELECT conta_destino_id FROM c WHERE codigo = 'A09'))
  UNION ALL SELECT 'RESC_INSS_13',COALESCE((SELECT conta_destino_id FROM c WHERE codigo = 'A37'),
                                           (SELECT conta_destino_id FROM c WHERE codigo = 'A48'))
)
UPDATE verba_folha v SET conta_destino_id = a.conta
  FROM alvo a
 WHERE v.codigo = a.cod AND v.conta_destino_id IS NULL AND a.conta IS NOT NULL;

-- ---------- 4 · de-para ERP → orçamentária (cadastro; nada consome ainda) ----------
UPDATE verba_folha v SET aglutina_em = d.para
  FROM (VALUES ('057', 'RESC_AVISO'), ('A29', 'RESC_FGTS40'), ('A28', 'RESC_FGTS_V')
  ) AS d(codigo, para)
 WHERE v.codigo = d.codigo AND v.aglutina_em IS NULL;

-- ---------- conferência (UMA consulta, que é o que o editor mostra) ----------
SELECT v.ordem, v.codigo, v.descricao, v.tipo_calculo, v.parametro, v.verba_ref,
       c.codigo AS conta_destino, c.descricao AS conta_desc,
       CASE WHEN v.conta_destino_id IS NULL
            THEN '*** AMARRAR A MÃO: nao vai ao orcado ***' ELSE 'ok' END AS situacao
  FROM verba_folha v
  LEFT JOIN conta_orcamentaria c ON c.id = v.conta_destino_id
 WHERE v.codigo LIKE 'RESC\_%'
 ORDER BY v.ordem;
