-- ============================================================
-- 087 — O corte entre CLT e terceiro é por CONTA, não por (conta, verba)
--
-- SINTOMA: o CLT aparecia 100% conciliado, com diferença 0,00 em toda conta.
-- Bom demais para ser verdade, e era.
--
-- CAUSA: a v3_085 classificava cada PAR (conta, verba). Verba que a
-- contabilização da folha lança → CLT; o resto → terceiro. Duas consequências,
-- espelhadas, e as duas erradas:
--
--   1. O CLT ficava dirigido pelo razão (FROM rz LEFT JOIN fo). Verba que a
--      folha tem e a contabilização não lançou não aparecia. E como a
--      contabilização é GERADA da folha, tudo o que ela lança bate à vírgula —
--      daí o 0,00 em tudo. A diferença real mora justamente no que ela não
--      lançou, que era o que estava escondido.
--
--   2. Essa mesma folha ia parar no bloco TERCEIROS, como "sem nota". Um
--      adiantamento de salário de um CLT aparecia listado como prestador sem
--      nota fiscal, inflando a folha do terceiro contra um razão que nunca
--      teria contrapartida.
--
-- CORREÇÃO: quem decide é a CONTA. Conta em que a contabilização da folha lança
-- alguma coisa é conta de CLT — e ali dentro TODAS as verbas entram na
-- comparação, inclusive as que ela não lançou (que aparecem com razão zerado,
-- como divergência, que é o que são). Conta em que ela não lança nada é de
-- terceiro, e é lá que a conciliação por pessoa acontece.
--
-- É o mesmo erro da v3_085 anterior ("os outros sumiram"): estreitar um recorte
-- sem perguntar para onde vai o que ficou de fora.
-- ============================================================

-- ── CLT: conta → verba, com os DOIS lados ──
CREATE OR REPLACE FUNCTION conciliacao_clt(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, conta_cod text, conta_desc text, plano_cod text,
  verba_cod text, verba_desc text, razao numeric, folha numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  -- a contabilização lança nos dois lados com o mesmo histórico; só o débito
  -- tem o que conciliar, e quem diz qual é o crédito é a própria folha
  cred AS (
    SELECT DISTINCT ccred.id AS conta_id, btrim(coalesce(ff.verba_cod, '')) AS v
      FROM fat_folha ff
      JOIN conta_contabil cdeb  ON cdeb.id = ff.conta_id
      JOIN conta_contabil ccred ON ccred.tenant_id = cdeb.tenant_id
                               AND ccred.plano_id IS NOT DISTINCT FROM cdeb.plano_id
                               AND ccred.codigo = btrim(ff.conta_cred_cod)
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.conta_cred_cod, '') <> ''
  ),
  rz AS (
    SELECT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS verba_cod,
           sum(-fr.valor)::numeric AS valor
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
       AND NOT EXISTS (SELECT 1 FROM cred
                        WHERE cred.conta_id = fr.conta_id
                          AND cred.v = btrim(split_part(coalesce(fr.historico, ''), '-', 1)))
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  ),
  -- CONTA de CLT: aquela em que a contabilização da folha lança alguma coisa.
  -- Dentro dela, toda verba da folha entra na comparação — a que ela não lançou
  -- aparece com razão zerado, que é exatamente a divergência a investigar.
  contas_clt AS (SELECT DISTINCT conta_id FROM rz),
  fo AS (
    SELECT ff.conta_id, btrim(coalesce(ff.verba_cod, '')) AS verba_cod,
           max(ff.verba_desc) AS verba_desc, sum(ff.valor)::numeric AS valor
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes
       AND ff.conta_id IN (SELECT conta_id FROM contas_clt)
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  )
  SELECT cc.id, cc.codigo, cc.descricao, pc.codigo,
         coalesce(r.verba_cod, f.verba_cod), f.verba_desc,
         coalesce(r.valor, 0)::numeric, coalesce(f.valor, 0)::numeric
    FROM rz r
    FULL JOIN fo f ON f.conta_id = r.conta_id AND f.verba_cod = r.verba_cod
    JOIN conta_contabil cc ON cc.id = coalesce(r.conta_id, f.conta_id)
    LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
   ORDER BY cc.codigo, pc.codigo, coalesce(r.verba_cod, f.verba_cod);
$$;

-- ── Terceiros: só a folha de conta que a contabilização NÃO toca ──
CREATE OR REPLACE FUNCTION conciliacao_terceiros(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  status text, via text, filial_id uuid, matricula text, nome text,
  fornecedor_cod text, nome_fantasia text, cc_cod text,
  lancamentos bigint, razao numeric, folha numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  -- conta em que a contabilização da folha lança: é CLT, e a folha dela pertence
  -- ao outro bloco. Sem este corte por CONTA, um adiantamento de salário de um
  -- CLT vinha parar aqui como "prestador sem nota fiscal".
  contas_clt AS (
    SELECT DISTINCT fr.conta_id FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
  ),
  atr AS MATERIALIZED (SELECT * FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs)),
  nf AS (
    SELECT a.status, a.via, a.filial_id, a.matricula, a.fornecedor_cod,
           max(a.nome) AS nome, max(a.nome_fantasia) AS nome_fantasia,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           count(*)::bigint AS lancamentos, sum(a.valor)::numeric AS razao
      FROM atr a LEFT JOIN centro_custo cc ON cc.id = a.cc_id
     GROUP BY a.status, a.via, a.filial_id, a.matricula, a.fornecedor_cod,
              CASE WHEN a.status = 'CASADO' THEN '' ELSE coalesce(a.nome_fantasia, '') END
  ),
  fol AS (
    SELECT ff.filial_id, ff.matricula, max(ff.nome) AS nome,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           sum(ff.valor)::numeric AS folha
      FROM fat_folha ff LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND ff.conta_id NOT IN (SELECT conta_id FROM contas_clt)
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  )
  SELECT CASE WHEN n.status IS NULL                            THEN 'SEM_NF'
              WHEN n.status = 'CASADO' AND f.matricula IS NULL THEN 'SEM_FOLHA'
              ELSE n.status END,
         n.via,
         coalesce(n.filial_id, f.filial_id), coalesce(n.matricula, f.matricula),
         coalesce(n.nome, f.nome), n.fornecedor_cod, n.nome_fantasia,
         coalesce(n.cc_cod, f.cc_cod), coalesce(n.lancamentos, 0),
         coalesce(n.razao, 0)::numeric, coalesce(f.folha, 0)::numeric
    FROM nf n
    FULL JOIN fol f ON n.status = 'CASADO'
                   AND f.matricula = n.matricula
                   AND f.filial_id IS NOT DISTINCT FROM n.filial_id
   ORDER BY 1, greatest(abs(coalesce(n.razao, 0)), abs(coalesce(f.folha, 0))) DESC;
$$;

-- ── O detalhe da pessoa segue o mesmo corte ──
CREATE OR REPLACE FUNCTION conciliacao_terceiros_pessoa(
  p_ano int, p_mes int, p_relatorio_id uuid, p_filial_id uuid, p_matricula text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  lado text, conta_cod text, conta_desc text, ref text, cc_cod text,
  data date, documento text, historico text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  contas_clt AS (
    SELECT DISTINCT fr.conta_id FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
  )
  SELECT 'RAZÃO', cc2.codigo, cc2.descricao, a.fornecedor_cod, ccu.codigo,
         a.data, a.documento, a.historico, a.valor
    FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
    JOIN conta_contabil cc2 ON cc2.id = a.conta_id
    LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
   WHERE a.matricula = p_matricula AND a.filial_id IS NOT DISTINCT FROM p_filial_id

  UNION ALL
  SELECT 'FOLHA', cc2.codigo, cc2.descricao,
         btrim(coalesce(ff.verba_cod, '')) || ' ' || coalesce(ff.verba_desc, ''), ccu.codigo,
         NULL::date, NULL::text, NULL::text, sum(ff.valor)::numeric
    FROM fat_folha ff
    JOIN conta_contabil cc2 ON cc2.id = ff.conta_id
    LEFT JOIN centro_custo ccu ON ccu.id = ff.cc_id
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes
     AND ff.matricula = p_matricula AND ff.filial_id IS NOT DISTINCT FROM p_filial_id
     AND ff.conta_id NOT IN (SELECT conta_id FROM contas_clt)
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY 1, 2, 3, 4, 5
   ORDER BY 1, 2, 9 DESC;
$$;
