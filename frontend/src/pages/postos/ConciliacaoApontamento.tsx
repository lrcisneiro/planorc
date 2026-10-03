import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { useLocalPref } from '../../lib/uiPrefs'
import { AlertCircle, ChevronDown, ChevronRight, FileDown, Search, X } from 'lucide-react'
import { usePassoLabel } from './PostosPills'
import { nomeCurto } from '../../lib/nomePessoa'

declare const XLSX: any

// Conciliação APONTAMENTO × FOLHA.
//
// A pergunta: as horas que o líder aprovou viraram custo na empresa e no centro
// de custo DAQUELE projeto? Quem responde hoje não tem como saber — o razão
// chega consolidado e a folha calcula sozinha.
//
// Três decisões que explicam o formato da tela:
//
// 1. CONFERE EM HORAS, nunca em valor. O extrato traz CUSTO_HORA (o custo
//    congelado do apontamento) e a folha usa o valor-hora do CADASTRO
//    (RetValHr): são duas taxas para a mesma hora, por desenho. Medido, comparar
//    valor deixava ~353 mil sem explicação; em horas a diferença some.
//
// 2. A COMPETÊNCIA É A DA FOLHA. O apontamento vem pela comp_folha gravada na
//    importação, que já embute a defasagem por tipo de contrato (PJ 1 mês, CLT
//    2). A tela não sabe da defasagem, e é por isso que ela não quebra quando um
//    regime novo tiver outra.
//
// 3. O ACHADO PRINCIPAL NÃO É "FALTOU HORA", É "FOI PARA O CC ERRADO". Daí o
//    status DESLOCADO: a pessoa recebeu todas as horas, mas num centro de custo
//    diferente do que ela apontou. O total fecha e mesmo assim o rateio da DRE
//    está errado — é o caso que nenhuma conferência por total pega.

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Verbas que o integrador gera a partir do apontamento (OEFOLM02.PRW):
// MV_XVBHRNO = hora normal, MV_XVBHRTR = traslado. As demais verbas de hora da
// folha vêm do cadastro, não do apontamento, e não entram nesta conta.
const VERBAS_HORA = ['222', '223']

export type ApontParams = {
  ano: number
  mes: number                      // competência da FOLHA
  empresaSel: string[]             // [] = todas as permitidas
  filialFilter: string[] | null    // null = sem filtro
  ccFilter: string[] | null
}

type Status = 'OK' | 'DESLOCADO' | 'DIVERGE' | 'SEM_FOLHA' | 'SEM_APONT' | 'NAO_HORA'
type LinhaCc = {
  ccId: string | null; empId: string | null; empCod: string; filCod: string; ccCod: string; ccRec: string
  hAp: number; hFo: number; delta: number; ok: boolean
  vAp: number; vFo: number; dVal: number
  // rateio do CLT: custo total da pessoa em contas de resultado neste
  // empresa·filial·CC, e as duas distribuições — a que o apontamento indica
  // (por HORAS) e a que a folha de fato fez (por VALOR).
  vTot: number; pctAp: number; pctFo: number
}
type Pessoa = {
  key: string; postoId: string | null; matricula: string; nome: string; local: string; regime: string
  funcao: string
  recebeHora: boolean        // o valor EFETIVO, já com a precedência resolvida
  funcaoRecebe: boolean      // o padrão da função, para onde desfazer a exceção volta
  porFuncao: boolean         // true = herdado da função; false = exceção gravada no posto
  hAp: number; hFo: number; delta: number; status: Status
  ccs: LinhaCc[]        // conferência (PJ): apontamento na filial do POSTO
  ccsCLT: LinhaCc[]     // distribuição (CLT): apontamento na filial do PROJETO
  localCLT: string      // as unidades de onde o trabalho veio
  vAp: number; vFo: number; dVal: number
  vTot: number               // custo da pessoa em contas de resultado (base do rateio)
  // R$/h de cada lado — é ESTE o número que se corrige no cadastro, não o
  // total. `misto` marca quem tem mais de uma taxa no período (traslado, ou
  // apontamento com custo/hora que mudou no meio do mês): aí o valor exibido é
  // média e não corresponde a nenhum campo cadastrado.
  tAp: number | null; tFo: number | null; dTaxa: number | null
  apMisto: boolean; foMisto: boolean
}
type Fora = { tipo: string; rotulo: string; linhas: number; horas: number }

// ── O lançamento de ajuste (AJTCC) ──
// A distorção do CLT é corrigida hoje à mão: um lote na contabilidade tira o
// custo da granularidade em que a folha contabilizou e o lança naquela que o
// apontamento apurou. É por isso que a conta de salário tem lançamentos com
// "AJTCC" no histórico, e eles aparecem como "fora da folha" na aba Contábil ×
// Folha — não vieram da folha, vieram desta correção.
//
// Aqui esse lote é calculado: por CONTA contábil, o valor DA FOLHA sai da
// origem e entra no destino na proporção das horas. Uma linha por
// (conta, origem, destino) — que é o grão em que o lançamento é feito.
type Ajuste = {
  contaCod: string; contaDesc: string
  origem: string; destino: string                   // rótulos, para a tela
  oEmp: string; oFil: string; oCc: string           // códigos, para o arquivo do ERP
  dEmp: string; dFil: string; dCc: string
  oItem: string; dItem: string                      // item contábil = empresa gerencial no código do ERP
  mesmoPlano: boolean                               // conta e CC existem dos dois lados?
  pct: number; valor: number
  mesma: boolean                                    // origem = destino: fica onde está
  pessoas: { matricula: string; nome: string; valor: number }[]
}

// ── Layout do TXT da Contabilização TXT (CTBA500) ──
// Pesquisado na documentação: o CTBA500 NÃO tem layout padrão da TOTVS. O
// arquivo é posicional e quem o interpreta é o LANÇAMENTO PADRÃO cadastrado no
// cliente, que lê cada campo com LerStr(pos,tam) / LerVal(pos,tam) /
// LerData(pos,tam). Ou seja: o layout abaixo é uma ESCOLHA nossa, e só funciona
// depois que o LP correspondente existir no Protheus.
//
// Por isso ele vive aqui como dado, e não espalhado em substrings pelo código:
// a tela imprime esta mesma tabela para quem vai cadastrar o LP, e assim o
// arquivo e a especificação não têm como divergir.
//
// Débito no DESTINO e crédito na ORIGEM: mover despesa de um CC para outro é
// creditar (reduzir) onde estava e debitar (aumentar) onde deveria estar.
//
// A FILIAL abre a linha, em 12 posições — formato da gestão corporativa — e isso
// desloca em +12 todas as posições seguintes. Ela só é lida quando a pergunta
// "Considera Filial no arquivo texto?" estiver como Sim; com ela ativa, um mesmo
// arquivo leva várias filiais, e o código do LP precisa existir em todas.
//
// A EMPRESA não é campo do arquivo: ela é o ambiente em que a rotina roda. Por
// isso sai um arquivo por empresa, e a empresa de cada lado do lançamento é
// identificada pelo ITEM CONTÁBIL — que é exatamente a empresa gerencial no
// código do ERP, o mesmo de-para que a importação da folha já usava.
const LAYOUT: { campo: string; pos: number; tam: number; tipo: 'A' | 'N' | 'D'; obs: string }[] = [
  { campo: 'Filial',            pos: 1,   tam: 12, tipo: 'A', obs: 'exige "Considera Filial no arquivo texto? = Sim"' },
  { campo: 'Lançamento padrão', pos: 13,  tam: 3,  tipo: 'A', obs: 'o mesmo código cadastrado em todas as filiais' },
  { campo: 'Data',              pos: 16,  tam: 8,  tipo: 'D', obs: 'ddmmaaaa' },
  { campo: 'Conta débito',      pos: 24,  tam: 20, tipo: 'A', obs: 'a mesma conta dos dois lados' },
  { campo: 'CC débito',         pos: 44,  tam: 9,  tipo: 'A', obs: 'destino — o que o apontamento apurou' },
  { campo: 'Item débito',       pos: 53,  tam: 9,  tipo: 'A', obs: 'item contábil da empresa de destino' },
  { campo: 'Conta crédito',     pos: 62,  tam: 20, tipo: 'A', obs: '' },
  { campo: 'CC crédito',        pos: 82,  tam: 9,  tipo: 'A', obs: 'origem — onde a folha contabilizou' },
  { campo: 'Item crédito',      pos: 91,  tam: 9,  tipo: 'A', obs: 'item contábil da empresa de origem' },
  { campo: 'Valor',             pos: 100, tam: 17, tipo: 'N', obs: '2 decimais, ponto, alinhado à direita' },
  { campo: 'Histórico',         pos: 117, tam: 40, tipo: 'A', obs: 'AJTCC + nome + o que mudou (CC, filial, ou os dois)' },
]
const LARGURA = 156          // conteúdo; o terminador entra por cima (ver abaixo)

const hrs = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v: number) => `${(100 * v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
// busca por nome tem de achar "JOAO" digitando "joão" e vice-versa — quem
// procura uma pessoa não sabe como o ERP gravou o acento dela
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const S: Record<string, CSSProperties> = {
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '0 0 16px' },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiS:  { fontSize: 11, color: 'var(--faint)' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 },
  head:  { display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px', flexWrap: 'wrap' },
  h2:    { fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 },
  hsub:  { fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 200, lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  gh:    { padding: '7px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  dh:    { textAlign: 'left', padding: '4px 8px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  dt:    { padding: '3px 8px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 16px' },
  aviso: { display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--orange)', fontSize: 12.5, margin: '0 0 16px', lineHeight: 1.6 },
  empty: { padding: '30px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  inp:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', width: 90 },
  btn:   { padding: '7px 12px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
  mono:  { fontFamily: 'monospace', color: 'var(--muted)' },
  prova: { display: 'flex', gap: 18, flexWrap: 'wrap', padding: '10px 14px', fontSize: 12, color: 'var(--text-mid)', background: 'var(--bg)', borderTop: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' },
}

const chip = (cor: string, fundo: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, color: cor, background: fundo, whiteSpace: 'nowrap' })
const ST: Record<Status, { txt: string; est: CSSProperties; ajuda: string }> = {
  OK:        { txt: 'confere',    est: chip('var(--green)',  'rgba(52,211,153,0.14)'), ajuda: 'as horas apontadas viraram folha, no mesmo centro de custo' },
  DESLOCADO: { txt: 'outro CC',   est: chip('var(--orange)', 'rgba(251,146,60,0.14)'), ajuda: 'recebeu todas as horas, mas em centro de custo diferente do apontado — o total fecha e o rateio da DRE fica errado' },
  DIVERGE:   { txt: 'diverge',    est: chip('var(--red)',    'rgba(248,113,113,0.14)'), ajuda: 'a quantidade de horas não bate' },
  SEM_FOLHA: { txt: 'sem folha',  est: chip('var(--red)',    'rgba(248,113,113,0.14)'), ajuda: 'apontou horas aprovadas e a folha não pagou nenhuma' },
  SEM_APONT: { txt: 'sem apont.', est: chip('var(--blue)',   'rgba(59,130,246,0.14)'), ajuda: 'a folha pagou hora que não tem apontamento nesta competência' },
  NAO_HORA:  { txt: 'não por hora', est: chip('var(--muted)', 'rgba(148,163,184,0.14)'), ajuda: 'aponta horas mas recebe salário — o integrador do ERP não gera verba de hora para quem não tem roteiro AUT' },
}
const ORDEM: Status[] = ['DIVERGE', 'SEM_FOLHA', 'DESLOCADO', 'SEM_APONT', 'OK', 'NAO_HORA']

export function ConciliacaoApontamento({ params: p }: { params: ApontParams }) {
  const passoLabel = usePassoLabel()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [fora, setFora] = useState<Fora[]>([])
  const [ajustes, setAjustes] = useState<Ajuste[]>([])
  const [totApont, setTotApont] = useState(0)      // horas do apontamento desta competência, TUDO
  const [totFolha, setTotFolha] = useState(0)      // horas 222/223 da folha, TUDO
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [recolhidos, setRecolhidos] = useLocalPref<string[]>('planorc_apont_recolhidos', [])
  // busca por pessoa: não fica no localStorage — é uma pergunta do momento,
  // e uma busca lembrada de ontem esconderia a tela inteira sem explicar por quê
  const [busca, setBusca] = useState('')
  const alvo = norm(busca.trim())
  // procurando alguém, o quadro recolhido esconderia justamente quem se procura
  const recolhido = (k: string) => !alvo && recolhidos.includes(k)
  const alternarQuadro = (k: string) => setRecolhidos(r => r.includes(k) ? r.filter(x => x !== k) : [...r, k])
  // tolerância em HORAS — outra grandeza, outro número: a do tenant é em reais.
  // Meia hora cobre arredondamento de fração sem esconder meio expediente.
  const [tolH, setTolH] = useLocalPref('planorc_apont_tol_h', 0.5)
  // parâmetros do lote contábil — lembrados porque mudam pouco de mês para mês
  const [lp, setLp] = useLocalPref('planorc_ajtcc_lp', '900')
  const [dataLanc, setDataLanc] = useLocalPref('planorc_ajtcc_data', '')
  const [verLayout, setVerLayout] = useState(false)
  // granularidade do lote: uma linha por (conta, origem, destino) ou uma por
  // FUNCIONÁRIO dentro dela. A segunda é muito maior, mas é a única que deixa o
  // razão conferível pessoa a pessoa depois — e é isso que se perde quando o
  // ajuste entra consolidado.
  const [granul, setGranul] = useLocalPref<'conta' | 'func'>('planorc_ajtcc_granul', 'conta')
  const [soDif, setSoDif] = useLocalPref('planorc_apont_so_dif', true)

  const alternar = (k: string) => setAberto(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setLoading(true); setErro(null)
      try {
        const [postos, ccs, filiais, empresas, funcoes] = await Promise.all([
          pageAll(() => supabase.from('posto').select('id,matricula,filial_id,regime,nome,recebe_hora')),
          supabase.from('centro_custo').select('id,codigo,descricao'),
          supabase.from('filial').select('id,codigo,empresa_id'),
          supabase.from('empresa').select('id,codigo,item_contabil,plano_id'),
          supabase.from('apontamento_funcao').select('funcao,recebe_hora'),
        ])
        if (!vivo) return

        // ── o filtro de empresa vira filtro de FILIAL, nos dois lados ──
        // A empresa gravada no apontamento é a do PROJETO; a da folha é a
        // gerencial da filial. Filtrar cada lado pela sua daria recortes
        // diferentes na mesma tela — a folha traria a pessoa e o apontamento
        // não, e a diferença seria do filtro, não do dado. Traduzir para filial
        // resolve: a filial é a mesma coisa nos dois.
        const filDaEmp = (p.empresaSel.length
          ? (filiais.data || []).filter((f: any) => p.empresaSel.includes(f.empresa_id)).map((f: any) => f.id)
          : null) as string[] | null
        const filAlvo = filDaEmp && p.filialFilter ? filDaEmp.filter(x => p.filialFilter!.includes(x))
          : filDaEmp ?? p.filialFilter
        const esc = (q: any, colFil: string, colCc: string) => {
          if (filAlvo) q = q.in(colFil, filAlvo)
          if (p.ccFilter) q = q.in(colCc, p.ccFilter)
          return q
        }

        const [ap, fo, contas] = await Promise.all([
          // o apontamento vem pela competência-ALVO, não pela sua própria:
          // é comp_folha que carrega a defasagem por tipo de contrato
          pageAll(() => esc(supabase.from('fat_apontamento')
            .select('posto_id,matricula,nome,recurso_cod,filial_id,filial_apont_id,cc_projeto_id,cc_recurso_id,horas,horas_rv,valor,intercambio,funcao,ano,mes')
            .eq('comp_folha_ano', p.ano).eq('comp_folha_mes', p.mes),
            'filial_id', 'cc_projeto_id')),
          // TODAS as verbas, não só as de hora: o CLT não tem verba de hora e
          // precisa do custo inteiro para o rateio. A separação entre "verba de
          // hora" e "custo total" é feita no laço, por verba_cod.
          // tipo = REALIZADO: fat_folha guarda também o orçado do motor de
          // postos, e sem este filtro a folha viria com o dobro.
          pageAll(() => esc(supabase.from('fat_folha')
            .select('posto_id,matricula,nome,empresa_id,filial_id,cc_id,verba_cod,horas,valor,conta_id')
            .eq('tipo', 'REALIZADO').eq('ano', p.ano).eq('mes', p.mes),
            'filial_id', 'cc_id')),
          // só o código importa: conta de RESULTADO começa com 3 ou 4, mesma
          // regra do conversor da folha e das outras abas da conciliação
          pageAll(() => supabase.from('conta_contabil').select('id,codigo,descricao')),
        ])
        if (!vivo) return

        const ehResultado = new Set((contas as any[])
          .filter(c => /^[34]/.test(String(c.codigo || '').trim())).map(c => c.id as string))
        const contaInfo = new Map((contas as any[]).map(c => [c.id as string,
          { cod: String(c.codigo || '').trim(), desc: String(c.descricao || '').trim() }]))
        const ccCod = new Map((ccs.data || []).map((c: any) => [c.id, c.codigo as string]))
        const filCod = new Map((filiais.data || []).map((f: any) => [f.id, f.codigo as string]))
        const empCod = new Map((empresas.data || []).map((e: any) => [e.id, e.codigo as string]))
        // item contábil = a empresa gerencial em outro código (empresa.item_contabil,
        // migration 115). O lançamento de ajuste não fecha sem ele.
        const empItem = new Map((empresas.data || []).map((e: any) => [e.id, String(e.item_contabil || '').trim()]))
        // plano de contas: é ele que decide se um lançamento pode cruzar empresa.
        // Compartilhado (as filiais BR), a conta e o CC existem dos dois lados;
        // plano diferente (Bolívia, Paraguai), não existem — e aí não é ajuste
        // de CC, é outra operação.
        const empPlano = new Map((empresas.data || []).map((e: any) => [e.id, e.plano_id as string | null]))

        // ── empresa: derivada da FILIAL, igual dos dois lados ──
        // O apontamento grava a empresa do PROJETO e a filial do POSTO — usar as
        // duas juntas daria um par incoerente ("empresa do cliente, filial da
        // pessoa"). Aqui a empresa sai sempre da filial, pelo de-para que a folha
        // usa de fato; a FK do cadastro entra só onde a folha não tem exemplo.
        const empDaFilial = new Map<string, string>()
        for (const r of fo as any[]) if (r.filial_id && r.empresa_id && !empDaFilial.has(r.filial_id)) empDaFilial.set(r.filial_id, r.empresa_id)
        for (const f of (filiais.data || []) as any[]) if (f.empresa_id && !empDaFilial.has(f.id)) empDaFilial.set(f.id, f.empresa_id)

        const regimeDe = new Map<string, string>()      // por posto
        const regimeFm = new Map<string, string>()      // por filial+matrícula, p/ folha sem posto casado
        // Quem recebe por hora sai da FUNÇÃO; o posto só entra como exceção.
        //   posto.recebe_hora > apontamento_funcao.recebe_hora > true
        // Função sem cadastro e posto NULL caem em "entra": esconder por
        // omissão seria pior do que acusar de mais.
        const horaFuncao = new Map<string, boolean>()
        for (const f of (funcoes.data || []) as any[]) horaFuncao.set(f.funcao, f.recebe_hora !== false)
        const horaDe = new Map<string, boolean | null>()
        const horaFm = new Map<string, boolean | null>()
        for (const q of postos as any[]) {
          const fm = `${q.filial_id}|${(q.matricula || '').trim()}`
          regimeDe.set(q.id, q.regime || ''); regimeFm.set(fm, q.regime || '')
          horaDe.set(q.id, q.recebe_hora ?? null); horaFm.set(fm, q.recebe_hora ?? null)
        }

        // ── o que fica FORA da conferência, e por quê ──
        // Some do quadro principal mas não do total: a prova de soma no rodapé
        // só fecha porque cada hora está em exatamente um lugar.
        const f: Record<string, Fora> = {}
        const põeFora = (tipo: string, rotulo: string, h: number) => {
          const k = tipo
          const g = f[k] || (f[k] = { tipo, rotulo, linhas: 0, horas: 0 })
          g.linhas++; g.horas += h
        }

        // valores andam junto das horas, mas NÃO são a mesma medida: vAp vem do
        // CUSTO_HORA congelado do apontamento e vFo do valor-hora do cadastro.
        // Uma diferença em R$ pode ser hora a mais, taxa diferente, ou as duas.
        // vFo  = só as verbas de HORA (222/223) — é contra isto que o PJ confere.
        // vTot = o custo inteiro da pessoa em contas de resultado, que é o que se
        //        rateia no CLT. Separados porque no PJ o custo total inclui verbas
        //        que não nascem de apontamento e estouraria a conferência.
        type Ag = { emp: string; fil: string; cc: string; hAp: number; hFo: number; vAp: number; vFo: number; vTot: number; ccRec: Set<string> }
        // pessoa -> (empresa·filial·CC) -> horas. O detalhe é o MESMO grão do
        // razão: lá a divergência aparece como "caiu na filial errada" tanto
        // quanto "caiu no CC errado", e com só o CC aqui o primeiro caso ficaria
        // invisível — as duas pontas somariam certo em lugares diferentes.
        const grade = new Map<string, Map<string, Ag>>()
        // ── a segunda grade: para onde o custo DEVERIA ir ──
        // A grade acima responde "as horas viraram folha?" e por isso agrega o
        // apontamento na filial do POSTO — a folha paga lá, e usar a do projeto
        // traria 12% de divergência falsa (medido).
        // Esta responde outra coisa: "de que UNIDADE é o trabalho?" — e a
        // resposta é a filial do PROJETO. Sem ela o item contábil do ajuste sai
        // igual nos dois lados e a troca entre unidades fica invisível; medido
        // em 2026, 802,3 h do CLT (7,8%) mudam de unidade, e o mesmo CC aparece
        // em até 7 unidades diferentes, então o CC sozinho não identifica.
        const gradeD = new Map<string, Map<string, Ag>>()
        const celD = (pk: string, emp: string, fil: string, cc: string) => {
          let m = gradeD.get(pk); if (!m) { m = new Map(); gradeD.set(pk, m) }
          const ck = `${emp}|${fil}|${cc}`
          let c = m.get(ck); if (!c) { c = { emp, fil, cc, hAp: 0, hFo: 0, vAp: 0, vFo: 0, vTot: 0, ccRec: new Set() }; m.set(ck, c) }
          return c
        }
        const infoP = new Map<string, { postoId: string | null; matricula: string; nome: string; regime: string; funcao: string; recebeHora: boolean; funcaoRecebe: boolean; porFuncao: boolean }>()
        const cel = (pk: string, emp: string, fil: string, cc: string) => {
          let m = grade.get(pk); if (!m) { m = new Map(); grade.set(pk, m) }
          const ck = `${emp}|${fil}|${cc}`
          let c = m.get(ck); if (!c) { c = { emp, fil, cc, hAp: 0, hFo: 0, vAp: 0, vFo: 0, vTot: 0, ccRec: new Set() }; m.set(ck, c) }
          return c
        }
        // a PESSOA é o posto, não o par filial+matrícula: quem foi pago numa
        // filial diferente da do posto viraria duas pessoas — uma sem folha e
        // outra sem apontamento — e a divergência real ficaria escondida atrás
        // de dois falsos positivos.
        const chaveP = (postoId: string | null, filial: string | null, mat: string) =>
          postoId || `fm:${filial}|${mat}`

        // taxas distintas por pessoa, para saber quando a média engana.
        // Do lado da folha cada linha ja traz valor e horas, entao a 222 (hora
        // normal, RetValHr) e a 223 (traslado, RetValTr) aparecem como duas
        // taxas — somar as duas e dividir daria um numero que nao existe em
        // nenhum cadastro.
        // pessoa -> (conta·empresa·filial·CC) -> valor da folha. É a ORIGEM do
        // ajuste: de onde o custo tem de sair.
        type Orig = { contaId: string; emp: string; fil: string; cc: string; valor: number }
        const origConta = new Map<string, Map<string, Orig>>()
        const taxasAp = new Map<string, Set<number>>()
        const taxasFo = new Map<string, Set<number>>()
        const põeTaxa = (m: Map<string, Set<number>>, pk: string, v: number, h: number) => {
          if (!h) return
          const t = Math.round((v / h) * 100) / 100
          const s = m.get(pk) || new Set<number>(); s.add(t); m.set(pk, s)
        }

        let tAp = 0, tFo = 0
        for (const r of ap as any[]) {
          const h = (Number(r.horas) || 0) + (Number(r.horas_rv) || 0)
          tAp += h
          if (!r.posto_id || !r.matricula) { põeFora('sem_posto', 'Recurso sem posto — não passa pela nossa folha, ou falta o código do recurso no cadastro', h); continue }
          if (r.intercambio) { põeFora('intercambio', 'Intercâmbio (projeto 9999999999) — hora apontada que não é de projeto de cliente', h); continue }
          const pk = chaveP(r.posto_id, r.filial_id, (r.matricula || '').trim())
          const c = cel(pk, empDaFilial.get(r.filial_id) || '', r.filial_id || '', r.cc_projeto_id || '')
          c.hAp += h; c.vAp += Number(r.valor) || 0
          põeTaxa(taxasAp, pk, Number(r.valor) || 0, h)
          const fap = r.filial_apont_id || r.filial_id
          const cd = celD(pk, empDaFilial.get(fap) || '', fap || '', r.cc_projeto_id || '')
          cd.hAp += h; cd.vAp += Number(r.valor) || 0
          if (r.cc_recurso_id && r.cc_recurso_id !== r.cc_projeto_id) c.ccRec.add(ccCod.get(r.cc_recurso_id) || '')
          const fm = `${r.filial_id}|${(r.matricula || '').trim()}`
          if (!infoP.has(pk)) {
            const exc = horaDe.has(r.posto_id) ? horaDe.get(r.posto_id)! : (horaFm.get(fm) ?? null)
            const pad = r.funcao ? horaFuncao.get(r.funcao) ?? true : true
            infoP.set(pk, {
              postoId: r.posto_id, matricula: (r.matricula || '').trim(), nome: r.nome || '',
              regime: regimeDe.get(r.posto_id) || regimeFm.get(fm) || '',
              funcao: r.funcao || '',
              recebeHora: exc ?? pad, funcaoRecebe: pad, porFuncao: exc === null,
            })
          }
        }
        for (const r of fo as any[]) {
          const mat = (r.matricula || '').trim()
          const pk = chaveP(r.posto_id, r.filial_id, mat)
          const ehHora = VERBAS_HORA.includes(String(r.verba_cod || '').trim())
          // Quem não aponta não entra na tela pelo lado da folha: como agora
          // lemos TODAS as verbas, sem esta guarda a folha inteira da empresa
          // viraria linha de "sem apontamento". Verba de hora é a exceção —
          // essa SIM cria a pessoa, porque folha de hora sem apontamento é
          // justamente um dos achados.
          if (!ehHora && !grade.has(pk)) continue
          const c = cel(pk, empDaFilial.get(r.filial_id) || r.empresa_id || '', r.filial_id || '', r.cc_id || '')
          if (ehResultado.has(r.conta_id)) {
            c.vTot += Number(r.valor) || 0
            // o mesmo valor guardado por CONTA: o ajuste é lançado conta a
            // conta, e o total por granularidade não bastaria para montá-lo
            const ok = `${r.conta_id}|${c.emp}|${c.fil}|${c.cc}`
            let mo = origConta.get(pk); if (!mo) { mo = new Map(); origConta.set(pk, mo) }
            const o = mo.get(ok) || { contaId: r.conta_id as string, emp: c.emp, fil: c.fil, cc: c.cc, valor: 0 }
            o.valor += Number(r.valor) || 0; mo.set(ok, o)
          }
          if (!ehHora) continue
          const h = Number(r.horas) || 0
          tFo += h
          c.hFo += h; c.vFo += Number(r.valor) || 0
          põeTaxa(taxasFo, pk, Number(r.valor) || 0, h)
          const fm = `${r.filial_id}|${mat}`
          // quem só aparece na folha não tem função (ela vem do apontamento):
          // entra na conferência, e é justamente o "pagou hora sem apontamento"
          if (!infoP.has(pk)) {
            const exc = horaDe.has(r.posto_id) ? horaDe.get(r.posto_id)! : (horaFm.get(fm) ?? null)
            infoP.set(pk, {
              postoId: r.posto_id, matricula: mat, nome: r.nome || '',
              regime: regimeDe.get(r.posto_id) || regimeFm.get(fm) || '',
              funcao: '', recebeHora: exc ?? true, funcaoRecebe: true, porFuncao: exc === null,
            })
          }
        }

        const out: Pessoa[] = []
        for (const [pk, m] of grade) {
          const i = infoP.get(pk)!
          const ccs_: LinhaCc[] = [...m.values()].map(c => ({
            ccId: c.cc || null, empId: c.emp || null,
            empCod: c.emp ? (empCod.get(c.emp) || '—') : '—',
            filCod: c.fil ? (filCod.get(c.fil) || '—') : '—',
            ccCod: c.cc ? (ccCod.get(c.cc) || c.cc.slice(0, 8)) : '(sem CC)',
            ccRec: [...c.ccRec].filter(Boolean).join(', '),
            hAp: c.hAp, hFo: c.hFo, delta: c.hAp - c.hFo, ok: Math.abs(c.hAp - c.hFo) <= tolH,
            // a tolerância continua em HORAS: é ela que define o que confere.
            // O valor acompanha para dimensionar, não para julgar.
            vAp: c.vAp, vFo: c.vFo, dVal: c.vAp - c.vFo, vTot: c.vTot,
            pctAp: 0, pctFo: 0,   // preenchidos abaixo, quando os totais existem
          })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)
            || a.empCod.localeCompare(b.empCod) || a.filCod.localeCompare(b.filCod) || a.ccCod.localeCompare(b.ccCod))
          const hAp = ccs_.reduce((s, c) => s + c.hAp, 0)
          const hFo = ccs_.reduce((s, c) => s + c.hFo, 0)
          const delta = hAp - hFo
          const vAp = ccs_.reduce((s, c) => s + c.vAp, 0)
          const vFo = ccs_.reduce((s, c) => s + c.vFo, 0)
          // as duas distribuições da pessoa. A do apontamento é por HORAS (é a
          // base do rateio que hoje se faz à mão); a da folha é por VALOR, que é
          // onde o custo realmente caiu.
          const vTot = ccs_.reduce((s, c) => s + c.vTot, 0)
          for (const c of ccs_) {
            c.pctAp = hAp ? c.hAp / hAp : 0
            c.pctFo = vTot ? c.vTot / vTot : 0
          }
          // a ordem dos testes é a leitura: primeiro quem nem devia estar aqui,
          // depois se existe dos dois lados, se o total fecha, e só então se foi
          // para o lugar certo
          const status: Status =
            !i.recebeHora ? 'NAO_HORA'
            : hFo === 0 ? 'SEM_FOLHA'
            : hAp === 0 ? 'SEM_APONT'
            : Math.abs(delta) > tolH ? 'DIVERGE'
            : ccs_.some(c => !c.ok) ? 'DESLOCADO'
            : 'OK'
          // o cabeçalho da pessoa mostra empresa · filial quando é uma só, e
          // "vários" quando não é — nesse caso o número que importa está no
          // detalhe, e um rótulo único ali seria mentira
          const pares = [...new Set(ccs_.map(c => `${c.empCod} · ${c.filCod}`))]
          const local = pares.length === 1 ? pares[0] : `${pares.length} locais`
          // ── a distribuição do CLT ──
          // Dois lados com origens diferentes de propósito: o apontamento diz a
          // unidade do PROJETO (de onde o trabalho é), a folha diz onde o custo
          // caiu. Uma linha só de um dos lados é o achado, não um defeito.
          const rotulo = (emp: string, fil: string, cc: string) => ({
            empId: emp || null,
            empCod: emp ? empCod.get(emp) || '—' : '—',
            filCod: fil ? filCod.get(fil) || '—' : '—',
            ccCod: cc ? ccCod.get(cc) || cc.slice(0, 8) : '(sem CC)',
          })
          const mapaD = new Map<string, LinhaCc>()
          const poe = (emp: string, fil: string, cc: string) => {
            const ck = `${emp}|${fil}|${cc}`
            let l = mapaD.get(ck)
            if (!l) {
              l = { ccId: cc || null, ...rotulo(emp, fil, cc), ccRec: '', hAp: 0, hFo: 0, delta: 0,
                    ok: true, vAp: 0, vFo: 0, dVal: 0, vTot: 0, pctAp: 0, pctFo: 0 }
              mapaD.set(ck, l)
            }
            return l
          }
          for (const c of (gradeD.get(pk)?.values() || [])) {
            const l = poe(c.emp, c.fil, c.cc); l.hAp += c.hAp; l.vAp += c.vAp
          }
          for (const o of (origConta.get(pk)?.values() || [])) {
            const l = poe(o.emp, o.fil, o.cc); l.vTot += o.valor
          }
          const ccsCLT = [...mapaD.values()]
          const totD = ccsCLT.reduce((s, c) => s + c.hAp, 0)
          const totV = ccsCLT.reduce((s, c) => s + c.vTot, 0)
          for (const c of ccsCLT) {
            c.pctAp = totD ? c.hAp / totD : 0
            c.pctFo = totV ? c.vTot / totV : 0
          }
          ccsCLT.sort((a, b) => b.hAp - a.hAp || b.vTot - a.vTot
            || a.empCod.localeCompare(b.empCod) || a.ccCod.localeCompare(b.ccCod))
          // no CLT o cabeçalho fala da unidade do PROJETO: é ela que muda, e
          // dizer "1 local" quando o trabalho veio de três esconderia
          // exatamente o que o quadro existe para mostrar
          const paresD = [...new Set(ccsCLT.filter(c => c.hAp).map(c => `${c.empCod} · ${c.filCod}`))]
          const localCLT = paresD.length === 1 ? paresD[0] : `${paresD.length} unidades`

          const tAp = hAp ? vAp / hAp : null
          const tFo = hFo ? vFo / hFo : null
          out.push({
            key: pk, ...i, local, hAp, hFo, delta, vAp, vFo, dVal: vAp - vFo, status, ccs: ccs_,
            ccsCLT, localCLT, vTot,
            tAp, tFo, dTaxa: tAp !== null && tFo !== null ? tAp - tFo : null,
            apMisto: (taxasAp.get(pk)?.size || 0) > 1, foMisto: (taxasFo.get(pk)?.size || 0) > 1,
          })
        }
        // dentro do status: primeiro quem tem mais hora divergente, depois quem
        // tem a TAXA mais desalinhada. Sem o segundo critério, a lista de quem
        // "confere" sairia em ordem de nome e a coluna de R$/h — que é a lista
        // de manutenção de cadastro — não teria como ser lida de cima para baixo.
        out.sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status)
          || Math.abs(b.delta) - Math.abs(a.delta)
          || Math.abs(b.dTaxa ?? 0) - Math.abs(a.dTaxa ?? 0)
          || a.nome.localeCompare(b.nome))

        // ── o lote de ajuste (AJTCC) ──
        // Só para quem é CLT e tem apontamento: cada linha de custo da folha é
        // repartida pelas proporções de HORAS da pessoa, conta a conta. O
        // resultado é consolidado por (conta, origem, destino), que é o grão em
        // que o lançamento é feito — a abertura por pessoa fica no drill, para
        // conferir sem precisar de outra tela.
        const aj = new Map<string, Ajuste>()
        const rot = (emp: string, fil: string, cc: string) =>
          `${emp ? empCod.get(emp) || '—' : '—'} · ${fil ? filCod.get(fil) || '—' : '—'} · ${cc ? ccCod.get(cc) || '—' : '(sem CC)'}`
        for (const g of out) {
          if (!g.regime.toUpperCase().includes('CLT') || g.status === 'NAO_HORA') continue
          const origens = origConta.get(g.key); if (!origens || !g.hAp) continue
          for (const o of origens.values()) {
            const ci = contaInfo.get(o.contaId) || { cod: '—', desc: '' }
            const origem = rot(o.emp, o.fil, o.cc)
            for (const d of g.ccsCLT) {
              if (!d.pctAp) continue
              const destino = `${d.empCod} · ${d.filCod} · ${d.ccCod}`
              const dEmpId = d.empId
              const k = `${ci.cod}|${origem}|${destino}`
              const a = aj.get(k) || {
                contaCod: ci.cod, contaDesc: ci.desc, origem, destino,
                oEmp: o.emp ? empCod.get(o.emp) || '' : '', oFil: o.fil ? filCod.get(o.fil) || '' : '', oCc: o.cc ? ccCod.get(o.cc) || '' : '',
                oItem: o.emp ? empItem.get(o.emp) || '' : '', dItem: dEmpId ? empItem.get(dEmpId) || '' : '',
                mesmoPlano: (empPlano.get(o.emp) || null) === (dEmpId ? empPlano.get(dEmpId) || null : null),
                dEmp: d.empCod === '—' ? '' : d.empCod, dFil: d.filCod === '—' ? '' : d.filCod, dCc: d.ccCod === '(sem CC)' ? '' : d.ccCod,
                pct: 0, valor: 0, mesma: origem === destino, pessoas: [],
              }
              const v = o.valor * d.pctAp
              a.valor += v
              a.pessoas.push({ matricula: g.matricula, nome: g.nome, valor: v })
              aj.set(k, a)
            }
          }
        }
        // o % de cada linha é sobre o total DA ORIGEM naquela conta: é assim que
        // quem confere o lote lê ("saiu 38% do que estava no CC 141")
        const totOrigem = new Map<string, number>()
        for (const a of aj.values()) totOrigem.set(`${a.contaCod}|${a.origem}`, (totOrigem.get(`${a.contaCod}|${a.origem}`) || 0) + a.valor)
        for (const a of aj.values()) {
          const t = totOrigem.get(`${a.contaCod}|${a.origem}`) || 0
          a.pct = t ? a.valor / t : 0
          a.pessoas.sort((x, y) => y.valor - x.valor)
        }
        setAjustes([...aj.values()].sort((a, b) =>
          a.contaCod.localeCompare(b.contaCod) || a.origem.localeCompare(b.origem)
          || Number(a.mesma) - Number(b.mesma) || b.valor - a.valor))

        setPessoas(out)
        setFora(Object.values(f).sort((a, b) => b.horas - a.horas))
        setTotApont(tAp); setTotFolha(tFo)
      } catch (e: any) {
        if (vivo) setErro((e?.message || String(e)) + (String(e?.message).includes('fat_apontamento') ? ' — rode a migration schema_v3_112_fat_apontamento.sql.' : ''))
      } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false }
  }, [p.ano, p.mes, JSON.stringify(p.empresaSel), JSON.stringify(p.filialFilter), JSON.stringify(p.ccFilter), tolH])

  // PJ e CLT respondem à mesma pergunta com naturezas diferentes: o terceiro é
  // pago POR hora, o CLT tem salário e aponta para saber onde o custo dele cai.
  // Separados, um não esconde o outro — e se um dia o CLT passar a gerar verba
  // de hora, o quadro dele deixa de estar vazio sozinho.
  const grupos = useMemo(() => {
    const naoHora = pessoas.filter(x => x.status === 'NAO_HORA')
    const resto = pessoas.filter(x => x.status !== 'NAO_HORA')
    const clt = resto.filter(x => x.regime.toUpperCase().includes('CLT'))
    const pj = resto.filter(x => !x.regime.toUpperCase().includes('CLT'))
    return { pj, clt, naoHora }
  }, [pessoas])

  // EXCEÇÃO por pessoa. O normal é marcar a função inteira, na tela de
  // importação — aqui é para quem foge do padrão da própria função. Gravar null
  // desfaz a exceção e devolve a pessoa ao que a função dela diz.
  const [salvando, setSalvando] = useState<string | null>(null)
  const marcarHora = async (g: Pessoa, recebe: boolean | null) => {
    if (!g.postoId) return
    setSalvando(g.key)
    const { error } = await supabase.from('posto').update({ recebe_hora: recebe }).eq('id', g.postoId)
    setSalvando(null)
    if (error) { setErro('Não consegui gravar: ' + error.message); return }
    setPessoas(ps => ps.map(x => {
      if (x.key !== g.key) return x
      const ef = recebe ?? x.funcaoRecebe
      return {
        ...x, recebeHora: ef, porFuncao: recebe === null,
        status: !ef ? 'NAO_HORA'
          : x.hFo === 0 ? 'SEM_FOLHA' : x.hAp === 0 ? 'SEM_APONT'
          : Math.abs(x.delta) > tolH ? 'DIVERGE' : x.ccs.some(c => !c.ok) ? 'DESLOCADO' : 'OK',
      }
    }))
  }

  const resumo = useMemo(() => {
    const c = (l: Pessoa[]) => ({
      n: l.length, hAp: l.reduce((s, x) => s + x.hAp, 0), hFo: l.reduce((s, x) => s + x.hFo, 0),
      vAp: l.reduce((s, x) => s + x.vAp, 0), vFo: l.reduce((s, x) => s + x.vFo, 0),
      vTot: l.reduce((s, x) => s + x.vTot, 0),
      dif: l.filter(x => x.status !== 'OK').length,
    })
    return { pj: c(grupos.pj), clt: c(grupos.clt), nh: c(grupos.naoHora), foraH: fora.reduce((s, x) => s + x.horas, 0) }
  }, [grupos, fora])

  // ── TXT da Contabilização TXT (CTBA500) ──
  // Cada linha é UM lançamento que move o custo de um CC para outro na mesma
  // conta. O arquivo é posicional e de largura fixa — o Protheus lê por posição,
  // então campo que estoura o tamanho é TRUNCADO, e é melhor truncar o histórico
  // do que desalinhar tudo o que vem depois dele.
  const txtCtb = () => {
    const A = (v: string, tam: number) => String(v ?? '').slice(0, tam).padEnd(tam, ' ')
    const N = (v: number, tam: number) => v.toFixed(2).slice(0, tam).padStart(tam, ' ')
    const dt = dataLanc.split('-')                        // yyyy-mm-dd → ddmmaaaa
    const data = dt.length === 3 ? `${dt[2]}${dt[1]}${dt[0]}` : ''

    // A matrícula saiu do histórico a pedido: ela já está implícita no par
    // conta/CC e o espaço vale mais para o nome, que é o que alguém reconhece
    // lendo o razão. Sem acento e em maiúsculas — o arquivo é texto plano.
    const historico = (a: Ajuste, nome: string) => {
      const pre = 'AJTCC '
      // Só entra no histórico o que de fato mudou. O mesmo CC existe em até 7
      // unidades, então quando a filial muda ela é indispensável; quando não
      // muda, repeti-la só rouba espaço do nome — e o nome é o que alguém
      // reconhece lendo o razão.
      const mFil = a.oFil !== a.dFil, mCc = a.oCc !== a.dCc
      const suf = mFil && mCc ? ` ${a.oFil}/${a.oCc}>${a.dFil}/${a.dCc}`
        : mFil ? ` ${a.oFil}>${a.dFil}`
        : ` ${a.oCc}>${a.dCc}`
      const sobra = 40 - pre.length - suf.length
      return norm(pre + (sobra > 3 ? nomeCurto(nome, sobra) : '') + suf).toUpperCase()
    }

    const linha = (a: Ajuste, valor: number, nome: string) => (
      A(a.oFil, 12) + A(lp, 3) + A(data, 8) +
      A(a.contaCod, 20) + A(a.dCc, 9) + A(a.dItem, 9) +     // débito  = destino
      A(a.contaCod, 20) + A(a.oCc, 9) + A(a.oItem, 9) +     // crédito = origem
      N(valor, 17) + A(historico(a, nome), 40)
    ).slice(0, LARGURA).padEnd(LARGURA, ' ')

    // Um arquivo por EMPRESA: no Protheus a importação roda dentro de uma
    // empresa, então misturá-las num arquivo só obrigaria a separar na mão. As
    // filiais daquela empresa convivem no mesmo arquivo — é para isso que a
    // filial entrou na linha.
    const porEmpresa = new Map<string, string[]>()
    for (const a of geraveis) {
      const regs = granul === 'func'
        ? a.pessoas.map(q => linha(a, q.valor, q.nome))
        : [linha(a, a.valor, '')]
      const k = empErp(a.oFil)
      porEmpresa.set(k, (porEmpresa.get(k) || []).concat(regs))
    }

    const mm = String(p.mes).padStart(2, '0')
    let i = 0
    for (const [emp, linhas] of porEmpresa) {
      const blob = new Blob([linhas.map(l => l + '\r\n').join('')], { type: 'text/plain;charset=iso-8859-1' })
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url; el.download = `ajtcc_${emp || 'sem_empresa'}_${p.ano}_${mm}.txt`
      // o navegador descarta downloads simultâneos do mesmo gesto; o intervalo
      // é o que faz chegarem todos quando há mais de uma empresa
      setTimeout(() => { el.click(); URL.revokeObjectURL(url) }, i * 400)
      i++
    }
  }

  const exportarXlsx = () => {
    const wb = XLSX.utils.book_new()
    const add = (nome: string, linhas: any[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome)
    const comp = `${MESES[p.mes - 1]}/${p.ano}`
    const escopoTxt = (v: string[] | null) => v === null || !v.length ? 'todas' : `${v.length} selecionada(s)`
    add('Resumo', [
      ['Conciliação Apontamento × Folha'],
      ['Competência da folha', comp],
      ['Verbas de hora consideradas', VERBAS_HORA.join(', ')],
      ['Tolerância (horas)', tolH],
      ['Empresas', escopoTxt(p.empresaSel)], ['Filiais', escopoTxt(p.filialFilter)], ['Centros de custo', escopoTxt(p.ccFilter)],
      [],
      ['', 'Pessoas', 'Horas apontadas', 'Valor apontado', 'Horas na folha', 'Valor na folha', 'Dif. h', 'Dif. R$', 'Com pendência'],
      ['CLT — distribuição (custo na folha: ' + money(resumo.clt.vTot) + ')', resumo.clt.n, resumo.clt.hAp, resumo.clt.vAp, '', '', '', '', ''],
      ['Terceiros (PJ) — conferência', resumo.pj.n, resumo.pj.hAp, resumo.pj.vAp, resumo.pj.hFo, resumo.pj.vFo,
        resumo.pj.hAp - resumo.pj.hFo, resumo.pj.vAp - resumo.pj.vFo, resumo.pj.dif],
      ['Não recebem por hora', resumo.nh.n, resumo.nh.hAp, resumo.nh.vAp, resumo.nh.hFo, resumo.nh.vFo, '', '', ''],
      ['Outras horas fora da conferência', '', resumo.foraH, '', '', '', '', '', ''],
      [],
      ['Ajuste de CC (AJTCC) — custo do CLT na folha', resumo.clt.vTot],
      ['  permanece na granularidade da folha', totPermanece],
      ['  a transferir para a granularidade do apontamento', totTransferir],
      ['  linhas no arquivo — consolidado por conta e CC', nPorConta],
      ['  linhas no arquivo — por funcionário', nPorFunc],
      [],
      ['Prova de soma — horas do apontamento', totApont],
      ['  conferidas (PJ)', conferidas],
      ['  CLT (distribuição)', resumo.clt.hAp],
      ['  não recebem por hora', resumo.nh.hAp],
      ['  fora da conferência', resumo.foraH],
      ['  sobra (deve ser zero)', sobra],
      ['Prova de soma — horas da folha (222/223)', totFolha],
      [],
      ['Exportado em', new Date().toLocaleString('pt-BR')],
      ['Obs.', 'A conferência é em HORAS: o apontamento usa o custo/hora congelado e a folha o valor-hora do cadastro — comparar valor compara duas taxas para a mesma hora.'],
    ])
    const pes: any[][] = [['Regime', 'Função', 'Empresa · Filial', 'Matrícula', 'Nome',
      'Horas apontadas', 'Valor apontado', 'R$/h apontamento', 'Horas na folha', 'Valor na folha', 'R$/h folha',
      'Diferença h', 'Diferença R$', 'Diferença R$/h', 'Mais de uma taxa', 'Situação', 'O que significa']]
    for (const g of [...grupos.clt, ...grupos.pj, ...grupos.naoHora])
      pes.push([g.regime || '—', g.funcao || '—', g.local, g.matricula, g.nome,
        g.hAp, g.vAp, g.tAp ?? '', g.hFo, g.vFo, g.tFo ?? '',
        g.delta, g.dVal, g.dTaxa ?? '', (g.apMisto || g.foMisto) ? 'sim' : '',
        ST[g.status].txt, ST[g.status].ajuda])
    add('Pessoas', pes)
    // a proporção do CLT é o número que o rateio manual deveria usar — sai em
    // aba própria para poder ser colada na planilha que faz o rateio hoje
    const prop: any[][] = [['Matrícula', 'Nome', 'Empresa', 'Filial', 'Centro de custo',
      'Horas', 'Custo apontamento', '% apontamento', 'Custo folha', '% folha']]
    for (const g of grupos.clt)
      for (const c of g.ccsCLT)
        prop.push([g.matricula, g.nome, c.empCod, c.filCod, c.ccCod,
          c.hAp, c.vAp, c.pctAp, c.vTot, g.vTot ? c.pctFo : ''])
    add('CLT · distribuição', prop)
    // uma linha por lançamento a fazer. As que permanecem saem de fora: aqui o
    // arquivo é para EXECUTAR o ajuste, não para conferir a conta — quem quiser
    // a prova tem a aba Resumo.
    const ajt: any[][] = [['Conta', 'Descrição da conta',
      'De — empresa · filial · CC', 'Para — empresa · filial · CC', '% da origem', 'Valor']]
    for (const a of ajustes.filter(x => !x.mesma))
      ajt.push([a.contaCod, a.contaDesc, a.origem, a.destino, a.pct, a.valor])
    add('Ajuste CC (AJTCC)', ajt)
    // a mesma coisa aberta por pessoa: é a conferência do lote, e na tela ela só
    // existe dentro do drill — uma linha de cada vez
    const ajp: any[][] = [['Conta', 'Descrição da conta', 'De — empresa · filial · CC', 'Para — empresa · filial · CC',
      'Matrícula', 'Nome', 'Valor']]
    for (const a of ajustes.filter(x => !x.mesma))
      for (const q of a.pessoas)
        ajp.push([a.contaCod, a.contaDesc, a.origem, a.destino, q.matricula, q.nome, q.valor])
    add('AJTCC por funcionário', ajp)
    // achatado: empresa, filial e CC em colunas próprias, para a planilha
    // dinâmica poder girar por qualquer uma delas
    const det: any[][] = [['Regime', 'Matrícula', 'Nome', 'Empresa', 'Filial', 'CC do projeto', 'CC do recurso',
      'Horas apontadas', 'Valor apontado', 'Horas na folha', 'Valor na folha',
      'Diferença h', 'Diferença R$', 'Fora da tolerância']]
    for (const g of [...grupos.clt, ...grupos.pj, ...grupos.naoHora])
      for (const c of g.ccs)
        det.push([g.regime || '—', g.matricula, g.nome, c.empCod, c.filCod, c.ccCod, c.ccRec,
          c.hAp, c.vAp, c.hFo, c.vFo, c.delta, c.dVal, c.ok ? '' : 'sim'])
    add('Empresa · filial · CC', det)
    add('Fora da conferência', [['Motivo', 'Linhas', 'Horas'], ...fora.map(x => [x.rotulo, x.linhas, x.horas])])
    XLSX.writeFile(wb, `conciliacao_apontamento_${p.ano}_${String(p.mes).padStart(2, '0')}.xlsx`)
  }

  if (loading) return <div style={S.empty}>Carregando…</div>
  if (erro) return <div style={S.erro}><AlertCircle size={16} /> {erro}</div>
  if (!pessoas.length && !fora.length) return (
    <div style={S.empty}>
      Nenhum apontamento para a folha de <b>{MESES[p.mes - 1]}/{p.ano}</b>. O extrato da competência correspondente
      ainda não foi importado — para a folha de um mês, o apontamento é o do mês anterior (PJ) ou de dois meses antes (CLT).
    </div>
  )

  // Uma taxa só chama atenção quando os dois lados discordam — e o que marca a
  // pessoa é a diferença ENTRE as taxas, não cada uma. Daí as duas células
  // receberem o mesmo dTaxa e acenderem juntas: é um par, não dois números.
  // O "≈" avisa que ali convivem taxas diferentes (traslado tem a sua, e o
  // custo/hora pode ter mudado no meio do mês), então a média não é o campo a
  // corrigir — o caminho é abrir a pessoa.
  const taxaTd = (t: number | null, misto: boolean, dTaxa: number | null) => {
    const alerta = dTaxa !== null && Math.abs(dTaxa) >= 0.01
    return (
      <td style={{ ...S.td, textAlign: 'right', fontWeight: alerta ? 600 : 400, color: alerta ? 'var(--orange)' : 'var(--muted)' }}
        title={misto ? 'Média de mais de uma taxa no período (hora normal e traslado têm valores diferentes) — abra a pessoa antes de corrigir o cadastro' : ''}>
        {t === null ? '—' : `${misto ? '≈' : ''}${money(t)}`}
      </td>
    )
  }

  // função, não componente: declarado aqui dentro, <Quadro/> seria um tipo novo
  // a cada render e o React remontaria a tabela inteira a cada tecla da busca
  const quadro = ({ k, titulo, sub, lista }: { k: string; titulo: string; sub: any; lista: Pessoa[] }) => {
    // a busca IGNORA "só pendências": procurar alguém pelo nome e não achar
    // porque ele está conferindo faria a tela parecer dizer que a pessoa não existe
    const vis = alvo
      ? lista.filter(x => norm(x.nome).includes(alvo) || norm(x.matricula).includes(alvo))
      : soDif ? lista.filter(x => x.status !== 'OK') : lista
    const t = { hAp: lista.reduce((s, x) => s + x.hAp, 0), hFo: lista.reduce((s, x) => s + x.hFo, 0) }
    return (
      <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido(k) ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro(k)}>
          {recolhido(k) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>{titulo}</h2>
          <span style={S.hsub}>{sub}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {lista.length} pessoa(s) · {hrs(t.hAp)} h apontadas · {hrs(t.hFo)} h na folha
          </span>
        </div>
        {!recolhido(k) && (!lista.length
          ? <div style={S.empty}>Ninguém neste grupo nesta competência.</div>
          : <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Pessoa</th>
              <th style={S.th}>Empresa · Filial</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Apontado h</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Apontado R$</th>
              <th style={{ ...S.th, textAlign: 'right' }} title="Custo/hora do apontamento — é este campo que se corrige no cadastro">R$/h apont.</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Folha h</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Folha R$</th>
              <th style={{ ...S.th, textAlign: 'right' }} title="Valor-hora que a folha pagou — o alvo para onde o custo/hora do apontamento deveria apontar">R$/h folha</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Dif. h</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Dif. R$</th>
              <th style={S.th}>Situação</th>
            </tr></thead>
            <tbody>
              {vis.map(g => {
                const ab = aberto.has(g.key)
                return [
                  <tr key={g.key}>
                    <td style={{ ...S.td, cursor: 'pointer' }} onClick={() => alternar(g.key)}>
                      {ab ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{' '}
                      <span style={S.mono}>{g.matricula}</span> {g.nome}
                      <span style={{ ...S.mono, fontSize: 11, marginLeft: 6 }}>{g.ccs.length} linha(s)</span>
                    </td>
                    <td style={{ ...S.td, ...S.mono }}>{g.local}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{hrs(g.hAp)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-mid)' }}
                      title="Horas × CUSTO_HORA do apontamento — a taxa congelada no extrato">{money(g.vAp)}</td>
                    {taxaTd(g.tAp, g.apMisto, g.dTaxa)}
                    <td style={{ ...S.td, textAlign: 'right' }}>{hrs(g.hFo)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-mid)' }}
                      title={`Verbas ${VERBAS_HORA.join(' + ')} — calculadas com o valor-hora do cadastro, que é outra taxa`}>{money(g.vFo)}</td>
                    {taxaTd(g.tFo, g.foMisto, g.dTaxa)}
                    <td style={{ ...S.td, textAlign: 'right', color: Math.abs(g.delta) > tolH ? 'var(--red)' : 'var(--muted)' }}>{hrs(g.delta)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: Math.abs(g.delta) > tolH ? 'var(--red)' : 'var(--muted)' }}
                      title={Math.abs(g.delta) <= tolH ? 'As horas conferem: o que sobra aqui é só diferença de taxa (custo do apontamento × valor-hora do cadastro)' : 'Diferença de horas e de taxa somadas'}>{money(g.dVal)}</td>
                    <td style={S.td}>
                      <span style={ST[g.status].est} title={ST[g.status].ajuda}>{ST[g.status].txt}</span>
                      {/* atalho onde o erro aparece: "sem folha" é exatamente
                          a cara de quem não recebe por hora */}
                      {g.postoId && g.status === 'SEM_FOLHA' && <button
                        style={{ marginLeft: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--muted)', textDecoration: 'underline' }}
                        disabled={salvando === g.key} onClick={() => marcarHora(g, false)}
                        title="Gerente, coordenador e afins apontam horas e recebem salário. Marcar tira a pessoa da conferência em todas as competências.">
                        {salvando === g.key ? 'salvando…' : 'não recebe por hora'}
                      </button>}
                    </td>
                  </tr>,
                  ab && <tr key={g.key + ':d'}>
                    <td colSpan={11} style={{ padding: '2px 12px 10px 34px', background: 'var(--bg-soft)' }}>
                      <table style={{ ...S.table, fontSize: 12 }}>
                        <thead><tr>
                          <th style={S.dh}>Empresa · Filial · CC</th>
                          <th style={S.dh}>CC do recurso</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Apontado h</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Apontado R$</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Folha h</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Folha R$</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Dif. h</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Dif. R$</th>
                        </tr></thead>
                        <tbody>
                          {g.ccs.map((c, i) => (
                            <tr key={i}>
                              <td style={{ ...S.dt, ...S.mono, color: c.ok ? 'var(--text-mid)' : 'var(--text)' }}>
                                {c.empCod} · {c.filCod} · {c.ccCod}</td>
                              <td style={{ ...S.dt, ...S.mono, fontSize: 11 }} title="o CC de lotação da pessoa, quando é diferente do CC do projeto — explica boa parte dos deslocamentos">{c.ccRec || ''}</td>
                              <td style={{ ...S.dt, textAlign: 'right' }}>{hrs(c.hAp)}</td>
                              <td style={{ ...S.dt, textAlign: 'right', color: 'var(--text-mid)' }}>{money(c.vAp)}</td>
                              <td style={{ ...S.dt, textAlign: 'right' }}>{hrs(c.hFo)}</td>
                              <td style={{ ...S.dt, textAlign: 'right', color: 'var(--text-mid)' }}>{money(c.vFo)}</td>
                              <td style={{ ...S.dt, textAlign: 'right', color: c.ok ? 'var(--muted)' : 'var(--red)' }}>{hrs(c.delta)}</td>
                              <td style={{ ...S.dt, textAlign: 'right', color: c.ok ? 'var(--muted)' : 'var(--red)' }}>{money(c.dVal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>,
                ]
              })}
              {!vis.length && <tr><td colSpan={11} style={S.empty}>
                {alvo
                  ? <>Ninguém com <b>{busca}</b> neste quadro — as {lista.length} pessoa(s) daqui não casam com a busca.</>
                  : <>Todas as {lista.length} pessoa(s) conferem. Desmarque <b>só pendências</b> para ver a lista completa.</>}
              </td></tr>}
            </tbody>
          </table>)}
      </div>
    )
  }

  // só o PJ é conferido: o CLT não tem verba de hora para comparar, e somá-lo
  // aqui faria a diferença parecer enorme todo mês por construção
  const conferidas = resumo.pj.hAp
  const sobra = totApont - conferidas - resumo.clt.hAp - resumo.nh.hAp - resumo.foraH
  const achados = alvo ? pessoas.filter(x => norm(x.nome).includes(alvo) || norm(x.matricula).includes(alvo)).length : 0
  // o que de fato vira lançamento é só o que muda de granularidade
  const totTransferir = ajustes.filter(a => !a.mesma).reduce((s, a) => s + a.valor, 0)
  const totPermanece = ajustes.filter(a => a.mesma).reduce((s, a) => s + a.valor, 0)
  // ── a empresa do ARQUIVO não é a empresa do Planorc ──
  // `empresa` aqui é agrupador gerencial (unidade de negócio). A empresa do ERP
  // são os DOIS PRIMEIROS caracteres da filial — `filial = EMPRESA(2)+FILIAL(2)`,
  // a mesma regra do conversor da folha, e é por isso que o prgper02 vem
  // separado em "emp 20", "emp 21"… As duas noções se cruzam: Rio Preto (05)
  // existe nas empresas ERP 20 e 21, e a empresa ERP 21 abriga Rio Preto e Moda.
  // Para o arquivo vale a do ERP, porque é dentro dela que a rotina roda.
  const empErp = (fil: string) => (fil || '').slice(0, 2)

  // Cruzar empresa gerencial não impede nada: o lançamento fica na filial de
  // origem e o item contábil do destino diz de quem é o custo. O que impede é
  // plano de contas diferente — aí a conta e o CC não existem do outro lado.
  const geraveis = ajustes.filter(a => !a.mesma && a.oFil && a.mesmoPlano)
  const cruzaEmpresa = geraveis.filter(a => a.oEmp !== a.dEmp)
  const outroPlano = ajustes.filter(a => !a.mesma && a.oFil && !a.mesmoPlano)
  const semFilial = ajustes.filter(a => !a.mesma && !a.oFil)
  const empresasArq = [...new Set(geraveis.map(a => empErp(a.oFil)))]
  // empresa sem item contábil cadastrado: o campo sairia em branco e o Protheus
  // recusaria o lote. Melhor barrar a geração e dizer qual empresa falta.
  const semItem = [...new Set(geraveis.flatMap(a =>
    [!a.oItem ? a.oEmp : '', !a.dItem ? a.dEmp : '']).filter(Boolean))]
  const nPorConta = geraveis.length
  const nPorFunc = geraveis.reduce((s, a) => s + a.pessoas.length, 0)
  const nLinhas = granul === 'func' ? nPorFunc : nPorConta
  // Cada linha do TXT é arredondada a 2 casas. Consolidado arredonda uma vez por
  // lançamento; por funcionário, uma vez por pessoa — e as duas somas podem
  // diferir por centavos. Não é erro nem impede a importação (cada linha fecha
  // sozinha, débito e crédito do mesmo valor), mas quem concilia o mês depois
  // precisa saber de onde vieram esses centavos.
  const r2 = (v: number) => Math.round(v * 100) / 100
  const centavos = r2(geraveis.reduce((s, a) => s + a.pessoas.reduce((t, q) => t + r2(q.valor), 0), 0)
    - geraveis.reduce((s, a) => s + r2(a.valor), 0))

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', margin: '0 0 16px' }}>
        <div style={S.fld}><span style={S.lbl}>Pessoa</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, color: 'var(--muted)', pointerEvents: 'none' }} />
            <input style={{ ...S.inp, width: 220, paddingLeft: 27, paddingRight: alvo ? 26 : 10 }}
              placeholder="nome ou matrícula" value={busca} onChange={e => setBusca(e.target.value)}
              title="Procura nos dois quadros e ignora o filtro de pendências — quem procura uma pessoa quer achá-la mesmo que ela esteja conferindo." />
            {!!busca && <button onClick={() => setBusca('')} title="limpar"
              style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 2 }}>
              <X size={13} /></button>}
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Tolerância (horas)</span>
          <input style={S.inp} type="number" step="0.5" min="0" value={tolH}
            title="Abaixo disto a linha conta como conferida. Fração de hora e arredondamento não são divergência."
            onChange={e => setTolH(Math.max(0, parseFloat(e.target.value) || 0))} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: alvo ? 'var(--faint)' : 'var(--text-mid)', cursor: alvo ? 'default' : 'pointer', paddingBottom: 8 }}
          title={alvo ? 'suspenso enquanto há busca por pessoa' : ''}>
          <input type="checkbox" checked={soDif} disabled={!!alvo} onChange={e => setSoDif(e.target.checked)} /> só pendências
        </label>
        {!!alvo && <span style={{ fontSize: 12, color: 'var(--violet)', paddingBottom: 8 }}>
          {achados} pessoa(s) encontrada(s){soDif ? ' · filtro de pendências suspenso' : ''}
        </span>}
        <div style={{ flex: 1 }} />
        <button style={{ ...S.btn, color: 'var(--violet)', marginBottom: 1 }} onClick={exportarXlsx}><FileDown size={14} /> Exportar</button>
      </div>

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Horas apontadas</div><div style={S.kpiV}>{hrs(conferidas)}</div>
          <div style={S.kpiS}>conferíveis (PJ) · {hrs(resumo.clt.hAp + resumo.nh.hAp + resumo.foraH)} h fora</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Horas na folha</div><div style={S.kpiV}>{hrs(resumo.pj.hFo)}</div>
          <div style={S.kpiS}>verbas {VERBAS_HORA.join(' + ')}
            {Math.abs(totFolha - resumo.pj.hFo) > 0.05 && ` · ${hrs(totFolha - resumo.pj.hFo)} h de quem está fora da conferência`}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Diferença</div>
          <div style={{ ...S.kpiV, color: Math.abs(conferidas - resumo.pj.hFo) > tolH ? 'var(--orange)' : 'var(--green)' }}>{hrs(conferidas - resumo.pj.hFo)}</div>
          {/* o R$ vem depois da hora de propósito: se as horas conferem, o que
              sobra em reais é só a diferença entre as duas taxas */}
          <div style={S.kpiS}>horas · R$ {money(resumo.pj.vAp - resumo.pj.vFo)} em valor</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Pessoas com pendência</div>
          <div style={S.kpiV}>{resumo.pj.dif}</div>
          <div style={S.kpiS}>de {resumo.pj.n} conferidas</div></div>
      </div>

      {!grupos.naoHora.length && <div style={S.aviso}><AlertCircle size={16} />
        <span>Nenhuma <b>função</b> está marcada como "só aponta". Gerente de projeto, coordenador e afins apontam
          horas e recebem salário — sem marcá-los aparecem aqui como <b>sem folha</b> todo mês, sem que haja nada a
          corrigir. Marque a função em <b>{passoLabel('/postos/apontamento')}</b>: são poucas linhas, valem para
          todas as competências, e quem entrar depois já vem classificado.</span></div>}


      {!!grupos.clt.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('clt') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('clt')}>
          {recolhido('clt') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>CLT · duas distribuições</h2>
          <span style={S.hsub}>Não é conferência, são <b>duas repartições do mesmo custo</b> lado a lado, e cada
            uma no seu grão: o apontamento na <b>unidade do projeto</b> (de onde o trabalho é) e a folha na unidade
            em que o custo caiu. Linha que só aparece de um lado é o achado, não defeito. O CLT recebe
            fixo mais verbas e prêmio — não hora × valor — então não há verba de hora a comparar. O que o apontamento
            diz é <b>onde o tempo foi</b> (a proporção que o rateio deveria usar); o que a folha diz é <b>onde o custo
            caiu</b>. Hoje o rateio é feito à mão depois da integração contábil, porque o ERP não faz — e é a distância
            entre as duas colunas de % que mede esse trabalho.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {grupos.clt.length} pessoa(s) · {hrs(resumo.clt.hAp)} h · R$ {money(resumo.clt.vTot)} de custo</span>
        </div>
        {!recolhido('clt') && <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Pessoa</th><th style={S.th}>Empresa · Filial</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Horas</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Custo apont.</th>
            <th style={{ ...S.th, textAlign: 'right' }} title="Custo da pessoa na folha, em contas de resultado — a base a ratear">Custo folha</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Locais</th>
          </tr></thead>
          <tbody>
            {grupos.clt.filter(g => !alvo || norm(g.nome).includes(alvo) || norm(g.matricula).includes(alvo)).map(g => {
              const ab = aberto.has(g.key)
              return [
                <tr key={g.key}>
                  <td style={{ ...S.td, cursor: 'pointer' }} onClick={() => alternar(g.key)}>
                    {ab ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{' '}
                    <span style={S.mono}>{g.matricula}</span> {g.nome}
                  </td>
                  <td style={{ ...S.td, ...S.mono }}>{g.localCLT}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{hrs(g.hAp)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: 'var(--text-mid)' }}>{money(g.vAp)}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{g.vTot ? money(g.vTot) : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{g.ccsCLT.length}</td>
                </tr>,
                ab && <tr key={g.key + ':d'}>
                  <td colSpan={6} style={{ padding: '2px 12px 10px 34px', background: 'var(--bg-soft)' }}>
                    <table style={{ ...S.table, fontSize: 12 }}>
                      {/* os dois % no fim, encostados um no outro: é a compara-
                          ção que a tela existe para fazer, e separá-los por
                          colunas de valor obrigaria a saltar o olho */}
                      <thead><tr>
                        <th style={S.dh}>Empresa · Filial · CC</th>
                        <th style={{ ...S.dh, textAlign: 'right' }}>Horas</th>
                        <th style={{ ...S.dh, textAlign: 'right' }}>Custo apont.</th>
                        <th style={{ ...S.dh, textAlign: 'right' }}>Custo folha</th>
                        <th style={{ ...S.dh, textAlign: 'right' }} title="Proporção das HORAS apontadas — a repartição que o rateio deveria seguir">% apont.</th>
                        <th style={{ ...S.dh, textAlign: 'right' }} title="Proporção do CUSTO na folha — onde o custo de fato caiu">% folha</th>
                      </tr></thead>
                      <tbody>
                        {g.ccsCLT.map((c, i) => (
                          <tr key={i}>
                            <td style={{ ...S.dt, ...S.mono }}>{c.empCod} · {c.filCod} · {c.ccCod}</td>
                            <td style={{ ...S.dt, textAlign: 'right' }}>{hrs(c.hAp)}</td>
                            <td style={{ ...S.dt, textAlign: 'right', color: 'var(--text-mid)' }}>{money(c.vAp)}</td>
                            <td style={{ ...S.dt, textAlign: 'right', color: 'var(--text-mid)' }}>{c.vTot ? money(c.vTot) : '—'}</td>
                            <td style={{ ...S.dt, textAlign: 'right', fontWeight: 600 }}>{pct(c.pctAp)}</td>
                            <td style={{ ...S.dt, textAlign: 'right', fontWeight: 600, color: g.vTot ? 'var(--text)' : 'var(--faint)' }}>
                              {g.vTot ? pct(c.pctFo) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table>}
      </div>}

      {!!ajustes.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('aj') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('aj')}>
          {recolhido('aj') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>Ajuste de centro de custo · AJTCC</h2>
          <span style={S.hsub}>O lote que hoje se monta à mão: por <b>conta contábil</b>, o valor <b>da folha</b> sai
            de onde ela contabilizou e entra onde o apontamento apurou, na proporção das horas. As linhas em que
            origem e destino coincidem <b>não geram lançamento</b> — o custo já está no lugar certo — e ficam aqui só
            para a soma fechar contra a conta.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            R$ {money(totTransferir)} a transferir</span>
        </div>
        {!recolhido('aj') && <>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={S.fld}><span style={S.lbl}>Lanç. padrão</span>
            <input style={{ ...S.inp, width: 70 }} value={lp} onChange={e => setLp(e.target.value)}
              title="O número do Lançamento Padrão que vai ler este arquivo no Protheus. É ele que interpreta as posições — sem o LP cadastrado, o arquivo não entra." />
          </div>
          <div style={S.fld}><span style={S.lbl}>Data do lançamento</span>
            <input style={{ ...S.inp, width: 140 }} type="date" value={dataLanc} onChange={e => setDataLanc(e.target.value)} />
          </div>
          <div style={S.fld}><span style={S.lbl}>Granularidade do lote</span>
            <select style={{ ...S.inp, width: 230 }} value={granul} onChange={e => setGranul(e.target.value as any)}
              title="Consolidado é um lançamento por conta e par de centros de custo. Por funcionário multiplica as linhas, mas deixa o razão conferível pessoa a pessoa.">
              <option value="conta">Por conta e CC — {nPorConta} linha(s)</option>
              <option value="func">Por funcionário — {nPorFunc} linha(s)</option>
            </select>
          </div>
          <button style={{ ...S.btn, color: 'var(--violet)' }} disabled={!geraveis.length || !dataLanc || !lp.trim() || !!semItem.length}
            title={!dataLanc ? 'Informe a data do lançamento' : !lp.trim() ? 'Informe o lançamento padrão'
              : semItem.length ? `Falta o item contábil da(s) empresa(s) ${semItem.join(', ')}` : `${geraveis.length} lançamento(s)`}
            onClick={txtCtb}><FileDown size={14} /> Gerar TXT{empresasArq.length > 1 ? ` · ${empresasArq.length} arquivos` : ''}</button>
          <button style={{ ...S.btn, fontWeight: 400 }} onClick={() => setVerLayout(v => !v)}>
            {verLayout ? 'ocultar' : 'ver'} layout do arquivo</button>
          <span style={{ fontSize: 11.5, color: 'var(--muted)', paddingBottom: 8 }}>
            {empresasArq.length} arquivo(s) — empresa(s) ERP {empresasArq.join(', ')} · {nLinhas} linha(s) · R$ {money(geraveis.reduce((s, a) => s + a.valor, 0))}
            {granul === 'func' && centavos !== 0 &&
              <span style={{ color: 'var(--orange)' }}> · {money(centavos)} de arredondamento</span>}
          </span>
        </div>

        {verLayout && <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 10, maxWidth: 820 }}>
            O <b>CTBA500 não tem layout fixo da TOTVS</b>: o arquivo é posicional e quem o interpreta é o
            <b> Lançamento Padrão</b> cadastrado no Protheus, campo a campo, por posição. Passe esta tabela a quem
            cadastra o LP — enquanto ele não existir, o arquivo não entra. Na rotina: <b>Considera Filial no
            arquivo texto? = Sim</b> (sem isso as 12 primeiras posições não são lidas e todo o resto sai
            deslocado), e o tamanho da linha como <b>{LARGURA + 2}</b> bytes ({LARGURA} de conteúdo + CR/LF — há
            documentação citando +1, que vale para arquivo terminado só em LF; este sai com CR+LF). O mesmo código
            de LP precisa existir em <b>todas as filiais</b> que recebem lançamento, e sai <b>um arquivo por empresa
            do ERP</b> — os dois primeiros caracteres da filial —, porque a importação roda dentro de uma.
          </div>
          <table style={{ ...S.table, fontSize: 12 }}>
            <thead><tr>
              <th style={S.dh}>Campo</th><th style={{ ...S.dh, textAlign: 'right' }}>Posição</th>
              <th style={{ ...S.dh, textAlign: 'right' }}>Tam.</th><th style={S.dh}>Leitura no LP</th><th style={S.dh}>Observação</th>
            </tr></thead>
            <tbody>{LAYOUT.map(c => (
              <tr key={c.campo}>
                <td style={S.dt}>{c.campo}</td>
                <td style={{ ...S.dt, textAlign: 'right', ...S.mono }}>{c.pos}</td>
                <td style={{ ...S.dt, textAlign: 'right', ...S.mono }}>{c.tam}</td>
                <td style={{ ...S.dt, ...S.mono, color: 'var(--violet)' }}>
                  {c.tipo === 'N' ? 'LerVal' : c.tipo === 'D' ? 'LerData' : 'LerStr'}({c.pos},{c.tam})</td>
                <td style={{ ...S.dt, color: 'var(--muted)' }}>{c.obs}</td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ fontSize: 11.5, color: 'var(--orange)', marginTop: 10, lineHeight: 1.6, maxWidth: 820 }}>
            A confirmar com quem cadastra o LP: os <b>tamanhos de conta, centro de custo e item</b> (aqui vão 20, 9
            e 9, alinhados à esquerda — se o Protheus esperar zeros à esquerda, o layout muda). O <b>item contábil</b>
            sai de <b>Cadastros → Empresas</b>: é a mesma empresa gerencial no código do ERP, o mesmo de-para que o
            conversor da folha já usava.
          </div>
        </div>}

        {!!semItem.length && <div style={{ ...S.aviso, margin: '12px 14px', borderRadius: 8 }}><AlertCircle size={16} />
          <span>Sem <b>item contábil</b> cadastrado na(s) empresa(s) <b>{semItem.join(', ')}</b> — o arquivo sairia com
            o campo em branco e o Protheus recusaria o lote, então a geração está bloqueada. O item é a mesma empresa
            em outro código; cadastre em <b>Cadastros → Empresas</b>. A migration 115 já carrega o de-para conhecido.</span></div>}

        {!!cruzaEmpresa.length && <div style={{ ...S.aviso, margin: '12px 14px', borderRadius: 8 }}><AlertCircle size={16} />
          <span><b>{cruzaEmpresa.length} linha(s) cruzam empresa gerencial</b> ({money(cruzaEmpresa.reduce((s, a) => s + a.valor, 0))}).
            Entram normalmente: como o plano de contas é compartilhado, o lançamento fica na empresa de origem e é o
            <b> item contábil</b> do destino que diz de quem é o custo — que é como a aglutinação gerencial já
            funciona. Vale conferir só o item contábil dessas linhas, porque um errado aqui passa despercebido.</span></div>}

        {!!outroPlano.length && <div style={{ ...S.aviso, margin: '12px 14px', borderRadius: 8 }}><AlertCircle size={16} />
          <span><b>{outroPlano.length} linha(s) ficaram fora do arquivo</b> por ligarem empresas de <b>planos de
            contas diferentes</b> ({money(outroPlano.reduce((s, a) => s + a.valor, 0))}). Entre as filiais que
            compartilham o plano o ajuste é só um remanejamento de CC; com planos distintos a conta e o centro de
            custo não existem do outro lado, e isso deixa de ser ajuste para ser outra operação.</span></div>}

        {!!semFilial.length && <div style={{ ...S.aviso, margin: '12px 14px', borderRadius: 8 }}><AlertCircle size={16} />
          <span><b>{semFilial.length} linha(s) ficaram fora do arquivo</b> por não terem filial na origem
            ({money(semFilial.reduce((s, a) => s + a.valor, 0))}). A filial abre a linha do arquivo e não tem
            substituto — sem ela o Protheus não sabe onde lançar.</span></div>}

        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Conta</th>
            <th style={S.th} title="Empresa · filial · CC em que a folha contabilizou">De (folha)</th>
            <th style={S.th} title="Empresa · filial · CC que o apontamento apurou">Para (apontamento)</th>
            <th style={{ ...S.th, textAlign: 'right' }}>%</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Valor</th>
          </tr></thead>
          <tbody>
            {ajustes.map((a, i) => {
              const k = `aj:${i}`, ab = aberto.has(k)
              // a primeira linha de cada conta carrega o rótulo; repetir o
              // código em todas as linhas empilharia ruído sobre o que muda,
              // que é o par origem → destino
              const nova = i === 0 || ajustes[i - 1].contaCod !== a.contaCod
              return [
                <tr key={k} style={a.mesma ? { opacity: 0.55 } : undefined}>
                  <td style={{ ...S.td, ...S.mono }}>{nova ? <>{a.contaCod} <span style={{ color: 'var(--faint)' }}>{a.contaDesc}</span></> : ''}</td>
                  <td style={{ ...S.td, ...S.mono, cursor: 'pointer' }} onClick={() => alternar(k)}>
                    {ab ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {a.origem}</td>
                  <td style={{ ...S.td, ...S.mono, color: a.mesma ? 'var(--muted)' : 'var(--text)' }}>
                    {a.mesma ? <span style={{ fontFamily: 'system-ui, sans-serif', fontStyle: 'italic' }}>permanece</span> : a.destino}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{pct(a.pct)}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: a.mesma ? 400 : 600, color: a.mesma ? 'var(--muted)' : 'var(--text)' }}>{money(a.valor)}</td>
                </tr>,
                ab && <tr key={k + ':d'}>
                  <td colSpan={5} style={{ padding: '2px 12px 10px 34px', background: 'var(--bg-soft)' }}>
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead><tr><th style={S.dh}>Quem compõe</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                      <tbody>{a.pessoas.map((q, j) => (
                        <tr key={j}>
                          <td style={S.dt}><span style={S.mono}>{q.matricula}</span> {q.nome}</td>
                          <td style={{ ...S.dt, textAlign: 'right' }}>{money(q.valor)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table></>}
        <div style={S.prova}>
          <span>Custo do CLT na folha: <b>R$ {money(resumo.clt.vTot)}</b></span>
          <span>= permanece <b>R$ {money(totPermanece)}</b></span>
          <span>+ transferir <b>R$ {money(totTransferir)}</b></span>
          <span style={{ color: Math.abs(resumo.clt.vTot - totPermanece - totTransferir) > 0.05 ? 'var(--red)' : 'var(--green)' }}>
            {Math.abs(resumo.clt.vTot - totPermanece - totTransferir) > 0.05
              ? `⚠ sobram R$ ${money(resumo.clt.vTot - totPermanece - totTransferir)}`
              : '✓ fecha'}
          </span>
        </div>
      </div>}

      {quadro({ k: 'pj', titulo: 'Terceiros (PJ)', lista: grupos.pj,
        sub: <>Pagos <b>por hora</b>: o apontamento é o que gera a verba da folha, então aqui os dois lados têm de bater.
          Abra a pessoa para ver por centro de custo — é lá que aparece o caso em que o total fecha e o custo foi para o CC errado.</> })}

      {!!grupos.naoHora.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('nh') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('nh')}>
          {recolhido('nh') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>Não recebem por hora</h2>
          <span style={S.hsub}>Gerente de projeto, coordenador e afins: apontam horas para dizer <b>onde</b> o custo
            cai, e não são pagos por elas. Quem decide é a <b>função</b> — marque em {passoLabel('/postos/apontamento')};
            a marcação por pessoa aqui é só para quem foge do padrão da própria função.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {grupos.naoHora.length} pessoa(s) · {hrs(grupos.naoHora.reduce((s, x) => s + x.hAp, 0))} h apontadas</span>
        </div>
        {!recolhido('nh') && <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Pessoa</th><th style={S.th}>Empresa · Filial</th>
            <th style={S.th}>Por quê</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Apontado</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
            <th style={S.th} />
          </tr></thead>
          {/* também obedece à busca: procurar uma pessoa e não achá-la porque
              ela foi excluída da conferência daria a impressão de que sumiu */}
          <tbody>{grupos.naoHora.filter(g => !alvo || norm(g.nome).includes(alvo) || norm(g.matricula).includes(alvo)).map(g => (
            <tr key={g.key}>
              <td style={S.td}><span style={S.mono}>{g.matricula}</span> {g.nome}</td>
              <td style={{ ...S.td, ...S.mono }}>{g.local}</td>
              {/* herdado vs exceção: em itálico o que vem da função, como as
                  premissas globais do formulário já mostram herança */}
              <td style={{ ...S.td, fontSize: 11.5, color: 'var(--muted)', fontStyle: g.porFuncao ? 'italic' : 'normal' }}>
                {g.porFuncao ? (g.funcao || 'função') : 'exceção desta pessoa'}</td>
              <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{hrs(g.hAp)}</td>
              <td style={{ ...S.td, textAlign: 'right', color: g.hFo ? 'var(--orange)' : 'var(--muted)' }}
                title={g.hFo ? 'recebeu verba de hora mesmo marcado como quem não recebe — confira a marcação ou o cadastro' : ''}>{hrs(g.hFo)}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>
                {/* desfazer só faz sentido na exceção: se vem da função, voltar
                    à função devolveria a pessoa para cá no próximo render */}
                {!g.porFuncao && <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--muted)', textDecoration: 'underline' }}
                  disabled={salvando === g.key} onClick={() => marcarHora(g, null)}
                  title="Desfaz a exceção e devolve a pessoa ao que a função dela diz">
                  {salvando === g.key ? 'salvando…' : 'seguir a função'}
                </button>}
              </td>
            </tr>
          ))}</tbody>
        </table>}
      </div>}

      {!!fora.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('fora') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('fora')}>
          {recolhido('fora') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>Fora da conferência</h2>
          <span style={S.hsub}>Horas que existem no extrato e não têm contraparte na folha <b>por desenho</b>, não por erro.
            Ficam aqui para a soma fechar — sem elas o total do apontamento nunca bateria com a soma dos quadros.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{hrs(resumo.foraH)} h</span>
        </div>
        {!recolhido('fora') && <table style={S.table}>
          <thead><tr><th style={S.th}>Motivo</th><th style={{ ...S.th, textAlign: 'right' }}>Linhas</th><th style={{ ...S.th, textAlign: 'right' }}>Horas</th></tr></thead>
          <tbody>{fora.map((x, i) => (
            <tr key={i}><td style={S.td}>{x.rotulo}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>{x.linhas.toLocaleString('pt-BR')}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>{hrs(x.horas)}</td></tr>
          ))}</tbody>
        </table>}
      </div>}

      {/* A prova de soma: cada hora do extrato está em exatamente um lugar.
          Se esta linha não fechar, o recorte da tela perdeu dado — e é melhor
          descobrir aqui do que numa reunião. */}
      <div style={{ ...S.card, marginBottom: 0 }}>
        <div style={S.prova}>
          <span>Apontamento da competência: <b>{hrs(totApont)} h</b></span>
          <span>= conferidas <b>{hrs(conferidas)} h</b></span>
          {!!resumo.clt.hAp && <span>+ CLT (distribuição) <b>{hrs(resumo.clt.hAp)} h</b></span>}
          {!!resumo.nh.hAp && <span>+ não recebem por hora <b>{hrs(resumo.nh.hAp)} h</b></span>}
          <span>+ fora da conferência <b>{hrs(resumo.foraH)} h</b></span>
          <span style={{ color: Math.abs(sobra) > 0.05 ? 'var(--red)' : 'var(--green)' }}>
            {Math.abs(sobra) > 0.05 ? `⚠ sobram ${hrs(sobra)} h sem lugar` : '✓ fecha'}
          </span>
        </div>
      </div>
    </>
  )
}
