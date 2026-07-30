-- ============================================================
-- Multimoeda — recalcular_moedas(): preenche val_m2..m5 dos fatos já gravados
-- em moeda BASE (moeda_origem = 1), a partir do valor/saldo + taxas.
--   realizado (fat_realizado / fat_folha REALIZADO / fat_saldo): taxa REAL (câmbio)
--     — por data (realizado tem data) ou fim do mês (folha/saldo), carry-forward.
--   orçado (fat_orcado / fat_folha ORCADO): taxa ORÇADA da versão (mês > constante).
-- val_m<s> = valor / taxa(s). Sem cotação do slot → null (aparece 0 até cadastrar).
--
-- Só toca moeda_origem = 1 (o import de moeda estrangeira já materializou os slots).
-- Rode após v3_068/069/070 e sempre que corrigir/incluir cotações. IDEMPOTENTE.
-- Depois, re-rodar SELECT refresh_realizado_mensal(); para o rollup pegar os slots.
-- ============================================================
CREATE OR REPLACE FUNCTION recalcular_moedas()
RETURNS text
LANGUAGE plpgsql VOLATILE
SET statement_timeout = '600s'
AS $$
DECLARE
  t uuid := current_tenant_id();
  n_orc int; n_real int; n_folha int; n_saldo int;
BEGIN
  -- taxa REAL do câmbio na data (carry-forward): última cotação do slot com data ≤ alvo
  -- taxa ORÇADA: versao_taxa do slot (mês-específica tem precedência sobre a constante)

  -- fat_orcado (taxa orçada da versão)
  UPDATE fat_orcado fo SET
    val_m2 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=2 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
    val_m3 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=3 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
    val_m4 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=4 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
    val_m5 = fo.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=fo.versao_id AND vt.moeda_slot=5 AND ((vt.ano=fo.ano AND vt.mes=fo.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0)
  WHERE fo.tenant_id=t AND fo.moeda_origem=1 AND fo.valor IS NOT NULL;
  GET DIAGNOSTICS n_orc = ROW_COUNT;

  -- fat_realizado (câmbio na data do lançamento; fallback fim do mês)
  UPDATE fat_realizado fr SET
    val_m2 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=2 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0),
    val_m3 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=3 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0),
    val_m4 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=4 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0),
    val_m5 = fr.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=5 AND c.data <= COALESCE(fr.data,(make_date(fr.ano,fr.mes,1)+interval '1 month'-interval '1 day')::date) ORDER BY c.data DESC LIMIT 1),0)
  WHERE fr.tenant_id=t AND fr.moeda_origem=1;
  GET DIAGNOSTICS n_real = ROW_COUNT;

  -- fat_folha: REALIZADO → câmbio (fim do mês); ORCADO → taxa orçada da versão
  UPDATE fat_folha ff SET
    val_m2 = ff.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=2 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
    val_m3 = ff.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=3 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
    val_m4 = ff.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=4 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
    val_m5 = ff.valor / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=5 AND c.data <= (make_date(ff.ano,ff.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0)
  WHERE ff.tenant_id=t AND ff.moeda_origem=1 AND ff.tipo='REALIZADO';
  GET DIAGNOSTICS n_folha = ROW_COUNT;

  UPDATE fat_folha ff SET
    val_m2 = ff.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=2 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
    val_m3 = ff.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=3 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
    val_m4 = ff.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=4 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0),
    val_m5 = ff.valor / NULLIF((SELECT vt.taxa FROM versao_taxa vt WHERE vt.tenant_id=t AND vt.versao_id=ff.versao_id AND vt.moeda_slot=5 AND ((vt.ano=ff.ano AND vt.mes=ff.mes) OR (vt.ano IS NULL AND vt.mes IS NULL)) ORDER BY (vt.ano IS NULL) LIMIT 1),0)
  WHERE ff.tenant_id=t AND ff.moeda_origem=1 AND ff.tipo='ORCADO';

  -- fat_saldo (base = saldo; câmbio fim do mês)
  UPDATE fat_saldo fs SET
    val_m2 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=2 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
    val_m3 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=3 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
    val_m4 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=4 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0),
    val_m5 = fs.saldo / NULLIF((SELECT c.taxa FROM cambio c WHERE c.tenant_id=t AND c.moeda_slot=5 AND c.data <= (make_date(fs.ano,fs.mes,1)+interval '1 month'-interval '1 day')::date ORDER BY c.data DESC LIMIT 1),0)
  WHERE fs.tenant_id=t AND fs.moeda_origem=1;
  GET DIAGNOSTICS n_saldo = ROW_COUNT;

  RETURN format('recalculado: orcado=%s, realizado=%s, folha=%s, saldo=%s', n_orc, n_real, n_folha, n_saldo);
END;
$$;
