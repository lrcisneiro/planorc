# -*- coding: utf-8 -*-
"""De-para (área, subárea) do arquivo de colaboradores → plano. Decisões do
Ricardo em 05/nov/2026. Vive num módulo porque a migration, o conversor e a
tabela de retorno ao RH têm de usar EXATAMENTE o mesmo mapeamento."""

# sinônimos puros: mesmo conceito, outro nome
AREA_SINON = {'TI': 'TECNOLOGIA DA INFORMACAO', 'RECURSOS HUMANOS': 'RELACOES HUMANAS'}

# áreas novas (código de LETRA: não têm código do ERP ainda, como os cargos NOVO-nn)
AREAS_NOVAS = {'E': 'EXECUTIVA', 'O': 'OPERAÇÕES', 'M': 'MERCADO INTERNACIONAL'}
SUBS_NOVAS  = {'E1': ('E', 'EXECUTIVA'),
               'O1': ('O', 'OPERAÇÕES'),
               'O2': ('O', 'EXPERIÊNCIA DO CLIENTE'),
               'M1': ('M', 'FÁBRICA DE SOFTWARE')}

# as decisões, por (área, subárea) do arquivo → (área, subárea) final
DECIDIDO = {
    ('SERVIÇOS', 'DESENVOLVIMENTO'):                               ('SERVIÇOS', 'FÁBRICA DE SOFTWARE'),
    ('MERCADO INTERNACIONAL', 'FABRICA DE SOFWARE'):               ('MERCADO INTERNACIONAL', 'FÁBRICA DE SOFTWARE'),
    ('None', 'FABRICA DE SOFWARE'):                                ('MERCADO INTERNACIONAL', 'FÁBRICA DE SOFTWARE'),
    # ⚠ o "cargo" desta pessoa é MERCADO INTERNACIONAL, que é nome de ÁREA —
    # provável erro de preenchimento do RH. Fica na área nova e o cargo é o que
    # precisa ser revisto.
    ('SERVIÇOS', 'MERCADO INTERNACIONAL'):                         ('MERCADO INTERNACIONAL', 'FÁBRICA DE SOFTWARE'),
    ('COMERCIAL', 'VENDAS'):                                       ('COMERCIAL', 'DRG VENDAS'),
    ('COMERCIAL', 'GESTÃO DE RECEITAS E APURAÇÃO DE RESULTADOS'):  ('COMERCIAL', 'CONTRATO DE VENDAS'),
    ('EXECUTIVA', 'EXECUTIVA'):                                    ('EXECUTIVA', 'EXECUTIVA'),
    ('OPERAÇÕES', 'OPERAÇÕES'):                                    ('OPERAÇÕES', 'OPERAÇÕES'),
    ('OPERAÇÕES', 'EXPERIÊNCIA DO CLIENTE'):                       ('OPERAÇÕES', 'EXPERIÊNCIA DO CLIENTE'),
    ('RECURSOS HUMANOS', 'DESENVOLVIMENTO EDUCACIONAL E CULTURA'): ('RELAÇÕES HUMANAS', 'DESENVOLVIMENTO ORGANIZACIONAL E CULTURA'),
    ('MARKETING', 'MARKETING DE EVENTOS'):                         ('MARKETING', 'MARKETING EVENTOS'),
}
