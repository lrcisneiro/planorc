-- ============================================================
-- SEED — recalcula a PLR para 2027
--
-- POR QUE EXISTE: os valores de hoje vieram do que foi PAGO em 2026, e eles
-- estão errados para 2027 por duas razões diferentes — e a segunda é a maior:
--   · o salário mudou (dissídio, reajuste, promoção);
--   · quem entrou em 2025 recebeu PROPORCIONAL em 2026 e agora recebe o ano
--     cheio, porque trabalhou 2026 inteiro. A Francidalva vai de 2/12 para
--     12/12, o Daniel de 4/12 para 12/12.
--
-- A REGRA, e a ORDEM foi conferida contra o que o ERP pagou em 2026:
--     50% do salário → PISO → TETO → proporção dos meses
-- Três casos bateram ao centavo e provam a ordem: Ana Paula (piso puro,
-- 2.010,00), Jean Carlos (2.010 × 2/12 = 335,00) e Daniel (2.010 × 4/12 =
-- 670,00). ⚠ O PISO VEM ANTES DA PROPORÇÃO: aplicá-lo depois daria 2.010 a
-- quem trabalhou dois meses.
--
-- PARA 2027, os 5% vão no PISO E NO TETO, não no valor final (alternativa (a),
-- decisão do Ricardo em 17/nov):
--     piso  2.010,00 → 2.110,50
--     teto  4.500,00 → 4.725,00
-- ⚠ O argumento é que o SALÁRIO JÁ CARREGA O REAJUSTE: os 50% incidem sobre um
-- salário que já subiu, então 5% no resultado contaria o aumento duas vezes. O
-- que não se reajusta sozinho são o piso e o teto, que são valores fixos.
-- ⚠ E isso pesa mais do que parece: 55 das 96 pessoas caem NO PISO, e para
-- elas a PLR não tem relação nenhuma com o salário — é o piso puro.
--
-- ⚠⚠ ESTE SEED SOBRESCREVE, ao contrário dos anteriores. É o objetivo: os
-- valores atuais são de 2026 e precisam ser substituídos. Se alguém tiver
-- digitado um valor à mão na tela, ele SE PERDE — rode antes de distribuir a
-- tela para ajuste fino, não depois.
--
-- ⚠ Alcance: BR-CLT em atividade. Demitido fica com o valor de 2026, inerte
-- (não entra no Aplicar). Vaga planejada sem admissão fica de fora: sem data
-- não há de que proporcionalizar.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

WITH t AS (SELECT id FROM tenant ORDER BY criado_em LIMIT 1),
alvo AS (
  SELECT p.id AS posto_id,
         CASE WHEN p.admissao IS NULL OR extract(year from p.admissao) < 2026 THEN 12
              WHEN extract(year from p.admissao) > 2026 THEN 0
              ELSE greatest(0, 13 - extract(month from p.admissao)::int) END AS meses,
         least(greatest(coalesce(p.salario_base, 0) * 0.5, 2110.50), 4725.00) AS valor_ano
    FROM posto p, t
   WHERE p.tenant_id = t.id
     AND p.regime = 'BR-CLT'
     AND coalesce(nullif(trim(p.sit_folha), ''), 'T') <> 'D'
     AND p.nome IS NOT NULL
     AND p.admissao IS NOT NULL
)
INSERT INTO posto_verba (tenant_id, posto_id, verba_id, valor, ativo)
SELECT t.id, a.posto_id, v.id, round(a.valor_ano * a.meses / 12, 2), true
  FROM alvo a, t
  JOIN verba_folha v ON v.tenant_id = t.id AND v.codigo = '063'
 WHERE round(a.valor_ano * a.meses / 12, 2) > 0
ON CONFLICT (posto_id, verba_id) DO UPDATE SET valor = EXCLUDED.valor, ativo = true;

-- ---------------- conferência ----------------
SELECT 'PLR 2027 · em atividade' AS secao,
       (SELECT count(*)::text || ' posto(s) · ' || round(sum(pv.valor),2)::text
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id JOIN posto p ON p.id=pv.posto_id
         WHERE v.codigo='063' AND coalesce(nullif(trim(p.sit_folha),''),'T') <> 'D') AS resultado
UNION ALL
SELECT 'no piso (2.110,50 × meses/12)',
       (SELECT count(*)::text FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
          JOIN posto p ON p.id=pv.posto_id
         WHERE v.codigo='063' AND coalesce(nullif(trim(p.sit_folha),''),'T') <> 'D'
           AND coalesce(p.salario_base,0) * 0.5 < 2110.50)
UNION ALL
SELECT 'no teto (4.725,00 × meses/12)',
       (SELECT count(*)::text FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
          JOIN posto p ON p.id=pv.posto_id
         WHERE v.codigo='063' AND coalesce(nullif(trim(p.sit_folha),''),'T') <> 'D'
           AND coalesce(p.salario_base,0) * 0.5 > 4725.00)
UNION ALL
SELECT 'nenhum valor acima do teto?',
       (SELECT CASE WHEN count(*)=0 THEN 'correto' ELSE '⛔ ' || count(*)::text END
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
         WHERE v.codigo='063' AND pv.valor > 4725.00)
UNION ALL
SELECT 'demitidos (ficaram com o valor de 2026)',
       (SELECT count(*)::text || ' posto(s) · ' || round(sum(pv.valor),2)::text
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id JOIN posto p ON p.id=pv.posto_id
         WHERE v.codigo='063' AND coalesce(nullif(trim(p.sit_folha),''),'T') = 'D');
