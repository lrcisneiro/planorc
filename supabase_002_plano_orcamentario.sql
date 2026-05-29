-- Inserção do Plano Orçamentário
-- Passo 1: inserir sem pai (para obter os UUIDs)

DO $$
DECLARE
  v_1 UUID;
  v_101 UUID;
  v_10101 UUID;
  v_10102 UUID;
  v_102 UUID;
  v_10201 UUID;
  v_10202 UUID;
  v_10203 UUID;
  v_103 UUID;
  v_10301 UUID;
  v_105 UUID;
  v_10501 UUID;
  v_106 UUID;
  v_10601 UUID;
  v_107 UUID;
  v_10701 UUID;
  v_110 UUID;
  v_11001 UUID;
  v_11002 UUID;
  v_11003 UUID;
  v_11004 UUID;
  v_11005 UUID;
  v_11006 UUID;
  v_11007 UUID;
  v_11008 UUID;
  v_11011 UUID;
  v_11020 UUID;
  v_111 UUID;
  v_11101 UUID;
  v_11102 UUID;
  v_115 UUID;
  v_11501 UUID;
  v_116 UUID;
  v_11601 UUID;
  v_120 UUID;
  v_12001 UUID;
  v_121 UUID;
  v_12101 UUID;
  v_122 UUID;
  v_12201 UUID;
  v_130 UUID;
  v_13001 UUID;
  v_199 UUID;
  v_19901 UUID;
  v_19902 UUID;
  v_2 UUID;
  v_201 UUID;
  v_20101 UUID;
  v_202 UUID;
  v_20201 UUID;
  v_203 UUID;
  v_20301 UUID;
  v_204 UUID;
  v_20401 UUID;
  v_205 UUID;
  v_20501 UUID;
  v_206 UUID;
  v_20601 UUID;
  v_20602 UUID;
  v_20603 UUID;
  v_20604 UUID;
  v_20605 UUID;
  v_20606 UUID;
  v_207 UUID;
  v_20701 UUID;
  v_208 UUID;
  v_20801 UUID;
  v_209 UUID;
  v_20901 UUID;
  v_210 UUID;
  v_21001 UUID;
  v_220 UUID;
  v_22001 UUID;
  v_22002 UUID;
  v_22003 UUID;
  v_22004 UUID;
  v_22005 UUID;
  v_22006 UUID;
  v_22007 UUID;
  v_22008 UUID;
  v_22009 UUID;
  v_22010 UUID;
  v_22011 UUID;
  v_22012 UUID;
  v_22013 UUID;
  v_22014 UUID;
  v_22015 UUID;
  v_22016 UUID;
  v_22017 UUID;
  v_22018 UUID;
  v_22019 UUID;
  v_22020 UUID;
  v_22021 UUID;
  v_22022 UUID;
  v_22023 UUID;
  v_22024 UUID;
  v_22025 UUID;
  v_22026 UUID;
  v_22027 UUID;
  v_22028 UUID;
  v_22029 UUID;
  v_22030 UUID;
  v_22031 UUID;
  v_22032 UUID;
  v_22033 UUID;
  v_22034 UUID;
  v_22035 UUID;
  v_22036 UUID;
  v_22037 UUID;
  v_22038 UUID;
  v_22039 UUID;
  v_22040 UUID;
  v_22041 UUID;
  v_22042 UUID;
  v_22043 UUID;
  v_22044 UUID;
  v_22045 UUID;
  v_230 UUID;
  v_23001 UUID;
  v_23002 UUID;
  v_23003 UUID;
  v_232 UUID;
  v_23201 UUID;
  v_299 UUID;
  v_29901 UUID;
  v_3 UUID;
  v_301 UUID;
  v_30101 UUID;
  v_302 UUID;
  v_30201 UUID;
  v_30202 UUID;
  v_30203 UUID;
  v_30204 UUID;
  v_30205 UUID;
  v_30206 UUID;
  v_30207 UUID;
  v_30208 UUID;
  v_30209 UUID;
  v_4 UUID;
  v_401 UUID;
  v_40101 UUID;
BEGIN

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, natureza, aceita_lancamento)
    VALUES ('1', 'Receita', 1, 'RECEITA', false)
    RETURNING id INTO v_1;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, natureza, aceita_lancamento)
    VALUES ('2', 'Despesas', 1, 'DESPESA', false)
    RETURNING id INTO v_2;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, natureza, aceita_lancamento)
    VALUES ('3', 'Resultado Financeiro', 1, 'NEUTRO', false)
    RETURNING id INTO v_3;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, natureza, aceita_lancamento)
    VALUES ('4', 'CUSTO DE IMPOSTOS S/RESULTADO', 1, 'NEUTRO', false)
    RETURNING id INTO v_4;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('101', 'Receita Não Recorrente', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_101;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('102', 'Receita Recorrente TOTVS SA', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_102;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('103', 'Receita Recorrente de Servicos', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_103;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('105', 'Receita Campanha Arco', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_105;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('106', 'Receita TechFin', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_106;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('107', 'Programa Acelerar', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_107;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('110', 'Receita de Servicos', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_110;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('111', 'Reembolso de despesas', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_111;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('115', 'Saldo Buffer / Backlog Receita', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_115;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('116', 'Reembolso de viagens via ND', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_116;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('120', 'Outras', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_120;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('121', 'Despesas Recuperadas', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_121;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('122', 'Estornos de Vendas', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_122;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('130', '( - ) Custos impostos s/ faturamento (PIS/COFINS/ISS)', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_130;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('199', 'Repasses receitas outras unidades', 2, v_1, '1', 'NEUTRO', false)
    RETURNING id INTO v_199;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('201', 'Salarios e Ordenados', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_201;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('202', 'Encargos e Benefícios', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_202;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('203', 'Terceiros Internos', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_203;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('204', 'Terceiros Externos', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_204;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('205', 'Viagens', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_205;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('206', 'Marketing', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_206;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('207', 'Pagamento Roaylties', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_207;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('208', 'Baixa títulos não recebidos', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_208;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('209', 'Repasse custo atendimento entre unidadees', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_209;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('210', 'Outras', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_210;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('220', 'Despesas Administrativas', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_220;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('230', 'Outras Despesas', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_230;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('232', '**Livre', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_232;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('299', 'Rateio gerenciais entre unidades', 2, v_2, '2', 'NEUTRO', false)
    RETURNING id INTO v_299;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('301', 'Receitas Financeiras', 2, v_3, '3', 'NEUTRO', false)
    RETURNING id INTO v_301;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('302', 'Despesas Financeiras', 2, v_3, '3', 'NEUTRO', false)
    RETURNING id INTO v_302;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, natureza, aceita_lancamento)
    VALUES ('401', 'IMPOSTOS S/RESULTADO', 2, v_4, '4', 'NEUTRO', false)
    RETURNING id INTO v_401;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10101', 'Receita Não Recorrente', 3, v_101, '', '101', 'NEUTRO', true, false)
    RETURNING id INTO v_10101;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10102', 'Receita Nao Recorrente Comissoes Vendas', 3, v_101, '', '101', 'NEUTRO', true, false)
    RETURNING id INTO v_10102;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10201', 'Receita Recorrente TOTVS SA', 3, v_102, '', '102', 'NEUTRO', true, false)
    RETURNING id INTO v_10201;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10202', 'Receita Recorrente Dev. Partner', 3, v_102, '', '102', 'NEUTRO', true, false)
    RETURNING id INTO v_10202;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10203', 'Receita Recorrente- Repasse BU RD Outros', 3, v_102, '', '102', 'NEUTRO', true, false)
    RETURNING id INTO v_10203;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10301', 'Receita Recorrente Templates', 3, v_103, '', '103', 'NEUTRO', true, false)
    RETURNING id INTO v_10301;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10501', 'Receita Campanha Arco', 3, v_105, '', '105', 'NEUTRO', true, false)
    RETURNING id INTO v_10501;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10601', 'Receita TechFin', 3, v_106, '', '106', 'NEUTRO', true, false)
    RETURNING id INTO v_10601;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('10701', 'Programa Acelerar', 3, v_107, '', '107', 'NEUTRO', true, false)
    RETURNING id INTO v_10701;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11001', 'Servicos Horas Abertas', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11001;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11002', 'Servicos Projetos Fechados', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11002;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11003', 'Servicos Outsorcing', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11003;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11004', 'Servicos Banco de Horas', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11004;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11005', 'Servicos Fabrica de Software', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11005;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11006', 'Servicos Sustentacao', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11006;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11007', 'Servicos Templates Adesao', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11007;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11008', 'Servicos Assessoria MKT', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11008;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11011', 'Servicos Template (Recorrencia)', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11011;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11020', 'Reembolso Despesas de Viagens c/ NF', 3, v_110, '', '110', 'NEUTRO', true, false)
    RETURNING id INTO v_11020;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11101', '**LIVRE', 3, v_111, '', '111', 'NEUTRO', true, false)
    RETURNING id INTO v_11101;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11102', '**LIVRE', 3, v_111, '', '111', 'NEUTRO', true, false)
    RETURNING id INTO v_11102;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11501', 'Saldo Buffer / Backlog Receita', 3, v_115, '', '115', 'NEUTRO', true, false)
    RETURNING id INTO v_11501;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('11601', 'Reembolso de viagens via ND', 3, v_116, '', '116', 'NEUTRO', true, false)
    RETURNING id INTO v_11601;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('12001', 'Outras', 3, v_120, '', '120', 'NEUTRO', true, false)
    RETURNING id INTO v_12001;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('12101', 'Despesas Recuperadas', 3, v_121, '', '121', 'NEUTRO', true, false)
    RETURNING id INTO v_12101;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('12201', 'Titulos baixados para PDD', 3, v_122, '', '122', 'NEUTRO', true, false)
    RETURNING id INTO v_12201;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('13001', '( - ) Custos impostos s/ faturamento (PIS/COFINS/ISS)', 3, v_130, '', '130', 'NEUTRO', true, false)
    RETURNING id INTO v_13001;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('19901', 'Repasses receitas outras unidades', 3, v_199, '', '199', 'NEUTRO', true, false)
    RETURNING id INTO v_19901;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('19902', 'Encontro de Contas Paraguai X Bolivia', 3, v_199, '', '199', 'NEUTRO', true, false)
    RETURNING id INTO v_19902;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20101', 'Salarios e Ordenados', 3, v_201, '', '201', 'NEUTRO', true, true)
    RETURNING id INTO v_20101;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20201', 'Encargos e Benefícios', 3, v_202, '', '202', 'NEUTRO', true, true)
    RETURNING id INTO v_20201;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20301', 'Terceiros Internos', 3, v_203, '', '203', 'NEUTRO', true, true)
    RETURNING id INTO v_20301;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20401', 'Terceiros Externos', 3, v_204, '', '204', 'NEUTRO', true, true)
    RETURNING id INTO v_20401;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20501', 'Viagens', 3, v_205, '', '205', 'NEUTRO', true, true)
    RETURNING id INTO v_20501;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20601', 'Feiras e eventos', 3, v_206, '', '206', 'NEUTRO', true, true)
    RETURNING id INTO v_20601;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20602', 'Divulgação da Marca', 3, v_206, '', '206', 'NEUTRO', true, true)
    RETURNING id INTO v_20602;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20603', 'Material de apoio a Venda', 3, v_206, '', '206', 'NEUTRO', true, true)
    RETURNING id INTO v_20603;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20604', 'Patrocínios/Brindes/Doações', 3, v_206, '', '206', 'NEUTRO', true, true)
    RETURNING id INTO v_20604;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20605', 'Outros', 3, v_206, '', '206', 'NEUTRO', true, true)
    RETURNING id INTO v_20605;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20606', 'Comarketing', 3, v_206, '', '206', 'NEUTRO', true, true)
    RETURNING id INTO v_20606;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20701', 'Pagamento Roaylties', 3, v_207, '', '207', 'NEUTRO', true, true)
    RETURNING id INTO v_20701;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20801', 'Baixa títulos não recebidos', 3, v_208, '', '208', 'NEUTRO', true, true)
    RETURNING id INTO v_20801;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('20901', 'Repasse custo atendimento entre unidadees', 3, v_209, '', '209', 'NEUTRO', true, true)
    RETURNING id INTO v_20901;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('21001', 'Outras', 3, v_210, '', '210', 'NEUTRO', true, true)
    RETURNING id INTO v_21001;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22001', 'Aluguel de equipamentos', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22001;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22002', 'Manutenção de equipamentos', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22002;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22003', 'Manutençao de Software', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22003;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22004', 'Aluguel de imóveis', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22004;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22005', 'Taxa de condomínio', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22005;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22006', 'Manutenção de imóveis', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22006;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22007', 'Energia elétrica', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22007;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22008', 'Serviços de limpeza/jardinagem', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22008;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22009', 'Fatura de água', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22009;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22010', 'Segurança/Alarme', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22010;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22011', 'IPTU/Taxas Municipais', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22011;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22012', 'Seguro de imóveis', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22012;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22013', 'Outras/Diversas nova sede', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22013;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22014', 'Manutenção de veículos', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22014;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22015', 'Impostos/Taxas/Licenciamentos', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22015;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22016', 'Serviços Despachantes', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22016;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22017', 'Seguros', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22017;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22018', 'Multas de trânsitos', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22018;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22019', 'Estacionamento', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22019;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22020', 'Material de escritório', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22020;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22021', 'Material de limpeza/copa e cozinha', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22021;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22022', 'Periféricos de informática/telecomunic.', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22022;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22023', 'Materiais primeiros socorros', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22023;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22024', 'Uniformes', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22024;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22025', 'Moveis e utensilios de pequeno valor', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22025;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22026', 'Telefonia fixa', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22026;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22027', 'Telefonia móvel', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22027;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22028', 'Internet/Link', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22028;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22029', 'Correio/moto taxi', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22029;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22030', 'Assinaturas jornais/revistas', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22030;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22031', 'Associação de classes', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22031;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22032', 'Despesas cartorária', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22032;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22033', 'Outras', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22033;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22034', 'Honorários advocatícios', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22034;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22035', 'Honorários contábeis', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22035;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22036', 'Medicina ocupacional', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22036;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22037', 'Consultorias externas', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22037;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22038', 'Outros', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22038;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22039', 'Treinamentos pessoal interno', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22039;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22040', 'Custo formação de trainne', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22040;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22041', 'Custo recrutamento e seleção', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22041;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22042', 'Endomarketing', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22042;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22043', 'Programas Incentivos qualidade de vida', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22043;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22044', 'Confraternizaçoes', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22044;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('22045', 'CONTRIBUICOES/DOACOES/BRINDES', 3, v_220, '', '220', 'NEUTRO', true, true)
    RETURNING id INTO v_22045;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('23001', 'Custos empresa avião', 3, v_230, '', '230', 'NEUTRO', true, true)
    RETURNING id INTO v_23001;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('23002', 'Outras Despesas Diretoria', 3, v_230, '', '230', 'NEUTRO', true, true)
    RETURNING id INTO v_23002;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('23003', 'Reserva Diretoria', 3, v_230, '', '230', 'NEUTRO', true, true)
    RETURNING id INTO v_23003;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('23201', '**Livre', 3, v_232, '', '232', 'NEUTRO', true, true)
    RETURNING id INTO v_23201;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('29901', 'Rateio gerenciais entre unidades', 3, v_299, '', '299', 'NEUTRO', true, true)
    RETURNING id INTO v_29901;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30101', 'Receitas Financeiras', 3, v_301, '', '301', 'NEUTRO', true, false)
    RETURNING id INTO v_30101;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30201', 'IOF', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30201;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30202', 'Tarifas bancárias', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30202;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30203', 'Descontos concedidos', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30203;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30204', 'Juros s/ conta garantida/ch.especial', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30204;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30205', 'Juros s/ empréstimos e financiamentos bancários', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30205;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30206', 'Juros s/ contratos de mutuo', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30206;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30207', 'Juros de Mora sobre pagamentos em atraso', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30207;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30208', 'Encargos antecipação de recebíveis', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30208;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('30209', 'Outros', 3, v_302, '', '302', 'NEUTRO', true, false)
    RETURNING id INTO v_30209;

  INSERT INTO plano_orcamentario (codigo, descricao, nivel, pai_id, n1_codigo, n2_codigo, natureza, aceita_lancamento, grupo_folha)
    VALUES ('40101', 'IRPJ/CSLL', 3, v_401, '', '401', 'NEUTRO', true, false)
    RETURNING id INTO v_40101;

END $$;