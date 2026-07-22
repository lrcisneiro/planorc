#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Converte a folha analítica TOTVS (prgper02_emp*.xlsx "Conferência Contabilização
Folha") num CSV limpo para importar o REALIZADO DA FOLHA no Planorc (fat_folha).

Uma linha de saída por (matrícula × verba × contabilização) do mês. Traz o débito/
crédito contábil da folha, então o realizado casa na MESMA linha da DRE (via conta
do débito) e no POSTO (por filial+matrícula). Paralelo ao razão (fat_realizado).

Colunas usadas da folha: EMPRESA, FILIAL, MATRICULA, NOME, PERIODO, CD_VERBA,
DESC_VERBA, TIPO_VERBA, VALOR, CENTRO_CUSTO, DEBITO, CREDITO.
  - filial (4 díg.) = EMPRESA(2) + FILIAL(2)  → 20+01 = 2001 (bate com os postos)
  - empresa gerencial via de-para filial→empresa (mesma do converter de postos)
  - período '202605' → ano 2026, mês 5

Uso: python3 scripts/converter_folha_realizada.py [pasta_folha] [saida.csv] [--depara=...]
"""
import csv, glob, os, sys, openpyxl
from collections import Counter

_args  = [a for a in sys.argv[1:] if not a.startswith('--')]
_flags = {a for a in sys.argv[1:] if a.startswith('--')}
def _flag_val(nome, default):
    for a in _flags:
        if a.startswith(nome + '='):
            return a.split('=', 1)[1]
    return default

FOLHA_DIR = _args[0] if len(_args) > 0 else 'dados_rh'
SAIDA     = _args[1] if len(_args) > 1 else 'dados_rh/folha_realizada.csv'
DEPARA    = _flag_val('--depara', 'dados_rh/Depara_filial_empresa.csv')
FORCE     = _flag_val('--competencia', '')   # 'YYYY-MM' força a competência de saída (teste)
FORCE_ANO = FORCE_MES = None
if FORCE:
    _p = FORCE.replace('/', '-').split('-'); FORCE_ANO = int(_p[0]); FORCE_MES = int(_p[1])

def carregar_depara(path: str) -> dict:
    """CSV com colunas 'filial' e 'empresa'. Retorna { filial(4díg) : empresa_gerencial }."""
    m = {}
    if not os.path.exists(path):
        return m
    with open(path, newline='', encoding='utf-8-sig') as f:
        primeira = f.readline(); f.seek(0)
        delim = ';' if primeira.count(';') > primeira.count(',') else ','
        rd = csv.DictReader(f, delimiter=delim)
        campos = {(c or '').lower().strip(): c for c in (rd.fieldnames or [])}
        cf, ce = campos.get('filial'), campos.get('empresa')
        if not (cf and ce):
            return {}
        for r in rd:
            fil = str(r.get(cf, '')).strip(); emp = str(r.get(ce, '')).strip()
            if fil:
                m[fil] = emp
    return m

def norm_mat(x) -> str:
    return str(x or '').strip().split('.')[0].zfill(6)

def filial_folha(emp, fil) -> str:
    return f'{str(emp or "").strip().zfill(2)}{str(fil or "").strip().zfill(2)}'

def periodo_ano_mes(p):
    s = str(p or '').strip().split('.')[0]
    if len(s) == 6 and s.isdigit():
        return int(s[:4]), int(s[4:6])
    return None, None

COLS_SAIDA = ['ano', 'mes', 'empresa', 'filial', 'cc', 'matricula', 'nome',
              'verba_cod', 'verba_desc', 'tipo_verba', 'valor', 'conta_deb', 'conta_cred',
              'item_orc', 'item_orc_desc', 'competencia']

def converter(folha_dir: str, saida: str, depara: dict):
    arquivos = sorted(glob.glob(os.path.join(folha_dir, 'prgper02_emp*.xlsx')))
    if not arquivos:
        print(f'ERRO: nenhum prgper02_emp*.xlsx em "{folha_dir}"'); sys.exit(1)

    out_rows = []
    lidas = puladas = sem_periodo = sem_deb = 0
    tipos, competencias, empresas = Counter(), Counter(), Counter()
    filiais_sem_empresa = Counter()
    total_valor = 0.0

    for fn in arquivos:
        wb = openpyxl.load_workbook(fn, data_only=True, read_only=True); ws = wb.active
        hdr = None
        for i, r in enumerate(ws.iter_rows(values_only=True)):
            if i == 1:
                hdr = {h: j for j, h in enumerate(r)}; continue
            if not hdr or i < 2:
                continue
            def g(col):
                j = hdr.get(col)
                return r[j] if (j is not None and j < len(r)) else None
            lidas += 1
            mat = norm_mat(g('MATRICULA'))
            if mat in ('', '000000', 'NFUNC'):
                puladas += 1; continue
            ano, mes = periodo_ano_mes(g('PERIODO'))
            if not ano:
                sem_periodo += 1; continue
            if FORCE_ANO:                        # recarimba a competência (ex.: testar em 2027)
                ano, mes = FORCE_ANO, FORCE_MES
            tipo_verba = (g('TIPO_VERBA') or '').strip()
            conta_deb = str(g('DEBITO') or '').strip()
            # critério contábil (não o rótulo provento/desconto/base): só entra quem TEM
            # contabilização no débito. A folha traz encargos patronais como "Base" com
            # débito — cortá-los subestimaria o custo. A amarração à linha da DRE é
            # aplicada na conciliação (conta_id ∈ contas amarradas).
            if not conta_deb:
                sem_deb += 1; continue
            filial = filial_folha(g('EMPRESA'), g('FILIAL'))
            empresa = depara.get(filial, '')
            if filial and not empresa:
                filiais_sem_empresa[filial] += 1
            try:
                valor = float(g('VALOR') or 0)
            except Exception:
                valor = 0.0
            if not valor:
                puladas += 1; continue
            row = {
                'ano': ano, 'mes': mes, 'empresa': empresa, 'filial': filial,
                'cc': str(g('CENTRO_CUSTO') or '').strip(), 'matricula': mat,
                'nome': (g('NOME') or '').strip(),
                'verba_cod': str(g('CD_VERBA') or '').strip(), 'verba_desc': (g('DESC_VERBA') or '').strip(),
                'tipo_verba': tipo_verba, 'valor': f'{valor:.2f}',
                'conta_deb': conta_deb, 'conta_cred': str(g('CREDITO') or '').strip(),
                # item orçamentário autoritativo da folha (débito) — casa com verba.conta_destino/fat_orcado
                'item_orc': str(g('IT_CONTAB_DB') or '').strip(), 'item_orc_desc': (g('DESC_IT_CONTAB_DB') or '').strip(),
                'competencia': f'{ano}{mes:02d}' if FORCE_ANO else str(g('PERIODO') or '').strip().split('.')[0],
            }
            out_rows.append(row)
            tipos[row['tipo_verba'] or '(vazio)'] += 1
            competencias[f'{ano}-{mes:02d}'] += 1
            empresas[empresa or '(sem empresa)'] += 1
            total_valor += valor
        wb.close()

    with open(saida, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=COLS_SAIDA)
        w.writeheader(); w.writerows(out_rows)

    print(f'Arquivos: {len(arquivos)} | linhas lidas: {lidas} | gravadas: {len(out_rows)} | '
          f'puladas (sem matrícula/valor): {puladas} | sem débito contábil (informativas): {sem_deb} | sem período: {sem_periodo}')
    print('Competências: ' + ', '.join(f'{k}={v}' for k, v in sorted(competencias.items())))
    print('Tipo de verba: ' + ', '.join(f'{k}={v}' for k, v in sorted(tipos.items())))
    print(f'Empresas ({len(empresas)}): ' + ', '.join(f'{k}={v}' for k, v in sorted(empresas.items())))
    print(f'Valor total (soma VALOR): R$ {total_valor:,.2f}')
    if filiais_sem_empresa:
        print('\n⚠ Filiais SEM empresa no de-para: ' + ', '.join(f'{k}={v}' for k, v in sorted(filiais_sem_empresa.items())))
    print(f'\n→ {saida}')

if __name__ == '__main__':
    depara = carregar_depara(DEPARA)
    print(f'De-para filial→empresa: {len(depara)} filiais carregadas de "{DEPARA}".' if depara
          else f'AVISO: de-para "{DEPARA}" não encontrado — empresa gerencial ficará vazia (resolvida pela filial no import).')
    if FORCE_ANO:
        print(f'⚠ Competência FORÇADA para {FORCE_ANO}-{FORCE_MES:02d} (teste) — os valores vêm da folha real, só o período foi recarimbado.')
    converter(FOLHA_DIR, SAIDA, depara)
