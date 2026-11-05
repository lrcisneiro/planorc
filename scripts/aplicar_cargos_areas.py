#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3º passo do import de postos: preenche `cargo` e `area_funcional` no
funcionarios_convertido.csv a partir da relação de colaboradores do RH.

    cargo_codigo    -> CÓDIGO do cargo (desempata o nome; é o que a importação usa)
    cargo           -> nome, só para quem lê a planilha
    area_funcional  -> CÓDIGO do nó em `area_funcional` (organograma)

⚠ O NOME DO CARGO NÃO IDENTIFICA. `ESPECIALISTA DE DESENVOLVIMENTO DE SOFTWARE
I` existe em QUATRO subáreas do plano — mandar o nome deixou 106 postos sem
cargo na primeira tentativa, porque a importação se recusa (com razão) a
escolher uma subárea ao acaso. O que desempata é a SUBÁREA da pessoa, que o
arquivo do RH tem: com ela, o script resolve o código aqui e a importação não
precisa adivinhar nada.

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
      dados_rh/cargos_nov26/cargos.json             # export de cargo (ativos)
      [saida.csv]
"""
import csv, sys, json, re, collections, importlib.util, os, unicodedata

if len(sys.argv) < 6:
    print(__doc__); sys.exit(1)
POSTOS, COLAB, PLANO, AREAS, CARGOS = sys.argv[1:6]
SAIDA = sys.argv[6] if len(sys.argv) > 6 else POSTOS

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
pares = {}
for v in plano.values():
    for o in v: pares[(g.norm(o['area']), g.norm(o['sub']))] = (o['area'], o['sub'])
for cod, (a, sname) in mp.SUBS_NOVAS.items():
    pares[(g.norm(mp.AREAS_NOVAS[a]), g.norm(sname))] = (mp.AREAS_NOVAS[a], sname)

def parPlano(a, s):
    """(área, subárea) do arquivo → a do PLANO. É outro de-para que o do
    organograma: aqui a pergunta é a que família o CARGO pertence."""
    if (a, s) in getattr(mp, 'PLANO_FAMILIA', {}): a, s = mp.PLANO_FAMILIA[(a, s)]
    elif (a, s) in mp.DECIDIDO: a, s = mp.DECIDIDO[(a, s)]
    na = mp.AREA_SINON.get(g.norm(a), g.norm(a))
    if (na, g.norm(s)) in pares: return (na, g.norm(s))
    for k in pares:
        if (k[0] == na or g.ehGrafia(k[0], na)) and g.ehGrafia(k[1], g.norm(s)): return k
    return None

# ── catálogo de cargos do banco: nome+subárea → código ─────────────────────
cargos = json.loads((lambda t: t[t.index('{'):t.rindex('}')+1])(open(CARGOS).read()))['rows']
porNomeSub = collections.defaultdict(list)
porNomeCargo = collections.defaultdict(list)
codsDoPar = {}
for c in cargos:
    porNomeSub[(g.norm(c['nome']), c['area_cod'], c['sub_cod'])].append(c)
    porNomeCargo[g.norm(c['nome'])].append(c)
# (área,subárea) do plano em NOME → os códigos area_cod/sub_cod do banco
for c in cargos:
    codsDoPar.setdefault((c['area_cod'], c['sub_cod']), 0)

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
for c in ('cargo', 'cargo_codigo', 'area_funcional'):
    if c not in cols: cols.insert(cols.index('regime') if 'regime' in cols else len(cols), c)

cont = collections.Counter(); semNome = []
for p in rows:
    c = achar(p.get('nome'))
    if not c:
        cont['pessoa não está na relação do RH'] += 1
        if (p.get('situacao') or '').strip() != 'D': semNome.append(p.get('nome'))
        continue
    k, step, modo = g.resolver(c['CARGO'], plano)
    nomeCargo = plano[k][0]['cargo'] if k else str(c['CARGO']).strip()
    p['cargo'] = nomeCargo
    # o código desempata: procura o cargo pela subárea DO PLANO da pessoa
    par = parPlano(str(c['ÁREA']).strip(), str(c['SUBÁREA']).strip())
    alvo = None
    if par:
        # (área,subárea) em nome → códigos: o plano guarda isso no próprio cargo
        for cg in porNomeCargo.get(g.norm(nomeCargo), []):
            o = plano.get(k, [{}])[0] if k else {}
            if cg['origem'] == 'NOVO': alvo = cg; break
            if o and g.norm(o.get('area','')) == par[0] and g.norm(o.get('sub','')) == par[1]:
                alvo = cg; break
        if not alvo:
            # pelo plano: qual código tem esse nome NAQUELA subárea
            for key, lst in plano.items():
                if key != g.norm(nomeCargo): continue
                for o in lst:
                    if g.norm(o['area']) == par[0] and g.norm(o['sub']) == par[1]:
                        alvo = next((x for x in cargos if x['codigo'] == o['codigo']), None)
                        break
    if not alvo and par:
        # ⚠ A pessoa pode estar numa subárea que não tem aquele cargo (o
        # organograma e o plano não se sobrepõem perfeitamente — o projeto já
        # media isso). Afrouxa para a ÁREA, e só se o nome levar a um cargo só
        # dentro dela: afrouxar além disso é escolher ao acaso de novo.
        naArea = [c for c in porNomeCargo.get(g.norm(nomeCargo), [])
                  if c['area_cod'] and any(g.norm(o['area']) == par[0] and o['codigo'] == c['codigo']
                                           for lst in plano.values() for o in lst)]
        if len(naArea) == 1: alvo = naArea[0]
        else:
            porArea = collections.defaultdict(list)
            for lst in plano.values():
                for o in lst:
                    if g.norm(o['cargo']) == g.norm(nomeCargo) and g.norm(o['area']) == par[0]:
                        porArea[g.norm(o['sub'])].append(o)
            if len(porArea) == 1:
                o = list(porArea.values())[0][0]
                alvo = next((x for x in cargos if x['codigo'] == o['codigo']), None)
    if not alvo:
        cands = porNomeCargo.get(g.norm(nomeCargo), [])
        if len(cands) == 1: alvo = cands[0]
    p['cargo_codigo'] = alvo['codigo'] if alvo else ''
    cont[f"cargo · {modo}" + ('' if alvo else ' · SEM CÓDIGO (nome ambíguo)')] += 1
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
