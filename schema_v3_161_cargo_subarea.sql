-- ============================================================
-- v3_161 — Um cargo por SUBÁREA, e o código do ERP como identidade
--
-- "Não podemos misturar cargos de áreas diferentes" — e `AUXILIAR
-- ADMINISTRATIVO` era UM cargo com 24 códigos de SEIS subáreas. A v3_158
-- decidiu o contrário ("criar 957 cargos encheria o catálogo") e a decisão era
-- minha para não tomar: conformidade da estrutura é de quem a define.
--
-- O código do ERP lê-se **A · S · NNN**: `12073` = área 1, subárea 2,
-- sequencial 073. Então ele JÁ carrega o eixo que faltava, e a separação sai
-- dele, sem julgamento: o grão do cargo é (subárea, nome).
--
-- Três consequências, nesta ordem:
--
-- 1. `cargo.codigo` deixa de ser o slug que a v3_156 derivou do NOME e passa a
--    ser o **código real do step 1** (`DIRETOR FINANCEIRO` = `11001`). Era a
--    pergunta que ficou sem resposta na v3_158; "use o código completo" é a
--    resposta. Nada referencia `cargo.codigo` além da tela, então é seguro —
--    e um identificador que não concilia com nada não valia a pena preservar.
--    Cargo SEM step (os 45 do plano e os 103 da folha) mantém o slug.
--
-- 2. `UNIQUE (cargo_id, step)` VOLTA. A v3_158 teve de abandoná-la porque um
--    cargo tinha seis step 1; com o grão certo, um cargo tem um step 1. Que a
--    restrição natural volte a caber é o sinal de que o grão agora está certo.
--
-- 3. Os postos. 59 vivos estavam em cargo multi-subárea e cada um precisa de
--    UM destino. 32 saem do dado — o mapa área funcional → subárea derivado
--    dos cargos de subárea ÚNICA — e 27 não, quase todos em DESENVOLVIMENTO DE
--    SOFTWARE, que existe em 42, 43, 44 e 71. Esses 27 **ficam onde estão** e o
--    SELECT final os nomeia. ⚠ Não invento destino: trocar o cargo de alguém em
--    silêncio é pior que deixar visível o que falta decidir. O conserto
--    definitivo chega com `posto.cargo_step_id` vindo do ERP, e aí o código
--    decide sozinho.
--
-- ⚠ Área funcional NÃO serve como eixo do cargo — testado, não suposto: o
-- bloco 42 hospeda gente em SERVIÇOS DE IMPLANTAÇÃO (84), SUPORTE TÉCNICO (5) e
-- FÁBRICA DE SOFTWARE (1); o 71 em três subáreas de TI. São eixos diferentes:
-- área funcional é ONDE A PESSOA TRABALHA, subárea é A QUE FAMÍLIA O CARGO
-- PERTENCE. Forçar 1:1 quebraria os dois.
--
-- Os nomes de `cargo_familia` são PROPOSTA minha, tirados do cargo que abre
-- cada bloco — `44` e `47` são chute explícito. A tela edita.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE cargo ADD COLUMN IF NOT EXISTS area_cod text;
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS sub_cod  text;

CREATE TABLE IF NOT EXISTS cargo_familia (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo    text NOT NULL,          -- 1 dígito = área · 2 dígitos = subárea
  nome      text NOT NULL,
  UNIQUE (tenant_id, codigo)
);
ALTER TABLE cargo_familia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cf_sel ON cargo_familia;
CREATE POLICY cf_sel ON cargo_familia FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));
DROP POLICY IF EXISTS cf_ins ON cargo_familia;
CREATE POLICY cf_ins ON cargo_familia FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()));
DROP POLICY IF EXISTS cf_upd ON cargo_familia;
CREATE POLICY cf_upd ON cargo_familia FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()));
DROP POLICY IF EXISTS cf_del ON cargo_familia;
CREATE POLICY cf_del ON cargo_familia FOR DELETE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever()));

CREATE TEMP TABLE _fam (codigo text, nome text) ON COMMIT DROP;
INSERT INTO _fam VALUES
  ('1','ADMINISTRATIVO E FINANCEIRO'),
  ('2','RELACOES HUMANAS'),
  ('3','COMERCIAL'),
  ('4','SERVICOS'),
  ('5','MARKETING'),
  ('6','EXPERIENCIA DO CLIENTE'),
  ('7','TECNOLOGIA DA INFORMACAO'),
  ('11','DIRETORIA FINANCEIRA'),
  ('12','ADMINISTRATIVO FINANCEIRO'),
  ('13','CONTABIL'),
  ('14','ADMINISTRACAO DE GENTE'),
  ('15','FACILITIES'),
  ('16','JURIDICO'),
  ('21','DIRETORIA DE RELACOES HUMANAS'),
  ('22','ATRACAO E SELECAO'),
  ('23','SOLUCOES EDUCACIONAIS'),
  ('24','DESENVOLVIMENTO ORGANIZACIONAL E CULTURA'),
  ('31','DIRETORIA COMERCIAL'),
  ('32','SOLUCOES DE NEGOCIOS'),
  ('33','VENDAS'),
  ('34','ENGENHARIA DE VALOR'),
  ('35','CONTRATOS DE VENDAS'),
  ('36','CUSTOMER SUCCESS'),
  ('37','PROSPECCAO DE NEGOCIOS'),
  ('41','DIRETORIA DE SERVICOS'),
  ('42','PROJETOS'),
  ('43','SUPORTE TECNICO'),
  ('44','DESENVOLVIMENTO E QUALIDADE'),
  ('45','METODOLOGIA E PROCESSOS'),
  ('46','ADMINISTRATIVO DE PROJETOS E RMO'),
  ('47','ADMINISTRATIVO (SERVICOS)'),
  ('51','MARKETING'),
  ('52','MARKETING DE EVENTOS'),
  ('53','PROSPECCAO (MARKETING)'),
  ('61','EXPERIENCIA DO CLIENTE'),
  ('62','CUSTOMER SUCCESS (CX)'),
  ('71','TECNOLOGIA DA INFORMACAO');

INSERT INTO cargo_familia (tenant_id, codigo, nome)
SELECT t.id, f.codigo, f.nome FROM _fam f CROSS JOIN tenant t
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- ── Split ───────────────────────────────────────────────────
-- Grupo PRINCIPAL = o que tem mais steps (desempate: menor subárea). Ele fica
-- com o cargo existente, para que os postos que já apontam continuem válidos.
CREATE TEMP TABLE _g ON COMMIT DROP AS
SELECT cargo_id, grupo, count(*) AS n, min(codigo) AS cod0 FROM cargo_step GROUP BY 1,2;

CREATE TEMP TABLE _princ ON COMMIT DROP AS
SELECT DISTINCT ON (cargo_id) cargo_id, grupo, cod0 FROM _g ORDER BY cargo_id, n DESC, grupo;

-- A. o cargo existente adota o código do step 1 do seu grupo principal
UPDATE cargo c SET codigo = p.cod0, area_cod = left(p.grupo,1), sub_cod = p.grupo
  FROM _princ p WHERE p.cargo_id = c.id;

-- B. um cargo novo para cada grupo que sobrou
INSERT INTO cargo (tenant_id, codigo, nome, nivel, salario_ref, ativo, origem, area_cod, sub_cod)
SELECT c.tenant_id, g.cod0, c.nome, c.nivel, c.salario_ref, c.ativo, c.origem,
       left(g.grupo,1), g.grupo
  FROM _g g
  JOIN cargo c ON c.id = g.cargo_id
  LEFT JOIN _princ p ON p.cargo_id = g.cargo_id AND p.grupo = g.grupo
 WHERE p.cargo_id IS NULL
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- C. os steps seguem para o cargo da sua subárea.
-- ⚠ UPDATE ... FROM: a tabela alvo (`s`) só pode aparecer no WHERE, nunca na
-- condição do JOIN. Errei isso três vezes nesta base; `_g` e `nc` se juntam
-- entre si, `s` fica de fora.
UPDATE cargo_step s SET cargo_id = nc.id
  FROM _g g JOIN cargo nc ON nc.codigo = g.cod0
 WHERE s.cargo_id = g.cargo_id AND s.grupo = g.grupo AND nc.id <> s.cargo_id;

-- D. os 32 postos que o dado resolve
CREATE TEMP TABLE _uni ON COMMIT DROP AS
SELECT cargo_id, min(grupo) AS grupo FROM _g GROUP BY cargo_id HAVING count(*) = 1;

CREATE TEMP TABLE _mapa ON COMMIT DROP AS
SELECT DISTINCT ON (area_func_id) area_func_id, grupo FROM (
  SELECT p.area_func_id, u.grupo, count(*) AS n
    FROM posto p JOIN _uni u ON u.cargo_id = p.cargo_id
   WHERE coalesce(p.sit_folha,'') <> 'D' AND p.area_func_id IS NOT NULL
   GROUP BY 1,2) x ORDER BY area_func_id, n DESC;

CREATE TEMP TABLE _mover ON COMMIT DROP AS
SELECT p.id AS posto_id, p.nome, c.nome AS cargo_nome, m.grupo,
       (SELECT d.id FROM cargo d
         WHERE d.nome = c.nome AND d.sub_cod = m.grupo AND d.tenant_id = c.tenant_id) AS destino
  FROM posto p
  JOIN cargo c ON c.id = p.cargo_id
  JOIN _mapa m ON m.area_func_id = p.area_func_id
 WHERE coalesce(p.sit_folha,'') <> 'D'
   AND EXISTS (SELECT 1 FROM _g g WHERE g.cargo_id = p.cargo_id AND g.grupo = m.grupo)
   AND (SELECT count(*) FROM _g g WHERE g.cargo_id = p.cargo_id) > 1;

UPDATE posto p SET cargo_id = v.destino
  FROM _mover v WHERE p.id = v.posto_id AND v.destino IS NOT NULL AND v.destino <> p.cargo_id;

-- E. a restrição natural volta a caber
DO $$ BEGIN
  ALTER TABLE cargo_step ADD CONSTRAINT cargo_step_cargo_step_uq UNIQUE (cargo_id, step);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

SELECT 'cargos no total (era 326)' AS secao, count(*)::text AS resultado FROM cargo
UNION ALL SELECT 'cargos com subárea (era 178)', (SELECT count(*)::text FROM cargo WHERE sub_cod IS NOT NULL)
UNION ALL SELECT 'cargo ainda com mais de uma subárea (esperado: 0)',
  (SELECT count(*)::text FROM (SELECT cargo_id FROM cargo_step GROUP BY 1 HAVING count(DISTINCT grupo) > 1) x)
UNION ALL SELECT 'postos repontados', (SELECT count(*)::text FROM _mover WHERE destino IS NOT NULL)
UNION ALL SELECT 'famílias (7 áreas + 30 subáreas)', (SELECT count(*)::text FROM cargo_familia)
UNION ALL SELECT '⚠ postos em cargo multi-subárea SEM destino — conferir no Quadro',
  (SELECT coalesce(string_agg(DISTINCT p.nome || ' (' || c.nome || ')', ' · '), 'nenhum')
     FROM posto p JOIN cargo c ON c.id = p.cargo_id
    WHERE coalesce(p.sit_folha,'') <> 'D'
      AND EXISTS (SELECT 1 FROM cargo_step s WHERE s.cargo_id = p.cargo_id)
      AND p.id NOT IN (SELECT posto_id FROM _mover WHERE destino IS NOT NULL)
      AND c.nome IN (SELECT nome FROM cargo GROUP BY nome HAVING count(DISTINCT sub_cod) > 1));
