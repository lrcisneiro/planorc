-- ============================================================
-- v3_175 — Cenário NÃO semeado não infere exclusão
--
-- ⚠⚠ CAMINHO DE PERDA DE DADO, achado ao ver a tela de criar cenário.
--
-- O merge trata "célula na baseline sem par no cenário" como **proposta de
-- apagar** — e isso é certo, porque o drill apaga a linha de fato quando se
-- limpa a célula (`.delete()`, não `valor = null`). Mas a inferência só vale
-- se o cenário TEVE a célula algum dia.
--
-- Desmarcar *Copiar o orçado da baseline* cria o cenário **vazio**. Então toda
-- célula manual de linha aprovada ficaria sem par, e o merge as apagaria —
-- a baseline inteira daquela linha, por um checkbox.
--
-- Conserto: `semeado_em` registra que a cópia aconteceu, e a exclusão só é
-- inferida quando ela existe. Cenário vazio passa a ser **só aditivo**: o que
-- se escreve nele entra, e o que não está nele não quer dizer nada.
--
-- ⚠ A mesma razão responde "por que o semear não respeita o filtro da tela":
-- copiar só o recorte de quem cria faria TODA célula fora dele parecer
-- proposta de exclusão. O cenário é a versão inteira; quem vê e quem edita o
-- quê é o escopo de acesso, que já vale no RLS por versão desde a v3_137.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE versao_orcamento ADD COLUMN IF NOT EXISTS semeado_em timestamptz;

COMMENT ON COLUMN versao_orcamento.semeado_em IS
  'Quando o cenário foi copiado da baseline (v3_175). NULL = nasceu vazio: o merge '
  'não infere exclusão, porque ausência de célula não é proposta de apagar.';

-- Cenários criados antes desta migration foram todos semeados (a tela só
-- oferecia a opção a partir daqui), então herdam o `criado_em`.
UPDATE versao_orcamento
   SET semeado_em = criado_em
 WHERE origem_versao_id IS NOT NULL AND semeado_em IS NULL
   AND EXISTS (SELECT 1 FROM fat_orcado o WHERE o.versao_id = versao_orcamento.id);

-- ------------------------------------------------------------
-- copiar_versao carimba o semear
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION copiar_versao(
  p_origem    uuid,
  p_codigo    text,
  p_descricao text,
  p_semear    boolean DEFAULT true
) RETURNS TABLE(versao_id uuid, celulas bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- ------------------------------------------------------------
-- O merge só infere exclusão em cenário semeado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mesclar_cenario_orcado(
  p_versao uuid, p_simular boolean DEFAULT true
) RETURNS TABLE(acao text, celulas bigint, valor numeric, detalhe text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := current_tenant_id();
  v record;
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para liberar cenário.' USING ERRCODE = '42501';
  END IF;

  SELECT id, origem_versao_id, ano, aprovado_em, criado_em, mesclado_em, semeado_em, codigo
    INTO v FROM versao_orcamento WHERE id = p_versao AND tenant_id = t;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Cenário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.origem_versao_id IS NULL THEN
    RAISE EXCEPTION 'A versão % é uma baseline, não um cenário.', v.codigo USING ERRCODE = '22023';
  END IF;
  IF v.aprovado_em IS NULL THEN
    RAISE EXCEPTION 'O cenário % ainda não foi fechado. Feche a aprovação antes de liberar.', v.codigo
      USING ERRCODE = '22023';
  END IF;
  IF v.mesclado_em IS NOT NULL AND NOT p_simular THEN
    RAISE EXCEPTION 'O cenário % já foi liberado em %.', v.codigo, v.mesclado_em USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM versao_orcamento b WHERE b.id = v.origem_versao_id AND b.bloqueada) THEN
    RAISE EXCEPTION 'A baseline está bloqueada.' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _merge;
  CREATE TEMP TABLE _merge ON COMMIT DROP AS
  WITH aprovadas AS (
    SELECT ov.linha_id FROM orcado_veredito ov
     WHERE ov.versao_id = p_versao AND ov.tenant_id = t AND ov.aprovado IS TRUE
  ),
  c AS (
    SELECT o.id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
           o.dims::text AS dimst, o.valor, o.atualizado_em
      FROM fat_orcado o JOIN aprovadas a ON a.linha_id = o.linha_id
     WHERE o.versao_id = p_versao AND o.tenant_id = t AND o.ano = v.ano
       AND o.origem = 'MANUAL'
  ),
  b AS (
    SELECT o.id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
           o.dims::text AS dimst, o.valor, o.atualizado_em, o.origem
      FROM fat_orcado o JOIN aprovadas a ON a.linha_id = o.linha_id
     WHERE o.versao_id = v.origem_versao_id AND o.tenant_id = t AND o.ano = v.ano
  )
  SELECT
    c.id AS cen_id, b.id AS base_id,
    coalesce(c.linha_id, b.linha_id) AS linha_id,
    coalesce(c.valor, 0) - coalesce(b.valor, 0) AS delta,
    CASE
      WHEN c.id IS NOT NULL AND c.atualizado_em > v.criado_em THEN
        CASE
          WHEN b.id IS NOT NULL AND b.origem <> 'MANUAL'          THEN 'sobre_gerada'
          WHEN b.id IS NOT NULL AND b.atualizado_em > v.criado_em THEN 'conflito'
          ELSE 'gravar'
        END
      -- ⚠ Ausência só é proposta de apagar em cenário SEMEADO. No cenário que
      -- nasceu vazio, ausência é ausência — e apagar por isso levaria a
      -- baseline inteira da linha aprovada.
      WHEN v.semeado_em IS NOT NULL
           AND c.id IS NULL AND b.id IS NOT NULL AND b.origem = 'MANUAL' THEN
        CASE WHEN b.atualizado_em > v.criado_em THEN 'nao_apagada' ELSE 'apagar' END
      ELSE 'ignorar'
    END AS acao
  FROM c FULL JOIN b
    ON  b.linha_id   = c.linha_id
    AND b.empresa_id = c.empresa_id
    AND coalesce(b.filial_id, z) = coalesce(c.filial_id, z)
    AND coalesce(b.cc_id, z)     = coalesce(c.cc_id, z)
    AND b.ano = c.ano AND b.mes = c.mes AND b.dimst = c.dimst;

  IF NOT p_simular THEN
    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, dims, moeda_origem, val_m2, val_m3, val_m4, val_m5)
    SELECT o.tenant_id, v.origem_versao_id, o.linha_id, o.empresa_id, o.filial_id, o.cc_id,
           o.ano, o.mes, o.valor, o.expressao, 'MANUAL', o.dims, o.moeda_origem,
           o.val_m2, o.val_m3, o.val_m4, o.val_m5
      FROM _merge m JOIN fat_orcado o ON o.id = m.cen_id
     WHERE m.acao IN ('gravar', 'conflito', 'sobre_gerada')
    ON CONFLICT (versao_id, linha_id, empresa_id,
                 COALESCE(filial_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(cc_id,     '00000000-0000-0000-0000-000000000000'::uuid),
                 ano, mes, ((dims)::text))
    DO UPDATE SET valor = EXCLUDED.valor, expressao = EXCLUDED.expressao,
                  origem = 'MANUAL', moeda_origem = EXCLUDED.moeda_origem,
                  val_m2 = EXCLUDED.val_m2, val_m3 = EXCLUDED.val_m3,
                  val_m4 = EXCLUDED.val_m4, val_m5 = EXCLUDED.val_m5;

    DELETE FROM fat_orcado o
     WHERE o.id IN (SELECT base_id FROM _merge WHERE acao = 'apagar');

    UPDATE versao_orcamento SET mesclado_em = now(), mesclado_por = auth.uid()
     WHERE id = p_versao;
  END IF;

  RETURN QUERY
  SELECT m.acao, count(*)::bigint, round(sum(m.delta)::numeric, 2),
         CASE m.acao
           WHEN 'gravar'       THEN 'Gravadas na baseline'
           WHEN 'conflito'     THEN 'Gravadas — ⚠ a baseline havia mudado desde o semear; confira o que foi sobrescrito'
           WHEN 'sobre_gerada' THEN 'Gravadas — ⚠ por cima de valor gerado (posto/formulário): a próxima aplicação daquela origem sobrescreve'
           WHEN 'apagar'       THEN 'Apagadas da baseline (a proposta era zerar)'
           WHEN 'nao_apagada'  THEN 'NÃO apagadas — a baseline mudou depois do semear; é trabalho novo da controladoria'
           ELSE 'Sem alteração'
         END
    FROM _merge m
   WHERE m.acao <> 'ignorar'
   GROUP BY m.acao
   ORDER BY m.acao;
END $$;

SELECT 'v3_175 aplicada' AS resultado,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='versao_orcamento' AND column_name='semeado_em') AS col_semeado,
       (SELECT CASE WHEN prosrc LIKE '%semeado_em IS NOT NULL%' THEN 'sim' ELSE 'NÃO' END
          FROM pg_proc WHERE proname='mesclar_cenario_orcado') AS exclusao_travada,
       (SELECT count(*) FROM versao_orcamento WHERE origem_versao_id IS NOT NULL) AS cenarios;
