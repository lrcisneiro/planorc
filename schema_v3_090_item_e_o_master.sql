-- ============================================================
-- 090 — O item orçamentário é conta_orcamentaria, não relatorio_linha
--
-- SINTOMA: todas as contas caíram em "Sem item orçamentário", apesar de a tela
-- de Amarração mostrar 12 e 14 contas amarradas.
--
-- CAUSA: a v3_089 juntou conta_linha.linha_id com relatorio_linha.id. Mas a
-- v3_010 (F2) já tinha repontado essa coluna para a CHAVE-MESTRE:
--
--     conta_contabil ──> conta_linha.linha_id ──> conta_orcamentaria
--                                                        ↑
--                        relatorio_linha.linha_orc_id ────┘
--
-- O nome da coluna ("linha_id") é herança do modelo antigo e enganou. O item
-- orçamentário é a conta_orcamentaria — que é exatamente como o Ricardo o
-- chamou desde o começo ("3 contas orçamentárias que aglutinam as contas").
-- A linha do relatório só APONTA para ela, e serve aqui apenas para dar ordem
-- de DRE à exibição.
--
-- ⚠ CONSEQUÊNCIA MAIOR, que o sintoma escondia: as "contas irmãs" do terceiro
-- também nunca casaram. Desde a v3_085, planorc_concil_contas tentava achar as
-- irmãs pelo mesmo join errado e não achava nada — o universo do terceiro vinha
-- caindo no fallback "só contas com folha". É por isso que a 41021002, que é
-- onde a nota do cooperado cai, ficava de fora no banco real e aparecia no meu
-- teste: no harness eu tinha montado conta_linha apontando para relatorio_linha,
-- reproduzindo o meu engano em vez do modelo.
--
-- Agora irmã é conta amarrada ao MESMO master. Não depende de relatório, o que
-- é mais simples e mais certo: o master é único, a linha do relatório é uma
-- entre várias possíveis.
-- ============================================================

-- ── O item orçamentário de cada conta ──
-- A ordem vem da linha do relatório escolhido, quando existir: é o que faz a
-- tela sair na ordem da DRE em vez de alfabética. Sem linha, vai para o fim.
-- Conta amarrada a dois masters aparece UMA vez, no de menor ordem — a tela
-- continua avisando da duplicidade, que é o que manda arrumar a amarração.
CREATE OR REPLACE FUNCTION planorc_concil_item(p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid, linha_id uuid, linha_cod text, linha_desc text, linha_ordem int)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (c.conta_id)
         c.conta_id, co.id, co.codigo, co.descricao, rl.ordem
    FROM conta_linha c
    JOIN conta_orcamentaria co ON co.id = c.linha_id
    LEFT JOIN relatorio_linha rl ON rl.linha_orc_id = co.id
                                AND rl.relatorio_id = p_relatorio_id
   WHERE c.tenant_id = current_tenant_id()
   ORDER BY c.conta_id, rl.ordem NULLS LAST, co.codigo
$$;

-- ── O universo do terceiro: irmãs são as contas do mesmo master ──
-- p_relatorio_id continua na assinatura (a tela o passa, e ele ainda decide a
-- ordem no item), mas não entra mais nesta conta: o master é o agrupador real.
CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH com_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes))
  ),
  -- o master de quem tem folha de terceiro; as outras contas do mesmo master
  -- são onde a nota costuma cair (41021001 aponta a folha, 41021002 recebe a nota)
  masters AS (
    SELECT DISTINCT c.linha_id FROM conta_linha c
      JOIN com_folha f ON f.conta_id = c.conta_id
     WHERE c.tenant_id = current_tenant_id()
  )
  SELECT c.conta_id FROM conta_linha c
   WHERE c.tenant_id = current_tenant_id()
     AND c.linha_id IN (SELECT linha_id FROM masters)
     AND EXISTS (SELECT 1 FROM conta_contabil cc
                  WHERE cc.id = c.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
  UNION
  SELECT conta_id FROM com_folha
$$;
