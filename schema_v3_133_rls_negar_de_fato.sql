-- ============================================================
-- v3_133 · O "negar por padrão" do v3_132 NÃO pegou — armadilha de NULL
--
-- SINTOMA: depois do v3_132, os dois usuários SEM regra continuaram vendo os
-- 322.395 lançamentos do razão. Deveriam ver zero.
--
-- CAUSA: `SELECT ... INTO` que não encontra linha atribui **NULL** às
-- variáveis de destino — sobrescrevendo a inicialização `:= false`. Então:
--
--     v_tem := false            -- inicialização
--     SELECT ... INTO v_tem     -- nenhuma linha → v_tem vira NULL
--     IF NOT v_tem THEN ...     -- NOT NULL = NULL → o IF NÃO dispara
--
-- A execução caía no ramo seguinte ("lista vazia = vê tudo") e devolvia NULL,
-- que significa sem restrição. No v3_129 isso era inofensivo por acaso, porque
-- os dois caminhos devolviam NULL. No v3_132 era exatamente o defeito.
--
-- CORREÇÃO: `IF v_tem IS NOT TRUE THEN`. Em SQL de três valores, só `IS TRUE` e
-- `IS NOT TRUE` dão resposta binária confiável sobre um boolean anulável.
-- Usar `FOUND` seria igualmente correto e talvez mais legível, mas exigiria
-- cuidado com as chamadas aninhadas; `IS NOT TRUE` é local e explícito.
--
-- ⚠ ESTE ARQUIVO SE PROVA. O bloco final personifica cada usuário e CONTA o que
-- ele vê. Conferir o código-fonte da função não serviria: o v3_132 "rodou com
-- sucesso" e estava errado. A prova é comportamento, não texto.
--
-- Rodar inteiro.
-- ============================================================

CREATE OR REPLACE FUNCTION escopo_dim(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;

  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'VER'
   LIMIT 1;

  -- `IS NOT TRUE` cobre false E null. `NOT v_tem` deixava o null passar.
  IF v_tem IS NOT TRUE THEN RETURN '{}'::uuid[]; END IF;   -- sem regra = NADA

  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;  -- explícito = tudo

  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c WHERE NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e      WHERE NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f       WHERE NOT (f.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;

  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

CREATE OR REPLACE FUNCTION escopo_dim_edit(p_dim text) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allow uuid[]; v_deny uuid[]; v_tem boolean;
BEGIN
  IF eh_admin() THEN RETURN NULL; END IF;

  SELECT valor_ids, negados, true INTO v_allow, v_deny, v_tem
    FROM user_acesso_regra
   WHERE user_id = auth.uid() AND dimensao = p_dim AND escopo = 'ORCAR'
   LIMIT 1;

  IF v_tem IS NOT TRUE THEN RETURN escopo_dim(p_dim); END IF;   -- herda o VER

  v_allow := coalesce(v_allow, '{}'); v_deny := coalesce(v_deny, '{}');
  IF v_allow = '{}' AND v_deny = '{}' THEN RETURN NULL; END IF;
  IF v_allow = '{}' THEN
    RETURN CASE p_dim
      WHEN 'centro_custo' THEN array(SELECT c.id FROM centro_custo c WHERE NOT (c.id = ANY(v_deny)))
      WHEN 'empresa'      THEN array(SELECT e.id FROM empresa e      WHERE NOT (e.id = ANY(v_deny)))
      WHEN 'filial'       THEN array(SELECT f.id FROM filial f       WHERE NOT (f.id = ANY(v_deny)))
      ELSE '{}'::uuid[] END;
  END IF;
  RETURN array(SELECT unnest(v_allow) EXCEPT SELECT unnest(v_deny));
END $$;

-- ════════════════════════════════════════════════════════════
-- PROVA — personifica e conta. Sai por exceção; É o resultado.
-- ════════════════════════════════════════════════════════════
DO $prova$
DECLARE
  u record; n bigint; rel text := ''; regras int;
BEGIN
  FOR u IN SELECT user_id, role FROM user_tenant ORDER BY role, user_id LOOP
    SELECT count(*) INTO regras FROM user_acesso_regra
     WHERE user_id = u.user_id AND escopo = 'VER'
       AND dimensao IN ('empresa','filial','centro_custo');

    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT count(*) FROM fat_realizado WHERE ano = 2026' INTO n;
    RESET ROLE;

    rel := rel || format(E'\n%s  %s  regras=%s  →  %s linha(s)%s',
      rpad(u.role, 7), left(u.user_id::text, 8) || '…', regras, to_char(n, 'FM999G999'),
      CASE WHEN u.role <> 'admin' AND regras = 0 AND n > 0
             THEN '   ⛔ SEM REGRA E VENDO DADO — a correção não pegou'
           WHEN u.role <> 'admin' AND regras = 0 AND n = 0
             THEN '   ✓ bloqueado, como deve'
           ELSE '' END);
  END LOOP;

  RAISE EXCEPTION E'=== PROVA DO NEGAR-POR-PADRÃO ===%\n\nESPERADO:\n  · admin ....................... vê tudo\n  · não-admin SEM regra ......... ZERO\n  · não-admin COM regra ......... o recorte dele\n\nSe algum não-admin sem regra ainda vê linha, a função não foi substituída.', rel;
END $prova$;
