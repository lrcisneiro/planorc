#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Converte a folha analítica TOTVS (prgper02_emp*.xlsx "Conferência Contabilização
Folha") num CSV limpo para importar o REALIZADO DA FOLHA no Planorc (fat_folha).

Uma linha de saída por (matrícula × verba × contabilização) do mês. Traz o débito/
crédito contábil da folha, então o realizado casa na MESMA linha da DRE (via conta
do débito) e no POSTO (por filial+matrícula). Paralelo ao razão (fat_realizado).

Colunas usadas da folha: EMPRESA, FILIAL, MATRICULA, NOME, PERIODO, CD_VERBA,
DESC_VERBA, TIPO_VERBA, VALOR, CENTRO_CUSTO, DEBITO, CREDITO.
  - filial (4 díg.) = EMPRESA(2) + FILIAL(2)  → 20+01 = 2001 (bate com os postos)
  - empresa gerencial via de-para filial→empresa (mesma do converter de postos)
  - período '202605' → ano 2026, mês 5

Uso: python3 scripts/converter_folha_realizada.py [pasta_folha] [saida.csv] [--depara=...]
"""
import csv, glob, os, sys, openpyxl
from collections import Counter

_args  = [a for a in sys.argv[1:] if not a.startswith('--')]
_flags = {a for a in sys.argv[1:] if a.startswith('--')}
def _flag_val(nome, default):
    for a in _flags:
        if a.startswith(nome + '='):
            return a.split('=', 1)[1]
    return default

FOLHA_DIR = _args[0] if len(_args) > 0 else 'dados_rh'
SAIDA     = _args[1] if len(_args) > 1 else 'dados_rh/folha_realizada.csv'
DEPARA    = _flag_val('--depara', 'dados_rh/Depara_filial_empresa.csv')
DEPARA_IT = _flag_val('--depara-item', 'dados_rh/DePara ItemCCxEmpresa.csv')  # ITEM_CONTABIL → empresa
FORCE     = _flag_val('--competencia', '')   # 'YYYY-MM' força a competência de saída (teste)
FORCE_ANO = FORCE_MES = None
if FORCE:
    _p = FORCE.replace('/', '-').split('-'); FORCE_ANO = int(_p[0]); FORCE_MES = int(_p[1])

def eh_resultado(conta: str) -> bool:
    """Conta de RESULTADO = começa com 3 (receita) ou 4 (despesa); 1 e 2 são
    patrimoniais. É o que decide qual lado do lançamento vai para a DRE."""
    c = (conta or '').strip()
    return bool(c) and c[0] in ('3', '4')


def carregar_depara(path: str) -> dict:
    """CSV com colunas 'filial' e 'empresa'. Retorna { filial(4díg) : empresa_gerencial }."""
    m = {}
    if not os.path.exists(path):
        return m
    with open(path, newline='', encoding='utf-8-sig') as f:
        primeira = f.readline(); f.seek(0)
        delim = ';' if primeira.count(';') > primeira.count(',') else ','
        rd = csv.DictReader(f, delimiter=delim)
        campos = {(c or '').lower().strip(): c for c in (rd.fieldnames or [])}
        cf, ce = campos.get('filial'), campos.get('empresa')
        if not (cf and ce):
            return {}
        for r in rd:
            fil = str(r.get(cf, '')).strip(); emp = str(r.get(ce, '')).strip()
            if fil:
                m[fil] = emp
    return m

def carregar_depara_item(path: str) -> dict:
    """CSV ITEMCONTABIL;Código da Empresa;Empresa → { item_contabil : empresa_gerencial }.
    Quando a coluna Y (ITEM_CONTABIL) vem preenchida, a empresa da linha é redirecionada."""
    m = {}
    if not os.path.exists(path):
        return m
    with open(path, newline='', encoding='utf-8-sig') as f:
        primeira = f.readline(); f.seek(0)
        delim = ';' if primeira.count(';') > primeira.count(',') else ','
        rd = csv.DictReader(f, delimiter=delim)
        cols = rd.fieldnames or []
        itemcol = next((c for c in cols if 'item' in (c or '').lower()), cols[0] if cols else None)
        codecol = next((c for c in cols if 'digo' in (c or '').lower()), cols[1] if len(cols) > 1 else None)  # "Código da Empresa"
        if not (itemcol and codecol):
            print(f'AVISO: {path} precisa de colunas ITEMCONTABIL e "Código da Empresa". Ignorando de-para item.')
            return {}
        for r in rd:
            it = str(r.get(itemcol, '')).strip(); emp = str(r.get(codecol, '')).strip()
            if it:
                m[it] = emp
    return m

def norm_mat(x) -> str:
    return str(x or '').strip().split('.')[0].zfill(6)

def filial_folha(emp, fil) -> str:
    return f'{str(emp or "").strip().zfill(2)}{str(fil or "").strip().zfill(2)}'

def periodo_ano_mes(p):
    s = str(p or '').strip().split('.')[0]
    if len(s) == 6 and s.isdigit():
        return int(s[:4]), int(s[4:6])
    return None, None

# posto_codigo e rateio (layout 28/jul):
#   posto_codigo = filial+matrícula (amarra explícito ao posto; caminho estrito no
#     import → linha de posto NÃO cadastrado é rejeitada e reportada, não entra com
#     posto nulo). Ver postos cadastrados antes de importar a folha.
#   rateio = 'N' (já rateado): o realizado do ERP já vem distribuído (redirect
#     ITEM_CONTABIL), então a conciliação NÃO deve ratear de novo.
COLS_SAIDA = ['ano', 'mes', 'empresa', 'filial', 'cc', 'matricula', 'nome',
              'verba_cod', 'verba_desc', 'tipo_verba', 'valor', 'conta_deb', 'conta_cred',
              'item_orc', 'item_orc_desc', 'competencia', 'posto_codigo', 'rateio', 'horas']

def converter(folha_dir: str, saida: str, depara: dict, depara_item: dict = None):
    depara_item = depara_item or {}
    arquivos = sorted(glob.glob(os.path.join(folha_dir, 'prgper02_emp*.xlsx')))
    if not arquivos:
        print(f'ERRO: nenhum prgper02_emp*.xlsx em "{folha_dir}"'); sys.exit(1)

    out_rows = []
    lidas = puladas = sem_periodo = sem_deb = invertidas = cred_contabilizado = 0
    conta_terceiro = {}    # (filial, matrícula) → (conta, item, desc) do PJ
    pendentes = []         # créditos de resultado, resolvidos no 2º passe
    redirecionado = Counter()
    tipos, competencias, empresas = Counter(), Counter(), Counter()
    filiais_sem_empresa = Counter()
    redirecionadas = Counter(); item_sem_depara = Counter()
    total_valor = 0.0

    for fn in arquivos:
        wb = openpyxl.load_workbook(fn, data_only=True, read_only=True); ws = wb.active
        hdr = None
        for i, r in enumerate(ws.iter_rows(values_only=True)):
            if i == 1:
                hdr = {h: j for j, h in enumerate(r)}; continue
            if not hdr or i < 2:
                continue
            def g(col):
                j = hdr.get(col)
                return r[j] if (j is not None and j < len(r)) else None
            lidas += 1
            mat = norm_mat(g('MATRICULA'))
            if mat in ('', '000000', 'NFUNC'):
                puladas += 1; continue
            ano, mes = periodo_ano_mes(g('PERIODO'))
            if not ano:
                sem_periodo += 1; continue
            if FORCE_ANO:                        # recarimba a competência (ex.: testar em 2027)
                ano, mes = FORCE_ANO, FORCE_MES
            tipo_verba = (g('TIPO_VERBA') or '').strip()
            conta_deb  = str(g('DEBITO')  or '').strip()
            conta_cred = str(g('CREDITO') or '').strip()
            # LCTO_PADRAO (coluna AH) diz se a linha FOI CONTABILIZADA pela folha.
            # Preenchido ('GPE') → o razão já tem os dois lados, e a conciliação
            # já exclui a contrapartida de crédito por conta_cred_cod (v3_087):
            # trazer o crédito aqui seria contar duas vezes.
            # Vazio → é PJ, que não contabiliza por verba e sim pela nota. Aí o
            # crédito é o único lugar onde o efeito no resultado existe.
            contabilizada = bool(str(g('LCTO_PADRAO') or '').strip())
            it_cr_cod  = str(g('IT_CONTAB_CR') or '').strip()
            it_cr_desc = (g('DESC_IT_CONTAB_CR') or '').strip()
            # UM lançamento tem DOIS lados, e o que interessa à DRE é o lado que
            # toca RESULTADO (conta 3 ou 4) — não necessariamente o débito.
            #
            # No CLT o débito é a despesa e o crédito é o passivo a pagar: sai uma
            # linha positiva pelo débito, como sempre foi. Mas há verba invertida —
            # 549 CONVENIO MEDICO debita 21012017 (passivo) e credita 41013001
            # (despesa): é a empresa recuperando do prestador o convênio que
            # adiantou. Aí o efeito no resultado está no CRÉDITO, e reduz despesa.
            #
            # Antes essas linhas saíam com o item do débito vazio (patrimonial não
            # tem item orçamentário) e o importador as descartava na porta — 2.080
            # linhas e R$ 486 mil em ago/2026 nunca chegaram à conciliação.
            #
            # Cada lado de resultado vira sua própria linha de saída. O crédito
            # é caso especial e vai resolvido no SEGUNDO PASSE (ver adiante):
            # depende de saber se a pessoa é terceiro, o que só se sabe depois
            # de ler todas as linhas dela.
            if not eh_resultado(conta_deb) and not eh_resultado(conta_cred):
                sem_deb += 1; continue
            filial = filial_folha(g('EMPRESA'), g('FILIAL'))
            empresa = depara.get(filial, '')
            if filial and not empresa:
                filiais_sem_empresa[filial] += 1
            # ITEM_CONTABIL (coluna Y) redireciona a EMPRESA (filial permanece), via de-para
            item_contabil = str(g('ITEM_CONTABIL') or '').strip()
            if item_contabil:
                emp_red = depara_item.get(item_contabil)
                if emp_red:
                    empresa = emp_red; redirecionadas[item_contabil] += 1
                else:
                    item_sem_depara[item_contabil] += 1
            try:
                valor = float(g('VALOR') or 0)
            except Exception:
                valor = 0.0
            if not valor:
                puladas += 1; continue
            # chave da pessoa: filial + matrícula (a empresa pode ser redirecionada
            # por ITEM_CONTABIL e variar entre linhas da mesma pessoa)
            pessoa = (filial, mat)
            # AH vazio = não contabilizado pela folha = é PJ, que contabiliza
            # pela NOTA. A conta do débito dessas linhas é a conta de terceiro
            # daquela pessoa — é para lá que o crédito dela tem de ir.
            if not contabilizada and eh_resultado(conta_deb):
                conta_terceiro[pessoa] = (conta_deb, str(g('IT_CONTAB_DB') or '').strip(),
                                          (g('DESC_IT_CONTAB_DB') or '').strip())
            base = {
                'ano': ano, 'mes': mes, 'empresa': empresa, 'filial': filial,
                'cc': str(g('CENTRO_CUSTO') or '').strip(), 'matricula': mat,
                'nome': (g('NOME') or '').strip(),
                'verba_cod': str(g('CD_VERBA') or '').strip(), 'verba_desc': (g('DESC_VERBA') or '').strip(),
                'tipo_verba': tipo_verba,
                'competencia': f'{ano}{mes:02d}' if FORCE_ANO else str(g('PERIODO') or '').strip().split('.')[0],
                'posto_codigo': f'{filial}-{mat}', 'rateio': 'N',
                # QUANTIDADE. A folha grava as verbas de hora (222 normal, 223 traslado)
                # com quantidade = horas apontadas e valor = valor-hora do CADASTRO. Sem a
                # quantidade não há como conciliar contra o apontamento, que é em horas —
                # comparar valor compara duas taxas diferentes para a mesma hora.
                'horas': f"{float(g('HORAS_DIAS') or 0):.2f}",
            }
            # a conta que aparece em 'conta_deb' é sempre A CONTA AFETADA, e
            # 'conta_cred' a contrapartida — o import resolve conta_id pela
            # primeira. Na linha do crédito os dois vêm trocados de propósito.
            lados = []
            if eh_resultado(conta_deb):
                lados.append((conta_deb, conta_cred, valor,
                              str(g('IT_CONTAB_DB') or '').strip(),
                              (g('DESC_IT_CONTAB_DB') or '').strip()))
            for c_afetada, c_contra, v, it_cod, it_desc in lados:
                row = dict(base, valor=f'{v:.2f}', conta_deb=c_afetada, conta_cred=c_contra,
                           item_orc=it_cod, item_orc_desc=it_desc)
                out_rows.append(row)
                tipos[row['tipo_verba'] or '(vazio)'] += 1
                competencias[f'{ano}-{mes:02d}'] += 1
                empresas[empresa or '(sem empresa)'] += 1
                total_valor += v
            # guarda o crédito de resultado para o 2º passe (precisa saber se a
            # pessoa é terceiro, e isso só se sabe depois de ler tudo dela)
            if eh_resultado(conta_cred):
                pendentes.append((pessoa, dict(base), conta_cred, conta_deb, valor,
                                  it_cr_cod, it_cr_desc, ano, mes, empresa))
        wb.close()

    # ── 2º PASSE — o crédito de resultado de quem é TERCEIRO ──
    # A verba do desconto credita a conta do benefício (ex.: 549 → 41013001),
    # mas para o PJ isso está errado no cadastro: a nota dele sai LÍQUIDA do
    # desconto, então o efeito tem de cair na conta de TERCEIRO, não na do
    # benefício. Gera a linha com sinal invertido, na conta (e no item) em que
    # os proventos daquela pessoa estão.
    #
    # Quem não é terceiro não gera nada: para o CLT a folha contabiliza a verba,
    # o razão já tem os dois lados e a conciliação exclui a contrapartida por
    # conta_cred_cod (v3_087) — trazer o crédito aqui seria contar duas vezes.
    for pessoa, base, c_cred, c_deb, valor, it_cr, it_cr_desc, ano, mes, empresa in pendentes:
        alvo = conta_terceiro.get(pessoa)
        if not alvo:
            cred_contabilizado += 1
            continue
        conta_alvo, it_cod, it_desc = alvo
        # conta_cred = a conta que o ERP REALMENTE creditou (não o débito de
        # origem). Duas razões, e a segunda não é óbvia:
        #
        #  1. é mais verdadeiro: a contrapartida daquele valor é essa mesma.
        #  2. é o que mantém a conciliação de CLT limpa. O universo do CLT sai
        #     do razão — contas cujo histórico começa com verba presente na
        #     folha — MENOS os pares (conta, verba) que a folha declara em
        #     conta_cred_cod (v3_087). Gravando aqui o débito de origem, aquela
        #     exclusão deixava de casar e a conta creditada entrava no bloco com
        #     folha 0,00: em ago/2026 apareceram "Manutenção de veículos" e
        #     "Multas de trânsitos" do nada, e ~11,5 mil dos 21,5 mil de
        #     diferença do CLT eram esse artefato.
        #
        # O erro de cadastro continua visível — no aviso que este conversor
        # imprime a cada geração e no diagnostico_verba_conta_errada.sql. O
        # bloco de conciliação volta a conciliar só o que a folha contabiliza.
        out_rows.append(dict(base, valor=f'{-valor:.2f}', conta_deb=conta_alvo,
                             conta_cred=c_cred, item_orc=it_cod, item_orc_desc=it_desc))
        tipos[base['tipo_verba'] or '(vazio)'] += 1
        competencias[f'{ano}-{mes:02d}'] += 1
        empresas[empresa or '(sem empresa)'] += 1
        total_valor += -valor
        invertidas += 1
        if conta_alvo != c_cred:
            redirecionado[f'{base["verba_cod"]} {c_cred}→{conta_alvo}'] += 1

    with open(saida, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=COLS_SAIDA)
        w.writeheader(); w.writerows(out_rows)

    print(f'Arquivos: {len(arquivos)} | linhas lidas: {lidas} | gravadas: {len(out_rows)} | '
          f'puladas (sem matrícula/valor): {puladas} | sem lado de resultado (patrimonial dos 2 lados): {sem_deb} | sem período: {sem_periodo}')
    print(f'Linhas do CRÉDITO (sinal invertido): {invertidas}')
    print(f'Crédito de resultado de CLT (não invertido — o razão já tem os 2 lados): {cred_contabilizado}')
    if redirecionado:
        print('Crédito de terceiro redirecionado para a conta dele (cadastro da verba errado): '
              + ', '.join(f'{k} ({v}x)' for k, v in sorted(redirecionado.items())))
    print('Competências: ' + ', '.join(f'{k}={v}' for k, v in sorted(competencias.items())))
    print('Tipo de verba: ' + ', '.join(f'{k}={v}' for k, v in sorted(tipos.items())))
    print(f'Empresas ({len(empresas)}): ' + ', '.join(f'{k}={v}' for k, v in sorted(empresas.items())))
    print(f'Valor total (soma VALOR): R$ {total_valor:,.2f}')
    if redirecionadas:
        print('\nEmpresa redirecionada por ITEM_CONTABIL: ' + ', '.join(f'{k}→{depara_item.get(k)}={v}' for k, v in sorted(redirecionadas.items())))
    if item_sem_depara:
        print('⚠ ITEM_CONTABIL preenchido SEM de-para (empresa mantida pela filial): ' + ', '.join(f'{k}={v}' for k, v in sorted(item_sem_depara.items())))
    if filiais_sem_empresa:
        print('\n⚠ Filiais SEM empresa no de-para: ' + ', '.join(f'{k}={v}' for k, v in sorted(filiais_sem_empresa.items())))
    print(f'\n→ {saida}')

if __name__ == '__main__':
    depara = carregar_depara(DEPARA)
    print(f'De-para filial→empresa: {len(depara)} filiais carregadas de "{DEPARA}".' if depara
          else f'AVISO: de-para "{DEPARA}" não encontrado — empresa gerencial ficará vazia (resolvida pela filial no import).')
    depara_item = carregar_depara_item(DEPARA_IT)
    print(f'De-para ITEM_CONTABIL→empresa: {len(depara_item)} itens carregados de "{DEPARA_IT}".' if depara_item
          else f'AVISO: de-para item "{DEPARA_IT}" não encontrado — ITEM_CONTABIL não redireciona empresa.')
    if FORCE_ANO:
        print(f'⚠ Competência FORÇADA para {FORCE_ANO}-{FORCE_MES:02d} (teste) — os valores vêm da folha real, só o período foi recarimbado.')
    converter(FOLHA_DIR, SAIDA, depara, depara_item)
