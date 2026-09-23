-- ============================================================
-- 105 — A amarração manda: conta do item é do item, seja qual for a natureza
--
-- Ricardo: "quando afirma que a conta não é terceiros, é sim — tem que pegar a
-- amarração das contas do item orçamentário para compor esse bloco. Essa conta
-- 950001 está lá nas contas amarradas."
--
-- Ele está certo. A 950001 (DL MENSAL) é da série 9, e conta_contabil.natureza
-- foi pré-carregada pelo PRIMEIRO DÍGITO do código — 9 vira 'TRANSITORIA'. Eu
-- usei essa natureza para decidir o que entra na conferência e a conta ficou de
-- fora, embora ela componha a linha Terceiros Internos da DRE e apareça no
-- realizado dela: R$ 260.574,72 que o relatório conta e a conferência não.
--
-- O critério certo é o outro: se a conta está AMARRADA à linha, ela é da linha.
-- A DRE é que define o que é resultado para esta empresa, não o dígito inicial
-- do plano de contas. A natureza continua valendo onde não há amarração que
-- responda — a semente da folha, o rodapé patrimonial.
--
-- Efeito: os lançamentos da 950001 passam a entrar no bloco de terceiros. Sem
-- dono, provavelmente, porque não são nota com participante — e é exatamente
-- assim que devem aparecer: visíveis, pedindo justificativa, em vez de fora.
-- ============================================================

CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH com_folha AS (
    -- a SEMENTE ainda usa natureza: aqui a pergunta é "esta folha é de
    -- resultado?", e não há amarração que responda por ela
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes))
  ),
  masters AS (
    SELECT DISTINCT c.linha_id FROM conta_linha c
      JOIN com_folha f ON f.conta_id = c.conta_id
     WHERE c.tenant_id = current_tenant_id()
  )
  -- as IRMÃS entram pela amarração, sem filtro de natureza: estar na linha é a
  -- definição de pertencer a ela. A 950001 é série 9 e compõe Terceiros Internos.
  SELECT c.conta_id FROM conta_linha c
   WHERE c.tenant_id = current_tenant_id()
     AND c.linha_id IN (SELECT linha_id FROM masters)
  UNION
  SELECT conta_id FROM com_folha
$$;
