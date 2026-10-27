#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEED do orçado · PASSO 1 — planilha de ANÁLISE.

Monta, a partir do realizado, uma proposta de orçamento no grão
empresa × filial × CC × conta, com o histórico mês a mês ao lado para quem
revisa decidir com o número à vista.

Esta planilha NÃO é o arquivo de import. Ela é para ser lida, discutida e
editada; depois `seed_import.py` a lê de volta e gera o arquivo no formato
"Importar Baseline". Separar os dois papéis evita o pior dos dois mundos: uma
planilha cheia de colunas técnicas que ninguém revisa, ou uma planilha legível
que não pode ser importada.

  python3 scripts/seed_analise.py [grao.csv] [saida.xlsx] [--cc=1] [--ano=2027]

Classificação, por COMBINAÇÃO (a mesma conta é mensal num CC e pontual noutro):
  RECORRENTE  8+ meses, CV<=60%  -> média dos 3 últimos fechados
  VOLÁTIL     8+ meses, CV>60%   -> média dos fechados (dilui o pico)
  IRREGULAR   5 a 7 meses        -> média dos fechados
  ESPORÁDICA  até 4 meses        -> REPETE O MÊS, não a média
"""
import csv, sys, os, statistics
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_pos = [a for a in sys.argv[1:] if not a.startswith('--')]
def _flag(nome, d=''):
    return next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith(f'--{nome}=')), d)
ENTRADA = _pos[0] if _pos else os.path.join(RAIZ, 'seed2027_grao.csv')
ANO     = int(_flag('ano', '2027'))
SAIDA   = _pos[1] if len(_pos) > 1 else os.path.join(RAIZ, f'seed{ANO}_analise.xlsx')
CC_FILTRO = [c.strip() for c in _flag('cc').split(',') if c.strip()]

ANO_BASE = ANO - 1
MESES   = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out']   # out = em aberto
COL_CSV = MESES[:9] + ['out_incompleto']
FECHADOS = 9

CC_MIGRA = {'100': '111', '300': '314', '400': '411'}
FILIAL_PADRAO = {'XX': '0101', '25': '2501'}    # código do CADASTRO, não do ERP
CC_SEM_CC_OPERACAO = {'20401', '20501', '20602'}
CC_SEM_CC_ADM, CC_SEM_CC_OPER = '111', '314'
COR = {'recorrente': 'E2EFDA', 'volatil': 'FFF2CC', 'irregular': 'FCE4D6', 'esporadica': 'F8CBAD'}


def num(v):
    try:    return float(v)
    except (TypeError, ValueError): return 0.0


def carregar_nomes(path):
    emp, fil = {}, {}
    if os.path.exists(path):
        with open(path, newline='', encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                alvo = emp if (r.get('tipo') or '').strip().upper() == 'EMPRESA' else fil
                alvo[(r.get('codigo') or '').strip()] = (r.get('descricao') or '').strip()
    return emp, fil


def classificar(vals, n):
    com = [v for v in vals if v]
    if n <= 4: return 'esporadica'
    cv = (statistics.pstdev(com) / abs(statistics.mean(com)) * 100) if len(com) > 1 and statistics.mean(com) else 0
    if n <= 7: return 'irregular'
    return 'volatil' if cv > 60 else 'recorrente'


def destino(r):
    emp, fil, cc = r['empresa'], r['filial'], r['cc']
    if fil == '(sem filial)': fil = FILIAL_PADRAO.get(emp, '')
    if cc == '(sem cc)':      cc = CC_SEM_CC_OPER if r['master'] in CC_SEM_CC_OPERACAO else CC_SEM_CC_ADM
    return fil, CC_MIGRA.get(cc, cc)


def main():
    nome_emp, nome_fil = carregar_nomes(os.path.join(RAIZ, 'seed2027_nomes.csv'))
    with open(ENTRADA, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    real = defaultdict(lambda: [0.0] * 10)      # 10 meses do ano-base
    prop = defaultdict(lambda: [0.0] * 12)      # 12 meses propostos
    meta, nome_master, nome_cc = {}, {}, {}

    for r in rows:
        fil, cc = destino(r)
        if CC_FILTRO and not any(cc == f or cc.startswith(f) for f in CC_FILTRO):
            continue
        vals10 = [num(r[c]) for c in COL_CSV]
        fech = vals10[:FECHADOS]
        n = int(r['meses_com_mov'] or 0)
        cls = classificar(fech, n)
        tot = sum(fech)
        if cls == 'esporadica':
            saida = ([0.0] * 12 if tot > 0 else fech + [0.0, 0.0, 0.0])
        else:
            base = (sum(fech[FECHADOS - 3:]) / 3) if cls == 'recorrente' else tot / FECHADOS
            saida = [base] * 12
        if not any(round(x, 2) for x in vals10) and not any(round(x, 2) for x in saida):
            continue
        k = (r['empresa'], fil, r['master'], cc)
        for i in range(10): real[k][i] += vals10[i]
        for i in range(12): prop[k][i] += saida[i]
        meta.setdefault(k, cls)
        nome_master.setdefault(r['master'], r['master_desc'])
        if r['cc_desc']: nome_cc.setdefault(cc, r['cc_desc'])

    HDR = (['Empresa', 'Unidade', 'Filial', 'Filial nome', 'Conta', 'Descrição da conta',
            'CC', 'Descrição do CC', 'Classe']
           + [f'{m}/{str(ANO_BASE)[2:]}' for m in MESES]
           + [f'Realizado {ANO_BASE}', 'Média 3m', 'Média 9m']
           + [f'{m}/{str(ANO)[2:]}' for m in ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']]
           + [f'Proposto {ANO}', 'Var %', 'Decisão / observação'])
    IX = {h: i + 1 for i, h in enumerate(HDR)}
    R1 = IX[f'jan/{str(ANO_BASE)[2:]}']          # 1ª coluna do realizado
    P1 = IX[f'jan/{str(ANO)[2:]}']               # 1ª coluna da proposta
    NC = len(HDR)

    def escreve(ws, chaves):
        ws.append(HDR)
        for c in range(1, NC + 1):
            cel = ws.cell(1, c)
            cel.font = Font(bold=True, color='FFFFFF', size=9)
            # realizado azul-escuro · proposta verde-escuro · o resto cinza-azulado
            fundo = '1F3864' if R1 <= c < R1 + 10 else ('375623' if P1 <= c < P1 + 12 else '44546A')
            cel.fill = PatternFill('solid', fgColor=fundo)
            cel.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
        for i, k in enumerate(chaves, start=2):
            emp, fil, master, cc = k
            rv = [round(x, 2) for x in real[k]]
            pv = [round(x, 2) for x in prop[k]]
            fech = rv[:FECHADOS]
            ws.append([emp, nome_emp.get(emp, ''), fil, nome_fil.get(fil, ''),
                       master, nome_master.get(master, ''), cc, nome_cc.get(cc, ''), meta[k]]
                      + rv + [sum(fech), sum(fech[FECHADOS - 3:]) / 3, sum(fech) / FECHADOS]
                      + pv + [None, None, ''])
            cT = get_column_letter(IX[f'Proposto {ANO}'])
            cR = get_column_letter(IX[f'Realizado {ANO_BASE}'])
            p1, p12 = get_column_letter(P1), get_column_letter(P1 + 11)
            ws.cell(i, IX[f'Proposto {ANO}']).value = f'=SUM({p1}{i}:{p12}{i})'
            ws.cell(i, IX['Var %']).value = f'=IF({cR}{i}=0,"",({cT}{i}/{cR}{i}-1)*100)'
            ws.cell(i, IX['Var %']).number_format = '0.0'
            ws.cell(i, IX['Classe']).fill = PatternFill('solid', fgColor=COR[meta[k]])
            for c in list(range(R1, R1 + 13)) + list(range(P1, P1 + 13)):
                ws.cell(i, c).number_format = '#,##0.00'
            for c in range(P1, P1 + 12):      # a proposta é o que se edita
                ws.cell(i, c).font = Font(color='1F6F3D')
        larg = {'Empresa': 8, 'Unidade': 20, 'Filial': 7, 'Filial nome': 24, 'Conta': 8,
                'Descrição da conta': 32, 'CC': 6, 'Descrição do CC': 24, 'Classe': 11,
                f'Realizado {ANO_BASE}': 14, 'Média 3m': 12, 'Média 9m': 12,
                f'Proposto {ANO}': 14, 'Var %': 8, 'Decisão / observação': 38}
        for nome, w in larg.items():
            ws.column_dimensions[get_column_letter(IX[nome])].width = w
        for c in list(range(R1, R1 + 10)) + list(range(P1, P1 + 12)):
            ws.column_dimensions[get_column_letter(c)].width = 11
        ws.auto_filter.ref = f'A1:{get_column_letter(NC)}{len(chaves) + 1}'
        ws.freeze_panes = f'{get_column_letter(IX["Classe"])}2'

    por_aba = defaultdict(list)
    for k in sorted(prop, key=lambda k: (k[1], sum(prop[k]))):
        por_aba[k[0]].append(k)

    def aba_nome(emp):
        d = nome_emp.get(emp, '')
        n = f'{emp} · {d}' if d else emp
        for ch in ':\\/?*[]': n = n.replace(ch, '-')
        return n[:31]

    wb = Workbook(); wb.remove(wb.active)
    resumo = wb.create_sheet('Resumo')
    ordem = sorted(por_aba, key=lambda e: sum(sum(prop[k]) for k in por_aba[e]))
    resumo.append(['Empresa', 'Unidade', 'Filiais', 'Linhas', f'Realizado {ANO_BASE}', f'Proposto {ANO}', 'Var %'])
    for c in range(1, 8):
        cel = resumo.cell(1, c); cel.font = Font(bold=True, color='FFFFFF')
        cel.fill = PatternFill('solid', fgColor='1F3864'); cel.alignment = Alignment(horizontal='center')
    for emp in ordem:
        ks = por_aba[emp]
        resumo.append([emp, nome_emp.get(emp, ''), len({k[1] for k in ks}), len(ks), None, None, None])
    lin_tot = resumo.max_row + 1
    resumo.append(['TOTAL', '', '', len(prop), None, None, None])
    resumo[f'A{lin_tot}'].font = Font(bold=True)
    for col, w in {'A': 9, 'B': 22, 'C': 8, 'D': 8, 'E': 16, 'F': 16, 'G': 9}.items():
        resumo.column_dimensions[col].width = w

    for emp in ordem:
        escreve(wb.create_sheet(aba_nome(emp)), por_aba[emp])

    cR = get_column_letter(IX[f'Realizado {ANO_BASE}'])
    cP = get_column_letter(IX[f'Proposto {ANO}'])
    for i, emp in enumerate(ordem, start=2):
        n = aba_nome(emp).replace("'", "''")
        resumo.cell(i, 5).value = f"=SUM('{n}'!{cR}2:{cR}100000)"
        resumo.cell(i, 6).value = f"=SUM('{n}'!{cP}2:{cP}100000)"
        resumo.cell(i, 7).value = f'=IF(E{i}=0,"",(F{i}/E{i}-1)*100)'
    resumo.cell(lin_tot, 5).value = f'=SUM(E2:E{lin_tot - 1})'
    resumo.cell(lin_tot, 6).value = f'=SUM(F2:F{lin_tot - 1})'
    resumo.cell(lin_tot, 7).value = f'=IF(E{lin_tot}=0,"",(F{lin_tot}/E{lin_tot}-1)*100)'
    for r in resumo.iter_rows(min_row=2, max_row=lin_tot):
        r[4].number_format = r[5].number_format = '#,##0.00'; r[6].number_format = '0.0'
    for t in [[], ['Como usar'],
              ['1.', f'Edite as colunas VERDES (jan/{str(ANO)[2:]} a dez/{str(ANO)[2:]}). O Proposto e o Var % recalculam.'],
              ['2.', 'Use "Decisão / observação" para registrar o porquê — ela volta no arquivo final.'],
              ['3.', f'As colunas AZUIS são o realizado de {ANO_BASE} e não devem ser alteradas.'],
              [], ['Var %', 'o realizado tem 9 meses fechados e a proposta tem 12: +33,3% = manteve o ritmo.'],
              ['out/' + str(ANO_BASE)[2:], 'mês em aberto — está na planilha para consulta, mas FORA de todas as médias.'],
              [], ['Classe'],
              ['recorrente', '8+ meses e CV<=60% — proposta = média de jul/ago/set'],
              ['volatil', '8+ meses e CV>60% — proposta = média dos 9 fechados (dilui o pico)'],
              ['irregular', '5 a 7 meses — proposta = média dos 9 fechados'],
              ['esporadica', f'até 4 meses — REPETE o mês de {ANO_BASE}; espalhar a média criaria despesa que não existe']]:
        resumo.append(t)
    resumo[f'A{lin_tot + 2}'].font = Font(bold=True, size=12)
    wb.save(SAIDA)

    cnt = defaultdict(int); val = defaultdict(float)
    for k in prop: cnt[meta[k]] += 1; val[meta[k]] += sum(prop[k])
    if nome_emp:
        ff = sorted({k[1] for k in prop if k[1] and k[1] not in nome_fil})
        print(f'⚠ FILIAIS fora do cadastro: {", ".join(ff)}' if ff else '✓ empresas e filiais conferem com o cadastro')
    print(f'{len(prop)} linhas · {len(por_aba)} abas -> {SAIDA}')
    print(f'realizado {ANO_BASE} (jan–set): {sum(sum(real[k][:9]) for k in prop):>16,.2f}')
    print(f'proposto  {ANO}:              {sum(sum(prop[k]) for k in prop):>16,.2f}')
    for c in ('recorrente', 'volatil', 'irregular', 'esporadica'):
        print(f'   {c:<12}{cnt[c]:>5} linhas {val[c]:>16,.2f}')


if __name__ == '__main__':
    main()
