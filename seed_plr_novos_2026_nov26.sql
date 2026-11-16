-- ============================================================
-- SEED — PLR prevista para quem entrou em 2026 e ainda não tem
--
-- REGRA (Ricardo, 17/nov/2026), nesta ordem — e a ordem muda o número:
--   1. 50% do salário base
--   2. teto de R$ 4.500 — se os 50% passarem, vale o teto
--   3. proporcional aos meses do ANO ANTERIOR: x/12, contando o mês de
--      admissão como mês inteiro (admitido em setembro = 4/12)
--
-- O passo 3 é o que torna isto necessário: a PLR paga em 2027 remunera o
-- resultado de 2026, e quem entrou no meio de 2026 recebe proporcional. Quem
-- já recebeu PLR em 2026 não entra aqui — já tem valor vindo do realizado.
--
-- ⚠ O TETO NÃO MORDE NINGUÉM NESTE GRUPO: o maior 50% é 2.809,91. Ele está no
-- cálculo porque é a regra, e porque um aumento ou um salário maior entrando
-- depois passaria do teto sem ninguém reparar.
--
-- ⚠ VAGA PLANEJADA FICA DE FORA. `2005-VG01` ("Estagiária") é vaga, não
-- pessoa: não tem admissão, e sem ela não há de que proporcionalizar. Chutar
-- 12/12 seria inventar; chutar zero seria esconder. Quando a vaga virar gente,
-- com data, ela entra pela mesma conta — ou alguém digita o valor na tela.
--
-- ⚠ O ALVO É CALCULADO, não uma lista de códigos: CLT, não demitido e SEM
-- PLR. Assim o seed é re-executável e não ressuscita quem já tem valor — nem
-- sobrescreve um valor digitado à mão depois (ON CONFLICT DO NOTHING).
--
-- ⚠ O RAFAEL (2005-090041) NÃO ESTÁ MAIS AQUI porque o regime dele voltou a
-- BR-PRESTADOR. Se alguém reimportar os postos com um arquivo anterior à regra
-- do regime pela verba, ele vira CLT de novo e PASSA a ser elegível por este
-- seed — que é errado. Regerar o arquivo de postos com o converter atual fecha
-- essa porta.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

WITH t AS (SELECT id FROM tenant ORDER BY criado_em LIMIT 1),
alvo AS (
  SELECT p.id AS posto_id,
         -- meses de 2026 trabalhados, com o mês de admissão inteiro
         greatest(0, least(12, 13 - extract(month from p.admissao)::int)) AS meses,
         least(coalesce(p.salario_base, 0) * 0.5, 4500) AS base_ano
    FROM posto p, t
   WHERE p.tenant_id = t.id
     AND p.regime = 'BR-CLT'
     AND coalesce(nullif(trim(p.sit_folha), ''), 'T') <> 'D'
     AND p.nome IS NOT NULL                       -- vaga planejada não entra
     AND p.admissao IS NOT NULL                   -- sem data não há proporção
     AND extract(year from p.admissao) = 2026     -- quem é de antes já recebeu
     AND NOT EXISTS (SELECT 1 FROM posto_verba pv JOIN verba_folha v ON v.id = pv.verba_id
                      WHERE pv.posto_id = p.id AND v.codigo = '063')
)
INSERT INTO posto_verba (tenant_id, posto_id, verba_id, valor, ativo)
SELECT t.id, a.posto_id, v.id, round(a.base_ano * a.meses / 12, 2), true
  FROM alvo a, t
  JOIN verba_folha v ON v.tenant_id = t.id AND v.codigo = '063'
 WHERE round(a.base_ano * a.meses / 12, 2) > 0
ON CONFLICT (posto_id, verba_id) DO NOTHING;

-- ---------------- conferência ----------------
SELECT 'PLR total (todos)' AS secao,
       (SELECT count(*)::text || ' posto(s) · ' || round(sum(pv.valor),2)::text
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id WHERE v.codigo='063') AS resultado
UNION ALL
SELECT 'PLR de quem NÃO está demitido',
       (SELECT count(*)::text || ' posto(s) · ' || round(sum(pv.valor),2)::text
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id JOIN posto p ON p.id=pv.posto_id
         WHERE v.codigo='063' AND coalesce(nullif(trim(p.sit_folha),''),'T') <> 'D')
UNION ALL
SELECT 'ainda SEM PLR (CLT, em atividade)',
       (SELECT coalesce(string_agg(p.codigo || ' ' || coalesce(p.nome,'(vaga)'), ' · '), 'nenhum')
          FROM posto p
         WHERE p.regime='BR-CLT' AND coalesce(nullif(trim(p.sit_folha),''),'T') <> 'D'
           AND NOT EXISTS (SELECT 1 FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
                            WHERE pv.posto_id=p.id AND v.codigo='063'))
UNION ALL
SELECT 'algum valor acima do teto de 4.500?',
       (SELECT CASE WHEN count(*)=0 THEN 'não' ELSE '⛔ ' || count(*)::text END
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
         WHERE v.codigo='063' AND pv.valor > 4500);
