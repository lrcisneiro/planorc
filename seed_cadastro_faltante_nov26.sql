-- ============================================================
-- SEED — cadastros que o razão de 2026 usa e o Planorc não tinha
--
-- POR QUE: a carga do realizado de nov/26 descartou 8 linhas por CONTA não
-- cadastrada (a conta é obrigatória: sem ela não há onde pendurar o
-- lançamento) e gravou 345 linhas com FILIAL/CC em branco, que não derrubam a
-- linha mas a deixam fora de qualquer recorte por filial ou centro de custo.
--
-- ⚠ A conta faltante é o que desequilibra SETEMBRO: a transferência de
-- R$ 500.000,00 na 11014012 (emp 05 · filial 2101) teve a contrapartida
-- importada e ela não, e o mês fechou com +500.000,12 em vez de zero.
--
-- NADA AQUI É INVENTADO. Código, descrição, conta superior e área saem dos
-- mestres do próprio export (`ContaContabil.csv`, `Filial.csv`,
-- `CentroCusto.csv` dentro de PROTHEUSRP.zip). Nome de cadastro escrito "a
-- gosto" é o que faz a próxima conciliação não casar.
--
-- ⚠ TENANT: no SQL Editor `current_tenant_id()` é NULL — o tenant sai da
-- tabela `tenant` (mesmo padrão da v3_158). Com a função, isto inseriria com
-- tenant nulo ou não inseriria nada, e em silêncio.
--
-- ⚠ PLANO: as contas vão SÓ no BRTOP. O mesmo código existe em BOTOP e PYTOP
-- (planos da Bolívia e do Paraguai) e o unique é (tenant, plano, codigo) — sem
-- fixar o plano, o `ON CONFLICT` escolheria por acaso qual linha atualizar, que
-- é a armadilha da v3_157.
--
-- Re-executável: `ON CONFLICT DO NOTHING` em todas as inserções.
-- Termina em SELECT.
-- ============================================================

-- 1) Contas contábeis (plano BRTOP) ---------------------------------------
--    `descricao` repete o padrão das vizinhas: "<código> - <DESCRIÇÃO DO ERP>".
INSERT INTO conta_contabil (tenant_id, plano_id, codigo, descricao, tipo, natureza, pai_id, ativo)
SELECT t.id, p.id, v.codigo, v.codigo || ' - ' || v.desc_erp, 'ANALITICA', v.natureza,
       (SELECT c.id FROM conta_contabil c
         WHERE c.tenant_id = t.id AND c.plano_id = p.id AND c.codigo = v.pai), true
  FROM (SELECT id FROM tenant ORDER BY criado_em LIMIT 1) t
  CROSS JOIN plano_contas p
  CROSS JOIN (VALUES
      ('11014012', 'APLIC.CDB BB MATRIZ SISTEMAS',             '11014', 'ATIVO'),
      ('11022021', 'IMPOSTOS JUDICIAIS ACAO TRF III',          '11022', 'ATIVO'),
      ('21016023', 'KL- PARTICIPACOES - COTAS EMPRESA SBSR2',  '21016', 'PASSIVO')
    ) AS v(codigo, desc_erp, pai, natureza)
 WHERE p.tenant_id = t.id AND p.codigo = 'BRTOP'
ON CONFLICT (tenant_id, plano_id, codigo) DO NOTHING;

-- 2) Filial 2004 -----------------------------------------------------------
-- ⚠ VAI PARA A EMPRESA 25 PORQUE É O QUE O DADO DIZ, não porque o nome
-- combine. O perfil do conversor remapa a empresa 08 → 25 no fim
-- (`empresa_remap_final`), então as 345 linhas chegam com empresa 25 e filial
-- 2004. Existe uma empresa **08 MARINGA sem nenhuma filial** no cadastro: se o
-- certo for pendurar a filial nela, o remap do perfil é que tem de sair — e aí
-- os lançamentos vão junto. Pendurar aqui e remapar lá deixaria
-- `filial.empresa_id` discordando de `fat_realizado.empresa_id`, que é a dívida
-- de grão filial×empresa já conhecida, sem FK composta para avisar.
-- `imp_fat` vem do mestre do ERP (6.65), não do padrão 5.65 das outras.
INSERT INTO filial (tenant_id, empresa_id, codigo, descricao, ativo, imp_fat)
SELECT t.id, e.id, '2004', 'WAYUP SERVICOS-MARINGA', true, 6.65
  FROM (SELECT id FROM tenant ORDER BY criado_em LIMIT 1) t
  JOIN empresa e ON e.tenant_id = t.id AND e.codigo = '25'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- 3) Centro de custo 110 ---------------------------------------------------
-- Irmão do 111 (mesmo pai 11 "Adminstrativo Geral"), então herda dele área,
-- divisão e BU — o ERP classifica o 110 como "3-CSC" e o cadastro daqui grava
-- esse eixo em `area_cod`/`area_nome`, que no ramo 11x é 1/CSC.
INSERT INTO centro_custo (tenant_id, codigo, descricao, tipo, pai_id, ativo,
                          area, area_cod, area_nome, divisao_cod, divisao_nome, bu_cod, bu_nome)
SELECT t.id, '110', 'DIRETORIA ADMINISTRATIVA', 'ANALITICA', irmao.pai_id, true,
       irmao.area, irmao.area_cod, irmao.area_nome,
       irmao.divisao_cod, irmao.divisao_nome, irmao.bu_cod, irmao.bu_nome
  FROM (SELECT id FROM tenant ORDER BY criado_em LIMIT 1) t
  JOIN centro_custo irmao ON irmao.tenant_id = t.id AND irmao.codigo = '111'
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- ---------------- conferência ----------------
SELECT 'conta ' || v.codigo AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM conta_contabil c
                           JOIN plano_contas p ON p.id = c.plano_id
                          WHERE c.codigo = v.codigo AND p.codigo = 'BRTOP')
            THEN 'cadastrada' ELSE '⛔ não entrou' END AS resultado
  FROM (VALUES ('11014012'), ('11022021'), ('21016023')) AS v(codigo)
UNION ALL
SELECT 'conta com pai',
       (SELECT count(*)::text || ' de 3 com conta superior ligada'
          FROM conta_contabil c JOIN plano_contas p ON p.id = c.plano_id
         WHERE p.codigo = 'BRTOP' AND c.pai_id IS NOT NULL
           AND c.codigo IN ('11014012','11022021','21016023'))
UNION ALL
SELECT 'filial 2004',
       coalesce((SELECT 'empresa ' || e.codigo || ' · ' || f.descricao
                   FROM filial f JOIN empresa e ON e.id = f.empresa_id
                  WHERE f.codigo = '2004'), '⛔ não entrou')
UNION ALL
SELECT 'centro de custo 110',
       coalesce((SELECT cc.descricao || ' · pai ' || coalesce(p.codigo,'—') || ' · área ' || coalesce(cc.area_nome,'—')
                   FROM centro_custo cc LEFT JOIN centro_custo p ON p.id = cc.pai_id
                  WHERE cc.codigo = '110'), '⛔ não entrou');
