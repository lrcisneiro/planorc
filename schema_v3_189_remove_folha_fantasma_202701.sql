-- ============================================================
-- v3_189 — remove a folha realizada de 2027-01, que é cópia de 2026-05
--
-- POR QUE EXISTE: a competência 2027-01 tinha 5.008 linhas de folha REALIZADA,
-- 168 pessoas e R$ 4.364.741,27 — numa competência que ainda não aconteceu.
-- Levantada pelo gerente de TI na homologação de 10/nov (item C-07), que
-- perguntou se era simulação. Não é: é a folha de MAIO de 2026 gravada na
-- competência errada.
--
-- A PROVA, par (matrícula, verba) contra par:
--     1.461 pares em 2027-01
--     1.460 idênticos ao valor de 2026-05
--         1 diferente — matrícula 900004, verba 231 (bônus):
--           R$ 31.468,71 contra R$ 1.468,71. Um "3" digitado na frente.
--         0 pares existem SÓ em 2027-01
-- Nenhuma linha nova, nenhum valor próprio, e um valor editado à mão: é o
-- rastro de quem testava o importador em julho/2026.
--
-- A data de importação fecha o caso: **28/07/2026 22:14**, três dias depois da
-- carga de 2026-05, e é a ÚNICA competência de folha **sem lote** — todas as
-- outras (2026-08, 09, 10) têm dois cada. O mecanismo de lote veio depois.
--
-- ⚠ POR QUE DÓI: a folha de 2027-01 entra na conciliação Orçado × Folha e no
-- custo por posto como se fosse realizado. Enquanto existir, qualquer
-- comparação que inclua a competência mistura maio de 2026 com janeiro de
-- 2027. E ficou invisível por meses porque 22 mil linhas estavam órfãs de
-- posto (v3_188): a tela as mostrava como "sem posto", não como maio.
--
-- NADA DEPENDE DELAS, conferido antes: 0 notas de conciliação em 202701,
-- 0 linhas de `fat_realizado` em 2027 (o razão daquele mês está vazio, que é
-- outra metade do C-07) e 0 apontamentos com `comp_folha` 2027-01.
--
-- ⚠ A GUARDA É A DATA DE IMPORTAÇÃO, não o ano/mês. Em janeiro de 2027 a folha
-- de verdade vai ser carregada nessa mesma competência, e uma migration que
-- apagasse "2027-01" sem mais nada seria uma bomba-relógio para quem a
-- reexecutasse depois. `importado_em < 2026-08-01` alcança só esta carga.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

DELETE FROM fat_folha
 WHERE tipo = 'REALIZADO' AND ano = 2027 AND mes = 1
   AND importado_em < '2026-08-01';

-- ---------------- conferência ----------------
SELECT 'folha realizada em 2027-01' AS secao,
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma linha — correto'
                    ELSE count(*)::text || ' linha(s) · R$ ' || round(sum(valor),2)::text
                      || ' · importada em ' || max(importado_em)::text END
          FROM fat_folha WHERE tipo='REALIZADO' AND ano=2027 AND mes=1) AS resultado
UNION ALL
SELECT 'competências de folha realizada que restam',
       (SELECT string_agg(DISTINCT ano::text || '-' || lpad(mes::text,2,'0'), ' · ' ORDER BY ano::text || '-' || lpad(mes::text,2,'0'))
          FROM fat_folha WHERE tipo='REALIZADO')
UNION ALL
SELECT 'maio/2026 continua intacto?',
       (SELECT count(*)::text || ' linha(s) · R$ ' || round(sum(valor),2)::text
          FROM fat_folha WHERE tipo='REALIZADO' AND ano=2026 AND mes=5)
UNION ALL
SELECT 'total de folha realizada',
       (SELECT count(*)::text || ' linha(s) em ' || count(DISTINCT (ano,mes))::text || ' competência(s)'
          FROM fat_folha WHERE tipo='REALIZADO');
