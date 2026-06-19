-- ============================================================
-- Pontos de restauração do RELATÓRIO (undo/restore).
-- Snapshot no servidor (to_jsonb por linha) cobrindo: layout
-- (relatorio_linha, view_config) + DE-PARA (conta_linha) + valores
-- orçados (fat_orcado) — estes dois escopados às contas (masters) do
-- relatório. À prova de mudança de colunas (jsonb_populate_record).
-- ============================================================
CREATE TABLE IF NOT EXISTS relatorio_snapshot (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  relatorio_id uuid NOT NULL REFERENCES relatorio ON DELETE CASCADE,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  descricao   text,
  auto        boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_rel_snapshot ON relatorio_snapshot (relatorio_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS snap_rows (
  id          bigserial PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES relatorio_snapshot ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  tabela      text NOT NULL,
  dados       jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_rows ON snap_rows (snapshot_id, tabela);

ALTER TABLE relatorio_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE snap_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rel_snapshot_rls ON relatorio_snapshot;
CREATE POLICY rel_snapshot_rls ON relatorio_snapshot USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS snap_rows_rls ON snap_rows;
CREATE POLICY snap_rows_rls ON snap_rows USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Cria um ponto de restauração e poda mantendo os últimos p_manter.
CREATE OR REPLACE FUNCTION criar_snapshot(p_relatorio uuid, p_descricao text DEFAULT NULL, p_auto boolean DEFAULT true, p_manter int DEFAULT 8)
RETURNS uuid
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $$
DECLARE v_snap uuid; v_t uuid := current_tenant_id();
BEGIN
  INSERT INTO relatorio_snapshot(tenant_id, relatorio_id, descricao, auto)
    VALUES (v_t, p_relatorio, p_descricao, p_auto) RETURNING id INTO v_snap;

  INSERT INTO snap_rows(snapshot_id, tenant_id, tabela, dados)
    SELECT v_snap, v_t, 'relatorio_linha', to_jsonb(rl) FROM relatorio_linha rl WHERE rl.relatorio_id = p_relatorio;
  INSERT INTO snap_rows(snapshot_id, tenant_id, tabela, dados)
    SELECT v_snap, v_t, 'view_config', to_jsonb(vc) FROM view_config vc WHERE vc.relatorio_id = p_relatorio;
  INSERT INTO snap_rows(snapshot_id, tenant_id, tabela, dados)
    SELECT v_snap, v_t, 'conta_linha', to_jsonb(cl) FROM conta_linha cl
    WHERE cl.linha_id IN (SELECT linha_orc_id FROM relatorio_linha WHERE relatorio_id = p_relatorio AND linha_orc_id IS NOT NULL);
  INSERT INTO snap_rows(snapshot_id, tenant_id, tabela, dados)
    SELECT v_snap, v_t, 'fat_orcado', to_jsonb(fo) FROM fat_orcado fo
    WHERE fo.linha_id IN (SELECT linha_orc_id FROM relatorio_linha WHERE relatorio_id = p_relatorio AND linha_orc_id IS NOT NULL);

  DELETE FROM relatorio_snapshot
   WHERE relatorio_id = p_relatorio AND tenant_id = v_t
     AND id NOT IN (SELECT id FROM relatorio_snapshot WHERE relatorio_id = p_relatorio AND tenant_id = v_t ORDER BY criado_em DESC LIMIT p_manter);
  RETURN v_snap;
END $$;

-- Restaura o relatório ao estado do snapshot (apaga o escopo atual e repõe).
CREATE OR REPLACE FUNCTION restaurar_snapshot(p_snapshot uuid)
RETURNS void
LANGUAGE plpgsql
SET statement_timeout = '180s'
AS $$
DECLARE v_rel uuid; v_t uuid := current_tenant_id(); v_masters uuid[];
BEGIN
  SELECT relatorio_id INTO v_rel FROM relatorio_snapshot WHERE id = p_snapshot AND tenant_id = v_t;
  IF v_rel IS NULL THEN RAISE EXCEPTION 'Snapshot não encontrado'; END IF;

  -- masters afetados = união dos atuais + os do snapshot
  SELECT array_agg(DISTINCT m) INTO v_masters FROM (
    SELECT linha_orc_id m FROM relatorio_linha WHERE relatorio_id = v_rel AND linha_orc_id IS NOT NULL
    UNION
    SELECT (dados->>'linha_orc_id')::uuid FROM snap_rows
      WHERE snapshot_id = p_snapshot AND tabela = 'relatorio_linha' AND COALESCE(dados->>'linha_orc_id','') <> ''
  ) t;

  -- apaga escopo atual
  IF v_masters IS NOT NULL THEN
    DELETE FROM conta_linha WHERE tenant_id = v_t AND linha_id = ANY(v_masters);
    DELETE FROM fat_orcado  WHERE tenant_id = v_t AND linha_id = ANY(v_masters);
  END IF;
  DELETE FROM view_config    WHERE relatorio_id = v_rel;
  DELETE FROM relatorio_linha WHERE relatorio_id = v_rel;

  -- repõe do snapshot (jsonb_populate_record casa por nome de coluna)
  INSERT INTO relatorio_linha SELECT (jsonb_populate_record(NULL::relatorio_linha, dados)).*
    FROM snap_rows WHERE snapshot_id = p_snapshot AND tabela = 'relatorio_linha';
  INSERT INTO view_config SELECT (jsonb_populate_record(NULL::view_config, dados)).*
    FROM snap_rows WHERE snapshot_id = p_snapshot AND tabela = 'view_config';
  INSERT INTO conta_linha SELECT (jsonb_populate_record(NULL::conta_linha, dados)).*
    FROM snap_rows WHERE snapshot_id = p_snapshot AND tabela = 'conta_linha';
  INSERT INTO fat_orcado SELECT (jsonb_populate_record(NULL::fat_orcado, dados)).*
    FROM snap_rows WHERE snapshot_id = p_snapshot AND tabela = 'fat_orcado';
END $$;
