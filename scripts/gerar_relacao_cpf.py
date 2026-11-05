#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara a entrada do importador de CPF (Cadastros → Funcionários → Importar)
a partir do `Funcionarios.csv` que vem no RH.zip.

POR QUE EXISTE: esse export é o único lugar onde o CPF chega, mas chega com os
nomes e o formato do Protheus. O perfil do importador (`ImportarFuncionarios.tsx`)
espera cabeçalhos legíveis — então a tradução mora aqui, ao lado dos outros
conversores, e o perfil segue genérico.

⚠⚠ A CHAVE SAI DE `BK_FUNCIONARIO`, NÃO DE `BK_FILIAL`. Medido: `BK_FILIAL`
devolve `2001` para gente das filiais **2501 e 2801** — ele é agrupador, não a
filial contábil. Usá-lo casaria 40 pessoas com o posto de OUTRA filial, em
silêncio, porque a matrícula se repete entre filiais (`900001` existe em quase
todas). `BK_FUNCIONARIO` traz `P |01|SRA250|01|900001`, de onde saem a empresa
(`250` → `25`), a filial (`01`) e a matrícula — e aí as contagens batem posto a
posto com o banco (2501: 27 · 2801: 13), com ZERO colisão de chave.
`filial.codigo` = empresa(2) + filial(2) — a concatenação é feita na tela, que é
onde a convenção desta instalação do Protheus deve ficar.

⚠ A SAÍDA TEM CPF. Vai para `dados_rh/`, que está no .gitignore, e sobe pelo
navegador. Nunca gerar `.sql` com esses dados nem tirá-los dessa pasta; o
console aqui não imprime nenhum CPF.

O QUE ISSO CONSERTA: `posto.funcionario_id` — o elo posto → pessoa → gestor.
Ele foi a zero quando os 568 postos foram apagados e recriados na importação de
outubro, e sem ele o Organograma por **gestor** mostra toda caixa com 0 pessoas.
A hierarquia (`funcionario.gestor_id`, 302 pessoas) nunca se perdeu.

Uso:
  python3 scripts/gerar_relacao_cpf.py \
      dados_rh/folha_202610/rh/Funcionarios.csv \
      dados_rh/relacao_cpf_202610.csv
"""
import csv, re, sys, collections

if len(sys.argv) < 3:
    print(__doc__); sys.exit(1)
ENTRADA, SAIDA = sys.argv[1], sys.argv[2]

# P |01|SRA200|01|900000  →  empresa 200 · filial 01 · matrícula 900000
CHAVE = re.compile(r'SRA(\d{3})\|(\d{2})\|(\w+)$')

with open(ENTRADA, encoding='utf-8-sig', errors='replace') as f:
    linhas = list(csv.DictReader(f))

out, vistos, semChave, semCpf = [], set(), [], 0
for r in linhas:
    m = CHAVE.search(str(r.get('BK_FUNCIONARIO') or ''))
    if not m:
        semChave.append(str(r.get('NOME_FUNC') or '').strip()); continue
    emp, fil, mat = m.groups()
    nome = ' '.join(str(r.get('NOME_FUNC') or '').split())
    cpf = ''.join(ch for ch in str(r.get('CPF') or '') if ch.isdigit())
    if len(cpf) != 11:
        semCpf += 1; continue
    k = (emp, fil, mat)
    if k in vistos: continue
    vistos.add(k)
    # Cabeçalhos SEM ACENTO de propósito: são todos aliases que o perfil
    # aceita, e o leitor da tela decodifica o CSV como binário — nome de coluna
    # acentuado é exatamente onde isso falharia, e falharia como "coluna
    # obrigatória ausente", que não aponta para a causa.
    out.append({'CPF': cpf, 'Nome': nome, 'Matricula': mat,
                'Empresa': emp[:2], 'Filial': fil,
                'Situacao': str(r.get('SITFOLHA') or '').strip()})

if not out:
    print('⛔ nenhuma linha utilizável'); sys.exit(2)

with open(SAIDA, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)

porFilial = collections.Counter(o['Empresa'] + o['Filial'] for o in out)
sit = collections.Counter(o['Situacao'] or '(trabalhando)' for o in out)
print(f"{len(linhas)} linha(s) lidas · {len(out)} vínculo(s) · "
      f"{len({o['CPF'] for o in out})} pessoa(s) distinta(s)")
print("por filial:", dict(sorted(porFilial.items())))
print("situação:  ", dict(sit))
if semCpf:   print(f"⚠ {semCpf} linha(s) sem CPF válido — ficam de fora (o casamento é por CPF)")
if semChave: print(f"⚠ {len(semChave)} linha(s) sem chave em BK_FUNCIONARIO: {semChave}")
print(f"\n→ {SAIDA}   (contém CPF · pasta ignorada pelo git · importe e apague se quiser)")
