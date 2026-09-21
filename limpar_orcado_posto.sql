-- ============================================================
-- Desfazer o "Aplicar no orçado" de UMA versão
--
-- Caso: o Aplicar rodou na versão errada e somou-se ao orçado que já existia ali
-- (digitado ou vindo de formulário), duplicando a folha.
--
-- Remove exatamente o que o Aplicar cria, e nada mais:
--   fat_orcado  origem = 'POSTO'     (o orçado por conta)
--   fat_folha   tipo   = 'ORCADO'    (o paralelo por verba)
-- MANUAL e FORMULARIO não são tocados — mesmo recorte que o próprio Aplicar usa
-- para limpar antes de reinserir.
--
-- COMO USAR no SQL Editor do Supabase (que NÃO mostra RAISE NOTICE — por isso
-- tudo aqui é SELECT):
--   1. troque o código da versão nos três lugares marcados «VERSÃO»
--   2. selecione e rode o PASSO 1; leia as duas tabelas
--   3. só então selecione e rode o PASSO 2
--
-- ATENÇÃO: se a versão DEVIA ter orçado de posto, isto o remove por inteiro —
-- rode o "Aplicar no orçado" de novo depois, na versão certa.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASSO 1 — RELATÓRIO (não altera nada)
-- ════════════════════════════════════════════════════════════

-- 1a) o que sai e o que fica
SELECT
  (SELECT codigo FROM versao_orcamento WHERE codigo = 'Orçado')                            AS versao,  -- «VERSÃO»
  (SELECT count(*) FROM fat_orcado f JOIN versao_orcamento v ON v.id = f.versao_id
    WHERE v.codigo = 'Orçado' AND f.origem = 'POSTO')                                      AS sai_orcado_linhas,
  (SELECT coalesce(sum(f.valor), 0) FROM fat_orcado f JOIN versao_orcamento v ON v.id = f.versao_id
    WHERE v.codigo = 'Orçado' AND f.origem = 'POSTO')                                      AS sai_orcado_valor,
  (SELECT count(*) FROM fat_folha f JOIN versao_orcamento v ON v.id = f.versao_id
    WHERE v.codigo = 'Orçado' AND f.tipo = 'ORCADO')                                       AS sai_folha_linhas,
  (SELECT count(*) FROM fat_orcado f JOIN versao_orcamento v ON v.id = f.versao_id
    WHERE v.codigo = 'Orçado' AND f.origem <> 'POSTO')                                     AS fica_linhas,
  (SELECT coalesce(sum(f.valor), 0) FROM fat_orcado f JOIN versao_orcamento v ON v.id = f.versao_id
    WHERE v.codigo = 'Orçado' AND f.origem <> 'POSTO')                                     AS fica_valor;

-- 1b) A PROVA DA DUPLICAÇÃO: contas com orçado de POSTO **e** de outra origem.
--     Vazio aqui = não há duplicação; nesse caso NÃO rode o passo 2, você estaria
--     apagando o único orçado de folha da versão.
SELECT co.codigo AS conta, co.descricao,
       sum(f.valor) FILTER (WHERE f.origem =  'POSTO') AS por_posto,
       sum(f.valor) FILTER (WHERE f.origem <> 'POSTO') AS outras_origens
  FROM fat_orcado f
  JOIN versao_orcamento   v  ON v.id = f.versao_id
  JOIN conta_orcamentaria co ON co.id = f.linha_id
 WHERE v.codigo = 'Orçado'                                                                 -- «VERSÃO»
 GROUP BY co.codigo, co.descricao
HAVING count(*) FILTER (WHERE f.origem =  'POSTO') > 0
   AND count(*) FILTER (WHERE f.origem <> 'POSTO') > 0
 ORDER BY 3 DESC NULLS LAST;

-- 1c) panorama de TODAS as versões — onde mais existe orçado de origem POSTO
SELECT v.codigo AS versao, f.origem, count(*) AS linhas, sum(f.valor) AS valor
  FROM fat_orcado f JOIN versao_orcamento v ON v.id = f.versao_id
 GROUP BY v.codigo, f.origem
 ORDER BY v.codigo, f.origem;


-- ════════════════════════════════════════════════════════════
-- PASSO 2 — EXPURGO
-- Descomente as duas linhas abaixo e rode SÓ elas. Sem desfazer.
-- ════════════════════════════════════════════════════════════

-- DELETE FROM fat_orcado WHERE origem = 'POSTO'
--   AND versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado');   -- «VERSÃO»
-- DELETE FROM fat_folha  WHERE tipo   = 'ORCADO'
--   AND versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado');   -- «VERSÃO»
