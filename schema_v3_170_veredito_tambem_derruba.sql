-- ============================================================
-- v3_170 — Mudar VEREDITO depois de fechado também derruba o carimbo
--
-- A v3_166 fez o gatilho comparar só os campos de DECISÃO, para que gravar um
-- veredito não derrubasse a aprovação recém-dada. Resolveu aquele problema e
-- abriu outro, que só aparece DEPOIS do fechamento:
--
--   cenário fechado → aprovador troca um ✓ por ✗ (ou o gerente reenvia uma
--   recusada) → o conjunto do que será aplicado MUDA → e o carimbo continua
--   lá, afirmando que aquele conjunto foi revisado.
--
-- O carimbo certifica **o conjunto de vereditos**, não só as decisões. Então
-- qualquer mudança em `posto_versao` o derruba de novo — inclusive veredito.
--
-- ⚠ Por que isso NÃO recria o problema da v3_166: o gatilho só escreve quando
-- **já existe** carimbo (`WHERE aprovado_em IS NOT NULL`). Durante a revisão
-- não há carimbo, então os quatorze cliques de veredito não custam nada e nada
-- se auto-derruba. Depois do fechamento, derrubar é justamente o que se quer.
--
-- O gatilho BEFORE (decisão alterada zera o veredito) continua comparando só
-- decisão — ali a distinção segue certa: trocar o veredito não pode apagar o
-- próprio veredito.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION cenario_alterado_derruba_aprovacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := coalesce(NEW.versao_id, OLD.versao_id);
BEGIN
  UPDATE versao_orcamento
     SET aprovado_em = NULL, aprovado_por = NULL,
         aprovacao_nota = coalesce(aprovacao_nota || ' ', '')
                        || '[aprovação derrubada por alteração no cenário em '
                        || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']'
   WHERE id = v AND aprovado_em IS NOT NULL;
  RETURN NULL;
END $$;

SELECT 'gatilho derruba em qualquer alteração' AS secao,
       CASE WHEN pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='cenario_alterado_derruba_aprovacao'))
                 NOT LIKE '%IS DISTINCT FROM%'
            THEN 'sim' ELSE '⛔ ainda compara só decisão' END AS resultado
UNION ALL SELECT 'gatilho BEFORE segue comparando só decisão',
  CASE WHEN pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='decisao_alterada_zera_veredito'))
            LIKE '%IS DISTINCT FROM%' THEN 'sim' ELSE '⛔ não' END
UNION ALL SELECT 'versões com carimbo agora',
  (SELECT count(*)::text FROM versao_orcamento WHERE aprovado_em IS NOT NULL);
