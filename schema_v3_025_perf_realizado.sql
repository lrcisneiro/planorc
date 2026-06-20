-- ============================================================
-- 025 — Performance do realizado (1M+ linhas)
--
-- (a) RPC relatorio_realizado_agg: a exclusão de lote deixa de ser uma
--     FUNÇÃO chamada linha a linha (lote_eh_ignorado) e passa a um
--     NOT EXISTS inline. Quando não há regra de lote ATIVA (caso atual,
--     pois os lotes de encerramento nem são importados), o planner
--     resolve como anti-join contra conjunto vazio → custo desprezível.
--     Mesmo resultado de antes, muito mais rápido.
--
-- (b) Índices compostos/cobrindo casados com os filtros das RPCs
--     (tenant + empresa + ano + mês), trazendo as colunas usadas no
--     INCLUDE para evitar ida ao heap.
--
-- IDEMPOTENTE.
-- ============================================================

-- (a) RPC do realizado com exclusão de lote inline
CREATE OR REPLACE FUNCTION relatorio_realizado_agg(
  p_empresas uuid[],
  p_anos     int[],
  p_meses    int[],
  p_linhas   uuid[],
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE(linha_id uuid, ano int, mes int, valor numeric)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  SELECT t.linha_id, t.ano, t.mes, sum(t.v) AS valor
  FROM (
    -- lançamentos com linha_id direto (manual)
    SELECT fr.linha_id, fr.ano, fr.mes, fr.valor::numeric AS v
    FROM fat_realizado fr
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.linha_id = ANY(p_linhas)
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      AND NOT EXISTS (
        SELECT 1 FROM lote_ignorado li
        WHERE li.tenant_id = current_tenant_id() AND li.ativo
          AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
          AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
          AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
      )
    UNION ALL
    -- lançamentos por conta (resolve via conta_linha; 1 linha por conta = a "última")
    SELECT cl.linha_id, fr.ano, fr.mes, (fr.valor * cl.sinal)::numeric AS v
    FROM fat_realizado fr
    JOIN LATERAL (
      SELECT c.linha_id, c.sinal FROM conta_linha c
      WHERE c.conta_id = fr.conta_id AND c.tenant_id = current_tenant_id() AND c.linha_id = ANY(p_linhas)
      ORDER BY c.id DESC LIMIT 1
    ) cl ON true
    WHERE fr.tenant_id = current_tenant_id()
      AND fr.linha_id IS NULL
      AND fr.empresa_id = ANY(p_empresas) AND fr.ano = ANY(p_anos) AND fr.mes = ANY(p_meses)
      AND (p_filiais IS NULL OR fr.filial_id = ANY(p_filiais))
      AND (p_ccs     IS NULL OR fr.cc_id     = ANY(p_ccs))
      AND NOT EXISTS (
        SELECT 1 FROM lote_ignorado li
        WHERE li.tenant_id = current_tenant_id() AND li.ativo
          AND (CASE WHEN li.por_prefixo THEN upper(fr.lote) LIKE upper(li.lote) || '%' ELSE li.lote = fr.lote END)
          AND (li.sublote   IS NULL OR li.sublote   = fr.sublote)
          AND (li.empresa_id IS NULL OR li.empresa_id = fr.empresa_id)
      )
  ) t
  GROUP BY t.linha_id, t.ano, t.mes
$$;

-- (b) Índices cobrindo os filtros das RPCs
-- Realizado: filtro tenant+empresa+ano+mês; INCLUDE traz o resto p/ a agregação
CREATE INDEX IF NOT EXISTS idx_fat_realizado_agg
  ON fat_realizado (tenant_id, empresa_id, ano, mes)
  INCLUDE (conta_id, linha_id, filial_id, cc_id, valor, lote, sublote);

-- Branch por conta (lateral conta_linha) — acesso por conta_id já coberto pela
-- UNIQUE(conta_id, linha_id) de conta_linha; reforça lookup por conta no fato:
CREATE INDEX IF NOT EXISTS idx_fat_realizado_conta_per
  ON fat_realizado (tenant_id, conta_id, ano, mes);

-- Orçado: filtro tenant+versao+empresa+ano+mês
CREATE INDEX IF NOT EXISTS idx_fat_orcado_agg
  ON fat_orcado (tenant_id, versao_id, empresa_id, ano, mes)
  INCLUDE (linha_id, filial_id, cc_id, valor, expressao);

-- Atualiza estatísticas p/ o planner escolher os novos índices
ANALYZE fat_realizado;
ANALYZE fat_orcado;
