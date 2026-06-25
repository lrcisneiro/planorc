-- ============================================================
-- 041 — Indicadores passam a ser identificados pelo TIPO da linha.
-- Converte as linhas de apoio (nao_soma) que são FÓRMULA em tipo INDICADOR.
-- INDICADOR já fica fora do SOMAR_FILHOS na engine (mesmo efeito do nao_soma),
-- então a totalização não muda. O gatilho de "aparece no dashboard" passa a ser
-- tipo_linha = 'INDICADOR'; o filtro_escopo (CC) continua opcional.
--
-- Mantém nao_soma como está (linhas analíticas de apoio, se houver, seguem
-- funcionando). IDEMPOTENTE.
-- ============================================================
UPDATE relatorio_linha
   SET tipo_linha = 'INDICADOR'
 WHERE nao_soma = true
   AND tipo_linha = 'FORMULA';
