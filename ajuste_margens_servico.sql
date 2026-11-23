-- ============================================================
-- Ajuste de CADASTRO (não é migration): as fórmulas de margem da DRE
-- Gerencial. Rode no SQL Editor. Re-executável. Termina em SELECT.
--
-- ⚠ Isto MUDA NÚMERO QUE A DIRETORIA JÁ VIU. Rode primeiro a seção "antes ×
-- depois" no fim do arquivo, confira, e só então aplique.
--
-- DOIS DEFEITOS, que se compensavam parcialmente:
--
-- 1. O `%` dividia pela receita BRUTA. O numerador (`Margem Serviço`) já era
--    líquido de imposto (`+[130]`, negativo) e de reembolso (`−[111]`), mas o
--    denominador era só `([1]-[111])`. Percentual SUBESTIMADO.
--
-- 2. ⚠⚠ OS DOIS ESCOPOS ERAM DIFERENTES. `Margem Serviço` (valor) roda em
--    `area:[3]` — todas as BUs — e `Margem Serviço(%)` rodava em `area:[3]` +
--    `bu:[1,3,4,5,6,8]`. Medido em 2027: a área 3 inteira tem R$ 66.150.794 de
--    receita e as seis BUs somam R$ 56.969.439 — **14% fora do denominador**.
--    Numerador cobrindo a área toda sobre denominador cobrindo 86% dela:
--    percentual INFLADO. Como o defeito 1 puxava para baixo e o 2 para cima, o
--    número final parecia razoável — foi assim que os dois sobreviveram.
--
-- ⚠ `cc` no `filtro_escopo` guarda **uuid**; `area`, `bu` e `divisao` guardam
-- **código**. Pôr '317' em `cc` não filtra nada e não dá erro.
-- ============================================================

-- ── 1 · Margem Serviço(%) ───────────────────────────────────────────────
-- denominador = receita LÍQUIDA de serviços:
--   [1] receitas − [111] reembolso + [130] impostos − [Lmqrzyy5k] imposto do
--   reembolso (que volta, porque o reembolso já saiu da receita).
UPDATE relatorio_linha
   SET expressao    = '=[Lmqpa03fd]/([1]-[111]+[130]-[Lmqrzyy5k])*100',
       filtro_escopo = '{"bu": [], "cc": [], "area": ["3"]}'::jsonb
 WHERE codigo = 'Lmqpa649u';

-- ── 2 · Margem Sustentação — mesmo comportamento, recorte no CC 317 ─────
-- ⚠ A fórmula antiga (`[1]-[111]+[201]+[202]+[203]`) só descontava FOLHA:
-- nem imposto, nem as demais despesas. "O mesmo comportamento" da Serviço
-- significa a mesma estrutura — por isso ela passa a descontar imposto e todas
-- as despesas menos viagens. **O valor vai mudar, e para menos.**
UPDATE relatorio_linha
   SET expressao    = '=([1]-[111]+[130])+([2]-[205])+[Lmqrzyy5k]',
       filtro_escopo = '{"bu": [], "area": [], "cc": ["02210ef5-3624-4460-bfc3-40fef0ea3c93"]}'::jsonb
 WHERE codigo = 'Lmqpc7xaz';

UPDATE relatorio_linha
   SET expressao    = '=[Lmqpc7xaz]/([1]-[111]+[130]-[Lmqrzyy5k])*100',
       filtro_escopo = '{"bu": [], "area": [], "cc": ["02210ef5-3624-4460-bfc3-40fef0ea3c93"]}'::jsonb
 WHERE codigo = 'Lmqpd4u6g'    -- Margem Sustentação(%)
    OR codigo IN (SELECT codigo FROM relatorio_linha
                   WHERE descricao ILIKE 'Margem Sustenta%(%)'
                     AND relatorio_id = '62f72019-fe95-4269-ab54-2ffebe6bb628');

-- ---------------- conferência ----------------
SELECT '· ' || descricao AS secao,
       expressao || '   |   escopo ' || coalesce(filtro_escopo::text, '—') AS resultado
  FROM relatorio_linha
 WHERE relatorio_id = '62f72019-fe95-4269-ab54-2ffebe6bb628'
   AND descricao ILIKE 'Margem S%'
UNION ALL
SELECT '⚠ Sustentação está DENTRO de Serviço',
       'o CC 317 tem area_cod=3, então a área 3 o inclui — os dois indicadores '
       || 'se sobrepõem, e isso é escolha de cadastro, não defeito'
UNION ALL
SELECT '— receita 2027 · área 3 (Serviço)',
       (SELECT to_char(sum(f.valor), 'FM999G999G999') FROM fat_orcado f
          JOIN centro_custo cc ON cc.id = f.cc_id
          JOIN relatorio_linha rl ON rl.linha_orc_id = f.linha_id
           AND rl.relatorio_id = '62f72019-fe95-4269-ab54-2ffebe6bb628'
         WHERE f.ano = 2027 AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')
           AND cc.area_cod = '3' AND rl.natureza = 'RECEITA')
UNION ALL
SELECT '— receita 2027 · CC 317 (Sustentação)',
       (SELECT to_char(sum(f.valor), 'FM999G999G999') FROM fat_orcado f
          JOIN centro_custo cc ON cc.id = f.cc_id
          JOIN relatorio_linha rl ON rl.linha_orc_id = f.linha_id
           AND rl.relatorio_id = '62f72019-fe95-4269-ab54-2ffebe6bb628'
         WHERE f.ano = 2027 AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')
           AND cc.codigo = '317' AND rl.natureza = 'RECEITA')
 ORDER BY 1;
