-- ============================================================
-- AJUSTE DE DADO (não é migration). Re-executável. Termina em SELECT.
--
-- `addEstrutura` cria DUAS linhas: uma `conta_orcamentaria` (o master) e a
-- `relatorio_linha` que aponta para ela. Apagar a linha do relatório **não**
-- apaga o master — então o clique duplo de 26/nov deixou `Lmwxyyxvo` órfão.
--
-- ⚠⚠ SÓ APAGA O QUE NINGUÉM ALCANÇA. A condição é tripla e cada perna evita um
-- estrago diferente: zero células em `fat_orcado` (o master não guarda
-- dinheiro), zero `relatorio_linha` apontando (nenhuma DRE o usa) e zero
-- `conta_linha` (não é destino de amarração do realizado). Sem as três, apagar
-- master é arrancar o ponto de ancoragem de um fato que continua existindo.
-- ⚠ O recorte é pelo PADRÃO DO CÓDIGO (`L` + timestamp base-36, que é o que
-- `addEstrutura` gera). Master importado ou cadastrado à mão tem código do
-- plano e não entra aqui, mesmo que esteja órfão hoje — pode ser cadastro
-- adiantado, e apagá-lo seria decidir por quem cadastrou.
-- ============================================================

DELETE FROM conta_orcamentaria co
 WHERE co.codigo ~ '^L[0-9a-z]{8,}$'
   AND NOT EXISTS (SELECT 1 FROM fat_orcado f      WHERE f.linha_id     = co.id)
   AND NOT EXISTS (SELECT 1 FROM relatorio_linha r WHERE r.linha_orc_id = co.id)
   AND NOT EXISTS (SELECT 1 FROM conta_linha  cl   WHERE cl.linha_id    = co.id);

SELECT 'masters órfãos restantes (padrão L+timestamp)' AS secao,
       coalesce(co.codigo, '—') AS chave,
       coalesce(co.descricao, '✅ nenhum') AS info
  FROM conta_orcamentaria co
 WHERE co.codigo ~ '^L[0-9a-z]{8,}$'
   AND NOT EXISTS (SELECT 1 FROM fat_orcado f      WHERE f.linha_id     = co.id)
   AND NOT EXISTS (SELECT 1 FROM relatorio_linha r WHERE r.linha_orc_id = co.id)
   AND NOT EXISTS (SELECT 1 FROM conta_linha  cl   WHERE cl.linha_id    = co.id)
UNION ALL
SELECT 'total de masters no padrão L+timestamp', count(*)::text,
       'os que sobraram estão em uso'
  FROM conta_orcamentaria WHERE codigo ~ '^L[0-9a-z]{8,}$'
 ORDER BY 1, 2;
