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

Benefícios: as verbas de VA/VR, assistência médica, multibenefícios, vale-transporte
e seguro de vida viram UMA COLUNA CADA, nomeada com o código da verba. É o formato
que a tela de Postos espera para gravar posto_verba — ela casa coluna com verba do
catálogo. Os valores saem do movimento da folha (srd.csv, do mesmo RH.zip), na
última competência fechada.

Uso:  python3 scripts/converter_funcionarios.py [entrada.csv] [saida.csv]
          [--srd=dados_rh/srd.csv] [--comp=202609] [--sem-beneficios]
"""
import csv, sys, os, zipfile, tempfile
from collections import Counter
from datetime import date


def do_zip(path: str, zips=('dados_rh/RH.zip', 'RH.zip')) -> str:
    """Se `path` não existe, procura o mesmo nome dentro do RH.zip e extrai.

    O export do GoodData vem zipado com Funcionarios.csv + srd.csv + srv.csv, e
    o srd tem 43 MB — não vale versionar nem pedir que alguém extraia à mão todo
    mês. Devolve o caminho utilizável, ou o original se não achar."""
    if os.path.exists(path):
        return path
    alvo = os.path.basename(path)
    for z in zips:
        if not os.path.exists(z):
            continue
        try:
            with zipfile.ZipFile(z) as zf:
                nomes = [n for n in zf.namelist() if os.path.basename(n) == alvo]
                if not nomes:
                    continue
                destino = os.path.join(tempfile.gettempdir(), alvo)
                with zf.open(nomes[0]) as src, open(destino, 'wb') as dst:
                    dst.write(src.read())
                print(f'  ({alvo} extraído de {z})')
                return destino
        except zipfile.BadZipFile:
            continue
    return path

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
SRD     = _flag_val('--srd', 'dados_rh/srd.csv')       # movimento da folha, p/ os benefícios
COMP    = _flag_val('--comp', '')                      # competência AAAAMM; vazio = última FECHADA
SEM_BENEF = '--sem-beneficios' in _flags

# Verbas de benefício que viram coluna no arquivo de import. O nome da coluna é o
# CÓDIGO da verba: é assim que a tela de Postos casa coluna -> posto_verba
# (ela procura colunas cujo nome bate com uma verba do catálogo, tipo VALOR_FIXO).
#
# 230 (comissões) e 231 (bônus) entram aqui e NÃO no salário, embora cheguem
# como provento: no catálogo as duas são `VALOR_FIXO`, que é o tipo de quem tem
# valor próprio por pessoa. Somá-las à base faria o motor reajustá-las pelo
# DISSÍDIO — ele só reajusta a BASE —, e dissídio de sindicato não corrige
# bônus. Vale inclusive para contrato partido (228 fixa + 231 fixa): a parte
# fixa do bônus é bônus.
VERBAS_BENEFICIO = ['D49', 'A76', 'D50', 'A15', 'A51', '230', '231']

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
    # zero à esquerda: o export perde o zero quando a matrícula vira número no
    # ETL (medido: 1 de 560 veio com 5 dígitos). A folha normaliza com zfill(6),
    # então sem isto aqui a MESMA pessoa fica com duas matrículas e o realizado
    # dela não casa com o posto. Só dígitos — 'NFUNC' tem de continuar 'NFUNC'
    # para ser descartado logo adiante.
    if matricula.isdigit():
        matricula = matricula.zfill(6)
    fiscal = filial = ''
    for i, p in enumerate(parts):
        if p.upper().startswith('SRA'):
            fiscal = ''.join(c for c in p if c.isdigit())[:2]           # SRA250 -> 25
            seq = parts[i + 1] if i + 1 < len(parts) else ''             # 01
            if fiscal and seq:
                filial = fiscal + seq.zfill(2)                          # 2501
            break
    return fiscal, filial, matricula

# Verbas que DIZEM o regime: quem recebe prestação de serviços é PJ, quem tem
# salário-base é CLT. O ERP tem um campo próprio para isso e ele não vem no
# export — e não vai vir (decisão do DP, nov/2026).
VERBA_PRESTADOR = {'222', '228'}   # horas faturáveis + prestação de serviços
VERBA_CLT       = {'B39'}          # salário base (verba de referência)
VERBA_ESTAGIO   = {'075'}          # bolsa-auxílio — o ERP já paga em código próprio


def regime_pela_verba(srd_regimes: dict, filial: str, mat: str) -> str:
    """Regime pela folha, quando o movimento diz. '' quando não há evidência."""
    v = srd_regimes.get((filial, (mat or '').zfill(6)))
    if not v:
        return ''
    # ⚠ A competência MAIS RECENTE manda, não "tem/não tem". Quem converte de PJ
    # para CLT fica com os dois carimbos para sempre, e um teste de presença
    # devolveria o regime antigo. Há um caso assim hoje (PJ até 202511, CLT
    # desde 202610).
    #
    # ⚠⚠ B39 NÃO É EXCLUSIVO DO CLT. Medido no srd de nov/26: os 19 estagiários
    # têm 075 E B39 na MESMA competência — o ERP guarda a bolsa como salário de
    # referência também. Um argmax ingênuo empataria e deixaria a ordem da lista
    # (ou a ordem alfabética do nome do regime) decidir, em silêncio e sempre
    # para o mesmo lado.
    #
    # A regra é de precedência, não de recência: quem tem 075 é estagiário,
    # A MENOS QUE o B39 continue DEPOIS de a bolsa parar — que é a efetivação.
    # Há um caso real: a Beatriz Orestes foi estagiária até 202510 e hoje tem
    # outro posto como CLT.
    est, clt, prest = (v.get('est') or ''), (v.get('clt') or ''), (v.get('prest') or '')
    if prest and prest > max(est, clt):
        return 'PRESTADOR'
    if est:
        return 'CLT' if clt > est else 'ESTAGIO'
    if clt:
        return 'CLT'
    return 'PRESTADOR' if prest else ''


def carregar_regimes(path: str) -> dict:
    """{(filial, matrícula): {'prest': comp, 'clt': comp}} — a última competência
    de cada tipo de verba, lendo o movimento INTEIRO.

    ⚠ O arquivo inteiro, não o mês: o `srd` do mês corrente chega incompleto
    (out/26 tinha 16 pessoas no B39 contra 124 em setembro, porque a folha CLT
    ainda não havia fechado). Olhar só a última competência jogaria quase todo
    mundo fora da evidência. Mesmo motivo do "último B39 por pessoa" em
    `preencher_salario_folha.py`.
    """
    if not os.path.exists(path):
        return {}
    out: dict = {}
    with open(path, newline='', encoding='latin-1') as f:
        for r in csv.DictReader(f):
            v = apos_ultimo_pipe(r.get('BK_SRV', ''))
            tipo = ('prest' if v in VERBA_PRESTADOR else 'clt' if v in VERBA_CLT
                    else 'est' if v in VERBA_ESTAGIO else '')
            if not tipo:
                continue
            k = (apos_ultimo_pipe(r.get('BK_FILIAL', '')),
                 apos_ultimo_pipe(r.get('BK_SRA', '')).zfill(6))
            comp = apos_ultimo_pipe(r.get('DTCOMPET', ''))[:6]
            d = out.setdefault(k, {'prest': '', 'clt': '', 'est': ''})
            if comp > d[tipo]:
                d[tipo] = comp
    return out


def regime_por(mat: str, cargo: str, srd_regimes: dict = {}, filial: str = '') -> str:
    """Três degraus, nesta ordem — e a ordem é a regra.

    1. cargo "SOCIO" → PROLABORE. ⚠ CONTINUA COM PRIORIDADE SOBRE A VERBA: o
       pró-labore também é pago por B39, então a verba sozinha transformaria os
       17 postos de sócios em CLT. Medido antes de mexer.
    2. a verba do movimento (222/228 = PJ · B39 = CLT · 075 = ESTÁGIO) —
       evidência, não convenção. ⚠ O estágio SÓ se resolve aqui: a matrícula do
       estagiário é da faixa 0 e a reserva o devolveria como CLT, que é
       exatamente o defeito que este degrau existe para não deixar acontecer —
       o motor cobraria dele 60% de encargos que a Lei 11.788 diz não existir. É o que resolve quem tem a matrícula fora da faixa: um
       prestador numerado como `090041` virava CLT e saía sem salário, porque o
       script de salário procura B39 para CLT e um PJ não tem B39.
    3. a matrícula (0 = CLT, 9 = PRESTADOR) vira a RESERVA, não a regra. Ela
       responde por quem ainda não apareceu na folha — admitido depois do
       fechamento. Sem ela essa pessoa ficaria SEM regime, e sem regime o motor
       não calcula encargo nenhum.

    Medido em nov/2026: 545 de 569 resolvidos por sócio ou verba, 24 na reserva,
    e um único posto muda de regime (o `090041`, CLT → PRESTADOR), que é o caso
    que motivou a mudança.
    """
    if 'SOCIO' in (cargo or '').upper():
        return 'PROLABORE'
    pela_verba = regime_pela_verba(srd_regimes, filial, mat)
    if pela_verba:
        return pela_verba
    c = (mat or '')[:1]
    return 'CLT' if c == '0' else 'PRESTADOR' if c == '9' else ''

def data_iso(v: str) -> str:
    s = (v or '').strip()
    if len(s) == 8 and s.isdigit() and s != '00000000':
        return f'{s[0:4]}-{s[4:6]}-{s[6:8]}'
    return ''

# Rateio por centro de custo (regra Ricardo, 12/jul): CC -> código de rateio.
# O nome tem de ser EXATAMENTE o cadastrado em "6 · Rateio": o import casa por
# nome e só avisa no rodapé o que não encontrar. Renomear a regra na tela
# desamarra o rateio de todos os postos daquele código — aconteceu em set/2026
# com 72 postos, e o sintoma só aparece no Aplicar, lá na frente.
# ⚠⚠ ESTA TABELA É O QUE MANTÉM O RATEIO VIVO. A importação de postos
# RE-SINCRONIZA `posto_rateio`: apaga o dos postos do arquivo e recria pela
# coluna `RATEIO`. Então CC que não estiver aqui tem o rateio APAGADO na carga
# seguinte, em silêncio — não basta cadastrar na tela nem rodar um seed.
# Vários códigos separados por `;` viram CASCATA, na ordem escrita.
RATEIO_POR_CC = {}
for _cc in ('111', '141', '411', '210', '310'): RATEIO_POR_CC[_cc] = 'RATEMP01'
for _cc in ('121', '122', '123', '131', '132', '133'): RATEIO_POR_CC[_cc] = 'RATEMP02'
RATEIO_POR_CC['317'] = 'RATEMP03'
# Marketing (nov/2026): empresa primeiro, o que sobra por centro de custo. A
# ORDEM é a cascata — invertê-la muda o resultado. Hoje só o 524 tem gente; os
# demais 5xx entram porque a regra é do CC, não de quem está nele.
for _cc in ('511', '512', '513', '514', '515', '516', '517', '518',
            '521', '522', '523', '524', '525', '526', '527', '528'):
    RATEIO_POR_CC[_cc] = 'RATEMP01;RATCC04'

def rateio_por_cc(cc: str) -> str:
    return RATEIO_POR_CC.get((cc or '').strip(), '')

# Quem recebe POR HORA não sai daqui. Tentei a categoria da folha (RA_CATFUNC) e
# o cargo deste cadastro; nenhum dos dois serve: a categoria só separa PJ de CLT
# (o que `regime` já faz) e o cargo é genérico demais — 214 dos 303 que apontam
# são "ANAL. NEGOCIO III", e só 3 são "GESTOR DE PROJETOS". O que decide é a
# FUNÇÃO no projeto, que vem na coluna `Cargo` do Extrato de Horas Apontadas e é
# marcada em Posto de trabalho → Apontamento (tabela `apontamento_funcao`).
def carregar_beneficios(path: str, comp_pedida: str = ''):
    """Lê o movimento da folha (srd.csv do RH.zip) e devolve
    ({posto_codigo: {verba: valor}}, competência usada, aviso).

    A chave do posto é filial(BK_FILIAL) + matrícula(BK_SRA) — a mesma que o
    cadastro monta. Medido em out/2026: 105 pessoas com benefício, todas casando
    com um posto do cadastro, nenhuma órfã.

    A competência default é a última FECHADA, não a última que aparece: o mês
    corrente entra no export com a folha ainda rodando (out/2026 tinha só uma das
    cinco verbas) e orçaria benefício a menos para todo mundo. "Fechada" aqui é o
    último mês com pelo menos 60% das pessoas da mediana dos meses anteriores.

    ⚠ A ESCOLHA É POR VERBA, não uma só para todas. Elas não fecham juntas: no
    srd de out/26 a 231 veio com 31 pessoas e a D49 com NENHUMA. Com um teste
    único, bastava uma verba cheia para o mês parecer fechado e as outras
    entrarem vazias — e vazio aqui não é "não tem", é benefício orçado a menos,
    calado. É a mesma lição do B39 no `preencher_salario_folha.py`: a
    completude do export varia por verba.
    """
    if not os.path.exists(path):
        return {}, '', f'sem {path} — benefícios não incluídos'
    alvo = set(VERBAS_BENEFICIO)
    por_comp = {}            # comp -> {posto: {verba: valor}}
    with open(path, newline='', encoding='latin-1') as f:
        for r in csv.DictReader(f):
            verba = apos_ultimo_pipe(r.get('BK_SRV', ''))
            if verba not in alvo:
                continue
            try:
                val = float(apos_ultimo_pipe(r.get('RD_VALOR', '')) or 0)
            except ValueError:
                continue
            if not val:
                continue
            comp = apos_ultimo_pipe(r.get('DTCOMPET', ''))[:6]
            filial = apos_ultimo_pipe(r.get('BK_FILIAL', ''))
            matric = apos_ultimo_pipe(r.get('BK_SRA', ''))
            if not (comp and filial and matric):
                continue
            chave = f'{filial}-{matric}'
            d = por_comp.setdefault(comp, {}).setdefault(chave, {})
            d[verba] = d.get(verba, 0) + val
    if not por_comp:
        return {}, '', 'nenhuma das verbas de benefício apareceu no movimento'

    comps = sorted(por_comp)
    if comp_pedida and comp_pedida not in por_comp:
        return {}, '', f'competência {comp_pedida} não existe no movimento ({comps[0]}..{comps[-1]})'

    # quantas pessoas cada verba teve em cada competência
    pop = {}
    for c, postos in por_comp.items():
        for ch, vs in postos.items():
            for v in vs:
                pop.setdefault(v, {}).setdefault(c, 0)
                pop[v][c] += 1

    escolha, avisos = {}, []
    for v, porc in sorted(pop.items()):
        cs = sorted(porc)
        if comp_pedida:
            escolha[v] = comp_pedida; continue
        tam = sorted(porc[c] for c in cs)
        mediana = tam[len(tam) // 2]
        fechadas = [c for c in cs if porc[c] >= mediana * 0.6]
        escolha[v] = fechadas[-1] if fechadas else cs[-1]
        if escolha[v] != comps[-1]:
            avisos.append(f'{v}: {escolha[v]} (a {comps[-1]} tem '
                          f'{porc.get(comps[-1], 0)} contra mediana de {mediana})')

    saida = {}
    for v, c in escolha.items():
        for ch, vs in por_comp.get(c, {}).items():
            if v in vs:
                saida.setdefault(ch, {})[v] = vs[v]
    usadas = sorted(set(escolha.values()))
    return saida, '/'.join(usadas), ('competência por verba — ' + ' · '.join(avisos) if avisos else '')


COLS_SAIDA = ['posto_codigo', 'empresa', 'filial', 'cc', 'matricula',
              'nome', 'cargo', 'regime', 'salario', 'admissao', 'demissao', 'situacao', 'ativo', 'rateio',
              'recurso', 'afastado_desde'] + VERBAS_BENEFICIO

# SRA.RA_SITFOLH neste export vem como CÓDIGO de uma letra, não rotulada:
# vazio=ativo, D=demitido, F=férias, A=afastado.
#
# `F` (férias) fica FORA de propósito: férias a empresa paga, e a provisão 1/12
# do motor já cobre o custo — zerar o salário ali seria errado duas vezes.
# `D` já sai antes por `ativo`, e demitido não é afastado.
#
# O teste por texto é fallback: outras instalações exportam o rótulo
# ('03 - AFASTADO INSS'), e aí o código numérico é que varia.
AFAST_COD = {'A'}
def eh_afastado(situacao: str) -> bool:
    t = (situacao or '').strip().upper()
    if t in AFAST_COD:
        return True
    return 'AFAST' in t or 'LICEN' in t or 'AUXILIO' in t or 'AUXÍLIO' in t

def converter(entrada: str, saida: str, somente_ativos: bool = False, depara=None,
              beneficios=None, comp_benef: str = '', aviso_benef: str = '',
              srd_regimes=None):
    depara = depara or {}
    beneficios = beneficios or {}
    srd_regimes = srd_regimes or {}
    with open(entrada, newline='', encoding='utf-8-sig') as f:
        linhas = list(csv.DictReader(f))

    saida_rows, vistos = [], {}
    # competência de referência do afastamento: a dos benefícios quando houve
    # movimento, senão o mês corrente — em ambos os casos "a pessoa está
    # afastada agora"
    comp_afast = f'{comp_benef[:4]}-{comp_benef[4:6]}' if len(comp_benef) >= 6 else date.today().strftime('%Y-%m')
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
        # BK_RECURSO vem como 'P |01|AE8200||001075' — o código fica depois do
        # último pipe, e vazio quando a pessoa não aponta horas. É o campo que o
        # integrador da folha usa (SRA.RA_X_RECUR) para achar o apontamento, e
        # sem ele não há como ligar o extrato de horas à folha.
        recurso   = apos_ultimo_pipe(r.get('BK_RECURSO', ''))
        if recurso.upper().startswith('INDEFINIDO') or '-' in recurso:
            recurso = ''   # placeholder do ERP ('01 - INDEFINIDO'), não é código
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
               'regime': regime_por(matricula, cargo, srd_regimes, filial), 'salario': '',
               'admissao': admissao, 'demissao': demissao, 'situacao': situacao, 'ativo': ativo,
               'rateio': rateio_por_cc(cc), 'recurso': recurso,
               # O ERP diz que a pessoa ESTÁ afastada; não diz até quando. Então
               # sai só o início (a competência do export) e o retorno fica em
               # aberto, para ser previsto pessoa a pessoa na grade de Postos.
               # Em aberto o motor zera o salário nos 12 meses — é o pior caso,
               # e é por isso que a conferência não é opcional.
               'afastado_desde': (comp_afast if eh_afastado(situacao) else '')}
        # benefícios da última competência fechada; só quem tem valor leva número,
        # o resto fica vazio (prestador não recebe benefício CLT e some daqui)
        benef_pessoa = beneficios.get(posto_codigo, {})
        for v in VERBAS_BENEFICIO:
            row[v] = f'{benef_pessoa[v]:.2f}' if benef_pessoa.get(v) else ''

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
    rat = Counter(r['rateio'] or '(sem rateio)' for r in saida_rows)
    print('Rateio: ' + ', '.join(f'{k}={v}' for k, v in sorted(rat.items())))
    print(f'\nEmpresas ({len(empresas)}): ' + ', '.join(f'{k}={v}' for k, v in sorted(empresas.items())))
    print(f'Filiais ({len(filiais)}): ' + ', '.join(f'{k}={v}' for k, v in sorted(filiais.items())))
    if beneficios or aviso_benef:
        com = sum(1 for r in saida_rows if any(r.get(v) for v in VERBAS_BENEFICIO))
        if com:
            print(f'\nBenefícios (competência {comp_benef}): {com} posto(s) com valor')
            for v in VERBAS_BENEFICIO:
                qt = sum(1 for r in saida_rows if r.get(v))
                tot = sum(float(r[v]) for r in saida_rows if r.get(v))
                print(f'   {v}  {qt:>4} posto(s)  {tot:>12,.2f}')
            orfas = [k for k in beneficios if k not in vistos]
            if orfas:
                print(f'   ⚠ {len(orfas)} pessoa(s) com benefício sem posto no cadastro: ' + ', '.join(orfas[:6]))
        else:
            print('\n⚠ Benefícios: nenhum valor casou com posto do cadastro.')
        if aviso_benef:
            print(f'   nota: {aviso_benef}')
    # SITFOLHA inteira, para conferir o que o eh_afastado() pegou e o que deixou
    sit = Counter(r['situacao'] or '(vazio)' for r in saida_rows)
    print('\nSituação na folha: ' + ', '.join(f'{k}={v}' for k, v in sorted(sit.items())))
    afast = [r for r in saida_rows if r['afastado_desde']]
    if afast:
        print(f'⚠ {len(afast)} afastado(s) em {comp_afast}, SEM previsão de retorno — '
              'o motor zera salário/encargos/provisões os 12 meses. Confira pessoa a pessoa na grade.')
        for r in afast[:12]:
            print(f'   {r["posto_codigo"]:<14} {r["nome"][:34]:<34} {r["situacao"]}')
        if len(afast) > 12:
            print(f'   … e outros {len(afast) - 12}')
    print(f'CCs distintos: {len(ccs)}  |  Cargos distintos: {len(cargos)}')
    if filiais_sem_empresa:
        print('\n⚠ Filiais SEM empresa no de-para (empresa vazia — corrija o de-para): '
              + ', '.join(f'{k}={v}' for k, v in sorted(filiais_sem_empresa.items())))
    print(f'\nTop 15 cargos:')
    for k, v in cargos.most_common(15):
        print(f'  {v:4d}  {k}')
    print(f'\n→ {saida}')

if __name__ == '__main__':
    ENTRADA = do_zip(ENTRADA)
    if not os.path.exists(ENTRADA):
        print(f'ERRO: não achei "{ENTRADA}". Coloque o arquivo na raiz do projeto '
              f'ou passe o caminho: python3 scripts/converter_funcionarios.py <entrada.csv>')
        sys.exit(1)
    depara = carregar_depara(DEPARA)
    if depara:
        print(f'De-para filial→empresa: {len(depara)} filiais carregadas de "{DEPARA}" (BK_EMPRESA ignorado).')
    else:
        print(f'AVISO: de-para "{DEPARA}" não encontrado — usando BK_EMPRESA como fallback (não recomendado).')
    benef, comp_b, aviso_b = ({}, '', '') if SEM_BENEF else carregar_beneficios(do_zip(SRD), COMP)
    if benef:
        print(f'Benefícios: {len(benef)} pessoa(s) em "{SRD}", competência {comp_b}.')
    elif not SEM_BENEF:
        print(f'AVISO: benefícios não carregados — {aviso_b or "motivo desconhecido"}.')
    # ⚠ O MESMO arquivo dos benefícios, lido por outra pergunta. `do_zip` já
    # extraiu o csv; chamar de novo aqui reaproveita o caminho resolvido em vez
    # de descompactar duas vezes.
    regimes = carregar_regimes(do_zip(SRD))
    if regimes:
        print(f'Regime pela folha: {len(regimes)} pessoa(s) com verba que define CLT/PJ em "{SRD}".')
    else:
        print('AVISO: sem evidência de regime no movimento — tudo cai na faixa da matrícula.')
    converter(ENTRADA, SAIDA, SOMENTE_ATIVOS, depara, benef, comp_b, aviso_b, regimes)
