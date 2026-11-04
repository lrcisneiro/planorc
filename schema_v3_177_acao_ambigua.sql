-- ============================================================
-- v3_177 — `column reference "acao" is ambiguous`
--
-- ⚠ As duas funções declaram `RETURNS TABLE(acao text, ...)`, e um parâmetro
-- de SAÍDA é uma variável PL/pgSQL em escopo no corpo inteiro. Onde eu escrevi
-- `WHERE acao = 'remover'` sem qualificar, o Postgres viu dois candidatos — a
-- coluna da tabela temporária e o parâmetro — e recusou.
--
-- ⚠⚠ **Só as referências da ESCRITA ficaram sem qualificar**, então a prévia
-- passava e a gravação falhava. Foi assim que apareceu: o modal mostrou
-- "2.253 atualizadas · 38 trazidas" e só então quebrou. Prévia que exercita
-- caminho diferente do da gravação dá uma garantia que não existe — aqui a
-- diferença era só a qualificação, mas o princípio vale.
--
-- Erro de compilação tardia: PL/pgSQL só resolve nomes ao EXECUTAR o comando,
-- então o `CREATE FUNCTION` aceitou as duas alegremente.
--
-- Nada foi aplicado pela metade: a função aborta e a transação volta inteira.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION ressincronizar_cenario(
  p_versao uuid, p_simular boolean DEFAULT true
) RETURNS TABLE(acao text, celulas bigint, detalhe text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := current_tenant_id();
  v record;
  z uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só a controladoria (admin) pode ressincronizar cenário.' USING ERRCODE = '42501';
  END IF;

  SELECT id, origem_versao_id, ano, criado_em, semeado_em, mesclado_em, codigo
    INTO v FROM versao_orcamento WHERE id = p_versao AND tenant_id = t;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Cenário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.origem_versao_id IS NULL THEN
    RAISE EXCEPTION 'A versão % é uma baseline.', v.codigo USING ERRCODE = '22023';
  END IF;
  IF v.semeado_em IS NULL THEN
    RAISE EXCEPTION 'O cenário % nasceu vazio — não há o que ressincronizar.', v.codigo USING ERRCODE = '22023';
  END IF;
  IF v.mesclado_em IS NOT NULL THEN
    RAISE EXCEPTION 'O cenário % já foi liberado.', v.codigo USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _sync;
  CREATE TEMP TABLE _sync ON COMMIT DROP AS
  WITH c AS (
    SELECT o.*, o.dims::text AS dimst FROM fat_orcado o
     WHERE o.versao_id = p_versao AND o.tenant_id = t AND o.ano = v.ano
  ), b AS (
    SELECT o.*, o.dims::text AS dimst FROM fat_orcado o
     WHERE o.versao_id = v.origem_versao_id AND o.tenant_id = t AND o.ano = v.ano
  )
  SELECT c.id AS cen_id, b.id AS base_id,
         coalesce(c.linha_id, b.linha_id) AS linha_id,
         CASE
           WHEN c.id IS NOT NULL AND c.atualizado_em > v.criado_em THEN 'preservada'
           WHEN c.id IS NOT NULL AND b.id IS NOT NULL
                AND (c.valor IS DISTINCT FROM b.valor
                  OR c.expressao IS DISTINCT FROM b.expressao
                  OR c.origem IS DISTINCT FROM b.origem
                  OR c.val_m2 IS DISTINCT FROM b.val_m2
                  OR c.val_m3 IS DISTINCT FROM b.val_m3
                  OR c.val_m4 IS DISTINCT FROM b.val_m4
                  OR c.val_m5 IS DISTINCT FROM b.val_m5) THEN 'atualizar'
           WHEN c.id IS NULL AND b.id IS NOT NULL THEN 'incluir'
           WHEN c.id IS NOT NULL AND b.id IS NULL THEN 'remover'
           ELSE 'igual'
         END AS acao
    FROM c FULL JOIN b
      ON  b.linha_id   = c.linha_id
      AND b.empresa_id = c.empresa_id
      AND coalesce(b.filial_id, z) = coalesce(c.filial_id, z)
      AND coalesce(b.cc_id, z)     = coalesce(c.cc_id, z)
      AND b.ano = c.ano AND b.mes = c.mes AND b.dimst = c.dimst;

  IF NOT p_simular THEN
    UPDATE fat_orcado o
       SET valor = bb.valor, expressao = bb.expressao, origem = bb.origem,
           moeda_origem = bb.moeda_origem, dims = bb.dims,
           origem_formulario_linha_id = bb.origem_formulario_linha_id,
           val_m2 = bb.val_m2, val_m3 = bb.val_m3, val_m4 = bb.val_m4, val_m5 = bb.val_m5,
           atualizado_em = v.criado_em
      FROM _sync s JOIN fat_orcado bb ON bb.id = s.base_id
     WHERE o.id = s.cen_id AND s.acao = 'atualizar';

    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, origem_formulario_linha_id, dims, moeda_origem,
       val_m2, val_m3, val_m4, val_m5, atualizado_em)
    SELECT bb.tenant_id, p_versao, bb.linha_id, bb.empresa_id, bb.filial_id, bb.cc_id, bb.ano, bb.mes,
           bb.valor, bb.expressao, bb.origem, bb.origem_formulario_linha_id, bb.dims, bb.moeda_origem,
           bb.val_m2, bb.val_m3, bb.val_m4, bb.val_m5, v.criado_em
      FROM _sync s JOIN fat_orcado bb ON bb.id = s.base_id
     WHERE s.acao = 'incluir';

    -- ⚠ `s.` em tudo: sem o alias, `acao` disputa com o parâmetro de saída.
    DELETE FROM fat_orcado o
     WHERE o.id IN (SELECT s.cen_id FROM _sync s WHERE s.acao = 'remover');

    UPDATE orcado_veredito ov
       SET aprovado = NULL,
           aprov_nota = coalesce(ov.aprov_nota || ' · ', '')
                        || 'veredito zerado: o cenário foi ressincronizado com a baseline'
     WHERE ov.versao_id = p_versao AND ov.tenant_id = t
       AND ov.linha_id IN (SELECT DISTINCT s.linha_id FROM _sync s
                            WHERE s.acao IN ('atualizar', 'incluir', 'remover'));

    UPDATE versao_orcamento SET semeado_em = now() WHERE id = p_versao;
  END IF;

  RETURN QUERY
  SELECT s.acao, count(*)::bigint,
         CASE s.acao
           WHEN 'preservada' THEN 'Tocadas pela área — a proposta, intocada'
           WHEN 'atualizar'  THEN 'Atualizadas com o valor de hoje da baseline'
           WHEN 'incluir'    THEN 'Trazidas: a baseline ganhou estas depois do semear'
           WHEN 'remover'    THEN 'Retiradas: a baseline não as tem mais'
           ELSE 'Já iguais'
         END
    FROM _sync s WHERE s.acao <> 'igual'
   GROUP BY s.acao ORDER BY s.acao;
END $$;

-- Mesma correção no merge, que tinha o mesmo descuido e ainda não foi exercido.
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
  IF EXISTS (SELECT 1 FROM versao_orcamento bl WHERE bl.id = v.origem_versao_id AND bl.bloqueada) THEN
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
     WHERE o.id IN (SELECT m.base_id FROM _merge m WHERE m.acao = 'apagar');

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

SELECT 'v3_177 aplicada' AS resultado,
       (SELECT count(*) FROM pg_proc
         WHERE proname IN ('ressincronizar_cenario','mesclar_cenario_orcado')
           AND prosrc LIKE '%FROM _% WHERE %.acao%') AS funcoes_qualificadas;
