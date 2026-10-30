-- ============================================================
-- Limpar a abertura de folha órfã (sem fato na DRE)
--
-- A conferência do v3_128 achou 20.040 linhas em `Orçado2027_B`/2027, de 311
-- postos: `fat_folha` tipo ORCADO sem nenhuma linha de `fat_orcado` origem
-- POSTO na mesma versão/ano. Sobra do v3_127, que apagava o fato e deixava a
-- abertura para trás.
--
-- ⚠ SÓ FAÇA ISTO SE NÃO FOR REAPLICAR ESSA VERSÃO.
-- O Aplicar já apaga a abertura antiga antes de regravar, então reaplicar
-- `Orçado2027_B` resolve sozinho e devolve o orçado de folha à DRE. Apagar
-- aqui é para quando a versão foi abandonada e o resíduo só atrapalha a
-- Conciliação, que mostraria orçado por posto de uma carga que não existe.
--
-- A primeira parte só MOSTRA. A segunda apaga, e está comentada de propósito:
-- descomente depois de ler o que a primeira devolveu.
-- ============================================================

-- ---------- 1 · o que existe (só leitura) ----------
SELECT v.codigo                                        AS versao,
       g.ano,
       count(*)                                        AS linhas,
       count(DISTINCT g.posto_id)                      AS postos,
       to_char(sum(g.valor), 'FM999G999G990D00')       AS valor,
       min(g.mes) || '–' || max(g.mes)                 AS meses,
       coalesce(v2.bloqueada, false)                   AS versao_bloqueada
  FROM fat_folha g
  JOIN versao_orcamento v  ON v.id = g.versao_id
  LEFT JOIN versao_orcamento v2 ON v2.id = g.versao_id
 WHERE g.tipo = 'ORCADO'
   AND NOT EXISTS (SELECT 1 FROM fat_orcado f
                    WHERE f.versao_id = g.versao_id AND f.ano = g.ano AND f.origem = 'POSTO')
 GROUP BY v.codigo, g.ano, v2.bloqueada
 ORDER BY v.codigo, g.ano;

-- ---------- 2 · apagar (DESCOMENTE para executar) ----------
-- Recortado por versão E ano, e repete a condição de órfã dentro do DELETE —
-- não basta ter conferido antes: entre a leitura e o delete alguém pode ter
-- reaplicado a versão, e aí as linhas deixariam de ser órfãs.
--
-- DELETE FROM fat_folha g
--  USING versao_orcamento v
--  WHERE v.id = g.versao_id
--    AND g.tipo = 'ORCADO'
--    AND v.codigo = 'Orçado2027_B'      -- ajuste
--    AND g.ano = 2027                   -- ajuste
--    AND NOT EXISTS (SELECT 1 FROM fat_orcado f
--                     WHERE f.versao_id = g.versao_id AND f.ano = g.ano AND f.origem = 'POSTO');
