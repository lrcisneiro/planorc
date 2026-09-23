-- ============================================================
-- 086 — O de-para passa a ser chaveado pela FOLHA, e o cooperado entra
--
-- O export novo (SRA × Fornecedores) traz a identidade da folha para TODO mundo
-- — MATRICULA, FILIAL_SRA, NOME_SRA — inclusive para quem não existe no RD0.
-- Isso muda duas coisas de fundo:
--
-- 1. O COOPERADO FINALMENTE CABE. Ele não tem participante no RD0 (o fornecedor
--    é a cooperativa), então nas versões anteriores simplesmente não existia no
--    de-para: eram 4 linhas de cooperativa, agora são 113. O que o identifica é
--    o NOME_SRA, que é exatamente o que o histórico traz depois do "-".
--
-- 2. A CHAVE DEIXA DE SER O RD0. matricula (RD0_CODIGO) vira atributo opcional;
--    quem identifica a linha é (empresa, filial, matrícula do SRA, fornecedor).
--    Medido em ago/2026: 228 das 312 linhas com fornecedor caem na folha por
--    essa chave, e o NOME_SRA confere em 228 de 228 — nenhum falso positivo.
--
-- A REGRA DE CASAMENTO, como o cliente a descreve:
--   PJ puro     o histórico traz o NOME FANTASIA do fornecedor — é a chave
--   Cooperado   o histórico traz "<COOPERATIVA>-<NOME DO FUNCIONÁRIO>",
--               e quem decide é o nome do funcionário (NOME_SRA)
-- Ou seja: havendo participante depois do "-", é ele quem manda e o fornecedor
-- nem é consultado. Sem participante, vale a fantasia. É a mesma precedência da
-- v3_085, agora com o nome certo para procurar.
-- ============================================================

-- ── Esquema: a identidade da folha vira a chave ──
ALTER TABLE posto_fornecedor ALTER COLUMN matricula DROP NOT NULL;
ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS nome_sra text;
ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS nome_sra_norm text
  GENERATED ALWAYS AS (planorc_norm_txt(nome_sra)) STORED;

UPDATE posto_fornecedor SET filial_cod = coalesce(filial_cod, ''), matricula_folha = coalesce(matricula_folha, '')
 WHERE filial_cod IS NULL OR matricula_folha IS NULL;
ALTER TABLE posto_fornecedor ALTER COLUMN filial_cod      SET DEFAULT '',
                             ALTER COLUMN filial_cod      SET NOT NULL,
                             ALTER COLUMN matricula_folha SET DEFAULT '',
                             ALTER COLUMN matricula_folha SET NOT NULL;

-- Linhas antigas podem colidir sob a chave nova (o de-para velho não tinha a
-- matrícula do SRA, então várias viram a mesma chave vazia). Ficam com uma só —
-- o import seguinte, em "substituir tudo", repõe a lista inteira de qualquer forma.
DELETE FROM posto_fornecedor a USING posto_fornecedor b
 WHERE a.tenant_id = b.tenant_id AND a.empresa_cod = b.empresa_cod
   AND a.filial_cod = b.filial_cod AND a.matricula_folha = b.matricula_folha
   AND a.fornecedor_cod = b.fornecedor_cod AND a.fornecedor_loja = b.fornecedor_loja
   AND a.id > b.id;

DROP INDEX IF EXISTS uq_posto_fornecedor;
CREATE UNIQUE INDEX IF NOT EXISTS uq_posto_fornecedor
  ON posto_fornecedor (tenant_id, empresa_cod, filial_cod, matricula_folha, fornecedor_cod, fornecedor_loja);
CREATE INDEX IF NOT EXISTS ix_posto_fornecedor_sra ON posto_fornecedor (tenant_id, nome_sra_norm);

-- ── Casamento de UM histórico ──
-- Devolve a identidade da FOLHA (filial + matrícula do SRA), não a do RD0: é
-- ela que o resto da conciliação precisa, e agora o de-para a tem para todos.
-- Casa por PREFIXO nos dois sentidos, porque o histórico do razão é truncado em
-- 40 caracteres e os nomes do ERP em tamanhos variados: qualquer um dos lados
-- pode ser o pedaço.
-- A unicidade é da PESSOA, não do fornecedor — numa cooperativa os 113
-- cooperados dividem o mesmo fornecedor, e contar fornecedor daria "1" mesmo
-- com dois candidatos.
DROP FUNCTION IF EXISTS planorc_pj_casa(text);

CREATE FUNCTION planorc_pj_casa(p_hist text)
RETURNS TABLE (
  mat_folha text, filial_cod text, matricula text, nome text,
  fornecedor_cod text, fornecedor_loja text, nome_fantasia text, status text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f text[]; v_par text; v_frag text; v_alvo text; n int; v_amb boolean := false;
  v_tem_participante boolean;
BEGIN
  f := planorc_pj_frag(p_hist);
  v_tem_participante := length(coalesce(f[2], '')) >= 5;
  -- 's' = nome do SRA (o funcionário), 'n' = nome do RD0, 'f' = nome fantasia
  FOREACH v_par IN ARRAY CASE WHEN v_tem_participante
                              THEN ARRAY['2s', '2n']   -- o funcionário manda
                              ELSE ARRAY['1f', '1s', '1n'] END LOOP
    v_frag := f[substr(v_par, 1, 1)::int];
    v_alvo := substr(v_par, 2, 1);
    CONTINUE WHEN v_frag IS NULL OR length(v_frag) < 5;
    SELECT count(DISTINCT pf.empresa_cod || '|' || pf.filial_cod || '|' || pf.matricula_folha) INTO n
      FROM posto_fornecedor pf
     WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
       AND ((v_alvo = 'f' AND pf.fant_norm     <> '' AND (pf.fant_norm     LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%'))
         OR (v_alvo = 's' AND pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_sra_norm || '%'))
         OR (v_alvo = 'n' AND pf.nome_norm     <> '' AND (pf.nome_norm     LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%')));
    IF n = 1 THEN
      SELECT pf.matricula_folha, pf.filial_cod, pf.matricula,
             coalesce(nullif(pf.nome_sra, ''), pf.nome), pf.fornecedor_cod, pf.fornecedor_loja,
             pf.nome_fantasia, 'CASADO'
        INTO mat_folha, filial_cod, matricula, nome, fornecedor_cod, fornecedor_loja, nome_fantasia, status
        FROM posto_fornecedor pf
       WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
         AND ((v_alvo = 'f' AND pf.fant_norm     <> '' AND (pf.fant_norm     LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%'))
           OR (v_alvo = 's' AND pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_sra_norm || '%'))
           OR (v_alvo = 'n' AND pf.nome_norm     <> '' AND (pf.nome_norm     LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%')))
       LIMIT 1;
      RETURN NEXT; RETURN;
    ELSIF n > 1 THEN
      v_amb := true;
    END IF;
  END LOOP;
  mat_folha := NULL; filial_cod := NULL; matricula := NULL; nome := NULL;
  fornecedor_cod := NULL; fornecedor_loja := NULL;
  -- o texto devolvido é o que se procura no ERP: o participante quando existe,
  -- senão o fornecedor
  nome_fantasia := CASE WHEN v_tem_participante THEN f[2] ELSE coalesce(f[1], '') END;
  status := CASE WHEN v_amb THEN 'AMBIGUO' ELSE 'SEM_DEPARA' END;
  RETURN NEXT;
END $$;

-- ── A atribuição, agora sem adivinhar a pessoa ──
-- Com a matrícula do SRA no de-para, o dono sai direto: filial + matrícula. O
-- vínculo por nome (planorc_pj_vinculo) sobra só para linha antiga sem SRA, e o
-- casamento pelo nome na folha continua cobrindo quem não está no de-para.
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
  vinc AS MATERIALIZED (SELECT * FROM planorc_pj_vinculo(p_ano, p_mes)),
  fil AS MATERIALIZED (SELECT id, codigo FROM filial WHERE tenant_id = current_tenant_id()),
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
  -- MATERIALIZED: a CTE de referência única é inlinada, e planorc_pj_frag()
  -- passaria a rodar dentro do LATERAL, uma vez por par (lançamento × pessoa).
  dp AS MATERIALIZED (
    -- o LEFT JOIN só dispara nas contas de terceiro: fora delas a linha
    -- atravessa sem dono, que é o comportamento certo para "outros"
    SELECT lan.*, (lan.conta_id IN (SELECT conta_id FROM ct)) AS pode,
           m.status AS st, m.mat_folha AS dp_matf, m.filial_cod AS dp_fil,
           m.matricula AS dp_mat, m.nome AS dp_nome,
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
         -- o de-para com matrícula do SRA resolve direto; sem ela, cai no
         -- vínculo por nome da v3_084, que é o que a base antiga tem
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
