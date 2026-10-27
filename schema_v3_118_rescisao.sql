-- ============================================================
-- 118 — Rescisão estimada no mês da demissão (CLT)
--
-- A DATA da demissão já existia: `posto.fim_ano`/`fim_mes` (vigência fim), e o
-- motor já parava o custo depois dela. O que faltava é que uma demissão não só
-- para de custar — ela custa MAIS uma vez, no mês da saída.
--
-- Três tipos de cálculo novos, porque cada parcela tem uma FORMA DE QUANTIDADE
-- diferente (não é um parâmetro a mais numa fórmula só):
--   RESC_AVISO       salário × min(90, 30 + 3×anos de casa)/30 × parametro
--                    Lei 12.506/11. `parametro` é multiplicador: 1 = indenizado
--                    cheio, 0,5 = acordo (Lei 13.467/17), 0 = aviso trabalhado
--                    (que não é custo extra — a pessoa trabalha e recebe normal).
--   RESC_PROP        salário × meses do ano / 12 × parametro
--                    13º proporcional (fator 1); férias + 1/3 (fator 1,3333).
--   RESC_SALDO_FGTS  salário × meses de casa × parametro%
--                    multa de 40%: 40% × 8% = 3,2%. É ESTIMATIVA — o saldo real
--                    está no extrato do FGTS e o orçamento não o tem.
--
-- Todas disparam SÓ no mês do fim de vigência e valem zero nos outros. Por isso
-- o FGTS sobre as verbas rescisórias não precisa de tipo novo: é um `PCT_VERBA`
-- comum apontando para elas, que rende 8% de zero nos outros 11 meses.
--
-- REGIME faz o recorte: estas entram só em `BR-CLT`. Prestador e pró-labore têm
-- fim de contrato, não rescisão — e o filtro por regime já existia no motor.
--
-- ⚠ DUPLA CONTAGEM: se o catálogo já tiver uma verba de PROVISÃO de rescisão
-- rodando todo mês (o padrão contábil, como a `PY_IND` do Paraguai), ela e estas
-- se somam. O bloco de aviso no fim deste script procura candidatas e avisa.
-- IDEMPOTENTE.
-- ============================================================

-- ---------- admissão no posto (tempo de casa) ----------
-- Separada da vigência de propósito: `ini_ano`/`ini_mes` descrevem o ANO ORÇADO
-- e alguém pode editá-las sem pensar no FGTS. O motor usa `admissao` e, sem ela,
-- cai na vigência de início — que é onde o import do RH grava a admissão hoje.
ALTER TABLE posto ADD COLUMN IF NOT EXISTS admissao date;
COMMENT ON COLUMN posto.admissao IS
  'Admissão real (do RH). Usada só pela rescisão: aviso prévio progressivo e saldo do FGTS. NULL = cai em ini_ano/ini_mes.';

-- ---------- tipo_calculo: três valores novos ----------
DO $$
DECLARE cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'verba_folha'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tipo_calculo%'
  LOOP EXECUTE format('ALTER TABLE verba_folha DROP CONSTRAINT %I', cname); END LOOP;

  ALTER TABLE verba_folha ADD CONSTRAINT verba_folha_tipo_calculo_chk
    CHECK (tipo_calculo IN ('BASE','PCT_BASE','PCT_VERBA','PROVISAO_1_12','VALOR_FIXO','INFORMATIVA',
                            'RESC_AVISO','RESC_PROP','RESC_SALDO_FGTS'));

  FOR cname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'verba_folha'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%categoria%'
  LOOP EXECUTE format('ALTER TABLE verba_folha DROP CONSTRAINT %I', cname); END LOOP;

  ALTER TABLE verba_folha ADD CONSTRAINT verba_folha_categoria_chk
    CHECK (categoria IS NULL OR categoria IN ('SALARIO','ENCARGOS','PROVISOES','BENEFICIOS','RESCISAO'));
END $$;

-- ---------- as cinco verbas de rescisão (BR-CLT) ----------
-- ordem 70+ para caírem DEPOIS do salário: o RESC_FGTS_V é PCT_VERBA sobre o
-- aviso e o 13º, e a cascata resolve referência na ordem.
-- conta_destino_id fica NULL — amarrar em Postos → Regras, senão o Aplicar não
-- leva o valor para o fat_orcado (a tela avisa).
INSERT INTO verba_folha
  (tenant_id, codigo, descricao, tipo_calculo, parametro, verba_ref, incide_encargos, mantem_afastado, ordem, regime, pais, categoria, ativo)
SELECT t.id, v.codigo, v.descricao, v.tipo_calculo, v.parametro, v.verba_ref, false, true, v.ordem, 'BR-CLT', 'BR', 'RESCISAO', true
FROM (
  SELECT COALESCE(
    (SELECT tenant_id FROM verba_folha LIMIT 1),
    (SELECT tenant_id FROM empresa     LIMIT 1)
  ) AS id
) t
CROSS JOIN (VALUES
  ('RESC_AVISO',  'Aviso prévio indenizado (30d + 3d/ano, teto 90)', 'RESC_AVISO',      1::numeric,   NULL::text,          70),
  ('RESC_13',     '13º proporcional (rescisão)',                     'RESC_PROP',       1,            NULL,                71),
  ('RESC_FER',    'Férias proporcionais + 1/3 (rescisão)',           'RESC_PROP',       1.3333,       NULL,                72),
  ('RESC_FGTS40', 'Multa 40% do FGTS (estimada s/ tempo de casa)',   'RESC_SALDO_FGTS', 3.2,          NULL,                73),
  ('RESC_FGTS_V', 'FGTS 8% sobre aviso prévio e 13º',                'PCT_VERBA',       8,            'RESC_AVISO,RESC_13', 74)
) AS v(codigo, descricao, tipo_calculo, parametro, verba_ref, ordem)
WHERE t.id IS NOT NULL
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- ---------- aviso de dupla contagem ----------
-- NOTA: o SQL Editor do Supabase NÃO exibe RAISE NOTICE (só "Success"), então
-- este bloco é inútil ali. A conferência de verdade está em
-- `diagnostico_rescisao.sql`, que responde por SELECT. Mantido para quem rodar
-- por psql, onde o NOTICE aparece.
DO $$
DECLARE n int; lista text;
BEGIN
  SELECT count(*), string_agg(codigo || ' (' || descricao || ')', ', ')
    INTO n, lista
  FROM verba_folha
  WHERE ativo
    AND codigo NOT LIKE 'RESC_%'
    AND tipo_calculo IN ('PROVISAO_1_12','PCT_BASE')
    AND (descricao ILIKE '%resc%' OR descricao ILIKE '%multa%'
         OR descricao ILIKE '%40%%' OR descricao ILIKE '%demiss%' OR descricao ILIKE '%indeniz%');
  IF n > 0 THEN
    RAISE NOTICE '*** ATENÇÃO: % verba(s) parecem JÁ provisionar rescisão mês a mês: %', n, lista;
    RAISE NOTICE '*** As novas RESC_* se SOMAM a elas. Escolha um dos dois caminhos em Postos -> Regras:';
    RAISE NOTICE '***   (a) manter a provisão mensal e desativar as RESC_*, ou';
    RAISE NOTICE '***   (b) desativar a provisão mensal e deixar o custo cair no mês da saída.';
  ELSE
    RAISE NOTICE 'Nenhuma provisão de rescisão mensal encontrada — sem risco de dupla contagem.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
