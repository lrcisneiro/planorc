-- ============================================================
-- SEED · plano de contas da AVENTUM (ContaAzul), a partir do pivot
-- Rode no SQL Editor. Re-executável (não duplica). Termina em SELECT.
--
-- As 56 categorias que o export do ContaAzul traz, com o CÓDIGO E O NOME DA
-- ORIGEM — e é esse o ponto do caminho novo: hoje cada uma é traduzida para um
-- código Protheus inventado, numa planilha que ninguém audita. Aqui a conta
-- passa a existir com o nome que tem no sistema de origem, e a tradução vira
-- UMA amarração conta → linha, na tela, visível e corrigível.
--
-- ⚠⚠ CINCO CATEGORIAS NÃO TÊM CÓDIGO NA ORIGEM e recebem um `SC-<nome>` aqui.
-- Não é invenção disfarçada: é código que DIZ que não veio código, para não se
-- confundir com a numeração do ContaAzul. Duas delas pesam muito —
-- `Receitas de Serviços` (+579.941, 168 lanç.) e `Impostos retidos em vendas`
-- (−36.692, 287 lanç.) —, então ignorá-las não era opção. Quando o ContaAzul
-- ganhar código para elas, troca-se o código aqui e a amarração segue.
-- ⚠ `2.20. 1001 REEMBOLSO` vem com ESPAÇO dentro do código na origem (erro de
-- digitação lá); o seed o normaliza para `2.20.1001`. Deixar o espaço criaria
-- uma conta que nenhum import casaria.
--
-- ⚠ `natureza` sai do PREFIXO do código (1=receita, 2 e 8=despesa), não do
-- sinal do valor: sinal é do mês, prefixo é do plano. Para as sem código, aí
-- sim o sinal decide — é o que há.
--
-- ⚠ NÃO amarra nada. A amarração conta → linha do relatório é o passo
-- seguinte, na tela, e é justamente o que se quer ver e revisar.
-- ============================================================

WITH p AS (SELECT id, tenant_id FROM plano_contas WHERE codigo = 'BRAVENTUM'),
novas(codigo, descricao, natureza) AS (VALUES
  ('1.11.1001', 'RECEITA NÃO RECORRENTE', 'RECEITA'),
  ('1.11.1002', 'RECEITA RECORRENTE DE SERVIÇOS', 'RECEITA'),
  ('1.11.1003', 'RECEITA RECORRENTE TOTVS S/A', 'RECEITA'),
  ('1.11.1004', 'RECEITA COMISSÕES PARCEIROS', 'RECEITA'),
  ('1.12.1002', 'REC. VENDA A PRAZO', 'RECEITA'),
  ('1.13.1006', 'RENDIMENTOS DE APLICACAO FINANCEIRA', 'RECEITA'),
  ('1.14.1005', 'RECEITAS VENDAS DE MOVEIS E UTENSILIOS', 'RECEITA'),
  ('1.99.1004', 'DEVOLUCOES/REEMBOLSOS', 'RECEITA'),
  ('2.13.1001', '(-) COFINS', 'DESPESA'),
  ('2.13.1008', '(-) ISS', 'DESPESA'),
  ('2.13.1009', '(-) PIS', 'DESPESA'),
  ('2.13.1011', '(-) CSLL', 'DESPESA'),
  ('2.13.1012', '(-) IRPJ PRESUMIDO', 'DESPESA'),
  ('2.14.1002', 'CUSTO MAO DE OBRA PJ', 'DESPESA'),
  ('2.14.1004', 'COMISSÕES DE PARCEIROS', 'DESPESA'),
  ('2.15.1011', 'COMISSOES DENTRO DA FOLHA SOBRE VENDAS', 'DESPESA'),
  ('2.15.1014', 'CURSOS E TREINAMENTOS', 'DESPESA'),
  ('2.15.1020', 'GRATIFICACOES E PREMIACOES NA FOLHA', 'DESPESA'),
  ('2.15.1025', 'INSS EMPRESA', 'DESPESA'),
  ('2.15.1040', 'SALARIOS E ORDENADOS', 'DESPESA'),
  ('2.16.1050', 'SALARIO FAMILIA E MATERNIDADE/PATERNIDADE', 'DESPESA'),
  ('2.18.1003', 'DESPESAS DE VIAGEM VISITA CLIENTE', 'DESPESA'),
  ('2.18.1004', 'ESTACIONAMENTO', 'DESPESA'),
  ('2.18.1005', 'HOSPEDAGEM', 'DESPESA'),
  ('2.18.1006', 'OUTRAS DESPESAS DE VIAGEM', 'DESPESA'),
  ('2.18.1007', 'PASSAGENS AEREAS E RODOVIARIAS', 'DESPESA'),
  ('2.18.1009', 'REEMBOLSO DESPESA TERCEIROS', 'DESPESA'),
  ('2.18.1011', 'DESPESAS COM DESLOCAMENTOS', 'DESPESA'),
  ('2.19.1001', 'FEIRAS E EVENTOS', 'DESPESA'),
  ('2.19.1004', 'OUTRAS DESPESAS PUBLICIDADE/PROPAGANDA', 'DESPESA'),
  ('2.19.1007', 'TRAFEGO PAGO', 'DESPESA'),
  ('2.19.1011', 'FREELANCER', 'DESPESA'),
  ('2.20.1001', 'REEMBOLSO', 'DESPESA'),
  ('2.20.1005', 'BENS DE PEQUENO VALOR', 'DESPESA'),
  ('2.20.1007', 'CERTIFICACAO DIGITAL', 'DESPESA'),
  ('2.20.1019', 'FESTAS E CONFRATERNIZACOES', 'DESPESA'),
  ('2.20.1031', 'MATERIAIS DE ESCRITORIO', 'DESPESA'),
  ('2.20.1032', 'MATERIAIS DE INFORMATICA', 'DESPESA'),
  ('2.20.1034', 'MENSALIDADES E ANUIDADES', 'DESPESA'),
  ('2.20.1036', 'PLANO DE SAUDE MEDICO', 'DESPESA'),
  ('2.20.1048', 'SOFTWARES E SISTEMAS', 'DESPESA'),
  ('2.20.1050', 'TELEFONE MOVEL', 'DESPESA'),
  ('2.20.1055', 'AQUISIÇÃO DE IMOBILIZADO', 'DESPESA'),
  ('2.20.1056', 'DESPESAS COM COOPERATIVA DE TRABALHO', 'DESPESA'),
  ('2.21.1002', 'BRINDES', 'DESPESA'),
  ('2.22.1001', 'ALVARA', 'DESPESA'),
  ('2.22.1002', 'IMPOSTOS E TAXAS ESTADUAIS', 'DESPESA'),
  ('2.23.1002', 'IOF', 'DESPESA'),
  ('2.23.1012', 'TARIFAS BANCARIAS', 'DESPESA'),
  ('8.01', 'RETIRADAS SÓCIOS MENSAL', 'DESPESA'),
  ('8.02', 'RETIRADA DE FATURAMENTO PF', 'DESPESA'),
  ('SC-ASSESSORIA-DE-MARKETING', 'Assessoria de Marketing Digital', 'RECEITA'),
  ('SC-COMPRA', 'Compra', 'DESPESA'),
  ('SC-FRETES-PAGOS', 'Fretes pagos', 'DESPESA'),
  ('SC-IMPOSTOS-RETIDOS-EM-VEND', 'Impostos retidos em vendas', 'DESPESA'),
  ('SC-RECEITAS-DE-SERVI-OS', 'Receitas de Serviços', 'RECEITA')
)
INSERT INTO conta_contabil (tenant_id, plano_id, codigo, descricao, tipo, natureza, ativo)
SELECT p.tenant_id, p.id, n.codigo, n.descricao, 'ANALITICA', n.natureza, true
  FROM novas n CROSS JOIN p
 WHERE NOT EXISTS (SELECT 1 FROM conta_contabil x
                    WHERE x.plano_id = p.id AND x.codigo = n.codigo);

-- ---------------- conferência ----------------
SELECT '1 · plano BRAVENTUM' AS secao, pc.codigo AS chave,
       count(cc.id)::text||' conta(s)' AS info,
       count(cc.id) FILTER (WHERE cc.natureza = 'RECEITA')::text||' receita · '
       ||count(cc.id) FILTER (WHERE cc.natureza = 'DESPESA')::text||' despesa' AS det
  FROM plano_contas pc LEFT JOIN conta_contabil cc ON cc.plano_id = pc.id
 WHERE pc.codigo = 'BRAVENTUM' GROUP BY pc.codigo
UNION ALL
SELECT '2 · sem código na origem (SC-)', cc.codigo, cc.descricao, cc.natureza
  FROM conta_contabil cc JOIN plano_contas pc ON pc.id = cc.plano_id
 WHERE pc.codigo = 'BRAVENTUM' AND cc.codigo LIKE 'SC-%'
UNION ALL
SELECT '3 · a empresa 35 aponta para qual plano?', e.codigo,
       coalesce(pc.nome, '⚠ NENHUM'),
       CASE WHEN pc.codigo = 'BRAVENTUM' THEN '✅ já é o novo'
            ELSE '⚠ ainda no antigo — trocar em Cadastros → Empresas quando for virar' END
  FROM empresa e LEFT JOIN plano_contas pc ON pc.id = e.plano_id
 WHERE e.codigo = '35'
 ORDER BY 1, 2;
