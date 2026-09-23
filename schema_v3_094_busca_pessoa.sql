-- ============================================================
-- 094 — Achar uma pessoa na conferência
--
-- "Onde está lançado o fulano?" é a pergunta mais frequente de quem confere, e
-- a tela não respondia. No bloco de terceiros a pessoa é a própria linha, então
-- filtrar é local. No de CLT ela só existe no ÚLTIMO nível — a composição da
-- verba, carregada sob demanda — e procurar significaria abrir conta por conta.
--
-- Esta função faz a pergunta ao contrário: dado um pedaço de nome ou matrícula,
-- em que (conta, verba) essa pessoa aparece. A tela usa isso para podar a árvore
-- até os caminhos que a contêm e já abrir neles.
--
-- Casa por PEDAÇO em qualquer posição do nome (não por prefixo, como o de-para),
-- porque quem procura digita "silva" e não "MARIA APARECIDA DA SILVA". A
-- normalização tira acento e caixa, então "joao" acha "JOÃO".
-- ============================================================

CREATE OR REPLACE FUNCTION conciliacao_busca_pessoa(
  p_ano int, p_mes int, p_termo text,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, verba_cod text, matricula text, nome text, cc_cod text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT ff.conta_id, btrim(coalesce(ff.verba_cod, '')),
         ff.matricula, max(ff.nome),
         CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END,
         sum(ff.valor)::numeric
    FROM fat_folha ff
    LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
     AND length(btrim(coalesce(p_termo, ''))) >= 3
     AND (planorc_norm_txt(ff.nome) LIKE '%' || planorc_norm_txt(p_termo) || '%'
       OR ff.matricula LIKE '%' || btrim(p_termo) || '%')
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY ff.conta_id, btrim(coalesce(ff.verba_cod, '')), ff.filial_id, ff.matricula
   ORDER BY 6 DESC;
$$;
