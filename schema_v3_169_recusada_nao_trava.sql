-- ============================================================
-- v3_169 — Recusada é decisão tomada, não pendência
--
-- A v3_166 exigia unanimidade: qualquer recusa travava o carimbo. Está errado.
-- **Recusar é decidir** — decidir que aquele posto fica como está no cadastro.
-- O que não pode passar é o PENDENTE, que significa "ninguém olhou".
--
-- Então a regra muda: bloqueia só `aprovado IS NULL`. Recusada deixa o cenário
-- fechar, e simplesmente **não se aplica**: no Aplicar no orçado aquele posto
-- entra com o valor do CADASTRO.
--
-- ⚠ Consequência que o frontend precisa honrar: o Aplicar passa a resolver a
-- sobreposição **só onde `aprovado = true`**. Sem isso a tela mostraria o
-- número do cenário e gravaria o mesmo número, ignorando a recusa — o pior
-- resultado possível, porque o carimbo diria que foi revisado.
--
-- `vw_cenario_aplicavel` existe para que essa regra tenha UM dono. Se o
-- cálculo do Aplicar e o da tela divergirem, é aqui que se confere quem está
-- certo.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION aprovar_cenario(p_versao uuid, p_nota text DEFAULT NULL)
RETURNS TABLE(aprovado_em timestamptz, aprovado_por uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_pend int;
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar cenário.' USING ERRCODE = '42501';
  END IF;
  -- Só PENDENTE trava. Recusada já foi decidida: fica com o cadastro.
  SELECT count(*) INTO n_pend FROM posto_versao
   WHERE versao_id = p_versao AND tenant_id = current_tenant_id() AND aprovado IS NULL;
  IF n_pend > 0 THEN
    RAISE EXCEPTION 'Faltam % decisão(ões) sem veredito. Aprove ou recuse cada uma antes de fechar o cenário.', n_pend;
  END IF;
  RETURN QUERY
  UPDATE versao_orcamento v
     SET aprovado_em = now(), aprovado_por = auth.uid(), aprovacao_nota = p_nota
   WHERE v.id = p_versao AND v.tenant_id = current_tenant_id()
  RETURNING v.aprovado_em, v.aprovado_por;
END $$;
REVOKE ALL ON FUNCTION aprovar_cenario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION aprovar_cenario(uuid, text) TO authenticated;

-- Dono único da regra "o que de fato entra no orçado".
CREATE OR REPLACE VIEW vw_cenario_aplicavel AS
SELECT pv.versao_id, pv.posto_id, pv.aprovado
  FROM posto_versao pv
 WHERE pv.tenant_id = (SELECT current_tenant_id())
   AND pv.aprovado = true;

SELECT 'aprovar_cenario trava só no pendente' AS secao,
       CASE WHEN pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='aprovar_cenario')) LIKE '%aprovado IS NULL%'
            THEN 'sim' ELSE '⛔ ainda exige unanimidade' END AS resultado
UNION ALL SELECT 'view do que é aplicável',
  CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE viewname='vw_cenario_aplicavel') THEN 'criada' ELSE '⛔ não' END
UNION ALL SELECT 'decisões hoje: aprovadas / recusadas / pendentes',
  (SELECT count(*) FILTER (WHERE aprovado) || ' / ' || count(*) FILTER (WHERE aprovado = false)
          || ' / ' || count(*) FILTER (WHERE aprovado IS NULL) FROM posto_versao);
