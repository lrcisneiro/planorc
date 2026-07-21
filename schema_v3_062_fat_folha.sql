-- ============================================================
-- F5.2 · Conciliação de folha — fat_folha (realizado da FOLHA, paralelo ao razão)
--
-- Fato paralelo ao fat_realizado (que vem da contabilidade/razão): aqui o
-- realizado vem da FOLHA analítica (prgper02 "Conferência Contabilização Folha"),
-- por MATRÍCULA × VERBA × mês. A folha já traz a contabilização (débito/crédito),
-- então dá pra amarrar o realizado-folha à MESMA linha da DRE (via conta do débito
-- ∈ contas amarradas da linha) e ao POSTO (por filial+matrícula). Base da tela de
-- conciliação Orçado(motor) × Realizado(folha) por posto. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS fat_folha (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  ano            int NOT NULL,
  mes            int NOT NULL CHECK (mes BETWEEN 1 AND 12),
  empresa_id     uuid REFERENCES empresa,                       -- gerencial (de-para filial→empresa)
  filial_id      uuid REFERENCES filial,                        -- CNPJ real (EMPRESA+FILIAL da folha)
  cc_id          uuid REFERENCES centro_custo,
  matricula      text,
  nome           text,
  posto_id       uuid REFERENCES posto ON DELETE SET NULL,      -- casado por filial+matrícula
  verba_cod      text,                                          -- CD_VERBA da folha
  verba_desc     text,
  tipo_verba     text,                                          -- Provento / Desconto / Base / Informativa
  valor          numeric(18,2) NOT NULL DEFAULT 0,
  conta_deb_cod  text,                                          -- DEBITO (conta contábil da contabilização)
  conta_cred_cod text,                                          -- CREDITO
  conta_id       uuid REFERENCES conta_contabil,                -- resolvida do débito (amarra à DRE)
  competencia    text,                                          -- '202605' cru (auditoria)
  lote           text,                                          -- controle de carga (arquivo/competência)
  origem         text NOT NULL DEFAULT 'FOLHA' CHECK (origem IN ('FOLHA')),
  dims           jsonb NOT NULL DEFAULT '{}',
  importado_em   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fat_folha_periodo   ON fat_folha (tenant_id, ano, mes);
CREATE INDEX IF NOT EXISTS ix_fat_folha_posto     ON fat_folha (tenant_id, posto_id, ano, mes);
CREATE INDEX IF NOT EXISTS ix_fat_folha_conta     ON fat_folha (tenant_id, conta_id, ano, mes);
CREATE INDEX IF NOT EXISTS ix_fat_folha_escopo    ON fat_folha (tenant_id, empresa_id, filial_id, cc_id, ano, mes);

ALTER TABLE fat_folha ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fat_folha_rls" ON fat_folha;
CREATE POLICY "fat_folha_rls" ON fat_folha FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
