-- ============================================================
-- v3_187 — PLR: verba que cai em meses específicos (`PARCELAS`)
--
-- Desenho em docs/DESIGN_plr.md. O motor sabia três coisas perto e nenhuma
-- servia: `VALOR_FIXO` repete todo mês, `PROVISAO_1_12` dilui, e as `RESC_*`
-- valem só num mês mas o mês vem da vigência, não é configurável.
--
-- `PARCELAS` generaliza o que as `RESC_*` já faziam: devolve valor no mês
-- listado e ZERO nos demais. O valor por pessoa continua em `posto_verba`
-- (onde os benefícios já moram); o que entra aqui é o CALENDÁRIO.
--
-- ⚠ O CALENDÁRIO VIVE NA VERBA, não na pessoa: "quando a empresa paga PLR" é
-- decisão da empresa. Formato `mês:percentual`, separados por `;`.
--   '3:50;6:50'  → metade em março, metade em junho
--   '3:60;9:40'  → 60% em março, 40% em setembro
--
-- ⚠ E ELE TEM DE SER CONFIGURÁVEL, não constante: medido no `srd`, em 2026 as
-- parcelas foram março e junho; em 2024 e 2025, março e setembro. Muda todo
-- ano.
--
-- ⚠ A ISENÇÃO NÃO PRECISA DE CÓDIGO. A Lei 10.101/2000 tira a PLR de INSS,
-- FGTS, 13º, férias e aviso, e no motor isso é `incide_encargos = false`: a
-- verba deixa de entrar na `baseEncargos`, que é sobre o que `PCT_BASE` e
-- `PROVISAO_1_12` calculam. O IRRF fica fora porque é retido do FUNCIONÁRIO —
-- não é custo da empresa.
--
-- ⚠ O CHECK de `tipo_calculo` É UMA LISTA FECHADA: acrescentar o tipo sem
-- mexer nele faria todo INSERT/UPDATE da verba falhar — e só no clique.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE verba_folha ADD COLUMN IF NOT EXISTS calendario text;

COMMENT ON COLUMN verba_folha.calendario IS
  'Só para tipo_calculo = PARCELAS. Meses e percentuais no formato "mes:pct;mes:pct" (ex.: 3:50;6:50). A lei permite no máximo 2 parcelas, com no mínimo um trimestre civil entre elas.';

ALTER TABLE verba_folha DROP CONSTRAINT IF EXISTS verba_folha_tipo_calculo_chk;
ALTER TABLE verba_folha ADD CONSTRAINT verba_folha_tipo_calculo_chk
  CHECK (tipo_calculo = ANY (ARRAY[
    'BASE', 'PCT_BASE', 'PCT_VERBA', 'PROVISAO_1_12', 'VALOR_FIXO', 'INFORMATIVA',
    'RESC_AVISO', 'RESC_PROP', 'RESC_SALDO_FGTS', 'PARCELAS']));

-- ⚠ Guarda do FORMATO, não da regra da lei. O banco consegue afirmar que o
-- texto é legível (meses 1..12, percentuais numéricos); quantas parcelas e
-- que distância entre elas é conferência da tela, onde dá para explicar o
-- porquê a quem está cadastrando. Formato ilegível aqui viraria verba que
-- rende zero o ano inteiro, calada.
ALTER TABLE verba_folha DROP CONSTRAINT IF EXISTS verba_folha_calendario_chk;
ALTER TABLE verba_folha ADD CONSTRAINT verba_folha_calendario_chk
  CHECK (calendario IS NULL OR calendario ~ '^([1-9]|1[0-2]):[0-9]+(\.[0-9]+)?(;([1-9]|1[0-2]):[0-9]+(\.[0-9]+)?)*$');

-- ---------------- conferência ----------------
SELECT 'coluna calendario' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='verba_folha' AND column_name='calendario')
            THEN 'criada' ELSE '⛔ não' END AS resultado
UNION ALL
SELECT 'PARCELAS aceito no check',
       CASE WHEN pg_get_constraintdef(c.oid) LIKE '%PARCELAS%' THEN 'sim' ELSE '⛔ não' END
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
 WHERE t.relname='verba_folha' AND c.conname='verba_folha_tipo_calculo_chk'
UNION ALL
SELECT 'verbas existentes continuam válidas',
       (SELECT count(*)::text || ' verba(s), nenhuma recusada pelo check novo' FROM verba_folha);
