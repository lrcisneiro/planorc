-- ============================================================
-- Faltam os centros de custo 512 e 522 — o par HXM da faixa 5xx.
--
-- A conferência do import de 2027 apontou os dois como "sem cadastro", e o
-- padrão diz o que são: `x12` é Base-HXM e `x22` é Novos-HXM. Eles existem na
-- faixa 2xx (212 / 222) e não na 5xx. É o mesmo HXM que, segundo
-- docs/DESIGN_receitas.md, "tinha ficado de fora da lista inicial de BUs" e foi
-- incluído só no 2xx.
--
-- ⚠ Sem eles, as linhas do arquivo com CC 512/522 são DESCARTADAS SEM AVISO na
-- importação: somem e o total fecha menor, sem nada na tela denunciar.
--
-- Cada novo CC herda duas coisas de lugares diferentes, que é o que o mantém
-- coerente nas duas dimensões:
--   · a FAIXA (área e divisão) de um vizinho da mesma faixa — 511 e 521;
--   · a BU (código e nome) do mesmo produto em outra faixa — 212 e 222.
-- A descrição vem do par 2xx, porque as faixas repetem os mesmos nomes de BU.
--
-- IDEMPOTENTE: não recria o que já existe, e não altera CC nenhum.
-- ============================================================

INSERT INTO centro_custo
  (tenant_id, codigo, descricao, area, area_cod, area_nome,
   divisao_cod, divisao_nome, bu_cod, bu_nome, ativo)
SELECT faixa.tenant_id, novo.codigo, bu.descricao,
       faixa.area, faixa.area_cod, faixa.area_nome,
       faixa.divisao_cod, faixa.divisao_nome,
       bu.bu_cod, bu.bu_nome, true
  FROM (VALUES ('512', '511', '212'),      -- novo, modelo de FAIXA, modelo de BU
               ('522', '521', '222')) AS novo(codigo, mod_faixa, mod_bu)
  JOIN centro_custo faixa ON trim(faixa.codigo) = novo.mod_faixa
  JOIN centro_custo bu    ON trim(bu.codigo)    = novo.mod_bu
 WHERE NOT EXISTS (SELECT 1 FROM centro_custo x WHERE trim(x.codigo) = novo.codigo);

-- ---------- conferência: o HXM nas três faixas, e os vizinhos de cada uma ----------
-- Se a faixa 5xx usar outro padrão de nome, dá para ver aqui e corrigir a
-- descrição — o resto (área, divisão, BU) estará certo de qualquer forma.
SELECT trim(codigo) AS cc, descricao,
       coalesce(bu_cod, '—') || ' · ' || coalesce(bu_nome, '—')           AS bu,
       coalesce(area_cod, '—') || ' · ' || coalesce(area_nome, '—')       AS area,
       coalesce(divisao_cod, '—') || ' · ' || coalesce(divisao_nome, '—') AS divisao
  FROM centro_custo
 WHERE trim(codigo) IN ('211','212','214','221','222','224',
                        '311','314','321','324',
                        '511','512','514','521','522','524')
 ORDER BY 1;
