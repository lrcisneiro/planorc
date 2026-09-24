-- ============================================================
-- Diagnóstico pós-fila — ago/2026
--
-- Confirma no dado os três fechamentos: a folha confidencial entrou sem
-- encostar na folha normal, o DIJAN ficou como decidido, e o par 950001/950100
-- parou de inflar o item na DRE.
--
-- Rode inteiro no SQL Editor do Supabase. Só leitura, nada aqui escreve.
-- O relatório é escolhido sozinho (o que tem mais linhas amarradas a master) e
-- a consulta 0 diz qual foi — se pegou o errado, é só trocar o subselect.
-- ============================================================

-- 0) qual relatório este diagnóstico está usando como DRE
SELECT r.id, r.nome, count(rl.id) AS linhas_com_item
  FROM relatorio r
  JOIN relatorio_linha rl ON rl.relatorio_id = r.id AND rl.linha_orc_id IS NOT NULL
 WHERE r.tenant_id = current_tenant_id()
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- ── 1. A folha confidencial entrou e a normal não foi tocada ──
-- Os dois lotes têm de conviver. Se FOLHA mudou de tamanho, a importação do
-- confidencial passou por cima de quem não devia.
SELECT coalesce(lote, '(sem lote)') AS lote,
       count(*) AS linhas,
       count(DISTINCT (filial_id::text || '|' || matricula)) AS pessoas,
       to_char(sum(valor), 'FM999G999G990D00') AS valor
  FROM fat_folha
 WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
   AND ano = 2026 AND mes = 8
 GROUP BY 1 ORDER BY 1;

-- ── 2. Quem está no lote CONFIDENCIAL, verba a verba ──
-- Confere as matrículas fictícias 8xxxxx e o CC em que cada um caiu.
SELECT ff.matricula, left(ff.nome, 26) AS nome,
       btrim(coalesce(ff.verba_cod, '')) AS verba, left(coalesce(ff.verba_desc, ''), 22) AS verba_desc,
       cc.codigo AS conta, ccu.codigo AS cc, f.codigo AS filial,
       to_char(ff.valor, 'FM999G999G990D00') AS valor
  FROM fat_folha ff
  LEFT JOIN conta_contabil cc  ON cc.id  = ff.conta_id
  LEFT JOIN centro_custo   ccu ON ccu.id = ff.cc_id
  LEFT JOIN filial         f   ON f.id   = ff.filial_id
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
   AND ff.ano = 2026 AND ff.mes = 8 AND ff.lote = 'CONFIDENCIAL'
 ORDER BY ff.matricula, verba;

-- ── 3. DIJAN: folha × razão ──
-- Era o caso das duas linhas de 40.000 (verbas 228 e 230) contra 75.000 no
-- razão. A primeira coluna é o que a folha diz hoje.
SELECT 'folha' AS lado, btrim(coalesce(ff.verba_cod, '')) AS verba,
       coalesce(ff.lote, '(sem lote)') AS detalhe, count(*) AS n,
       to_char(sum(ff.valor), 'FM999G999G990D00') AS valor
  FROM fat_folha ff
 WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
   AND ff.ano = 2026 AND ff.mes = 8 AND planorc_norm_txt(ff.nome) LIKE '%DIJAN%'
 GROUP BY 1, 2, 3
UNION ALL
SELECT 'razão', btrim(split_part(coalesce(fr.historico, ''), '-', 1)),
       left(coalesce(fr.historico, ''), 30), count(*),
       to_char(sum(-fr.valor), 'FM999G999G990D00')
  FROM fat_realizado fr
 WHERE fr.tenant_id = current_tenant_id() AND fr.ano = 2026 AND fr.mes = 8
   AND planorc_norm_txt(coalesce(fr.historico, '')) LIKE '%DIJAN%'
 GROUP BY 1, 2, 3
 ORDER BY 1, 2;

-- ── 4. O par 950001 / 950100 ──
-- As duas têm de estar no MESMO master e com sinais que se anulem; senão a
-- linha da DRE inflava em ±272 mil. razao_dre já vem com o sinal da amarração.
-- o razão vem por subselect, não por join: conta amarrada a dois masters
-- devolve duas linhas aqui, e um join multiplicaria o valor por elas.
SELECT cc.codigo AS conta, left(cc.descricao, 30) AS descricao, cc.natureza,
       co.codigo AS item_cod, left(co.descricao, 26) AS item, cl.sinal,
       to_char(rz.v, 'FM999G999G990D00') AS razao_bruto,
       to_char(rz.v * coalesce(cl.sinal, 1), 'FM999G999G990D00') AS razao_dre
  FROM conta_contabil cc
  LEFT JOIN conta_linha cl ON cl.conta_id = cc.id AND cl.tenant_id = cc.tenant_id
  LEFT JOIN conta_orcamentaria co ON co.id = cl.linha_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(-fr.valor), 0) AS v FROM fat_realizado fr
     WHERE fr.tenant_id = cc.tenant_id AND fr.conta_id = cc.id
       AND fr.ano = 2026 AND fr.mes = 8
  ) rz
 WHERE cc.tenant_id = current_tenant_id() AND cc.codigo IN ('950001', '950100')
 ORDER BY 1;

-- ── 5. O placar da conciliação, sem filtro de escopo ──
-- Comparar com o medido antes da fila:
--   CLT       130 pares, 31 fora, dif -59.778,48
--   Terceiros 201 conciliados,     dif -25.061,29
SELECT 'CLT' AS bloco, count(*) AS linhas,
       count(*) FILTER (WHERE abs(razao - folha) > 1) AS fora_da_tolerancia,
       to_char(sum(razao), 'FM999G999G990D00') AS razao,
       to_char(sum(folha), 'FM999G999G990D00') AS folha,
       to_char(sum(razao - folha), 'FM999G999G990D00') AS diferenca
  FROM conciliacao_clt(2026, 8, (SELECT r.id FROM relatorio r
                                   JOIN relatorio_linha rl ON rl.relatorio_id = r.id AND rl.linha_orc_id IS NOT NULL
                                  WHERE r.tenant_id = current_tenant_id()
                                  GROUP BY r.id ORDER BY count(*) DESC LIMIT 1))
UNION ALL
SELECT 'Terceiros', count(*),
       count(*) FILTER (WHERE status <> 'CASADO'),
       to_char(sum(razao), 'FM999G999G990D00'),
       to_char(sum(folha), 'FM999G999G990D00'),
       to_char(sum(razao - folha), 'FM999G999G990D00')
  FROM conciliacao_terceiros(2026, 8, (SELECT r.id FROM relatorio r
                                         JOIN relatorio_linha rl ON rl.relatorio_id = r.id AND rl.linha_orc_id IS NOT NULL
                                        WHERE r.tenant_id = current_tenant_id()
                                        GROUP BY r.id ORDER BY count(*) DESC LIMIT 1));

-- ── 6. Terceiros: o bloco bate com a DRE, item por item? ──
-- Antes da fila: Terceiros Internos = 3.923.452,53 dos dois lados.
SELECT left(coalesce(linha_desc, 'Sem item'), 32) AS item,
       to_char(razao_bloco, 'FM999G999G990D00') AS bloco,
       to_char(razao_item,  'FM999G999G990D00') AS dre,
       to_char(razao_item - razao_bloco, 'FM999G999G990D00') AS fora,
       item_completo AS terceiro_cobre_o_item
  FROM conciliacao_terceiros_total(2026, 8, (SELECT r.id FROM relatorio r
                                               JOIN relatorio_linha rl ON rl.relatorio_id = r.id AND rl.linha_orc_id IS NOT NULL
                                              WHERE r.tenant_id = current_tenant_id()
                                              GROUP BY r.id ORDER BY count(*) DESC LIMIT 1))
 ORDER BY linha_ordem NULLS LAST;

-- ── 7. O achado que ficou para depois: diretoria no CC 111 ──
-- Não é da fila, é só para saber se mudou de tamanho com o confidencial dentro.
SELECT ccu.codigo AS cc, left(ccu.descricao, 26) AS centro_custo,
       count(*) AS lancamentos,
       to_char(sum(-fr.valor), 'FM999G999G990D00') AS valor
  FROM fat_realizado fr
  LEFT JOIN centro_custo ccu ON ccu.id = fr.cc_id
 WHERE fr.tenant_id = current_tenant_id() AND fr.ano = 2026 AND fr.mes = 8
   AND planorc_norm_txt(coalesce(fr.historico, '')) LIKE '%DIRETORIA%'
 GROUP BY 1, 2 ORDER BY 3 DESC;
