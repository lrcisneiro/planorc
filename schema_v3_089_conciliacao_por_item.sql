-- ============================================================
-- 089 — A conferência olha só contas de RESULTADO, e abre por item orçamentário
--
-- DUAS MUDANÇAS, com mecanismos independentes de propósito:
--
--   FILTRO       conta_contabil.natureza (v3_042). Só RECEITA e DESPESA entram
--                na conferência. É campo do cadastro, editável na tela de
--                Contas — não é o primeiro dígito do código chutado aqui
--                dentro. A pré-carga usa o dígito, mas quem manda é o campo.
--
--   AGRUPAMENTO  conta_linha → relatorio_linha, do relatório escolhido. É o
--                "item orçamentário" do DRE Gerencial: Salários e Ordenados,
--                Encargos e Benefícios, Terceiros Internos. O mesmo parâmetro
--                que já dizia quais contas são irmãs no lado da nota.
--
-- POR QUE AS PATRIMONIAIS SAEM: a conferência valida resultado. Em ago/2026 são
-- 12 contas e R$ 433.501,77 de provisão de férias, salários a pagar e
-- adiantamento — folha de verdade, mas que não passa pela DRE.
--
-- E POR QUE ELAS NÃO SOMEM DA VISTA: tirá-las quebraria a identidade "soma dos
-- blocos = universo" que a v3_088 provou. A provisão de férias É folha; se
-- desaparecer em silêncio, daqui a um mês ninguém acha. Então saem da
-- conferência e vão para um rodapé (conciliacao_patrimoniais), somadas e
-- expansíveis.
--
-- ⚠ O FILTRO VALE PARA OS DOIS BLOCOS AO MESMO TEMPO. Tirar a patrimonial só do
-- CLT faria a folha dela escorregar para o Terceiros e virar "prestador sem nota
-- fiscal" — que foi exatamente o erro da v3_085. A partição agora é tripla:
--   resultado + a folha lança débito   → bloco CLT, agrupado por item
--   resultado + a folha não lança      → bloco Terceiros, por pessoa
--   patrimonial                        → rodapé, fora da conferência
-- ============================================================

-- Conta criada depois da v3_042 (import de plano de contas) entra sem natureza.
-- Mesma regra da 042, só onde está nulo: quem já classificou à mão não perde.
UPDATE conta_contabil SET natureza = CASE left(codigo, 1)
    WHEN '1' THEN 'ATIVO' WHEN '2' THEN 'PASSIVO'
    WHEN '3' THEN 'RECEITA' WHEN '4' THEN 'DESPESA' ELSE 'TRANSITORIA' END
 WHERE natureza IS NULL;

CREATE INDEX IF NOT EXISTS ix_conta_contabil_natureza ON conta_contabil (tenant_id, natureza);

-- ── Conta de resultado: o que entra na conferência ──
-- Existe para dar nome à regra e para consulta avulsa. Nos caminhos quentes o
-- filtro é escrito como EXISTS na chave primária de conta_contabil: como função
-- num IN(...) o planejador a reavaliava e a conciliação passava de 1s para 7s.
CREATE OR REPLACE FUNCTION planorc_concil_resultado()
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT id FROM conta_contabil
   WHERE tenant_id = current_tenant_id() AND natureza IN ('RECEITA', 'DESPESA')
$$;

-- ── Conta de CLT: resultado + a contabilização da folha lança débito nela ──
CREATE OR REPLACE FUNCTION planorc_concil_contas_clt(p_ano int, p_mes int)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  -- a contabilização lança nos dois lados com o mesmo histórico; a folha
  -- analítica é o débito, e quem diz qual é o crédito é ela própria
  cred AS (
    SELECT DISTINCT ccred.id AS conta_id, btrim(coalesce(ff.verba_cod, '')) AS v
      FROM fat_folha ff
      JOIN conta_contabil cdeb  ON cdeb.id = ff.conta_id
      JOIN conta_contabil ccred ON ccred.tenant_id = cdeb.tenant_id
                               AND ccred.plano_id IS NOT DISTINCT FROM cdeb.plano_id
                               AND ccred.codigo = btrim(ff.conta_cred_cod)
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.conta_cred_cod, '') <> ''
  )
  SELECT DISTINCT fr.conta_id FROM fat_realizado fr
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND EXISTS (SELECT 1 FROM conta_contabil cc
                  WHERE cc.id = fr.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
     AND NOT EXISTS (SELECT 1 FROM cred
                      WHERE cred.conta_id = fr.conta_id
                        AND cred.v = btrim(split_part(coalesce(fr.historico, ''), '-', 1)))
$$;

-- ── O universo do terceiro: o complemento, também só resultado ──
CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH com_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes))
  ),
  cl AS (
    SELECT c.conta_id, c.linha_id FROM conta_linha c
      JOIN relatorio_linha rl ON rl.id = c.linha_id
     WHERE c.tenant_id = current_tenant_id() AND rl.relatorio_id = p_relatorio_id
  ),
  linhas AS (SELECT DISTINCT cl.linha_id FROM cl JOIN com_folha f ON f.conta_id = cl.conta_id)
  -- a irmã de DRE entra mesmo sem folha (é onde a nota cai), mas continua tendo
  -- de ser conta de resultado
  SELECT cl.conta_id FROM cl
   WHERE cl.linha_id IN (SELECT linha_id FROM linhas)
     AND EXISTS (SELECT 1 FROM conta_contabil cc
                  WHERE cc.id = cl.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
  UNION
  SELECT conta_id FROM com_folha
$$;

-- ── O item orçamentário de cada conta ──
-- Conta amarrada em duas linhas do mesmo relatório aparece UMA vez, na de menor
-- ordem. A tela avisa que há duplicidade — total contado duas vezes engana mais
-- do que ajuda, e o aviso manda arrumar a amarração.
CREATE OR REPLACE FUNCTION planorc_concil_item(p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid, linha_id uuid, linha_cod text, linha_desc text, linha_ordem int)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (c.conta_id) c.conta_id, rl.id, rl.codigo, rl.descricao, rl.ordem
    FROM conta_linha c JOIN relatorio_linha rl ON rl.id = c.linha_id
   WHERE c.tenant_id = current_tenant_id() AND rl.relatorio_id = p_relatorio_id
   ORDER BY c.conta_id, rl.ordem NULLS LAST, rl.codigo
$$;

-- ── CLT: item → conta → verba ──
-- as duas assinaturas: a antiga (v3_087) e a nova, para a migration poder ser
-- rodada de novo sem "function already exists"
DROP FUNCTION IF EXISTS conciliacao_clt(int, int, uuid[], uuid[], uuid[]);
DROP FUNCTION IF EXISTS conciliacao_clt(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_clt(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  linha_id uuid, linha_cod text, linha_desc text, linha_ordem int,
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
  contas_clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  item AS MATERIALIZED (SELECT * FROM planorc_concil_item(p_relatorio_id)),
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
       AND fr.conta_id IN (SELECT conta_id FROM contas_clt)
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
       AND NOT EXISTS (SELECT 1 FROM cred
                        WHERE cred.conta_id = fr.conta_id
                          AND cred.v = btrim(split_part(coalesce(fr.historico, ''), '-', 1)))
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  ),
  fo AS (
    SELECT ff.conta_id, btrim(coalesce(ff.verba_cod, '')) AS verba_cod,
           max(ff.verba_desc) AS verba_desc, sum(ff.valor)::numeric AS valor
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes
       AND ff.conta_id IN (SELECT conta_id FROM contas_clt)
       AND NOT EXISTS (SELECT 1 FROM cred
                        WHERE cred.conta_id = ff.conta_id
                          AND cred.v = btrim(coalesce(ff.verba_cod, '')))
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  )
  SELECT i.linha_id, i.linha_cod, i.linha_desc, i.linha_ordem,
         cc.id, cc.codigo, cc.descricao, pc.codigo,
         coalesce(r.verba_cod, f.verba_cod), f.verba_desc,
         coalesce(r.valor, 0)::numeric, coalesce(f.valor, 0)::numeric
    FROM rz r
    FULL JOIN fo f ON f.conta_id = r.conta_id AND f.verba_cod = r.verba_cod
    JOIN conta_contabil cc ON cc.id = coalesce(r.conta_id, f.conta_id)
    LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
    -- LEFT: conta de resultado sem amarração aparece num grupo próprio, em vez
    -- de sumir. É falha de cadastro, e falha de cadastro tem de doer à vista.
    LEFT JOIN item i ON i.conta_id = cc.id
   WHERE coalesce(r.valor, 0) <> 0 OR coalesce(f.valor, 0) <> 0
   ORDER BY i.linha_ordem NULLS LAST, i.linha_cod, cc.codigo, pc.codigo,
            coalesce(r.verba_cod, f.verba_cod);
$$;

-- ── A coluna "outros" segue a conta, e a conta segue o item ──
DROP FUNCTION IF EXISTS conciliacao_clt_outros(int, int, uuid[], uuid[], uuid[]);

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
  ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes))
  SELECT fr.conta_id, count(*)::bigint, sum(-fr.valor)::numeric
    FROM fat_realizado fr
   WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
     AND fr.conta_id IN (SELECT conta_id FROM ct)
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   GROUP BY 1
  HAVING sum(fr.valor) <> 0;
$$;

-- ── Terceiros: o mesmo filtro, para a folha não escorregar para cá ──
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
  WITH contas_clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
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
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
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

-- ── O rodapé: o que saiu da conferência, para não sumir ──
-- Provisão de férias, salários a pagar, adiantamento. É folha de verdade, só
-- não é resultado. Fica somado e expansível, e a identidade volta a fechar.
CREATE OR REPLACE FUNCTION conciliacao_patrimoniais(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_cod text, conta_desc text, natureza text, razao numeric, folha numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
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
  pat AS (
    SELECT id FROM conta_contabil
     WHERE tenant_id = current_tenant_id()
       AND coalesce(natureza, '') NOT IN ('RECEITA', 'DESPESA')
  ),
  rz AS (
    SELECT fr.conta_id, sum(-fr.valor)::numeric AS valor
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND fr.conta_id IN (SELECT id FROM pat)
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
       AND NOT EXISTS (SELECT 1 FROM cred
                        WHERE cred.conta_id = fr.conta_id
                          AND cred.v = btrim(split_part(coalesce(fr.historico, ''), '-', 1)))
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1
  ),
  fo AS (
    SELECT ff.conta_id, sum(ff.valor)::numeric AS valor
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes
       AND ff.conta_id IN (SELECT id FROM pat)
       AND NOT EXISTS (SELECT 1 FROM cred
                        WHERE cred.conta_id = ff.conta_id
                          AND cred.v = btrim(coalesce(ff.verba_cod, '')))
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1
  )
  SELECT cc.codigo, cc.descricao, cc.natureza,
         coalesce(r.valor, 0)::numeric, coalesce(f.valor, 0)::numeric
    FROM rz r
    FULL JOIN fo f ON f.conta_id = r.conta_id
    JOIN conta_contabil cc ON cc.id = coalesce(r.conta_id, f.conta_id)
   ORDER BY abs(coalesce(f.valor, 0)) + abs(coalesce(r.valor, 0)) DESC;
$$;
