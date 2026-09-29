-- ============================================================
-- 112 — Apontamento de horas (fat_apontamento)
--
-- Profissionais de serviço apontam horas em projetos; dessas horas o integrador
-- do ERP (OEFOLM02.PRW) gera as verbas da folha por centro de custo. Hoje o
-- líder não consegue verificar se as horas que aprovou viraram custo no CC e na
-- empresa DAQUELE projeto.
--
-- Grão: uma linha por apontamento, como vem do extrato. Não agrega na
-- importação — agregado não se confere depois.
--
-- Desenho completo e medido em docs/DESIGN_conciliacao_apontamento.md.
-- Dois pontos que o modelo carrega e não são óbvios:
--
--  · DOIS CCs. cc_projeto é de quem se pergunta (o CC do projeto, campo
--    AFU_CCPRJ do apontamento); cc_recurso é o CC da pessoa. A conciliação é
--    sobre o primeiro, e o segundo explica boa parte das divergências sem
--    precisar de pesquisa.
--
--  · DUAS COMPETÊNCIAS. ano/mes é a do apontamento; comp_folha_* é a da folha
--    a que ele corresponde, e a defasagem depende do tipo de contrato — PJ 1
--    mês, CLT 2 (medido: julho contra a folha de agosto concilia 146 chaves,
--    junho concilia 4). Gravar a competência-alvo por linha é o que permite uma
--    folha comparar contra dois arquivos de apontamento diferentes.
--
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS fat_apontamento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,

  -- competência do APONTAMENTO (vem do nome do arquivo: yyyyMMdd_yyyyMMdd)
  ano            int NOT NULL,
  mes            int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- competência da FOLHA correspondente (defasagem por tipo de contrato)
  comp_folha_ano int,
  comp_folha_mes int CHECK (comp_folha_mes BETWEEN 1 AND 12),

  -- pessoa: o extrato identifica por RECURSO, não por matrícula
  recurso_cod    text NOT NULL,
  nome           text,
  posto_id       uuid REFERENCES posto ON DELETE SET NULL,   -- resolvido por recurso_cod
  matricula      text,                                       -- do posto, para conferência

  -- onde. DUAS filiais, e a distinção é o que evita divergência falsa:
  --  · filial_id       = a filial do POSTO, onde a folha paga. É a da CHAVE.
  --  · filial_apont_id = a filial do PROJETO (Empresa+Filial do extrato, 4 díg.
  --    como na folha). Não é onde a pessoa está lotada: em jun/2026, 56 pessoas
  --    e 14% das horas foram apontadas numa unidade diferente da do seu posto.
  --    Isso é o funcionamento normal — gente atendendo projeto de outra unidade
  --    — e conciliar por ela acusaria diferença nas duas pontas.
  -- Sem posto resolvido, filial_id cai na do apontamento (é o que se sabe).
  empresa_id     uuid REFERENCES empresa,
  filial_id      uuid REFERENCES filial,
  filial_apont_id uuid REFERENCES filial,
  cc_projeto_id  uuid REFERENCES centro_custo,   -- AFU_CCPRJ — o CC de quem se pergunta
  cc_recurso_id  uuid REFERENCES centro_custo,   -- o CC da pessoa

  -- o quê
  projeto_cod    text,
  projeto_desc   text,
  os_num         text,
  tarefa         text,
  data           date,

  -- quanto: HORAS é a grandeza da conciliação. O valor entra como informação,
  -- porque a folha usa OUTRA taxa (valor-hora do cadastro, RetValHr) e comparar
  -- valor compara duas moedas para a mesma hora.
  horas          numeric(14,2) NOT NULL DEFAULT 0,
  horas_rv       numeric(14,2) NOT NULL DEFAULT 0,   -- traslado → verba 223
  custo_hora     numeric(18,6),
  valor          numeric(18,2),

  status_aprov   text,                                -- 'A' aprovado, 'R' rejeitado
  intercambio    boolean NOT NULL DEFAULT false,      -- projeto 9999999999
  lote           text,
  origem         text NOT NULL DEFAULT 'EXTRATO',
  dims           jsonb NOT NULL DEFAULT '{}',
  importado_em   timestamptz DEFAULT now()
);

-- se a tabela já existia da primeira versão desta migration
ALTER TABLE fat_apontamento ADD COLUMN IF NOT EXISTS filial_apont_id uuid REFERENCES filial;

CREATE INDEX IF NOT EXISTS ix_apont_periodo ON fat_apontamento (tenant_id, ano, mes);
CREATE INDEX IF NOT EXISTS ix_apont_folha   ON fat_apontamento (tenant_id, comp_folha_ano, comp_folha_mes);
CREATE INDEX IF NOT EXISTS ix_apont_posto   ON fat_apontamento (tenant_id, posto_id);
-- a conciliação agrupa exatamente por isto
CREATE INDEX IF NOT EXISTS ix_apont_chave
  ON fat_apontamento (tenant_id, comp_folha_ano, comp_folha_mes, filial_id, matricula, cc_projeto_id);

ALTER TABLE fat_apontamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fat_apontamento_rls" ON fat_apontamento;
CREATE POLICY "fat_apontamento_rls" ON fat_apontamento FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ── A pill só existe onde o mecanismo existe ──
-- Apontar horas em projeto e gerar verba por CC é específico desta instalação.
-- Em outro tenant a aba não deve nem aparecer — daí um flag por tenant, no
-- mesmo lugar onde já vive a tolerância da conciliação. Quem, dentro do tenant,
-- pode ver é outra pergunta, e ela é respondida por CAPACIDADES no frontend.
ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS usa_apontamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant.usa_apontamento IS
  'Liga a conciliação Apontamento × Folha. Desligado por padrão: o mecanismo de apontar horas em projeto é específico de quem opera por projeto.';
