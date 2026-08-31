-- ============================================================
-- SEED — Indicadores Operacionais (P0 do docs/DESIGN_indicadores_executivo.md)
--
-- Cria no DRE as linhas de apoio e os INDICADOR do estudo TOESTE:
--   CPESSOAS  Custo Pessoas fully loaded   (apoio; soma as linhas de custo que você indicar)
--   FTE       Headcount médio              (entrada manual, mensal)
--   LER       LER Bruto      = Receita / Custo Pessoas
--   LERM      LER de Margem  = Margem Bruta / Custo Pessoas
--   RFTE      Receita por FTE
--   CMP       Custo médio por pessoa
--   MBP       Margem Bruta %
--   PREC      % Recorrência  (só com o Bloco B — matriz de receita)
--
-- O seed NÃO mexe em amarração (conta_linha), não altera linha existente
-- (a menos que você ligue v_sobrescrever) e não muda nenhum total do DRE:
-- INDICADOR fica fora do SOMAR_FILHOS e as linhas nascem na RAIZ, sem pai.
--
-- Depois de rodar: os cards aparecem em Dashboards → Indicadores e no botão
-- "Indicadores" da Visão Executiva. Confira o LER com validar_ler_vs_planilha.sql.
--
-- IDEMPOTENTE. Rode no SQL editor do Supabase.
-- ============================================================

-- ── Antes de configurar, descubra os códigos do seu DRE: ──
--   SELECT rl.codigo, rl.descricao, rl.tipo_linha, rl.natureza, rl.ordem
--     FROM relatorio_linha rl JOIN relatorio r ON r.id = rl.relatorio_id
--    WHERE r.codigo = 'DRE'          -- ajuste
--    ORDER BY rl.ordem;

DO $$
DECLARE
  -- ══════════════ CONFIGURE AQUI ══════════════
  v_rel_codigo      text   := 'DRE';          -- código do relatório (tabela relatorio)
  v_cod_receita     text   := 'REC';          -- linha de RECEITA TOTAL já existente
  v_cod_margem      text   := 'MB';           -- linha de MARGEM BRUTA já existente ('' = não criar LERM/MBP)
  v_cods_custo      text[] := ARRAY['DP01'];  -- linhas que compõem o CUSTO DE PESSOAS fully loaded
                                              -- (salários, encargos, benefícios, PJ, bônus, treinamentos)
  v_custo_negativo  boolean := true;          -- true = despesa é negativa no DRE (padrão: valor = crédito − débito)
  v_sobrescrever    boolean := false;         -- true = atualiza linhas do seed que já existam (use ao reajustar fórmula)

  -- Bloco B — matriz de receita 2×2. Cria R1/R2/S1/S2 SOB a receita e MUDA a
  -- árvore: exige reamarrar contas em /amarracao, senão a receita dobra ou zera.
  v_criar_matriz    boolean := false;
  -- ════════════ fim da configuração ════════════

  v_tenant  uuid;  v_rel uuid;  v_rel_nome text;
  v_pai     uuid;  v_pai_nivel int;  v_ordem int;
  v_expr_cp text;  v_soma text := '';
  v_master  uuid;  v_existe boolean;
  r record;  c text;  i int;
  v_criados text := '';  v_pulados text := '';
BEGIN
  -- ajuste aqui se houver mais de um tenant:
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Nenhum tenant encontrado'; END IF;

  SELECT id, nome INTO v_rel, v_rel_nome FROM relatorio WHERE tenant_id = v_tenant AND codigo = v_rel_codigo;
  IF v_rel IS NULL THEN RAISE EXCEPTION 'Relatório % não encontrado (confira v_rel_codigo)', v_rel_codigo; END IF;

  -- ── 1) Conferir as linhas que as fórmulas referenciam ──
  IF NOT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = v_cod_receita) THEN
    RAISE EXCEPTION 'Linha de receita "%" não existe em %. Rode a query de descoberta no topo do arquivo.', v_cod_receita, v_rel_codigo;
  END IF;
  IF v_cod_margem <> '' AND NOT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = v_cod_margem) THEN
    RAISE EXCEPTION 'Linha de margem "%" não existe em %. Use '''' para pular LERM/MBP.', v_cod_margem, v_rel_codigo;
  END IF;
  FOREACH c IN ARRAY v_cods_custo LOOP
    IF NOT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = c) THEN
      RAISE EXCEPTION 'Linha de custo "%" não existe em %.', c, v_rel_codigo;
    END IF;
    v_soma := v_soma || CASE WHEN v_soma = '' THEN '' ELSE '+' END || '[' || c || ']';
  END LOOP;

  -- Custo de pessoas SEMPRE positivo: o card mostra custo como número positivo e
  -- os indicadores (LER = receita/custo) só fazem sentido com o sinal invertido.
  v_expr_cp := CASE WHEN v_custo_negativo THEN format('=-1*(%s)', v_soma) ELSE format('=%s', v_soma) END;

  -- ── 2) Linhas na RAIZ do relatório ──
  -- Por que raiz: em ExecutivoPage a natureza é herdada do pai quando a linha é
  -- NEUTRO; pendurar o custo sob um pai DESPESA inverteria o sinal do card.
  SELECT COALESCE(MAX(ordem), 0) INTO v_ordem FROM relatorio_linha WHERE relatorio_id = v_rel AND pai_id IS NULL;

  FOR r IN
    SELECT * FROM (VALUES
      -- codigo, descricao, tipo, expressao, formato, casas, apoio, criar
      ('CPESSOAS', 'Custo Pessoas (fully loaded)', 'INDICADOR', v_expr_cp,                                        'MOEDA',      0, true,  true),
      ('FTE',      'Headcount médio (FTE)',        'ANALITICA', NULL,                                             'NUMERO',     1, false, true),
      ('LER',      'LER Bruto',                    'INDICADOR', format('=[%s]/[CPESSOAS]', v_cod_receita),        'NUMERO',     2, true,  true),
      ('LERM',     'LER de Margem',                'INDICADOR', format('=[%s]/[CPESSOAS]', v_cod_margem),         'NUMERO',     2, true,  v_cod_margem <> ''),
      ('RFTE',     'Receita por FTE (mês)',        'INDICADOR', format('=[%s]/[FTE]', v_cod_receita),             'MOEDA',      0, true,  true),
      ('CMP',      'Custo médio por pessoa (mês)', 'INDICADOR', '=[CPESSOAS]/[FTE]',                              'MOEDA',      0, true,  true),
      ('MBP',      'Margem Bruta %',               'INDICADOR', format('=[%s]/[%s]*100', v_cod_margem, v_cod_receita), 'PERCENTUAL', 1, true, v_cod_margem <> ''),
      ('PREC',     '% Recorrência',                'INDICADOR', format('=([R1]+[S1])/[%s]*100', v_cod_receita),   'PERCENTUAL', 1, true,  v_criar_matriz)
    ) AS t(codigo, descricao, tipo, expressao, formato, casas, apoio, criar)
  LOOP
    CONTINUE WHEN NOT r.criar;
    SELECT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = r.codigo) INTO v_existe;
    IF v_existe AND NOT v_sobrescrever THEN
      v_pulados := v_pulados || r.codigo || ' ';
      CONTINUE;
    END IF;

    -- FTE recebe valor (orçado e realizado), então precisa de conta orçamentária
    -- própria. IMPORTANTE: fica com nao_soma=false — lib/relatorioTotais.ts só
    -- distribui o valor do master para linhas com nao_soma=false, então uma linha
    -- de apoio que RECEBE dado precisa ficar de fora dessa flag. Ela não soma em
    -- nada mesmo assim: está na raiz, sem pai, e é NEUTRO.
    v_master := NULL;
    IF r.tipo = 'ANALITICA' THEN
      INSERT INTO conta_orcamentaria (tenant_id, codigo, descricao, nivel, tipo_linha, natureza, formato, casas_decimais)
      VALUES (v_tenant, r.codigo, r.descricao, 1, 'ANALITICA', 'NEUTRO', r.formato, r.casas)
      ON CONFLICT (tenant_id, codigo) DO NOTHING;
      SELECT id INTO v_master FROM conta_orcamentaria WHERE tenant_id = v_tenant AND codigo = r.codigo;
    END IF;

    v_ordem := v_ordem + 10;
    INSERT INTO relatorio_linha (relatorio_id, pai_id, codigo, descricao, ordem, nivel, tipo_linha,
                                 expressao, natureza, formato, casas_decimais, nao_soma,
                                 linha_orc_id, visivel_dashboard, visivel_relatorio)
    VALUES (v_rel, NULL, r.codigo, r.descricao, v_ordem, 1, r.tipo,
            r.expressao, 'NEUTRO', r.formato, r.casas, r.apoio,
            v_master, true, true)
    ON CONFLICT (relatorio_id, codigo) DO UPDATE SET
      descricao = EXCLUDED.descricao, tipo_linha = EXCLUDED.tipo_linha,
      expressao = EXCLUDED.expressao, formato = EXCLUDED.formato,
      casas_decimais = EXCLUDED.casas_decimais, nao_soma = EXCLUDED.nao_soma,
      linha_orc_id = COALESCE(relatorio_linha.linha_orc_id, EXCLUDED.linha_orc_id);
    v_criados := v_criados || r.codigo || ' ';
  END LOOP;

  -- ── 3) Bloco B (opcional) — matriz de receita 2×2 sob a linha de receita ──
  IF v_criar_matriz THEN
    SELECT id, nivel INTO v_pai, v_pai_nivel FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = v_cod_receita;
    SELECT COALESCE(MAX(ordem), 0) INTO v_ordem FROM relatorio_linha WHERE relatorio_id = v_rel AND pai_id = v_pai;
    FOR r IN
      SELECT * FROM (VALUES
        ('R1', 'Repasse recorrente'),
        ('R2', 'Repasse pontual'),
        ('S1', 'Serviço recorrente'),
        ('S2', 'Projetos (não recorrente)')
      ) AS t(codigo, descricao)
    LOOP
      SELECT EXISTS (SELECT 1 FROM relatorio_linha WHERE relatorio_id = v_rel AND codigo = r.codigo) INTO v_existe;
      IF v_existe AND NOT v_sobrescrever THEN v_pulados := v_pulados || r.codigo || ' '; CONTINUE; END IF;

      INSERT INTO conta_orcamentaria (tenant_id, codigo, descricao, nivel, tipo_linha, natureza, formato, casas_decimais)
      VALUES (v_tenant, r.codigo, r.descricao, COALESCE(v_pai_nivel, 1) + 1, 'ANALITICA', 'RECEITA', 'MOEDA', 0)
      ON CONFLICT (tenant_id, codigo) DO NOTHING;
      SELECT id INTO v_master FROM conta_orcamentaria WHERE tenant_id = v_tenant AND codigo = r.codigo;

      v_ordem := v_ordem + 10;
      INSERT INTO relatorio_linha (relatorio_id, pai_id, codigo, descricao, ordem, nivel, tipo_linha,
                                   natureza, formato, casas_decimais, linha_orc_id)
      VALUES (v_rel, v_pai, r.codigo, r.descricao, v_ordem, COALESCE(v_pai_nivel, 1) + 1, 'ANALITICA',
              'RECEITA', 'MOEDA', 0, v_master)
      ON CONFLICT (relatorio_id, codigo) DO UPDATE SET
        descricao = EXCLUDED.descricao,
        linha_orc_id = COALESCE(relatorio_linha.linha_orc_id, EXCLUDED.linha_orc_id);
      v_criados := v_criados || r.codigo || ' ';
    END LOOP;
    RAISE NOTICE 'MATRIZ criada. Agora reamarre as contas em /amarracao: enquanto as contas de receita continuarem apontando para as linhas antigas, R1/R2/S1/S2 ficam zerados; se apontarem para as duas, a receita DOBRA. Rode a checagem 3 do validar_ler_vs_planilha.sql.';
  END IF;

  RAISE NOTICE 'Relatório: % (%)', v_rel_nome, v_rel_codigo;
  RAISE NOTICE 'Custo Pessoas: %', v_expr_cp;
  RAISE NOTICE 'Gravados: %', COALESCE(NULLIF(v_criados, ''), '(nenhum)');
  IF v_pulados <> '' THEN
    RAISE NOTICE 'Já existiam, mantidos intactos: % — ligue v_sobrescrever para atualizar', v_pulados;
  END IF;
END $$;

-- ── Conferência do que ficou ──
SELECT rl.codigo, rl.descricao, rl.tipo_linha, rl.expressao, rl.formato, rl.casas_decimais,
       rl.nao_soma, (rl.linha_orc_id IS NOT NULL) AS tem_conta_orcamentaria
  FROM relatorio_linha rl
  JOIN relatorio r ON r.id = rl.relatorio_id
 WHERE r.codigo = 'DRE'   -- ajuste
   AND rl.codigo IN ('CPESSOAS','FTE','LER','LERM','RFTE','CMP','MBP','PREC','R1','R2','S1','S2')
 ORDER BY rl.ordem;
