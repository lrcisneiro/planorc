#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2º passo do import de postos: preenche `salario` no funcionarios_convertido.csv
a partir da folha analítica (prgper02_emp*.xlsx), por REGIME (Ricardo, 09/jul):

    CLT        -> verba B39 (SALARIO BASE)
    PROLABORE  -> verba 073 (PRO-LABORE)
    PRESTADOR  -> verba 228 (PRESTACAO SERVICOS)

Soma as linhas da verba por (filial, matrícula). Bônus/comissões/férias ficam fora.
Junção: filial = EMPRESA(2) + FILIAL(2) da folha  (20+01=2001, 25+01=2501…),
        que bate com a filial derivada dos postos. matrícula normalizada a 6 díg.

Uso: python3 scripts/preencher_salario_folha.py [postos.csv] [pasta_folha] [saida.csv]
"""
import csv, glob, os, sys, openpyxl
from collections import defaultdict, Counter

POSTOS    = sys.argv[1] if len(sys.argv) > 1 else 'dados_rh/funcionarios_convertido.csv'
FOLHA_DIR = sys.argv[2] if len(sys.argv) > 2 else 'dados_rh'
SAIDA     = sys.argv[3] if len(sys.argv) > 3 else POSTOS   # sobrescreve por padrão

# verba(s) de salário-base por regime (soma as linhas). Exclui reembolsos
# (223 translado, 168/224 despesas) e variáveis (231 bônus, 230 comissões).
VERBA_BASE = {
    'CLT':       ['B39'],           # salário base (referência contratual)
    'PROLABORE': ['073'],           # pró-labore
    'PRESTADOR': ['222', '228'],    # horas faturáveis + prestação de serviços (agregada PREST)
}

# Benefícios (VALOR_FIXO) — valor por PESSOA. O código no catálogo = CD_VERBA da folha.
# Lê os códigos VALOR_FIXO do verbas_folha_import.xlsx; senão usa o fallback conhecido.
def carregar_benef():
    for f in ('verbas_folha_import.xlsx', 'dados_rh/verbas_folha_import.xlsx'):
        if os.path.exists(f):
            try:
                ws = openpyxl.load_workbook(f, data_only=True)['Dados']
                rows = list(ws.iter_rows(values_only=True)); h = {c: i for i, c in enumerate(rows[0])}
                cods = [str(r[h['codigo']]).strip() for r in rows[1:]
                        if r[h['codigo']] and str(r[h['tipo_calculo']]).strip() == 'VALOR_FIXO']
                if cods:
                    return cods
            except Exception:
                pass
    return ['D49', 'A76', 'D50', 'A15', 'A51']   # VA/VR, médica, multibenef, VT, seguro
BENEF = carregar_benef()

def norm_mat(x) -> str:
    return str(x).strip().split('.')[0].zfill(6)   # 2 -> '000002' ; '900000' -> '900000'

def filial_folha(emp, fil) -> str:
    return f'{str(emp).strip().zfill(2)}{str(fil).strip().zfill(2)}'   # 20,01 -> 2001

# ── 1) indexa a folha: (filial, matrícula) -> { verba: soma(VALOR) } ──
idx = defaultdict(lambda: defaultdict(float))
arquivos = sorted(glob.glob(os.path.join(FOLHA_DIR, 'prgper02_emp*.xlsx')))
if not arquivos:
    print(f'ERRO: nenhum prgper02_emp*.xlsx em "{FOLHA_DIR}"'); sys.exit(1)
for fn in arquivos:
    wb = openpyxl.load_workbook(fn, data_only=True, read_only=True); ws = wb.active
    hdr = None
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i == 1:
            hdr = {h: j for j, h in enumerate(r)}; continue
        if not hdr or i < 2:
            continue
        try:
            fil = filial_folha(r[hdr['EMPRESA']], r[hdr['FILIAL']])
            mat = norm_mat(r[hdr['MATRICULA']])
            cd  = str(r[hdr['CD_VERBA']]).strip()
            val = float(r[hdr['VALOR']] or 0)
        except Exception:
            continue
        idx[(fil, mat)][cd] += val
    wb.close()
print(f'Folha indexada: {len(arquivos)} arquivos, {len(idx)} (filial,matrícula) distintos.')

# ── 2) preenche o salário nos postos ──
with open(POSTOS, encoding='utf-8-sig') as f:
    postos = list(csv.DictReader(f))
if not postos:
    print('ERRO: postos.csv vazio.'); sys.exit(1)

campos = list(postos[0].keys())
match = sem_folha = sem_verba = 0
por_reg = Counter(); total = 0.0
benef_cnt = Counter(); benef_tot = 0.0
faltantes = []
for p in postos:
    reg    = (p.get('regime') or '').strip().upper()
    codigos = VERBA_BASE.get(reg, [])
    key    = ((p.get('filial') or '').strip(), norm_mat(p.get('matricula')))
    verbas = idx.get(key) or {}
    # salário-base
    val = sum(verbas.get(cd, 0.0) for cd in codigos)
    if not idx.get(key):
        sem_folha += 1; faltantes.append((p.get('posto_codigo'), reg, 'sem linha na folha'))
    elif val:
        p['salario'] = f'{val:.2f}'; match += 1; por_reg[reg] += 1; total += val
    else:
        sem_verba += 1; faltantes.append((p.get('posto_codigo'), reg, f'sem verba {"/".join(codigos)} na folha'))
    # benefícios por pessoa (VALOR_FIXO)
    for cd in BENEF:
        v = verbas.get(cd, 0.0)
        p[cd] = f'{v:.2f}' if v else ''
        if v:
            benef_cnt[cd] += 1; benef_tot += v

fieldnames = campos + [c for c in BENEF if c not in campos]
with open(SAIDA, 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=fieldnames)
    w.writeheader(); w.writerows(postos)

print(f'\nPostos: {len(postos)} | com salário: {match} | sem linha na folha: {sem_folha} | '
      f'linha existe mas sem a verba do regime: {sem_verba}')
print('Salário preenchido por regime: ' + ', '.join(f'{k}={v}' for k, v in sorted(por_reg.items())))
print(f'Massa salarial base (mês): R$ {total:,.2f}')
print(f'Benefícios ({", ".join(BENEF)}): {sum(benef_cnt.values())} valores · R$ {benef_tot:,.2f}/mês · '
      + ', '.join(f'{k}={v}' for k, v in sorted(benef_cnt.items())))
if faltantes:
    print(f'\nAmostra de {min(15, len(faltantes))} sem salário (confira se são vagas/admissões novas):')
    for pc, reg, motivo in faltantes[:15]:
        print(f'  {pc:16s} {reg:10s} {motivo}')
print(f'\n→ {SAIDA}')
