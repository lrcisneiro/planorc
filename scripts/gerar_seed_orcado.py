#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEED do orçado a partir do realizado — gera a planilha no formato "Importar
Baseline" do Planorc (Orçar → Importar), pronta para subir pela tela.

Entrada:  seed2027_grao.csv  (saída de seed2027_03_grao.sql: 1 linha por
          master × empresa × filial × CC, com os 12 meses do ano-base)
Saída:    seed2027_import.xlsx  — Empresa | Filial | ItemOrcamento |
          Centro De Custo | Area | Divisão | BU | Histórico | 12 meses

COMO O VALOR DE CADA LINHA É DECIDIDO (classificação no GRÃO, não no master —
a mesma conta pode ser recorrente num CC e esporádica em outro):

  RECORRENTE  8+ meses e CV<=60%  -> média dos 3 últimos FECHADOS, nos 12 meses
  VOLÁTIL     8+ meses e CV>60%   -> média dos meses fechados (dilui o pico)
  IRREGULAR   5 a 7 meses         -> média dos meses fechados
  ESPORÁDICA  até 4 meses         -> REPETE O MÊS do ano-base, não a média

A esporádica é o ponto que mais erra numa projeção ingênua: espalhar pelo ano
um licenciamento pago em janeiro multiplica a despesa por 12. Repetir o mês
preserva a sazonalidade, que é a informação que o histórico realmente tem.

Outubro NÃO entra em média nenhuma: o mês não fechou quando isto foi escrito
(aluguel caiu de 180k para 124k). Ajuste MESES_FECHADOS conforme o fechamento.
"""
import csv, sys, os, statistics
from collections import defaultdict
from openpyxl import Workbook
from datetime import datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRADA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'seed2027_grao.csv')
SAIDA   = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RAIZ, 'seed2027_import.xlsx')
ANO_DESTINO   = 2027
MESES_FECHADOS = 9          # jan..set de 2026
MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out_incompleto','nov','dez']

# ---------- fatores por master (1.00 = sem reajuste) ----------
# Edite aqui para aplicar reajuste por linha: FATOR['22004'] = 1.08
FATOR = defaultdict(lambda: 1.00)

# ---------- correções de destino (decididas com Ricardo, 26/out/2026) ----------
# CCs legados migram para a estrutura atual
CC_MIGRA = {'100': '111', '300': '314', '400': '411'}
# A filial XX01 do Paraguai não existia no cadastro, então o realizado entrou sem
# filial e sem CC — 8% de toda a despesa ficaria invisível a qualquer filtro.
FILIAL_PADRAO = {'XX': 'XX01', '25': '2501'}
# Sem CC: estrutura vai para o administrativo; operação vai para Base ERP.
CC_SEM_CC_OPERACAO = {'20401', '20501', '20602'}
CC_SEM_CC_ADM, CC_SEM_CC_OPER = '111', '314'


def num(v):
    try:    return float(v)
    except (TypeError, ValueError): return 0.0


def classificar(vals, n):
    """vals = os meses FECHADOS (com zero onde não houve movimento)."""
    com = [v for v in vals if v]
    if n <= 4:                       return 'ESPORADICA'
    cv = (statistics.pstdev(com) / abs(statistics.mean(com)) * 100) if len(com) > 1 and statistics.mean(com) else 0
    if n <= 7:                       return 'IRREGULAR'
    return 'VOLATIL' if cv > 60 else 'RECORRENTE'


def destino(r):
    """Aplica as correções de empresa/filial/CC. Devolve (filial, cc)."""
    emp, fil, cc = r['empresa'], r['filial'], r['cc']
    if fil == '(sem filial)':
        fil = FILIAL_PADRAO.get(emp, '')
    if cc == '(sem cc)':
        cc = CC_SEM_CC_OPER if r['master'] in CC_SEM_CC_OPERACAO else CC_SEM_CC_ADM
    cc = CC_MIGRA.get(cc, cc)
    return fil, cc


def main():
    with open(ENTRADA, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    # mesma (empresa,filial,cc,master) pode aparecer duas vezes depois das
    # migrações de CC — somar, senão o import grava duas linhas e a segunda
    # some na agregação da tela
    agg, meta = defaultdict(lambda: [0.0] * 12), {}
    real26 = defaultdict(float)              # realizado do ano-base, p/ a coluna de variação
    nome_master, nome_cc = {}, {}
    cls_cnt, cls_val = defaultdict(int), defaultdict(float)

    for r in rows:
        vals = [num(r[m]) for m in MES[:MESES_FECHADOS]]
        n = int(r['meses_com_mov'] or 0)
        cls = classificar(vals, n)
        tot = sum(vals)
        fator = FATOR[r['master']]

        if cls == 'ESPORADICA':
            # estorno isolado (saldo positivo em conta de despesa) não é despesa a orçar
            saida = [0.0] * 12 if tot > 0 else [v * fator for v in vals] + [0.0] * (12 - MESES_FECHADOS)
        else:
            base = (sum(vals[MESES_FECHADOS - 3:MESES_FECHADOS]) / 3) if cls == 'RECORRENTE' else (tot / MESES_FECHADOS)
            saida = [base * fator] * 12

        if not any(round(v, 2) for v in saida):
            continue
        fil, cc = destino(r)
        k = (r['empresa'], fil, r['master'], cc)
        for i in range(12):
            agg[k][i] += saida[i]
        real26[k] += tot
        nome_master.setdefault(r['master'], r['master_desc'])
        if r['cc_desc']: nome_cc.setdefault(cc, r['cc_desc'])
        meta.setdefault(k, cls)
        cls_cnt[cls] += 1; cls_val[cls] += sum(saida)

    # A planilha serve para DUAS coisas: revisar e importar. O import acha as
    # colunas pelo NOME (empresa/filial/itemorcamento/centrodecusto/histórico) e
    # os meses por serem do tipo Data — qualquer outra coluna é ignorada. Então
    # as descrições e os totais viajam junto sem atrapalhar a carga.
    #
    # UMA ABA POR EMPRESA · FILIAL, que é como a controladoria revisa: cada
    # gestor olha a sua. O import lê todas as abas (corrigido em out/2026 — antes
    # ele parava na primeira e o resto sumia calado).
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    COR = {'recorrente': 'E2EFDA', 'volatil': 'FFF2CC', 'irregular': 'FCE4D6', 'esporadica': 'F8CBAD'}
    hdr = (['Empresa', 'Filial', 'ItemOrcamento', 'Conta', 'Centro De Custo', 'CC',
            'Area', 'Divisão', 'BU', 'Histórico']
           + [datetime(ANO_DESTINO, m, 1) for m in range(1, 13)]
           + ['Classe', f'Total {ANO_DESTINO}', 'Realizado jan–set', 'Var %'])
    NC = len(hdr)

    def escreve(ws, chaves):
        ws.append(hdr)
        for c in range(1, NC + 1):
            cel = ws.cell(1, c); cel.font = Font(bold=True, color='FFFFFF')
            cel.fill = PatternFill('solid', fgColor='1F3864')
            cel.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
        for i, k in enumerate(chaves, start=2):
            emp, fil, master, cc = k
            v = [round(x, 2) for x in agg[k]]
            t27, t26 = sum(v), real26[k]
            var = (t27 / t26 - 1) * 100 if t26 else None
            ws.append([emp, fil, master, nome_master.get(master, ''), cc, nome_cc.get(cc, ''),
                       '', '', '', f'Seed {ANO_DESTINO} · {meta[k].lower()}']
                      + v + [meta[k].lower(), round(t27, 2), round(t26, 2),
                             round(var, 1) if var is not None else ''])
            ws.cell(i, 23).fill = PatternFill('solid', fgColor=COR[meta[k].lower()])
            for c in list(range(11, 23)) + [24, 25]:
                ws.cell(i, c).number_format = '#,##0.00'
        for col, w in {'A': 8, 'B': 8, 'C': 13, 'D': 34, 'E': 14, 'F': 26, 'G': 6, 'H': 7,
                       'I': 6, 'J': 24, 'W': 12, 'X': 14, 'Y': 15, 'Z': 8}.items():
            ws.column_dimensions[col].width = w
        for c in range(11, 23): ws.column_dimensions[get_column_letter(c)].width = 12
        ws.auto_filter.ref = f'A1:{get_column_letter(NC)}{len(chaves) + 1}'
        ws.freeze_panes = 'D2'

    # uma aba por EMPRESA (empresa × filial daria 51 abas, ninguém navega isso);
    # dentro da aba, agrupado por filial e, nela, do maior valor para o menor
    por_aba = defaultdict(list)
    for k in sorted(agg, key=lambda k: (k[1], sum(agg[k]))):
        por_aba[k[0]].append(k)

    wb = Workbook(); wb.remove(wb.active)
    resumo = wb.create_sheet('Resumo')
    resumo.append(['Empresa', 'Filiais', 'Linhas', f'Total {ANO_DESTINO}', 'Realizado jan–set', 'Var %'])
    for c in range(1, 7):
        cel = resumo.cell(1, c); cel.font = Font(bold=True, color='FFFFFF')
        cel.fill = PatternFill('solid', fgColor='1F3864')
        cel.alignment = Alignment(wrap_text=True, horizontal='center')
    for emp in sorted(por_aba, key=lambda e: sum(sum(agg[k]) for k in por_aba[e])):
        ks = por_aba[emp]
        t27 = sum(sum(agg[k]) for k in ks); t26 = sum(real26[k] for k in ks)
        resumo.append([emp, len({k[1] for k in ks}), len(ks), round(t27, 2), round(t26, 2),
                       round((t27 / t26 - 1) * 100, 1) if t26 else ''])
    tot27 = sum(sum(v) for v in agg.values()); tot26 = sum(real26.values())
    resumo.append(['TOTAL', '', len(agg), round(tot27, 2), round(tot26, 2),
                   round((tot27 / tot26 - 1) * 100, 1) if tot26 else ''])
    for r in resumo.iter_rows(min_row=2):
        for c in (4, 5, 6): r[c - 1].number_format = '#,##0.00'
    resumo[f'A{resumo.max_row}'].font = Font(bold=True)
    for col, w in {'A': 10, 'B': 9, 'C': 9, 'D': 16, 'E': 17, 'F': 9}.items():
        resumo.column_dimensions[col].width = w
    resumo.append([]); resumo.append(['Var % de +33,3% = manteve o ritmo: o realizado é de 9 meses e o orçado de 12.'])
    resumo.append(['O que foge dessa faixa é onde há decisão — filtre por Var % em cada aba.'])

    for emp in sorted(por_aba, key=lambda e: sum(sum(agg[k]) for k in por_aba[e])):
        escreve(wb.create_sheet(emp[:31]), por_aba[emp])
    wb.save(SAIDA)
    print(f'abas: Resumo + {len(por_aba)} empresas')

    print(f'lidas {len(rows)} combinações -> {len(agg)} linhas em {SAIDA}')
    tot_out = sum(sum(v) for v in agg.values())
    print(f'total {ANO_DESTINO}: {tot_out:>16,.2f}')
    print(f'\n{"classe":<12}{"linhas":>8}{"total "+str(ANO_DESTINO):>18}')
    for c in ('RECORRENTE', 'VOLATIL', 'IRREGULAR', 'ESPORADICA'):
        print(f'{c:<12}{cls_cnt[c]:>8}{cls_val[c]:>18,.2f}')


if __name__ == '__main__':
    main()
