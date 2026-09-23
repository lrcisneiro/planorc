-- ============================================================
-- 088 — A coluna "outros" volta para o lado da conta de CLT
--
-- Conta de benefício (assistência médica, seguro de vida, vale) recebe
-- lançamento do FINANCEIRO, não da contabilização da folha: a fatura do
-- convênio chega por contas a pagar. Isso não é divergência da folha e nunca vai
-- bater com ela — mas tem de ser visto, e visto AO LADO DA CONTA, que é onde a
-- pergunta nasce ("por que esta conta tem mais razão do que folha?").
--
-- A v3_085 mandou esse dinheiro para o bloco global de resíduo, junto com a nota
-- fiscal sem dono. Tecnicamente não sumia; na prática sumia, porque quem olha a
-- conta de benefício não vai procurar a explicação dela numa lista de 495
-- lançamentos lá embaixo. A versão anterior à v3_085 tinha isso certo: cada
-- conta com a sua coluna "outras origens".
--
-- Agora cada lado cuida do seu:
--   conta de CLT        → coluna "outros" na própria linha, com drill e
--                         justificativa (conciliacao_clt_outros)
--   conta de terceiro   → bloco "Outros lançamentos", que volta a ser só o que
--                         é nota fiscal sem dono
-- A cobertura continua total: toda conta que a folha usa ou é conta de CLT (e
-- cai na coluna) ou é conta de terceiro (e cai no bloco). Nada fica sem casa —
-- foi exatamente o que a v3_085 quebrou duas vezes.
-- ============================================================

-- ── A atribuição volta ao universo estreito ──
-- Procurar dono só faz sentido em conta de terceiro, e agora o resíduo do CLT
-- tem casa própria: não há mais razão para olhar conta de CLT aqui.
CREATE OR REPLACE FUNCTION planorc_pj_atribui(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, cc_id uuid, data date, documento text, historico text, lote text,
  valor numeric, status text, via text,
  filial_id uuid, matricula text, nome text, fornecedor_cod text, nome_fantasia text
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
      -- f[1] é o FORNECEDOR: só vale quando não há participante, senão a
      -- cooperativa engole todo mundo
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
         coalesce(x.dp_nome, x.nd_nome), x.forn, coalesce(x.fant, x.f[1])
    FROM nd x
    LEFT JOIN fil fl ON x.st = 'CASADO' AND x.dp_matf <> '' AND fl.codigo = x.dp_fil
    LEFT JOIN vinc v ON x.st = 'CASADO' AND coalesce(x.dp_matf, '') = '' AND v.matricula = x.dp_mat
$$;

-- ── "Outros" de cada conta de CLT ──
-- Razão que entrou numa conta de CLT sem vir da contabilização da folha: fatura
-- do convênio, encargo lançado à mão, ajuste, estorno. Não é divergência da
-- folha e não deve entrar na diferença dela — é coluna separada, como era antes.
CREATE OR REPLACE FUNCTION conciliacao_clt_outros(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (conta_id uuid, lancamentos bigint, valor numeric)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  -- só conta que a folha de fato usa: a contrapartida de passivo recebe
  -- pagamento e movimento de caixa, que não é assunto desta tela
  contas AS (
    SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)
    INTERSECT
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
  )
  SELECT fr.conta_id, count(*)::bigint, sum(-fr.valor)::numeric
    FROM fat_realizado fr
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND fr.conta_id IN (SELECT conta_id FROM contas)
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   GROUP BY 1
  HAVING sum(fr.valor) <> 0;
$$;

CREATE OR REPLACE FUNCTION conciliacao_clt_outros_lanc(
  p_ano int, p_mes int, p_conta uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  data date, documento text, historico text, lote text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  )
  SELECT fr.data, fr.documento, fr.historico, fr.lote, cc.codigo, (-fr.valor)::numeric
    FROM fat_realizado fr LEFT JOIN centro_custo cc ON cc.id = fr.cc_id
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND fr.conta_id = p_conta
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   ORDER BY abs(fr.valor) DESC;
$$;
