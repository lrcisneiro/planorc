-- ============================================================
-- F1 — Estrutura de linhas compartilhada (linha_orcamentaria)
-- Aditiva e segura: cria a estrutura mestre a partir dos códigos
-- existentes e preenche relatorio_linha.linha_orc_id.
-- NÃO mexe em fat_orcado / conta_linha (isso é a F2).
-- Idempotente (pode rodar de novo).
-- ============================================================
BEGIN;

-- 1) Tabela mestre compartilhada
CREATE TABLE IF NOT EXISTS linha_orcamentaria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  codigo          text NOT NULL,
  descricao       text NOT NULL,
  pai_id          uuid REFERENCES linha_orcamentaria ON DELETE SET NULL,
  nivel           int  NOT NULL DEFAULT 1,
  tipo_linha      text NOT NULL DEFAULT 'ANALITICA'
                  CHECK (tipo_linha IN ('SOMAR_FILHOS','ANALITICA','FORMULA','INDICADOR','ESPACO')),
  expressao       text,
  natureza        text CHECK (natureza IN ('RECEITA','DESPESA','NEUTRO')),
  formato         text NOT NULL DEFAULT 'NUMERO'
                  CHECK (formato IN ('NUMERO','PERCENTUAL','MOEDA')),
  casas_decimais  int  NOT NULL DEFAULT 0,
  grupo_folha     boolean DEFAULT false,
  UNIQUE (tenant_id, codigo)
);

ALTER TABLE linha_orcamentaria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "linha_orcamentaria_rls" ON linha_orcamentaria;
CREATE POLICY "linha_orcamentaria_rls" ON linha_orcamentaria FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 2) Popular a mestre a partir da UNIÃO dos códigos.
--    Para cada código, escolhe a versão "canônica" = a relatorio_linha
--    com mais lançamentos de orçado (o "dono" do dado); desempate por
--    código do relatório.
INSERT INTO linha_orcamentaria
  (tenant_id, codigo, descricao, nivel, tipo_linha, expressao, natureza, formato, casas_decimais)
SELECT DISTINCT ON (r.tenant_id, rl.codigo)
  r.tenant_id, rl.codigo, rl.descricao, rl.nivel, rl.tipo_linha, rl.expressao,
  rl.natureza, rl.formato, rl.casas_decimais
FROM relatorio_linha rl
JOIN relatorio r ON r.id = rl.relatorio_id
LEFT JOIN (SELECT linha_id, count(*) c FROM fat_orcado GROUP BY linha_id) f
       ON f.linha_id = rl.id
ORDER BY r.tenant_id, rl.codigo, COALESCE(f.c, 0) DESC, r.codigo
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- 3) Resolver a hierarquia (pai_id) por código, usando o pai da fonte canônica
UPDATE linha_orcamentaria lo
SET pai_id = pai.id
FROM (
  SELECT DISTINCT ON (r.tenant_id, rl.codigo)
    r.tenant_id, rl.codigo,
    (SELECT p.codigo FROM relatorio_linha p WHERE p.id = rl.pai_id) AS pai_codigo
  FROM relatorio_linha rl
  JOIN relatorio r ON r.id = rl.relatorio_id
  LEFT JOIN (SELECT linha_id, count(*) c FROM fat_orcado GROUP BY linha_id) f
         ON f.linha_id = rl.id
  ORDER BY r.tenant_id, rl.codigo, COALESCE(f.c, 0) DESC, r.codigo
) s
JOIN linha_orcamentaria pai
     ON pai.tenant_id = s.tenant_id AND pai.codigo = s.pai_codigo
WHERE lo.tenant_id = s.tenant_id
  AND lo.codigo    = s.codigo
  AND s.pai_codigo IS NOT NULL;

-- 4) Ligar cada linha de relatório à linha mestre (por código)
ALTER TABLE relatorio_linha
  ADD COLUMN IF NOT EXISTS linha_orc_id uuid REFERENCES linha_orcamentaria ON DELETE SET NULL;

UPDATE relatorio_linha rl
SET linha_orc_id = lo.id
FROM relatorio r, linha_orcamentaria lo
WHERE r.id = rl.relatorio_id
  AND lo.tenant_id = r.tenant_id
  AND lo.codigo    = rl.codigo
  AND rl.linha_orc_id IS DISTINCT FROM lo.id;

CREATE INDEX IF NOT EXISTS idx_relatorio_linha_orc ON relatorio_linha (linha_orc_id);

COMMIT;

-- Conferência pós-migração (rode e veja se bate):
-- SELECT count(*) AS linhas_mestre FROM linha_orcamentaria;
-- SELECT count(*) AS linhas_sem_vinculo FROM relatorio_linha WHERE linha_orc_id IS NULL;
