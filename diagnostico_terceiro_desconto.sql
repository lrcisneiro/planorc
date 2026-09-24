-- ============================================================
-- A nota do terceiro é LÍQUIDA; a folha registra BRUTO + desconto à parte
--
-- Caso JOSE CHOITE KITA JUNIOR (900048, filial 2001), Ago/2026:
--
--   folha   16.959,59   = 222 HORAS FATURAVEIS 16.947,81 + 223 TRANSLADO 11,78
--                         (as duas debitam 41021001 — conta de terceiro)
--   razão   14.222,96   = a NF, doc 000011, na mesma 41021001
--   dif     -2.736,63   = exatamente a verba 549 CONVENIO MEDICO
--
-- A 549 existe na folha, mas debita 21012017 (patrimonial) e credita 41013001:
-- é o convênio que a empresa adiantou e desconta do prestador. A nota fiscal
-- sai JÁ LÍQUIDA desse valor, então o razão registra 14.222,96 e nunca vai
-- bater com o bruto da folha.
--
-- Note que isso é o OPOSTO do CLT. Lá o razão registra o bruto e a retenção
-- vira crédito num passivo separado — por isso a conciliação exclui as verbas
-- de desconto do lado da folha, e está certa em excluir. No terceiro, o
-- desconto já está embutido no número do razão. Mesma palavra, contabilização
-- invertida.
--
-- ⚠ A verba D53 SEGURO VIDA P.J. (142,38) NÃO entra nessa conta: é
-- 'Base (Desconto)' com débito em DESPESA (41013004) — custo da empresa, não
-- retenção do prestador. A nota não é reduzida por ela. Por isso o corte
-- abaixo é `tipo_verba = 'Desconto'` exato, e não `LIKE 'Desconto%'`.
--
-- ESTA CONSULTA TESTA SE A EXPLICAÇÃO VALE PARA TODOS, não só para o Choite.
-- Só leitura.
-- ============================================================

WITH rel AS (
  SELECT r.id FROM relatorio r
    JOIN relatorio_linha rl ON rl.relatorio_id = r.id AND rl.linha_orc_id IS NOT NULL
   WHERE r.tenant_id = current_tenant_id()
   GROUP BY r.id ORDER BY count(*) DESC LIMIT 1
),
clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(2026, 8)),
-- o razão atribuído a cada pessoa (o mesmo motor que alimenta o bloco)
rz AS (
  SELECT a.filial_id, a.matricula, sum(a.valor)::numeric AS razao, count(*) AS nfs
    FROM planorc_pj_atribui(2026, 8, (SELECT id FROM rel)) a
   WHERE a.matricula IS NOT NULL
   GROUP BY 1, 2
),
-- a folha da pessoa, separando o que entra no bloco do que é desconto dela
fo AS (
  SELECT ff.filial_id, ff.matricula, max(ff.nome) AS nome,
         sum(ff.valor) FILTER (
           WHERE ff.conta_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM clt WHERE clt.conta_id = ff.conta_id)
         )::numeric AS folha_bloco,
         sum(ff.valor) FILTER (WHERE ff.tipo_verba = 'Desconto')::numeric AS descontos,
         string_agg(DISTINCT btrim(ff.verba_cod), ', ') FILTER (WHERE ff.tipo_verba = 'Desconto') AS verbas_desconto
    FROM fat_folha ff
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = 2026 AND ff.mes = 8
   GROUP BY 1, 2
),
j AS (
  SELECT coalesce(fo.nome, '?') AS nome, rz.matricula,
         coalesce(fo.folha_bloco, 0) AS folha,
         coalesce(fo.descontos, 0)   AS descontos,
         fo.verbas_desconto,
         rz.razao, rz.nfs,
         coalesce(fo.folha_bloco, 0) - rz.razao                         AS dif_bruto,
         coalesce(fo.folha_bloco, 0) - coalesce(fo.descontos, 0) - rz.razao AS dif_liquido
    FROM rz LEFT JOIN fo ON fo.filial_id IS NOT DISTINCT FROM rz.filial_id
                        AND fo.matricula = rz.matricula
)
-- 1) O VEREDITO: em quantas pessoas a hipótese explica a diferença?
SELECT CASE
         WHEN abs(dif_bruto) <= 1                        THEN 'já batia sem desconto'
         WHEN descontos = 0                              THEN 'diverge e não tem desconto — outra causa'
         WHEN abs(dif_liquido) <= 1                      THEN 'EXPLICADO: bruto − desconto = razão'
         WHEN abs(dif_liquido) < abs(dif_bruto)          THEN 'melhora, mas não fecha'
         ELSE                                                 'piora ao subtrair — NÃO aplicar'
       END AS veredito,
       count(*) AS pessoas,
       to_char(sum(dif_bruto),   'FM999G999G990D00') AS soma_dif_hoje,
       to_char(sum(dif_liquido), 'FM999G999G990D00') AS soma_dif_se_liquido
  FROM j
 GROUP BY 1 ORDER BY 2 DESC;

-- 2) O detalhe de quem tem desconto, para conferir caso a caso
-- (rode separado; a consulta 1 é a que decide)
-- SELECT nome, matricula, folha, descontos, verbas_desconto, razao, nfs,
--        dif_bruto, dif_liquido
--   FROM j WHERE descontos <> 0
--  ORDER BY abs(dif_bruto) DESC;
