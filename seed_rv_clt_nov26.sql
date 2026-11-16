-- ============================================================
-- SEED — a remuneração variável do CLT entra no orçado
--
-- POR QUE EXISTE: a pessoa da folha escreveu, conferindo o cadastro, que "os
-- valores dos CLT's de Serviços só informam o valor do salário fixo, RV
-- variável não". Está certa. É o mesmo defeito que acabamos de corrigir do
-- lado do prestador, do lado CLT:
--     623 PREMIO .................. 63 pessoas em 2026 · R$ 69.892,10/mês
--     624 DIFERENÇA DE PRÊMIO ..... 34 pessoas         · R$ 19.192,62/mês
--
-- ⚠ A 623 EXISTIA E RENDIA ZERO, que é pior que não existir: está como
-- `PCT_BASE` com `parametro` NULO, e `baseEncargos * NULL/100` dá zero. O
-- cadastro mostrava a verba, o motor somava nada, e ninguém via diferença
-- entre "configurada" e "configurada errada". A 624 é `INFORMATIVA`, que o
-- motor descarta.
--
-- ⚠⚠ DIFERENÇA ESSENCIAL PARA O PRESTADOR: aqui `incide_encargos` fica
-- **TRUE**. Prêmio recorrente de CLT tem natureza salarial — são 21 a 47
-- pessoas TODO mês, não um prêmio eventual —, então INSS, FGTS, 13º e férias
-- incidem. As dez verbas do prestador ficaram com `false` porque prestador não
-- gera encargo trabalhista. Trocar isso por descuido erraria R$ 42 mil/mês.
-- ⚠ Se a empresa enquadrar o prêmio na exceção do art. 457 §2 da CLT (até 2x
-- por ano, desempenho superior), aí não incide — mas o dado diz recorrente, e
-- recorrente é salário.
--
-- ⚠ A ORDEM IMPORTA E NÃO É ENFEITE: `baseEncargos` acumula na sequência de
-- `ordem`, então verba que gera encargo precisa vir ANTES dos encargos. A 623
-- já está em 15 (o A48 está em 20) — a 624 vai para 17 pelo mesmo motivo.
-- Deixá-la em 520, onde está hoje, faria o valor entrar no custo e NÃO gerar
-- encargo: certo no total da verba, errado em R$ 10 mil/mês de INSS e FGTS.
--
-- A conta já estava certa nas duas (`20101`), e confere com o realizado.
--
-- O VALOR é a média de 2026 por pessoa (jan–set, julho fora por vir incompleto
-- no `srd`), dividida pelos meses em que a pessoa aparece na folha.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1. catálogo ───────────────────────────────────────────────────────────
UPDATE verba_folha SET tipo_calculo = 'VALOR_FIXO', parametro = NULL,
       regime = 'BR-CLT', categoria = 'SALARIO', incide_encargos = true, ordem = 15
 WHERE codigo = '623';

UPDATE verba_folha SET tipo_calculo = 'VALOR_FIXO', parametro = NULL,
       regime = 'BR-CLT', categoria = 'SALARIO', incide_encargos = true, ordem = 17,
       conta_destino_id = coalesce(conta_destino_id,
         (SELECT id FROM conta_orcamentaria WHERE codigo='20101' AND tenant_id=verba_folha.tenant_id))
 WHERE codigo = '624';

-- ── 2. valor por posto ────────────────────────────────────────────────────
WITH t AS (SELECT id FROM tenant ORDER BY criado_em LIMIT 1),
dados(posto_cod, verba_cod, valor) AS (VALUES
    ('2002-000002', '623', 2116.13),
    ('2002-000004', '623', 2525.81),
    ('2002-000027', '623', 1429.08),
    ('2002-000031', '623', 397.34),
    ('2002-000032', '623', 406.28),
    ('2002-000033', '623', 399.66),
    ('2002-000035', '623', 360.00),
    ('2003-000001', '623', 1696.35),
    ('2003-000005', '624', 1636.54),
    ('2003-000029', '624', 493.91),
    ('2003-000030', '623', 385.00),
    ('2003-000031', '623', 384.00),
    ('2003-000032', '623', 357.50),
    ('2005-000005', '623', 199.66),
    ('2005-000006', '623', 273.39),
    ('2005-000009', '623', 1057.79),
    ('2005-000009', '624', 1221.72),
    ('2005-000011', '624', 84.88),
    ('2005-000034', '623', 167.31),
    ('2005-000036', '623', 254.00),
    ('2006-000001', '623', 672.68),
    ('2006-000004', '623', 869.37),
    ('2006-000007', '623', 36.30),
    ('2006-000008', '623', 650.00),
    ('2006-000011', '623', 1189.44),
    ('2006-000013', '623', 15986.23),
    ('2006-000016', '623', 3049.97),
    ('2006-000017', '623', 6.83),
    ('2101-000002', '623', 1646.67),
    ('2101-000003', '623', 1783.35),
    ('2101-000005', '623', 63.09),
    ('2101-000005', '624', 873.55),
    ('2101-000009', '623', 84.22),
    ('2101-000009', '624', 1353.86),
    ('2101-000016', '623', 115.37),
    ('2101-000023', '623', 314.27),
    ('2101-000032', '623', 207.33),
    ('2101-000032', '624', 152.80),
    ('2101-000046', '623', 531.43),
    ('2101-000046', '624', 95.58),
    ('2101-000058', '623', 224.00),
    ('2101-000059', '624', 42.30),
    ('2101-000060', '624', 140.88),
    ('2101-000062', '623', 56.98),
    ('2101-000062', '624', 596.90),
    ('2101-000066', '623', 145.07),
    ('2101-000066', '624', 304.65),
    ('2101-000073', '623', 9134.49),
    ('2101-000073', '624', 127.67),
    ('2101-000081', '623', 158.49),
    ('2101-000083', '623', 29.02),
    ('2101-000083', '624', 58.03),
    ('2101-000091', '623', 628.34),
    ('2101-000091', '624', 46.53),
    ('2101-000094', '623', 505.50),
    ('2101-000094', '624', 40.75),
    ('2101-000095', '623', 547.25),
    ('2101-000098', '624', 14.51),
    ('2101-000105', '624', 135.40),
    ('2101-000106', '624', 19.34),
    ('2101-000108', '623', 800.00),
    ('2101-000108', '624', 265.34),
    ('2101-000109', '623', 147.03),
    ('2101-000111', '623', 174.09),
    ('2101-000112', '623', 158.40),
    ('2102-000003', '624', 8831.76),
    ('2501-000001', '623', 73.17),
    ('2501-000001', '624', 477.88))
INSERT INTO posto_verba (tenant_id, posto_id, verba_id, valor, ativo)
SELECT (SELECT id FROM t), p.id, v.id, d.valor, true
  FROM dados d
  JOIN posto p ON p.codigo = d.posto_cod AND p.tenant_id = (SELECT id FROM t)
  JOIN verba_folha v ON v.codigo = d.verba_cod AND v.tenant_id = (SELECT id FROM t)
 WHERE v.tipo_calculo = 'VALOR_FIXO'   -- guarda: se o passo 1 não rodou, não grava calado
ON CONFLICT (posto_id, verba_id) DO UPDATE SET valor = EXCLUDED.valor, ativo = true;

-- ---------------- conferência ----------------
SELECT 'RV do CLT no cadastro' AS secao,
       (SELECT coalesce(string_agg(t,' · '),'nada') FROM (
          SELECT v.codigo || ': ' || count(*)::text || ' posto(s) · R$ '
                 || round(sum(pv.valor),2)::text || '/mês' AS t
            FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id
           WHERE pv.ativo AND v.codigo IN ('623','624') GROUP BY v.codigo ORDER BY v.codigo) q) AS resultado
UNION ALL
SELECT 'as duas geram encargo e vêm ANTES deles?',
       (SELECT CASE WHEN bool_and(incide_encargos AND ordem < 20) THEN 'sim — correto'
                    ELSE '⛔ ' || string_agg(codigo || ' ordem=' || ordem::text || ' enc=' || incide_encargos::text, ', ') END
          FROM verba_folha WHERE codigo IN ('623','624'))
UNION ALL
SELECT 'nenhuma ficou PCT_BASE sem parâmetro?',
       (SELECT CASE WHEN count(*)=0 THEN 'correto'
                    ELSE '⛔ ' || string_agg(codigo,', ') || ' rende ZERO' END
          FROM verba_folha WHERE ativo AND tipo_calculo='PCT_BASE' AND parametro IS NULL)
UNION ALL
SELECT 'conta de destino das duas',
       (SELECT string_agg(DISTINCT c.codigo || ' ' || c.descricao, ' · ')
          FROM verba_folha v JOIN conta_orcamentaria c ON c.id=v.conta_destino_id
         WHERE v.codigo IN ('623','624'));
