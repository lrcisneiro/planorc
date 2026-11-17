-- ============================================================
-- Desfaz o rateio DUPLICADO de "Serviços Despachantes" (17/nov/2026, 19:48)
--
-- O rateio CC+EMPRESA gravou 144 células somando 2.400 de uma origem de 1.200:
-- dois cliques, e o segundo somou por cima do primeiro (o botão não travava —
-- consertado com guarda síncrona no mesmo dia).
--
-- Um minuto depois, o rateio só por EMPRESA gravou os 1.200 corretos em CC 111.
-- Esta limpeza apaga SÓ o teste duplicado, devolvendo a linha a 1.200.
--
-- ⚠ Conferido antes: as 216 células da linha foram TODAS escritas entre 19:48 e
-- 19:49 — não há valor anterior aos testes para preservar.
-- ⚠ Recusa versão bloqueada. Termina em SELECT, nunca em RAISE.
-- ============================================================

DELETE FROM fat_orcado o
 USING conta_orcamentaria co, versao_orcamento v, centro_custo cc
 WHERE co.id = o.linha_id AND upper(co.descricao) LIKE '%DESPACHANTE%'
   AND v.id = o.versao_id AND v.codigo = 'Orçado2027' AND v.bloqueada IS NOT TRUE
   AND cc.id = o.cc_id AND cc.codigo IN ('214', '224')
   AND o.ano = 2027 AND o.origem = 'MANUAL';

SELECT 'linha depois da limpeza' AS secao,
       coalesce(cc.codigo, 'sem CC') || ' · ' || count(*) || ' células · ' || round(sum(o.valor), 2)::text AS resultado
  FROM fat_orcado o
  LEFT JOIN centro_custo cc ON cc.id = o.cc_id
 WHERE o.linha_id IN (SELECT id FROM conta_orcamentaria WHERE upper(descricao) LIKE '%DESPACHANTE%')
   AND o.ano = 2027 AND o.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')
 GROUP BY cc.codigo
UNION ALL
SELECT 'TOTAL (esperado -1200,00)',
       round(sum(o.valor), 2)::text || ' em ' || count(*) || ' células'
  FROM fat_orcado o
 WHERE o.linha_id IN (SELECT id FROM conta_orcamentaria WHERE upper(descricao) LIKE '%DESPACHANTE%')
   AND o.ano = 2027 AND o.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027');
