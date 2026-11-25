-- ============================================================
-- v3_205 · A versão copiada passa a levar as PREMISSAS junto
--
-- Achado em 25/nov diagnosticando "24 linha(s) DESCARTADA(S) por falta de taxa
-- orçada" no Aplicar: `2027_PRELIMINAR` e `ORCADO_SEM_MS_CEN` nasceram por
-- `copiar_versao` a partir de `Orçado2027` e vieram **sem taxa orçada e sem
-- dissídio** — duas premissas que são da VERSÃO e que a origem tinha.
--
-- ⚠⚠ PREMISSA NÃO É DADO, e é por isso que a falta não aparece como falta.
-- Um cenário sem elas não fica "sem número": fica com o número ERRADO no
-- primeiro Aplicar, e dos dois lados em silêncio parcial —
--   • sem `versao_taxa`: a célula de moeda estrangeira é DESCARTADA (avisa
--     depois de gravar; medido: 12 células, R$ 152.071,92, do posto do
--     Paraguai rateado para a empresa 28);
--   • sem `premissa_dissidio`: o CLT sai SEM o reajuste — `Orçado2027` tem
--     3 sindicatos a 5,5% e o cenário tinha ZERO. Esse **não avisa nada**, e é
--     o mais caro dos dois, porque alcança o quadro inteiro.
--
-- As três RPCs de cópia discordavam entre si:
--   copiar_versao_cenario  ✅ copia taxa e dissídio  (é a que estava certa)
--   copiar_versao          ⛔ não copiava            ← cria o cenário
--   copiar_versao_orcado   ⛔ não copiava
--
-- ⚠ As duas são tratadas de forma DIFERENTE, de propósito:
--   • `copiar_versao` CRIA a versão — não há nada para sobrescrever, então
--     copia sempre, inclusive com `p_semear = false`. Cenário vazio é "só
--     aditivo" no orçado (v3_175), mas as premissas dele não são aditivas:
--     ou estão lá, ou o primeiro Aplicar já sai errado.
--   • `copiar_versao_orcado` escreve num destino que JÁ EXISTE e pode ter
--     premissa PRÓPRIA de propósito — um cenário com outro dólar é um cenário
--     legítimo. Lá a regra é **preencher a lacuna, nunca sobrescrever**.
--
-- Termina em SELECT. Re-executável.
-- ============================================================

-- ── 1 · copiar_versao: leva as premissas na criação ─────────────────────────
CREATE OR REPLACE FUNCTION public.copiar_versao(p_origem uuid, p_codigo text, p_descricao text, p_semear boolean DEFAULT true)
 RETURNS TABLE(versao_id uuid, celulas bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_ano    int;
  v_nova   uuid;
  v_n      bigint := 0;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só a controladoria (admin) pode criar cenário de orçamento.'
      USING ERRCODE = '42501';
  END IF;

  SELECT ano INTO v_ano FROM versao_orcamento
   WHERE id = p_origem AND tenant_id = v_tenant;
  IF v_ano IS NULL THEN
    RAISE EXCEPTION 'Versão de origem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF btrim(coalesce(p_codigo,'')) = '' THEN
    RAISE EXCEPTION 'O cenário precisa de um código.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM versao_orcamento
              WHERE tenant_id = v_tenant AND upper(codigo) = upper(btrim(p_codigo))) THEN
    RAISE EXCEPTION 'Já existe uma versão com o código %.', btrim(p_codigo)
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO versao_orcamento
    (tenant_id, codigo, descricao, ano, ativa, bloqueada, origem_versao_id, semeado_em)
  VALUES
    (v_tenant, btrim(p_codigo),
     coalesce(nullif(btrim(coalesce(p_descricao,'')),''), btrim(p_codigo)),
     v_ano, true, false, p_origem,
     CASE WHEN p_semear THEN now() ELSE NULL END)
  RETURNING id INTO v_nova;

  -- ⚠⚠ FORA do `IF p_semear`: premissa vai SEMPRE. Ver o cabeçalho.
  INSERT INTO versao_taxa (tenant_id, versao_id, moeda_slot, ano, mes, taxa)
  SELECT tenant_id, v_nova, moeda_slot, ano, mes, taxa
    FROM versao_taxa WHERE versao_id = p_origem AND tenant_id = v_tenant;

  INSERT INTO premissa_dissidio (tenant_id, versao_id, sindicato_id, pct)
  SELECT tenant_id, v_nova, sindicato_id, pct
    FROM premissa_dissidio WHERE versao_id = p_origem AND tenant_id = v_tenant;

  IF p_semear THEN
    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, origem_formulario_linha_id, dims, moeda_origem,
       val_m2, val_m3, val_m4, val_m5)
    SELECT
       o.tenant_id, v_nova, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
       o.valor, o.expressao, o.origem, o.origem_formulario_linha_id, o.dims, o.moeda_origem,
       o.val_m2, o.val_m3, o.val_m4, o.val_m5
      FROM fat_orcado o
     WHERE o.tenant_id = v_tenant AND o.versao_id = p_origem;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_nova, v_n;
END $function$;

-- ── 2 · copiar_versao_orcado: preenche a lacuna, nunca sobrescreve ──────────
CREATE OR REPLACE FUNCTION public.copiar_versao_orcado(p_origem uuid, p_destino uuid, p_substituir boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SET statement_timeout TO '180s'
AS $function$
DECLARE n int;
BEGIN
  IF p_origem = p_destino THEN
    RAISE EXCEPTION 'Origem e destino são iguais.';
  END IF;
  IF p_substituir THEN
    DELETE FROM fat_orcado
      WHERE versao_id = p_destino AND tenant_id = (SELECT current_tenant_id());
  END IF;
  INSERT INTO fat_orcado
    (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
     valor, expressao, origem, origem_formulario_linha_id, dims,
     moeda_origem, val_m2, val_m3, val_m4, val_m5)
  SELECT tenant_id, p_destino, linha_id, empresa_id, filial_id, cc_id, ano, mes,
         valor, expressao, origem, origem_formulario_linha_id, dims,
         moeda_origem, val_m2, val_m3, val_m4, val_m5
  FROM fat_orcado
  WHERE versao_id = p_origem AND tenant_id = (SELECT current_tenant_id());
  GET DIAGNOSTICS n = ROW_COUNT;

  -- ⚠ LACUNA, NÃO SOBRESCRITA. O destino já existe e pode ter premissa própria
  -- de propósito. A granularidade é o SLOT (e o SINDICATO): se o destino já tem
  -- qualquer opinião sobre o dólar, ela fica inteira — copiar "o que falta de
  -- mês" misturaria duas premissas numa só.
  INSERT INTO versao_taxa (tenant_id, versao_id, moeda_slot, ano, mes, taxa)
  SELECT o.tenant_id, p_destino, o.moeda_slot, o.ano, o.mes, o.taxa
    FROM versao_taxa o
   WHERE o.versao_id = p_origem AND o.tenant_id = (SELECT current_tenant_id())
     AND NOT EXISTS (SELECT 1 FROM versao_taxa d
                      WHERE d.versao_id = p_destino AND d.tenant_id = o.tenant_id
                        AND d.moeda_slot = o.moeda_slot);

  INSERT INTO premissa_dissidio (tenant_id, versao_id, sindicato_id, pct)
  SELECT o.tenant_id, p_destino, o.sindicato_id, o.pct
    FROM premissa_dissidio o
   WHERE o.versao_id = p_origem AND o.tenant_id = (SELECT current_tenant_id())
     AND NOT EXISTS (SELECT 1 FROM premissa_dissidio d
                      WHERE d.versao_id = p_destino AND d.tenant_id = o.tenant_id
                        AND d.sindicato_id = o.sindicato_id);

  RETURN n;   -- segue sendo a contagem do orçado: é o que a tela mostra
END $function$;

-- ── 3 · O QUE JÁ ESTÁ GRAVADO: cenário existente que nasceu sem premissa ────
-- ⚠⚠ SEM `current_tenant_id()` AQUI. No SQL Editor ele é NULO e o backfill
-- voltaria vazio "com sucesso" — a armadilha já registrada no CLAUDE.md. O
-- recorte sai do próprio par origem→destino, que já carrega o tenant.
INSERT INTO versao_taxa (tenant_id, versao_id, moeda_slot, ano, mes, taxa)
SELECT o.tenant_id, v.id, o.moeda_slot, o.ano, o.mes, o.taxa
  FROM versao_orcamento v
  JOIN versao_taxa o ON o.versao_id = v.origem_versao_id AND o.tenant_id = v.tenant_id
 WHERE v.origem_versao_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM versao_taxa d
                    WHERE d.versao_id = v.id AND d.moeda_slot = o.moeda_slot);

INSERT INTO premissa_dissidio (tenant_id, versao_id, sindicato_id, pct)
SELECT o.tenant_id, v.id, o.sindicato_id, o.pct
  FROM versao_orcamento v
  JOIN premissa_dissidio o ON o.versao_id = v.origem_versao_id AND o.tenant_id = v.tenant_id
 WHERE v.origem_versao_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM premissa_dissidio d
                    WHERE d.versao_id = v.id AND d.sindicato_id = o.sindicato_id);

-- ---------------- conferência ----------------
SELECT '1 · premissas por versão' AS secao,
       vo.codigo AS chave,
       (SELECT count(*)::text FROM versao_taxa t WHERE t.versao_id = vo.id)||' taxa(s)'
       ||' · '||(SELECT count(*)::text FROM premissa_dissidio d WHERE d.versao_id = vo.id)||' dissídio(s)' AS info,
       CASE WHEN vo.origem_versao_id IS NULL THEN 'criada em branco'
            ELSE 'cópia de '||(SELECT x.codigo FROM versao_orcamento x WHERE x.id = vo.origem_versao_id) END AS det
  FROM versao_orcamento vo
UNION ALL
SELECT '2 · ainda falta premissa em alguma cópia?', '',
       CASE WHEN EXISTS (
         SELECT 1 FROM versao_orcamento v
          WHERE v.origem_versao_id IS NOT NULL
            AND ((EXISTS (SELECT 1 FROM versao_taxa o WHERE o.versao_id = v.origem_versao_id)
                  AND NOT EXISTS (SELECT 1 FROM versao_taxa d WHERE d.versao_id = v.id))
              OR (EXISTS (SELECT 1 FROM premissa_dissidio o WHERE o.versao_id = v.origem_versao_id)
                  AND NOT EXISTS (SELECT 1 FROM premissa_dissidio d WHERE d.versao_id = v.id))))
         THEN '⛔ SIM — confira a seção 1' ELSE '✅ não — toda cópia tem o que a origem tinha' END, ''
UNION ALL
SELECT '3 · as 3 RPCs copiam premissa?', p.proname,
       CASE WHEN pg_get_functiondef(p.oid) ILIKE '%versao_taxa%' THEN 'taxa ✅' ELSE 'taxa ⛔' END
       ||' · '||CASE WHEN pg_get_functiondef(p.oid) ILIKE '%premissa_dissidio%' THEN 'dissídio ✅' ELSE 'dissídio ⛔' END, ''
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.proname IN ('copiar_versao','copiar_versao_orcado','copiar_versao_cenario')
 ORDER BY 1, 2;
