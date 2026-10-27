-- ============================================================
-- Corrigir o SINAL do orçado de origem POSTO já gravado
--
-- O motor de folha gravava a despesa POSITIVA, enquanto o orçado MANUAL e o
-- realizado guardam despesa NEGATIVA. Na DRE as duas origens se cancelavam em
-- vez de somar. O Aplicar já foi corrigido (decide pela `natureza` da conta).
--
-- POR QUE NÃO SIMPLESMENTE REAPLICAR: o Aplicar recalcula tudo, e o motor mudou
-- desde a última aplicação — ganhou afastamento (v3_117) e rescisão (v3_118/119).
-- Reaplicar em 2026, que está em validação mês a mês, mudaria números que você
-- já conferiu. Este script só TROCA O SINAL, sem recalcular nada.
--
--   2027  → pode reaplicar pela tela (você quer as regras novas lá). Este script
--           é desnecessário se for reaplicar.
--   2026  → use este script, para não mexer no que já foi validado.
--
-- Só toca em `origem = 'POSTO'`, só em conta de natureza DESPESA e só no que
-- está POSITIVO — rodar duas vezes não desfaz. `fat_folha` NÃO é tocada: lá o
-- realizado vem da folha do ERP, que é positiva, e a conciliação compara crus.
--
-- O SQL Editor mostra só o resultado da ÚLTIMA instrução: rode a PARTE 1, depois
-- descomente a PARTE 2.
-- ============================================================

-- ─────────── PARTE 1 · o que seria corrigido (só leitura) ───────────
select o.ano,
       ver.codigo                              as versao,
       con.codigo                              as conta,
       con.descricao                           as conta_desc,
       con.natureza,
       count(*)                                as linhas,
       round(sum(o.valor), 2)                  as soma_atual,
       count(*) filter (where o.valor > 0)     as linhas_positivas,
       round(sum(o.valor) filter (where o.valor > 0), 2) as valor_a_inverter
  from fat_orcado o
  join conta_orcamentaria con on con.id = o.linha_id
  left join versao_orcamento ver on ver.id = o.versao_id
 where o.origem = 'POSTO'
 group by 1,2,3,4,5
 order by o.ano desc, con.codigo;


-- ─────────── PARTE 2 · inverter (descomente e rode) ───────────
-- Troque o ANO para o que você quer corrigir. Sem o filtro de ano, corrige tudo.
/*
WITH alvo AS (
  SELECT o.id
    FROM fat_orcado o
    JOIN conta_orcamentaria c ON c.id = o.linha_id
   WHERE o.origem = 'POSTO'
     AND c.natureza = 'DESPESA'
     AND o.valor > 0
     AND o.ano = 2026            -- <<< ajuste o ano (ou remova esta linha)
)
UPDATE fat_orcado o
   SET valor  = -o.valor,
       -- as colunas materializadas de moeda acompanham, senão a DRE em US$
       -- ficaria com o sinal antigo
       val_m2 = CASE WHEN o.val_m2 IS NULL THEN NULL ELSE -o.val_m2 END,
       val_m3 = CASE WHEN o.val_m3 IS NULL THEN NULL ELSE -o.val_m3 END,
       val_m4 = CASE WHEN o.val_m4 IS NULL THEN NULL ELSE -o.val_m4 END,
       val_m5 = CASE WHEN o.val_m5 IS NULL THEN NULL ELSE -o.val_m5 END
  FROM alvo a
 WHERE o.id = a.id;

-- confirmação (a última instrução é a que aparece)
SELECT ano, count(*) AS linhas,
       count(*) FILTER (WHERE valor > 0) AS ainda_positivas,
       round(sum(valor), 2) AS soma
  FROM fat_orcado WHERE origem = 'POSTO'
 GROUP BY ano ORDER BY ano DESC;
*/


-- ─────────── PARTE 3 · conferir o estado (só leitura, rode sozinha) ───────────
-- Dentro da MESMA conta e do MESMO ano, POSTO e MANUAL têm de estar os dois
-- negativos. POSTO com `positivas > 0` = a PARTE 2 não rodou nesse ano.
-- Misturado dentro de uma origem = rodou parcial; filtre o resto pelo ano.
select o.ano, o.origem, con.codigo as conta, con.natureza,
       count(*)                            as linhas,
       count(*) filter (where o.valor > 0) as positivas,
       count(*) filter (where o.valor < 0) as negativas,
       round(sum(o.valor), 2)              as soma
  from fat_orcado o
  join conta_orcamentaria con on con.id = o.linha_id
 where con.natureza = 'DESPESA'
 group by 1, 2, 3, 4
 order by o.ano desc, con.codigo, o.origem;
