-- ============================================================
-- SEED — arruma o cadastro de DIVISÃO dos centros de custo
--
-- POR QUE EXISTE: o atalho de divisão (`PillsDim`) monta as pílulas a partir
-- de `centro_custo.divisao_cod`/`divisao_nome`, e hoje duas sairiam como
-- botões sem rótulo — "0" e "3". Atalho com botão sem nome é pior que não ter
-- atalho: a pessoa clica para descobrir o que é.
--
-- SÃO DOIS CASOS DIFERENTES, e só um é erro:
--
-- 1. DIVISÃO 3 = Fábrica de Software. É divisão de VERDADE — 2 CCs (`33` e
--    `330`), dentro da área Serviços, e o `330` tem 212 linhas de orçado em
--    2027. Só faltava o nome. Cadastro incompleto, não lixo.
--
-- 2. DIVISÃO 0 = um CC só, o `200 Comercial`, e é sobra de estrutura antiga
--    (confirmado pelo Ricardo). Repare na incoerência que denuncia:
--        2    Comercial          raiz da área
--          21 Comercial Base     divisão 1 · 10 filhos
--          22 Comercial Novos    divisão 2 ·  9 filhos
--          200 Comercial         divisão 0 ·  0 filhos ·  pai = 21
--    Ele pende DEBAIXO de Base e carrega divisão 0, enquanto todo o resto de
--    Base tem 1. Não é "a divisão zero": é um valor que sobrou. Vai a NULO,
--    como os 23 CCs administrativos, que legitimamente não têm divisão.
--
-- ⚠⚠ ESTE SEED NÃO APOSENTA O CC 200 — só tira a marca de divisão. Mas vale
-- registrar o que a conferência mostrou, porque o número bruto engana:
--     58 postos, dos quais **56 são DEMITIDOS**; os 2 "ativos" têm salário 0
--     realizado  2022: 7,46 mi · 2024: 19,26 mi · 2025: 23,65 mi
--                2026: **−482 mil em 165 linhas** — estornos, não movimento
-- Eu havia escrito aqui que "o CC não é lixo, tem 58 postos e 28 mil linhas":
-- verdade e impressão errada ao mesmo tempo. **O volume é todo passado.** O CC
-- morreu entre 2025 e 2026.
-- ⚠ Ainda assim NÃO se apaga: 28 mil linhas de razão de 2022 a 2025 pendem
-- dele, e sem o CC a DRE daqueles anos perde o recorte. Aposentar aqui é
-- marcar inativo no cadastro, nunca remover.
--
-- ⚠ Tirar a divisão NÃO tira o CC de nenhum filtro: `effectiveCcFilter` só
-- usa `divisao_cod` quando há divisão selecionada. Sem seleção, o 200 continua
-- entrando em tudo, como hoje.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

UPDATE centro_custo SET divisao_nome = 'Fábrica de Software'
 WHERE divisao_cod = '3' AND coalesce(divisao_nome, '') = '';

UPDATE centro_custo SET divisao_cod = NULL, divisao_nome = NULL
 WHERE codigo = '200' AND divisao_cod = '0';

-- ---------------- conferência ----------------
SELECT 'divisões que viram pílula' AS secao,
       (SELECT string_agg(DISTINCT divisao_cod || ' ' || coalesce(divisao_nome, '(SEM NOME)'), ' · '
                          ORDER BY divisao_cod || ' ' || coalesce(divisao_nome, '(SEM NOME)'))
          FROM centro_custo WHERE divisao_cod IS NOT NULL) AS resultado
UNION ALL
SELECT 'sobrou divisão sem nome?',
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE '⛔ ' || string_agg(DISTINCT divisao_cod, ', ') END
          FROM centro_custo WHERE divisao_cod IS NOT NULL AND coalesce(divisao_nome, '') = '')
UNION ALL
SELECT 'CCs por divisão',
       (SELECT string_agg(t, ' · ') FROM (
          SELECT coalesce(divisao_nome, '(sem divisão)') || ': ' || count(*)::text AS t
            FROM centro_custo GROUP BY divisao_nome ORDER BY 1) q)
UNION ALL
SELECT 'o CC 200 continua inteiro?',
       (SELECT 'divisão=' || coalesce(divisao_cod, 'nula')
               || ' · ' || (SELECT count(*) FROM posto p WHERE p.cc_id = cc.id)::text || ' posto(s)'
               || ' · ' || (SELECT count(*) FROM fat_realizado f WHERE f.cc_id = cc.id)::text || ' linha(s) de realizado'
          FROM centro_custo cc WHERE cc.codigo = '200');
