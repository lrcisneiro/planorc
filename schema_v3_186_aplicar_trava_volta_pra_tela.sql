-- ============================================================
-- v3_186 — desfaz o gatilho da v3_185: ele barrava o que não devia
--
-- A v3_185 moveu para o banco a trava "cenário de posto só vira dinheiro
-- depois de aprovado", citando a v3_174 (autoridade que existe na função e
-- falta na tabela). A intenção estava certa; o que foi escrito, não.
--
-- ⚠⚠ O QUE ELE NÃO CONSEGUE SABER. O Aplicar tem dois modos, e eles escrevem
-- exatamente as mesmas colunas:
--     modo CADASTRO — grava o quadro mestre. Não há decisão nenhuma dentro.
--     modo CENÁRIO  — grava as decisões da versão. ESTE é o que precisa de
--                     carimbo.
-- Da tabela `fat_orcado` os dois são indistinguíveis: mesma origem 'POSTO',
-- mesmas colunas, mesmo formato. O gatilho então usou o único sinal que
-- alcançava — "a versão de destino TEM decisões" — e isso é outra pergunta.
-- Resultado: aplicar o CADASTRO na baseline passou a ser recusado só porque
-- existe um cenário em negociação em outro canto. Apareceu em 16/nov, ao
-- reaplicar o quadro depois de um ajuste de RATEIO: nada de cenário envolvido,
-- e o Aplicar recusado.
--
-- ⚠ Por que não dá para "melhorar o predicado": o que distingue os dois modos
-- é a INTENÇÃO de quem chamou, e intenção não está na linha gravada. Só
-- chegaria ao banco se o Aplicar inteiro virasse uma RPC que recebesse o modo
-- — e aí a trava é da função, não da tabela. Enquanto isso não existir, a
-- regra é de TELA, e é mais honesto dizer isso do que manter uma guarda que
-- recusa a operação errada.
--
-- Fica de pé o que o frontend já faz (`PostosGradePage`, diálogo do Aplicar):
--   destino baseline + modo cenário + decisão sem carimbo → recusa
--   destino cenário                                        → libera, e permite
--                                                            "como se tudo
--                                                             passasse"
-- E o que o banco de fato garante continua garantindo: `bloqueada` trava a
-- versão, `pode_escrever()` trava o papel, e o RLS por versão (v3_137) trava
-- quem alcança o quê.
--
-- Termina em SELECT.
-- ============================================================

DROP TRIGGER IF EXISTS trg_fat_orcado_posto_carimbo ON fat_orcado;
DROP FUNCTION IF EXISTS fat_orcado_posto_exige_carimbo();

SELECT 'gatilho da v3_185' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgname = 'trg_fat_orcado_posto_carimbo' AND NOT tgisinternal)
            THEN '⛔ ainda existe' ELSE 'removido' END AS resultado
UNION ALL
SELECT 'função',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fat_orcado_posto_exige_carimbo')
            THEN '⛔ ainda existe' ELSE 'removida' END
UNION ALL
SELECT 'versões 2027 que voltam a aceitar o Aplicar',
       coalesce((SELECT string_agg(codigo, ', ' ORDER BY codigo) FROM versao_orcamento
                  WHERE ano = 2027 AND NOT bloqueada), 'nenhuma');
