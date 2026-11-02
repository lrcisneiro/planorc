-- ============================================================
-- v3_145 — Separar o cargo da FOLHA do cargo do PLANO
--
-- Duas coisas diferentes dividiam a tabela `cargo`:
--   · o que o Protheus manda (truncado em 20 caracteres, `STEP`/`JR` misturados,
--     268 pessoas num rótulo só) — é DADO DE ENTRADA, não decisão;
--   · o plano de cargos que a empresa está desenhando — é DECISÃO, e é o que a
--     árvore deve representar.
--
-- Tratá-las como a mesma coisa convidava a hierarquizar o que não é para ser
-- hierarquizado: os cargos da folha estão sendo reestruturados, então organizá-
-- los agora seria trabalho jogado fora.
--
-- `origem` separa as duas. Default `ERP` de propósito: é a importação que cria
-- em volume, e assim ela não precisa saber desta coluna — os 106 que já existem
-- viram ERP sem UPDATE nenhum, que é o que eles são.
--
-- A árvore vira, de quebra, o DE-PARA: pendurar "ANAL. NEGOCIO III" (folha) sob
-- "Analista de Negócios Pleno" (plano) diz as duas coisas ao mesmo tempo — onde
-- ele está na carreira e a que cargo novo corresponde. Não precisa de tela de
-- amarração separada.
--
-- Isso tem fim natural: quando o RH reestruturar e o export mandar os nomes
-- novos, o import casa por nome com os cargos do plano e os ERP param de
-- crescer. A lista de entrada esvazia sozinha — e cargo novo aparecendo lá
-- depois disso é alguém criando rótulo fora do plano, visível no dia.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE cargo ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'ERP';

DO $$ BEGIN
  ALTER TABLE cargo ADD CONSTRAINT cargo_origem_chk CHECK (origem IN ('ERP','PLANO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cargo_origem ON cargo (tenant_id, origem);

SELECT origem,
       count(*)                                        AS cargos,
       count(*) FILTER (WHERE pai_id IS NOT NULL)      AS com_pai,
       count(*) FILTER (WHERE nivel  IS NOT NULL)      AS com_nivel
  FROM cargo GROUP BY origem ORDER BY origem;
