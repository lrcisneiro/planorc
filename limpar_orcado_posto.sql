-- ============================================================
-- Desfazer o "Aplicar no orçado" de UMA versão
--
-- Caso: o Aplicar rodou na versão errada e somou-se ao orçado que já existia ali
-- (digitado ou vindo de formulário), duplicando a folha.
--
-- O que ele remove é exatamente o que o Aplicar cria, e nada mais:
--   fat_orcado  origem = 'POSTO'                  (o orçado por conta)
--   fat_folha   tipo   = 'ORCADO'                 (o paralelo por verba)
-- Lançamento MANUAL e de FORMULARIO não são tocados — é o mesmo recorte que o
-- próprio Aplicar usa para limpar antes de reinserir.
--
-- SEGURANÇA: duas etapas. Com v_confirmar = false só relata. Leia e volte.
--
-- ATENÇÃO: se a versão DEVIA ter orçado de posto, isto o remove por inteiro —
-- rode o "Aplicar no orçado" de novo depois, na versão certa.
-- ============================================================

DO $$
DECLARE
  -- ══════════════ CONFIGURE AQUI ══════════════
  v_versao_cod text    := 'BASELINE_2027';  -- código da versão a limpar
  v_confirmar  boolean := false;            -- false = só relatório; true = apaga
  -- ════════════ fim da configuração ════════════

  v_tenant uuid; v_versao uuid;
  n_orc int; v_orc numeric; n_folha int; v_folha numeric;
  n_outros int; v_outros numeric; r record;
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  SELECT id INTO v_versao FROM versao_orcamento WHERE tenant_id = v_tenant AND codigo = v_versao_cod;
  IF v_versao IS NULL THEN RAISE EXCEPTION 'Versão "%" não existe', v_versao_cod; END IF;

  SELECT count(*), coalesce(sum(valor), 0) INTO n_orc, v_orc
    FROM fat_orcado WHERE versao_id = v_versao AND origem = 'POSTO';
  SELECT count(*), coalesce(sum(valor), 0) INTO n_outros, v_outros
    FROM fat_orcado WHERE versao_id = v_versao AND origem <> 'POSTO';
  SELECT count(*), coalesce(sum(valor), 0) INTO n_folha, v_folha
    FROM fat_folha WHERE versao_id = v_versao AND tipo = 'ORCADO';

  RAISE NOTICE '── Versão % ──', v_versao_cod;
  RAISE NOTICE 'SAI  · fat_orcado origem POSTO : % linha(s) · R$ %', n_orc, round(v_orc, 2);
  RAISE NOTICE 'SAI  · fat_folha  tipo ORCADO  : % linha(s) · R$ %', n_folha, round(v_folha, 2);
  RAISE NOTICE 'FICA · fat_orcado MANUAL/FORMULARIO : % linha(s) · R$ %', n_outros, round(v_outros, 2);

  -- quem é a duplicata: conta que tem POSTO e também outra origem
  FOR r IN
    SELECT co.codigo, sum(f.valor) FILTER (WHERE f.origem = 'POSTO')  AS posto,
                      sum(f.valor) FILTER (WHERE f.origem <> 'POSTO') AS outros
      FROM fat_orcado f JOIN conta_orcamentaria co ON co.id = f.linha_id
     WHERE f.versao_id = v_versao
     GROUP BY co.codigo
    HAVING count(*) FILTER (WHERE f.origem = 'POSTO') > 0
       AND count(*) FILTER (WHERE f.origem <> 'POSTO') > 0
     ORDER BY 2 DESC NULLS LAST LIMIT 10
  LOOP
    RAISE NOTICE '   duplicada na conta %: POSTO R$ % · outras origens R$ %', r.codigo, round(r.posto, 2), round(r.outros, 2);
  END LOOP;

  IF NOT v_confirmar THEN
    RAISE NOTICE '>> Nada foi apagado. Confira acima e rode de novo com v_confirmar = true.';
    RETURN;
  END IF;

  DELETE FROM fat_orcado WHERE versao_id = v_versao AND origem = 'POSTO';
  DELETE FROM fat_folha  WHERE versao_id = v_versao AND tipo   = 'ORCADO';
  RAISE NOTICE '>> Removido o orçado de origem POSTO da versão %. MANUAL e FORMULARIO intactos.', v_versao_cod;
END $$;

-- ── Panorama de TODAS as versões (não é o resultado do expurgo) ──
-- O bloco acima age só na versão configurada; este SELECT mostra o quadro geral
-- para você ver onde mais existe orçado de origem POSTO. O relatório do expurgo
-- sai nos NOTICE (no Supabase: aba de mensagens, não em "Results").
SELECT v.codigo AS versao, f.origem, count(*) AS linhas, sum(f.valor) AS valor
  FROM fat_orcado f JOIN versao_orcamento v ON v.id = f.versao_id
 GROUP BY v.codigo, f.origem
 ORDER BY v.codigo, f.origem;
