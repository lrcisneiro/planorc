-- ============================================================
-- Normaliza o sinal das linhas de folha: despesa negativa no bruto
--
-- SITUAÇÃO. CPESSOAS, FDIR e FAPOIO são `=-1*([201]+[202]+[203])` — a mesma
-- expressão nas três, o que as separa é o `filtro_escopo` de área. O `-1*`
-- existia para a linha aparecer positiva enquanto a natureza era NEUTRA.
-- Agora que a natureza é DESPESA, o `fatorExibicao` já inverte, e a inversão
-- acontece DUAS vezes: a linha exibe −46.483.297 enquanto `Despesas`, que é
-- despesa de verdade, exibe +60.482.237.
--
-- O QUE MUDA. As três passam a guardar o valor NEGATIVO, como manda a
-- convenção do banco, e o `fatorExibicao` faz a exibição voltar a positiva.
-- Os sete indicadores que dependem do sinal são ajustados JUNTO, na mesma
-- transação — fora isso a Margem bruta inverteria e os LER ficariam negativos.
--
-- O QUE NÃO MUDA: nenhum valor na tela. Conferido um a um —
--   MGBRUTA: MCPRE + (−FDIR) = MCPRE − FDIR   → idêntico
--   LERM/MLER/DLER/LER/CMP: o −1 compensa o denominador que virou negativo
--   PESTRUT: razão entre duas linhas que viram juntas, o sinal se cancela
-- O único efeito visível é `Custo Pessoas` voltar a +46.483.297, e a cor da
-- variação ficar certa por qualquer critério.
--
-- POR QUE VALE. Com o bruto na convenção, a PONTE passa a somar essas linhas
-- com o sinal certo. Hoje, se a linha de resultado da ponte citar FDIR (a
-- Margem bruta cita), o componente entra com sinal trocado e o resíduo "não
-- explicado" absorve o dobro.
--
-- SEGURANÇA. Cada UPDATE casa a expressão ANTIGA por inteiro, então rodar duas
-- vezes não faz nada na segunda. Se alguma linha já tiver sido editada à mão,
-- ela simplesmente não é tocada — e aparece na conferência do fim com a
-- expressão que tem.
--
-- ⚠ FORA DESTE SEED: a linha LER cita `[Lmqkt33oc]`, que não parece código de
-- linha. Se não for, o motor resolve para ZERO em silêncio e o LER é zero o ano
-- todo. Preservado aqui exatamente como está — conferir à parte.
--
-- Sem filtro de tenant: no SQL Editor o current_tenant_id() é NULL.
-- ============================================================

-- ---------- as três linhas de folha: tirar o -1* ----------
UPDATE relatorio_linha SET expressao = '=[201]+[202]+[203]'
 WHERE codigo IN ('CPESSOAS', 'FDIR', 'FAPOIO')
   AND natureza = 'DESPESA'
   AND replace(expressao, ' ', '') = '=-1*([201]+[202]+[203])';

-- ---------- Margem bruta: subtrair virou somar ----------
UPDATE relatorio_linha SET expressao = '=[MCPRE]+[FDIR]'
 WHERE codigo = 'MGBRUTA'
   AND replace(expressao, ' ', '') = '=[MCPRE]-[FDIR]';

-- ---------- os indicadores de eficiência: compensar o denominador ----------
UPDATE relatorio_linha SET expressao = '=-1*([CPESSOAS]/[FTE])'
 WHERE codigo = 'CMP'  AND replace(expressao, ' ', '') = '=[CPESSOAS]/[FTE]';

UPDATE relatorio_linha SET expressao = '=-1*([MCPRE]/[FDIR])'
 WHERE codigo = 'DLER' AND replace(expressao, ' ', '') = '=[MCPRE]/[FDIR]';

UPDATE relatorio_linha SET expressao = '=-1*([MGBRUTA]/[CPESSOAS])'
 WHERE codigo = 'LERM' AND replace(expressao, ' ', '') = '=[MGBRUTA]/[CPESSOAS]';

UPDATE relatorio_linha SET expressao = '=-1*([MGBRUTA]/[FAPOIO])'
 WHERE codigo = 'MLER' AND replace(expressao, ' ', '') = '=[MGBRUTA]/[FAPOIO]';

-- LER: o numerador fica EXATAMENTE como está, inclusive se for uma referência
-- quebrada. Este seed trata de sinal, não de referência.
UPDATE relatorio_linha SET expressao = '=-1*(' || substring(expressao from 2) || ')'
 WHERE codigo = 'LER'  AND replace(expressao, ' ', '') = '=[Lmqkt33oc]/[CPESSOAS]';

-- PESTRUT não entra: é razão entre FAPOIO e (FDIR+FAPOIO), as duas viram
-- juntas e o sinal se cancela.

-- ---------- conferência (único select: é o que o editor mostra) ----------
SELECT l.codigo,
       l.descricao,
       coalesce(l.natureza, '—') || ' · ' || l.tipo_linha AS situacao,
       l.expressao,
       CASE
         WHEN l.codigo IN ('CPESSOAS','FDIR','FAPOIO')
              AND replace(l.expressao, ' ', '') = '=[201]+[202]+[203]'  THEN '✓ bruto negativo, exibição positiva'
         WHEN l.codigo IN ('CPESSOAS','FDIR','FAPOIO')                  THEN '⚠ não normalizou — conferir'
         WHEN l.expressao LIKE '=-1*%' OR l.codigo IN ('MGBRUTA','PESTRUT') THEN '✓ ajustado'
         ELSE '⚠ conferir'
       END AS leitura
  FROM relatorio_linha l
 WHERE l.codigo IN ('CPESSOAS','FDIR','FAPOIO','MGBRUTA','CMP','DLER','LER','LERM','MLER','PESTRUT')
 ORDER BY CASE WHEN l.codigo IN ('CPESSOAS','FDIR','FAPOIO') THEN 0 ELSE 1 END, l.codigo;
