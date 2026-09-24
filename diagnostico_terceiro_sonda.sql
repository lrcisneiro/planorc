-- ============================================================
-- SONDA — por que o diagnóstico do desconto veio vazio
--
-- Uma consulta só, que SEMPRE devolve uma linha. Cada coluna isola um elo da
-- cadeia; o primeiro zero da esquerda para a direita é onde ela se rompe.
-- Só leitura.
-- ============================================================
WITH rel AS (
  SELECT r.id, r.nome FROM relatorio r
    JOIN relatorio_linha rl ON rl.relatorio_id = r.id AND rl.linha_orc_id IS NOT NULL
   WHERE r.tenant_id = current_tenant_id()
   GROUP BY r.id, r.nome ORDER BY count(*) DESC LIMIT 1
)
SELECT
  (SELECT nome FROM rel)                                        AS relatorio_escolhido,
  -- a folha do mês existe? (se zero, a reimportação não chegou)
  (SELECT count(*) FROM fat_folha
    WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
      AND ano = 2026 AND mes = 8)                               AS folha_linhas,
  (SELECT count(DISTINCT lote) FROM fat_folha
    WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
      AND ano = 2026 AND mes = 8)                               AS folha_lotes,
  (SELECT string_agg(DISTINCT coalesce(lote,'(nulo)'), ', ') FROM fat_folha
    WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
      AND ano = 2026 AND mes = 8)                               AS quais_lotes,
  -- o universo de contas do terceiro
  (SELECT count(*) FROM planorc_concil_contas(2026, 8, (SELECT id FROM rel)))  AS contas_terceiro,
  (SELECT count(*) FROM planorc_concil_contas_clt(2026, 8))                    AS contas_clt,
  -- o motor de atribuição: quantos lançamentos, e quantos com dono
  (SELECT count(*) FROM planorc_pj_atribui(2026, 8, (SELECT id FROM rel)))     AS atribui_linhas,
  (SELECT count(*) FROM planorc_pj_atribui(2026, 8, (SELECT id FROM rel))
     WHERE matricula IS NOT NULL)                               AS atribui_com_matricula,
  -- e o bloco montado, que é o que a tela mostra
  (SELECT count(*) FROM conciliacao_terceiros(2026, 8, (SELECT id FROM rel))) AS pessoas_no_bloco;
