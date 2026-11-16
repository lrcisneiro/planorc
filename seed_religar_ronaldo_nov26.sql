-- ============================================================
-- SEED — limpa o orçado do posto excluído (matrícula 800002) e religa a folha
--
-- ⚠⚠ DUAS CORREÇÕES MINHAS, nesta ordem:
-- 1. A primeira versão deste arquivo CRIAVA um posto para o Ronaldo, e teria
--    criado uma DUPLICATA: ele já é `2001-900101`, mesma empresa·filial·CC
--    (05·2001·310), mesmo salário (88.317,53), cargo DIRETOR DE SERVIÇOS, e
--    está no orçado de 2027 com R$ 1.118.099,93. Eu afirmei que faltava
--    R$ 1,1 mi no orçamento — não falta.
--    O erro: procurei o posto pela matrícula da FOLHA. A pessoa tem duas —
--    `800002` (série de pró-labore, usada na folha) e `900101` (série de
--    prestador, no cadastro). "Não achei por esta chave" nunca é o mesmo que
--    "não existe", e o nome, que eu não consultei, respondia de primeira.
-- 2. O posto antigo foi EXCLUÍDO pelo Ricardo — e a exclusão deixou o orçado
--    dele para trás. É o que este seed limpa.
--
-- O QUE O POSTO EXCLUÍDO DEIXOU:
--     fat_orcado   72 linhas · R$ 900.000,00 · versão OrçadoPosto · ano 2026
--     fat_folha    12 linhas · R$ 900.000,00 · tipo ORCADO        · ano 2026
-- Orçamento de um posto que não existe mais, sem dono e sem rastro: `fat_orcado`
-- nem tem `posto_id` (a origem vive em `dims->>'posto'`, texto e sem FK) e em
-- `fat_folha` o `posto_id` é `ON DELETE SET NULL`.
-- ⚠ Pior do que sobrar: `dims->>'posto'` é o CÓDIGO. Um posto novo com o mesmo
-- código adotaria essas linhas caladamente.
--
-- O QUE FICA, E POR QUÊ:
--     fat_folha  3 linhas REALIZADO · R$ 264.952,59 · ago–out/2026
-- Isso é folha PAGA, vinda do ERP — não é orçado e não se apaga. Só reaponta
-- para `2001-900101`, que é a mesma pessoa na mesma cadeira: o posto atual só
-- tem orçado de 2027, então sem isto o histórico de 2026 dele fica sem dono e
-- a conciliação por posto segue cega nos R$ 264.952,59.
--
-- ⚠ CONSEQUÊNCIA A OLHAR: o orçado de 2026 (`OrçadoPosto`) cai R$ 900.000,00.
-- É o que se pediu — orçado de posto excluído é fantasma —, mas é um número
-- que alguém pode estar usando como fechado. Se for para manter 2026 como
-- está, não rode a parte do DELETE.
--
-- A tela também foi corrigida: excluir posto passa a apagar o orçado dele e a
-- dizer quanto vai junto. Versão BLOQUEADA fica de fora — retrato não se
-- reescreve.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1. o orçado que sobrou do posto excluído ─────────────────────────────
DELETE FROM fat_orcado f
 USING versao_orcamento v
 WHERE v.id = f.versao_id
   AND f.origem = 'POSTO'
   AND f.dims->>'matricula' = '800002'
   AND coalesce(v.bloqueada, false) = false;

DELETE FROM fat_folha f
 USING posto p
 WHERE f.tipo = 'ORCADO'
   AND f.posto_id IS NULL
   AND p.codigo = '2001-900101'
   AND f.tenant_id = p.tenant_id
   AND f.filial_id = p.filial_id
   AND lpad(nullif(trim(f.matricula), ''), 6, '0') = '800002';

-- ── 2. a folha PAGA reaponta para o posto que existe ─────────────────────
UPDATE fat_folha f SET posto_id = p.id
  FROM posto p
 WHERE p.codigo = '2001-900101'
   AND f.tenant_id = p.tenant_id
   AND f.posto_id IS NULL
   AND f.filial_id = p.filial_id
   AND lpad(nullif(trim(f.matricula), ''), 6, '0') = '800002';

-- ---------------- conferência ----------------
SELECT 'fat_orcado · sobras da matrícula 800002' AS secao,
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ' linha(s) · R$ ' || round(sum(-valor),2)::text END
          FROM fat_orcado WHERE origem='POSTO' AND dims->>'matricula'='800002') AS resultado
UNION ALL
SELECT 'fat_folha · ainda órfã (deve ser zero)',
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ' linha(s): ' || string_agg(DISTINCT coalesce(nome,'?'), ', ') END
          FROM fat_folha WHERE posto_id IS NULL)
UNION ALL
SELECT 'realizado de 2026 que voltou a ter dono',
       (SELECT coalesce(count(*)::text || ' linha(s) · R$ ' || round(sum(f.valor),2)::text, '0')
          FROM fat_folha f JOIN posto p ON p.id=f.posto_id
         WHERE p.codigo='2001-900101' AND f.tipo='REALIZADO')
UNION ALL
SELECT 'orçado 2026 (OrçadoPosto) depois da limpeza',
       (SELECT 'R$ ' || round(sum(-valor),2)::text FROM fat_orcado
         WHERE origem='POSTO' AND ano=2026
           AND versao_id=(SELECT id FROM versao_orcamento WHERE codigo='OrçadoPosto'))
UNION ALL
SELECT 'o Ronaldo continua com UM posto só?',
       (SELECT CASE WHEN count(*)=1 THEN 'correto — ' || max(codigo)
                    ELSE '⛔ ' || count(*)::text || ' postos' END
          FROM posto WHERE upper(nome) LIKE '%RONALDO BRUNO%');
