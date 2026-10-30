-- ============================================================
-- v3_128 · O apagar do orçado precisa levar a folha junto
--
-- DEFEITO no v3_127: apagava `fat_orcado` e `formulario_aplicacao`, mas não
-- `fat_folha` tipo ORCADO — a abertura POR POSTO que o Aplicar grava em
-- paralelo ao fato. O próprio Aplicar apaga os dois antes de regravar
-- (PostosGradePage), o que já dizia que eles andam em par.
--
-- Sintoma: depois de apagar, a DRE fica sem o orçado de folha e a tela de
-- Conciliação continua mostrando o orçado por posto da carga antiga. Duas
-- telas discordando sobre se o orçamento existe — e a Conciliação é
-- exatamente onde se vai conferir se ele existe.
--
-- `fat_folha` ORCADO não tem recorte por ano próprio na chave do Aplicar
-- (ele apaga por versão inteira), mas a linha TEM coluna `ano`. Apagar por
-- (versao, ano) é mais conservador que por versão e casa com o resto desta
-- função, que é toda recortada por ano.
--
-- Rodar inteiro. Idempotente: só recria as duas funções.
-- ============================================================

-- ---------- resumo: mostrar também o que será apagado na folha ----------
DROP FUNCTION IF EXISTS orcado_resumo_versao(uuid, int);
CREATE FUNCTION orcado_resumo_versao(p_versao uuid, p_ano int)
RETURNS jsonb
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT jsonb_build_object(
    'linhas',   (SELECT count(*) FROM fat_orcado f
                  WHERE f.tenant_id = current_tenant_id() AND f.versao_id = p_versao AND f.ano = p_ano),
    'valor',    (SELECT coalesce(round(sum(f.valor), 2), 0) FROM fat_orcado f
                  WHERE f.tenant_id = current_tenant_id() AND f.versao_id = p_versao AND f.ano = p_ano),
    'escopos',  (SELECT count(*) FROM (SELECT DISTINCT f.empresa_id, f.filial_id, f.cc_id FROM fat_orcado f
                  WHERE f.tenant_id = current_tenant_id() AND f.versao_id = p_versao AND f.ano = p_ano) s),
    'contas',   (SELECT count(DISTINCT f.linha_id) FROM fat_orcado f
                  WHERE f.tenant_id = current_tenant_id() AND f.versao_id = p_versao AND f.ano = p_ano),
    'por_origem', coalesce((
        SELECT jsonb_agg(jsonb_build_object('origem', o, 'linhas', n, 'valor', v) ORDER BY o)
          FROM (SELECT f.origem o, count(*) n, round(sum(f.valor), 2) v
                  FROM fat_orcado f
                 WHERE f.tenant_id = current_tenant_id() AND f.versao_id = p_versao AND f.ano = p_ano
                 GROUP BY f.origem) x), '[]'::jsonb),
    'aplicacoes', (SELECT count(*) FROM formulario_aplicacao a
                    WHERE a.tenant_id = current_tenant_id() AND a.versao_id = p_versao AND a.ano = p_ano),
    -- NOVO: a abertura por posto. Sai junto, então tem de aparecer ANTES —
    -- a tela promete mostrar tudo o que vai sumir.
    'folha_linhas', (SELECT count(*) FROM fat_folha g
                      WHERE g.tenant_id = current_tenant_id() AND g.tipo = 'ORCADO'
                        AND g.versao_id = p_versao AND g.ano = p_ano),
    'folha_postos', (SELECT count(DISTINCT g.posto_id) FROM fat_folha g
                      WHERE g.tenant_id = current_tenant_id() AND g.tipo = 'ORCADO'
                        AND g.versao_id = p_versao AND g.ano = p_ano),
    'codigo',   (SELECT v.codigo FROM versao_orcamento v WHERE v.id = p_versao),
    'bloqueada',(SELECT coalesce(v.bloqueada, false) FROM versao_orcamento v WHERE v.id = p_versao)
  )
$$;

-- ---------- apagar: fato, carimbo de formulário E abertura de folha ----------
DROP FUNCTION IF EXISTS apagar_orcado_versao(uuid, int, text);
CREATE FUNCTION apagar_orcado_versao(p_versao uuid, p_ano int, p_confirmacao text)
RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout = '300s'
AS $$
DECLARE
  v_cod text; v_bloq boolean; v_tenant uuid;
  n_fat int; n_apl int; n_folha int;
BEGIN
  v_tenant := current_tenant_id();
  SELECT codigo, coalesce(bloqueada, false) INTO v_cod, v_bloq
    FROM versao_orcamento WHERE id = p_versao AND tenant_id = v_tenant;

  IF v_cod IS NULL THEN RAISE EXCEPTION 'Versão não encontrada.'; END IF;
  IF v_bloq THEN
    RAISE EXCEPTION 'A versão % está BLOQUEADA. Desbloqueie antes, se é mesmo isso que você quer.', v_cod;
  END IF;
  IF p_confirmacao IS DISTINCT FROM v_cod THEN
    RAISE EXCEPTION 'Confirmação não confere: digite exatamente o código da versão (%).', v_cod;
  END IF;

  DELETE FROM fat_orcado
   WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_fat = ROW_COUNT;

  DELETE FROM formulario_aplicacao
   WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_apl = ROW_COUNT;

  -- A abertura por posto sai junto com o fato. Deixá-la para trás fazia a
  -- Conciliação mostrar orçado de uma carga que não existe mais.
  DELETE FROM fat_folha
   WHERE tenant_id = v_tenant AND tipo = 'ORCADO' AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_folha = ROW_COUNT;

  RETURN jsonb_build_object('versao', v_cod, 'ano', p_ano,
                            'linhas_apagadas', n_fat, 'aplicacoes_apagadas', n_apl,
                            'folha_apagada', n_folha);
END $$;

-- ---------- conferência: sobrou abertura de folha sem fato? ----------
-- Estado inconsistente deixado pelo v3_127 em quem já apagou antes desta
-- migration. Se vier linha aqui, apagar de novo (agora leva a folha junto).
SELECT v.codigo                         AS versao,
       g.ano                            AS ano,
       count(*)                         AS folha_orcado_sem_fato,
       count(DISTINCT g.posto_id)       AS postos
  FROM fat_folha g
  JOIN versao_orcamento v ON v.id = g.versao_id
 WHERE g.tipo = 'ORCADO'
   AND NOT EXISTS (SELECT 1 FROM fat_orcado f
                    WHERE f.versao_id = g.versao_id AND f.ano = g.ano AND f.origem = 'POSTO')
 GROUP BY v.codigo, g.ano
 ORDER BY v.codigo, g.ano;
