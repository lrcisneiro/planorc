-- ============================================================
-- 083 — PJ: de-para participante × fornecedor, e a terceira origem do razão
--
-- O PROBLEMA: em Bauru o PJ é 3,5× o CLT inteiro (R$ 789 mil contra R$ 227 mil),
-- e chega ao razão como nota fiscal, em lote de contas a pagar. A contabilização
-- da folha não o toca, então ele caía todo em "outras origens" — uma massa sem
-- nome que ninguém conseguia conciliar.
--
-- A PONTE: o histórico do lançamento traz "<FORNECEDOR>-<PARTICIPANTE>", e o
-- ERP sabe qual fornecedor pertence a qual matrícula (RD0 × SA2). Com o de-para
-- carregado, o lançamento ganha dono.
--
-- MEDIDO em ago/2026 (R$ 2.229.649,93 na conta 41021001):
--   casou   86% · R$ 1.922.530,73    ambíguo 0%    sem de-para 14%
-- O resíduo são empresas que não são participantes (RBKS, FOCUS) — nunca terão
-- pessoa — e buracos no de-para, que somem quando ele for completado.
--
-- ⚠ REGRA ESPECÍFICA DESTE CLIENTE: o formato do histórico é do Protheus desta
-- instalação. Está isolada em planorc_pj_frag() de propósito: generalizar depois
-- (perfil por tenant, como os perfis do importador do razão) é trocar UMA função,
-- não caçar regex espalhado.
-- ============================================================

-- ── Normalização de texto (sem depender da extensão unaccent) ──
CREATE OR REPLACE FUNCTION planorc_norm_txt(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    upper(translate(coalesce(p, ''),
      'áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
      'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
    '\s+', ' ', 'g'))
$$;

-- ── Extração dos dois nomes do histórico ──
-- Devolve {fornecedor, participante}. Quando não há "-" (o caso INC CP, lançado
-- direto no financeiro), o fornecedor é o texto inteiro e o participante vem vazio.
CREATE OR REPLACE FUNCTION planorc_pj_frag(p_hist text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH n AS (SELECT planorc_norm_txt(p_hist) AS h),
  -- prefixos se empilham ("SERVICOS PRESTADOS INC CP ..."), daí o + no grupo
  s1 AS (SELECT regexp_replace(h, '^((INC NF|INC CP|PREST SERV[ 0-9./]*|SERVICOS PRESTADOS|PRESTACAO SERVICOS) *)+', '') AS h FROM n),
  s2 AS (SELECT regexp_replace(h, ' +INC +(CP|NF)( .*)?$', '') AS h FROM s1),   -- ruído no fim
  s3 AS (SELECT btrim(regexp_replace(h, '^[- ]+', '')) AS h FROM s2),
  p  AS (
    SELECT btrim(split_part(h, '-', 1)) AS a,
           CASE WHEN position('-' in h) > 0
                THEN btrim(substring(h from position('-' in h) + 1)) ELSE '' END AS b
      FROM s3
  ),
  -- histórico que começa com "-" joga o nome todo no lado direito
  q AS (SELECT CASE WHEN a = '' THEN b ELSE a END AS a, CASE WHEN a = '' THEN '' ELSE b END AS b FROM p)
  SELECT ARRAY[
    btrim(regexp_replace(a, ' +[0-9]{2,}$', '')),   -- "MARCIO ORTOLAN 000"
    btrim(regexp_replace(b, ' +[0-9]{2,}$', ''))
  ] FROM q
$$;

-- ── O de-para ──
CREATE TABLE IF NOT EXISTS posto_fornecedor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  empresa_cod     text,                       -- empresa do ERP no RD0 ('20','21','25','28')
  filial_cod      text,
  matricula       text NOT NULL,              -- matrícula do SRA, a mesma do posto e da folha
  nome            text,
  cpf             text,
  fornecedor_cod  text NOT NULL,
  fornecedor_loja text,                       -- SA2 é chaveado por COD + LOJA
  cnpj            text,
  nome_fantasia   text,
  -- as colunas de busca são geradas: normalizar na consulta impediria usar índice
  fant_norm       text GENERATED ALWAYS AS (planorc_norm_txt(nome_fantasia)) STORED,
  nome_norm       text GENERATED ALWAYS AS (planorc_norm_txt(nome)) STORED,
  ini_ano int, ini_mes int, fim_ano int, fim_mes int,   -- PJ vira CLT, contrato troca
  ativo           boolean NOT NULL DEFAULT true,
  importado_em    timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_posto_fornecedor
  ON posto_fornecedor (tenant_id, coalesce(empresa_cod, ''), matricula, fornecedor_cod, coalesce(fornecedor_loja, ''));
CREATE INDEX IF NOT EXISTS ix_posto_fornecedor_fant ON posto_fornecedor (tenant_id, fant_norm);
CREATE INDEX IF NOT EXISTS ix_posto_fornecedor_nome ON posto_fornecedor (tenant_id, nome_norm);
CREATE INDEX IF NOT EXISTS ix_posto_fornecedor_mat  ON posto_fornecedor (tenant_id, matricula);

ALTER TABLE posto_fornecedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_posto_fornecedor ON posto_fornecedor;
CREATE POLICY p_posto_fornecedor ON posto_fornecedor FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ── Casamento de UM histórico com o de-para ──
-- Casa por PREFIXO nos dois sentidos, porque o histórico do razão é truncado em
-- 40 caracteres e o nome fantasia do SA2 em 20: qualquer um dos lados pode ser o
-- pedaço. Tenta fornecedor→fantasia, participante→nome, e as trocas — a
-- cooperativa traz o nome dela no lugar do fornecedor e a pessoa no outro lado.
-- Só devolve quando a resposta é ÚNICA: com R$ 1,9 milhão em jogo, escolher entre
-- dois homônimos é pior do que não casar.
CREATE OR REPLACE FUNCTION planorc_pj_casa(p_hist text)
RETURNS TABLE (matricula text, nome text, fornecedor_cod text, fornecedor_loja text, nome_fantasia text, status text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f text[]; v_par text; v_frag text; v_alvo text; n int; v_amb boolean := false;
BEGIN
  f := planorc_pj_frag(p_hist);
  FOREACH v_par IN ARRAY ARRAY['1f', '2n', '1n', '2f'] LOOP
    v_frag := f[substr(v_par, 1, 1)::int];
    v_alvo := substr(v_par, 2, 1);
    CONTINUE WHEN v_frag IS NULL OR length(v_frag) < 5;
    SELECT count(DISTINCT pf.fornecedor_cod || '|' || coalesce(pf.fornecedor_loja, '')) INTO n
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
      -- ambíguo NESTA estratégia não encerra: a seguinte costuma desempatar (o nome
      -- do participante distingue dois fornecedores de fantasia parecida). Só vira
      -- AMBIGUO se nenhuma das quatro der resposta única.
      v_amb := true;
    END IF;
  END LOOP;
  matricula := NULL; nome := NULL; fornecedor_cod := NULL; fornecedor_loja := NULL;
  nome_fantasia := coalesce(f[1], '');
  status := CASE WHEN v_amb THEN 'AMBIGUO' ELSE 'SEM_DEPARA' END;
  RETURN NEXT;
END $$;

-- ── Drill: o razão de PJ de uma conta, com dono ──
CREATE OR REPLACE FUNCTION conciliacao_pj_detalhe(
  p_ano int, p_mes int, p_conta uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  status text, matricula text, nome text, fornecedor_cod text, nome_fantasia text,
  cc_cod text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH verbas AS (
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
  )
  SELECT m.status, m.matricula, m.nome, m.fornecedor_cod, m.nome_fantasia,
         cc.codigo, count(*), sum(lan.v)::numeric
    FROM lan
    CROSS JOIN LATERAL planorc_pj_casa(lan.historico) m
    LEFT JOIN centro_custo cc ON cc.id = lan.cc_id
   GROUP BY m.status, m.matricula, m.nome, m.fornecedor_cod, m.nome_fantasia, cc.codigo
   ORDER BY m.status, sum(lan.v) DESC;
$$;
