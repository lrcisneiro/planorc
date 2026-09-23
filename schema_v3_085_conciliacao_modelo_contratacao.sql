-- ============================================================
-- 085 — Conciliação por MODELO DE CONTRATAÇÃO
--
-- O primeiro nível deixa de ser a conta contábil e passa a ser como a pessoa é
-- contratada, porque é isso que decide por onde o dinheiro dela chega à
-- contabilidade — e, portanto, como ela concilia:
--
--   CLT        a folha contabiliza. O razão vem CONSOLIDADO por conta × verba ×
--              CC: o histórico é "001- VLR.REF.SALARIO- 8/2026", sem nome nem
--              matrícula (233 lançamentos para 108 pessoas em ago/2026).
--              Concilia por conta → verba; abaixo disso é composição da folha.
--
--   TERCEIROS  a folha calcula, vira pedido de compra e chega como NOTA FISCAL.
--              Nota tem dono, então concilia POR PESSOA → conta → lançamento.
--
-- POR QUE A PESSOA, E NÃO A CONTA, NO TERCEIRO: a nota não respeita a fronteira
-- da conta. A folha diz onde ELA lançaria (41021001 PRESTADORES DE SERVICOS
-- INTERNO); o razão vem do pedido de compra e usa a conta do fornecedor
-- (41021002 PRESTADORES SERVICOS COOPERADOS). Conciliando por conta, GILBERTO
-- JULIO MARTINOSSO aparecia com R$ 34.263,80 de folha numa conta, R$ 33.347,98
-- de nota na outra, e era acusado de "sem NF". Por pessoa, ele fecha.
--
-- O QUE SEPARA UM DO OUTRO: a própria contabilização. Lançamento cujo histórico
-- começa com código de verba da competência veio da folha (CLT); o resto é nota
-- (terceiro). A regra se calibra sozinha, mês a mês, sem cadastro.
--
-- POR QUE NÃO PELO ITEM ORÇAMENTÁRIO: os dois lados falam línguas diferentes. O
-- razão só conhece conta contábil (→ conta_linha → relatorio_linha); a folha
-- traz conta_orcamentaria em item_orc_id. Não existe item orçamentário no razão.
--
-- PARA QUE SERVE O RELATÓRIO AQUI: só para dizer QUAIS CONTAS olhar no lado da
-- nota. A folha aponta 41021001; a nota está na 41021002, que ficaria de fora.
-- A amarração conta→linha que o cliente mantém em /amarracao já diz que as duas
-- são a mesma coisa ("Terceiros Internos"), então o universo do terceiro é: as
-- contas das linhas que têm folha. Hoje há uma DRE só, mas p_relatorio_id evita
-- que a conciliação fique presa a uma DRE implícita.
-- Conta com folha que não esteja amarrada em linha nenhuma entra assim mesmo —
-- some silenciosamente é pior que aparecer sozinha.
-- ============================================================

-- ── O participante manda, não o fornecedor ──
-- A v3_083 tentava fornecedor→fantasia PRIMEIRO. Com cooperativa isso erra
-- feio: "INC NF NOVA COOPERATIVA-<alguém>" casa "NOVA COOPERATIVA" com a ÚNICA
-- linha do de-para que tem essa fantasia, e as 207 notas da cooperativa inteira
-- — R$ 977 mil — caem todas no colo de uma pessoa só. Único não é o mesmo que
-- certo.
--
-- Quando o histórico traz participante (o pedaço depois do "-"), é ele quem
-- decide, e o fornecedor nem é consultado: se o participante não resolve, a nota
-- fica sem dono e alguém olha. O fornecedor só manda quando não há participante
-- — "SERVICOS PRESTADOS INC CP RBKS TECNOLOGI", em que o prestador é a empresa.
--
-- O participante é procurado no NOME e também no NOME FANTASIA, porque o de-para
-- da cooperativa guarda em fantasia o nome que vem depois do nome dela — os
-- cooperados dividem o mesmo fornecedor, e é a fantasia que os distingue.
DROP FUNCTION IF EXISTS planorc_pj_casa(text);

CREATE FUNCTION planorc_pj_casa(p_hist text)
RETURNS TABLE (matricula text, nome text, fornecedor_cod text, fornecedor_loja text, nome_fantasia text, status text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f text[]; v_par text; v_frag text; v_alvo text; n int; v_amb boolean := false;
  v_tem_participante boolean;
BEGIN
  f := planorc_pj_frag(p_hist);
  v_tem_participante := length(coalesce(f[2], '')) >= 5;
  FOREACH v_par IN ARRAY CASE WHEN v_tem_participante
                              THEN ARRAY['2n', '2f']        -- só o participante
                              ELSE ARRAY['1f', '1n'] END LOOP
    v_frag := f[substr(v_par, 1, 1)::int];
    v_alvo := substr(v_par, 2, 1);
    CONTINUE WHEN v_frag IS NULL OR length(v_frag) < 5;
    -- unicidade da PESSOA, não do fornecedor. Numa cooperativa os participantes
    -- COMPARTILHAM o mesmo fornecedor: contar fornecedor daria 1 mesmo com dois
    -- candidatos, e o LIMIT 1 escolheria um deles no escuro. É a mesma armadilha
    -- que jogou 207 notas no colo de uma pessoa só, um nível abaixo.
    SELECT count(DISTINCT coalesce(pf.empresa_cod, '') || '|' || pf.matricula) INTO n
      FROM posto_fornecedor pf
     WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
       AND ((v_alvo = 'f' AND (pf.fant_norm LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%') AND pf.fant_norm <> '')
         OR (v_alvo = 'n' AND (pf.nome_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%') AND pf.nome_norm <> ''));
    IF n = 1 THEN
      SELECT pf.matricula, pf.nome, pf.fornecedor_cod, pf.fornecedor_loja, pf.nome_fantasia, 'CASADO'
        INTO matricula, nome, fornecedor_cod, fornecedor_loja, nome_fantasia, status
        FROM posto_fornecedor pf
       WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
         AND ((v_alvo = 'f' AND (pf.fant_norm LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%') AND pf.fant_norm <> '')
           OR (v_alvo = 'n' AND (pf.nome_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%') AND pf.nome_norm <> ''))
       LIMIT 1;
      RETURN NEXT; RETURN;
    ELSIF n > 1 THEN
      v_amb := true;
    END IF;
  END LOOP;
  matricula := NULL; nome := NULL; fornecedor_cod := NULL; fornecedor_loja := NULL;
  -- o texto devolvido é o que precisa ser procurado no ERP: o participante
  -- quando existe, senão o fornecedor
  nome_fantasia := CASE WHEN v_tem_participante THEN f[2] ELSE coalesce(f[1], '') END;
  status := CASE WHEN v_amb THEN 'AMBIGUO' ELSE 'SEM_DEPARA' END;
  RETURN NEXT;
END $$;

DROP FUNCTION IF EXISTS conciliacao_folha_contabil(int, int, uuid[], uuid[], uuid[]);
DROP FUNCTION IF EXISTS conciliacao_pj_detalhe(int, int, uuid, uuid[], uuid[], uuid[]);
DROP FUNCTION IF EXISTS conciliacao_folha_outras(int, int, uuid, uuid[], uuid[], uuid[]);

-- ── O universo do terceiro: contas irmãs na DRE ──
-- Sem sinal: a conciliação compara razão com folha, e inverter os dois juntos
-- não muda a diferença. O sinal é assunto da DRE, não daqui — e uma conta
-- amarrada em duas linhas com sinais diferentes não precisa virar problema.
CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
  ),
  clt AS (
    SELECT DISTINCT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS v
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
  ),
  -- a semente é a folha de TERCEIRO, não a folha toda: conta onde tudo o que a
  -- folha tem já é lançado por ela é CLT puro, e arrastar as irmãs de DRE dela
  -- para cá encheria o resíduo de lançamento que nada tem a ver com folha.
  com_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM clt
                        WHERE clt.conta_id = ff.conta_id
                          AND clt.v = btrim(coalesce(ff.verba_cod, '')))
  ),
  cl AS (
    SELECT c.conta_id, c.linha_id FROM conta_linha c
      JOIN relatorio_linha rl ON rl.id = c.linha_id
     WHERE c.tenant_id = current_tenant_id() AND rl.relatorio_id = p_relatorio_id
  ),
  linhas AS (SELECT DISTINCT cl.linha_id FROM cl JOIN com_folha f ON f.conta_id = cl.conta_id)
  SELECT conta_id FROM cl WHERE linha_id IN (SELECT linha_id FROM linhas)
  UNION
  SELECT conta_id FROM com_folha
$$;

-- ── O universo do RESÍDUO é maior que o do terceiro, e de propósito ──
-- Toda conta que a folha usa entra aqui, mesmo sendo CLT puro: lançamento
-- direto na contabilidade, que não passou pela folha, tem de aparecer. Foram
-- R$ 481.542,27 em 382 lançamentos de ago/2026 — encargo lançado à mão, ajuste,
-- estorno. Some do CLT (não veio da folha) e some do terceiro (a conta não é de
-- terceiro): sem este universo, desaparecia dos dois e a tela mentia dizendo
-- "100% conciliado".
-- O que NÃO se faz aqui é procurar dono: em conta de CLT, casar um histórico
-- com uma pessoa misturaria os dois modelos. Essas linhas ficam sem dono por
-- construção, e a saída delas é a justificativa escrita.
CREATE OR REPLACE FUNCTION planorc_concil_contas_residuo(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)
  UNION
  SELECT DISTINCT ff.conta_id FROM fat_folha ff
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
$$;

-- ── A atribuição da nota fiscal a uma pessoa ──
-- Peça única: as quatro consultas abaixo precisam da MESMA resposta sobre quem é
-- o dono de cada lançamento, senão o dinheiro aparece duas vezes ou some entre
-- um nível e outro.
--
-- Três caminhos, nesta ordem:
--   1. de-para (posto_fornecedor): o fornecedor do histórico tem participante, e
--      o participante tem pessoa na folha (planorc_pj_vinculo)
--   2. nome direto: o histórico traz o nome de alguém que tem folha no mês. É o
--      caso da COOPERATIVA — "INC NF SOMA COOPERATIVA-GILBERTO JULIO M" — em que
--      o fornecedor é a cooperativa e o cooperado NUNCA terá linha no de-para,
--      porque o join RD0×SA2 só encontra quem tem fornecedor próprio. Vale 12%
--      do terceiro de ago/2026 (R$ 430 mil) e não custa cadastro nenhum.
--   3. sem dono: vai para a justificativa escrita.
-- Só vale correspondência ÚNICA: dois candidatos viram nenhum. Errar o dono é
-- pior do que deixar sem dono — sem dono vira divergência e alguém olha.
CREATE OR REPLACE FUNCTION planorc_pj_atribui(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, cc_id uuid, data date, documento text, historico text, lote text,
  valor numeric, status text, via text,
  filial_id uuid, matricula text, nome text, fornecedor_cod text, nome_fantasia text
)
LANGUAGE sql STABLE AS $$
  -- ct  = onde se PROCURA dono (conta de terceiro e suas irmãs de DRE)
  -- ctr = o que se OLHA (tudo o que a folha toca) — ver planorc_concil_contas_residuo
  WITH ct AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  ctr AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_residuo(p_ano, p_mes, p_relatorio_id)),
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
  -- MATERIALIZED é obrigatório aqui: CTE de referência única o Postgres inlina,
  -- e a função passa a rodar UMA VEZ POR LANÇAMENTO (27s contra 1s medidos).
  vinc AS MATERIALIZED (SELECT * FROM planorc_pj_vinculo(p_ano, p_mes)),
  lan AS (
    SELECT fr.conta_id, fr.cc_id, fr.data, fr.documento, fr.historico, fr.lote,
           (-fr.valor)::numeric AS valor
      FROM fat_realizado fr JOIN ctr ON ctr.conta_id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT v FROM verbas)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
  ),
  -- MATERIALIZED de novo, e por um motivo caro: a CTE de referência única é
  -- inlinada, e planorc_pj_frag() passa a ser recalculada DENTRO do LATERAL, uma
  -- vez por par (lançamento × pessoa). São 393 mil chamadas de regex — 20s
  -- contra 0,7s. O fragmento tem de ser calculado uma vez por lançamento.
  dp AS MATERIALIZED (
    -- o LEFT JOIN só dispara nas contas de terceiro: fora delas a linha
    -- atravessa sem dono, que é o comportamento certo para "outros"
    SELECT lan.*, (lan.conta_id IN (SELECT conta_id FROM ct)) AS pode,
           m.status AS st, m.matricula AS dp_mat, m.nome AS dp_nome,
           m.fornecedor_cod AS forn, m.nome_fantasia AS fant,
           planorc_pj_frag(lan.historico) AS f
      FROM lan
      LEFT JOIN LATERAL planorc_pj_casa(lan.historico) m
             ON lan.conta_id IN (SELECT conta_id FROM ct)
  ),
  -- o fallback tenta o segundo fragmento (o participante) e depois o primeiro
  nd AS (
    SELECT dp.*, coalesce(n2.filial_id, n1.filial_id) AS nd_fil,
           coalesce(n2.matricula, n1.matricula)       AS nd_mat,
           coalesce(n2.nome, n1.nome)                 AS nd_nome
      FROM dp
      LEFT JOIN LATERAL (
        SELECT (array_agg(p.filial_id))[1] AS filial_id, (array_agg(p.matricula))[1] AS matricula,
               (array_agg(p.nome))[1] AS nome, count(*) AS n
          FROM pess p
         WHERE dp.pode AND dp.st <> 'CASADO' AND length(coalesce(dp.f[2], '')) >= 5
           AND (p.nm LIKE dp.f[2] || '%' OR dp.f[2] LIKE p.nm || '%')
      ) n2 ON n2.n = 1
      -- f[1] é o FORNECEDOR: só vale quando não há participante, pela mesma
      -- razão da função acima — senão a cooperativa engole todo mundo
      LEFT JOIN LATERAL (
        SELECT (array_agg(p.filial_id))[1] AS filial_id, (array_agg(p.matricula))[1] AS matricula,
               (array_agg(p.nome))[1] AS nome, count(*) AS n
          FROM pess p
         WHERE dp.pode AND dp.st <> 'CASADO' AND length(coalesce(dp.f[2], '')) < 5
           AND length(coalesce(dp.f[1], '')) >= 5
           AND (p.nm LIKE dp.f[1] || '%' OR dp.f[1] LIKE p.nm || '%')
      ) n1 ON n1.n = 1
  )
  SELECT x.conta_id, x.cc_id, x.data, x.documento, x.historico, x.lote, x.valor,
         CASE WHEN x.st = 'CASADO' OR x.nd_mat IS NOT NULL THEN 'CASADO'
              ELSE coalesce(x.st, 'SEM_DEPARA') END,
         CASE WHEN x.st = 'CASADO' THEN 'DEPARA' WHEN x.nd_mat IS NOT NULL THEN 'NOME' END,
         CASE WHEN x.st = 'CASADO' THEN v.filial_id       ELSE x.nd_fil END,
         CASE WHEN x.st = 'CASADO' THEN v.matricula_folha ELSE x.nd_mat END,
         coalesce(x.dp_nome, x.nd_nome), x.forn, coalesce(x.fant, x.f[1])
    FROM nd x
    LEFT JOIN vinc v ON x.st = 'CASADO' AND v.matricula = x.dp_mat
$$;

-- ── CLT: conta → verba (comparação) ──
-- Uma verba só é CLT na conta em que a contabilização da folha a lança. A mesma
-- verba numa conta onde a folha nada lançou é terceiro, e vai para o outro bloco.
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
  -- a contabilização da folha lança nos DOIS lados: débito na despesa, crédito
  -- no passivo, com o mesmo histórico. Só o débito tem o que conciliar — a
  -- folha analítica é o débito. Sem excluir a contrapartida, o passivo entra
  -- com sinal trocado e o total da tela se anula.
  --
  -- O corte é por (conta, verba), não por conta: a mesma conta de passivo pode
  -- ser DÉBITO de uma verba (adiantamento sendo baixado) e CRÉDITO de outra. E
  -- quem diz qual é qual é a própria folha, em conta_cred_cod — informação do
  -- ERP, não palpite pelo sinal ou pela faixa do código.
  contas_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
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
  rz AS (
    SELECT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS verba_cod,
           sum(-fr.valor)::numeric AS valor
      FROM fat_realizado fr
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND fr.conta_id IN (SELECT conta_id FROM contas_folha)
       AND NOT EXISTS (SELECT 1 FROM cred
                        WHERE cred.conta_id = fr.conta_id
                          AND cred.v = btrim(split_part(coalesce(fr.historico, ''), '-', 1)))
       AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) IN (SELECT v FROM verbas)
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
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  )
  SELECT cc.id, cc.codigo, cc.descricao, pc.codigo,
         r.verba_cod, f.verba_desc,
         r.valor, coalesce(f.valor, 0)::numeric
    FROM rz r
    LEFT JOIN fo f ON f.conta_id = r.conta_id AND f.verba_cod = r.verba_cod
    JOIN conta_contabil cc ON cc.id = r.conta_id
    LEFT JOIN plano_contas pc ON pc.id = cc.plano_id
   ORDER BY cc.codigo, pc.codigo, r.verba_cod;
$$;

-- ── CLT: quem compõe a verba ──
-- COMPOSIÇÃO, não comparação: o razão do CLT não tem pessoa. Mostrar razão
-- zerado por funcionário acusaria de divergente quem está certo.
CREATE OR REPLACE FUNCTION conciliacao_clt_pessoas(
  p_ano int, p_mes int, p_conta uuid, p_verba text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (matricula text, nome text, cc_cod text, valor numeric)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT ff.matricula, max(ff.nome),
         CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END,
         sum(ff.valor)::numeric
    FROM fat_folha ff LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id = p_conta
     AND btrim(coalesce(ff.verba_cod, '')) = p_verba
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY ff.filial_id, ff.matricula
   ORDER BY 4 DESC;
$$;

-- ── Terceiros: pessoa a pessoa, folha × nota ──
--   CASADO      a nota tem dono e o dono tem folha — compare os dois valores
--   SEM_NF      a folha calculou e nenhuma nota chegou no mês
--   SEM_FOLHA   a nota tem dono, mas o dono não tem folha de terceiro no mês
--   AMBIGUO     o histórico casou com mais de um fornecedor
--   SEM_DEPARA  a nota não casou com ninguém
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
  -- (conta, verba) que a contabilização da folha lança: isso é CLT, sai daqui
  clt AS (
    SELECT DISTINCT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS v
      FROM fat_realizado fr
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
       AND NOT EXISTS (SELECT 1 FROM clt
                        WHERE clt.conta_id = ff.conta_id
                          AND clt.v = btrim(coalesce(ff.verba_cod, '')))
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

-- ── Terceiros: a conta de cada lado, para uma pessoa ──
-- É aqui que a divergência de conta aparece: a folha numa conta, a nota noutra.
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
  clt AS (
    SELECT DISTINCT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS v
      FROM fat_realizado fr
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
     AND NOT EXISTS (SELECT 1 FROM clt WHERE clt.conta_id = ff.conta_id
                                         AND clt.v = btrim(coalesce(ff.verba_cod, '')))
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY 1, 2, 3, 4, 5
   ORDER BY 1, 2, 9 DESC;
$$;

-- ── Terceiros: o que não tem dono, por conta ──
CREATE OR REPLACE FUNCTION conciliacao_terceiros_outras(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, conta_cod text, conta_desc text, data date, documento text, historico text,
  lote text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  -- conta_id vai junto porque a justificativa escrita (conciliacao_folha_nota)
  -- é chaveada por conta, e o resíduo é o único bloco que ainda pede uma
  SELECT cc2.id, cc2.codigo, cc2.descricao, a.data, a.documento, a.historico, a.lote, ccu.codigo, a.valor
    FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs) a
    JOIN conta_contabil cc2 ON cc2.id = a.conta_id
    LEFT JOIN centro_custo ccu ON ccu.id = a.cc_id
   WHERE a.status <> 'CASADO'
   ORDER BY abs(a.valor) DESC;
$$;
