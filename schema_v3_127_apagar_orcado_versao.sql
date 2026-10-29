-- ============================================================
-- v3_127 — apagar TODO o orçado de uma versão/ano, com confirmação verificada
-- no servidor.
--
-- O caso real: a versão em que se está trabalhando acumulou cargas de várias
-- origens — manual, formulários, posto, imposto — e já não se sabe o que está
-- aplicado. Recomeçar é mais barato que auditar.
--
-- ───────── TRÊS PROTEÇÕES, E POR QUE CADA UMA ─────────
-- 1. RESUMO ANTES. `orcado_resumo_versao` diz exatamente o que vai sumir —
--    quantas linhas, de que origem, quanto valor, quantos escopos. Confirmar
--    sem ver o tamanho do estrago é confirmar no escuro.
-- 2. CONFIRMAÇÃO VERIFICADA NO SERVIDOR. Quem chama tem de repetir o CÓDIGO da
--    versão. Não é senha: senha prova identidade, e o risco aqui não é um
--    estranho clicando — é a pessoa certa apagando a VERSÃO ERRADA. Digitar o
--    código prova intenção sobre o alvo, que é o que falta.
-- 3. VERSÃO BLOQUEADA NÃO APAGA. `bloqueada` existe para proteger orçamento
--    aprovado; ignorá-la aqui tornaria a trava decorativa.
--
-- ───────── O QUE APAGA, E O QUE NÃO ─────────
-- Apaga `fat_orcado` da versão/ano, de TODAS as origens, e os carimbos de
-- `formulario_aplicacao` — senão a tela continuaria dizendo "aplicado em tal
-- dia" sobre um orçado que não existe mais.
--
-- NÃO apaga `formulario_valor`: a memória de cálculo dos formulários é o
-- trabalho de montagem, não a carga. Quem recomeça as cargas quer justamente
-- reaplicar os formulários, não redigitá-los. Para limpar um formulário há o
-- botão próprio dele.
--
-- NÃO apaga realizado, saldos, postos nem cadastros.
--
-- IDEMPOTENTE (a função; o efeito, por natureza, não).
-- ============================================================

-- ---------- resumo: o que existe nessa versão/ano ----------
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
    'codigo',   (SELECT v.codigo FROM versao_orcamento v WHERE v.id = p_versao),
    'bloqueada',(SELECT coalesce(v.bloqueada, false) FROM versao_orcamento v WHERE v.id = p_versao)
  )
$$;

-- ---------- apagar ----------
DROP FUNCTION IF EXISTS apagar_orcado_versao(uuid, int, text);
CREATE FUNCTION apagar_orcado_versao(p_versao uuid, p_ano int, p_confirmacao text)
RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout = '300s'
AS $$
DECLARE
  v_cod text; v_bloq boolean; v_tenant uuid;
  n_fat int; n_apl int;
BEGIN
  v_tenant := current_tenant_id();
  SELECT codigo, coalesce(bloqueada, false) INTO v_cod, v_bloq
    FROM versao_orcamento WHERE id = p_versao AND tenant_id = v_tenant;

  IF v_cod IS NULL THEN RAISE EXCEPTION 'Versão não encontrada.'; END IF;
  IF v_bloq THEN
    RAISE EXCEPTION 'A versão % está BLOQUEADA. Desbloqueie antes, se é mesmo isso que você quer.', v_cod;
  END IF;
  -- A confirmação é conferida AQUI, não só na tela: a tela pode ser contornada,
  -- e esta é a chamada que destrói.
  IF p_confirmacao IS DISTINCT FROM v_cod THEN
    RAISE EXCEPTION 'Confirmação não confere: digite exatamente o código da versão (%).', v_cod;
  END IF;

  DELETE FROM fat_orcado
   WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_fat = ROW_COUNT;

  DELETE FROM formulario_aplicacao
   WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano;
  GET DIAGNOSTICS n_apl = ROW_COUNT;

  RETURN jsonb_build_object('versao', v_cod, 'ano', p_ano,
                            'linhas_apagadas', n_fat, 'aplicacoes_apagadas', n_apl);
END $$;

-- ---------- conferência ----------
SELECT proname AS funcao, 'criada' AS ok
  FROM pg_proc WHERE proname IN ('orcado_resumo_versao', 'apagar_orcado_versao')
 ORDER BY 1;
