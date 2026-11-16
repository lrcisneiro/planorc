#!/usr/bin/env python3
"""Média mensal das verbas variáveis por pessoa, lida do `srd.csv` do RH.zip.

POR QUE EXISTE: o custo do prestador não é salário, é hora faturável. Hoje o
cadastro usa `222+228 da folha do MÊS` (ver `preencher_salario_folha.py`), e um
mês só é base ruim para quem oscila — 108 dos 243 variam mais de 5% entre
competências, e 53 variam mais de 20%.

POR QUE O SRD E NÃO `fat_folha`: o Planorc tem 4 competências importadas e não
contíguas (2026-05, 08, 09, 10). O `srd` tem 35, de 202312 a 202610. Média de
quatro meses com buraco no meio não é média.

⚠⚠ DUAS MÉDIAS, E A DIFERENÇA É O PONTO:
    media_janela  = soma ÷ TODOS os meses da janela (mês ausente conta ZERO)
    media_ativa   = soma ÷ meses em que a pessoa APARECEU
Para quem trabalha os 12 meses as duas são iguais. Para quem entrou há três
meses a primeira divide por 6 e devolve metade do custo real; para quem
trabalha de forma intermitente a segunda devolve o pico. **Nenhuma das duas é
certa sempre** — por isso o arquivo traz as duas e a coluna `meses`, e quem
decide é o RH. Foi exatamente aqui que eu errei na primeira tentativa: dividi
tudo pela janela e o Rodrigo, que aparece em 3 de 4 meses, veio 25% menor.

⚠ O ÚLTIMO MÊS DO ARQUIVO COSTUMA VIR INCOMPLETO — 202610 tem 397 linhas
contra ~12.000 das anteriores, porque a folha ainda não fechou quando o export
foi tirado (mesma lição do B39 em `preencher_salario_folha.py`). O script o
descarta sozinho e diz que descartou.

Uso:
    python3 scripts/media_prestadores.py                 # últimos 6 meses
    python3 scripts/media_prestadores.py --meses=12
    python3 scripts/media_prestadores.py --verbas=222,223,228
"""
import csv, os, sys, zipfile, io
from collections import defaultdict

ARGS = [a for a in sys.argv[1:]]
def flag(nome, padrao):
    for a in ARGS:
        if a.startswith(f'--{nome}='):
            return a.split('=', 1)[1]
    return padrao

JANELA  = int(flag('meses', '6'))
VERBAS  = [v.strip() for v in flag('verbas', '').split(',') if v.strip()] or None
SRD     = flag('srd', 'dados_rh/srd.csv')
SAIDA   = flag('saida', 'dados_rh/media_prestadores.csv')
ap = lambda v: (v or '').split('|')[-1].strip()

def abrir(path):
    """Lê o srd solto ou de dentro do RH.zip, como os outros scripts."""
    if os.path.exists(path):
        return open(path, newline='', encoding='latin-1')
    for z in ('dados_rh/RH.zip', 'RH.zip'):
        if os.path.exists(z):
            with zipfile.ZipFile(z) as zf:
                nome = next((n for n in zf.namelist() if n.lower().endswith('srd.csv')), None)
                if nome:
                    return io.StringIO(zf.read(nome).decode('latin-1'))
    sys.exit(f'não achei {path} nem srd.csv dentro de RH.zip')

def num(v):
    """⚠ O `srd` usa PONTO decimal ("6187.49"), não vírgula — é export de
    banco, não planilha brasileira. Tirar o ponto como separador de milhar
    multiplicava tudo por 100 e devolvia R$ 163 MILHÕES/mês de folha; o erro
    só não passou porque a ordem de grandeza era absurda. Vírgula, se
    aparecer, é tratada como decimal."""
    v = (v or '').strip()
    if ',' in v:
        v = v.replace('.', '').replace(',', '.')
    try: return float(v)
    except ValueError: return 0.0

# ── leitura ───────────────────────────────────────────────────────────────
linhas_por_comp = defaultdict(int)
dados = []
with abrir(SRD) as fh:
    for r in csv.DictReader(fh):
        comp = ap(r.get('DTCOMPET', ''))[:6]
        if not comp: continue
        linhas_por_comp[comp] += 1
        dados.append((comp, ap(r.get('BK_FILIAL', '')), ap(r.get('BK_SRA', '')).zfill(6),
                      ap(r.get('BK_SRV', '')), num(r.get('RD_VALOR')), num(r.get('RD_HORAS'))))

# ⚠⚠ MÊS INCOMPLETO NÃO FICA SÓ NO FIM, E A MEDIANA GLOBAL NÃO O ACHA.
# 202607 tem R$ 60 mil na verba 222 contra ~R$ 1,5 MILHÃO em todo mês normal —
# um buraco no MEIO da série. Mas a empresa CRESCEU: os meses de 2024 valem
# metade dos de 2026, então um corte por mediana global marca 2024 como
# "incompleto" e deixa julho passar, porque julho ainda está acima da mediana
# de uma série que inclui os anos magros.
# O critério tem de ser LOCAL: cada mês contra a mediana dos seus vizinhos.
# ⚠ É heurística, não verdade. O script imprime o que descartou, e
# `--excluir=202607,202512` força a mão quando quem conhece o negócio
# discorda — foi assim que julho saiu da conta.
EXCLUIR = {c.strip() for c in flag('excluir', '').split(',') if c.strip()}
valor_por_comp = defaultdict(float)
for comp, _f, _m, _v, valor, _h in dados:
    valor_por_comp[comp] += valor

todos = sorted(valor_por_comp)
VIZINHOS, LIMITE = 6, 0.6
def mediana(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 0

incompletos = []
completos = []
for i, c in enumerate(todos):
    if c in EXCLUIR:
        incompletos.append((c, valor_por_comp[c], 'pedido na linha de comando')); continue
    volta = todos[max(0, i - VIZINHOS):i + VIZINHOS + 1]
    ref = mediana([valor_por_comp[x] for x in volta if x != c])
    if ref and valor_por_comp[c] < ref * LIMITE:
        incompletos.append((c, valor_por_comp[c], f'{valor_por_comp[c] / ref:.0%} dos vizinhos'))
    else:
        completos.append(c)

# Recorte explícito por período (`--de=202601 --ate=202612`) tem precedência
# sobre a contagem de meses: "a média de 2026" é um pedido diferente de "os
# últimos 6 meses", e confundir os dois dá número plausível e errado.
DE, ATE = flag('de', ''), flag('ate', '')
if DE or ATE:
    janela = [c for c in completos if (not DE or c >= DE) and (not ATE or c <= ATE)]
else:
    janela = completos[-JANELA:]
if not janela:
    sys.exit('nenhuma competência completa no período pedido')
print(f'{len(valor_por_comp)} competências no arquivo')
if incompletos:
    print(f'⚠ {len(incompletos)} competência(s) fora da conta:')
    for c, v, pq in incompletos:
        print(f'    {c}  R$ {v:>14,.0f}   {pq}')
print(f'janela: {janela[0]}–{janela[-1]} ({len(janela)} meses usados)')
if not (DE or ATE) and len(janela) < JANELA:
    print(f'⚠ pediu {JANELA} meses e só há {len(janela)} completos')
faltando = [c for c in sorted(valor_por_comp)
            if janela[0] <= c <= janela[-1] and c not in janela]
if faltando:
    print(f'⚠ buraco dentro da janela: {", ".join(faltando)} — o divisor é {len(janela)}, não {len(janela) + len(faltando)}')

# ── agregação ─────────────────────────────────────────────────────────────
soma   = defaultdict(float)   # (fil, mat, verba) → valor
horas  = defaultdict(float)
meses  = defaultdict(set)     # (fil, mat) → competências em que apareceu
jan = set(janela)
for comp, fil, mat, verba, valor, hs in dados:
    if comp not in jan: continue
    if VERBAS and verba not in VERBAS: continue
    soma[(fil, mat, verba)] += valor
    horas[(fil, mat, verba)] += hs
    meses[(fil, mat)].add(comp)

verbas_vistas = sorted({k[2] for k in soma})
pessoas = sorted(meses)
n = len(janela)

with open(SAIDA, 'w', newline='', encoding='utf-8-sig') as fh:
    w = csv.writer(fh, delimiter=';')
    w.writerow(['filial', 'matricula', 'meses', 'media_janela', 'media_ativa', 'horas_mes']
               + [f'v{v}' for v in verbas_vistas])
    for fil, mat in pessoas:
        pres = len(meses[(fil, mat)])
        tot = sum(soma[(fil, mat, v)] for v in verbas_vistas)
        hs  = sum(horas[(fil, mat, v)] for v in verbas_vistas)
        w.writerow([fil, mat, pres, f'{tot / n:.2f}', f'{tot / pres:.2f}', f'{hs / pres:.1f}']
                   + [f'{soma[(fil, mat, v)] / pres:.2f}' if (fil, mat, v) in soma else '' for v in verbas_vistas])

tot_jan = sum(sum(soma[(f, m, v)] for v in verbas_vistas) for f, m in pessoas) / n
tot_ati = sum(sum(soma[(f, m, v)] for v in verbas_vistas) / len(meses[(f, m)]) for f, m in pessoas)
parciais = sum(1 for p in pessoas if len(meses[p]) < n)
print(f'{len(pessoas)} pessoas · {len(verbas_vistas)} verbas → {SAIDA}')
print(f'  média pela JANELA : R$ {tot_jan:,.2f}/mês')
print(f'  média pelos MESES : R$ {tot_ati:,.2f}/mês')
print(f'  ⚠ {parciais} pessoa(s) não aparecem nos {n} meses — é a diferença entre as duas')
