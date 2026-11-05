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


# ── Organograma funcional (`area_funcional`) ────────────────────────────────
# ⚠ É OUTRA ESTRUTURA, não a do cargo. `cargo_familia` diz a que família o
# CARGO pertence; `area_funcional` diz onde a PESSOA trabalha. O projeto já
# tinha medido que uma não serve de eixo da outra — o bloco 42 do plano hospeda
# gente em três subáreas funcionais diferentes.
#
# 263 das 303 pessoas casam pelo nome da subárea. Estas dez precisam de regra
# porque o nome sozinho erra:
ORG_DEPARA = {
    # abreviação no nó ("ADM" × "ADMINISTRATIVOS")
    ('ADM/FINANCEIRO', 'CONTROLES FINANCEIROS E ADMINISTRATIVOS'): '131',
    # typo na origem ("SOFWARE")
    ('MERCADO INTERNACIONAL', 'FABRICA DE SOFWARE'):               '141',
    ('None', 'FABRICA DE SOFWARE'):                                '141',
    ('SERVIÇOS', 'MERCADO INTERNACIONAL'):                         '141',
    # a subárea repete o nome da área: é a própria diretoria
    ('EXECUTIVA', 'EXECUTIVA'):                                    '1',
    ('SERVIÇOS', 'SERVIÇOS'):                                      '11',
    ('OPERAÇÕES', 'OPERAÇÕES'):                                    '17',
    # preposição a mais
    ('MARKETING', 'MARKETING DE EVENTOS'):                         '151',
    # ⚠⚠ ERRO QUE O NOME PRODUZIA: "DESENVOLVIMENTO" existe em DOIS ramos, e o
    # desempate pelo pai falha porque a origem escreve "TI" e o nó
    # "TECNOLOGIA DA INFORMAÇÃO". Sem esta linha, 3 pessoas de TI iam parar em
    # Serviços — errado e invisível, porque o nome batia.
    ('TI', 'DESENVOLVIMENTO'):                                     '1711',
    # julgamento: "desenvolvimento educacional e cultura" ≈ cultura e engajamento
    ('RECURSOS HUMANOS', 'DESENVOLVIMENTO EDUCACIONAL E CULTURA'): '163',
}


# ⚠ FAMÍLIA DO CARGO ≠ LUGAR DA PESSOA, e Mercado Internacional é o caso que
# obriga a separar os dois. No ORGANOGRAMA essas pessoas ficam em
# `141 FÁBRICA DE SOFTWARE` sob a Diretoria Mercado Internacional — é onde
# trabalham. Mas o CARGO delas (`ESPECIALISTA DE DESENVOLVIMENTO DE SOFTWARE
# I`, `GERENTE DE PROJETO`) só existe nas famílias de Serviços e TI; a área M
# não tem esses cargos e nunca vai ter, porque ela é unidade de negócio, não
# família de carreira. Sem esta tabela, 13 pessoas ficam sem cargo.
PLANO_FAMILIA = {
    ('MERCADO INTERNACIONAL', 'FABRICA DE SOFWARE'): ('SERVIÇOS', 'FÁBRICA DE SOFTWARE'),
    ('SERVIÇOS', 'MERCADO INTERNACIONAL'):           ('SERVIÇOS', 'FÁBRICA DE SOFTWARE'),
    ('None', 'FABRICA DE SOFWARE'):                  ('SERVIÇOS', 'FÁBRICA DE SOFTWARE'),
}
