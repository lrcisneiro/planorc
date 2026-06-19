-- ============================================================
-- PLANORC 2.0 — Tenant padrão + RLS
-- Rodar após schema_v2.sql
-- ============================================================

-- Tenant padrão (UUID fixo para single-tenant)
INSERT INTO tenant (id, nome, slug)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Minha Empresa',
  'default'
) ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- FUNÇÃO HELPER — retorna o tenant_id atual
-- Durante desenvolvimento retorna o tenant fixo.
-- No futuro: ler do JWT (auth.jwt() ->> 'tenant_id')
-- ============================================================
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'tenant_id')::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  )
$$;


-- ============================================================
-- RLS — uma policy por tabela
-- USING: leitura | WITH CHECK: escrita
-- ============================================================

-- tenant
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_rls" ON tenant FOR ALL
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- empresa
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa_rls" ON empresa FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- filial
ALTER TABLE filial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "filial_rls" ON filial FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- centro_custo
ALTER TABLE centro_custo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc_rls" ON centro_custo FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- conta_contabil
ALTER TABLE conta_contabil ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conta_contabil_rls" ON conta_contabil FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- funcionario
ALTER TABLE funcionario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funcionario_rls" ON funcionario FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- verba_folha
ALTER TABLE verba_folha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verba_folha_rls" ON verba_folha FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- projeto
ALTER TABLE projeto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projeto_rls" ON projeto FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- dimensao_config
ALTER TABLE dimensao_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dimensao_config_rls" ON dimensao_config FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- indice_economico
ALTER TABLE indice_economico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "indice_economico_rls" ON indice_economico FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- indice_valor (sem tenant_id direto — herda via indice_economico)
ALTER TABLE indice_valor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "indice_valor_rls" ON indice_valor FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM indice_economico ie
      WHERE ie.id = indice_valor.indice_id
        AND ie.tenant_id = current_tenant_id()
    )
  );

-- versao_orcamento
ALTER TABLE versao_orcamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "versao_orcamento_rls" ON versao_orcamento FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- template
ALTER TABLE template ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_rls" ON template FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- linha_template (sem tenant_id direto — herda via template)
ALTER TABLE linha_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY "linha_template_rls" ON linha_template FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM template t
      WHERE t.id = linha_template.template_id
        AND t.tenant_id = current_tenant_id()
    )
  );

-- conta_linha
ALTER TABLE conta_linha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conta_linha_rls" ON conta_linha FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- view_config (sem tenant_id — herda via template)
ALTER TABLE view_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view_config_rls" ON view_config FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM template t
      WHERE t.id = view_config.template_id
        AND t.tenant_id = current_tenant_id()
    )
  );

-- fat_orcado
ALTER TABLE fat_orcado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fat_orcado_rls" ON fat_orcado FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- fat_realizado
ALTER TABLE fat_realizado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fat_realizado_rls" ON fat_realizado FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
