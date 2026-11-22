-- ============================================================
-- v3_198 — a ORDEM dos cenários da visão passa a valer
--
-- O frontend ordenava `view_config.cenarios` pelo CÓDIGO da versão ao ler, e
-- no Comparativo a ordem não é cosmética: **o Δ é a 2ª série menos a 1ª**.
-- Resultado: `ORC2027_PRELIM` vinha sempre antes de `Orçado2027` por acidente
-- de alfabeto, e quem queria ler o preliminar CONTRA o orçado via o sinal
-- invertido sem ter como mudar — o seletor é um checkbox, e checkbox não
-- expressa ordem.
--
-- A ordem agora é a da marcação (`toggleCen` sempre acrescentou no fim: a
-- intenção estava gravada, o sort é que a jogava fora na leitura), e o modal
-- ganhou setas para reordenar.
--
-- ⚠⚠ ESTA MIGRATION EXISTE PARA AS VISÕES JÁ GRAVADAS, e a regra dela é
-- deliberadamente PARCIAL:
--   · **realizado vai para o FIM** — isso não era acidente do alfabeto, é
--     semântica: o plano vem antes do resultado. Sem este passo, "O x R Mensal
--     2026" (gravada como `{REALIZADO, Orçado2026}`) inverteria sozinha e o
--     usuário descobriria pelo sinal do Δ.
--   · **entre VERSÕES, a ordem gravada fica como está** — ali o alfabeto era
--     arbitrário e não significava nada, então devolver a ordem de marcação é
--     justamente o conserto.
-- Reordenar tudo pelo critério antigo seria "preservar" um comportamento que
-- é o defeito.
--
-- Re-executável (idempotente: rodar de novo não muda nada). Termina em SELECT.
-- ============================================================

WITH alvo AS (
  SELECT vc.id,
         -- versões primeiro, na ordem em que já estão; chaves de realizado no fim,
         -- também na ordem em que já estão.
         (SELECT array_agg(c ORDER BY (c LIKE 'REALIZADO%')::int, ord)
            FROM unnest(vc.cenarios) WITH ORDINALITY AS t(c, ord)) AS nova
    FROM view_config vc
   WHERE coalesce(array_length(vc.cenarios, 1), 0) > 1
)
UPDATE view_config vc
   SET cenarios = a.nova
  FROM alvo a
 WHERE vc.id = a.id AND vc.cenarios IS DISTINCT FROM a.nova;

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO: lista a ordem que cada visão comparativa vai exibir agora, e
-- o Δ que ela produz. É o que permite conferir a leitura ANTES de abrir a tela.
SELECT 'visões ajustadas nesta execução' AS secao,
       '(idempotente — zero na 2ª vez)' AS resultado
UNION ALL
SELECT 'alguma com realizado fora do fim?',
       coalesce((SELECT count(*)::text FROM view_config vc
                  WHERE EXISTS (
                    SELECT 1 FROM unnest(vc.cenarios) WITH ORDINALITY AS t(c, ord)
                     WHERE c LIKE 'REALIZADO%'
                       AND ord < (SELECT max(ord2) FROM unnest(vc.cenarios) WITH ORDINALITY AS u(c2, ord2)
                                   WHERE c2 NOT LIKE 'REALIZADO%'))), '0')
UNION ALL
SELECT '— ' || vc.nome,
       -- ⚠ A chave do "ano anterior" é `REALIZADO@-1`, NÃO a string
       -- "REALIZADO_ANT" — essa é só o nome da constante no TypeScript
       -- (`REALIZADO + '@-1'`). A primeira versão desta conferência comparou
       -- com o nome da constante e imprimiu "?" para a visão "Orçado 2027 x
       -- Realizado 2026". O dado estava certo; o relatório é que mentia.
       -- ⚠ `REALIZADO@<ano>` (modo ciclo) é GERADO na leitura e nunca gravado,
       -- mas o padrão cobre caso apareça.
       (SELECT string_agg(CASE WHEN c = 'REALIZADO' THEN 'Realizado'
                               WHEN c = 'REALIZADO@-1' THEN 'Real. ano ant.'
                               WHEN c LIKE 'REALIZADO@%' THEN 'Real. ' || split_part(c, '@', 2)
                               ELSE coalesce(v.codigo, '?') END, '  →  ' ORDER BY ord)
          FROM unnest(vc.cenarios) WITH ORDINALITY AS t(c, ord)
          LEFT JOIN versao_orcamento v ON v.id::text = c)
       || CASE WHEN coalesce(array_length(vc.cenarios, 1), 0) = 2
               THEN '   (Δ = 2ª − 1ª)' ELSE '   (sem Δ: ' || coalesce(array_length(vc.cenarios, 1), 0)::text || ' série(s))' END
  FROM view_config vc
 WHERE vc.funcao = 'COMPARATIVO'
 ORDER BY 1;
