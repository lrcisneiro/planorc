-- ============================================================
-- 043 — Re-vincular CCs órfãos no REALIZADO e no ORÇADO.
--
-- Lançamentos importados quando o CC ainda NÃO estava cadastrado ficaram
-- com cc_id NULL, e o código original do CC foi guardado em dims->>'cc_orig'.
-- Cadastrar o CC depois não atualiza esses lançamentos. Esta função preenche
-- o cc_id casando dims.cc_orig com centro_custo.codigo (normalizado), tanto em
-- fat_realizado quanto em fat_orcado.
--
-- Realizado: use ANTES do refresh_realizado_mensal (o "Recalcular" chama as duas).
-- Orçado: é lido direto de fat_orcado, então o re-vínculo já reflete no relatório.
-- Retorna o total de lançamentos re-vinculados (real + orçado).
-- IDEMPOTENTE.
-- ============================================================
CREATE OR REPLACE FUNCTION revincular_cc_orfaos()
RETURNS int
LANGUAGE plpgsql VOLATILE
SET statement_timeout = '180s'
AS $$
DECLARE n_real int; n_orc int;
BEGIN
  WITH upd AS (
    UPDATE fat_realizado fr SET cc_id = cc.id
      FROM centro_custo cc
     WHERE fr.tenant_id = current_tenant_id() AND fr.cc_id IS NULL AND fr.dims ? 'cc_orig'
       AND cc.tenant_id = fr.tenant_id
       AND upper(replace(cc.codigo, ' ', '')) = upper(replace(fr.dims->>'cc_orig', ' ', ''))
    RETURNING fr.id
  ) SELECT count(*) INTO n_real FROM upd;

  WITH upd AS (
    UPDATE fat_orcado fo SET cc_id = cc.id
      FROM centro_custo cc
     WHERE fo.tenant_id = current_tenant_id() AND fo.cc_id IS NULL AND fo.dims ? 'cc_orig'
       AND cc.tenant_id = fo.tenant_id
       AND upper(replace(cc.codigo, ' ', '')) = upper(replace(fo.dims->>'cc_orig', ' ', ''))
    RETURNING fo.id
  ) SELECT count(*) INTO n_orc FROM upd;

  RETURN n_real + n_orc;
END;
$$;
