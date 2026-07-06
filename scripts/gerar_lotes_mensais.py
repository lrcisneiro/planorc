#!/usr/bin/env python3
# ============================================================
# Gera os LOTES MENSAIS de importação do Realizado (Planorc)
# a partir do LancamentoContabil.csv do Protheus (razão).
#
# Uso:
#   python3 gerar_lotes_mensais.py <LancamentoContabil.csv> <pasta_saida> [--ano 2026] [--workdir /tmp/lotes]
#
# Regras (decisões de jun/2026 — ver CLAUDE.md/memória do projeto):
# - Campos vêm no formato "P |01|<valor>": vale o trecho após o ÚLTIMO pipe.
# - EMPRESA: se há item contábil E ele está no mapa ITEMCC → empresa do mapa;
#   caso contrário mantém a BK_EMPRESA do arquivo (preserva 07/25/30 etc.).
#   Depois, remap final: 07→05 e 08→25.
# - Saída: 1 xlsx por ano/mês no formato do template de import do Realizado:
#   empresa_codigo, filial_codigo, cc_codigo, conta_codigo, data, ano, mes,
#   documento, historico, debito, credito, lote, sublote
# - 2 passes (memória): pass 1 filtra/transforma p/ CSVs mensais no workdir;
#   pass 2 converte 1 xlsx por vez (openpyxl write_only).
# ============================================================
import csv, sys, os, io, glob
from collections import defaultdict

ITEMCC_MAP = {'01': '05', '02': '01', '03': '06', '04': '08', '05': 'ZZ',
              '06': 'YY', 'PY': 'XX', 'BO': 'BO', 'FB': '28', 'TP': '40'}
REMAP_FINAL = {'07': '05', '08': '25'}
OUT_COLS = ['empresa_codigo', 'filial_codigo', 'cc_codigo', 'conta_codigo', 'data', 'ano', 'mes',
            'documento', 'historico', 'debito', 'credito', 'lote', 'sublote']

def lastpipe(v: str) -> str:
    v = (v or '').strip()
    return v.split('|')[-1].strip() if '|' in v else v

def detect_encoding(path: str) -> str:
    with open(path, 'rb') as f:
        chunk = f.read(4_000_000)
    try:
        chunk.decode('utf-8'); return 'utf-8'
    except UnicodeDecodeError:
        return 'latin-1'

def pass1_split(src: str, workdir: str, ano_filtro: int | None):
    os.makedirs(workdir, exist_ok=True)
    enc = detect_encoding(src)
    handles: dict[str, tuple] = {}
    stats = defaultdict(lambda: [0, 0.0, 0.0])          # key ym → [linhas, deb, cre]
    emp_dist = defaultdict(int)
    trocadas = remapadas = vazias = total = 0
    with open(src, 'r', encoding=enc, newline='') as f:
        rd = csv.DictReader(f)
        for r in rd:
            data = (r.get('DATA') or '').strip()
            if len(data) != 8 or not data.isdigit():
                continue
            ano, mes = int(data[:4]), int(data[4:6])
            if ano_filtro and ano != ano_filtro:
                continue
            total += 1
            item = lastpipe(r.get('BK_ITEM_CONTABIL', ''))
            emp_arq = lastpipe(r.get('BK_EMPRESA', ''))
            if item and item in ITEMCC_MAP:
                emp = ITEMCC_MAP[item]
                if emp != emp_arq: trocadas += 1
            else:
                emp = emp_arq
            if emp in REMAP_FINAL:
                emp = REMAP_FINAL[emp]; remapadas += 1
            if not emp: vazias += 1
            emp_dist[emp or '(vazia)'] += 1
            deb = float((r.get('VALOR_DEBITO') or '0').replace(',', '.') or 0)
            cre = float((r.get('VALOR_CREDITO') or '0').replace(',', '.') or 0)
            row = [emp, lastpipe(r.get('BK_FILIAL', '')), lastpipe(r.get('BK_CENTRO_CUSTO', '')),
                   lastpipe(r.get('BK_CONTA', '')), f'{data[:4]}-{data[4:6]}-{data[6:8]}', ano, mes,
                   (r.get('DOC') or '').strip(), (r.get('HISTORICO') or '').strip(),
                   deb, cre, (r.get('LOTE') or '').strip(), (r.get('SUBLOTE') or '').strip()]
            ym = f'{ano:04d}_{mes:02d}'
            if ym not in handles:
                fh = open(os.path.join(workdir, f'{ym}.csv'), 'w', encoding='utf-8', newline='')
                w = csv.writer(fh); w.writerow(OUT_COLS); handles[ym] = (fh, w)
            handles[ym][1].writerow(row)
            s = stats[ym]; s[0] += 1; s[1] += deb; s[2] += cre
    for fh, _ in handles.values():
        fh.close()
    return stats, emp_dist, trocadas, remapadas, vazias, total, enc

def pass2_xlsx(workdir: str, outdir: str):
    from openpyxl import Workbook
    os.makedirs(outdir, exist_ok=True)
    outs = []
    for path in sorted(glob.glob(os.path.join(workdir, '*.csv'))):
        ym = os.path.splitext(os.path.basename(path))[0]
        wb = Workbook(write_only=True)
        ws = wb.create_sheet('realizado')
        with open(path, 'r', encoding='utf-8', newline='') as f:
            rd = csv.reader(f)
            header = next(rd)
            ws.append(header)
            i_num = [header.index(c) for c in ('ano', 'mes')]
            i_flt = [header.index(c) for c in ('debito', 'credito')]
            for row in rd:
                for i in i_num: row[i] = int(row[i])
                for i in i_flt: row[i] = float(row[i])
                ws.append(row)
        out = os.path.join(outdir, f'lancamentos_{ym}.xlsx')
        wb.save(out); outs.append(out)
    return outs

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__ or 'uso: gerar_lotes_mensais.py <csv> <saida> [--ano AAAA] [--workdir DIR]'); sys.exit(1)
    src, outdir = args[0], args[1]
    ano = int(args[args.index('--ano') + 1]) if '--ano' in args else None
    workdir = args[args.index('--workdir') + 1] if '--workdir' in args else '/tmp/lotes_mensais'
    stats, emp_dist, trocadas, remapadas, vazias, total, enc = pass1_split(src, workdir, ano)
    print(f'encoding={enc} · {total} linhas{f" (ano {ano})" if ano else ""} · '
          f'{trocadas} empresas trocadas por ITEMCC · {remapadas} remapadas (07→05/08→25) · {vazias} sem empresa')
    print('empresas:', dict(sorted(emp_dist.items())))
    for ym in sorted(stats):
        n, d, c = stats[ym]
        print(f'  {ym}: {n} linhas · débito {d:,.2f} · crédito {c:,.2f}')
    outs = pass2_xlsx(workdir, outdir)
    print(f'{len(outs)} arquivo(s) xlsx em {outdir}')

if __name__ == '__main__':
    main()
