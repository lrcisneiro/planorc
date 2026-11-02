-- ============================================================
-- v3_151 — `funcionario.matricula` passa a aceitar nulo
--
-- A importação parou em "null value in column matricula violates not-null".
-- Não é detalhe de carga: é a tabela dizendo que ainda acredita que **matrícula
-- identifica pessoa**. Ela tem `NOT NULL` *e* `UNIQUE (tenant_id, matricula)`.
--
-- As duas coisas estão erradas, e os números provam: são **513 pessoas para 238
-- matrículas distintas**, porque a matrícula é reusada entre filiais (a `900008`
-- pertence a 7 CPFs). Preencher a coluna faria 275 pessoas colidirem no unique;
-- quem passasse seria uma, escolhida ao acaso.
--
-- Quem identifica pessoa é o CPF — `funcionario_cpf_uq`, da v3_149. A matrícula
-- é um vínculo **pessoa × empresa**, e já vive onde pertence: em `posto`.
--
-- Esta migration faz o mínimo: tira o `NOT NULL`. O `UNIQUE` fica, porque ainda
-- serve ao cadastro manual (um registro por matrícula, quando houver) e, com
-- nulos sendo distintos entre si no Postgres, 513 pessoas sem matrícula convivem
-- sem conflito.
--
-- ⚠ A coluna é VESTIGIAL daqui em diante — como `tipo_linha`/`pai_id` em
-- `conta_orcamentaria`. Fica por compatibilidade com o cadastro manual e com o
-- importador antigo; nada novo deve passar a escrevê-la.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE funcionario ALTER COLUMN matricula DROP NOT NULL;

SELECT 'matricula aceita nulo?' AS secao,
       CASE WHEN is_nullable = 'YES' THEN 'sim' ELSE '⛔ ainda NOT NULL' END AS resultado
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='funcionario' AND column_name='matricula'
UNION ALL
SELECT 'identidade da pessoa',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid='funcionario'::regclass AND conname='funcionario_cpf_uq')
            THEN 'CPF (funcionario_cpf_uq)' ELSE '⛔ sem unique de CPF' END;
