#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Procura `.select()` SEM paginação em tabelas que crescem com o negócio.

O PostgREST devolve no máximo 1000 linhas por chamada e NÃO avisa quando corta.
O sintoma é sempre o mesmo e sempre tardio: "sumiu gente", "a conta não aparece",
"a bolinha não marca essa empresa" — e só quando a base passa de mil registros,
o que costuma acontecer meses depois do código ser escrito.

Rode antes de commitar:   python3 scripts/check_paginacao.py
Sai com código 1 se achar algo, para dar para plugar num hook de pre-commit.
"""
import re, sys, os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SRC = RAIZ / 'frontend' / 'src'

# Tabelas cujo tamanho acompanha o negócio. Catálogo pequeno (empresa, filial,
# versao_orcamento, moeda, sindicato…) fica de fora de propósito: paginar ali só
# acrescenta código.
ESCALAM = {
    'fat_orcado', 'fat_realizado', 'fat_folha', 'fat_saldo', 'fat_apontamento',
    'fat_realizado_mensal', 'fat_lancamento',
    'conta_contabil', 'conta_orcamentaria', 'conta_linha',
    'posto', 'posto_verba', 'posto_rateio', 'posto_fornecedor',
    'funcionario', 'formulario_valor', 'relatorio_linha',
    'lote_contabil', 'planorc_pj_casa', 'apontamento_funcao',
}
# Formas de paginar que o projeto usa.
PAGINADORES = ('pageAll(', 'fetchAll(', 'fetchAllRows(')
# Dispensas legítimas, na mesma instrução.
DISPENSA = ('.single()', '.maybeSingle()', '.slice(', 'count:', 'head: true')


def instrucao(texto: str, pos: int) -> str:
    """Devolve a instrução em volta da posição — da quebra de linha anterior até
    onde os parênteses fecham. Um `.select()` quebrado em várias linhas precisa
    ser lido inteiro: o `.single()` costuma estar na última."""
    ini = texto.rfind('\n', 0, pos) + 1
    fim, prof, i = len(texto), 0, pos
    while i < len(texto):
        c = texto[i]
        if c in '([{': prof += 1
        elif c in ')]}':
            prof -= 1
            if prof <= 0:
                fim = texto.find('\n', i)
                fim = len(texto) if fim < 0 else fim
                break
        elif c == '\n' and prof == 0:
            fim = i
            break
        i += 1
    return texto[ini:fim]


def main():
    achados = []
    for arq in sorted(SRC.rglob('*.ts*')):
        txt = arq.read_text(encoding='utf-8')
        for m in re.finditer(r"from\('([a-z_]+)'\)", txt):
            tabela = m.group(1)
            if tabela not in ESCALAM:
                continue
            instr = instrucao(txt, m.start())
            if '.select(' not in instr:
                continue                                  # insert/update/delete
            if any(d in instr for d in DISPENSA):
                continue
            # o paginador envolve a query: procura num pedaço um pouco antes
            volta = txt[max(0, m.start() - 400):m.start()]
            if any(p in volta for p in PAGINADORES):
                continue
            linha = txt.count('\n', 0, m.start()) + 1
            achados.append((arq.relative_to(RAIZ), linha, tabela, ' '.join(instr.split())[:96]))

    if not achados:
        print('✓ nenhum select sem paginação em tabela que escala')
        return 0
    print(f'{len(achados)} select(s) sem paginação em tabela que escala:\n')
    larg = max(len(str(a[0])) for a in achados)
    for arq, linha, tabela, trecho in achados:
        print(f'  {str(arq):<{larg}}:{linha:<5} {tabela:<22} {trecho}')
    print('\nUse pageAll() de lib/pageAll.ts — ou, se a query é limitada por natureza')
    print('(.single(), .in() já em lotes, count), o verificador já a dispensa.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
