#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3º passo do import de postos: preenche `cargo` e `area_funcional` no
funcionarios_convertido.csv a partir da relação de colaboradores do RH.

    cargo           -> nome do cargo no PLANO (resolvido por grafia)
    area_funcional  -> CÓDIGO do nó em `area_funcional` (organograma)

⚠ SÃO DUAS ESTRUTURAS DIFERENTES e isso é fácil de confundir: `cargo_familia`
(área/subárea do plano) diz a que FAMÍLIA O CARGO pertence; `area_funcional`
diz ONDE A PESSOA TRABALHA. O projeto já media que uma não serve de eixo da
outra — o bloco 42 do plano hospeda gente em três subáreas funcionais. Aqui o
cargo vai pelo plano e a área pelo organograma, cada um com seu de-para.

⚠ POR NOME DA PESSOA, e por isso fica fora de `.sql` versionado: nome é dado
pessoal, e a carga vai da planilha ao banco pelo navegador (mesma regra que
barrou os CPFs). O de-para das estruturas, que não é pessoal, mora em
`scripts/cargo_mapa.py` e é FONTE ÚNICA — se a migration e este script
divergirem, a mesma pessoa cai em áreas diferentes conforme o caminho.

Uso:
  python3 scripts/aplicar_cargos_areas.py \
      dados_rh/funcionarios_convertido_202610.csv \
      "dados_rh/cargos_nov26/COLABORADORES ATUALIZADOS 151026 (1).xlsx" \
      dados_rh/cargos_nov26/AREA-SUBAREA-CARGO.xlsx \
      dados_rh/cargos_nov26/areas_funcionais.json   # export de area_funcional
      [saida.csv]
"""
import csv, sys, json, re, collections, importlib.util, os, unicodedata

if len(sys.argv) < 5:
    print(__doc__); sys.exit(1)
POSTOS, COLAB, PLANO, AREAS = sys.argv[1:5]
SAIDA = sys.argv[5] if len(sys.argv) > 5 else POSTOS

def _mod(nome, caminho):
    sp = importlib.util.spec_from_file_location(nome, caminho)
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m
aqui = os.path.dirname(os.path.abspath(__file__))
g  = _mod('cargo_grafia', os.path.join(aqui, 'cargo_grafia.py'))
mp = _mod('cargo_mapa',   os.path.join(aqui, 'cargo_mapa.py'))
import openpyxl

# ── organograma ────────────────────────────────────────────────────────────
nos = json.loads((lambda t: t[t.index('{'):t.rindex('}')+1])(open(AREAS).read()))['rows']
porCod = {n['codigo']: n for n in nos}
limpo = lambda n: g.norm(re.sub(r'\s*\([^)]*\)', '', n))
porNome = collections.defaultdict(list)
for n in nos: porNome[limpo(n['nome'])].append(n)

def areaDe(a, s):
    if (a, s) in mp.ORG_DEPARA: return porCod.get(mp.ORG_DEPARA[(a, s)])
    c = porNome.get(limpo(s), [])
    if len(c) > 1:
        c = [x for x in c if limpo(a) in limpo(x['pai']) or limpo(x['pai']) in limpo(a)] or c
    return c[0] if c else None

# ── plano de cargos ────────────────────────────────────────────────────────
plano = g.carregarPlano(PLANO)

# ── colaboradores, por nome normalizado ────────────────────────────────────
wb = openpyxl.load_workbook(COLAB, data_only=True, read_only=True)
it = wb['Base para Preenchimento'].iter_rows(values_only=True); hdr = list(next(it))
ix = {h: i for i, h in enumerate(hdr) if h}
colab = {}
for r in it:
    nome = r[ix['NOME COMPLETO DO RESPONDENTE']]
    if not nome: break
    colab[g.norm(nome)] = {k: r[i] for k, i in ix.items()}

def achar(nomePosto):
    """⚠ O EXPORT DO RH TRUNCA O NOME EM 30 CARACTERES e a relação de
    colaboradores não — "LEILA DA COSTA NASCIMENTO COSS" contra
    "LEILA DA COSTA NASCIMENTO COSSALTER". Sem tratar, 45 postos ATIVOS
    ficavam sem cargo e sem área por corte de string, não por ausência.
    O prefixo só vale se levar a UMA pessoa: duas, e fica em branco —
    errar a identidade é pior que deixar vazio (lição da v3_149)."""
    n = g.norm(nomePosto)
    if not n: return None
    if n in colab: return colab[n]
    cand = [v for k, v in colab.items() if k.startswith(n)]
    if len(cand) == 1: return cand[0]
    if cand: return None
    # ⚠ O export também ABREVIA O MEIO para caber em 30: "ANA PAULA COLOMBO DE
    # S PEREIRA" contra "...DE SOUZA PEREIRA". Casa token a token, cada um
    # prefixo do correspondente, mesma quantidade de tokens — e só se levar a
    # uma pessoa.
    tk = n.split()
    cand = [v for k, v in colab.items()
            if len(k.split()) == len(tk) and all(b.startswith(a) for a, b in zip(tk, k.split()))]
    return cand[0] if len(cand) == 1 else None

# ── preenche ───────────────────────────────────────────────────────────────
with open(POSTOS, encoding='utf-8-sig') as f:
    rows = list(csv.DictReader(f)); cols = list(rows[0].keys())
for c in ('cargo', 'area_funcional'):
    if c not in cols: cols.insert(cols.index('regime') if 'regime' in cols else len(cols), c)

cont = collections.Counter(); semNome = []
for p in rows:
    c = achar(p.get('nome'))
    if not c:
        cont['pessoa não está na relação do RH'] += 1
        if (p.get('situacao') or '').strip() != 'D': semNome.append(p.get('nome'))
        continue
    k, step, modo = g.resolver(c['CARGO'], plano)
    if k:
        p['cargo'] = plano[k][0]['cargo']; cont[f'cargo · {modo}'] += 1
    else:
        p['cargo'] = str(c['CARGO']).strip(); cont['cargo · fora do plano (entra como está)'] += 1
    no = areaDe(str(c['ÁREA']).strip(), str(c['SUBÁREA']).strip())
    if no: p['area_funcional'] = no['codigo']; cont['área resolvida'] += 1
    else:  cont['ÁREA SEM NÓ'] += 1

with open(SAIDA, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)

for k, v in sorted(cont.items()): print(f"{v:>5}  {k}")
if semNome:
    print(f"\n⚠ {len(semNome)} posto(s) ATIVOS sem par na relação do RH (ficam sem cargo/área):")
    for n in semNome[:10]: print(f"   {n}")
print(f"\n→ {SAIDA}")
