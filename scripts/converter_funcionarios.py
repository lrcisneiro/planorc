#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Converte o export TOTVS `Funcionarios.csv` (colunas BK_* com códigos entre pipes)
num template LIMPO para importar postos/funcionários no Planorc.

Regra de parsing (confirmada com Ricardo, 09/jul):
  - Todo campo BK_* com pipe → usar o valor APÓS O ÚLTIMO `|`.
      BK_EMPRESA       "P |01|05"            -> empresa  = 05
      BK_FILIAL        "P |01|2001"          -> filial   = 2001
      BK_CENTRO_CUSTO  "P |01|CTT200||411"   -> cc       = 411
      BK_FUNCIONARIO   "P |01|SRA200|01|900000" -> matricula = 900000
  - nome/cargo/datas/situação vêm das colunas próprias.
  - Linha placeholder "INDEFINIDO" (matrícula 000000 / NFUNC) é descartada.

Saída: funcionarios_convertido.csv — uma linha por POSTO (funcionário × empresa/
filial/CC + vigência). Cargo/salário/regime moram no posto; salário NÃO existe
neste arquivo (fica em branco p/ preencher depois pela folha).

Uso:  python3 scripts/converter_funcionarios.py [entrada.csv] [saida.csv]
"""
import csv, sys, os
from collections import Counter

_args  = [a for a in sys.argv[1:] if not a.startswith('--')]
_flags = {a for a in sys.argv[1:] if a.startswith('--')}
def _flag_val(nome, default):
    for a in _flags:
        if a.startswith(nome + '='):
            return a.split('=', 1)[1]
    return default

ENTRADA = _args[0] if len(_args) > 0 else 'Funcionarios.csv'
SAIDA   = _args[1] if len(_args) > 1 else 'funcionarios_convertido.csv'
DEPARA  = _flag_val('--depara', 'dados_rh/depara_filial_empresa.csv')  # de-para filial -> empresa gerencial
SOMENTE_ATIVOS = '--somente-ativos' in _flags   # descarta demitidos (SITFOLHA=D)

def apos_ultimo_pipe(v: str) -> str:
    return (v or '').split('|')[-1].strip()

def carregar_depara(path: str) -> dict:
    """CSV com colunas 'filial' e 'empresa' (qualquer ordem, case-insensitive).
    Retorna { filial(4díg) : empresa_gerencial }. A empresa NÃO vem mais do BK_EMPRESA."""
    m = {}
    if not os.path.exists(path):
        return m
    with open(path, newline='', encoding='utf-8-sig') as f:
        primeira = f.readline(); f.seek(0)
        delim = ';' if primeira.count(';') > primeira.count(',') else ','   # export BR costuma vir com ;
        rd = csv.DictReader(f, delimiter=delim)
        campos = {(c or '').lower().strip(): c for c in (rd.fieldnames or [])}
        cf, ce = campos.get('filial'), campos.get('empresa')
        if not (cf and ce):
            print(f'AVISO: {path} precisa de cabeçalhos "filial" e "empresa". Ignorando de-para.')
            return {}
        for r in rd:
            fil = str(r.get(cf, '')).strip(); emp = str(r.get(ce, '')).strip()
            if fil:
                m[fil] = emp
    return m

def parse_bk_funcionario(bk: str):
    """BK_FUNCIONARIO 'P |01|SRA250|01|900001' -> (fiscal='25', filial='2501', matricula='900001').
    A filial de 4 díg. é derivada do SRA (fiscal) + seq — o BK_FILIAL cru vem errado (2001)
    para SRA250/280. matricula = valor após o último pipe."""
    parts = [p.strip() for p in (bk or '').split('|')]
    matricula = parts[-1] if parts else ''
    fiscal = filial = ''
    for i, p in enumerate(parts):
        if p.upper().startswith('SRA'):
            fiscal = ''.join(c for c in p if c.isdigit())[:2]           # SRA250 -> 25
            seq = parts[i + 1] if i + 1 < len(parts) else ''             # 01
            if fiscal and seq:
                filial = fiscal + seq.zfill(2)                          # 2501
            break
    return fiscal, filial, matricula

def regime_por(mat: str, cargo: str) -> str:
    # critério Ricardo (09/jul): cargo "SOCIO" = PROLABORE (prioridade);
    # senão matrícula iniciando em 0 = CLT, em 9 = PRESTADOR.
    if 'SOCIO' in (cargo or '').upper():
        return 'PROLABORE'
    c = (mat or '')[:1]
    return 'CLT' if c == '0' else 'PRESTADOR' if c == '9' else ''

def data_iso(v: str) -> str:
    s = (v or '').strip()
    if len(s) == 8 and s.isdigit() and s != '00000000':
        return f'{s[0:4]}-{s[4:6]}-{s[6:8]}'
    return ''

COLS_SAIDA = ['posto_codigo', 'empresa', 'filial', 'cc', 'matricula',
              'nome', 'cargo', 'regime', 'salario', 'admissao', 'demissao', 'situacao', 'ativo']

def converter(entrada: str, saida: str, somente_ativos: bool = False, depara=None):
    depara = depara or {}
    with open(entrada, newline='', encoding='utf-8-sig') as f:
        linhas = list(csv.DictReader(f))

    saida_rows, vistos = [], {}
    lidas = puladas = colisoes = pulados_inativos = 0
    cargos, empresas, filiais, ccs = Counter(), Counter(), Counter(), Counter()
    filiais_sem_empresa = Counter()

    for r in linhas:
        lidas += 1
        cc        = apos_ultimo_pipe(r.get('BK_CENTRO_CUSTO', ''))
        _fiscal, filial, matricula = parse_bk_funcionario(r.get('BK_FUNCIONARIO', ''))  # filial 4 díg. derivada do SRA
        # empresa gerencial vem do DE-PARA filial->empresa (ignora BK_EMPRESA); fallback = BK_EMPRESA se sem de-para
        if depara:
            empresa = depara.get(filial, '')
            if filial and not empresa:
                filiais_sem_empresa[filial] += 1
        else:
            empresa = apos_ultimo_pipe(r.get('BK_EMPRESA', ''))
        nome      = (r.get('NOME_FUNC', '') or '').strip()
        cargo     = (r.get('CARGO_RECURO', '') or '').strip()
        situacao  = (r.get('SITFOLHA', '') or '').strip()
        admissao  = data_iso(r.get('RA_ADMISSA', ''))
        demissao  = data_iso(r.get('RA_DEMISSA', ''))

        # descarta placeholder / linhas sem chave
        if (empresa.upper().startswith('INDEFINIDO') or matricula in ('', 'NFUNC', '000000')
                or not filial or nome.upper().startswith('00-')):
            puladas += 1
            continue

        situacao = '' if situacao == '01 - INDEFINIDO' else situacao
        ativo = 'nao' if situacao.upper().startswith('D') else 'sim'  # D = demitido
        if somente_ativos and ativo == 'nao':
            pulados_inativos += 1
            continue
        posto_codigo = f'{filial}-{matricula}'

        row = {'posto_codigo': posto_codigo, 'empresa': empresa, 'filial': filial,
               'cc': cc, 'matricula': matricula, 'nome': nome, 'cargo': cargo,
               'regime': regime_por(matricula, cargo), 'salario': '',
               'admissao': admissao, 'demissao': demissao, 'situacao': situacao, 'ativo': ativo}

        if posto_codigo in vistos:   # colisão: mantém a admissão mais recente
            colisoes += 1
            if admissao >= vistos[posto_codigo]['admissao']:
                vistos[posto_codigo] = row
            continue
        vistos[posto_codigo] = row
        cargos[cargo] += 1; empresas[empresa] += 1; filiais[filial] += 1; ccs[cc] += 1

    saida_rows = list(vistos.values())
    with open(saida, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=COLS_SAIDA)
        w.writeheader(); w.writerows(saida_rows)

    print(f'Lidas: {lidas} | descartadas (indefinido/sem chave): {puladas} | '
          f'demitidos pulados (--somente-ativos): {pulados_inativos} | '
          f'colisões posto_codigo: {colisoes} | gravadas: {len(saida_rows)}')
    print(f'Ativos: {sum(1 for r in saida_rows if r["ativo"]=="sim")} | '
          f'inativos (demitidos): {sum(1 for r in saida_rows if r["ativo"]=="nao")}')
    reg = Counter(r['regime'] or '(vazio)' for r in saida_rows)
    print('Regime: ' + ', '.join(f'{k}={v}' for k, v in sorted(reg.items())))
    print(f'\nEmpresas ({len(empresas)}): ' + ', '.join(f'{k}={v}' for k, v in sorted(empresas.items())))
    print(f'Filiais ({len(filiais)}): ' + ', '.join(f'{k}={v}' for k, v in sorted(filiais.items())))
    print(f'CCs distintos: {len(ccs)}  |  Cargos distintos: {len(cargos)}')
    if filiais_sem_empresa:
        print('\n⚠ Filiais SEM empresa no de-para (empresa vazia — corrija o de-para): '
              + ', '.join(f'{k}={v}' for k, v in sorted(filiais_sem_empresa.items())))
    print(f'\nTop 15 cargos:')
    for k, v in cargos.most_common(15):
        print(f'  {v:4d}  {k}')
    print(f'\n→ {saida}')

if __name__ == '__main__':
    if not os.path.exists(ENTRADA):
        print(f'ERRO: não achei "{ENTRADA}". Coloque o arquivo na raiz do projeto '
              f'ou passe o caminho: python3 scripts/converter_funcionarios.py <entrada.csv>')
        sys.exit(1)
    depara = carregar_depara(DEPARA)
    if depara:
        print(f'De-para filial→empresa: {len(depara)} filiais carregadas de "{DEPARA}" (BK_EMPRESA ignorado).')
    else:
        print(f'AVISO: de-para "{DEPARA}" não encontrado — usando BK_EMPRESA como fallback (não recomendado).')
    converter(ENTRADA, SAIDA, SOMENTE_ATIVOS, depara)
