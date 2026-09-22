-- ============================================================
-- 084 — PJ conciliando como o CLT: folha × razão, com a lista de quem diverge
--
-- O QUE ESTAVA ERRADO: o PJ não é contabilizado pela folha, mas PASSA por ela —
-- é calculado lá, vira pedido de compra, casa com a NF e só então é lançado. A
-- folha analítica tem o valor por pessoa; o razão tem o mesmo valor, por NF.
-- São os dois lados de uma conciliação, e a v3_080 tratava só um: jogava o razão
-- de NF inteiro em "outras origens" e comparava a folha do PJ contra ZERO.
-- Na conta 41021001 de ago/2026 isso acusava três verbas "fora" por R$ 158 mil
-- pedindo justificativa, enquanto a contrapartida estava na linha de baixo.
--
-- O QUE MUDA: o razão da conta passa a ter TRÊS parcelas, cada uma com o seu par:
--   FOLHA   contabilização da folha × folha das verbas que ela lança   — por verba
--   PJ      nota fiscal com dono    × folha das verbas que ela NÃO lança — por pessoa
--   OUTRAS  razão sem dono          × (nada)                            — justificativa
--
-- COMO SE SABE QUE UMA VERBA É PJ: pela própria contabilização. Se nenhum
-- lançamento do razão daquela conta começa com o código da verba, aquela verba
-- não foi lançada pela folha — logo seu dinheiro chegou por outra estrada. A
-- regra se calibra sozinha, mês a mês, e não depende de cadastro nenhum.
--
-- ⚠ O ELO COM A PESSOA É FRÁGIL — ver planorc_pj_vinculo(). O código do
-- participante (RD0) NÃO é a matrícula da folha: a mesma pessoa é 000212 no RD0
-- e 900031 no SRA. E a matrícula sozinha nem identifica alguém — 112 das 168
-- matrículas de ago/2026 existem em mais de uma empresa. Por isso a pessoa aqui
-- é sempre o par (empresa, matrícula), e enquanto o export não trouxer a
-- matrícula da folha o vínculo é por nome e cobre só parte. A coluna
-- matricula_folha existe para receber a resposta certa sem mexer em mais nada.
-- ============================================================

-- Rede de segurança: a primeira versão da v3_083 criou a chave única por
-- EXPRESSÃO (coalesce), que o upsert do PostgREST não enxerga. Quem aplicou
-- aquela versão tem a tabela no formato antigo e a reimportação do de-para
-- falharia com duplicado. Normalizar aqui é barato e não faz nada se já está certo.
UPDATE posto_fornecedor SET empresa_cod = coalesce(empresa_cod, ''), fornecedor_loja = coalesce(fornecedor_loja, '')
 WHERE empresa_cod IS NULL OR fornecedor_loja IS NULL;
ALTER TABLE posto_fornecedor ALTER COLUMN empresa_cod     SET DEFAULT '',
                             ALTER COLUMN empresa_cod     SET NOT NULL,
                             ALTER COLUMN fornecedor_loja SET DEFAULT '',
                             ALTER COLUMN fornecedor_loja SET NOT NULL;
DROP INDEX IF EXISTS uq_posto_fornecedor;
CREATE UNIQUE INDEX IF NOT EXISTS uq_posto_fornecedor
  ON posto_fornecedor (tenant_id, empresa_cod, matricula, fornecedor_cod, fornecedor_loja);

-- A matrícula da folha (SRA), quando o ERP puder exportá-la: é o único elo
-- confiável entre o participante do RD0 e a pessoa da folha.
ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS matricula_folha text;
CREATE INDEX IF NOT EXISTS ix_posto_fornecedor_matf ON posto_fornecedor (tenant_id, matricula_folha);

-- ── Participante do de-para → pessoa da folha ──
-- Duas fontes, nesta ordem:
--   1. matricula_folha preenchida — autoritativa, veio do ERP
--   2. nome por prefixo — o RD0 trunca em 30 caracteres e a folha em outro
--      tamanho, daí a comparação nos dois sentidos
-- O fallback só aceita vínculo ÚNICO NOS DOIS SENTIDOS: um participante que
-- alcança duas pessoas, ou uma pessoa reivindicada por dois participantes, fica
-- de fora. Errar o dono é pior do que deixar sem dono — o valor aparece como
-- divergência e alguém olha, em vez de somar na conta de quem não é.
CREATE OR REPLACE FUNCTION planorc_pj_vinculo(p_ano int, p_mes int)
RETURNS TABLE (matricula text, empresa_id uuid, matricula_folha text)
LANGUAGE sql STABLE AS $$
  WITH pf AS (
    SELECT * FROM posto_fornecedor
     WHERE tenant_id = current_tenant_id() AND ativo
       AND (ini_ano IS NULL OR (p_ano * 100 + p_mes) >= (ini_ano * 100 + coalesce(ini_mes, 1)))
       AND (fim_ano IS NULL OR (p_ano * 100 + p_mes) <= (fim_ano * 100 + coalesce(fim_mes, 12)))
  ),
  -- a pessoa da folha é o par (empresa, matrícula): a matrícula sozinha repete
  pess AS (
    SELECT ff.empresa_id, ff.matricula, planorc_norm_txt(max(ff.nome)) AS nm
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.matricula, '') <> ''
     GROUP BY 1, 2
  ),
  cand AS (
    -- 1. matricula_folha preenchida: autoritativa
    SELECT pf.matricula, p.empresa_id, p.matricula AS matricula_folha, 1 AS fonte
      FROM pf JOIN pess p ON p.matricula = pf.matricula_folha
     WHERE coalesce(pf.matricula_folha, '') <> ''
     GROUP BY 1, 2, 3
    UNION ALL
    -- 2. nome por prefixo, para quem não tem a coluna preenchida
    SELECT pf.matricula, p.empresa_id, p.matricula, 2
      FROM pf JOIN pess p
        ON pf.nome_norm <> '' AND (pf.nome_norm LIKE p.nm || '%' OR p.nm LIKE pf.nome_norm || '%')
     WHERE coalesce(pf.matricula_folha, '') = ''
     GROUP BY 1, 2, 3
  ),
  -- um para um nos DOIS sentidos: participante que alcança duas pessoas, ou
  -- pessoa reivindicada por dois participantes, fica de fora. Errar o dono é
  -- pior do que deixar sem dono — sem dono vira divergência e alguém olha.
  um_para_um AS (
    SELECT c.matricula, c.empresa_id, c.matricula_folha FROM cand c
     WHERE (SELECT count(*) FROM cand x WHERE x.matricula = c.matricula) = 1
       AND (SELECT count(*) FROM cand y
             WHERE y.matricula_folha = c.matricula_folha
               AND y.empresa_id IS NOT DISTINCT FROM c.empresa_id) = 1
  )
  SELECT matricula, empresa_id, matricula_folha FROM um_para_um
$$;

-- ── Nível 1: a conta, nas três parcelas ──
CREATE OR REPLACE FUNCTION conciliacao_folha_contabil(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL,
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id   uuid,
  conta_cod  text,
  conta_desc text,
  plano_cod  text,
  verba_cod  text,
  verba_desc text,
  origem     text,
  razao      numeric,
  folha      numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH fo AS (
    SELECT ff.conta_id,
           btrim(coalesce(ff.verba_cod, '')) AS verba_cod,
           max(ff.verba_desc)                AS verba_desc,
           sum(ff.valor)::numeric            AS valor
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id()
       AND ff.tipo = 'REALIZADO' AND ff.ano = p_ano AND ff.mes = p_mes
       AND ff.conta_id IS NOT NULL
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  ),
  verbas AS (SELECT DISTINCT verba_cod FROM fo WHERE verba_cod <> ''),
  rz AS (
    SELECT fr.conta_id, fr.historico,
           coalesce(v.verba_cod, '')  AS verba_cod,
           (v.verba_cod IS NOT NULL)  AS eh_folha,
           (-fr.valor)::numeric       AS valor
      FROM fat_realizado fr
      LEFT JOIN verbas v
             ON v.verba_cod = btrim(split_part(coalesce(fr.historico, ''), '-', 1))
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes
       AND fr.conta_id IN (SELECT DISTINCT conta_id FROM fo)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
  ),
  rz_folha AS (SELECT conta_id, verba_cod, sum(valor)::numeric AS valor FROM rz WHERE eh_folha GROUP BY 1, 2),
  -- a NF com dono vira a parcela PJ; sem dono, continua resíduo a justificar
  rz_nf AS (
    SELECT rz.conta_id, (m.status = 'CASADO') AS com_dono, sum(rz.valor)::numeric AS valor
      FROM rz CROSS JOIN LATERAL planorc_pj_casa(rz.historico) m
     WHERE NOT rz.eh_folha
     GROUP BY 1, 2
  ),
  juntos AS (
    -- 1. CLT: só as verbas que a contabilização da folha de fato lança nesta conta
    SELECT coalesce(f.conta_id, r.conta_id)   AS conta_id,
           coalesce(f.verba_cod, r.verba_cod) AS verba_cod,
           f.verba_desc                       AS verba_desc,
           'FOLHA'::text                      AS origem,
           coalesce(r.valor, 0)::numeric      AS razao,
           coalesce(f.valor, 0)::numeric      AS folha
      FROM rz_folha r
      FULL JOIN fo f ON f.conta_id = r.conta_id AND f.verba_cod = r.verba_cod
     WHERE r.conta_id IS NOT NULL      -- verba sem razão nenhuma não é lançada pela folha: cai no PJ

    UNION ALL
    -- 2. PJ: o resto da folha da conta contra a NF com dono (detalhe por pessoa)
    SELECT coalesce(n.conta_id, p.conta_id), NULL::text, NULL::text, 'PJ'::text,
           coalesce(n.valor, 0)::numeric, coalesce(p.valor, 0)::numeric
      FROM (SELECT conta_id, sum(valor)::numeric AS valor FROM rz_nf WHERE com_dono GROUP BY 1) n
      FULL JOIN (
        SELECT f.conta_id, sum(f.valor)::numeric AS valor
          FROM fo f
         WHERE NOT EXISTS (SELECT 1 FROM rz_folha r WHERE r.conta_id = f.conta_id AND r.verba_cod = f.verba_cod)
         GROUP BY 1
      ) p ON p.conta_id = n.conta_id
     WHERE coalesce(n.valor, 0) <> 0 OR coalesce(p.valor, 0) <> 0

    UNION ALL
    -- 3. o que não veio da folha nem casou com pessoa
    SELECT conta_id, NULL::text, NULL::text, 'OUTRAS'::text, sum(valor)::numeric, 0::numeric
      FROM rz_nf WHERE NOT com_dono GROUP BY conta_id HAVING sum(valor) <> 0
  )
  SELECT j.conta_id, cc.codigo, cc.descricao, pc.codigo,
         nullif(j.verba_cod, ''), j.verba_desc,
         j.origem, j.razao, j.folha
    FROM juntos j
    JOIN conta_contabil cc ON cc.id = j.conta_id
    LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
   ORDER BY cc.codigo, pc.codigo, j.origem DESC, j.verba_cod NULLS FIRST;
$$;

-- ── Nível 2 do PJ: pessoa a pessoa, folha × NF ──
-- Cinco respostas, e as quatro últimas são a lista que o gestor precisa ver:
--   CASADO      a NF tem dono e o dono tem folha — compare os dois valores
--   SEM_NF      a folha calculou e nenhuma NF chegou (nota atrasada, pedido não faturado)
--   SEM_FOLHA   a NF tem dono, mas o dono não tem folha nesta conta neste mês
--   AMBIGUO     o histórico casou com mais de um fornecedor
--   SEM_DEPARA  a NF não casou com ninguém — falta amarração
DROP FUNCTION IF EXISTS conciliacao_pj_detalhe(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_pj_detalhe(
  p_ano int, p_mes int, p_conta uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  status text, matricula text, nome text, fornecedor_cod text, nome_fantasia text,
  cc_cod text, lancamentos bigint, razao numeric, folha numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH vinc AS (SELECT * FROM planorc_pj_vinculo(p_ano, p_mes)),
  verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  lan AS (
    SELECT fr.historico, fr.cc_id, -fr.valor AS v
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes AND fr.conta_id = p_conta
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
  ),
  -- as verbas desta conta que a contabilização da folha NÃO lança: a folha do PJ
  verbas_rz AS (
    SELECT DISTINCT btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS v
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes AND fr.conta_id = p_conta
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
  ),
  nf AS (
    SELECT m.status, m.matricula, m.nome, m.fornecedor_cod, m.nome_fantasia, cc.codigo AS cc_cod, lan.v
      FROM lan
      CROSS JOIN LATERAL planorc_pj_casa(lan.historico) m
      LEFT JOIN centro_custo cc ON cc.id = lan.cc_id
  ),
  nf_ag AS (
    -- casado agrupa por pessoa; o resto agrupa pelo texto que o histórico trouxe
    -- e não casou — é justamente o que se procura no ERP para criar a amarração
    SELECT status,
           max(matricula) AS matricula, max(nome) AS nome, max(fornecedor_cod) AS fornecedor_cod,
           max(nome_fantasia) AS nome_fantasia,
           CASE WHEN count(DISTINCT cc_cod) = 1 THEN max(cc_cod) END AS cc_cod,
           count(*)::bigint AS lancamentos, sum(v)::numeric AS razao,
           (SELECT vi.empresa_id      FROM vinc vi WHERE vi.matricula = max(nf.matricula)) AS mat_emp,
           (SELECT vi.matricula_folha FROM vinc vi WHERE vi.matricula = max(nf.matricula)) AS mat_folha
      FROM nf
     GROUP BY status, CASE WHEN status = 'CASADO' THEN 'm:' || matricula ELSE 'f:' || coalesce(nome_fantasia, '') END
  ),
  fol AS (
    SELECT ff.empresa_id, ff.matricula, max(ff.nome) AS nome,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           sum(ff.valor)::numeric AS folha
      FROM fat_folha ff
      LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id = p_conta
       AND btrim(coalesce(ff.verba_cod, '')) NOT IN (SELECT v FROM verbas_rz)
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY ff.empresa_id, ff.matricula
  )
  SELECT CASE WHEN n.status IS NULL                      THEN 'SEM_NF'
              WHEN n.status = 'CASADO' AND f.matricula IS NULL THEN 'SEM_FOLHA'
              ELSE n.status END,
         -- a matrícula da folha é a que a área reconhece; o código do
         -- participante só aparece quando o vínculo com a folha não existe
         coalesce(f.matricula, n.mat_folha, n.matricula),
         coalesce(n.nome, f.nome),
         n.fornecedor_cod, n.nome_fantasia,
         coalesce(n.cc_cod, f.cc_cod),
         coalesce(n.lancamentos, 0),
         coalesce(n.razao, 0)::numeric, coalesce(f.folha, 0)::numeric
    FROM nf_ag n
    -- o ON carrega o status: só CASADO tem vínculo com a folha, e quem está só
    -- de um lado atravessa o join intacto
    FULL JOIN fol f ON n.status = 'CASADO'
                   AND f.matricula = n.mat_folha
                   AND f.empresa_id IS NOT DISTINCT FROM n.mat_emp
   ORDER BY 1, greatest(abs(coalesce(n.razao, 0)), abs(coalesce(f.folha, 0))) DESC;
$$;

-- ── Nível 2 do resíduo: só o que NÃO tem dono ──
-- Com o de-para carregado, a NF atribuída migrou para a parcela PJ; deixá-la
-- aqui também mostraria o mesmo dinheiro duas vezes. Sem de-para, nada casa e a
-- lista continua sendo a de antes.
CREATE OR REPLACE FUNCTION conciliacao_folha_outras(
  p_ano int, p_mes int, p_conta uuid,
  p_empresas uuid[] DEFAULT NULL,
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE (
  data date, documento text, historico text, lote text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS verba_cod
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id()
       AND ff.tipo = 'REALIZADO' AND ff.ano = p_ano AND ff.mes = p_mes
       AND btrim(coalesce(ff.verba_cod, '')) <> ''
  )
  SELECT fr.data, fr.documento, fr.historico, fr.lote, cc.codigo, (-fr.valor)::numeric
    FROM fat_realizado fr
    LEFT JOIN centro_custo cc ON cc.id = fr.cc_id
    CROSS JOIN LATERAL planorc_pj_casa(fr.historico) m
   WHERE fr.tenant_id = current_tenant_id()
     AND fr.ano = p_ano AND fr.mes = p_mes AND fr.conta_id = p_conta
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT verba_cod FROM verbas)
     AND m.status <> 'CASADO'
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   ORDER BY abs(fr.valor) DESC;
$$;
