#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrai a PLR paga por pessoa num ano, do `srd.csv` do RH.zip, e escreve o
arquivo que a importação de postos lê para alimentar `posto_verba`.

    python3 scripts/gerar_plr.py dados_rh/folha_202610/rh/srd.csv 2026 \
            dados_rh/plr_2026.csv [--verba 063]

POR QUE DO `srd` E NÃO DA `fat_folha`: a tabela do Planorc só tem as
competências que foram importadas (mai, ago, set, out/26), e as parcelas de
2026 caíram em MARÇO e JUNHO. Procurar lá devolve quase nada — foi o que me
aconteceu antes de o Ricardo apontar o srd.

O QUE SAI: uma coluna por verba, com o nome igual ao CÓDIGO da verba, que é
como a importação de postos casa coluna → `posto_verba` (o mesmo mecanismo do
D49, A76 e companhia). O valor é o TOTAL DO ANO por pessoa; o motor divide
entre as parcelas pelo calendário da verba (`tipo_calculo = PARCELAS`).

⚠ O ARQUIVO TEM REMUNERAÇÃO POR PESSOA. Vai para `dados_rh/`, que está no
.gitignore, e sobe pelo navegador. Nunca gerar `.sql` com estes valores nem
tirá-los dessa pasta — mesma regra do CPF.

⚠ SOMA O ANO, inclusive as parcelas pequenas de ajuste. Em 2026 a 063 aparece
em 4 competências (março 86 pessoas, abril 3, maio 4, junho 54): abril e maio
são acertos, e somá-los ao total da pessoa é o certo para orçar — o que se
quer prever é quanto a pessoa recebe no ano.
"""
import csv, sys, collections

if len(sys.argv) < 4:
    print(__doc__); sys.exit(1)
SRD, ANO, SAIDA = sys.argv[1], sys.argv[2], sys.argv[3]
flags = {a.split('=')[0]: (a.split('=')[1] if '=' in a else '') for a in sys.argv[4:]}
VERBA = flags.get('--verba', '063')

ult = lambda v: str(v or '').split('|')[-1].strip()

por = collections.defaultdict(float)
comps = collections.Counter()
with open(SRD, encoding='latin-1', errors='replace') as f:
    for r in csv.DictReader(f):
        if ult(r.get('BK_SRV')) != VERBA:
            continue
        comp = ult(r.get('DTCOMPET'))[:6]
        if not comp.startswith(str(ANO)):
            continue
        try:
            val = float(ult(r.get('RD_VALOR')) or 0)
        except ValueError:
            continue
        if not val:
            continue
        # a mesma chave do cadastro: filial(4) + matrícula(6) → posto_codigo
        fil = ult(r.get('BK_FILIAL'))
        mat = ult(r.get('BK_SRA')).zfill(6)
        por[f'{fil}-{mat}'] += val
        comps[comp] += 1

if not por:
    print(f'⛔ nenhuma linha da verba {VERBA} em {ANO} — confira o código da verba no srv.csv')
    sys.exit(2)

# ⚠ A COLUNA TEM DE VIAJAR NO ARQUIVO DE POSTOS, não sozinha: a tela de
# importação faz upsert de POSTO a partir de cada linha, e um arquivo com duas
# colunas tentaria criar postos sem empresa, filial nem CC. Por isso o
# `--postos=`, que mescla a coluna no arquivo da carga e devolve um novo.
# Quem está no arquivo de postos e não recebeu PLR sai com a célula VAZIA — e
# vazio, numa coluna PRESENTE, quer dizer "esta pessoa não tem", que é o
# certo. (A importação só apaga as verbas cujas colunas o arquivo traz.)
origem = flags.get('--postos', '')
sem_posto = []
if origem:
    with open(origem, encoding='utf-8-sig') as f:
        linhas = list(csv.DictReader(f))
    cols = list(linhas[0].keys())
    if VERBA not in cols:
        cols.append(VERBA)
    achados = set()
    for r in linhas:
        v = por.get(r['posto_codigo'])
        r[VERBA] = f'{v:.2f}' if v else ''
        if v:
            achados.add(r['posto_codigo'])
    sem_posto = sorted(set(por) - achados)
    with open(SAIDA, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(linhas)
else:
    with open(SAIDA, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['posto_codigo', VERBA])
        w.writeheader()
        for k in sorted(por):
            w.writerow({'posto_codigo': k, VERBA: f'{por[k]:.2f}'})

tot = sum(por.values())
print(f'verba {VERBA} · ano {ANO}')
print(f'  competências: {", ".join(f"{c} ({n})" for c, n in sorted(comps.items()))}')
print(f'  {len(por)} pessoa(s) · total {tot:,.2f} · média {tot/len(por):,.2f}')
if origem:
    print(f'  mesclado em {len(linhas)} linha(s) de "{origem}"')
    if sem_posto:
        print(f'  ⚠ {len(sem_posto)} pessoa(s) com PLR NÃO estão no arquivo de postos — ficam de fora: '
              + ', '.join(sem_posto[:8]) + ('…' if len(sem_posto) > 8 else ''))
else:
    print('  ⚠ arquivo SÓ com a coluna da verba — a tela de postos não importa assim.')
    print('    Use --postos=<arquivo da carga> para mesclar a coluna nele.')
print(f'\n→ {SAIDA}   (tem remuneração por pessoa · pasta ignorada pelo git)')
