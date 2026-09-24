-- ============================================================
-- 107 — Conta aglutinada: pagamento que não tem dono, e nunca vai ter
--
-- Ricardo, sobre a 950001/950100: "não vamos amarrar aos nomes. É pagamento dos
-- sócios de forma aglutinada."
--
-- É uma categoria que faltava. A conferência de terceiros pergunta "de quem é
-- esta nota?", e para essas contas a pergunta não tem resposta — não por falta
-- de de-para, mas porque o lançamento é de várias pessoas somadas, por decisão.
-- Sem lugar para dizer isso, elas caem todo mês em "Outros lançamentos" como se
-- fosse pendência, e alguém vai acabar tentando amarrar.
--
-- A marca é por CONTA e PERMANENTE (não por competência, como a justificativa
-- de divergência do CLT): "o que cai aqui é aglutinado" é uma característica da
-- conta, não um acontecimento do mês.
--
-- O dinheiro NÃO some — é o que separa isto de simplesmente ignorar a conta:
--   · sai do bloco de terceiros (não é conciliável por pessoa)
--   · aparece em quadro próprio, com o motivo escrito
--   · continua dentro do item na DRE, e a lista do "fora" do item passa a
--     dizer 'pagamento aglutinado' em vez de deixar o valor sem explicação
-- ============================================================

CREATE TABLE IF NOT EXISTS conciliacao_conta_aglutinada (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  conta_id   uuid NOT NULL REFERENCES conta_contabil ON DELETE CASCADE,
  motivo     text NOT NULL,
  autor      text,
  criado_em  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, conta_id)
);

ALTER TABLE conciliacao_conta_aglutinada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_concil_conta_aglutinada ON conciliacao_conta_aglutinada;
CREATE POLICY p_concil_conta_aglutinada ON conciliacao_conta_aglutinada FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ── O universo do terceiro não inclui conta aglutinada ──
-- O corte é no fim, depois das irmãs: se a conta aglutinada for a única com
-- folha do master, as irmãs dela continuam sendo terceiro — o que se perde é a
-- tentativa de achar dono para ELA, não o grupo inteiro.
CREATE OR REPLACE FUNCTION planorc_concil_contas(p_ano int, p_mes int, p_relatorio_id uuid)
RETURNS TABLE (conta_id uuid)
LANGUAGE sql STABLE AS $$
  WITH clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  com_folha AS (
    SELECT DISTINCT ff.conta_id FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM clt)
  ),
  masters AS (
    SELECT DISTINCT c.linha_id FROM conta_linha c
      JOIN com_folha f ON f.conta_id = c.conta_id
     WHERE c.tenant_id = current_tenant_id()
  ),
  universo AS (
    SELECT c.conta_id FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id()
       AND c.linha_id IN (SELECT linha_id FROM masters)
       AND c.conta_id NOT IN (SELECT conta_id FROM clt)
    UNION
    SELECT conta_id FROM com_folha
  )
  SELECT u.conta_id FROM universo u
   WHERE u.conta_id NOT IN (
     SELECT a.conta_id FROM conciliacao_conta_aglutinada a
      WHERE a.tenant_id = current_tenant_id()
   )
$$;

-- ── O quadro das aglutinadas ──
-- Mesmo formato dos outros: o valor já vem com o sinal da amarração, que é o
-- que a DRE aplica, para poder comparar com a linha do relatório sem conversão.
DROP FUNCTION IF EXISTS conciliacao_aglutinadas(int, int, uuid, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_aglutinadas(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_id uuid, conta_cod text, conta_desc text,
  linha_desc text, motivo text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH item AS (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  )
  SELECT a.conta_id, cc.codigo, cc.descricao, i.linha_desc, a.motivo,
         coalesce(m.n, 0), coalesce(m.v, 0)::numeric
    FROM conciliacao_conta_aglutinada a
    JOIN conta_contabil cc ON cc.id = a.conta_id
    LEFT JOIN item i  ON i.conta_id = a.conta_id
    LEFT JOIN sinal s ON s.conta_id = a.conta_id
    CROSS JOIN LATERAL (
      SELECT count(*)::bigint AS n, sum(-fr.valor * coalesce(s.sinal, 1)) AS v
        FROM fat_realizado fr
       WHERE fr.tenant_id = a.tenant_id AND fr.conta_id = a.conta_id
         AND fr.ano = p_ano AND fr.mes = p_mes
         AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
         AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
         AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
    ) m
   WHERE a.tenant_id = current_tenant_id()
   ORDER BY cc.codigo;
$$;

-- ── O "fora" do item passa a reconhecer a aglutinada ──
-- Sem isto, a conta marcada sairia do universo do terceiro e cairia em "conta
-- do item sem folha" — verdadeiro de passagem e enganoso no essencial, porque
-- sugere falta de amarração onde há uma decisão.
CREATE OR REPLACE FUNCTION conciliacao_item_fora(
  p_ano int, p_mes int, p_relatorio_id uuid, p_linha_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  conta_cod text, conta_desc text, motivo text, lancamentos bigint, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH item AS (SELECT * FROM planorc_concil_item(p_relatorio_id)),
  clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  terc AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas(p_ano, p_mes, p_relatorio_id)),
  aglut AS MATERIALIZED (
    SELECT a.conta_id FROM conciliacao_conta_aglutinada a
     WHERE a.tenant_id = current_tenant_id()
  ),
  verbas AS (
    SELECT DISTINCT btrim(coalesce(ff.verba_cod, '')) AS v FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND btrim(coalesce(ff.verba_cod, '')) <> ''
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
  sinal AS (
    SELECT c.conta_id, max(c.sinal) AS sinal FROM conta_linha c
     WHERE c.tenant_id = current_tenant_id() GROUP BY 1
  ),
  lan AS (
    SELECT fr.conta_id, btrim(split_part(coalesce(fr.historico, ''), '-', 1)) AS verba,
           (-fr.valor * coalesce(s.sinal, 1))::numeric AS valor
      FROM fat_realizado fr
      JOIN item i ON i.conta_id = fr.conta_id AND i.linha_id = p_linha_id
      LEFT JOIN sinal s ON s.conta_id = fr.conta_id
     WHERE fr.tenant_id = current_tenant_id() AND fr.ano = p_ano AND fr.mes = p_mes
       AND (p_empresas IS NULL OR fr.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR fr.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR fr.cc_id      = ANY(p_ccs))
  )
  SELECT cc.codigo, cc.descricao, x.motivo, count(*)::bigint, sum(x.valor)::numeric
    FROM (
      SELECT lan.conta_id, lan.valor,
             CASE
               -- antes de tudo: é decisão, não pendência
               WHEN lan.conta_id IN (SELECT conta_id FROM aglut)
                    THEN 'pagamento aglutinado — não concilia por pessoa'
               WHEN lan.conta_id NOT IN (SELECT conta_id FROM clt)
                AND lan.conta_id IN (SELECT conta_id FROM terc) THEN 'concilia no bloco Terceiros'
               WHEN lan.conta_id NOT IN (SELECT conta_id FROM clt) THEN 'conta do item sem folha'
               WHEN EXISTS (SELECT 1 FROM cred WHERE cred.conta_id = lan.conta_id AND cred.v = lan.verba)
                    THEN 'contrapartida de crédito da folha'
               ELSE NULL END AS motivo
        FROM lan
    ) x
    JOIN conta_contabil cc ON cc.id = x.conta_id
   WHERE x.motivo IS NOT NULL
   GROUP BY 1, 2, 3
   ORDER BY abs(sum(x.valor)) DESC;
$$;
