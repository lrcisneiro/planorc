#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2º passo do import de postos: preenche a coluna `salario` do
funcionarios_convertido.csv, que o export `Funcionarios.csv` do RH NÃO traz.

    CLT / PRÓ-LABORE -> verba B39 (SALARIO BASE), do `srd.csv` do RH.zip
    PRESTADOR        -> verbas 222 + 228 da folha do mês (folha_realizada_*.csv)
    demitido (sit=D) -> em branco, sempre

⚠ A VERSÃO ANTERIOR LIA O B39 DO `prgper02` E ISSO PAROU DE FUNCIONAR. O
prgper02 é a *contabilização*, e o B39 é verba de referência — não gera
lançamento, então não está lá. Em out/26: zero de 243 CLT com B39 no prgper02,
124 no srd. Daí a fonte ter mudado para o movimento bruto.

⚠ **ÚLTIMO B39 DISPONÍVEL POR PESSOA, não o do mês.** O srd de out/26 veio com
só 16 pessoas no B39 (2.475 linhas contra ~12.000 dos meses anteriores) — a
folha CLT do mês ainda não estava nele. Pegar "o B39 de outubro" deixaria 96 de
97 CLT sem salário; pegar o último de cada pessoa resolve 96, com setembro.
Salário-base é valor contratual e muda pouco, então a defasagem de um mês é
aceitável — mas o script IMPRIME de que competência cada valor veio, porque
essa escolha não pode ficar implícita.

⚠ **CÉLULA EM BRANCO É "NÃO MEXER", não zero** — e isso só vale porque o
importador foi corrigido junto (nov/2026): antes ele gravava `salario_base = 0`
para linha sem salário, o que numa carga de rotina zerava os 339 postos que
tinham valor. Quem está fora da folha (demitido, confidencial, caso pontual)
sai em branco de propósito e mantém o que está no cadastro.

Uso:
  python3 scripts/preencher_salario_folha.py \
      dados_rh/funcionarios_convertido_202610.csv \
      dados_rh/folha_realizada_202610.csv \
      dados_rh/folha_202610/rh/srd.csv \
      [saida.csv]
"""
import csv, sys, collections

if len(sys.argv) < 4:
    print(__doc__); sys.exit(1)
POSTOS, FOLHA, SRD = sys.argv[1], sys.argv[2], sys.argv[3]
SAIDA = sys.argv[4] if len(sys.argv) > 4 else POSTOS

VERBA_PREST = ('222', '228')   # horas faturáveis + prestação de serviços
norm = lambda m: (m or '').strip().zfill(6)
# ⚠ o folha_realizada_*.csv sai do conversor com PONTO decimal ("1991.55").
# Tratar o ponto como separador de milhar multiplicava tudo por 100 e deu
# R$ 259 milhões de prestadores na primeira rodada — número tão absurdo que
# saltou à vista; se fosse 10% errado teria passado.
def num(t):
    t = (t or '').strip()
    if not t: return 0.0
    if ',' in t: t = t.replace('.', '').replace(',', '.')   # formato brasileiro
    try: return float(t)
    except ValueError: return 0.0

# ── último B39 por pessoa, do movimento bruto ────────────────────────────────
ultB39 = {}
with open(SRD, encoding='utf-8-sig', errors='replace') as f:
    for r in csv.DictReader(f):
        if (r.get('BK_SRV') or '').split('|')[-1].strip() != 'B39':
            continue
        k = ((r.get('BK_FILIAL') or '').split('|')[-1].strip(),
             norm((r.get('BK_SRA') or '').split('|')[-1]))
        comp = (r.get('DTCOMPET') or '').strip()[:7].replace('-', '')
        try: v = float((r.get('RD_VALOR') or '0').replace(',', '.'))
        except ValueError: continue
        if k not in ultB39 or comp > ultB39[k][0]:
            ultB39[k] = (comp, v)

# ── o que o prestador recebeu no mês ─────────────────────────────────────────
prest = collections.defaultdict(float)
with open(FOLHA, encoding='utf-8-sig') as f:
    for l in csv.DictReader(f):
        if l['verba_cod'] in VERBA_PREST:
            prest[(l['filial'], norm(l['matricula']))] += num(l['valor'])

# ── preenche ─────────────────────────────────────────────────────────────────
with open(POSTOS, encoding='utf-8-sig') as f:
    rows = list(csv.DictReader(f)); cols = list(rows[0].keys())
if 'salario' not in cols: cols.insert(cols.index('regime') + 1, 'salario')

cont = collections.Counter(); soma = collections.defaultdict(float)
comps = collections.Counter()
for p in rows:
    reg = (p.get('regime') or '').strip().upper()
    sit = (p.get('situacao') or '').strip().upper()
    k = (p['filial'], norm(p.get('matricula')))
    val = None
    if sit == 'D':
        fonte = 'demitido · em branco'
    elif reg in ('CLT', 'PROLABORE') and k in ultB39:
        comp, val = ultB39[k]; fonte = f'B39 {comp}'; comps[comp] += 1
    elif reg == 'PRESTADOR' and prest.get(k):
        val = prest[k]; fonte = '222+228 do mês'
    else:
        fonte = 'sem fonte · em branco'
    p['salario'] = f'{val:.2f}' if val else ''
    cont[fonte] += 1
    if val: soma[fonte] += val

with open(SAIDA, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)

print(f"{'fonte':<26}{'postos':>8}{'soma':>16}")
for k in sorted(cont):
    print(f"{k:<26}{cont[k]:>8}{soma[k]:>16,.2f}" if soma[k] else f"{k:<26}{cont[k]:>8}{'—':>16}")
print(f"{'TOTAL com salário':<26}{sum(cont[k] for k in soma):>8}{sum(soma.values()):>16,.2f}")
if comps: print("competências do B39 usadas:", ", ".join(f"{c}×{n}" for c, n in sorted(comps.items())))
print(f"\n→ {SAIDA}")
