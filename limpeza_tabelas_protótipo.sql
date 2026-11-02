-- ============================================================
-- Derrubar as sete tabelas do protótipo original  (OPCIONAL)
--
-- Nada aqui é urgente nem de segurança: com RLS ligado e zero política, elas já
-- negam tudo. É higiene — tabela morta no schema faz alguém supor que serve
-- para alguma coisa, e um dia essa suposição vira código.
--
-- POR QUE ESTÃO MORTAS, com três evidências independentes:
--   · zero referência no frontend e nas edge functions;
--   · o único arquivo que as cria é `supabase_001_schema_inicial.sql`, o schema
--     do protótipo;
--   · as equivalentes VIVAS nasceram depois — `dimensao`/`dimensao_valor` em
--     `supabase_003`/`schema_v2`, `view_config` em `schema_v3_relatorio_formulario`.
-- E estão inacessíveis pela API desde sempre sem ninguém notar, que é a melhor
-- evidência de todas.
--
-- As 8 + 6 + 2 linhas são dado de teste da primeira versão.
--
-- ⚠ SEM CASCADE, DE PROPÓSITO. A ordem abaixo respeita as dependências. Se
-- aparecer erro de FK, é porque existe dependente que eu NÃO mapeei — e aí o
-- erro é a informação que você quer, não um obstáculo. CASCADE derrubaria o
-- dependente junto, em silêncio.
--
-- Guarde o resultado da parte 1 antes de rodar a 2, caso queira o conteúdo.
-- ============================================================

-- ---------- 1 · o que será perdido (só leitura) ----------
SELECT 'dim_definition' AS tabela, to_jsonb(d.*) AS conteudo FROM dim_definition d
UNION ALL SELECT 'dim_value',           to_jsonb(v.*) FROM dim_value v
UNION ALL SELECT 'visao_plano',         to_jsonb(p.*) FROM visao_plano p;

-- ---------- 2 · derrubar (descomente para executar) ----------
-- Ordem: filhas antes das mães.
--
-- DROP TABLE IF EXISTS fat_lancamento_verba;   -- aponta p/ verba_orcamentaria
-- DROP TABLE IF EXISTS map_rubrica_verba;      -- aponta p/ verba_orcamentaria
-- DROP TABLE IF EXISTS verba_orcamentaria;     -- agora sem dependente
-- DROP TABLE IF EXISTS map_conta_linha;
-- DROP TABLE IF EXISTS dim_value;              -- aponta p/ dim_definition
-- DROP TABLE IF EXISTS dim_definition;
-- DROP TABLE IF EXISTS visao_plano;

-- ---------- 3 · conferir que sumiram ----------
-- SELECT c.relname FROM pg_class c
--  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
--    AND c.relname IN ('dim_definition','dim_value','visao_plano','fat_lancamento_verba',
--                      'map_conta_linha','map_rubrica_verba','verba_orcamentaria');
-- Vazio aqui É o resultado esperado — e só aqui, porque a pergunta é "sobrou?".
