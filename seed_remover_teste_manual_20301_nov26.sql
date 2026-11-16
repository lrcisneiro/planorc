-- ============================================================
-- SEED — remove o teste manual nas contas de pessoal (Orçado2027)
--
-- POR QUE EXISTE: um gerente testou a tela de Orçar lançando à mão em
-- `20301 Terceiros Internos`, que é conta de PESSOAL — alimentada pelo Aplicar
-- do quadro de postos. O orçado de pessoal passa a ter duas origens na mesma
-- conta e ninguém sabe qual é qual olhando o total.
--
-- O QUE SAI — 14 linhas, CC 328 · Novos Smart:
--     empresa 05 · jan  R$ 51.994,00
--     empresa 05 · fev  R$ 51.994,00
--     empresa 01 · jan a dez  R$ 0,00  (12 linhas, rastro de navegação na grade)
--     total R$ 103.988,00
--
-- ⚠ O RECORTE É ESTREITO DE PROPÓSITO: versão `Orçado2027`, ano 2027, conta
-- `20301`, origem `MANUAL`. Conferi a versão inteira antes de escrever —
-- 74 grupos não-POSTO — e **todo o resto é orçamento de verdade**: as receitas
-- por FORMULÁRIO e as despesas administrativas por MANUAL. Um DELETE por
-- `origem='MANUAL'` sem a conta levaria junto R$ 20 milhões de despesa
-- legítima.
-- ⚠ E as contas `20101`/`20201` **não têm nenhuma linha manual** — não é
-- esquecimento, é que não existem.
--
-- ⚠ O `Orçado2026` TAMBÉM é todo MANUAL nas três contas de pessoal (R$ 63,1
-- mi), e **não se toca nele**: ali o manual não é teste, é o orçamento do ano,
-- digitado antes de existir o cálculo por posto. É contra ele que a
-- comparação 2026 × 2027 é feita.
--
-- ⚠ Isto NÃO muda o orçado aplicado de pessoal: o Aplicar só escreve e apaga
-- origem POSTO. O total da conta 20301 cai R$ 103.988,00 e o do quadro fica
-- igual.
--
-- Re-executável — rodar duas vezes não tem o que apagar na segunda.
-- Termina em SELECT.
-- ============================================================

DELETE FROM fat_orcado f
 USING conta_orcamentaria co
 WHERE co.id = f.linha_id
   AND co.codigo = '20301'
   AND f.ano = 2027
   AND f.origem = 'MANUAL'
   AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027');

-- ---------------- conferência ----------------
SELECT 'manual nas contas de pessoal · Orçado2027' AS secao,
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhum — correto'
                    ELSE count(*)::text || ' linha(s) · R$ ' || round(sum(-f.valor),2)::text END
          FROM fat_orcado f JOIN conta_orcamentaria co ON co.id=f.linha_id
         WHERE co.codigo IN ('20101','20201','20301') AND f.origem <> 'POSTO'
           AND f.versao_id=(SELECT id FROM versao_orcamento WHERE codigo='Orçado2027')) AS resultado
UNION ALL
SELECT 'orçado de pessoal 2027 (só POSTO, não muda)',
       (SELECT 'R$ ' || round(sum(-f.valor),2)::text
          FROM fat_orcado f JOIN conta_orcamentaria co ON co.id=f.linha_id
         WHERE co.codigo IN ('20101','20201','20301') AND f.origem='POSTO' AND f.ano=2027
           AND f.versao_id=(SELECT id FROM versao_orcamento WHERE codigo='Orçado2027'))
UNION ALL
SELECT 'o orçamento de 2026 continua intacto?',
       (SELECT count(*)::text || ' linha(s) · R$ ' || round(sum(-f.valor),2)::text
          FROM fat_orcado f JOIN conta_orcamentaria co ON co.id=f.linha_id
         WHERE co.codigo IN ('20101','20201','20301') AND f.ano=2026)
UNION ALL
SELECT 'despesa MANUAL de 2027 fora de pessoal (intacta)',
       (SELECT count(*)::text || ' linha(s) · R$ ' || round(sum(-f.valor),2)::text
          FROM fat_orcado f JOIN conta_orcamentaria co ON co.id=f.linha_id
         WHERE co.codigo NOT IN ('20101','20201','20301') AND f.origem='MANUAL' AND f.ano=2027
           AND f.versao_id=(SELECT id FROM versao_orcamento WHERE codigo='Orçado2027'));
