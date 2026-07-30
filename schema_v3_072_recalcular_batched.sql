-- ============================================================
-- Multimoeda — recalcular_moedas() em LOTES (cursor por id).
--
-- Motivo: a versão v3_071 rodava a tabela inteira num único request e estourava
-- o timeout do gateway (~60s) em bases grandes (ex.: fat_realizado / razão).
-- Agora cada chamada processa até p_limit linhas de UMA tabela (p_scope) a partir
-- de um cursor (p_after = maior id já processado) e devolve (processed, last_id).
-- O front chama em loop, por tabela, até processed < p_limit — muitos requests
-- CURTOS em vez de um longo. Set-based, index-backed (ix_cambio_slot_data + unique
-- de versao_taxa). Só toca moeda_origem = 1. IDEMPOTENTE.
--
-- Escopos: 'orcado' | 'realizado' | 'folha' | 'saldo'.
-- Depois do loop completo, re-rodar SELECT refresh_realizado_mensal();
-- ============================================================

-- descarta a versão monolítica (v3_071) p/ não ser chamada por engano
DROP FUNCTION IF EXISTS recalcular_moedas();

CREATE OR REPLACE FUNCTION recalcular_moedas(p_scope text, p_limit int DEFAULT 5000, p_after uuid DEFAULT NULL)
RETURNS TABLE(processed int, last_id uuid)
LANGUAGE plpgsql VOLATILE
SET statement_timeout = '120s'
AS $$
DECLARE
  t uuid := current_tenant_id();
BEGIN
  IF p_scope = 'orcado' THEN
    -- fat_orcado: taxa ORÇADA da versão (mês-específica > constante)
    RETURN QUERY
    WITH b AS (
      SELECT id FROM fat_orcado
      WHERE tenant_id=t AND moeda_origem=1 AND valor IS NOT NULL AND (p_after IS NULL OR id > p_after)
      ORDER BY id LIMIT p_limit
    ), upd AS (
      UPDATE fat_orcado fo SET
        val_m2 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=2 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
        val_m3 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=3 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
        val_m4 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=4 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
        val_m5 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=5 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0)
      FROM b WHERE fo.id = b.id
      RETURNING fo.id
    )
    SELECT count(*)::int, (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1) FROM upd;

  ELSIF p_scope = 'realizado' THEN
    -- fat_realizado: câmbio na data do lançamento (fallback fim do mês), carry-forward
    RETURN QUERY
    WITH b AS (
      SELECT id FROM fat_realizado
      WHERE tenant_id=t AND moeda_origem=1 AND (p_after IS NULL OR id > p_after)
      ORDER BY id LIMIT p_limit
    ), upd AS (
      UPDATE fat_realizado fr SET
        val_m2 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=2 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0),
        val_m3 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=3 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0),
        val_m4 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=4 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0),
        val_m5 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=5 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0)
      FROM b WHERE fr.id = b.id
      RETURNING fr.id
    )
    SELECT count(*)::int, (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1) FROM upd;

  ELSIF p_scope = 'folha' THEN
    -- fat_folha: REALIZADO → câmbio (fim do mês); ORCADO → taxa orçada da versão
    RETURN QUERY
    WITH b AS (
      SELECT id FROM fat_folha
      WHERE tenant_id=t AND moeda_origem=1 AND (p_after IS NULL OR id > p_after)
      ORDER BY id LIMIT p_limit
    ), upd AS (
      UPDATE fat_folha ff SET
        val_m2 = ff.valor / NULLIF(CASE WHEN ff.tipo='REALIZADO'
          THEN (SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=2 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1)
          ELSE (SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=2 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1) END,0),
        val_m3 = ff.valor / NULLIF(CASE WHEN ff.tipo='REALIZADO'
          THEN (SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=3 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1)
          ELSE (SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=3 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1) END,0),
        val_m4 = ff.valor / NULLIF(CASE WHEN ff.tipo='REALIZADO'
          THEN (SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=4 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1)
          ELSE (SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=4 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1) END,0),
        val_m5 = ff.valor / NULLIF(CASE WHEN ff.tipo='REALIZADO'
          THEN (SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=5 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1)
          ELSE (SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=5 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1) END,0)
      FROM b WHERE ff.id = b.id
      RETURNING ff.id
    )
    SELECT count(*)::int, (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1) FROM upd;

  ELSIF p_scope = 'saldo' THEN
    -- fat_saldo (base = saldo; câmbio fim do mês)
    RETURN QUERY
    WITH b AS (
      SELECT id FROM fat_saldo
      WHERE tenant_id=t AND moeda_origem=1 AND (p_after IS NULL OR id > p_after)
      ORDER BY id LIMIT p_limit
    ), upd AS (
      UPDATE fat_saldo fs SET
        val_m2 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=2 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
        val_m3 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=3 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
        val_m4 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=4 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
        val_m5 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=5 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0)
      FROM b WHERE fs.id = b.id
      RETURNING fs.id
    )
    SELECT count(*)::int, (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1) FROM upd;

  ELSE
    RAISE EXCEPTION 'escopo inválido: % (use orcado|realizado|folha|saldo)', p_scope;
  END IF;
END;
$$;
