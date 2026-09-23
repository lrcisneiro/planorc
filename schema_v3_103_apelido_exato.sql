-- ============================================================
-- 103 — O apelido casa EXATO, não por prefixo
--
-- Caso do Ricardo: ele amarrou o texto órfão "LUIS GUSTAVO" ao BORTOTTI, e o
-- apelido passou a engolir as notas do ROMÃO também:
--
--   INC NF GUSTAVO ROMAO-LUIS GUSTAVO ROMAO   →  foi para BORTOTTI
--   LUIS GUSTAVO ROMAO (900044)               →  ficou "sem nota", R$ 15.022,58
--
-- Por que: o casamento é por PREFIXO nos dois sentidos, e "LUIS GUSTAVO ROMAO"
-- começa com "LUIS GUSTAVO". O prefixo bidirecional existe por um motivo real —
-- o histórico do Protheus corta em 40 caracteres e o nome fantasia do SA2 em 20,
-- então qualquer um dos lados pode ser o pedaço — mas isso vale para o que vem
-- do ERP, não para o apelido.
--
-- O apelido é diferente em natureza: é um texto que a pessoa DIGITOU copiando o
-- órfão que a tela mostrou. Ele não está truncado, é exatamente aquele. Casar por
-- prefixo transforma uma amarração pontual em regra abrangente, e quanto mais
-- curto o texto, mais gente ela alcança — o oposto do que se quer de uma
-- correção manual.
--
-- Agora o apelido casa exato. "LUIS GUSTAVO" continua resolvendo o histórico
-- truncado que o gerou, e para de alcançar "LUIS GUSTAVO ROMAO", que volta a
-- casar com o próprio de-para — onde só ele bate.
-- ============================================================

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
  -- 'a' = apelido (manual, EXATO), 's' = nome do SRA, 'n' = nome do RD0,
  -- 'f' = nome fantasia. Os três últimos casam por prefixo nos dois sentidos
  -- porque vêm truncados do ERP; o apelido não vem truncado de lugar nenhum.
  FOREACH v_par IN ARRAY CASE WHEN v_tem_participante
                              THEN ARRAY['2a', '2s', '2n']
                              ELSE ARRAY['1a', '1f', '1s', '1n'] END LOOP
    v_frag := f[substr(v_par, 1, 1)::int];
    v_alvo := substr(v_par, 2, 1);
    CONTINUE WHEN v_frag IS NULL OR length(v_frag) < 5;
    SELECT count(DISTINCT pf.empresa_cod || '|' || pf.filial_cod || '|' || pf.matricula_folha) INTO n
      FROM posto_fornecedor pf
     WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
       AND ((v_alvo = 'a' AND pf.apelido_norm  <> '' AND pf.apelido_norm = v_frag)
         OR (v_alvo = 'f' AND pf.fant_norm     <> '' AND (pf.fant_norm     LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%'))
         OR (v_alvo = 's' AND pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_sra_norm || '%'))
         OR (v_alvo = 'n' AND pf.nome_norm     <> '' AND (pf.nome_norm     LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%')));
    IF n = 1 THEN
      SELECT pf.matricula_folha, pf.filial_cod, pf.matricula,
             coalesce(nullif(pf.nome_sra, ''), pf.nome), pf.fornecedor_cod, pf.fornecedor_loja,
             coalesce(nullif(pf.nome_fantasia, ''), pf.apelido), 'CASADO'
        INTO mat_folha, filial_cod, matricula, nome, fornecedor_cod, fornecedor_loja, nome_fantasia, status
        FROM posto_fornecedor pf
       WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
         AND ((v_alvo = 'a' AND pf.apelido_norm  <> '' AND pf.apelido_norm = v_frag)
           OR (v_alvo = 'f' AND pf.fant_norm     <> '' AND (pf.fant_norm     LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%'))
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
  nome_fantasia := CASE WHEN v_tem_participante THEN f[2] ELSE coalesce(f[1], '') END;
  status := CASE WHEN v_amb THEN 'AMBIGUO' ELSE 'SEM_DEPARA' END;
  RETURN NEXT;
END $$;

-- o candidato ambíguo segue a mesma regra, senão a tela explicaria com um
-- critério e o casamento usaria outro
CREATE OR REPLACE FUNCTION conciliacao_pj_candidatos(p_texto text)
RETURNS TABLE (
  filial_cod text, matricula_folha text, nome text, fornecedor_cod text,
  nome_fantasia text, apelido text, origem text, ativo boolean, casou_por text
)
LANGUAGE sql STABLE AS $$
  WITH t AS (SELECT planorc_norm_txt(p_texto) AS v)
  SELECT pf.filial_cod, pf.matricula_folha,
         coalesce(nullif(pf.nome_sra, ''), pf.nome), pf.fornecedor_cod,
         pf.nome_fantasia, pf.apelido, pf.origem, pf.ativo,
         concat_ws(', ',
           CASE WHEN pf.apelido_norm  <> '' AND pf.apelido_norm = t.v THEN 'apelido (exato)' END,
           CASE WHEN pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE t.v || '%' OR t.v LIKE pf.nome_sra_norm || '%') THEN 'nome SRA' END,
           CASE WHEN pf.nome_norm     <> '' AND (pf.nome_norm     LIKE t.v || '%' OR t.v LIKE pf.nome_norm     || '%') THEN 'nome RD0' END,
           CASE WHEN pf.fant_norm     <> '' AND (pf.fant_norm     LIKE t.v || '%' OR t.v LIKE pf.fant_norm     || '%') THEN 'fantasia' END)
    FROM posto_fornecedor pf, t
   WHERE pf.tenant_id = current_tenant_id()
     AND length(t.v) >= 5
     AND ( (pf.apelido_norm  <> '' AND pf.apelido_norm = t.v)
        OR (pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE t.v || '%' OR t.v LIKE pf.nome_sra_norm || '%'))
        OR (pf.nome_norm     <> '' AND (pf.nome_norm     LIKE t.v || '%' OR t.v LIKE pf.nome_norm     || '%'))
        OR (pf.fant_norm     <> '' AND (pf.fant_norm     LIKE t.v || '%' OR t.v LIKE pf.fant_norm     || '%')) )
   ORDER BY pf.ativo DESC, 3;
$$;
