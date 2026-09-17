-- ============================================================
-- 080 — Conciliação CONTÁBIL × FOLHA (camada 2 da conciliação de folha)
--
-- O PROBLEMA: a área orça nas contas de folha (20101/20201/20301) e recebe o
-- realizado do RAZÃO, que é agregado. A folha analítica tem o mesmo dinheiro por
-- funcionário, mas os totais não batem — e ninguém sabe dizer por quê.
--
-- A CAUSA (medida em ago/2026): dentro da MESMA conta convivem origens
-- diferentes. Em 41013001 (assistência médica) o razão tem a contabilização da
-- folha, a fatura do convênio paga direto ao fornecedor e um ajuste de
-- competência anterior. Só a primeira parcela tem de bater com a folha; a área
-- compara o total e conclui que está tudo errado.
--
-- O DISCRIMINADOR: o histórico do lançamento que veio da folha começa com o
-- CÓDIGO DA VERBA ("B39- VLR.REF.SALARIO- 8/2026"). Testado em ago/2026:
-- 8.212 de 8.212 lançamentos do lote da folha casam; dos outros 25.130 lotes,
-- nenhum. Usar a verba (e não o número do lote) é o que dispensa cadastro — o
-- lote muda todo mês, a verba não.
--
-- SINAL: fat_realizado.valor = crédito − débito (despesa fica negativa) e
-- fat_folha.valor é o movimento devedor positivo. Por isso o razão entra
-- como -valor. Conferido: as linhas de folha com débito em conta de despesa são
-- todas Provento/Base(Provento), nenhuma negativa.
-- ============================================================

-- ── Justificativa do resíduo ────────────────────────────────
-- Sem isto a conciliação não acumula: todo mês a área reexplica a mesma fatura.
-- verba_cod NULL = a linha "outras origens" da conta (o que não veio da folha).
CREATE TABLE IF NOT EXISTS conciliacao_folha_nota (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  ano        int  NOT NULL,
  mes        int  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  conta_id   uuid NOT NULL REFERENCES conta_contabil ON DELETE CASCADE,
  verba_cod  text,
  motivo     text NOT NULL,
  valor_ref  numeric(18,2),           -- a diferença no momento em que se justificou
  autor      text,
  criado_em  timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_concil_folha_nota
  ON conciliacao_folha_nota (tenant_id, ano, mes, conta_id, (coalesce(verba_cod, '')));

ALTER TABLE conciliacao_folha_nota ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_concil_folha_nota ON conciliacao_folha_nota;
CREATE POLICY p_concil_folha_nota ON conciliacao_folha_nota FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ── Agregado: os dois níveis de cima da conciliação ─────────
-- Devolve, por conta:
--   origem='FOLHA'  → uma linha por VERBA: razão (parcela que veio da folha) × folha
--   origem='OUTRAS' → uma linha só: o que o razão tem na conta e NÃO veio da folha
-- O nível 3 (funcionário) sai direto de fat_folha — não precisa de RPC.
CREATE OR REPLACE FUNCTION conciliacao_folha_contabil(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL,
  p_filiais  uuid[] DEFAULT NULL,
  p_ccs      uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id   uuid,
  conta_cod  text,
  conta_desc text,
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
    SELECT fr.conta_id,
           coalesce(v.verba_cod, '')      AS verba_cod,
           (v.verba_cod IS NOT NULL)      AS eh_folha,
           sum(-fr.valor)::numeric        AS valor
      FROM fat_realizado fr
      LEFT JOIN verbas v
             ON v.verba_cod = btrim(split_part(coalesce(fr.historico, ''), '-', 1))
     WHERE fr.tenant_id = current_tenant_id()
       AND fr.ano = p_ano AND fr.mes = p_mes
       AND fr.conta_id IN (SELECT DISTINCT conta_id FROM fo)
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2, 3
  ),
  rz_folha AS (SELECT conta_id, verba_cod, valor FROM rz WHERE eh_folha),
  juntos AS (
    -- FULL JOIN: verba que só existe num dos lados também precisa aparecer —
    -- é justamente o caso interessante (verba contabilizada e não paga, ou vice-versa).
    SELECT coalesce(f.conta_id, r.conta_id)   AS conta_id,
           coalesce(f.verba_cod, r.verba_cod) AS verba_cod,
           f.verba_desc                       AS verba_desc,
           'FOLHA'::text                      AS origem,
           coalesce(r.valor, 0)::numeric      AS razao,
           coalesce(f.valor, 0)::numeric      AS folha
      FROM fo f
      FULL JOIN rz_folha r ON r.conta_id = f.conta_id AND r.verba_cod = f.verba_cod
    UNION ALL
    SELECT rz.conta_id, NULL::text, NULL::text, 'OUTRAS'::text,
           sum(rz.valor)::numeric, 0::numeric
      FROM rz WHERE NOT rz.eh_folha GROUP BY rz.conta_id
  )
  SELECT j.conta_id, cc.codigo, cc.descricao,
         nullif(j.verba_cod, ''), j.verba_desc,
         j.origem, j.razao, j.folha
    FROM juntos j
    JOIN conta_contabil cc ON cc.id = j.conta_id
   ORDER BY cc.codigo, j.origem DESC, j.verba_cod NULLS FIRST;
$$;

-- ── Detalhe do resíduo: o que justificar ────────────────────
-- Os lançamentos do razão, naquela conta, que NÃO vieram da folha. É o que a
-- área precisa ver para escrever o motivo (fatura do fornecedor, ajuste de
-- competência, rateio…). Sem isto a justificativa vira chute.
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
   WHERE fr.tenant_id = current_tenant_id()
     AND fr.ano = p_ano AND fr.mes = p_mes AND fr.conta_id = p_conta
     AND btrim(split_part(coalesce(fr.historico, ''), '-', 1)) NOT IN (SELECT verba_cod FROM verbas)
     AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
   ORDER BY abs(fr.valor) DESC;
$$;
