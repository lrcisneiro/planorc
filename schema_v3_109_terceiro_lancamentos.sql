-- ============================================================
-- 109 — Os lançamentos do razão, um a um, no terceiro
--
-- Ricardo, olhando o VILSON POSSAMAI: "está aglutinando os dados. No ERP estão
-- em vários lançamentos e para conciliação seria interessante abrir."
--
-- Estava mesmo. `conciliacao_terceiros_pessoa` agrupa por empresa·filial·CC e
-- colapsa o resto — string_agg nas contas e nos documentos, max() no histórico,
-- sum() no valor. A linha dele soma 20.950,83, que no Protheus são QUATRO
-- lançamentos, em duas datas e dois documentos:
--
--     13/08  doc 000001   14.176,75
--     13/08  doc 000002      502,93
--     21/08  doc 000001    6.051,66
--     21/08  doc 000002      219,49
--
-- A diferença de 6.271,15 contra a folha pode estar inteira numa das notas, e
-- do jeito que está não há como saber sem ir ao ERP. O dado nunca faltou:
-- planorc_pj_atribui já devolve data, documento, histórico e lote por linha —
-- o GROUP BY é que jogava fora.
--
-- Por que uma função NOVA em vez de abrir mais um nível na existente: aquela
-- tabela compara folha e razão LADO A LADO, coluna a coluna. Lançamento não
-- tem contrapartida do lado da folha (lá o grão final é conta × verba), então
-- acrescentar linhas ali quebraria a leitura que faz o quadro funcionar. Isto
-- aqui é outro drill, para outra pergunta: "de que notas esse número é feito?"
--
-- Devolve TODOS os lançamentos da pessoa no período, com empresa/filial/CC em
-- cada um — a tela agrupa como quiser, e o total fecha com a linha de origem.
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_terceiros_lanc(int, int, uuid, uuid, text, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_lanc(
  p_ano int, p_mes int, p_relatorio_id uuid, p_filial_id uuid, p_matricula text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  empresa_cod text, filial_cod text, cc_cod text,
  data date, documento text, conta_cod text, conta_desc text,
  historico text, lote text, via text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT e.codigo, fl.codigo, ccu.codigo,
         a.data, a.documento, cc.codigo, cc.descricao,
         a.historico, a.lote, a.via, a.valor::numeric
    FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
    JOIN conta_contabil cc ON cc.id = a.conta_id
    LEFT JOIN empresa e   ON e.id   = a.lanc_empresa_id
    LEFT JOIN filial  fl  ON fl.id  = a.lanc_filial_id
    LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
   WHERE a.matricula = p_matricula
     AND a.filial_id IS NOT DISTINCT FROM p_filial_id
   ORDER BY a.data, a.documento, a.valor DESC;
$$;
