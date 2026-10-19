-- ============================================================
-- Amarração que falta no PY e na BO — as perguntas que não dá para chutar
--
-- Já resolvido: terceiros externos (20401), multas (22033), diferença de
-- câmbio (30101). Resta a família 9300xx, os impostos e uma receita.
--
-- Só leitura.
-- ============================================================

-- ─────────── 1 · como o BR trata as transitórias 9300xx ───────────
-- Esta é a pergunta que importa. No PY e na BO essas contas são as DUAS PONTAS
-- do mesmo repasse entre as unidades:
--     PY 930016 CUSTO HORAS RECURSOS BOLÍVIA       -40.281,55
--     BO 930015 RECEITA HRS PROJETOS PY            +38.415,96
--     PY 930017 REEMBOLSO REPASSE TOTVS MÉXICO-BO  +52.849,50
--     BO 930030 REPASSE COM. TOTVS MEXICO-PY       -58.276,47
-- Se eu amarrar as duas pontas em masters de resultado, o consolidado ganha
-- receita e custo que não existem no grupo — só se anulariam se os valores
-- fossem idênticos, e não são. O que o BR faz aqui decide o que fazer lá.
select
  cc.codigo                    as conta_br,
  cc.descricao,
  co.codigo                    as master,
  co.descricao                 as master_desc,
  cl.sinal
from conta_contabil cc
join plano_contas pc on pc.id = cc.plano_id and pc.codigo = 'BRTOP'
left join conta_linha cl on cl.conta_id = cc.id
left join conta_orcamentaria co on co.id = cl.linha_id
where cc.codigo like '9300%'
order by cc.codigo;

-- ─────────── 2 · masters de imposto ───────────
-- Faltam destino para: PY 1901 IMPUESTO A LA RENTA (-1.492),
-- BO 5020201001 IMPUESTOS A LAS TRANSACCIONES-IVA (-32.005),
-- BO 5020201005 IMPUESTO A LAS UTILIDADES-IUE (-7.184).
-- Se esta consulta vier vazia, a DRE gerencial para antes do imposto e essas
-- contas ficam fora de propósito — me diga e eu as deixo sem master.
select codigo, descricao, natureza
  from conta_orcamentaria
 where descricao ~* '(imposto|tribut|iss|pis|cofins|icms|irpj|csll|renda|taxa)'
 order by codigo;

-- ─────────── 3 · masters de receita de serviço ───────────
-- BO 4010101007 SERVICIUS BANCO DE HORA (+5.880) é a única receita sem destino.
-- As irmãs já vão para 10101, 10201, 11001 e 11006; quero ver a família inteira
-- para escolher em vez de adivinhar qual linha é "banco de horas".
select codigo, descricao, natureza
  from conta_orcamentaria
 where natureza = 'RECEITA'
 order by codigo;

-- ─────────── 4 · BO 5030400002 COMPRA DE CARTEIRAS CLIENTES (-12.037) ───────────
-- Despesa comercial de aquisição de carteira. Candidatos na família comercial:
select codigo, descricao, natureza
  from conta_orcamentaria
 where codigo like '20%' or codigo like '21%'
 order by codigo;
