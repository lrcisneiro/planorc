-- ============================================================
-- Expurgo das contas de UM plano de contas
--
-- Uso: plano importado errado que precisa ser refeito do zero. Apaga as contas
-- do plano; o plano em si continua (vazio, pronto para reimportar), porque
-- empresa.plano_id é ON DELETE SET NULL — apagar o plano desamarraria a empresa
-- em silêncio, e descobrir isso depois custa caro.
--
-- COMO USAR no SQL Editor do Supabase (que NÃO mostra RAISE NOTICE — por isso
-- tudo aqui é SELECT):
--   1. troque o código do plano nos lugares marcados «PLANO»
--   2. selecione e rode o PASSO 1; leia as tabelas
--   3. só então selecione e rode o PASSO 2
--
-- O que sai junto, por CASCADE: conta_linha (amarração), fat_saldo (balancete),
-- conciliacao_folha_nota (justificativas). verba.conta_destino_id vira NULL.
-- O que BLOQUEIA: fat_realizado e fat_folha — FK sem cascade, de propósito. Se
-- houver fato financeiro, o DELETE falha com erro de chave estrangeira; apagar
-- lançamento é outra decisão, tomada olhando o número do passo 1.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PASSO 1 — RELATÓRIO (não altera nada)
-- ════════════════════════════════════════════════════════════

-- 1a) o que sai, o que bloqueia
WITH alvo AS (SELECT id FROM plano_contas WHERE codigo = 'BOTOP'),                 -- «PLANO»
     ctas AS (SELECT id FROM conta_contabil WHERE plano_id = (SELECT id FROM alvo))
SELECT
  (SELECT count(*) FROM ctas)                                                        AS contas,
  (SELECT count(*) FROM empresa      WHERE plano_id = (SELECT id FROM alvo))         AS empresas_no_plano,
  (SELECT count(*) FROM conta_linha  WHERE conta_id IN (SELECT id FROM ctas))        AS sai_amarracoes,
  (SELECT count(*) FROM fat_saldo    WHERE conta_id IN (SELECT id FROM ctas))        AS sai_saldos,
  (SELECT count(*) FROM fat_realizado WHERE conta_id IN (SELECT id FROM ctas))       AS bloqueia_razao,
  (SELECT coalesce(sum(abs(valor)),0) FROM fat_realizado
     WHERE conta_id IN (SELECT id FROM ctas))                                        AS bloqueia_razao_valor,
  (SELECT count(*) FROM fat_folha    WHERE conta_id IN (SELECT id FROM ctas))        AS bloqueia_folha;

-- 1b) panorama dos planos
SELECT p.codigo, p.nome, count(c.id) AS contas,
       (SELECT count(*) FROM empresa e WHERE e.plano_id = p.id) AS empresas
  FROM plano_contas p LEFT JOIN conta_contabil c ON c.plano_id = p.id
 GROUP BY p.id, p.codigo, p.nome ORDER BY contas DESC;


-- ════════════════════════════════════════════════════════════
-- PASSO 2 — EXPURGO
-- Só rode se "bloqueia_razao" e "bloqueia_folha" vierem ZERO no passo 1.
-- Descomente as duas linhas e rode SÓ elas. Sem desfazer.
-- A primeira é obrigatória: pai_id é auto-referência sem cascade e travaria o
-- DELETE na própria hierarquia (conta pai contra conta filha).
-- ════════════════════════════════════════════════════════════

-- UPDATE conta_contabil SET pai_id = NULL
--  WHERE plano_id = (SELECT id FROM plano_contas WHERE codigo = 'BOTOP');        -- «PLANO»
-- DELETE FROM conta_contabil
--  WHERE plano_id = (SELECT id FROM plano_contas WHERE codigo = 'BOTOP');        -- «PLANO»
