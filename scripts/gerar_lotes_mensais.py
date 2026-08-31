#!/usr/bin/env python3
# ============================================================
# Gera os LOTES MENSAIS de importação do Realizado (Planorc)
# a partir do razão do ERP (ex.: LancamentoContabil.csv do Protheus).
#
# Uso (tudo opcional — sem argumentos usa os defaults do perfil):
#   python3 gerar_lotes_mensais.py [csv|zip] [pasta_saida]
#            [--perfil nome] [--ano 2026] [--mes 8] [--mes 1,2,3] [--workdir DIR]
#
#   Mais fácil ainda:  ./scripts/realizado.sh   (wrapper interativo)
#
# As regras de conversão NÃO ficam neste arquivo — vêm de um PERFIL
# (scripts/perfis/*.json), um por cliente/ERP:
# - `colunas`                    → de-para dos nomes de coluna do export.
# - `desempilhar_pipe`           → campos "P |01|<valor>": vale o trecho após o ÚLTIMO pipe.
# - `empresa_por_item_contabil`  → se há item contábil E ele está no mapa, ele manda;
#                                  senão mantém a empresa do arquivo.
# - `empresa_remap_final`        → última troca do código de empresa.
#
# Saída: 1 xlsx por ano/mês no formato do template de import do Realizado:
#   empresa_codigo, filial_codigo, cc_codigo, conta_codigo, data, ano, mes,
#   documento, historico, debito, credito, lote, sublote
#
# 2 passes (memória): pass 1 filtra/transforma p/ CSVs mensais no workdir;
# pass 2 converte 1 xlsx por vez (openpyxl write_only).
# ============================================================
import csv, sys, os, json, glob, zipfile, tempfile
from collections import defaultdict

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_PERFIS = os.path.join(RAIZ, 'scripts', 'perfis')
SAIDA_PADRAO = os.path.join(RAIZ, 'lotes_saida')

OUT_COLS = ['empresa_codigo', 'filial_codigo', 'cc_codigo', 'conta_codigo', 'data', 'ano', 'mes',
            'documento', 'historico', 'debito', 'credito', 'lote', 'sublote']


# ---------- perfil ----------
def perfis_disponiveis() -> list:
    """Perfis do diretório, ignorando os que começam com _ (modelos)."""
    return sorted(p for p in glob.glob(os.path.join(DIR_PERFIS, '*.json'))
                  if not os.path.basename(p).startswith('_'))


def carregar_perfil(nome: str | None) -> dict:
    if nome:
        path = nome if os.path.exists(nome) else os.path.join(DIR_PERFIS, f'{nome}.json')
        if not os.path.exists(path):
            sair(f'perfil "{nome}" não encontrado. Disponíveis: {", ".join(nomes_perfis()) or "(nenhum)"}')
    else:
        achados = perfis_disponiveis()
        if not achados:
            sair(f'nenhum perfil em {DIR_PERFIS}. Copie scripts/perfis/_modelo.json e ajuste.')
        if len(achados) > 1:
            sair(f'há mais de um perfil — informe --perfil. Disponíveis: {", ".join(nomes_perfis())}')
        path = achados[0]
    with open(path, 'r', encoding='utf-8') as f:
        p = json.load(f)
    p['_arquivo'] = path
    p.setdefault('nome', os.path.splitext(os.path.basename(path))[0])
    p.setdefault('colunas', {})
    p.setdefault('desempilhar_pipe', True)
    p.setdefault('empresa_por_item_contabil', {})
    p.setdefault('empresa_remap_final', {})
    faltando = [c for c in ('empresa', 'conta', 'data', 'debito', 'credito') if not p['colunas'].get(c)]
    if faltando:
        sair(f'perfil {os.path.basename(path)}: colunas obrigatórias sem mapeamento: {", ".join(faltando)}')
    return p


def nomes_perfis() -> list:
    return [os.path.splitext(os.path.basename(p))[0] for p in perfis_disponiveis()]


def sair(msg: str):
    print(f'✗ {msg}', file=sys.stderr)
    sys.exit(1)


# ---------- entrada ----------
def detect_encoding(path: str) -> str:
    with open(path, 'rb') as f:
        chunk = f.read(4_000_000)
    try:
        chunk.decode('utf-8'); return 'utf-8'
    except UnicodeDecodeError:
        return 'latin-1'


def resolver_entrada(arg: str | None, perfil: dict, workdir: str) -> str:
    """Aceita csv, zip, ou nada (procura o arquivo padrão do perfil na raiz do projeto)."""
    src = arg
    if not src:
        padrao = perfil.get('arquivo_padrao') or 'LancamentoContabil.csv'
        base, _ = os.path.splitext(padrao)
        for cand in (padrao, os.path.join(RAIZ, padrao), base + '.zip', os.path.join(RAIZ, base + '.zip')):
            if os.path.exists(cand):
                src = cand; break
        if not src:
            sair(f'não achei "{padrao}" (nem o .zip) na pasta atual nem em {RAIZ}. Passe o caminho como 1º argumento.')
    if not os.path.exists(src):
        sair(f'arquivo não encontrado: {src}')
    if src.lower().endswith('.zip'):
        os.makedirs(workdir, exist_ok=True)
        with zipfile.ZipFile(src) as z:
            membros = [n for n in z.namelist() if n.lower().endswith('.csv')]
            if not membros:
                sair(f'{src}: o zip não tem nenhum .csv dentro.')
            print(f'descompactando {membros[0]} de {os.path.basename(src)}…')
            z.extract(membros[0], workdir)
            src = os.path.join(workdir, membros[0])
    return src


# ---------- conversão ----------
def pass1_split(src: str, workdir: str, perfil: dict, ano_filtro: int | None, meses_filtro: set | None):
    os.makedirs(workdir, exist_ok=True)
    enc = detect_encoding(src)
    col = perfil['colunas']
    pipe = perfil['desempilhar_pipe']
    itemcc = perfil['empresa_por_item_contabil']
    remap = perfil['empresa_remap_final']

    def val(r: dict, campo: str) -> str:
        nome = col.get(campo)
        v = (r.get(nome) or '').strip() if nome else ''
        return v.split('|')[-1].strip() if (pipe and '|' in v) else v

    handles: dict[str, tuple] = {}
    ordem: list[str] = []
    stats = defaultdict(lambda: [0, 0.0, 0.0])          # key ym → [linhas, deb, cre]
    emp_dist = defaultdict(int)
    trocadas = remapadas = vazias = total = 0
    with open(src, 'r', encoding=enc, newline='') as f:
        rd = csv.DictReader(f)
        conferir_colunas(rd.fieldnames or [], col, src)
        for r in rd:
            data = val(r, 'data')
            if len(data) != 8 or not data.isdigit():
                continue
            ano, mes = int(data[:4]), int(data[4:6])
            if ano_filtro and ano != ano_filtro:
                continue
            if meses_filtro and mes not in meses_filtro:
                continue
            total += 1
            item = val(r, 'item_contabil')
            emp_arq = val(r, 'empresa')
            if item and item in itemcc:
                emp = itemcc[item]
                if emp != emp_arq: trocadas += 1
            else:
                emp = emp_arq
            if emp in remap:
                emp = remap[emp]; remapadas += 1
            if not emp: vazias += 1
            emp_dist[emp or '(vazia)'] += 1
            deb = float((val(r, 'debito') or '0').replace(',', '.') or 0)
            cre = float((val(r, 'credito') or '0').replace(',', '.') or 0)
            row = [emp, val(r, 'filial'), val(r, 'cc'), val(r, 'conta'),
                   f'{data[:4]}-{data[4:6]}-{data[6:8]}', ano, mes,
                   val(r, 'documento'), val(r, 'historico'),
                   deb, cre, val(r, 'lote'), val(r, 'sublote')]
            ym = f'{ano:04d}_{mes:02d}'
            if ym not in handles:
                fh = open(os.path.join(workdir, f'{ym}.csv'), 'w', encoding='utf-8', newline='')
                w = csv.writer(fh); w.writerow(OUT_COLS); handles[ym] = (fh, w); ordem.append(ym)
            handles[ym][1].writerow(row)
            s = stats[ym]; s[0] += 1; s[1] += deb; s[2] += cre
    for fh, _ in handles.values():
        fh.close()
    return stats, emp_dist, trocadas, remapadas, vazias, total, enc, ordem


def conferir_colunas(cabecalho: list, col: dict, src: str):
    """Erro cedo e claro quando o perfil não bate com o export."""
    presentes = {c.strip() for c in cabecalho}
    ausentes = sorted({n for c, n in col.items() if n and n not in presentes})
    if ausentes:
        sair(f'{os.path.basename(src)}: o perfil aponta colunas que não existem no arquivo: '
             f'{", ".join(ausentes)}.\n  Colunas do arquivo: {", ".join(sorted(presentes))}')


def pass2_xlsx(workdir: str, outdir: str, apenas: list):
    from openpyxl import Workbook
    os.makedirs(outdir, exist_ok=True)
    outs = []
    for ym in sorted(apenas):
        path = os.path.join(workdir, f'{ym}.csv')
        if not os.path.exists(path):
            continue
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


def parse_meses(vals: list) -> set | None:
    """--mes 8  |  --mes 1,2,3  |  --mes 1 --mes 2  |  --mes 1-3"""
    if not vals: return None
    out = set()
    for v in vals:
        for parte in str(v).replace(';', ',').split(','):
            parte = parte.strip()
            if not parte: continue
            if '-' in parte:
                a, b = parte.split('-', 1)
                out.update(range(int(a), int(b) + 1))
            else:
                out.add(int(parte))
    ruins = [m for m in out if m < 1 or m > 12]
    if ruins: sair(f'mês inválido: {ruins}')
    return out


def main():
    args = sys.argv[1:]
    if '-h' in args or '--help' in args:
        print(__doc__ or ''); print('perfis disponíveis:', ', '.join(nomes_perfis()) or '(nenhum)'); return

    def flag(nome, default=None):
        return args[args.index(nome) + 1] if nome in args and args.index(nome) + 1 < len(args) else default

    def flag_multi(nome):
        return [args[i + 1] for i, a in enumerate(args) if a == nome and i + 1 < len(args)]

    perfil = carregar_perfil(flag('--perfil'))
    ano = int(flag('--ano')) if flag('--ano') else None
    meses = parse_meses(flag_multi('--mes'))
    workdir = flag('--workdir') or os.path.join(tempfile.gettempdir(), 'planorc_lotes_mensais')

    # posicionais = tudo que não é flag nem valor de flag
    pos, pular = [], False
    for i, a in enumerate(args):
        if pular: pular = False; continue
        if a.startswith('--'): pular = True; continue
        pos.append(a)
    src = resolver_entrada(pos[0] if pos else None, perfil, workdir)
    outdir = pos[1] if len(pos) > 1 else SAIDA_PADRAO

    print(f'perfil: {perfil["nome"]}  ({os.path.basename(perfil["_arquivo"])})')
    print(f'origem: {src}  ({os.path.getsize(src) / 1_048_576:,.0f} MB)')
    escopo = f'ano {ano}' if ano else 'todos os anos'
    if meses: escopo += f' · meses {",".join(f"{m:02d}" for m in sorted(meses))}'
    print(f'escopo: {escopo}\n')

    stats, emp_dist, trocadas, remapadas, vazias, total, enc, ordem = pass1_split(src, workdir, perfil, ano, meses)
    if not total:
        sair('nenhuma linha bateu com o escopo (confira --ano/--mes).')
    print(f'encoding={enc} · {total:,} linhas · {trocadas:,} empresas trocadas por item contábil · '
          f'{remapadas:,} remapadas · {vazias:,} sem empresa')
    print('empresas:', dict(sorted(emp_dist.items())))
    for ym in sorted(stats):
        n, d, c = stats[ym]
        print(f'  {ym}: {n:,} linhas · débito {d:,.2f} · crédito {c:,.2f}')
    outs = pass2_xlsx(workdir, outdir, ordem)
    print(f'\n✓ {len(outs)} arquivo(s) em {outdir}')
    for o in outs:
        print(f'  {os.path.basename(o)}  ({os.path.getsize(o) / 1024:,.0f} KB)')


if __name__ == '__main__':
    main()
