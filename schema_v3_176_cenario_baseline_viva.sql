-- ============================================================
-- v3_176 — Cenário sobre baseline que ainda se move
--
-- ⚠ LACUNA DE DESENHO, apontada pelo Ricardo antes de criar o primeiro
-- cenário: a baseline de 2027 ainda está sendo construída (despesas em
-- análise, postos longe do real). O desenho supôs baseline estável e não
-- respondia "e se ela mudar depois que eu semear?".
--
-- O que NÃO quebra: o merge. Ele grava o que o cenário MEXEU
-- (`atualizado_em > criado_em`), então mudança na baseline nunca é
-- sobrescrita por engano.
--
-- O que quebra: **o Δ que o aprovador lê**. A célula que a área não tocou
-- guarda o valor do dia do semear; se a controladoria mudar a baseline, essa
-- célula passa a aparecer como proposta de REVERTER — ruído que a área nunca
-- pediu, e que entra em `cenario_orcado_diff` exigindo veredito. Numa baseline
-- em construção isso seria a maior parte do diff.
--
-- Duas saídas, e a ordem de preferência importa:
--
-- **`ressincronizar_cenario`** — a boa. Atualiza da baseline só as células que
-- o cenário NÃO tocou, preserva as tocadas (que são a proposta), traz as
-- células novas e tira as que a baseline removeu. O trabalho da área sobrevive.
--
-- **`excluir_cenario`** — a grosseira, para quando o cenário foi criado por
-- engano. Já funcionava por cascata, mas sem guarda nenhuma e pela tela de
-- Cadastros, ao lado da BASELINE — apagar a linha errada ali leva 24 mil
-- células. Aqui recusa baseline, recusa cenário já liberado e exige o código
-- digitado, como `apagar_orcado_versao` (v3_127).
--
-- ⚠ O gatilho de touch precisou mudar: ele sobrescrevia `atualizado_em` SEMPRE,
-- então a ressincronização não conseguia devolver a célula ao estado "não
-- tocada". Agora só carimba quando o comando não escreveu a coluna — que é o
-- padrão de todo gatilho de touch e o que faltava.
--
-- ⚠ Ressincronizar MEXE no que o aprovador leu, então zera o veredito das
-- linhas afetadas — mesma regra da v3_166 ("decisão alterada zera o veredito"):
-- o ✓ anterior era sobre outro número. O carimbo cai sozinho, pelo gatilho.
--
-- Termina em SELECT.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O touch passa a respeitar escrita explícita
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fat_orcado_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.atualizado_em IS NOT DISTINCT FROM OLD.atualizado_em THEN
    NEW.atualizado_em := now();
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 2. Ressincronizar com a baseline de hoje
-- ------------------------------------------------------------
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
           -- tocada pela área: é a PROPOSTA, não se mexe
           WHEN c.id IS NOT NULL AND c.atualizado_em > v.criado_em THEN 'preservada'
           -- não tocada e a baseline mudou: atualiza
           WHEN c.id IS NOT NULL AND b.id IS NOT NULL
                AND (c.valor IS DISTINCT FROM b.valor
                  OR c.expressao IS DISTINCT FROM b.expressao
                  OR c.origem IS DISTINCT FROM b.origem
                  OR c.val_m2 IS DISTINCT FROM b.val_m2
                  OR c.val_m3 IS DISTINCT FROM b.val_m3
                  OR c.val_m4 IS DISTINCT FROM b.val_m4
                  OR c.val_m5 IS DISTINCT FROM b.val_m5) THEN 'atualizar'
           -- célula que a baseline ganhou depois do semear
           WHEN c.id IS NULL AND b.id IS NOT NULL THEN 'incluir'
           -- célula que a baseline perdeu, e a área não tocou
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
    -- ⚠ `atualizado_em = v.criado_em` explícito: é o que devolve a célula ao
    -- estado "veio do semear". Sem o gatilho corrigido acima, o touch a
    -- carimbaria com `now()` e ela viraria proposta da área.
    UPDATE fat_orcado o
       SET valor = b.valor, expressao = b.expressao, origem = b.origem,
           moeda_origem = b.moeda_origem, dims = b.dims,
           origem_formulario_linha_id = b.origem_formulario_linha_id,
           val_m2 = b.val_m2, val_m3 = b.val_m3, val_m4 = b.val_m4, val_m5 = b.val_m5,
           atualizado_em = v.criado_em
      FROM _sync s JOIN fat_orcado b ON b.id = s.base_id
     WHERE o.id = s.cen_id AND s.acao = 'atualizar';

    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, origem_formulario_linha_id, dims, moeda_origem,
       val_m2, val_m3, val_m4, val_m5, atualizado_em)
    SELECT b.tenant_id, p_versao, b.linha_id, b.empresa_id, b.filial_id, b.cc_id, b.ano, b.mes,
           b.valor, b.expressao, b.origem, b.origem_formulario_linha_id, b.dims, b.moeda_origem,
           b.val_m2, b.val_m3, b.val_m4, b.val_m5, v.criado_em
      FROM _sync s JOIN fat_orcado b ON b.id = s.base_id
     WHERE s.acao = 'incluir';

    DELETE FROM fat_orcado o WHERE o.id IN (SELECT cen_id FROM _sync WHERE acao = 'remover');

    -- O veredito era sobre outro número.
    UPDATE orcado_veredito ov
       SET aprovado = NULL,
           aprov_nota = coalesce(ov.aprov_nota || ' · ', '')
                        || 'veredito zerado: o cenário foi ressincronizado com a baseline'
     WHERE ov.versao_id = p_versao AND ov.tenant_id = t
       AND ov.linha_id IN (SELECT DISTINCT linha_id FROM _sync
                            WHERE acao IN ('atualizar', 'incluir', 'remover'));

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
REVOKE ALL ON FUNCTION ressincronizar_cenario(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION ressincronizar_cenario(uuid, boolean) TO authenticated;

-- ------------------------------------------------------------
-- 3. Excluir o cenário, com guarda
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION excluir_cenario(p_versao uuid, p_confirmacao text)
RETURNS TABLE(celulas bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := current_tenant_id(); v record; n bigint;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só a controladoria (admin) pode excluir cenário.' USING ERRCODE = '42501';
  END IF;
  SELECT id, codigo, origem_versao_id, mesclado_em INTO v
    FROM versao_orcamento WHERE id = p_versao AND tenant_id = t;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Cenário não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  -- A guarda que mais importa: isto NUNCA apaga uma baseline.
  IF v.origem_versao_id IS NULL THEN
    RAISE EXCEPTION 'A versão % é uma BASELINE e não pode ser excluída por aqui.', v.codigo
      USING ERRCODE = '42501';
  END IF;
  IF v.mesclado_em IS NOT NULL THEN
    RAISE EXCEPTION 'O cenário % já foi liberado na baseline — apagá-lo apagaria o registro do que foi aprovado.', v.codigo
      USING ERRCODE = '22023';
  END IF;
  -- Não é senha: é para não apagar o cenário errado (v3_127).
  IF upper(btrim(coalesce(p_confirmacao, ''))) <> upper(v.codigo) THEN
    RAISE EXCEPTION 'Digite o código do cenário (%) para confirmar.', v.codigo USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO n FROM fat_orcado WHERE versao_id = p_versao;
  DELETE FROM versao_orcamento WHERE id = p_versao;   -- cascata leva fato e vereditos
  RETURN QUERY SELECT n;
END $$;
REVOKE ALL ON FUNCTION excluir_cenario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION excluir_cenario(uuid, text) TO authenticated;

SELECT 'v3_176 aplicada' AS resultado,
       (SELECT CASE WHEN prosrc LIKE '%IS NOT DISTINCT FROM%' THEN 'sim' ELSE 'NÃO' END
          FROM pg_proc WHERE proname='trg_fat_orcado_touch') AS touch_respeita_explicito,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('ressincronizar_cenario','excluir_cenario')) AS funcoes;
