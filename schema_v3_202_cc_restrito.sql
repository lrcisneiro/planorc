-- ============================================================
-- v3_202 — CENTRO DE CUSTO RESTRITO (modo discreto)
--
-- ⚠⚠ ISTO NÃO É CONTROLE DE ACESSO, e a distinção é o desenho inteiro.
-- Quem vê a tela TEM direito ao dado; o que se protege é a SALA — uma
-- apresentação para gerentes e outras diretorias, em que o grão da Diretoria
-- e o dos diretores não deve aparecer. Por isso:
--   · nenhuma política de RLS muda;
--   · a coluna é um atributo de EXIBIÇÃO, não uma autoridade — escrita segue
--     a da própria tabela (a lição da v3_174 vale para DECISÃO, e isto não é;
--     marcar um CC como restrito não dá nem tira acesso a nada).
-- Quem quiser esconder o dado de uma PESSOA continua usando o escopo de
-- acesso, que é enforçado no banco desde a v3_129.
--
-- ⚠ Os cinco códigos são semeados UMA vez, aqui. Depois quem manda é o
-- cadastro (Cadastros → Centros de custo): lista fixa em código é a armadilha
-- já registrada em área/subárea de cargo — conceito desta instalação, não do
-- produto.
--
-- ⚠⚠ A ÁREA NÃO É MARCADA, de propósito, e o motivo é medido: a área 4
-- "Diretoria" tem 4 CCs cadastrados, mas em 2027 **todo o valor dela é do
-- 411** (-6.859.342 de -6.859.342). A regra que a cobre é DERIVADA na tela —
-- "grupo cujo valor vem todo de CC restrito também é mascarado" —, e ela
-- continua valendo se alguém criar um CC novo ali. Marcar a área à mão seria
-- um segundo lugar dizendo a mesma coisa, que diverge no primeiro cadastro.
-- ⚠ Conferir por CONTAGEM de CCs diria que a área 4 "mistura" e a deixaria
-- exposta — a medição certa é por VALOR.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS restrito boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN centro_custo.restrito IS
  'Modo discreto: o grão deste CC não é desenhado em gráfico, drill, razão nem lista de filtro enquanto o modo estiver ligado. Atributo de exibição — não é permissão, e o RLS não o consulta.';

-- semeadura única: só marca, nunca desmarca (desmarcar é ato do cadastro)
UPDATE centro_custo SET restrito = true
 WHERE codigo IN ('411', '210', '220', '310', '320') AND restrito = false;

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO: quais CCs ficaram marcados e quanto eles representam —
-- o balde "Outros" precisa ser pequeno o bastante para não distorcer a leitura
-- e grande o bastante para não ser um CC só disfarçado.
SELECT '1·CCs restritos' AS secao,
       coalesce((SELECT string_agg(codigo || ' ' || descricao, ' · ' ORDER BY codigo)
                   FROM centro_custo WHERE restrito), '⛔ nenhum') AS resultado
UNION ALL
SELECT '2·peso em 2027 (magnitude)',
       (SELECT to_char(sum(abs(f.valor)) FILTER (WHERE cc.restrito), 'FM999G999G999')
            || ' de ' || to_char(sum(abs(f.valor)), 'FM999G999G999') || '  ('
            || round(100.0 * sum(abs(f.valor)) FILTER (WHERE cc.restrito) / nullif(sum(abs(f.valor)), 0), 1)::text || '%)'
          FROM fat_orcado f JOIN centro_custo cc ON cc.id = f.cc_id
         WHERE f.ano = 2027 AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027'))
UNION ALL
SELECT '3·grupos que a regra DERIVADA precisa cobrir (valor 100% restrito)',
       coalesce((SELECT string_agg(dim || ' ' || g || ' = ' || to_char(v, 'FM999G999G999'), ' · ')
          FROM (
            SELECT 'área' AS dim, cc.area_cod AS g, sum(f.valor) v,
                   sum(f.valor) FILTER (WHERE cc.restrito) vr
              FROM fat_orcado f JOIN centro_custo cc ON cc.id = f.cc_id
             WHERE f.ano = 2027 AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')
               AND cc.area_cod IS NOT NULL GROUP BY 1, 2
            UNION ALL
            SELECT 'divisão', cc.divisao_cod, sum(f.valor), sum(f.valor) FILTER (WHERE cc.restrito)
              FROM fat_orcado f JOIN centro_custo cc ON cc.id = f.cc_id
             WHERE f.ano = 2027 AND f.versao_id = (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027')
               AND cc.divisao_cod IS NOT NULL GROUP BY 1, 2
          ) x WHERE v <> 0 AND abs(vr) >= abs(v) * 0.999), 'nenhum')
ORDER BY 1;
