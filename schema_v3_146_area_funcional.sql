-- ============================================================
-- v3_146 — Área funcional: o terceiro eixo
--
-- Três estruturas respondem perguntas diferentes, e misturá-las foi o que
-- quase aconteceu:
--   · `centro_custo` — ONDE O DINHEIRO CAI. Cortado por negócio: nível 2 é
--     Base × Novos, nível 3 é produto (PC Sistemas, HXM, ERP Tradicional…).
--     Existe, 84 nós.
--   · `cargo`        — O QUE A PESSOA É (carreira). Em reestruturação.
--   · `area_funcional` — ONDE A PESSOA TRABALHA. É o organograma funcional de
--     out/26, e não existia em lugar nenhum. 37 nós, esta migration.
--
-- Os dois primeiros se cruzam só em parte, e cada um é mais detalhado onde o
-- outro é cego: o CC tem 50+ nós de segmentação comercial que o organograma não
-- tem, e o organograma separa Financeiro, Contabilidade, Facilities, Jurídico e
-- Administração de Gente — que no CC estão TODOS dentro do 111 "Administrativo
-- Geral", 27 postos numa caixa só. Por isso o apontador vai no POSTO e não no
-- CC: no 111 o centro de custo não determina a área.
--
-- Decisão do dono da estrutura: METODOLOGIA fica em Experiência do Cliente
-- (como no CC 133), não em Diretoria de Serviços como estava no desenho.
--
-- ⚠ Dois nomes se repetem de propósito, porque se repetem na empresa:
-- DESENVOLVIMENTO (em Serviços e em TI) e PROSPECÇÃO (em Comercial e em
-- Marketing). O código distingue; a tela mostra o caminho.
--
-- Códigos no padrão do CC (1 / 11 / 111), que é o que a casa já lê.
--
-- Termina em SELECT.
-- ============================================================

CREATE TABLE IF NOT EXISTS area_funcional (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo    text NOT NULL,
  nome      text NOT NULL,
  pai_id    uuid REFERENCES area_funcional(id) ON DELETE SET NULL,
  ativo     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, codigo)
);

ALTER TABLE area_funcional ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS area_funcional_sel ON area_funcional;
CREATE POLICY area_funcional_sel ON area_funcional FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));
DROP POLICY IF EXISTS area_funcional_ins ON area_funcional;
CREATE POLICY area_funcional_ins ON area_funcional FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));
DROP POLICY IF EXISTS area_funcional_upd ON area_funcional;
CREATE POLICY area_funcional_upd ON area_funcional FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));
DROP POLICY IF EXISTS area_funcional_del ON area_funcional;
CREATE POLICY area_funcional_del ON area_funcional FOR DELETE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND (SELECT eh_admin()));

-- Mesma trava de ciclo dos cargos: árvore sem laço não é detalhe, é o que
-- impede a tela de recursar até travar.
CREATE OR REPLACE FUNCTION area_funcional_sem_ciclo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_pai uuid := NEW.pai_id; v_saltos int := 0;
BEGIN
  IF NEW.pai_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.pai_id = NEW.id THEN RAISE EXCEPTION 'Uma área não pode ser pai de si mesma.'; END IF;
  WHILE v_pai IS NOT NULL AND v_saltos < 50 LOOP
    IF v_pai = NEW.id THEN RAISE EXCEPTION 'Movimento criaria um ciclo na árvore de áreas.'; END IF;
    SELECT pai_id INTO v_pai FROM area_funcional WHERE id = v_pai;
    v_saltos := v_saltos + 1;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_area_funcional_sem_ciclo ON area_funcional;
CREATE TRIGGER trg_area_funcional_sem_ciclo
  BEFORE INSERT OR UPDATE OF pai_id ON area_funcional
  FOR EACH ROW EXECUTE FUNCTION area_funcional_sem_ciclo();

ALTER TABLE posto ADD COLUMN IF NOT EXISTS area_func_id uuid REFERENCES area_funcional(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_posto_area_func ON posto (area_func_id) WHERE area_func_id IS NOT NULL;

-- ── Seed: o organograma funcional de outubro/26 ──
-- Duas passadas: primeiro todos os nós sem pai, depois o pai por código. É o
-- que evita depender da ordem de inserção para resolver a auto-referência.
INSERT INTO area_funcional (tenant_id, codigo, nome) VALUES
  ('11111111-1111-1111-1111-111111111111', '1',    'DIRETORIA EXECUTIVA'),
  ('11111111-1111-1111-1111-111111111111', '11',   'DIRETORIA DE SERVIÇOS'),
  ('11111111-1111-1111-1111-111111111111', '111',  'SERVIÇOS DE IMPLANTAÇÃO'),
  ('11111111-1111-1111-1111-111111111111', '112',  'SUPORTE TÉCNICO'),
  ('11111111-1111-1111-1111-111111111111', '113',  'DESENVOLVIMENTO (SERVIÇOS)'),
  ('11111111-1111-1111-1111-111111111111', '12',   'DIRETORIA COMERCIAL'),
  ('11111111-1111-1111-1111-111111111111', '121',  'VENDAS'),
  ('11111111-1111-1111-1111-111111111111', '122',  'CROSS SALES'),
  ('11111111-1111-1111-1111-111111111111', '123',  'CUSTOMER SUCCESS'),
  ('11111111-1111-1111-1111-111111111111', '124',  'PROSPECÇÃO (COMERCIAL)'),
  ('11111111-1111-1111-1111-111111111111', '125',  'ENGENHARIA DE VALOR'),
  ('11111111-1111-1111-1111-111111111111', '126',  'GESTÃO DE RECEITAS E APURAÇÃO DE RESULTADOS'),
  ('11111111-1111-1111-1111-111111111111', '13',   'DIRETORIA FINANCEIRA'),
  ('11111111-1111-1111-1111-111111111111', '131',  'CONTROLES FINANCEIROS E ADM'),
  ('11111111-1111-1111-1111-111111111111', '1311', 'FINANCEIRO'),
  ('11111111-1111-1111-1111-111111111111', '1312', 'CONTABILIDADE'),
  ('11111111-1111-1111-1111-111111111111', '1313', 'ADMINISTRATIVO E FINANCEIRO'),
  ('11111111-1111-1111-1111-111111111111', '1314', 'FACILITIES'),
  ('11111111-1111-1111-1111-111111111111', '1315', 'ADMINISTRAÇÃO DE GENTE E BENEFÍCIOS'),
  ('11111111-1111-1111-1111-111111111111', '1316', 'JURÍDICO'),
  ('11111111-1111-1111-1111-111111111111', '14',   'DIRETORIA MERCADO INTERNACIONAL'),
  ('11111111-1111-1111-1111-111111111111', '141',  'FÁBRICA DE SOFTWARE'),
  ('11111111-1111-1111-1111-111111111111', '15',   'MARKETING'),
  ('11111111-1111-1111-1111-111111111111', '151',  'MARKETING EVENTOS'),
  ('11111111-1111-1111-1111-111111111111', '152',  'PROSPECÇÃO (MARKETING)'),
  ('11111111-1111-1111-1111-111111111111', '16',   'RELAÇÕES HUMANAS'),
  ('11111111-1111-1111-1111-111111111111', '161',  'TALENT'),
  ('11111111-1111-1111-1111-111111111111', '162',  'SOLUÇÕES EDUCACIONAIS'),
  ('11111111-1111-1111-1111-111111111111', '163',  'CULTURA E ENGAJAMENTO'),
  ('11111111-1111-1111-1111-111111111111', '17',   'DIRETORIA OPERACIONAL'),
  ('11111111-1111-1111-1111-111111111111', '171',  'TECNOLOGIA DA INFORMAÇÃO'),
  ('11111111-1111-1111-1111-111111111111', '1711', 'DESENVOLVIMENTO (TI)'),
  ('11111111-1111-1111-1111-111111111111', '1712', 'INFRAESTRUTURA'),
  ('11111111-1111-1111-1111-111111111111', '1713', 'INTELIGÊNCIA DE DADOS'),
  ('11111111-1111-1111-1111-111111111111', '172',  'EXPERIÊNCIA DO CLIENTE'),
  ('11111111-1111-1111-1111-111111111111', '1721', 'RMO'),
  ('11111111-1111-1111-1111-111111111111', '1722', 'METODOLOGIA')
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Pai por código, com os de-para explícitos (nada de derivar do prefixo:
-- "1311" sob "131" até funcionaria, mas "152" sob "15" e "1722" sob "172"
-- dependeriam da mesma regra, e basta um código fora do padrão para calar).
UPDATE area_funcional f SET pai_id = p.id
  FROM (VALUES
    ('11','1'), ('12','1'), ('13','1'), ('14','1'), ('15','1'), ('16','1'), ('17','1'),
    ('111','11'), ('112','11'), ('113','11'),
    ('121','12'), ('122','12'), ('123','12'), ('124','12'), ('125','12'), ('126','12'),
    ('131','13'),
    ('1311','131'), ('1312','131'), ('1313','131'), ('1314','131'), ('1315','131'), ('1316','131'),
    ('141','14'),
    ('151','15'), ('152','15'),
    ('161','16'), ('162','16'), ('163','16'),
    ('171','17'), ('172','17'),
    ('1711','171'), ('1712','171'), ('1713','171'),
    ('1721','172'), ('1722','172')
  ) AS m(filho, pai)
  JOIN area_funcional p ON p.codigo = m.pai AND p.tenant_id = f.tenant_id
 WHERE f.codigo = m.filho AND f.pai_id IS DISTINCT FROM p.id;

SELECT coalesce(p.codigo, '—') AS pai, f.codigo, f.nome
  FROM area_funcional f LEFT JOIN area_funcional p ON p.id = f.pai_id
 ORDER BY length(f.codigo), f.codigo;
