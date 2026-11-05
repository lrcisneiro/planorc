#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Casamento de nomes de cargo entre o plano (AREA-SUBAREA-CARGO.xlsx) e o que
chega do RH. É módulo porque a carga do catálogo, a amarração pessoa → cargo e
a tabela de retorno ao RH precisam concordar — duas implementações divergem na
primeira grafia nova.

⚠ GRAFIA NÃO É SEMELHANÇA. A primeira versão usava similaridade de texto e
casou `SOCIO ADMINISTRADOR` com `ESTAGIARIO ADMINISTRATIVO`; apertando o corte
para 0,80, ainda casou `ANALISTA DE DESENVOLVIMENTO EDUCACIONAL` com
`ORGANIZACIONAL` — cargo diferente, não escrita diferente. Hoje a regra compara
PALAVRA A PALAVRA depois de reduzir plural, gênero e o ÕES/ÃO, e aceita no
máximo UMA palavra divergente, só se for erro de digitação. O que não passa
vira decisão humana, que é onde esse tipo de dúvida pertence.
"""
import re, unicodedata, collections, difflib, openpyxl

def norm(t):
    t = unicodedata.normalize('NFKD', str(t or '')).encode('ascii','ignore').decode()
    return re.sub(r'\s+',' ', re.sub(r'[^A-Za-z0-9 ]',' ', t)).strip().upper()

SUF_TRACO = re.compile(r'\s*-\s*STEP\s*(\d+)\s*$', re.I)   # plano:        "CARGO - STEP 3"
SUF_SOLTO = re.compile(r'\s+STEP\s*(\d+)\s*$', re.I)        # colaborador:  "CARGO STEP 2"
PREP = {'DE','DA','DO','DAS','DOS','E','A','O','EM'}

def radical(w):
    """Reduz variação de GRAFIA: plural, gênero e o ÕES/ÃO do português."""
    if w.endswith('OES'): w = w[:-3] + 'AO'
    if len(w) > 3 and w.endswith('S'): w = w[:-1]
    if len(w) > 3 and w[-1] in 'AO': w = w[:-1] + '@'   # gênero vira curinga
    return w

def palavras(n):
    return sorted(radical(w) for w in n.split() if w not in PREP)

def ehGrafia(a, b):
    """Mesma coisa escrita diferente — NÃO 'parecida'. Aceita no máximo UMA
    palavra divergente, e só se for erro de digitação (≥0,85 de semelhança).
    Sem isso, DESENVOLVIMENTO EDUCACIONAL casa com ORGANIZACIONAL."""
    pa, pb = palavras(a), palavras(b)
    if pa == pb: return True
    if len(pa) != len(pb): return False
    dif = [(x, y) for x, y in zip(pa, pb) if x != y]
    return len(dif) == 1 and difflib.SequenceMatcher(None, *dif[0]).ratio() >= 0.85

def carregarPlano(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    it = wb['ANALÍTICO'].iter_rows(values_only=True); next(it)
    area = sub = None; plano = collections.defaultdict(list)
    for r in it:
        if r[1]: area = str(r[1]).strip()
        if r[3]: sub = str(r[3]).strip()
        if r[5] and r[6]:
            nome = str(r[5]); m = SUF_TRACO.search(nome)
            base = SUF_TRACO.sub('', nome).strip()
            plano[norm(base)].append({'codigo': str(r[6]).strip(), 'step': int(m.group(1)) if m else 1,
                                      'cargo': base, 'area': area, 'sub': sub})
    return plano

def resolver(cargoTexto, plano):
    """→ (chave no plano | None, step embutido | None, como)"""
    t = str(cargoTexto or '').strip()
    m = SUF_SOLTO.search(t)
    step = int(m.group(1)) if m else None
    alvo = norm(SUF_SOLTO.sub('', t))
    if alvo in plano: return alvo, step, 'exato'
    for k in plano:
        if ehGrafia(alvo, k): return k, step, 'grafia'
    return None, step, 'ausente'
