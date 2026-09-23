-- ============================================================
-- 098 — Empresa e filial nas listas de lançamento
--
-- As listas mostravam conta, CC, documento, histórico e valor — mas não de qual
-- EMPRESA e FILIAL o lançamento é. Numa base em que a mesma folha é rateada
-- entre seis empresas, e em que a nota de uma pessoa pode cair em filial
-- diferente da folha dela, isso é a diferença entre "está certo" e "está no
-- lugar errado".
--
-- planorc_pj_atribui passa a devolver a empresa e a filial DO LANÇAMENTO. Elas
-- não se confundem com o filial_id que já existia ali: aquele é da PESSOA (de
-- onde ela é na folha), este é de onde o lançamento entrou. Quando os dois
-- diferem, é exatamente o que o conferente precisa ver.
-- ============================================================

DROP FUNCTION IF EXISTS planorc_pj_atribui(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION planorc_pj_atribui(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, cc_id uuid, data date, documento text, historico text, lote text,
  valor numeric, status text, via text,
  filial_id uuid, matricula text, nome text, fornecedor_cod text, nome_fantasia text,
  -- empresa e filial DO LANÇAMENTO (filial_id acima é a da PESSOA)
  lanc_empresa_id uuid, lanc_filial_id uuid
)
LANGUAGE sql STABLE AS $$
  WITH ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  pess AS MATERIALIZED (
    SELECT ff.filial_id, ff.matricula, planorc_norm_txt(max(ff.nome)) AS nm, max(ff.nome) AS nome
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.matricula, '') <> ''
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  ),
  vinc AS MATERIALIZED (SELECT * FROM planorc_pj_vinculo(p_ano, p_mes)),
  fil AS MATERIALIZED (SELECT id, codigo FROM filial WHERE tenant_id = current_tenant_id()),
  lan AS (
    SELECT fr.conta_id, fr.cc_id, fr.data, fr.documento, fr.historico, fr.lote,
           fr.empresa_id AS l_emp, fr.filial_id AS l_fil,
           (-fr.valor)::numeric AS valor
      FROM fat_realizado fr JOIN ct ON ct.conta_id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
  ),
  -- MATERIALIZED: a CTE de referência única é inlinada, e planorc_pj_frag()
  -- passaria a rodar dentro do LATERAL, uma vez por par (lançamento × pessoa).
  dp AS MATERIALIZED (
    SELECT lan.*, m.status AS st, m.mat_folha AS dp_matf, m.filial_cod AS dp_fil,
           m.matricula AS dp_mat, m.nome AS dp_nome,
           m.fornecedor_cod AS forn, m.nome_fantasia AS fant,
           planorc_pj_frag(lan.historico) AS f
      FROM lan CROSS JOIN LATERAL planorc_pj_casa(lan.historico) m
  ),
  nd AS (
    SELECT dp.*, coalesce(n2.filial_id, n1.filial_id) AS nd_fil,
           coalesce(n2.matricula, n1.matricula)       AS nd_mat,
           coalesce(n2.nome, n1.nome)                 AS nd_nome
      FROM dp
      LEFT JOIN LATERAL (
        SELECT (array_agg(p.filial_id))[1] AS filial_id, (array_agg(p.matricula))[1] AS matricula,
               (array_agg(p.nome))[1] AS nome, count(*) AS n
          FROM pess p
         WHERE dp.st <> 'CASADO' AND length(coalesce(dp.f[2], '')) >= 5
           AND (p.nm LIKE dp.f[2] || '%' OR dp.f[2] LIKE p.nm || '%')
      ) n2 ON n2.n = 1
      LEFT JOIN LATERAL (
        SELECT (array_agg(p.filial_id))[1] AS filial_id, (array_agg(p.matricula))[1] AS matricula,
               (array_agg(p.nome))[1] AS nome, count(*) AS n
          FROM pess p
         WHERE dp.st <> 'CASADO' AND length(coalesce(dp.f[2], '')) < 5
           AND length(coalesce(dp.f[1], '')) >= 5
           AND (p.nm LIKE dp.f[1] || '%' OR dp.f[1] LIKE p.nm || '%')
      ) n1 ON n1.n = 1
  )
  SELECT x.conta_id, x.cc_id, x.data, x.documento, x.historico, x.lote, x.valor,
         CASE WHEN x.st = 'CASADO' OR x.nd_mat IS NOT NULL THEN 'CASADO' ELSE x.st END,
         CASE WHEN x.st = 'CASADO' THEN 'DEPARA' WHEN x.nd_mat IS NOT NULL THEN 'NOME' END,
         CASE WHEN x.st <> 'CASADO' THEN x.nd_fil
              WHEN x.dp_matf <> ''  THEN fl.id
              ELSE v.filial_id END,
         CASE WHEN x.st <> 'CASADO' THEN x.nd_mat
              WHEN x.dp_matf <> ''  THEN x.dp_matf
              ELSE v.matricula_folha END,
         coalesce(x.dp_nome, x.nd_nome), x.forn, coalesce(x.fant, x.f[1]),
         x.l_emp, x.l_fil
    FROM nd x
    LEFT JOIN fil fl ON x.st = 'CASADO' AND x.dp_matf <> '' AND fl.codigo = x.dp_fil
    LEFT JOIN vinc v ON x.st = 'CASADO' AND coalesce(x.dp_matf, '') = '' AND v.matricula = x.dp_mat
$$;

-- ── Os dois lados de uma pessoa, com empresa e filial ──
DROP FUNCTION IF EXISTS conciliacao_terceiros_pessoa(int, int, uuid, uuid, text, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_pessoa(
  p_ano int, p_mes int, p_relatorio_id uuid, p_filial_id uuid, p_matricula text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  lado text, empresa_cod text, filial_cod text, conta_cod text, conta_desc text,
  ref text, cc_cod text, data date, documento text, historico text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH contas_clt AS (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes))
  SELECT 'RAZÃO', e.codigo, fl.codigo, cc2.codigo, cc2.descricao, a.fornecedor_cod, ccu.codigo,
         a.data, a.documento, a.historico, a.valor
    FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
    JOIN conta_contabil cc2 ON cc2.id = a.conta_id
    LEFT JOIN empresa e  ON e.id  = a.lanc_empresa_id
    LEFT JOIN filial  fl ON fl.id = a.lanc_filial_id
    LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
   WHERE a.matricula = p_matricula AND a.filial_id IS NOT DISTINCT FROM p_filial_id

  UNION ALL
  SELECT 'FOLHA', max(e.codigo), max(fl.codigo), cc2.codigo, cc2.descricao,
         btrim(coalesce(ff.verba_cod, '')) || ' ' || coalesce(ff.verba_desc, ''), ccu.codigo,
         NULL::date, NULL::text, NULL::text, sum(ff.valor)::numeric
    FROM fat_folha ff
    JOIN conta_contabil cc2 ON cc2.id = ff.conta_id
    LEFT JOIN empresa e  ON e.id  = ff.empresa_id
    LEFT JOIN filial  fl ON fl.id = ff.filial_id
    LEFT JOIN centro_custo ccu ON ccu.id = ff.cc_id
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes
     AND ff.matricula = p_matricula AND ff.filial_id IS NOT DISTINCT FROM p_filial_id
     AND ff.conta_id NOT IN (SELECT conta_id FROM contas_clt)
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY cc2.codigo, cc2.descricao, btrim(coalesce(ff.verba_cod, '')), ff.verba_desc, ccu.codigo
   ORDER BY 1, 4, 11 DESC;
$$;

-- ── O resíduo sem dono, com empresa e filial ──
DROP FUNCTION IF EXISTS conciliacao_terceiros_outras(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros_outras(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, conta_cod text, conta_desc text, empresa_cod text, filial_cod text,
  data date, documento text, historico text, lote text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT cc2.id, cc2.codigo, cc2.descricao, e.codigo, fl.codigo,
         a.data, a.documento, a.historico, a.lote, ccu.codigo, a.valor
    FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
    JOIN conta_contabil cc2 ON cc2.id = a.conta_id
    LEFT JOIN empresa e  ON e.id  = a.lanc_empresa_id
    LEFT JOIN filial  fl ON fl.id = a.lanc_filial_id
    LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
   WHERE a.status <> 'CASADO'
   ORDER BY abs(a.valor) DESC;
$$;

-- ── E os "outros" de uma conta de CLT ──
DROP FUNCTION IF EXISTS conciliacao_clt_outros_lanc(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_clt_outros_lanc(
  p_ano int, p_mes int, p_conta uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  empresa_cod text, filial_cod text, data date, documento text, historico text,
  lote text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  )
  SELECT e.codigo, fl.codigo, fr.data, fr.documento, fr.historico, fr.lote, cc.codigo,
         (-fr.valor)::numeric
    FROM fat_realizado fr
    LEFT JOIN empresa e  ON e.id  = fr.empresa_id
    LEFT JOIN filial  fl ON fl.id = fr.filial_id
    LEFT JOIN centro_custo cc ON cc.id = fr.cc_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND fr.conta_id = p_conta
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   ORDER BY abs(fr.valor) DESC;
$$;

-- ── A granularidade é sempre empresa · filial · CC ──
-- Regra do cliente, e ela vale para a linha de PESSOA também, não só para o
-- lançamento: a mesma folha é rateada entre seis empresas e a mesma matrícula
-- se repete entre filiais. Dizer só o CC deixa a linha ambígua.
-- Quando a pessoa aparece em mais de uma empresa (o rateio normal), a coluna vem
-- vazia em vez de escolher uma — e a tela mostra "vários", que é a verdade.
DROP FUNCTION IF EXISTS conciliacao_terceiros(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_terceiros(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  status text, via text, filial_id uuid, filial_cod text, empresa_cod text,
  matricula text, nome text, fornecedor_cod text, nome_fantasia text, cc_cod text,
  lancamentos bigint, razao numeric, folha numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH contas_clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  atr AS MATERIALIZED (SELECT * FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs)),
  nf AS (
    SELECT a.status, min(a.via) AS via, a.filial_id, a.matricula,
           max(a.fornecedor_cod) AS fornecedor_cod,
           max(a.nome) AS nome, max(a.nome_fantasia) AS nome_fantasia,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           CASE WHEN count(DISTINCT e.codigo)  = 1 THEN max(e.codigo)  END AS empresa_cod,
           count(*)::bigint AS lancamentos, sum(a.valor)::numeric AS razao
      FROM atr a
      LEFT JOIN centro_custo cc ON cc.id = a.cc_id
      LEFT JOIN empresa e ON e.id = a.lanc_empresa_id
     GROUP BY a.status, a.filial_id, a.matricula,
              CASE WHEN a.status = 'CASADO' THEN '' ELSE coalesce(a.nome_fantasia, '') END
  ),
  fol AS (
    SELECT ff.filial_id, ff.matricula, max(ff.nome) AS nome,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           CASE WHEN count(DISTINCT e.codigo)  = 1 THEN max(e.codigo)  END AS empresa_cod,
           sum(ff.valor)::numeric AS folha
      FROM fat_folha ff
      LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
      LEFT JOIN empresa e ON e.id = ff.empresa_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc2
                    WHERE cc2.id = ff.conta_id AND cc2.natureza IN ('RECEITA', 'DESPESA'))
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
         coalesce(n.filial_id, f.filial_id),
         (SELECT fl.codigo FROM filial fl WHERE fl.id = coalesce(n.filial_id, f.filial_id)),
         coalesce(f.empresa_cod, n.empresa_cod),
         coalesce(n.matricula, f.matricula),
         coalesce(n.nome, f.nome), n.fornecedor_cod, n.nome_fantasia,
         coalesce(n.cc_cod, f.cc_cod), coalesce(n.lancamentos, 0),
         coalesce(n.razao, 0)::numeric, coalesce(f.folha, 0)::numeric
    FROM nf n
    FULL JOIN fol f ON n.status = 'CASADO'
                   AND f.matricula = n.matricula
                   AND f.filial_id IS NOT DISTINCT FROM n.filial_id
   ORDER BY 1, greatest(abs(coalesce(n.razao, 0)), abs(coalesce(f.folha, 0))) DESC;
$$;

-- ── A composição do CLT também: quem é quem, e onde ──
DROP FUNCTION IF EXISTS conciliacao_clt_pessoas(int, int, uuid, text, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_clt_pessoas(
  p_ano int, p_mes int, p_conta uuid, p_verba text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  matricula text, nome text, empresa_cod text, filial_cod text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT ff.matricula, max(ff.nome),
         CASE WHEN count(DISTINCT e.codigo)  = 1 THEN max(e.codigo)  END,
         max(fl.codigo),
         CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END,
         sum(ff.valor)::numeric
    FROM fat_folha ff
    LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
    LEFT JOIN empresa e  ON e.id  = ff.empresa_id
    LEFT JOIN filial  fl ON fl.id = ff.filial_id
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id = p_conta
     AND btrim(coalesce(ff.verba_cod, '')) = p_verba
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY ff.filial_id, ff.matricula
   ORDER BY 6 DESC;
$$;
