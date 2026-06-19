-- ============================================================
-- fat_saldo — saldo FINAL por conta contábil / empresa / FILIAL / ano / mês
-- (balancete mensal vindo do ERP). O Balanço lê o saldo do mês de
-- referência direto (estoque), sem acumular movimentos. A DRE segue
-- usando fat_realizado (fluxo). Filial é dimensão obrigatória no TOTVS.
--
-- IDEMPOTENTE: pode ser rodado mesmo se uma versão anterior (sem filial)
-- já tiver criado a tabela — adiciona a coluna e corrige a unique.
-- ============================================================
CREATE TABLE IF NOT EXISTS fat_saldo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  conta_id   uuid NOT NULL REFERENCES conta_contabil ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresa ON DELETE CASCADE,
  ano        int  NOT NULL,
  mes        int  NOT NULL,
  saldo      numeric NOT NULL DEFAULT 0,
  origem     text NOT NULL DEFAULT 'IMPORT'
);

-- coluna filial (caso a tabela já existisse sem ela)
ALTER TABLE fat_saldo ADD COLUMN IF NOT EXISTS filial_id uuid REFERENCES filial ON DELETE CASCADE;

-- troca a unique antiga (sem filial) pela nova (com filial, NULLS NOT DISTINCT — PG15+)
ALTER TABLE fat_saldo DROP CONSTRAINT IF EXISTS fat_saldo_tenant_id_conta_id_empresa_id_ano_mes_key;
ALTER TABLE fat_saldo DROP CONSTRAINT IF EXISTS uq_fat_saldo;
ALTER TABLE fat_saldo ADD CONSTRAINT uq_fat_saldo
  UNIQUE NULLS NOT DISTINCT (tenant_id, conta_id, empresa_id, filial_id, ano, mes);

CREATE INDEX IF NOT EXISTS idx_fat_saldo_lookup ON fat_saldo (tenant_id, ano, mes, empresa_id);

ALTER TABLE fat_saldo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fat_saldo_rls ON fat_saldo;
CREATE POLICY fat_saldo_rls ON fat_saldo
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Agrega o saldo por LINHA orçamentária (resolve a conta contábil via
-- conta_linha, 1 por conta, aplicando o sinal). Soma todas as filiais da(s)
-- empresa(s), com filtro opcional de filial. Retorna por linha e mês.
CREATE OR REPLACE FUNCTION relatorio_saldo_agg(
  p_empresas uuid[],
  p_ano      int,
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, mes int, saldo numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT cl.linha_id, fs.mes, sum(fs.saldo * cl.sinal)::numeric
  FROM fat_saldo fs
  JOIN LATERAL (
    SELECT c.linha_id, c.sinal FROM conta_linha c
    WHERE c.conta_id = fs.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
    ORDER BY c.id DESC LIMIT 1
  ) cl ON true
  WHERE fs.tenant_id = current_tenant_id() AND fs.empresa_id = ANY(p_empresas)
    AND fs.ano = p_ano AND fs.mes = ANY(p_meses)
    AND (p_filiais IS NULL OR fs.filial_id = ANY(p_filiais))
  GROUP BY cl.linha_id, fs.mes
$$;
