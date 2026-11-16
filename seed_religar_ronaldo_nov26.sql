-- ============================================================
-- SEED — reaponta a folha PAGA do Ronaldo para o posto que existe
--
-- Rode DEPOIS de excluir a versão `OrçadoPosto`. É a única coisa que sobra.
--
-- POR QUE É SÓ ISTO: todas as FKs para `versao_orcamento` são `ON DELETE
-- CASCADE`, então excluir a versão leva junto o orçado do posto excluído —
-- 72 linhas em `fat_orcado` e 12 em `fat_folha`, R$ 900.000,00 de cada lado.
-- O que NÃO vai junto são as 3 linhas de folha REALIZADA (ago–out/2026,
-- R$ 264.952,59): elas têm `versao_id` NULO, porque o pago não pertence a
-- versão de orçamento (regra da v3_163). Ficariam órfãs para sempre.
--
-- ⚠ É A MESMA PESSOA, com DUAS MATRÍCULAS: `800002` na folha (série de
-- pró-labore) e `900101` no cadastro do posto (série de prestador) — mesmo
-- nome, mesma empresa·filial·CC (05·2001·310), mesmo salário (88.317,53).
-- A chave `(filial, matrícula)` da v3_188 não as une, e foi por isso que
-- concluí que ele não tinha posto. Tinha.
--
-- O posto `2001-900101` só tem orçado de 2027, então sem este reaponte o
-- histórico de 2026 dele fica sem dono e a conciliação por posto segue cega
-- nos R$ 264.952,59.
--
-- ⚠ NENHUM VALOR MUDA: escreve `posto_id` e mais nada.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

UPDATE fat_folha f SET posto_id = p.id
  FROM posto p
 WHERE p.codigo = '2001-900101'
   AND f.tenant_id = p.tenant_id
   AND f.posto_id IS NULL
   AND f.filial_id = p.filial_id
   AND lpad(nullif(trim(f.matricula), ''), 6, '0') = '800002';

-- ---------------- conferência ----------------
SELECT 'folha agora ligada ao posto 2001-900101' AS secao,
       (SELECT count(*)::text || ' linha(s) · matrícula(s) ' || string_agg(DISTINCT f.matricula, ', ')
               || ' · R$ ' || round(sum(f.valor),2)::text
          FROM fat_folha f JOIN posto p ON p.id = f.posto_id WHERE p.codigo = '2001-900101') AS resultado
UNION ALL
SELECT 'fat_folha ainda órfã (deve ser zero)',
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ' linha(s): ' || string_agg(DISTINCT coalesce(nome,'?'), ', ') END
          FROM fat_folha WHERE posto_id IS NULL)
UNION ALL
SELECT 'versão OrçadoPosto ainda existe?',
       (SELECT CASE WHEN count(*) = 0 THEN 'já excluída — correto'
                    ELSE '⚠ ainda existe: o orçado do posto excluído só sai com ela' END
          FROM versao_orcamento WHERE codigo = 'OrçadoPosto')
UNION ALL
SELECT 'sobra de orçado da matrícula 800002',
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ' linha(s) · R$ ' || round(sum(-valor),2)::text END
          FROM fat_orcado WHERE origem='POSTO' AND dims->>'matricula'='800002')
UNION ALL
SELECT 'orçamento MANUAL de 2026 intacto?',
       (SELECT count(*)::text || ' linha(s) na versão Orçado2026'
          FROM fat_orcado WHERE ano=2026 AND origem='MANUAL');
