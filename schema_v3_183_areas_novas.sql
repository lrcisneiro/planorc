-- ============================================================
-- v3_183 — Áreas novas e a casa dos 29 cargos sem plano
--
-- Decisões do Ricardo (05/nov/2026): EXECUTIVA, OPERAÇÕES e MERCADO
-- INTERNACIONAL viram ÁREAS; as outras seis pendências caem em subárea
-- existente (ver `scripts/cargo_mapa.py`, que é a fonte única desse de-para —
-- a migration, o conversor e a tabela de retorno ao RH leem de lá).
--
-- ⚠ CÓDIGO DE LETRA nas áreas novas (`E`, `O`, `M`). O código do plano é
-- área(1)+subárea(1)+sequencial(3) e vem do ERP; estas três o ERP não tem.
-- A letra deixa isso à vista, como `NOVO-nn` faz nos cargos — um oitavo
-- dígito inventado passaria por código de verdade.
--
-- Termina em SELECT.
-- ============================================================

INSERT INTO cargo_familia (tenant_id, codigo, nome)
SELECT (SELECT id FROM tenant), v.codigo, v.nome
  FROM (VALUES
  ('E', 'EXECUTIVA'),
  ('O', 'OPERAÇÕES'),
  ('M', 'MERCADO INTERNACIONAL'),
  ('E1', 'EXECUTIVA'),
  ('O1', 'OPERAÇÕES'),
  ('O2', 'EXPERIÊNCIA DO CLIENTE'),
  ('M1', 'FÁBRICA DE SOFTWARE')
) AS v(codigo, nome)
ON CONFLICT (tenant_id, codigo) DO UPDATE SET nome = EXCLUDED.nome;

-- os cargos `NOVO` ganham a área/subárea de quem os ocupa
UPDATE cargo c SET area_cod = v.area_cod, sub_cod = v.sub_cod
  FROM (VALUES
  ('ANALISTA DE DESENVOLVIMENTO EDUCACIONAL E CULTURA II', '2', '4'),
  ('ANALISTA DE DESENVOLVIMENTO ORGANIZACIONAL E EDUCACIONAL II', '2', '3'),
  ('ANALISTA DE INTELIGÊNCIA ARTIFICIAL II', '7', '2'),
  ('ANALISTA DE QUALIDADE DE SERVIÇOS I', 'M', '1'),
  ('ANALISTA DE RECRUTAMENTO E SELEÇÃO II', '2', '2'),
  ('ANALISTA DE SERVIÇOS', '4', '2'),
  ('ANALISTA DE SOLUÇÕES DE NEGÓCIOS I', '3', '2'),
  ('ANALISTA ENGENHEIRO DE VALOR III', '3', '4'),
  ('APRENDIZ', '4', '3'),
  ('ASSISTENTE COMERCIAL', '3', '2'),
  ('ASSISTENTE DE ATRAÇÃO E SELEÇÃO I', '2', '2'),
  ('ASSISTENTE DE CONTRATOS DE VENDAS I', '3', '2'),
  ('CONSULTOR DE VENDAS ESPECIALISTA', '3', '3'),
  ('COORDENADOR COMERCIAL', '3', '2'),
  ('COORDENADOR DE PROJETOS II', '4', '2'),
  ('COORDENADORA ADMINISTRATIVO DE PROJETOS E RMO', '6', '4'),
  ('DIRETOR ADMINISTRATIVO/FINANCEIRO', '1', '1'),
  ('DIRETOR EXECUTIVO', 'E', '1'),
  ('DIRETOR OPERAÇÕES', 'O', '1'),
  ('ESPECIALISTA DE INFRAESTRUTURA I', '4', '2'),
  ('ESPECIALISTA DE SERVIÇOS', '4', '2'),
  ('GERENTE DE PORTFÓLIO DE PROJETO', '4', '2'),
  ('GERENTE DE SOLUÇÕES DE NEGÓCIOS I', '3', '2'),
  ('GERENTE DE TI', '4', '2'),
  ('GERENTE EXECUTIVO', '1', '2'),
  ('MERCADO INTERNACIONAL', 'M', '1'),
  ('MOTORISTA', 'E', '1'),
  ('RECEPCIONISTA', '1', '2'),
  ('SECRETÁRIA', 'E', '1')
) AS v(nome, area_cod, sub_cod)
 WHERE upper(c.nome) = upper(v.nome) AND c.origem = 'NOVO';

SELECT 'v3_183 aplicada' AS resultado,
       (SELECT count(*) FROM cargo_familia) AS familias,
       (SELECT count(*) FROM cargo WHERE origem='NOVO' AND area_cod IS NOT NULL) AS novos_com_area,
       (SELECT count(*) FROM cargo WHERE origem='NOVO' AND area_cod IS NULL) AS novos_sem_area;
