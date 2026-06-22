-- ============================================================
-- 037 — Atributos derivados do Centro de Custo (Área / Divisão / BU)
--
-- O CC é hierárquico e a POSIÇÃO do código revela dimensões:
--   pos1 = Área  (1=CSC, 2=Comercial, 3=Serviços, 4=Diretoria, 5=Marketing)
--   pos2 = Divisão (só áreas 2/3/5: 1=Base, 2=Novos)
--   pos3 = BU      (só áreas 2/3/5: 1=PC-Sistemas, 2=HXM, 3=LE Oeste,
--                   4=Gestão, 5=RD, 6=Moda, 7=Sustentação, 8=Smart ERP)
--
-- São ATRIBUTOS da dimensão CC (não vão para os fatos). Preenchidos pela
-- posição do código e EDITÁVEIS (exceções). Função decodificar_cc()
-- repreenche sob demanda (botão no cadastro).
--
-- IDEMPOTENTE.
-- ============================================================
ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS area_cod     text;
ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS area_nome    text;
ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS divisao_cod  text;
ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS divisao_nome text;
ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS bu_cod       text;
ALTER TABLE centro_custo ADD COLUMN IF NOT EXISTS bu_nome      text;

-- decodifica do código (sobrescreve) — usado na carga inicial e no botão "Recalcular"
CREATE OR REPLACE FUNCTION decodificar_cc()
RETURNS void
LANGUAGE sql VOLATILE
AS $$
  UPDATE centro_custo SET
    area_cod  = left(codigo, 1),
    area_nome = CASE left(codigo,1) WHEN '1' THEN 'CSC' WHEN '2' THEN 'Comercial' WHEN '3' THEN 'Serviços' WHEN '4' THEN 'Diretoria' WHEN '5' THEN 'Marketing' END,
    divisao_cod  = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 2 THEN substr(codigo,2,1) END,
    divisao_nome = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 2 THEN (CASE substr(codigo,2,1) WHEN '1' THEN 'Base' WHEN '2' THEN 'Novos' END) END,
    bu_cod  = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 3 THEN substr(codigo,3,1) END,
    bu_nome = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 3 THEN (CASE substr(codigo,3,1)
                WHEN '1' THEN 'PC-Sistemas' WHEN '2' THEN 'HXM' WHEN '3' THEN 'LE Oeste' WHEN '4' THEN 'Gestão'
                WHEN '5' THEN 'RD' WHEN '6' THEN 'Moda' WHEN '7' THEN 'Sustentação' WHEN '8' THEN 'Smart ERP' END) END
  WHERE tenant_id = current_tenant_id();
$$;

-- carga inicial p/ TODOS os tenants (roda como owner)
UPDATE centro_custo SET
  area_cod  = left(codigo, 1),
  area_nome = CASE left(codigo,1) WHEN '1' THEN 'CSC' WHEN '2' THEN 'Comercial' WHEN '3' THEN 'Serviços' WHEN '4' THEN 'Diretoria' WHEN '5' THEN 'Marketing' END,
  divisao_cod  = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 2 THEN substr(codigo,2,1) END,
  divisao_nome = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 2 THEN (CASE substr(codigo,2,1) WHEN '1' THEN 'Base' WHEN '2' THEN 'Novos' END) END,
  bu_cod  = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 3 THEN substr(codigo,3,1) END,
  bu_nome = CASE WHEN left(codigo,1) IN ('2','3','5') AND length(codigo) >= 3 THEN (CASE substr(codigo,3,1)
              WHEN '1' THEN 'PC-Sistemas' WHEN '2' THEN 'HXM' WHEN '3' THEN 'LE Oeste' WHEN '4' THEN 'Gestão'
              WHEN '5' THEN 'RD' WHEN '6' THEN 'Moda' WHEN '7' THEN 'Sustentação' WHEN '8' THEN 'Smart ERP' END) END;
