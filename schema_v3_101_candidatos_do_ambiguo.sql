-- ============================================================
-- 101 — Quem são os candidatos de um histórico ambíguo
--
-- O ambíguo é o único status que diz o QUE aconteceu sem dizer POR QUÊ. A tela
-- mostrava "LUIS GUSTAVO · ambíguo" e nada mais — e o caminho natural de quem
-- confere vira apagar linhas do de-para até sobrar uma, que é a pior saída
-- possível: assim que sobra UMA, o lançamento casa sozinho com ela, sem aviso,
-- e pode ter casado com a pessoa errada.
--
-- Mostrando os candidatos, a mesma tela responde: "LUIS GUSTAVO" alcança
-- BORTOTTI, ROMAO e TORRES SEREJO — o histórico do Protheus corta em 40
-- caracteres e os três começam igual. Aí fica claro que o problema não é o
-- de-para estar errado, é o texto não distinguir ninguém.
-- ============================================================

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
         -- por qual campo este candidato entrou: é o que diz onde mexer
         concat_ws(', ',
           CASE WHEN pf.apelido_norm  <> '' AND (pf.apelido_norm  LIKE t.v || '%' OR t.v LIKE pf.apelido_norm  || '%') THEN 'apelido'  END,
           CASE WHEN pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE t.v || '%' OR t.v LIKE pf.nome_sra_norm || '%') THEN 'nome SRA' END,
           CASE WHEN pf.nome_norm     <> '' AND (pf.nome_norm     LIKE t.v || '%' OR t.v LIKE pf.nome_norm     || '%') THEN 'nome RD0' END,
           CASE WHEN pf.fant_norm     <> '' AND (pf.fant_norm     LIKE t.v || '%' OR t.v LIKE pf.fant_norm     || '%') THEN 'fantasia' END)
    FROM posto_fornecedor pf, t
   WHERE pf.tenant_id = current_tenant_id()
     AND length(t.v) >= 5
     AND ( (pf.apelido_norm  <> '' AND (pf.apelido_norm  LIKE t.v || '%' OR t.v LIKE pf.apelido_norm  || '%'))
        OR (pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE t.v || '%' OR t.v LIKE pf.nome_sra_norm || '%'))
        OR (pf.nome_norm     <> '' AND (pf.nome_norm     LIKE t.v || '%' OR t.v LIKE pf.nome_norm     || '%'))
        OR (pf.fant_norm     <> '' AND (pf.fant_norm     LIKE t.v || '%' OR t.v LIKE pf.fant_norm     || '%')) )
   ORDER BY pf.ativo DESC, 3;
$$;
