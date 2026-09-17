-- ============================================================
-- Expurgo das contas de UM plano de contas
--
-- Uso: plano importado errado que precisa ser refeito do zero. Apaga as contas
-- do plano; o plano em si continua (vazio, pronto para reimportar), porque
-- empresa.plano_id é ON DELETE SET NULL — apagar o plano desamarraria a empresa
-- em silêncio, e descobrir isso depois custa caro.
--
-- SEGURANÇA: roda em duas etapas. Com v_confirmar = false ele só CONTA o que
-- seria apagado e não toca em nada. Leia o relatório, depois volte e ligue.
--
-- O que sai junto, por CASCADE:
--   conta_linha             — amarração conta → linha de relatório
--   fat_saldo               — balancete daquelas contas
--   conciliacao_folha_nota  — justificativas da conciliação
-- O que BLOQUEIA (FK sem cascade, de propósito — é fato financeiro):
--   fat_realizado.conta_id  — lançamentos do razão
--   fat_folha.conta_id      — folha analítica
-- Havendo fato, o expurgo para e diz quanto. Apagar lançamento é outra decisão,
-- e tem de ser tomada olhando o número, não de passagem.
-- ============================================================

DO $$
DECLARE
  -- ══════════════ CONFIGURE AQUI ══════════════
  v_plano_cod text    := 'BOTOP';   -- código do plano a limpar
  v_confirmar boolean := false;     -- false = só relatório; true = apaga
  -- ════════════ fim da configuração ════════════

  v_tenant uuid; v_plano uuid; v_nome text;
  n_contas int; n_linha int; n_saldo int; n_nota int; n_real int; n_folha int;
  n_emp int; n_dest int; v_val_real numeric; v_val_folha numeric;
BEGIN
  SELECT id INTO v_tenant FROM tenant LIMIT 1;
  SELECT id, nome INTO v_plano, v_nome FROM plano_contas
   WHERE tenant_id = v_tenant AND codigo = v_plano_cod;
  IF v_plano IS NULL THEN RAISE EXCEPTION 'Plano "%" não existe', v_plano_cod; END IF;

  SELECT count(*) INTO n_contas FROM conta_contabil WHERE plano_id = v_plano;
  SELECT count(*) INTO n_linha  FROM conta_linha    WHERE conta_id IN (SELECT id FROM conta_contabil WHERE plano_id = v_plano);
  SELECT count(*) INTO n_saldo  FROM fat_saldo      WHERE conta_id IN (SELECT id FROM conta_contabil WHERE plano_id = v_plano);
  SELECT count(*), coalesce(sum(abs(valor)), 0) INTO n_real,  v_val_real
    FROM fat_realizado WHERE conta_id IN (SELECT id FROM conta_contabil WHERE plano_id = v_plano);
  SELECT count(*), coalesce(sum(abs(valor)), 0) INTO n_folha, v_val_folha
    FROM fat_folha     WHERE conta_id IN (SELECT id FROM conta_contabil WHERE plano_id = v_plano);
  SELECT count(*) INTO n_emp FROM empresa WHERE plano_id = v_plano;
  n_nota := 0; n_dest := 0;
  IF to_regclass('public.conciliacao_folha_nota') IS NOT NULL THEN
    SELECT count(*) INTO n_nota FROM conciliacao_folha_nota WHERE conta_id IN (SELECT id FROM conta_contabil WHERE plano_id = v_plano);
  END IF;
  IF to_regclass('public.verba') IS NOT NULL THEN
    SELECT count(*) INTO n_dest FROM verba WHERE conta_destino_id IN (SELECT id FROM conta_contabil WHERE plano_id = v_plano);
  END IF;

  RAISE NOTICE '── Plano % (%) ──', v_plano_cod, v_nome;
  RAISE NOTICE 'contas                      : %', n_contas;
  RAISE NOTICE 'empresas apontando p/ ele   : %  (o plano NÃO é apagado; elas continuam amarradas)', n_emp;
  RAISE NOTICE 'sai junto (CASCADE)         : % amarração(ões), % saldo(s), % justificativa(s)', n_linha, n_saldo, n_nota;
  RAISE NOTICE 'verba c/ conta destino aqui : %  (vira NULL)', n_dest;
  RAISE NOTICE 'BLOQUEIA se houver          : % lançamento(s) de razão (R$ %) · % linha(s) de folha (R$ %)',
        n_real, round(v_val_real, 2), n_folha, round(v_val_folha, 2);

  IF NOT v_confirmar THEN
    RAISE NOTICE '>> Nada foi apagado. Confira acima e rode de novo com v_confirmar = true.';
    RETURN;
  END IF;

  IF n_real > 0 OR n_folha > 0 THEN
    RAISE EXCEPTION 'Há fato financeiro nessas contas (% razão, % folha). Apague o realizado dessas competências antes, ou reveja o plano escolhido.', n_real, n_folha;
  END IF;

  -- pai_id é auto-referência sem cascade: zerar antes, senão o DELETE trava nele
  UPDATE conta_contabil SET pai_id = NULL WHERE plano_id = v_plano;
  DELETE FROM conta_contabil WHERE plano_id = v_plano;

  RAISE NOTICE '>> % conta(s) apagadas do plano %. O plano continua, vazio, pronto para reimportar.', n_contas, v_plano_cod;
END $$;

-- ── Conferência ──
SELECT p.codigo, p.nome, count(c.id) AS contas,
       (SELECT count(*) FROM empresa e WHERE e.plano_id = p.id) AS empresas
  FROM plano_contas p
  LEFT JOIN conta_contabil c ON c.plano_id = p.id
 GROUP BY p.id, p.codigo, p.nome
 ORDER BY contas DESC;
