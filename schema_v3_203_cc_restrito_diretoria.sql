-- ============================================================
-- v3_203 — a ÁREA DIRETORIA inteira entra na marca
--
-- ⚠⚠ ACHADO NO PRIMEIRO USO REAL (24/nov). Com o modo discreto LIGADO, o
-- quadro "Quem causou a variação" por ÁREA seguia mostrando **Diretoria**
-- separada: −4.009.163 orçado × −4.148.371 realizado. A regra derivada existia
-- e estava certa; o que falhou foi o LIMIAR, e o cadastro era incompleto.
--
-- Medido na área 4, em 2026:
--     411 Diretoria          [restrito]  orç -5.456.229 · real -14.732.507
--     400 Diretoria(Legado)  [LIVRE]                      real    -66.955
-- A parte livre é **0,33%** — e a regra exigia 99,9%. **Um lançamento perdido
-- num CC legado desmascarou um grupo de R$ 14 milhões.**
--
-- Dois consertos, e os dois são necessários:
--   1. a tela passou a usar a **regra de dominância** (80%, ver
--      `lib/discricao.ts`) — resolve o caso que ainda não aconteceu;
--   2. esta migration marca os outros CCs da área 4, que **são Diretoria** —
--      resolve o caso que já existe e deixa a área 100% restrita, sem depender
--      de limiar nenhum.
--
-- ⚠ O recorte é `area_cod = '4'`, não uma lista de códigos: os quatro se
-- chamam "Diretoria" (4 · 41 · 400 legado · 411) e qualquer CC novo ali será
-- Diretoria também. Mas é SEMEADURA, não regra viva — quem manda depois é o
-- cadastro, como na v3_202.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

UPDATE centro_custo SET restrito = true
 WHERE area_cod = '4' AND restrito = false;

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO: a fração LIVRE de cada grupo. É esse número que a tela
-- compara com os 80% — se a área 4 ainda aparecer com sobra, a máscara
-- continua dependendo do limiar em vez do cadastro.
WITH v AS (
  SELECT cc.area_cod a, cc.area_nome an, cc.restrito, abs(f.valor) m
    FROM fat_orcado f JOIN centro_custo cc ON cc.id = f.cc_id
   WHERE f.ano IN (2026, 2027) AND cc.area_cod IS NOT NULL
  UNION ALL
  SELECT cc.area_cod, cc.area_nome, cc.restrito, abs(f.valor)
    FROM fat_realizado f JOIN centro_custo cc ON cc.id = f.cc_id
   WHERE f.ano IN (2026, 2027) AND cc.area_cod IS NOT NULL
)
SELECT '1·CCs restritos' AS secao,
       (SELECT string_agg(codigo || ' ' || descricao, ' · ' ORDER BY codigo)
          FROM centro_custo WHERE restrito) AS resultado
UNION ALL
SELECT '2·share RESTRITO por área (o que a regra de 80% vê)',
       (SELECT string_agg(a || ' ' || an || ' = ' || pc::text || '%', ' | ' ORDER BY pc DESC)
          FROM (SELECT a, max(an) an, round(100.0 * sum(m) FILTER (WHERE restrito) / nullif(sum(m), 0), 2) pc
                  FROM v GROUP BY a) x)
UNION ALL
SELECT '3·a área 4 ficou 100%?',
       (SELECT CASE WHEN round(100.0 * sum(m) FILTER (WHERE restrito) / nullif(sum(m), 0), 2) >= 100
                    THEN 'sim — não depende mais de limiar'
                    ELSE '⚠ ainda ' || round(100.0 * sum(m) FILTER (WHERE restrito) / nullif(sum(m), 0), 2)::text
                         || '% — sobrou CC livre na área' END
          FROM v WHERE a = '4')
ORDER BY 1;
