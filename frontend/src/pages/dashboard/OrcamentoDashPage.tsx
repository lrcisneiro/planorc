// ============================================================
// Dashboard de ORÇAMENTO — desenho em docs/DESIGN_dashboard_orcamento.md
//
// Os outros dashboards respondem "como estamos indo?". Este responde outra
// pergunta: "devo aprovar este orçamento?". O público não é quem acompanha, é
// quem decide — então o número isolado importa menos que a procedência dele, e
// a pergunta útil não é "quanto" mas "por que mudou" e "dá para acreditar".
//
// Por isso quase não usa realizado: só o suficiente para julgar o orçamento
// contra a história.
//
// Chassi reaproveitado de DashFiltros (filtros, período, preset, exportação) —
// importado, não reescrito.
// ============================================================
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { carregarVersoes, carregarRelatorios } from '../../lib/escopoDados'
import { useUserAccess } from '../../hooks/useUserAccess'
import { totaisRelatorioMes } from '../../lib/relatorioTotais'
import { COLS_LINHA, emArvore, fatorExibicao, linhasConciliaveis, type LinhaRel } from '../../lib/refRelatorio'
import { Ponte, Grupo, componentesDe, profDe, ABAS, NATS, NIVEIS } from '../../lib/Ponte'
import {
  ExportarButton, FiltrosButton, PillsDim, SalvarCardButton, useCardPreset,
  effectiveCcFilter, escopoFiltro, type CC,
} from './DashFiltros'
import { ChevronLeft, AlertTriangle, Info, Download, ChevronUp, ChevronDown, ListChecks } from 'lucide-react'
import { ResponsiveBar } from '@nivo/bar'
import { fmtEixo } from '../../lib/fmtEixo'
import { ResponsiveLine } from '@nivo/line'
import { nivoTheme } from '../../lib/nivoTheme'
import { computeTotais, formatValor, pkey, type Computed, type LinhaCalc, type Periodo } from '../../lib/engine'
import { carregarMetas, resolverMeta, type IndicadorMeta } from '../../lib/indicadorMeta'
import { ChipMeta } from './IndicCard'
import DrillModal from './DrillModal'
import { downloadSheet } from '../../lib/planilha'

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const fmt = (n: number, casas = 0) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—')


type Modo = 'ORC' | 'REAL'
// Projeção dos meses DEPOIS do período, até dezembro — anualização. Vale nos
// dois modos: limitar o período e perguntar "e se o resto do ano seguir este
// ritmo?" é a mesma pergunta comparando orçados ou comparando com realizado.
type Proj = 'OFF' | 'MEDIA3' | 'MEDIAPER' | 'ULTIMO' | 'ORCADO'
const PROJ_ROTULO: Record<Proj, string> = {
  OFF:      'não projetar — analisa só o período',
  MEDIA3:   'projetar pela média dos 3 últimos meses do período',
  MEDIAPER: 'projetar pela média de todo o período',
  ULTIMO:   'projetar repetindo o último mês do período',
  ORCADO:   'projetar pelo orçado do ano (só no modo Realizado)',
}

/** uma seção escolhe as próprias linhas e o próprio limiar */
type SecCfg = { sel: string[]; pct: number; minPctTotal: number; resultado?: string }
/** dimValor → master → { b: analisado, c: comparado } */
type LadoPorMaster = Record<string, Record<string, { b: number; c: number }>>
type DimBruto = { emp: LadoPorMaster; cc: LadoPorMaster }
const SEC_PADRAO: SecCfg = { sel: [], pct: 10, minPctTotal: 0.5 }

// ── Último estado da tela, por navegador. Mesma mecânica do DRE —
// Acompanhamento ('planorc_dash_filtro'): sair da tela e voltar não deve
// custar remarcar as empresas, a versão e o período da análise. É diferente
// do card salvo (dashboard_card): o card é uma análise com nome, que se
// compartilha; isto é só "onde eu estava".
const SAVE = 'planorc_orcdash_filtro'
function loadSaved(): any { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }
const arr = (v: any): string[] | null => (Array.isArray(v) ? v : null)

// Uma PONTE exige componentes que NÃO SE SOBREPÕEM: ela decompõe a variação de
// UMA linha de resultado. Numa DRE, "nível 1" traz subtotais e componentes
// misturados, e somá-los conta a mesma receita várias vezes.
//
// Quais são os componentes de uma linha? A ESTRUTURA DO RELATÓRIO já responde,
// e é nela que a resposta tem de ficar — não numa lista de nomes no código.
// Nome chumbado ("margem", "ebitda") funciona numa DRE e quebra na seguinte, e
// o produto atende segmentos diferentes.
//
//   · FORMULA e INDICADOR → as linhas que a `expressao` referencia. Uma linha
//                     de fórmula declara os próprios termos: `=[1]+[130]+[2]`
//                     diz, sem ambiguidade, de que ela é feita.
//                     INDICADOR entra junto: a diferença entre os dois é se a
//                     linha participa do SOMAR_FILHOS do pai, não se tem
//                     expressão. Numa DRE real o EBITDA costuma ser INDICADOR.
//   · SOMAR_FILHOS  → as filhas diretas. É a definição do tipo.
//   · demais        → não há como derivar; a pessoa escolhe.
// ⚠⚠ LINHA DESATIVADA NÃO É COMPONENTE. O motor a exclui da soma do pai e
// trata referência a ela como ZERO (`lib/engine.ts`), então o TOTAL do
// resultado não a contém — mas a ponte a somava como barra, e o resíduo
// absorvia a diferença. Na DRE Gerencial deu para ver a olho nu:
//     Titulos baixados para PDD   +565.003
//     não explicado               −565.003
// a mesma cifra com o sinal trocado. E o pior era não dar para consertar na
// tela: `linhasConciliaveis` já esconde desativada do seletor, então a linha
// entrava por aqui e ficava marcada sem checkbox para desmarcar.
export default function OrcamentoDashPage() {
  const navigate = useNavigate()
  const acesso = useUserAccess()
  const dashRef = useRef<HTMLDivElement>(null)

  // ── catálogos
  const [relatorios, setRelatorios] = useState<any[]>([])
  const [versoes, setVersoes] = useState<any[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<CC[]>([])

  // ── chassi
  const sv = loadSaved()
  const [relId, setRelId] = useState<string>(sv.relId || '')
  const [linhas, setLinhas] = useState<LinhaRel[]>([])
  const [vBase, setVBase] = useState<string>(sv.vBase || '')
  const [modo, setModo] = useState<Modo>(sv.modo === 'REAL' ? 'REAL' : 'ORC')
  const [vComp, setVComp] = useState<string>(sv.vComp || '')
  const [mesIni, setMesIni] = useState<number>(sv.mesIni || 1)
  const [mesFim, setMesFim] = useState<number>(sv.mesFim || 12)
  const [proj, setProj] = useState<Proj>(sv.proj && PROJ_ROTULO[sv.proj as Proj] ? sv.proj : 'OFF')
  // Detectado só para AVISAR — o período é quem define o que é real. Antes
  // isto era um controle à parte e duplicava o "até", confundindo.
  const [realAte, setRealAte] = useState(0)

  // ── filtros de dimensão
  const [empresaSel, setEmpresaSel] = useState<string[]>(arr(sv.empresaSel) || [])
  const [filialSel, setFilialSel] = useState<string[]>(arr(sv.filialSel) || [])
  const [ccSel, setCcSel] = useState<string[]>(arr(sv.ccSel) || [])
  const [areaSel, setAreaSel] = useState<string[]>(arr(sv.areaSel) || [])
  const [divisaoSel, setDivisaoSel] = useState<string[]>(arr(sv.divisaoSel) || [])
  const [buSel, setBuSel] = useState<string[]>(arr(sv.buSel) || [])

  // ── seções
  // Duas abas, porque são duas perguntas. "Orçamento" mostra o plano em si —
  // os indicadores da estrutura e a forma dele no ano. "Comparativo" julga o
  // plano contra outro ano. Quem monta quer a primeira; quem aprova, a segunda.
  const [aba, setAba] = useState<'orcamento' | 'comparativo' | 'pessoas'>(
    sv.aba === 'comparativo' ? 'comparativo' : sv.aba === 'pessoas' ? 'pessoas' : 'orcamento')
  const [secOrc, setSecOrc] = useState<SecCfg>(SEC_PADRAO)
  const [metas, setMetas] = useState<IndicadorMeta[]>([])
  const [indicSel, setIndicSel] = useState<string[]>(arr(sv.indicSel) || [])
  const [pickIndic, setPickIndic] = useState(false)
  // Seção irmã, para linhas que NÃO são indicador — receita bruta, despesas
  // totais, um subtotal qualquer. Aqui vazio = NENHUMA, ao contrário dos
  // indicadores: são centenas de linhas, e "todas" encheria a tela de ruído.
  // Qual linha o gráfico POR EMPRESA abre. Antes seguia a linha de resultado
  // da ponte, o que amarrava duas decisões diferentes: a ponte quer o resultado
  // final, aqui a pergunta pode ser "EBITDA por empresa" ou "receita por
  // empresa". Vazio = segue a da ponte, que é o padrão útil.
  const [empLinha, setEmpLinha] = useState<string>(sv.empLinha || '')
  const [linhaSel, setLinhaSel] = useState<string[]>(arr(sv.linhaSel) || [])
  const [pickLinha, setPickLinha] = useState(false)
  // ⚠ O BRUTO fica no estado e o gráfico é DERIVADO. Antes o cálculo morava
  // dentro de `carregar`, então trocar a linha de resultado da aba Orçamento
  // recarregava a tela INTEIRA — todos os cartões trocados por "Calculando…"
  // para refazer uma soma cujos dados já estavam em memória.
  const [linhaEmpBruto, setLinhaEmpBruto] = useState<any[]>([])
  // ── bruto por DIMENSÃO × master, com os dois lados
  // `b` = versão/ano analisado, `c` = o comparado. Origem e destino saem do
  // sentido do cabeçalho, que muda sem recarregar — por isso o estado guarda
  // os lados pelo que eles SÃO, não pelo papel que ocupam na leitura.
  const [dimBruto, setDimBruto] = useState<DimBruto>({ emp: {}, cc: {} })
  const [porArea, setPorArea] = useState<{ rec: any[]; desp: any[]; ccRec: any[]; ccDesp: any[]; mes: any[] }>({ rec: [], desp: [], ccRec: [], ccDesp: [], mes: [] })
  const [drill, setDrill] = useState<{ nodeId: string; ccFilter?: string[] | null } | null>(null)
  const [secPonte, setSecPonte] = useState<SecCfg>(SEC_PADRAO)
  // ⚠⚠ A TRILHA DA PONTE MORA AQUI, não dentro do `Ponte`. Enquanto
  // `carregando` é true esta tela troca TODO o conteúdo por "Calculando…" — o
  // `Ponte` desmonta e qualquer estado local dele se perde. A trilha
  // simplesmente nunca aparecia. Descer deixou de recarregar, mas mexer nos
  // filtros do topo continua desmontando, então o estado fica aqui.
  // ⚠ Fora de `estado()` de propósito: não vai para o card nem para o
  // localStorage. Caminho é do momento, não da análise.
  const [trilhaPonte, setTrilhaPonte] = useState<string[]>([])
  const navPonte = useRef<string | null>(null)
  const [ponteNat, setPonteNat] = useState<'TODAS' | 'RECEITA' | 'DESPESA'>('TODAS')
  const [ponteAte, setPonteAte] = useState<number | 'tudo'>(1)
  const [quemDim, setQuemDim] = useState<DimQuem>('area')
  // ⚠⚠ O SENTIDO DA COMPARAÇÃO É A PERGUNTA, não um estilo — e por isso mora
  // no CABEÇALHO, não dentro de um cartão: ele rege a aba inteira. Guarda-se
  // quem é a ORIGEM, e `undefined` é "siga o modo" — a mesma distinção entre
  // INTENÇÃO e estado do preset do relatório: gravar o sentido já resolvido
  // faria a escolha automática virar escolha fixa no primeiro salvamento.
  const [sentidoOrigem, setSentidoOrigem] = useState<'ANALISADO' | 'COMPARADO' | undefined>(sv.sentidoOrigem)
  // ⚠ Mesma razão da trilha: `carregando` desmonta o cartão inteiro, e estado
  // local de `Variacao` morreria a cada troca de nível — que é justamente o
  // que dispara a recarga.
  const [varAba, setVarAba] = useState<'LINHA' | 'INDIC'>('LINHA')
  const [varNivel, setVarNivel] = useState<number | 'folhas'>(1)
  const [varNat, setVarNat] = useState<'TODAS' | 'RECEITA' | 'DESPESA'>('TODAS')
  const [secVar, setSecVar] = useState<SecCfg>(SEC_PADRAO)
  // ⚠ Mesmo trio da *Variação*, pela mesma razão: a Acurácia é um ranking e
  // precisa do corte em nível para não contar o mesmo dinheiro duas vezes.
  const [acurAba, setAcurAba] = useState<'LINHA' | 'INDIC'>('LINHA')
  const [acurNivel, setAcurNivel] = useState<number | 'folhas'>(1)
  const [acurNat, setAcurNat] = useState<'TODAS' | 'RECEITA' | 'DESPESA'>('TODAS')
  const [secAcur, setSecAcur] = useState<SecCfg>(SEC_PADRAO)
  // Configuração de seção vinda de FORA (estado salvo ou card) espera aqui até
  // as linhas do relatório chegarem — é só então que dá para saber se os ids
  // ainda existem. Sem essa espera o padrão derivado da estrutura chega depois
  // e sobrescreve o que a pessoa escolheu: era essa corrida que fazia o card
  // reabrir com as seções no padrão, e não como foram salvas.
  const pendSec = useRef<Partial<Record<'secPonte' | 'secVar' | 'secAcur' | 'secOrc', SecCfg>> | null>(
    sv.secPonte || sv.secVar || sv.secAcur || sv.secOrc
      ? { secPonte: sv.secPonte, secVar: sv.secVar, secAcur: sv.secAcur, secOrc: sv.secOrc }
      : null,
  )

  const [dados, setDados] = useState<null | {
    base: Record<string, number>; comp: Record<string, number>
    orcAnt: Record<string, number>; realAnt: Record<string, number>
    mensalBase: Record<string, number[]>
  }>(null)
  const [carregando, setCarregando] = useState(false)
  const { cardId, nome: cardNome } = useCardPreset('/dashboards/orcamento', (f: any) => {
    if (!f) return
    f.relId && setRelId(f.relId); f.vBase && setVBase(f.vBase); f.vComp && setVComp(f.vComp)
    f.modo && setModo(f.modo); f.proj && setProj(f.proj)
    // ⚠ Só grava se o card TEM a chave: ausência é "siga o modo", e um
    // `setPonteOrig(undefined)` aqui apagaria a escolha de quem já estava na
    // tela ao abrir um card antigo, que não decidiu nada sobre isso.
    if (f.sentidoOrigem) setSentidoOrigem(f.sentidoOrigem)
    f.aba && setAba(f.aba); Array.isArray(f.indicSel) && setIndicSel(f.indicSel); Array.isArray(f.linhaSel) && setLinhaSel(f.linhaSel); f.empLinha !== undefined && setEmpLinha(f.empLinha)
    if (f.mesIni) setMesIni(f.mesIni); if (f.mesFim) setMesFim(f.mesFim)
    f.empresaSel && setEmpresaSel(f.empresaSel); f.filialSel && setFilialSel(f.filialSel)
    f.ccSel && setCcSel(f.ccSel); f.areaSel && setAreaSel(f.areaSel)
    f.divisaoSel && setDivisaoSel(f.divisaoSel); f.buSel && setBuSel(f.buSel)
    // Com seleção de linha e limiar POR SEÇÃO, o preset guarda a configuração
    // inteira da análise — "Revisão do orçamento 2027" reabre tudo como estava.
    // Pelos dois caminhos: a fila cobre o caso de o relatório mudar (as linhas
    // serão buscadas de novo), e o setState cobre o caso de ele ser o mesmo
    // (nenhuma busca acontece, então ninguém consome a fila).
    if (f.secPonte || f.secVar || f.secAcur) {
      pendSec.current = { secPonte: f.secPonte, secVar: f.secVar, secAcur: f.secAcur, secOrc: f.secOrc }
      f.secPonte && setSecPonte(f.secPonte); f.secVar && setSecVar(f.secVar); f.secAcur && setSecAcur(f.secAcur)
      f.secOrc && setSecOrc(f.secOrc)
    }
  })
  const [erro, setErro] = useState<string | null>(null)

  // ── catálogos (pequenos: dispensam pageAll)
  useEffect(() => {
    // O padrão (versão mais nova, todas as empresas) só entra se não houver
    // escolha salva — e a salva só vale se o id ainda existir. Um id morto
    // deixaria a tela vazia parecendo defeito, que é pior que voltar ao padrão.
    carregarRelatorios().then(data => ({ data })).then(r => {
      const rs = r.data || []; setRelatorios(rs)
      setRelId(p => (!p || rs.some((x: any) => x.id === p) ? p : ''))
    })
    carregarVersoes('id,codigo,ano', { ordem: 'ano_desc' })
      .then(r => {
        const v = r; setVersoes(v)
        if (!v.length) return
        const vive = (id: string) => v.some((x: any) => x.id === id)
        setVBase(p => (p && vive(p) ? p : v[0].id))
        setVComp(p => (p && vive(p) ? p : (v[1]?.id ?? v[0].id)))
      })
    carregarMetas().then(setMetas)
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => {
      const es = r.data || []; setEmpresas(es)
      const ids = es.map((e: any) => e.id)
      setEmpresaSel(p => { const vivos = p.filter(id => ids.includes(id)); return vivos.length ? vivos : ids })
    })
    supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').order('codigo')
      .then(r => setCcs((r.data || []) as CC[]))
  }, [])

  // ── linhas do relatório
  useEffect(() => {
    if (!relId) { setLinhas([]); return }
    supabase.from('relatorio_linha').select(COLS_LINHA + ',nivel,formato,casas_decimais,redutora').eq('relatorio_id', relId).order('ordem')
      .then(r => {
        const ls = (r.data || []) as unknown as LinhaRel[]
        setLinhas(ls)
        // Padrão: as linhas de NÍVEL 1. Seção que nasce vazia parece quebrada,
        // e nível 1 é exatamente o que a ponte quer.
        const n1 = ls.filter(l => !l.pai_id)
        const ids = n1.map(l => l.id)
        // Linha de resultado padrão: a primeira de NÍVEL 1 cujos componentes a
        // estrutura sabe derivar — critério estrutural, não de nome.
        const res = n1.find(l => componentesDe(l, ls).length) ?? n1[0]
        // A configuração salva/do card vence o padrão — mas só nas linhas que
        // sobreviveram a uma reestruturação do relatório. Se não sobrou
        // nenhuma, é porque a configuração era de outro relatório: volta ao
        // padrão em vez de abrir a seção vazia.
        const pend = pendSec.current; pendSec.current = null
        const vivos = new Set(ls.map(l => l.id))
        const ou = (cfg: SecCfg | undefined, padrao: SecCfg): SecCfg => {
          if (!cfg) return padrao
          const sel = (cfg.sel || []).filter(id => vivos.has(id))
          if (!sel.length) return padrao
          return { ...cfg, sel, resultado: cfg.resultado && vivos.has(cfg.resultado) ? cfg.resultado : padrao.resultado }
        }
        setSecPonte(ou(pend?.secPonte, { ...SEC_PADRAO, resultado: res?.id, sel: componentesDe(res, ls) }))
        // A visão do orçamento nasce com as linhas de nível 1 e a mesma linha
        // de resultado da ponte — é o retrato que quem monta espera ver.
        setSecOrc(ou(pend?.secOrc, { ...SEC_PADRAO, resultado: res?.id, sel: ids }))
        setSecVar(p => ou(pend?.secVar, { ...p, sel: ids }))
        setSecAcur(p => ou(pend?.secAcur, { ...p, sel: ids }))
      })
  }, [relId])

  const versao = (id: string) => versoes.find(v => v.id === id)
  const anoBase = versao(vBase)?.ano
  const anoComp = versao(vComp)?.ano

  // ── até que mês o realizado do ano comparado tem dado (para o aviso)
  useEffect(() => {
    if (!anoComp) return
    supabase.from('fat_realizado').select('mes').eq('ano', anoComp).order('mes', { ascending: false }).limit(1)
      .then(r => setRealAte((r.data?.[0] as any)?.mes ?? 0))
  }, [anoComp])

  // ── uma só descrição do estado da tela, para os DOIS destinos
  // O localStorage ("onde eu estava") e o card salvo ("a análise com nome")
  // guardam a mesma coisa. Com duas listas separadas elas divergem, e o
  // sintoma é um filtro que o card silenciosamente não guarda.
  const estado = () => ({
    relId, vBase, modo, vComp, mesIni, mesFim, proj, aba, indicSel, linhaSel, empLinha,
    empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, sentidoOrigem,
    secPonte, secVar, secAcur, secOrc,
  })
  useEffect(() => {
    if (cardId) return   // vendo um card: não contaminar o estado próprio da tela
    localStorage.setItem(SAVE, JSON.stringify(estado()))
  }, [cardId, relId, vBase, modo, vComp, mesIni, mesFim, proj, aba, indicSel, linhaSel, empLinha,
      empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, sentidoOrigem, secPonte, secVar, secAcur, secOrc]) // eslint-disable-line

  const meses = useMemo(() => Array.from({ length: Math.max(0, mesFim - mesIni + 1) }, (_, i) => mesIni + i), [mesIni, mesFim])
  // os meses DEPOIS do período, até dezembro
  const mesesProj = useMemo(
    () => (proj === 'OFF' ? [] : Array.from({ length: 12 - mesFim }, (_, i) => mesFim + 1 + i)),
    [proj, mesFim])

  const filialFilter = useMemo(() => escopoFiltro(filialSel.length ? filialSel : null, filiais, 'filial', acesso.canSee), [filialSel, filiais, acesso])
  const ccFilter = useMemo(() => escopoFiltro(effectiveCcFilter(ccs, ccSel, areaSel, divisaoSel, buSel), ccs, 'centro_custo', acesso.canSee), [ccs, ccSel, areaSel, divisaoSel, buSel, acesso])

  // ⚠⚠ O QUE SE OFERECE NA TELA É OUTRA PERGUNTA DO QUE O QUE SE ENTREGA.
  // O DADO já estava protegido em duas camadas — `escopoFiltro` cruza o filtro
  // da tela com o escopo VER, e o RLS recorta `fat_orcado` por CC desde a
  // v3_129 —, então clicar numa área sem acesso devolve vazio, não o dado
  // alheio. O que vazava era a EXISTÊNCIA: a pílula "Diretoria" aparecia para
  // quem não alcança nenhum CC dela, com o nome da área, e dava um botão que
  // não faz nada.
  // ⚠ `ccsVisiveis` é DERIVADO e não substitui `ccs`: `escopoFiltro` compara
  // `permitidos.length >= todos.length` para decidir se há restrição — passando
  // a lista já filtrada como `todos`, a comparação daria sempre "sem restrição"
  // e o escopo PARARIA de ser aplicado. A lista crua alimenta o cálculo; a
  // recortada, a interface.
  // (Indicadores, CAGR e Executivo já faziam isto; esta tela tinha ficado para trás.)
  const ccsVisiveis = useMemo(() => acesso.filterList('centro_custo', ccs as any) as CC[], [ccs, acesso])
  const empFiltradas = useMemo(() => empresaSel.filter(id => acesso.canSee('empresa', id)), [empresaSel, acesso])

  // ── Análise Pessoas: carga PREGUIÇOSA ────────────────────────────────────
  // ⚠ Só busca quando a aba abre. As outras duas já fazem 6 a 8 chamadas por
  // recarga, e esta é a terceira — pagar por ela em quem nunca abre a aba é
  // deixar o dashboard mais lento para a maioria por causa da minoria.
  const [pess, setPess] = useState<any[] | null>(null)
  const [carregPess, setCarregPess] = useState(false)
  // ⚠ Falha da consulta e ausência de dado são coisas DIFERENTES e davam a
  // mesma tela: timeout virava "Sem orçado de pessoal nesta versão — rode o
  // Aplicar", que manda a pessoa aplicar o quadro para resolver um problema
  // que não é esse. Mensagem que afirma uma causa não verificada custa a
  // tarde de quem acredita nela.
  const [erroPess, setErroPess] = useState<string | null>(null)
  useEffect(() => {
    if (aba !== 'pessoas' || !vBase || !anoBase || !empFiltradas.length) { setPess([]); return }
    let vivo = true
    setCarregPess(true); setErroPess(null)
    supabase.rpc('analise_pessoas_agg', {
      p_versao: vBase, p_ano: anoBase,
      // ⚠ Empresa é OBRIGATÓRIA na RPC (v3_191): o `IS NULL OR` impedia o uso do
      // índice e levava a função a 3,7 s — estourava o timeout. Sem empresa
      // selecionada não há o que somar, então sai antes de chamar.
      p_empresas: empFiltradas,
      p_filiais: filialFilter, p_ccs: ccFilter,
    }).then(({ data, error }) => {
      if (!vivo) return
      setCarregPess(false)
      // ⚠ Erro vira lista VAZIA, não `null`: null é "ainda não buscou" e
      // deixaria a tela em "Calculando…" para sempre.
      if (error) { setErro(error.message); setErroPess(error.message); setPess([]) }
      else { setErroPess(null); setPess(data || []) }
    })
    return () => { vivo = false }
  }, [aba, vBase, anoBase, empFiltradas.join(','), filialFilter?.join(','), ccFilter?.join(',')]) // eslint-disable-line

  // ⚠ Os dois lados compartilham a versão da projeção: os meses projetados
  // ficam idênticos POR CONSTRUÇÃO e a variação neles é zero de mentira.
  const projContamina = modo === 'REAL' && proj === 'ORCADO' && vBase === vComp && mesesProj.length > 0
  // O realizado não cobre o período pedido: os meses que faltam entram como
  // ZERO. Vale nos DOIS modos — a seção de Acurácia usa realizado sempre, mesmo
  // quando a comparação principal é entre dois orçados. Antes o aviso só saía
  // no modo Realizado, e a acurácia comparava 12 meses de orçado contra 9 de
  // realizado em silêncio, fazendo tudo parecer "ficou abaixo".
  const realCurto = realAte > 0 && realAte < mesFim

  // Orçado por empresa da linha de resultado escolhida. Roda o MOTOR por
  // empresa (a linha costuma ser FÓRMULA, e somar o agregado direto daria um
  // número que não existe na DRE) — mas sobre o bruto que já veio.
  const porEmp = useMemo(() => {
    const alvo = empLinha || secOrc.resultado
    if (!linhaEmpBruto.length || !alvo || !anoBase) return []
    const masters = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
    const rlOf: Record<string, string> = {}
    linhas.forEach(l => { if (l.linha_orc_id && !l.nao_soma) rlOf[l.linha_orc_id] = l.id })
    const calc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
    const PER: Periodo = { ano: anoBase, mes: 1 }; const K = pkey(PER)
    const porEmpM: Record<string, Record<string, number>> = {}
    for (const x of linhaEmpBruto) {
      if (!empFiltradas.includes(x.empresa_id)) continue
      ;(porEmpM[x.empresa_id] = porEmpM[x.empresa_id] || {})[x.linha_id] = Number(x.orcado) || 0
    }
    const nomeEmp: Record<string, string> = {}
    empresas.forEach((e: any) => { nomeEmp[e.id] = `${e.codigo} · ${String(e.descricao || '').slice(0, 20)}` })
    const fAlvo = fatorExibicao(alvo, Object.fromEntries(linhas.map(l => [l.id, l])) as any)
    return Object.entries(porEmpM).map(([eid, byMaster]) => {
      const computed: Computed = {}; calc.forEach(l => { computed[l.id] = {} })
      for (const mm of masters) { const rl = rlOf[mm]; if (rl) computed[rl][K] = byMaster[mm] || 0 }
      return { empresa: nomeEmp[eid] || '?', valor: Math.round(fAlvo * (computeTotais(calc, computed, [PER])[alvo] || 0)) }
    }).filter(x => x.valor).sort((a, b) => b.valor - a.valor).slice(0, 14).reverse()
    /* eslint-disable-next-line */
  }, [linhaEmpBruto, empLinha, secOrc.resultado, linhas, empFiltradas.join(','), empresas, anoBase])

  const carregar = async () => {
    // ⚠ `anoBase`/`anoComp` saem do CATÁLOGO de versões, não do id. Com o id
    // restaurado do localStorage a guarda do id já passa antes de o catálogo
    // chegar — e aí a consulta ia com ano `undefined` e voltava vazia, com a
    // tela inteira zerada. Mexer em qualquer combo recarregava e "consertava",
    // que é o sintoma clássico de carga disparada cedo demais.
    // ⚠⚠ A SELEÇÃO DOS CARTÕES NÃO ENTRA AQUI — nem na guarda, nem nas
    // dependências. A carga já computa TODAS as linhas (`base` recebe
    // `linhas`, não a seleção), então marcar uma linha num cartão recarregava
    // a tela inteira para recalcular exatamente o mesmo dado; e `carregando`
    // troca o conteúdo por "Calculando…", que é o piscar desagradável.
    // Filtro e pílulas do TOPO seguem recarregando: esses mudam o dado.
    if (!relId || !vBase || !vComp || !anoBase || !anoComp || !linhas.length || !empFiltradas.length) { setDados(null); return }
    setCarregando(true); setErro(null)
    try {
      const base = { linhas, ccs, empresas: empFiltradas, filialFilter, ccFilter, ccPermitidos: null as string[] | null }
      // ⚠⚠ CACHE DE UMA CARGA SÓ. A tela pedia a MESMA leitura mais de uma vez:
      // com "Orçado × Orçado" e sem projeção, `serie(vComp)` e o `oa` da
      // acurácia são a mesma chamada, letra por letra — e cada uma custa
      // 1 + 5 RPCs sob RLS (a DRE Gerencial tem 5 grupos de escopo próprio),
      // a ~1 s cada. Guardar a PROMESSA, e não o resultado, é o que faz o
      // segundo pedido entrar de carona num voo já levantado.
      const voos = new Map<string, Promise<{ total: Record<string, number>; mes: Record<string, number[]> }>>()
      const chamarMes = (cen: string, anos: number[], ms: number[]) => {
        if (!ms.length) return Promise.resolve({ total: {} as Record<string, number>, mes: {} as Record<string, number[]> })
        const k = `${cen}|${anos.join(',')}|${ms.join(',')}`
        let p = voos.get(k)
        if (!p) { p = totaisRelatorioMes({ ...base, cen, anos, meses: ms }); voos.set(k, p) }
        return p
      }
      const chamar = async (cen: string, anos: number[], ms: number[]) => (await chamarMes(cen, anos, ms)).total

      // Uma SÉRIE = o período pedido, mais a projeção dos meses seguintes até
      // dezembro. A projeção se compõe de outra leitura com faixa de meses
      // diferente, vezes um fator — não precisa de dado mensal cru.
      const serie = async (cen: string, ano: number): Promise<Record<string, number>> => {
        const periodo = await chamar(cen, [ano], meses)
        if (!mesesProj.length) return periodo
        let fonte: Record<string, number>, fator: number
        if (proj === 'ORCADO' && cen === 'REALIZADO') {
          // a estimativa da própria empresa para aqueles meses
          fonte = await chamar(vComp, [ano], mesesProj); fator = 1
        } else if (proj === 'MEDIA3') {
          const u3 = meses.slice(-3)
          fonte = await chamar(cen, [ano], u3); fator = u3.length ? mesesProj.length / u3.length : 0
        } else if (proj === 'MEDIAPER') {
          fonte = periodo; fator = meses.length ? mesesProj.length / meses.length : 0
        } else {  // ULTIMO
          fonte = await chamar(cen, [ano], [mesFim]); fator = mesesProj.length
        }
        const out = { ...periodo }
        for (const k in fonte) out[k] = (out[k] || 0) + fonte[k] * fator
        return out
      }

      const [b, c, oa, ra, det] = await Promise.all([
        serie(vBase, anoBase!),
        modo === 'ORC' ? serie(vComp, anoComp!) : serie('REALIZADO', anoComp!),
        // acurácia: orçado × realizado do ano comparado, sempre no período
        chamar(vComp, [anoComp!], meses),
        chamar('REALIZADO', [anoComp!], meses),
        // ⚠ O mensal da base (detector de "linha reta") NÃO custa mais nada: é
        // a mesma leitura que `serie(vBase)` já faz, e o cache a entrega.
        // Antes eram 10 invocações — 60 RPCs — para rebuscar mês a mês o que a
        // primeira resposta já trazia, porque `relatorio_orcado_agg` devolve
        // `mes` na linha e o detalhe era descartado.
        chamarMes(vBase, [anoBase!], meses),
      ])

      const comp = c
      const mensalBase = det.mes

      setDados({ base: b, comp, orcAnt: oa, realAnt: ra, mensalBase })

      // ── orçado por empresa (aba Orçamento)
      // Uma chamada só e o motor roda por empresa, em vez de N chamadas de
      // totaisRelatorio: a linha de resultado costuma ser FÓRMULA, e somar o
      // agregado direto daria um número que não existe na DRE.
      // ⚠⚠ A BUSCA NÃO DEPENDE DA LINHA ESCOLHIDA — só o cálculo depende. O
      // `p_linhas` vai com TODOS os masters, então trocar a linha de resultado
      // não muda uma vírgula do que o banco devolve. Guardamos o bruto e o
      // gráfico se refaz em memória (ver `porEmp`, abaixo).
      const masters = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      // `le` vive fora do `if`: o quadro "quem causou" o relê depois, e
      // declarado dentro ele não chegaria lá.
      const le: any[] = []
      if (masters.length) {
        // ⚠ PAGINAR. O agregado devolve EMPRESA × LINHA: com 13 empresas e
        // ~270 masters passa de 3.500 linhas, e o PostgREST corta em 1000 sem
        // erro nenhum. O sintoma é o gráfico vir com menos empresas do que
        // existe — ou vazio, se as que sobraram forem as sem valor.
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.rpc('relatorio_linha_empresa_agg', {
            p_versao: vBase, p_anos: [anoBase!], p_meses: meses,
            p_linhas: masters, p_filiais: filialFilter, p_ccs: ccFilter, p_slot: 1,
          }).range(from, from + 999)
          if (error || !data?.length) break
          le.push(...data)
          if (data.length < 1000) break
        }
        setLinhaEmpBruto(le)
      } else setLinhaEmpBruto([])


      // ── por ÁREA e por CC (só orçado)
      // `dashboard_cc_agg` devolve cc × linha × mês e passa de mil linhas fácil,
      // então pagina — o PostgREST corta em 1000 sem avisar.
      const ccAgg: any[] = []
      if (masters.length) {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.rpc('dashboard_cc_agg', {
            p_versao: vBase, p_empresas: empFiltradas, p_anos: [anoBase!], p_meses: meses,
            p_linhas: masters, p_filiais: filialFilter, p_ccs: ccFilter, p_slot: 1,
          }).range(from, from + 999)
          if (error || !data?.length) break
          ccAgg.push(...data)
          if (data.length < 1000) break
        }
      }
      setPorArea(agregarPorArea(ccAgg, linhas, ccs))

      // ── bruto por dimensão (quadro "quem causou")
      // ⚠⚠ NO CASO TÍPICO NÃO CUSTA CONSULTA NENHUMA. As duas RPCs já
      // devolvem `orcado` E `realizado` do ano pedido, então comparando o
      // Orçado de 2026 com o Realizado de 2026 as chamadas que a tela já fazia
      // trazem os dois lados. Só quando o comparado é OUTRA versão (orçado ×
      // orçado) ou OUTRO ano é que vai uma segunda leitura — e aí vai, porque
      // a alternativa seria o quadro sumir sem explicação justamente no modo
      // em que se monta o orçamento.
      const mesmoLado = modo === 'REAL' && anoComp === anoBase
      const emp: LadoPorMaster = {}, cc: LadoPorMaster = {}
      const por = (alvo: LadoPorMaster, chave: string | null, master: string, campo: 'b' | 'c', v: number) => {
        if (!v) return
        const k = chave || '__sem'
        const m = (alvo[k] = alvo[k] || {})
        const cel = (m[master] = m[master] || { b: 0, c: 0 })
        cel[campo] += v
      }
      for (const x of le) {
        if (!empFiltradas.includes(x.empresa_id)) continue
        por(emp, x.empresa_id, x.linha_id, 'b', Number(x.orcado) || 0)
        if (mesmoLado) por(emp, x.empresa_id, x.linha_id, 'c', Number(x.realizado) || 0)
      }
      for (const r of ccAgg) {
        por(cc, r.cc_id, r.linha_id, 'b', Number(r.orcado) || 0)
        if (mesmoLado) por(cc, r.cc_id, r.linha_id, 'c', Number(r.realizado) || 0)
      }
      if (!mesmoLado && masters.length) {
        const vLado = modo === 'ORC' ? vComp : vBase
        const campoLado = modo === 'ORC' ? 'orcado' : 'realizado'
        const [leC, ccC] = await Promise.all([
          supabase.rpc('relatorio_linha_empresa_agg', {
            p_versao: vLado, p_anos: [anoComp!], p_meses: meses,
            p_linhas: masters, p_filiais: filialFilter, p_ccs: ccFilter, p_slot: 1,
          }).range(0, 4999),
          supabase.rpc('dashboard_cc_agg', {
            p_versao: vLado, p_empresas: empFiltradas, p_anos: [anoComp!], p_meses: meses,
            p_linhas: masters, p_filiais: filialFilter, p_ccs: ccFilter, p_slot: 1,
          }).range(0, 9999),
        ])
        for (const x of (leC.data || []) as any[]) {
          if (!empFiltradas.includes(x.empresa_id)) continue
          por(emp, x.empresa_id, x.linha_id, 'c', Number(x[campoLado]) || 0)
        }
        for (const r of (ccC.data || []) as any[]) por(cc, r.cc_id, r.linha_id, 'c', Number(r[campoLado]) || 0)
      }
      setDimBruto({ emp, cc })
    } catch (e: any) {
      setErro(e?.message ?? String(e)); setDados(null)
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [relId, vBase, vComp, modo, mesIni, mesFim, proj, empFiltradas.join(','), filialSel.join(','), ccSel.join(','), areaSel.join(','), divisaoSel.join(','), buSel.join(','), linhas.length, anoBase, anoComp])

  // ── helpers de linha
  const byId = useMemo(() => Object.fromEntries(linhas.map(l => [l.id, l])) as Record<string, LinhaRel>, [linhas])
  const fac = (id: string) => fatorExibicao(id, byId)
  const nome = (id: string) => byId[id]?.descricao ?? '—'
  const val = (src: Record<string, number> | undefined, id: string) => (src?.[id] ?? 0) * fac(id)

  const S = {
    page: { padding: 24 } as const,
    bar: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' as const, marginBottom: 18 },
    lbl: { fontSize: 10.5, textTransform: 'uppercase' as const, letterSpacing: .5, color: 'var(--muted)', marginBottom: 4 },
    sel: { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
    sec: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 18 },
    secH: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
    // ⚠ Cabeçalho EMPILHADO, para a ponte e o "O que mudou" ficarem iguais.
    // Com os controles ao lado do texto, a descrição da ponte era espremida
    // numa coluna estreita de 8 linhas enquanto a do outro ocupava a largura
    // toda — e os controles lá quebravam em três fileiras. Mesmo conteúdo,
    // cartões de aparências diferentes.
    secBarra: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, margin: '12px 0 16px' },
    secT: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
    secD: { fontSize: 12, color: 'var(--muted)', marginTop: 2 },
    th: { textAlign: 'right' as const, padding: '6px 8px', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: .4, color: 'var(--muted)', borderBottom: '1px solid var(--border)' },
    td: { textAlign: 'right' as const, padding: '6px 8px', fontSize: 13, fontFamily: 'monospace', borderBottom: '1px solid var(--panel)' },
  }

  const rotuloComp = modo === 'REAL'
    ? `Realizado ${anoComp ?? ''}` + (proj !== 'OFF' && mesesProj.length ? ` + projeção` : '')
    : `${versao(vComp)?.codigo ?? ''} · ${anoComp ?? ''}`
  const rotuloBase = versao(vBase)?.codigo ?? ''

  // Quantas versões existem em cada ano — o sufixo do combo de comparação só
  // aparece onde há mais de uma. Marcador em toda linha deixa de marcar.
  const versoesNoAno = useMemo(() => {
    const n: Record<number, number> = {}
    versoes.forEach((v: any) => { n[v.ano] = (n[v.ano] || 0) + 1 })
    return n
  }, [versoes])

  // ⚠⚠ O SENTIDO SEGUE O MODO quando ninguém escolheu, porque são DUAS
  // perguntas diferentes e cada modo faz uma delas:
  //   · Orçado × Orçado — "saí de 2026 e cheguei no 2027 que estou montando":
  //     o destino é a coisa sendo construída, logo a origem é o COMPARADO.
  //   · Orçado × Realizado — "planejei X e aconteceu Y": o plano é a
  //     REFERÊNCIA e o realizado o resultado, logo a origem é o ANALISADO.
  // O segundo caso era desenhado ao contrário, e a leitura saía invertida: uma
  // despesa estourada em 5,06 mi aparecia VERDE com "↓ gasto", porque a frase
  // verdadeira ali é "indo do realizado para o orçado, o gasto cai" — e
  // ninguém faz essa pergunta. Quem leu errado foi o próprio dono da regra,
  // que é o sinal de que não era preferência.
  const origemAnalisado = sentidoOrigem ? sentidoOrigem === 'ANALISADO' : modo === 'REAL'
  const pOrigem = origemAnalisado ? dados?.base : dados?.comp
  const pDestino = origemAnalisado ? dados?.comp : dados?.base
  const rotOrigem = origemAnalisado ? rotuloBase : rotuloComp
  const rotDestino = origemAnalisado ? rotuloComp : rotuloBase

  return (
    <div style={S.page} ref={dashRef}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/dashboards')} data-noexport
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-mid)' }}>
            <ChevronLeft size={15} /> Voltar
          </button>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0, color: 'var(--text)' }}>Orçamento — análise{cardNome ? ` · ${cardNome}` : ''}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }} data-noexport>
          <SalvarCardButton base="/dashboards/orcamento" cor="#5f3dc4" cardId={cardId} getFiltros={estado} />
          <ExportarButton alvo={dashRef} nome="orcamento" titulo="Orçamento — análise"
            legenda={`${versao(vBase)?.codigo ?? ''} × ${rotuloComp} · ${MES[mesIni - 1]}–${MES[mesFim - 1]}`} />
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 18px' }}>
        Avalia o orçamento <strong>antes de aprovar</strong>: de onde vem a variação, o que mudou,
        e se dá para acreditar em quem fez. Execução mensal é no <em>DRE — Acompanhamento</em>.
      </p>

      {/* ── chassi ── */}
      <div style={S.bar} data-noexport>
        <div><div style={S.lbl}>Relatório</div>
          <select style={{ ...S.sel, minWidth: 180 }} value={relId} onChange={e => setRelId(e.target.value)}>
            <option value="">— escolha —</option>
            {relatorios.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select></div>

        <div><div style={S.lbl}>Orçamento analisado</div>
          <select style={S.sel} value={vBase} onChange={e => setVBase(e.target.value)}>
            {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo} · {v.ano}</option>)}
          </select></div>

        <div><div style={S.lbl}>Comparar com</div>
          <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as Modo)}>
            <option value="ORC">Orçado × Orçado</option>
            <option value="REAL">Orçado × Realizado</option>
          </select></div>

        <div><div style={S.lbl}>{modo === 'REAL' ? 'Realizado do ano da versão' : 'Versão de comparação'}</div>
          <select style={S.sel} value={vComp} onChange={e => setVComp(e.target.value)}
            title={modo === 'REAL'
              ? 'Escolhe o ANO do realizado a comparar — e, quando o ano tem mais de uma versão, qual orçamento a Acurácia confronta com ele.'
              : 'A versão de orçamento com que o analisado é comparado.'}>
            {versoes.map(v => (
              // ⚠⚠ NO MODO REALIZADO A VERSÃO FAZ DUAS COISAS, e o comentário
              // antigo aqui afirmava que fazia uma só ("só serve para dizer o
              // ANO"). Ela diz o ano do realizado — a ponte e *O que mudou* leem
              // `serie('REALIZADO', anoComp)` e não olham a versão — **e**
              // escolhe qual orçamento daquele ano a *Acurácia* confronta com
              // esse realizado (`chamar(vComp, [anoComp])`).
              // Por isso três versões de 2027 viravam três "Realizado 2027"
              // idênticos no combo: rótulos iguais para opções que NÃO são
              // equivalentes — trocar entre elas muda a Acurácia inteira.
              // ⚠ Deduplicar por ano seria o conserto errado: apagaria a
              // escolha e elegeria uma versão em silêncio, que é a armadilha do
              // `ON CONFLICT` de novo. O que faltava era o rótulo dizer a
              // segunda coisa — e só onde ela existe.
              <option key={v.id} value={v.id}>
                {modo === 'REAL'
                  ? `Realizado ${v.ano}` + (versoesNoAno[v.ano] > 1 ? ` · acurácia vs ${v.codigo}` : '')
                  : `${v.codigo} · ${v.ano}`}
              </option>
            ))}
          </select></div>

        {/* Mês início/fim próprios: o PeriodPicker do acompanhamento escolhe
            pares (ano, mês), e aqui o ANO vem da versão — pedir ano de novo
            deixaria escolher um par inconsistente. */}
        <div><div style={S.lbl}>De</div>
          <select style={S.sel} value={mesIni} onChange={e => { const v = Number(e.target.value); setMesIni(v); if (v > mesFim) setMesFim(v) }}>
            {MES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select></div>
        <div><div style={S.lbl}>Até</div>
          <select style={S.sel} value={mesFim} onChange={e => { const v = Number(e.target.value); setMesFim(v); if (v < mesIni) setMesIni(v) }}>
            {MES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select></div>

                {/* A projeção vale nos DOIS modos: limitar o período e perguntar "e se
            o resto do ano seguir este ritmo?" é a mesma pergunta comparando
            orçados ou comparando com realizado. Antes isto só aparecia no modo
            Realizado — e sumia sem explicação no outro. */}
        {/* ⚠⚠ ORÇADO × ORÇADO COM PERÍODO PARCIAL ENGANA MAIS que no realizado:
            os dois lados são planos do ANO INTEIRO, e recortar meses deixa de
            fora economia (ou aumento) que existe e está gravada.
            Custou uma investigação em 18/nov: o cenário dizia −591.979 de
            efeito no ano e o comparativo mostrava −467.414. Nada se perdera —
            os R$ 124.565 que faltavam estavam em nov+dez, fora do recorte.
            A tela não dizia, e os dois números pareciam discordar.
            ⚠ Só no modo ORC: no realizado, período parcial é o normal (o ano
            ainda não acabou) e o aviso viraria ruído em toda sessão. */}
        {modo === 'ORC' && (mesIni > 1 || mesFim < 12) && (
          <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--orange)', lineHeight: 1.6 }}>
            ⚠ Comparando <b>{MES[mesIni - 1]}–{MES[mesFim - 1]}</b> de dois orçamentos que são do
            ano inteiro: o que mudar fora desse intervalo não aparece aqui. Para o efeito total,
            use <b>jan–dez</b>.
          </div>
        )}

        {/* ⚠⚠ O SENTIDO É DO CABEÇALHO, não de um cartão: ele rege a leitura da
            aba inteira (a ponte e o ranking), e dentro de um quadro pareceria
            um ajuste local. O rótulo mostra a FRASE completa — "de X para Y" —
            porque é a primeira coisa a conferir antes de ler qualquer sinal.
            ⚠ Só na aba Comparativo. Em *Orçamento* o protagonista é o plano e o
            comparado é um Δ discreto nos cards; em *Análise Pessoas* não há
            comparação nenhuma. Controle morto ensina que a tela às vezes não
            responde. */}
        {aba === 'comparativo' && (
          <div><div style={S.lbl}>Sentido da leitura</div>
            <select style={{ ...S.sel, maxWidth: 320 }}
              value={origemAnalisado ? 'ANALISADO' : 'COMPARADO'}
              onChange={e => setSentidoOrigem(e.target.value as 'ANALISADO' | 'COMPARADO')}>
              <option value="ANALISADO">de {rotuloBase} para {rotuloComp}</option>
              <option value="COMPARADO">de {rotuloComp} para {rotuloBase}</option>
            </select></div>
        )}

        {mesFim < 12 && (
          <div><div style={S.lbl}>Meses seguintes ({MES[mesFim]}–dez)</div>
            <select style={{ ...S.sel, maxWidth: 320 }} value={proj} onChange={e => setProj(e.target.value as Proj)}>
              {(['OFF', 'MEDIA3', 'MEDIAPER', 'ULTIMO', ...(modo === 'REAL' ? ['ORCADO' as Proj] : [])] as Proj[])
                .map(k => <option key={k} value={k}>{PROJ_ROTULO[k]}</option>)}
            </select></div>
        )}

        <FiltrosButton empresas={acesso.filterList('empresa', empresas)}
          filiais={acesso.filterList('filial', filiais)} ccs={ccsVisiveis}
          empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel}
          ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel}
          divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
      </div>

      {/* Atalho da pergunta mais frequente. Escreve no MESMO estado do modal,
          então a contagem do botão "Filtros" acompanha e não há duas verdades. */}
      <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PillsDim ccs={ccsVisiveis} codKey="area_cod" nomeKey="area_nome" titulo="Área"
          sel={areaSel} setSel={setAreaSel} />
        <PillsDim ccs={ccsVisiveis} codKey="divisao_cod" nomeKey="divisao_nome" titulo="Divisão"
          sel={divisaoSel} setSel={setDivisaoSel} />
      </div>

      {projContamina && (
        <Aviso tom="alerta">
          Os dois lados usam a <strong>mesma versão</strong> e a projeção lê o orçado dela:
          os meses {MES[mesesProj[0] - 1]}–{MES[mesesProj[mesesProj.length - 1] - 1]} ficam idênticos
          por construção, e a variação neles é <strong>zero de mentira</strong>.
          Troque a versão de comparação ou o método de projeção.
        </Aviso>
      )}
      {realCurto && (
        <Aviso tom="alerta">
          O realizado de {anoComp} só tem dado até <strong>{MES[realAte - 1]}</strong>, mas o período vai
          até <strong>{MES[mesFim - 1]}</strong>. Os meses {MES[realAte]}–{MES[mesFim - 1]} entram como
          <strong> zero</strong>{modo === 'REAL' ? ' do lado comparado' : ' na seção de Acurácia'}
          {modo === 'REAL' ? ', e o crescimento aparece inflado' : ', e quase toda linha vai parecer que "ficou abaixo"'}.
          Feche o período em {MES[realAte - 1]}{mesesProj.length ? '' : ' e use a projeção, se quiser o ano cheio'}.
        </Aviso>
      )}
      {mesesProj.length > 0 && (
        <Aviso tom="info">
          {mesesProj.length} mês(es) <strong>projetado(s)</strong> dos <strong>dois lados</strong>
          {' '}({PROJ_ROTULO[proj].replace('projetar ', '')}). O período analisado passa a ser o ano cheio.
          Projeção não é fato — confira antes de decidir com ela.
        </Aviso>
      )}
      {erro && <Aviso tom="alerta">{erro}</Aviso>}

      {/* Abas abaixo dos filtros: os filtros valem para as DUAS, então ficam
          acima — mudar de aba não deve custar remarcar empresa e período. */}
      {relId && (
        <div style={{ display: 'flex', gap: 6, margin: '0 0 16px' }} data-noexport>
          {([['orcamento', 'Orçamento'], ['comparativo', 'Comparativo'], ['pessoas', 'Análise Pessoas']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setAba(k)}
              style={{ padding: '7px 16px', fontSize: 13, fontWeight: aba === k ? 700 : 500, borderRadius: 99, cursor: 'pointer',
                border: '1px solid ' + (aba === k ? 'var(--violet)' : 'var(--border)'),
                background: aba === k ? 'rgba(139,92,246,0.16)' : 'var(--panel)',
                color: aba === k ? 'var(--violet)' : 'var(--text-mid)' }}>{lbl}</button>
          ))}
        </div>
      )}

      {!relId ? (
        <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48 }}>
          Escolha um <strong>relatório</strong> para começar.
        </div>
      ) : carregando ? (
        <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48 }}>Calculando…</div>
      ) : aba === 'pessoas' ? (
        carregPess || !pess
          ? <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48 }}>Calculando…</div>
          : <VisaoPessoas S={S} linhas={pess} erro={erroPess} rotulo={versao(vBase)?.codigo ?? ''} ano={anoBase} />
      ) : !dados ? null : aba === 'orcamento' ? (
        <VisaoOrcamento S={S} cfg={secOrc} setCfg={setSecOrc} linhas={linhas} nome={nome} val={val} fac={fac}
          base={dados.base} comp={dados.comp} mensal={dados.mensalBase} meses={meses} MES={MES}
          metas={metas} anoBase={anoBase} indicSel={indicSel} setIndicSel={setIndicSel} pick={pickIndic} setPick={setPickIndic}
          linhaSel={linhaSel} setLinhaSel={setLinhaSel} pickLinha={pickLinha} setPickLinha={setPickLinha}
          empLinha={empLinha} setEmpLinha={setEmpLinha}
          porEmp={porEmp} porArea={porArea} setDrill={setDrill}
          rotuloBase={rotuloBase} rotuloComp={rotuloComp} />
      ) : (
        <>
          <Ponte S={S} cfg={secPonte} setCfg={setSecPonte} linhas={linhas} nome={nome}
            trilha={trilhaPonte} setTrilha={setTrilhaPonte} navRef={navPonte}
            nat={ponteNat} setNat={setPonteNat} ate={ponteAte} setAte={setPonteAte}
            origem={pOrigem} destino={pDestino} rotOrigem={rotOrigem} rotDestino={rotDestino} />

          <QuemCausou S={S} linhas={linhas} nome={nome} bruto={dimBruto} empresas={empresas} ccs={ccs}
            resId={secPonte.resultado} componentes={secPonte.sel} invertido={origemAnalisado}
            rotOrigem={rotOrigem} rotDestino={rotDestino} dim={quemDim} setDim={setQuemDim}
            ano={anoBase} dTotal={secPonte.resultado
              ? (pDestino?.[secPonte.resultado] ?? 0) - (pOrigem?.[secPonte.resultado] ?? 0) : 0} />

          <Variacao S={S} cfg={secVar} setCfg={setSecVar} linhas={linhas} nome={nome} fac={fac}
            aba={varAba} setAba={setVarAba} nivel={varNivel} setNivel={setVarNivel}
            nat={varNat} setNat={setVarNat}
            origem={pOrigem} destino={pDestino} val={val} rotOrigem={rotOrigem} rotDestino={rotDestino} />

          <Acuracia S={S} cfg={secAcur} setCfg={setSecAcur} linhas={linhas} nome={nome}
            aba={acurAba} setAba={setAcurAba} nivel={acurNivel} setNivel={setAcurNivel}
            nat={acurNat} setNat={setAcurNat}
            orc={dados.orcAnt} real={dados.realAnt} val={val} ano={anoComp} />

          <Alertas S={S} linhas={linhas} nome={nome}
            base={dados.base} comp={dados.comp} mensal={dados.mensalBase} val={val} nMeses={meses.length} />
        </>
      )}

      {/* Drill herdado do dash de acompanhamento — mesmo componente, sem
          reescrever: ele abre a linha do relatório, desce pela árvore e chega
          ao razão. Aqui entra escopado ao CC ou à área clicada. */}
      {drill && (
        <DrillModal relId={relId} versaoId={vBase} empIds={empFiltradas} anos={[anoBase!]} meses={meses}
          filFilter={filialFilter} ccFilter={drill.ccFilter !== undefined ? drill.ccFilter : ccFilter}
          startNodeId={drill.nodeId} slot={1} soOrcado onClose={() => setDrill(null)} />
      )}
    </div>
  )
}

// ── Card de uma linha do relatório (indicador ou não) ──
// O mesmo card serve às duas seções: a diferença entre elas é só QUAIS linhas
// entram, não como se mostram.
function CardLinha({ l, val, fac, base, comp, metas, anoBase, rotuloComp, arrasto, sobre, setArrasto, setSobre, soltar }: any) {
  const v = val(base, l.id), vc = val(comp, l.id)
  const d = v - vc
  const casas = l.casas_decimais ?? (l.formato === 'PERCENTUAL' ? 1 : 0)
  const pct = vc !== 0 ? (d / Math.abs(vc)) * 100 : null
  // Mesma regra da tabela de variação: custo é bom quando encolhe.
  const bom = fac(l.id) === -1 ? Math.abs(v) < Math.abs(vc) : v > vc
  const alvoSolta = sobre === l.id && arrasto && arrasto !== l.id
  return (
    <div draggable
      onDragStart={e => { setArrasto(l.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (sobre !== l.id) setSobre(l.id) }}
      onDragLeave={() => { if (sobre === l.id) setSobre(null) }}
      onDrop={e => { e.preventDefault(); soltar(l.id) }}
      onDragEnd={() => { setArrasto(null); setSobre(null) }}
      title="Arraste para reordenar"
      style={{ background: 'var(--panel)', borderRadius: 12, padding: 15, cursor: 'grab',
        border: '1px solid ' + (alvoSolta ? 'var(--violet)' : 'var(--border)'),
        boxShadow: alvoSolta ? '0 0 0 3px rgba(139,92,246,0.18)' : 'none',
        opacity: arrasto === l.id ? 0.45 : 1, transition: 'box-shadow .12s, opacity .12s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, flex: 1, minWidth: 0 }}>{l.descricao}</div>
        <ChipMeta valor={v} meta={resolverMeta(metas, l.id, anoBase, null)} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '6px 0 4px' }}>
        {formatValor(v, l.formato || 'NUMERO', casas)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {rotuloComp} {formatValor(vc, l.formato || 'NUMERO', casas)}
        {d !== 0 && <> · <span style={{ color: bom ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
          {d >= 0 ? '+' : ''}{fmt(d, casas)}{pct != null ? ` (${fmtPct(pct)})` : ''}
        </span></>}
      </div>
    </div>
  )
}

// ── Seletor com ORDEM (as duas seções usam o mesmo) ──
function PickerLinhas({ titulo, nota, candidatos, sel, setSel, fechar }: any) {
  const noPainel = sel.map((id: string) => candidatos.find((l: LinhaRel) => l.id === id)).filter(Boolean) as LinhaRel[]
  const fora = candidatos.filter((l: LinhaRel) => !sel.includes(l.id))
  const [busca, setBusca] = useState('')
  const foraVis = busca.trim()
    ? fora.filter((l: LinhaRel) => (l.descricao || '').toLowerCase().includes(busca.trim().toLowerCase()))
    : fora
  const mover = (i: number, d: number) => {
    const n = [...sel]; const j = i + d
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j], n[i]]; setSel(n)
  }
  const lin: any = { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', fontSize: 13, borderBottom: '1px solid var(--border)' }
  const mini: any = { background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2, display: 'inline-flex' }
  const bt: any = { padding: '6px 12px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }} onClick={fechar}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 460, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e: any) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{titulo}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{nota}</div>

        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--faint)', fontWeight: 600, margin: '0 0 6px' }}>No painel ({noPainel.length})</div>
        {!noPainel.length ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '6px 0 10px' }}>Nenhuma escolhida ainda.</div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
            {noPainel.map((l, i) => (
              <div key={l.id} style={{ ...lin, borderBottom: i === noPainel.length - 1 ? 'none' : lin.borderBottom }}>
                <span style={{ width: 20, color: 'var(--faint)', fontSize: 11, textAlign: 'right' }}>{i + 1}</span>
                <span style={{ flex: 1, color: 'var(--text)' }}>{l.descricao}</span>
                <button style={{ ...mini, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0} title="Subir" onClick={() => mover(i, -1)}><ChevronUp size={14} /></button>
                <button style={{ ...mini, opacity: i === noPainel.length - 1 ? 0.3 : 1 }} disabled={i === noPainel.length - 1} title="Descer" onClick={() => mover(i, 1)}><ChevronDown size={14} /></button>
                <button style={{ ...mini, color: 'var(--red)' }} title="Tirar do painel" onClick={() => setSel(sel.filter((x: string) => x !== l.id))}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--faint)', fontWeight: 600 }}>Disponíveis ({foraVis.length})</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="buscar…"
            style={{ marginLeft: 'auto', padding: '4px 9px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 150 }} />
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
          {!foraVis.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 10px' }}>{busca ? 'Nada com esse texto.' : 'Todas já estão no painel.'}</div> : foraVis.map((l: LinhaRel, i: number) => (
            <div key={l.id} style={{ ...lin, cursor: 'pointer', borderBottom: i === foraVis.length - 1 ? 'none' : lin.borderBottom }}
              onClick={() => setSel([...sel, l.id])}>
              <span style={{ flex: 1, color: 'var(--muted)' }}>{l.descricao}</span>
              <span style={{ color: 'var(--violet)', fontSize: 12, fontWeight: 600 }}>+ adicionar</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={bt} onClick={() => setSel([])}>Limpar</button>
          <button style={{ ...bt, borderColor: 'var(--violet)', color: 'var(--violet)' }} onClick={fechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
/**
 * Agrega o `dashboard_cc_agg` por ÁREA e por CC de nível 2 — só o ORÇADO.
 *
 * Mesmas três exclusões do dash de acompanhamento, e cada uma evita um erro
 * diferente: só FOLHAS (senão o pai soma junto com os filhos e dobra), só
 * natureza RECEITA ou DESPESA herdada (o resto não é operação), e receita por
 * área é BRUTA — redutora de receita ali apareceria como se fosse faturamento
 * negativo de uma área.
 */
function agregarPorArea(rows: any[], linhas: LinhaRel[], ccs: CC[]) {
  const byId: Record<string, any> = Object.fromEntries(linhas.map(l => [l.id, l]))
  const natDe = (id: string | null): string | null => {
    if (!id) return null
    const l = byId[id]; if (!l) return null
    return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natDe(l.pai_id)
  }
  const temFilha = new Set(linhas.map(l => l.pai_id).filter(Boolean) as string[])
  const natByMaster: Record<string, string | null> = {}
  const redByMaster: Record<string, boolean> = {}
  const folha = new Set<string>()
  for (const l of linhas) {
    if (!l.linha_orc_id || l.desativada || l.nao_soma || temFilha.has(l.id)) continue
    folha.add(l.linha_orc_id)
    natByMaster[l.linha_orc_id] = natDe(l.id)
    redByMaster[l.linha_orc_id] = !!(l as any).redutora
  }
  const ccById: Record<string, CC> = Object.fromEntries(ccs.map(c => [c.id, c]))
  const corta = (t: string, n: number) => (t || '').length > n ? t.slice(0, n) + '…' : (t || '')
  const areaDe = (ccId: string | null) => ccId && ccById[ccId]?.area_nome ? ccById[ccId].area_nome! : 'Sem área'
  const nivel2 = (ccId: string | null) => {
    const c = ccId ? ccById[ccId] : null
    if (!c) return 'Sem CC'
    const cod2 = String(c.codigo || '').slice(0, 2)
    return cod2.length < 2 ? `${c.codigo} · ${corta(c.descricao, 18)}` : `${cod2} · ${corta(c.area_nome || cod2, 18)}`
  }

  const recA: Record<string, { v: number; ccs: Set<string> }> = {}, despA: Record<string, { v: number; ccs: Set<string> }> = {}
  const recC: Record<string, { v: number; ccs: Set<string> }> = {}, despC: Record<string, { v: number; ccs: Set<string> }> = {}
  const recM: Record<number, number> = {}, despM: Record<number, number> = {}
  const acum = (m: Record<string, { v: number; ccs: Set<string> }>, k: string, v: number, cc: string | null) => {
    const b = (m[k] = m[k] || { v: 0, ccs: new Set<string>() }); b.v += v; if (cc) b.ccs.add(cc)
  }
  for (const r of rows) {
    if (!folha.has(r.linha_id)) continue
    const nat = natByMaster[r.linha_id]
    if (nat !== 'RECEITA' && nat !== 'DESPESA') continue
    if (nat === 'RECEITA' && redByMaster[r.linha_id]) continue
    const v = (nat === 'DESPESA' ? -1 : 1) * (Number(r.orcado) || 0)   // exibição: positivo dos dois lados
    if (nat === 'RECEITA') { acum(recA, areaDe(r.cc_id), v, r.cc_id); acum(recC, nivel2(r.cc_id), v, r.cc_id); recM[r.mes] = (recM[r.mes] || 0) + v }
    else { acum(despA, areaDe(r.cc_id), v, r.cc_id); acum(despC, nivel2(r.cc_id), v, r.cc_id); despM[r.mes] = (despM[r.mes] || 0) + v }
  }
  const lista = (m: Record<string, { v: number; ccs: Set<string> }>, chave: string) =>
    Object.entries(m).filter(([, b]) => b.v).map(([k, b]) => ({ [chave]: k, Orçado: Math.round(b.v), _ccs: [...b.ccs] }))
      .sort((a: any, b: any) => b.Orçado - a.Orçado)
  const mesesOrd = [...new Set([...Object.keys(recM), ...Object.keys(despM)].map(Number))].sort((a, b) => a - b)
  return {
    rec: lista(recA, 'area'), desp: lista(despA, 'area'),
    ccRec: lista(recC, 'cc'), ccDesp: lista(despC, 'cc'),
    mes: [
      { id: 'Receitas', data: mesesOrd.map(m => ({ x: MES[m - 1], y: Math.round(recM[m] || 0) })) },
      { id: 'Despesas', data: mesesOrd.map(m => ({ x: MES[m - 1], y: Math.round(despM[m] || 0) })) },
    ],
  }
}

// ============================================================
/**
 * ABA "ORÇAMENTO" — o plano em si, sem comparar com outro ano.
 *
 * A outra aba julga o orçamento (de onde veio a variação, dá para acreditar).
 * Esta mostra o que ele É: os indicadores que a estrutura do relatório já
 * define, a forma do ano mês a mês, de que partes o resultado é feito e como
 * se distribui entre as empresas.
 *
 * Tudo lê o ORÇADO da versão base. A versão comparada aparece só como um Δ
 * discreto nos cards — referência, não protagonista; quem quiser comparar de
 * verdade tem a aba ao lado.
 */
function VisaoOrcamento({ S, cfg, setCfg, linhas, nome, val, fac, base, comp, mensal, meses, MES, metas, anoBase, indicSel, setIndicSel, pick, setPick, linhaSel, setLinhaSel, pickLinha, setPickLinha, empLinha, setEmpLinha, porEmp, porArea, setDrill, rotuloBase, rotuloComp }: any) {
  // Cards = linhas INDICADOR e FORMULA da estrutura. É o que o relatório já
  // declara como "medida" — nada hardcoded, e indicador novo aparece sozinho.
  const candidatos = useMemo(
    () => linhas.filter((l: LinhaRel) => (l.tipo_linha === 'INDICADOR' || l.tipo_linha === 'FORMULA') && !l.desativada),
    [linhas])
  // `indicSel` é a ORDEM, não só o filtro. A ordem da estrutura chega
  // embaralhada aqui porque as linhas de indicador ficam espalhadas pela
  // árvore — EBITDA perto do resultado, LER lá embaixo, margens no meio de
  // cada bloco. Faz sentido na DRE e nenhum num painel.
  //
  // Vazio = todos, na ordem da estrutura. Seção que nasce vazia parece quebrada.
  const cards = indicSel.length
    ? indicSel.map((id: string) => candidatos.find((l: LinhaRel) => l.id === id)).filter(Boolean) as LinhaRel[]
    : candidatos

  // Seção irmã: linhas que NÃO são indicador — receita bruta, despesas totais,
  // um subtotal. Aqui vazio = NENHUMA (são centenas; "todas" seria ruído), e
  // por isso a seção explica em vez de aparecer vazia.
  const linhasCard = useMemo(
    () => linhas.filter((l: LinhaRel) => l.tipo_linha !== 'ESPACO' && l.tipo_linha !== 'INDICADOR' && l.tipo_linha !== 'FORMULA' && !l.desativada),
    [linhas])
  const cardsLinha = linhaSel.map((id: string) => linhasCard.find((l: LinhaRel) => l.id === id)).filter(Boolean) as LinhaRel[]

  // Arrastar o card é o gesto natural para reordenar; o modal continua, para
  // escolher QUAIS. Como `indicSel` já é a ordem, arrastar só reordena o array.
  //
  // Com nada escolhido a lista é "todos na ordem da estrutura" e não existe
  // array para mexer — então o primeiro arrasto MATERIALIZA a ordem visível
  // antes de aplicar o movimento. Sem isso, o primeiro arrasto não teria efeito
  // e pareceria que a tela ignorou o gesto.
  const [semCC, setSemCC] = useState<{ rotulo: string; valor: number } | null>(null)
  const [arrasto, setArrasto] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  // Uma fábrica por seção: arrastar dentro de uma não pode mexer na ordem da
  // outra, e as duas listas são independentes.
  const fazSoltar = (ordemAtual: string[], visiveis: LinhaRel[], setOrdem: (v: string[]) => void) => (destinoId: string) => {
    const origemId = arrasto
    setArrasto(null); setSobre(null)
    if (!origemId || origemId === destinoId) return
    const ordem = ordemAtual.length ? [...ordemAtual] : visiveis.map(l => l.id)
    const de = ordem.indexOf(origemId), para = ordem.indexOf(destinoId)
    if (de < 0 || para < 0) return
    ordem.splice(para, 0, ...ordem.splice(de, 1))
    setOrdem(ordem)
  }
  const comum = { val, fac, base, comp, metas, anoBase, rotuloComp, arrasto, sobre, setArrasto, setSobre }
  const cardProps = { ...comum, soltar: fazSoltar(indicSel, cards, setIndicSel) }
  const cardPropsLinha = { ...comum, soltar: fazSoltar(linhaSel, cardsLinha, setLinhaSel) }

  // Cada gráfico entra no drill pelo SEU nó. Clicar em "Despesas por área" e
  // cair em Receitas é o que acontecia quando todos usavam a linha de
  // resultado. O nó certo é a linha mais alta cuja natureza efetiva bate com o
  // gráfico — critério estrutural, nada de procurar "Receita" no nome.
  const raizDe = (nat: 'RECEITA' | 'DESPESA'): string | null => {
    const byIdL: Record<string, LinhaRel> = Object.fromEntries(linhas.map((l: LinhaRel) => [l.id, l]))
    const natDe = (id: string | null): string | null => {
      if (!id) return null
      const l = byIdL[id]; if (!l) return null
      return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natDe(l.pai_id)
    }
    const cand = linhas.filter((l: LinhaRel) => !l.desativada && natDe(l.id) === nat)
    if (!cand.length) return null
    // a mais alta da árvore (menos pais acima) e, empatando, a de menor ordem
    const prof = (l: LinhaRel) => { let n = 0, c: LinhaRel | undefined = l; while (c?.pai_id) { c = byIdL[c.pai_id]; n++ } return n }
    return cand.sort((a: LinhaRel, b: LinhaRel) => prof(a) - prof(b) || ((a.ordem ?? 9999) - (b.ordem ?? 9999)))[0].id
  }

  const alvo = cfg.resultado ? linhas.find((l: LinhaRel) => l.id === cfg.resultado) : null
  // Candidatas do gráfico por empresa: subtotais, fórmulas e indicadores — o
  // que faz sentido comparar entre unidades. Analítica solta é detalhe demais.
  const linhasEmp = useMemo(
    () => linhas.filter((l: LinhaRel) => !l.desativada && l.tipo_linha !== 'ESPACO' && l.tipo_linha !== 'ANALITICA'),
    [linhas])
  const alvoEmp = (empLinha ? linhas.find((l: LinhaRel) => l.id === empLinha) : null) || alvo
  const partes: string[] = useMemo(() => componentesDe(alvo, linhas), [alvo, linhas])

  // ── evolução mensal das linhas escolhidas
  const evolucao = useMemo(() => cfg.sel.filter((id: string) => mensal[id]).map((id: string) => ({
    id: nome(id),
    data: meses.map((m: number, i: number) => ({ x: MES[m - 1], y: Math.round((mensal[id]?.[i] ?? 0) * fac(id)) })),
  })).filter((s: any) => s.data.some((p: any) => p.y)), [cfg.sel, mensal, meses])

  // ── composição do resultado
  const composicao = useMemo(() => partes.map(id => ({ linha: String(nome(id)).slice(0, 26), valor: Math.round(val(base, id)) }))
    .filter(x => x.valor).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).reverse(), [partes, base])

  const alt = (n: number) => Math.max(220, n * 30 + 60)
  const cx: any = { background: 'var(--chart-bg)', borderRadius: 10, padding: 8 }

  return (
    <>
      <div style={S.sec}>
        <div style={S.secH}>
          <div><div style={S.secT}>Linhas do relatório</div>
            <div style={S.secD}>
              Para acompanhar linhas que <strong>não são indicador</strong> — receita bruta, despesas totais, um subtotal.
              Orçado de {rotuloBase}; o Δ compara com {rotuloComp}.
            </div></div>
          <button style={{ ...S.sel, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setPickLinha(true)} data-noexport>
            <ListChecks size={13} /> Escolher{linhaSel.length ? ` (${linhaSel.length})` : ''}
          </button>
        </div>
        {!cardsLinha.length ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Nenhuma linha escolhida. Use <strong>Escolher</strong> — são centenas de linhas, então nada aparece até você dizer quais interessam.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {cardsLinha.map((l: LinhaRel) => <CardLinha key={l.id} l={l} {...cardPropsLinha} />)}
          </div>
        )}
      </div>

      <div style={S.sec}>
        <div style={S.secH}>
          <div><div style={S.secT}>Indicadores do orçamento</div>
            <div style={S.secD}>
              As medidas que a <strong>estrutura do relatório</strong> já define, com o valor orçado de {rotuloBase}.
              O Δ compara com {rotuloComp}. <span style={{ color: 'var(--faint)' }}>Arraste um card para reordenar.</span>
            </div></div>
          <button style={{ ...S.sel, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setPick(true)} data-noexport>
            <ListChecks size={13} /> Escolher{indicSel.length ? ` (${indicSel.length})` : ''}
          </button>
        </div>
        {!cards.length ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Este relatório não tem linhas de indicador ou fórmula. Crie-as em <strong>Estruturas de relatórios</strong> e elas aparecem aqui.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
            {cards.map((l: LinhaRel) => <CardLinha key={l.id} l={l} {...cardProps} />)}
          </div>
        )}
      </div>

      <div style={S.sec}>
        <div style={S.secH}>
          <div><div style={S.secT}>O ano, mês a mês</div>
            <div style={S.secD}>
              Orçado de {rotuloBase} nas linhas escolhidas. Linha reta o ano inteiro costuma ser
              <strong> total anual dividido por doze</strong>, não sazonalidade.
            </div></div>
          <SelLinhas cfg={cfg} setCfg={setCfg} linhas={linhas} />
        </div>
        {!evolucao.length ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>Sem valor nas linhas escolhidas.</div> : (
          <div style={{ ...cx, height: 300 }}>
            <ResponsiveLine theme={nivoTheme()} data={evolucao} margin={{ top: 10, right: 150, bottom: 40, left: 72 }}
              xScale={{ type: 'point' }} yScale={{ type: 'linear', stacked: false }}
              axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} enablePoints pointSize={5} useMesh
              colors={{ scheme: 'set2' }} enableGridX={false}
              legends={[{ anchor: 'right', direction: 'column', translateX: 140, itemWidth: 130, itemHeight: 18, symbolSize: 9, itemTextColor: 'var(--text-mid)' }]}
              tooltip={({ point }: any) => (
                <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 9px', fontSize: 12 }}>
                  <strong>{point.serieId}</strong> · {point.data.x}: {fmt(Number(point.data.y))}
                </div>)} />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <div style={S.sec}>
          <div style={S.secH}><div>
            <div style={S.secT}>De que o resultado é feito</div>
            <div style={S.secD}>Componentes de <strong>{alvo ? alvo.descricao : '—'}</strong>, derivados da estrutura.</div>
          </div></div>
          {!composicao.length ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>Escolha a linha de resultado na seção acima.</div> : (
            <div style={{ ...cx, height: alt(composicao.length) }}>
              <ResponsiveBar theme={nivoTheme()} data={composicao} keys={['valor']} indexBy="linha"
                layout="horizontal" margin={{ top: 6, right: 24, bottom: 34, left: 170 }}
                colors={({ data }: any) => (data.valor >= 0 ? '#2f9e44' : '#e03131')}
                axisBottom={{ format: (v: any) => fmtEixo(Number(v)), tickValues: 5 }} enableGridY={false}
                labelSkipWidth={44} label={(d: any) => fmt(Number(d.value))} />
            </div>
          )}
        </div>

        <div style={S.sec}>
          <div style={S.secH}>
            <div>
              <div style={S.secT}>Por empresa</div>
              <div style={S.secD}>{alvoEmp ? alvoEmp.descricao : '—'} orçado em {rotuloBase}, por empresa.</div>
            </div>
            <select style={{ ...S.sel, maxWidth: 220 }} value={empLinha} onChange={(e: any) => setEmpLinha(e.target.value)} data-noexport
              title="Qual linha abrir por empresa — resultado, EBITDA, receita…">
              <option value="">(linha de resultado)</option>
              {linhasEmp.map((l: LinhaRel) => <option key={l.id} value={l.id}>{l.descricao}</option>)}
            </select>
          </div>
          {!porEmp.length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {!alvoEmp
                ? <>Escolha a linha no seletor acima — é ela que este gráfico abre por empresa.</>
                : <>Sem valor de <strong>{alvoEmp.descricao}</strong> por empresa nos filtros atuais.</>}
            </div>
          ) : (
            <div style={{ ...cx, height: alt(porEmp.length) }}>
              <ResponsiveBar theme={nivoTheme()} data={porEmp} keys={['valor']} indexBy="empresa"
                layout="horizontal" margin={{ top: 6, right: 24, bottom: 34, left: 150 }}
                colors={({ data }: any) => (data.valor >= 0 ? '#5f3dc4' : '#e03131')}
                axisBottom={{ format: (v: any) => fmtEixo(Number(v)), tickValues: 5 }} enableGridY={false}
                labelSkipWidth={44} label={(d: any) => fmt(Number(d.value))} />
            </div>
          )}
        </div>
      </div>

      <div style={S.sec}>
        <div style={S.secH}><div>
          <div style={S.secT}>Receitas × Despesas ao longo do ano</div>
          <div style={S.secD}>Orçado de {rotuloBase}, pelas folhas do relatório. Despesa mostrada positiva.</div>
        </div></div>
        {!porArea.mes?.[0]?.data?.length ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>Sem dado por centro de custo no período.</div> : (
          <div style={{ ...cx, height: 290 }}>
            <ResponsiveLine theme={nivoTheme()} data={porArea.mes} margin={{ top: 10, right: 110, bottom: 40, left: 72 }}
              xScale={{ type: 'point' }} yScale={{ type: 'linear' }} axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }}
              colors={['#2f9e44', '#e03131']} enablePoints pointSize={5} useMesh enableGridX={false}
              legends={[{ anchor: 'right', direction: 'column', translateX: 100, itemWidth: 90, itemHeight: 18, symbolSize: 9, itemTextColor: 'var(--text-mid)' }]}
              tooltip={({ point }: any) => (
                <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 7, padding: '6px 9px', fontSize: 12 }}>
                  <strong>{point.serieId}</strong> · {point.data.x}: {fmt(Number(point.data.y))}
                </div>)} />
          </div>
        )}
      </div>

      {([
        ['Receitas por área', 'rec', 'area', '#2f9e44'],
        ['Despesas por área', 'desp', 'area', '#e8590c'],
        ['Receitas por centro de custo', 'ccRec', 'cc', '#2f9e44'],
        ['Despesas por centro de custo', 'ccDesp', 'cc', '#e8590c'],
      ] as const).map(([titulo, chave, idx, cor]) => {
        const dados = (porArea as any)[chave] as any[]
        if (!dados?.length) return null
        return (
          <div key={chave} style={S.sec}>
            <div style={S.secH}><div>
              <div style={S.secT}>{titulo}</div>
              <div style={S.secD}>Orçado de {rotuloBase}. <span style={{ color: 'var(--violet)' }}>Clique numa barra para abrir a linha do relatório e chegar ao razão.</span></div>
            </div></div>
            <div style={{ ...cx, height: alt(dados.length) }}>
              <ResponsiveBar theme={nivoTheme()} data={dados} keys={['Orçado']} indexBy={idx}
                layout="horizontal" margin={{ top: 6, right: 24, bottom: 34, left: 160 }}
                colors={cor} enableGridY={false} axisBottom={{ format: (v: any) => fmtEixo(Number(v)), tickValues: 5 }}
                labelSkipWidth={44} label={(d: any) => fmt(Number(d.value))}
                onClick={(d: any) => {
                  // "Sem CC" e "Sem área" agrupam lançamentos com cc_id NULO —
                  // não há lista de CCs para recortar o drill. Abrir mesmo
                  // assim mostraria o relatório INTEIRO, que é pior que não
                  // abrir: parece que aquela barra contém tudo aquilo.
                  if (!d.data._ccs?.length) { setSemCC({ rotulo: String(d.data[idx]), valor: Number(d.data['Orçado']) || 0 }); return }
                  const no = raizDe(chave === 'rec' || chave === 'ccRec' ? 'RECEITA' : 'DESPESA') || cfg.resultado
                  if (no) setDrill({ nodeId: no, ccFilter: d.data._ccs })
                }} />
            </div>
          </div>
        )
      })}

      {semCC && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }} onClick={() => setSemCC(null)}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 22, width: 480, maxWidth: '94vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e: any) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{semCC.rotulo} — {fmt(semCC.valor)}</div>
            <div style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6 }}>
              Estes valores foram orçados <strong>sem centro de custo</strong> (<code>cc_id</code> nulo). A grade de Orçar
              permite lançar por empresa e filial sem descer ao CC, e a importação de baseline aceita a coluna vazia —
              então não é defeito por si, mas é despesa sem dono.
              <br /><br />
              O drill não abre aqui de propósito: sem lista de centros de custo ele mostraria o relatório inteiro,
              e pareceria que esta barra contém tudo aquilo.
              <br /><br />
              Para ver o que há dentro, rode <code>diagnostico_orcado_sem_cc.sql</code> — ele abre por conta,
              por empresa/filial e por <strong>origem</strong>, que é o que diz onde corrigir: digitado na tela,
              vindo de formulário, do motor da folha ou do arquivo de baseline.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={{ ...S.sel, cursor: 'pointer', borderColor: 'var(--violet)', color: 'var(--violet)' }} onClick={() => setSemCC(null)}>Entendi</button>
            </div>
          </div>
        </div>
      )}

      {pick && <PickerLinhas titulo="Indicadores no painel" candidatos={candidatos} sel={indicSel} setSel={setIndicSel} fechar={() => setPick(false)}
        nota="A ordem desta lista é a ordem dos cards. Sem nenhum escolhido, aparecem todos na ordem da estrutura — que vem embaralhada, porque na DRE cada indicador fica perto da sua seção." />}
      {pickLinha && <PickerLinhas titulo="Linhas no painel" candidatos={linhasCard} sel={linhaSel} setSel={setLinhaSel} fechar={() => setPickLinha(false)}
        nota="A ordem desta lista é a ordem dos cards. Aqui nada aparece até você escolher — são centenas de linhas." />}
    </>
  )
}

// ============================================================
/**
 * Tabela das seções: rola, ordena por coluna e exporta.
 *
 * `bruto` separa o que se VÊ do que se ORDENA e EXPORTA — a célula mostra
 * "+15.769.414" formatado, mas ordenar por texto poria "+9" depois de "+15",
 * e o Excel receberia string em vez de número.
 */
type Col = {
  key: string; label: string; num?: boolean
  render?: (r: any) => any
  bruto?: (r: any) => any
}
function Tabela({ S, cols, rows, arquivo, rodape, maxH = 430 }: {
  S: any; cols: Col[]; rows: any[]; arquivo: string; rodape?: any; maxH?: number
}) {
  const [ord, setOrd] = useState<{ k: string; dir: 1 | -1 } | null>(null)
  const bruto = (c: Col, r: any) => (c.bruto ? c.bruto(r) : r[c.key])
  const linhas = useMemo(() => {
    if (!ord) return rows
    const c = cols.find(x => x.key === ord.k)
    if (!c) return rows
    return [...rows].sort((a, b) => {
      const va = bruto(c, a), vb = bruto(c, b)
      if (c.num) return ((Number(va) || 0) - (Number(vb) || 0)) * ord.dir
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * ord.dir
    })
  }, [rows, ord, cols])

  const exportar = () => downloadSheet(`${arquivo}.xlsx`,
    [cols.map(c => c.label), ...linhas.map(r => cols.map(c => bruto(c, r)))])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }} data-noexport>
        <button onClick={exportar} title="Baixar esta tabela como planilha"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: 11.5, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text-mid)', cursor: 'pointer' }}>
          <Download size={12} /> planilha
        </button>
      </div>
      <div style={{ maxHeight: maxH, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {cols.map(c => {
                const ativo = ord?.k === c.key
                return (
                  <th key={c.key} onClick={() => setOrd(o => o?.k === c.key ? (o.dir === -1 ? { k: c.key, dir: 1 } : null) : { k: c.key, dir: -1 })}
                    title="Clique para ordenar"
                    style={{ ...S.th, textAlign: c.num ? 'right' : 'left', cursor: 'pointer', userSelect: 'none',
                             position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1,
                             color: ativo ? 'var(--violet)' : undefined }}>
                    {c.label}
                    {ativo && (ord!.dir === -1 ? <ChevronDown size={11} style={{ verticalAlign: -1 }} /> : <ChevronUp size={11} style={{ verticalAlign: -1 }} />)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((r, i) => (
              <tr key={r.id ?? i} style={r._fraco ? { opacity: .62 } : undefined}>
                {cols.map(c => (
                  <td key={c.key} style={{ ...S.td, textAlign: c.num ? 'right' : 'left', fontFamily: c.num ? 'monospace' : 'inherit' }}>
                    {c.render ? c.render(r) : bruto(c, r)}
                  </td>
                ))}
              </tr>
            ))}
            {rodape}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Aviso({ tom, children }: { tom: 'alerta' | 'info'; children: any }) {
  const cor = tom === 'alerta' ? 'var(--orange)' : 'var(--muted)'
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 14px', marginBottom: 12, fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-mid)', background: 'var(--bg-soft)', border: `1px solid ${tom === 'alerta' ? 'var(--orange)' : 'var(--border)'}`, borderRadius: 10 }}>
      {tom === 'alerta' ? <AlertTriangle size={14} style={{ color: cor, flexShrink: 0, marginTop: 2 }} />
                        : <Info size={14} style={{ color: cor, flexShrink: 0, marginTop: 2 }} />}
      <span>{children}</span>
    </div>
  )
}

/** Um CORTE da árvore que é uma PARTIÇÃO: nada se repete, nada se perde.
 *
 *  ⚠⚠ É o que torna um ranking somável. "O que mudou" misturava níveis, então
 *  `Despesas` e `Despesas com Pessoal` apareciam na mesma lista e o leitor
 *  somava o mesmo dinheiro duas vezes sem perceber. Numa PONTE o problema é
 *  o mesmo e o resíduo denuncia; num RANKING não há resíduo que denuncie.
 *
 *  O corte no nível N são as linhas de profundidade N **mais as folhas acima
 *  dele** — sem as folhas, dinheiro de um ramo curto sumiria da lista.
 *  `'folhas'` é o grão de lançamento, qualquer que seja a profundidade.
 *
 *  ⚠ A profundidade sai do `pai_id`, nunca da coluna `nivel`: ela é **1 em
 *  todas as 170 linhas** desta DRE — não é mantida.
 */
/** Grupo de botões segmentado — UM componente para os dois cartões.
 *  ⚠ Existe para a ponte e o "O que mudou" não divergirem visualmente na
 *  primeira alteração. O que difere entre eles é o SIGNIFICADO do nível
 *  (cumulativo × partição), e isso se explica no texto de cada cartão, não
 *  na aparência do botão. */
// ⚠⚠ O CORTE É COMPARTILHADO por *O que mudou* e *Acurácia*, e não por economia
// de linhas: os dois são RANKINGS, e ranking de itens que se contêm é dupla
// contagem por construção (`Despesas` junto com `Despesas com Pessoal`). A
// regra que evita isso é uma partição em nível — se cada cartão tivesse a sua
// cópia, a primeira alteração deixaria um dos dois contando duas vezes, em
// silêncio. A *ponte* fica fora: lá o nível é cumulativo e o resíduo denuncia.
function useCorte(linhas: LinhaRel[], aba: string, nivel: number | 'folhas', nat: string) {
  // Natureza EFETIVA: a própria, ou herdada do pai — a mesma regra de
  // `fatorExibicao`. `NEUTRO` não interrompe a herança; ausência de natureza
  // em toda a cadeia é que faz a linha ser neutra de verdade.
  const natEf = useMemo(() => {
    const byId: Record<string, LinhaRel> = Object.fromEntries(linhas.map(l => [l.id, l]))
    const f = (id: string | null): string | null => {
      if (!id) return null
      const l = byId[id]; if (!l) return null
      return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : f(l.pai_id)
    }
    return f
  }, [linhas])

  const ehInd = useMemo(() => {
    const t: Record<string, string> = Object.fromEntries(linhas.map(l => [l.id, l.tipo_linha || '']))
    return (id: string) => t[id] === 'INDICADOR'
  }, [linhas])

  // ⚠ Indicador NÃO entra no corte de nível: os 23 desta DRE são todos nível 1,
  // então o botão não os afeta — e ali o recorte é a própria aba.
  const conjunto = useMemo(() => aba === 'INDIC'
    ? linhas.filter(l => l.tipo_linha === 'INDICADOR' && !l.desativada).map(l => l.id)
    : particaoNivel(linhas, nivel)
        .filter(id => !ehInd(id))
        // ⚠ Só recorta quando se PEDE. "Todas" inclui as neutras — e elas não
        // são sobra: no nível 1 são `Impostos s/ faturamento`, `Resultado
        // Financeiro`, `Impostos sobre o Resultado`, `Receita Liquida`.
        // Dinheiro de verdade que uma pílula de dois estados esconderia.
        .filter(id => nat === 'TODAS' || natEf(id) === nat),
    [linhas, aba, nivel, nat, natEf, ehInd])

  // Quantas ficam de fora pelo recorte de natureza — para a tela dizer, em vez
  // de a lista simplesmente encolher.
  const foraPorNat = useMemo(() => {
    if (aba === 'INDIC' || nat === 'TODAS') return 0
    return particaoNivel(linhas, nivel).filter(id => !ehInd(id) && natEf(id) !== nat).length
  }, [linhas, aba, nivel, nat, natEf, ehInd])

  return { conjunto, foraPorNat }
}

/** A barra de seletores dos dois rankings. Uma só, para não divergirem. */
function BarraCorte({ S, aba, setAba, nivel, setNivel, nat, setNat, cfg, setCfg, n }: any) {
  const inp = { width: 46, padding: '3px 5px', fontSize: 11.5, background: 'var(--bg)',
                color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6 }
  return (
    <div style={S.secBarra} data-noexport>
      <Grupo opcoes={ABAS} valor={aba} onPick={setAba} />
      {/* ⚠ Nível e natureza só na aba Linhas: os 23 indicadores são todos nível
          1 (o botão não mudaria nada) e 20 deles são neutros ("Receita" daria
          lista vazia). Controle morto ensina que a tela às vezes não responde. */}
      {aba === 'LINHA' && <Grupo rotulo="nível" valor={nivel} onPick={setNivel} opcoes={NIVEIS} />}
      {aba === 'LINHA' && <Grupo opcoes={NATS} valor={nat} onPick={setNat} />}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
        ≥<input type="number" step="1" min={0} value={cfg.pct}
          onChange={e => setCfg({ ...cfg, pct: Number(e.target.value) })} style={inp} />%
        e ≥<input type="number" step="0.1" min={0} value={cfg.minPctTotal}
          onChange={e => setCfg({ ...cfg, minPctTotal: Number(e.target.value) })} style={inp} />% do total
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{n} linha(s)</span>
    </div>
  )
}

/** Mantém `cfg.sel` igual ao conjunto calculado. `cfg` fora das dependências:
 *  ele muda a cada `setCfg` e o efeito voltaria a disparar — laço. */
function useSincronizaSel(cfg: SecCfg, setCfg: (c: SecCfg) => void, conjunto: string[]) {
  useEffect(() => {
    if ([...cfg.sel].sort().join(',') !== [...conjunto].sort().join(',')) setCfg({ ...cfg, sel: conjunto })
  }, [conjunto]) // eslint-disable-line
}

function particaoNivel(linhas: LinhaRel[], nivel: number | 'folhas'): string[] {
  const temFilha = new Set(linhas.map(l => l.pai_id).filter(Boolean) as string[])
  const prof = profDe(linhas)
  return linhas
    .filter(l => !l.desativada)
    .filter(l => nivel === 'folhas' ? !temFilha.has(l.id)
                                    : prof(l) === nivel || (prof(l) < nivel && !temFilha.has(l.id)))
    .map(l => l.id)
}

/** Seletor de linhas da seção, em ordem de ÁRVORE (ver emArvore). */
function SelLinhas({ cfg, setCfg, linhas, limiar }: { cfg: SecCfg; setCfg: (c: SecCfg) => void; linhas: LinhaRel[]; limiar?: boolean }) {
  const [aberto, setAberto] = useState(false)
  // ⚠ RASCUNHO enquanto aberto. Antes cada clique chamava `setCfg`, e cada
  // chamada recalculava a ponte inteira: marcar seis componentes custava seis
  // recálculos, cinco deles de estados intermediários que ninguém pediu — e o
  // gráfico pulava a cada um. Pior nos campos de limiar, que recalculavam a
  // cada TECLA (digitar "15" passava por "1").
  // O rascunho também protege de uma coisa mais sutil: estado intermediário de
  // ponte é quase sempre INCOERENTE — tirar o subtotal antes de pôr as filhas
  // dispara o alerta de resíduo no meio do caminho, assustando sem motivo.
  const [rascunho, setRascunho] = useState<SecCfg | null>(null)
  const c = rascunho ?? cfg
  const mudar = (novo: SecCfg) => setRascunho(novo)

  const abrir = () => { setRascunho(cfg); setAberto(true) }
  const aplicar = () => {
    setAberto(false)
    if (rascunho && JSON.stringify(rascunho) !== JSON.stringify(cfg)) setCfg(rascunho)
    setRascunho(null)
  }
  const pendente = !!rascunho && JSON.stringify(rascunho) !== JSON.stringify(cfg)

  const ok = useMemo(() => new Set(linhasConciliaveis(linhas).map((l: any) => l.id)), [linhas])
  const arv = useMemo(() => emArvore(linhas as any).filter((l: any) => ok.has(l.id)), [linhas, ok])
  // ⚠⚠ INDICADOR E FÓRMULA NÃO SÃO LINHA DE ORÇAMENTO, e misturá-los na mesma
  // lista não é só desarrumação. Na DRE Gerencial são 142 linhas de relatório
  // (analíticas e subtotais) contra 27 indicadores — e entre os indicadores há
  // PERCENTUAIS. Marcar "% EBITDA" junto com "Marketing" numa ponte soma
  // pontos percentuais com reais; na tabela de variação, ordena um Δ de −7,5
  // pontos junto de um Δ de R$ 1,38 milhão. São grandezas diferentes na mesma
  // coluna.
  // ⚠ Separar também conserta o "marcar todas": marcar tudo numa lista única
  // levaria os percentuais junto, e o botão que existe para poupar trabalho
  // passaria a criar um erro.
  const ehIndic = (l: any) => l.tipo_linha === 'INDICADOR' || l.tipo_linha === 'FORMULA'
  const arvLinhas = useMemo(() => arv.filter((l: any) => !ehIndic(l)), [arv])
  const arvIndic = useMemo(() => arv.filter(ehIndic), [arv])

  // ── SEÇÕES: "só esta" × "as filhas", e nunca as duas ─────────────────────
  // ⚠⚠ É O PAR QUE IMPORTA, não o atalho. Marcar a subárvore inteira pouparia
  // cliques e QUEBRARIA A PONTE por construção: subtotal junto com filha conta
  // a mesma variação duas vezes — é o primeiro aviso do texto da seção. Por
  // isso as duas ações são mutuamente excludentes: "só esta" tira os
  // descendentes, "as filhas" tira o pai.
  // ⚠ "as filhas" são as FILHAS DIRETAS, e tira os netos junto: filha + neta
  // tem o mesmo problema um nível abaixo.
  const filhasDe = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const l of arv as any[]) if (l.pai_id) (m[l.pai_id] ||= []).push(l.id)
    return m
  }, [arv])
  const descendentes = (id: string): string[] => {
    const out: string[] = []
    const vai = (x: string) => { for (const f of (filhasDe[x] || [])) { out.push(f); vai(f) } }
    vai(id); return out
  }
  const soEsta = (id: string) => {
    const fora = new Set(descendentes(id))
    mudar({ ...c, sel: [...new Set([...c.sel.filter(x => !fora.has(x)), id])] })
  }
  const asFilhas = (id: string) => {
    const fora = new Set([id, ...descendentes(id)])
    mudar({ ...c, sel: [...new Set([...c.sel.filter(x => !fora.has(x)), ...(filhasDe[id] || [])])] })
  }
  return (
    <div style={{ position: 'relative' }} data-noexport>
      <button onClick={() => aberto ? aplicar() : abrir()}
        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text-mid)', cursor: 'pointer' }}>
        {c.sel.length} linha(s){limiar ? ` · ≥${c.pct}% e ≥${c.minPctTotal}% do total` : ''} ▾
      </button>
      {aberto && (
        <>
          {/* Clicar fora é o gesto natural de "terminei" — e aplica. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={aplicar} />
          <div style={{ position: 'absolute', top: 32, right: 0, zIndex: 41, width: 360, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
            {limiar && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <label style={{ flex: 1, fontSize: 11, color: 'var(--muted)' }} title="0 = sem filtro">variação ≥
                  <input type="number" min={0} value={c.pct} onChange={e => mudar({ ...c, pct: Number(e.target.value) })}
                    style={{ width: '100%', marginTop: 3, padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} /> %
                </label>
                {/* Auto-escalar: limiar fixo em R$ está errado em alguma seção
                    por definição — receita e despesa de viagem não cabem no
                    mesmo número. */}
                <label style={{ flex: 1, fontSize: 11, color: 'var(--muted)' }} title="0 = sem filtro">e ≥ % do total
                  <input type="number" step="0.1" min={0} value={c.minPctTotal} onChange={e => mudar({ ...c, minPctTotal: Number(e.target.value) })}
                    style={{ width: '100%', marginTop: 3, padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
                </label>
              </div>
            )}
            {/* ⚠ "Analisar o resultado inteiro" era marcar 32 caixas na mão, uma a
                uma — e quem desiste no meio fica com uma análise que parece
                completa e não é. `arv` já é a lista FILTRADA (conciliáveis, sem
                desativadas), então "todas" marca o que faz sentido comparar, não
                tudo o que existe. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => mudar({ ...c, sel: arvLinhas.map((l: any) => l.id) })}
                title="Só as linhas do relatório — indicadores e percentuais ficam de fora, porque não somam com reais"
                style={{ padding: '3px 9px', fontSize: 11.5, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'transparent', color: 'var(--violet)', cursor: 'pointer' }}>
                Marcar as {arvLinhas.length} linhas
              </button>
              <button onClick={() => mudar({ ...c, sel: [] })}
                style={{ padding: '3px 9px', fontSize: 11.5, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                Nenhuma
              </button>
              {limiar && (c.pct > 0 || c.minPctTotal > 0) && (
                <>
                  <div style={{ flex: 1 }} />
                  {/* O limiar já se desliga pondo 0 nos dois campos — só não
                      havia como descobrir isso olhando a tela. */}
                  <button onClick={() => mudar({ ...c, pct: 0, minPctTotal: 0 })}
                    title="Zera os dois limiares: toda linha marcada aparece, sem filtro de relevância"
                    style={{ padding: '3px 9px', fontSize: 11.5, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'transparent', color: 'var(--violet)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    sem limiar
                  </button>
                </>
              )}
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {[{ t: 'LINHAS DO RELATÓRIO', ls: arvLinhas, ind: false },
                { t: 'INDICADORES E FÓRMULAS', ls: arvIndic, ind: true }].map(g => g.ls.length === 0 ? null : (
                <Fragment key={g.t}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'var(--muted)' }}>{g.t}</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    <span style={{ fontSize: 10.5, color: 'var(--violet)', cursor: 'pointer' }}
                      onClick={() => {
                        const ids = g.ls.map((l: any) => l.id)
                        const todos = ids.every((i: string) => c.sel.includes(i))
                        mudar({ ...c, sel: todos ? c.sel.filter(x => !ids.includes(x)) : [...new Set([...c.sel, ...ids])] })
                      }}>
                      {g.ls.every((l: any) => c.sel.includes(l.id)) ? 'desmarcar' : `marcar ${g.ls.length}`}
                    </span>
                  </div>
                  {g.ls.map((l: any) => (
                    <label key={l.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: '3px 4px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}>
                      <input type="checkbox" checked={c.sel.includes(l.id)} style={{ marginTop: 2, flexShrink: 0 }}
                        onChange={() => mudar({ ...c, sel: c.sel.includes(l.id) ? c.sel.filter(x => x !== l.id) : [...c.sel, l.id] })} />
                      <span style={{ paddingLeft: (g.ind ? 0 : l.prof * 13), fontWeight: !g.ind && l.prof === 0 ? 600 : 400 }}>
                        {l.descricao}
                        {/* ⚠ O % é o que mais engana: some com reais e ninguém vê. */}
                        {l.formato === 'PERCENTUAL' && <span style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 700, color: 'var(--orange)', border: '1px solid var(--orange)', borderRadius: 3, padding: '0 3px' }} title="é percentual — não soma com valores em reais">%</span>}
                      </span>
                      {!g.ind && (filhasDe[l.id] || []).length > 0 && (
                        <>
                          <span style={{ flex: 1 }} />
                          <span onClick={e => { e.preventDefault(); soEsta(l.id) }}
                            title="Marca só o subtotal e tira as filhas — a visão de topo"
                            style={{ fontSize: 10, color: 'var(--violet)', whiteSpace: 'nowrap', cursor: 'pointer' }}>só esta</span>
                          <span style={{ fontSize: 10, color: 'var(--border-strong)' }}>·</span>
                          <span onClick={e => { e.preventDefault(); asFilhas(l.id) }}
                            title={`Marca as ${(filhasDe[l.id] || []).length} filhas e tira o subtotal — o detalhe que decompõe`}
                            style={{ fontSize: 10, color: 'var(--violet)', whiteSpace: 'nowrap', cursor: 'pointer' }}>as {(filhasDe[l.id] || []).length} filhas</span>
                        </>
                      )}
                    </label>
                  ))}
                </Fragment>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11.5, color: pendente ? 'var(--violet)' : 'var(--muted)' }}>
                {c.sel.length} selecionada(s){pendente ? ' · ainda não aplicado' : ''}
              </span>
              <div style={{ flex: 1 }} />
              {pendente && (
                <button onClick={() => { setRascunho(cfg) }}
                  style={{ padding: '5px 10px', fontSize: 11.5, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
                  Descartar
                </button>
              )}
              <button onClick={aplicar}
                style={{ padding: '5px 12px', fontSize: 11.5, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
                         border: '1px solid ' + (pendente ? 'var(--violet)' : 'var(--border-strong)'),
                         background: pendente ? 'rgba(139,92,246,0.14)' : 'transparent',
                         color: pendente ? 'var(--violet)' : 'var(--text-mid)' }}>
                {pendente ? 'Aplicar' : 'Fechar'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── 1b · QUEM CAUSOU A VARIAÇÃO ─────────────────────────────
// A PONTE VISTA PELO OUTRO EIXO. A ponte decompõe o Δ por LINHA; este quadro
// decompõe **o mesmo Δ** por empresa, área, divisão, BU ou centro de custo.
// Mesma linha de resultado, mesmo total — dois cortes do mesmo número.
//
// POR QUE EXISTE: hoje responder "qual área estourou?" é marcar a área no
// filtro, ler, desmarcar, marcar a próxima. Cinco gestos por área e nenhuma
// comparação lado a lado — quem desiste no meio fica com metade da resposta.
//
// ⚠⚠ O MOTOR RODA POR DIMENSÃO, não se soma o agregado. A linha de resultado
// costuma ser FÓRMULA ou subtotal; somar `orcado` das folhas daria um número
// que não existe na DRE. Mesma razão e mesma mecânica do gráfico por empresa.
const DIMS_QUEM = [
  ['emp', 'Empresa'], ['area', 'Área'], ['divisao', 'Divisão'], ['bu', 'BU'], ['cc', 'Centro de custo'],
] as const
type DimQuem = typeof DIMS_QUEM[number][0]
const MAX_QUEM = 12

function QuemCausou({ S, linhas, nome, bruto, empresas, ccs, resId, componentes, invertido,
                      rotOrigem, rotDestino, dTotal, dim, setDim, ano }: any) {
  const [aberta, setAberta] = useState<string | null>(null)

  // Agrupa o bruto (empresa_id / cc_id) na dimensão pedida. Empresa e CC são
  // chaves diretas; área, divisão e BU são ATRIBUTOS do CC — é por isso que os
  // três saem da mesma leitura e trocar entre eles não custa consulta.
  const grupos = useMemo(() => {
    const out: Record<string, Record<string, { b: number; c: number }>> = {}
    const junta = (k: string, m: Record<string, { b: number; c: number }>) => {
      const alvo = (out[k] = out[k] || {})
      for (const master in m) {
        const cel = (alvo[master] = alvo[master] || { b: 0, c: 0 })
        cel.b += m[master].b; cel.c += m[master].c
      }
    }
    if (dim === 'emp') {
      const nomeEmp: Record<string, string> = {}
      ;(empresas as any[]).forEach(e => { nomeEmp[e.id] = `${e.codigo} · ${e.descricao}` })
      for (const id in bruto.emp) junta(nomeEmp[id] || '(empresa desconhecida)', bruto.emp[id])
    } else {
      const ccById: Record<string, CC> = Object.fromEntries((ccs as CC[]).map(c => [c.id, c]))
      // ⚠ "(sem …)" NÃO É DESCARTE. São as células de grão consolidado — cc
      // nulo —, e omiti-las faria a soma das áreas não bater com o total: o
      // quadro encolheria sem dizer por quê, que é a pior forma de errar.
      const rot = (ccId: string) => {
        const c = ccId === '__sem' ? null : ccById[ccId]
        if (!c) return '(sem centro de custo)'
        if (dim === 'cc') return `${c.codigo} · ${c.descricao}`
        const n = dim === 'area' ? c.area_nome : dim === 'divisao' ? c.divisao_nome : c.bu_nome
        return n || `(sem ${dim === 'area' ? 'área' : dim === 'divisao' ? 'divisão' : 'BU'})`
      }
      for (const id in bruto.cc) junta(rot(id), bruto.cc[id])
    }
    return out
  }, [bruto, dim, empresas, ccs])

  // Roda o motor dentro de cada grupo e devolve o total da linha de resultado
  // e o de cada componente — os mesmos componentes da ponte, para o detalhe de
  // uma área ser literalmente "a ponte daquela área".
  const linhasQ = useMemo(() => {
    if (!resId) return []
    const rlOf: Record<string, string> = {}
    linhas.forEach((l: LinhaRel) => { if (l.linha_orc_id && !l.nao_soma) rlOf[l.linha_orc_id] = l.id })
    const calc: LinhaCalc[] = linhas.map((l: LinhaRel) => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
    const PER: Periodo = { ano: ano || 1, mes: 1 }; const K = pkey(PER)
    const totaisDe = (lado: 'b' | 'c', m: Record<string, { b: number; c: number }>) => {
      const computed: Computed = {}; calc.forEach(l => { computed[l.id] = {} })
      for (const master in m) { const rl = rlOf[master]; if (rl) computed[rl][K] = m[master][lado] }
      return computeTotais(calc, computed, [PER])
    }
    return Object.entries(grupos).map(([k, m]) => {
      const tb = totaisDe('b', m), tc = totaisDe('c', m)
      // `invertido` = o cabeçalho pediu analisado → comparado. Origem e destino
      // só existem como leitura; o dado continua sendo "analisado" e "comparado".
      const o = (id: string) => (invertido ? tb[id] : tc[id]) || 0
      const d = (id: string) => (invertido ? tc[id] : tb[id]) || 0
      return {
        k, origem: o(resId), destino: d(resId), delta: d(resId) - o(resId),
        partes: (componentes as string[]).filter(id => id !== resId)
          .map(id => ({ id, nome: nome(id), delta: d(id) - o(id) }))
          .filter(x => Math.abs(x.delta) > 0.005)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      }
    }).filter(x => Math.abs(x.delta) > 0.005 || Math.abs(x.origem) > 0.005)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }, [grupos, linhas, resId, componentes, invertido, nome, ano])

  // ⚠⚠ ASSIMETRIA DE ATRIBUIÇÃO — medida, não suposta. Na DRE Gerencial de
  // 2026: **100% do orçado tem centro de custo e só 82% do realizado tem**
  // (18,2%, R$ 22 mi de 120,6 mi, são lançamentos do razão sem CC). Sem avisar,
  // a leitura por área sai assim: TODA área parece ter economizado, e o grupo
  // "(sem centro de custo)" aparece com orçado zero e um realizado enorme —
  // cada número está certo e a conclusão é falsa.
  // ⚠ Não é chute nem constante: sai do próprio bruto, em magnitude, então
  // acompanha o relatório, o período e o filtro de quem está olhando. Por
  // empresa não existe (empresa é NOT NULL nos dois fatos: 0 nulos medidos).
  const atribuicao = useMemo(() => {
    if (dim === 'emp') return null
    let bT = 0, cT = 0, bS = 0, cS = 0
    for (const id in bruto.cc) {
      const sem = id === '__sem' || !(ccs as CC[]).some(c => c.id === id)
      for (const master in bruto.cc[id]) {
        const { b, c } = bruto.cc[id][master]
        bT += Math.abs(b); cT += Math.abs(c)
        if (sem) { bS += Math.abs(b); cS += Math.abs(c) }
      }
    }
    if (!bT || !cT) return null
    const pb = (bS / bT) * 100, pc = (cS / cT) * 100
    // Dois pontos percentuais de diferença já bastam: abaixo disso o efeito
    // some no arredondamento das próprias linhas.
    return Math.abs(pb - pc) >= 2 ? { pb, pc } : null
  }, [bruto, dim, ccs])

  const somaDim = linhasQ.reduce((s: number, x: any) => s + x.delta, 0)
  // ⚠⚠ O RESÍDUO É A MESMA HONESTIDADE DA PONTE. A soma das dimensões pode não
  // fechar com o Δ do cabeçalho por três causas conhecidas: linha com
  // `filtro_escopo` próprio (o agregado por dimensão não o aplica), projeção
  // ligada (o quadro lê só o período real) e recorte de empresa entre as duas
  // RPCs. Mostrar sem o resíduo seria afirmar que tudo foi atribuído.
  const naoAtrib = (dTotal || 0) - somaDim
  const temResid = Math.abs(naoAtrib) > Math.max(1, Math.abs(dTotal || 0) * 0.005)
  const mostra = linhasQ.slice(0, MAX_QUEM)
  const resto = linhasQ.slice(MAX_QUEM)
  const somaResto = resto.reduce((s: number, x: any) => s + x.delta, 0)

  return (
    <div style={S.sec}>
      <div>
        <div><div style={S.secT}>Quem causou a variação</div>
          <div style={S.secD}>
            O <strong>mesmo Δ da ponte</strong>, decomposto pelo outro eixo: em vez de por linha,
            por empresa ou área. A linha de resultado é a que está selecionada na ponte — descer
            lá move este quadro junto. Clique numa linha para ver <em>o que</em> mudou ali.
            {' '}⚠ <strong>(sem centro de custo)</strong> reúne o que não tem onde cair; entra na
            lista para a soma fechar, em vez de encolher o quadro em silêncio.
          </div></div>
        <div style={S.secBarra} data-noexport>
          <Grupo opcoes={DIMS_QUEM} valor={dim} onPick={setDim} />
          <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {linhasQ.length} {dim === 'emp' ? 'empresa(s)' : dim === 'cc' ? 'centro(s)' : 'grupo(s)'}
          </span>
        </div>
      </div>
      {atribuicao && (
        <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 10, lineHeight: 1.6 }}>
          ⚠⚠ <strong>Os dois lados não estão igualmente atribuídos.</strong>{' '}
          <b>{rotOrigem}</b> tem {(invertido ? atribuicao.pb : atribuicao.pc).toFixed(1)}% do valor
          sem centro de custo e <b>{rotDestino}</b> tem
          {' '}{(invertido ? atribuicao.pc : atribuicao.pb).toFixed(1)}%. O lado menos atribuído
          chega às áreas <strong>menor do que é</strong> — e o excedente aparece inteiro em
          <em> (sem centro de custo)</em>. Com isso, quase toda área tende a parecer que
          economizou. Compare as áreas <strong>entre si</strong>, não contra o orçado delas,
          enquanto a amarração de centro de custo do realizado não fechar.
          {' '}Para localizar a origem, troque para <strong>Empresa</strong>: ali os dois lados
          estão sempre atribuídos, e o buraco costuma estar concentrado numa delas.
        </div>
      )}
      {!resId ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Escolha a linha de resultado na ponte.</div>
       : !linhasQ.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sem movimento nesta dimensão.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...S.th, textAlign: 'left' }}>{DIMS_QUEM.find(d => d[0] === dim)?.[1]}</th>
            <th style={S.th}>{rotOrigem}</th>
            <th style={S.th}>{rotDestino}</th>
            <th style={S.th}>efeito no resultado</th>
            <th style={S.th}>% do Δ</th>
          </tr></thead>
          <tbody>
            {mostra.map((x: any) => (
              <Fragment key={x.k}>
                <tr onClick={() => setAberta(aberta === x.k ? null : x.k)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>
                    <span data-noexport style={{ color: 'var(--violet)', marginRight: 6 }}>{aberta === x.k ? '▾' : '▸'}</span>
                    {x.k}
                  </td>
                  <td style={S.td}>{fmt(x.origem)}</td>
                  <td style={S.td}>{fmt(x.destino)}</td>
                  <td style={{ ...S.td, color: x.delta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {x.delta >= 0 ? '+' : ''}{fmt(x.delta)}
                  </td>
                  <td style={{ ...S.td, color: 'var(--muted)' }}>
                    {dTotal ? `${Math.round((x.delta / dTotal) * 100)}%` : '—'}
                  </td>
                </tr>
                {aberta === x.k && (
                  x.partes.length ? x.partes.map((p: any) => (
                    <tr key={p.id}>
                      <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', paddingLeft: 30, color: 'var(--muted)', fontSize: 12 }}>{p.nome}</td>
                      <td style={S.td} /><td style={S.td} />
                      <td style={{ ...S.td, fontSize: 12, color: p.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {p.delta >= 0 ? '+' : ''}{fmt(p.delta)}
                      </td>
                      <td style={S.td} />
                    </tr>
                  )) : (
                    <tr><td colSpan={5} style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', paddingLeft: 30, color: 'var(--muted)', fontSize: 12 }}>
                      Sem componentes com variação aqui.</td></tr>
                  )
                )}
              </Fragment>
            ))}
            {resto.length > 0 && (
              <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--muted)', fontStyle: 'italic' }}>
                outros {resto.length}</td>
                <td style={S.td} /><td style={S.td} />
                <td style={{ ...S.td, color: 'var(--muted)' }}>{somaResto >= 0 ? '+' : ''}{fmt(somaResto)}</td>
                <td style={S.td} /></tr>
            )}
            {temResid && (
              <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--orange)' }}
                    title="Linha com filtro de escopo próprio, projeção ligada ou recorte de empresa — o agregado por dimensão não os reproduz.">
                não atribuído a nenhum grupo</td>
                <td style={S.td} /><td style={S.td} />
                <td style={{ ...S.td, color: 'var(--orange)' }}>{naoAtrib >= 0 ? '+' : ''}{fmt(naoAtrib)}</td>
                <td style={S.td} /></tr>
            )}
            <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>total — {nome(resId)}</td>
              <td style={S.td} /><td style={S.td} />
              <td style={{ ...S.td, fontWeight: 700 }}>{(dTotal || 0) >= 0 ? '+' : ''}{fmt(dTotal || 0)}</td>
              <td style={S.td} /></tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── ANÁLISE PESSOAS ─────────────────────────────────────────
// Descreve UMA versão: quanto cada área custa de gente, quantas pessoas são e
// quanto isso pesa. Não compara nada — por isso é aba própria, e não seção da
// aba que julga o orçamento ou da que decompõe a variação.
//
// ⚠⚠ A UNIDADE É A PESSOA, NUNCA O POSTO. Posto duplica: pró-labore é pago por
// empresa do grupo, e a matrícula é por empresa — a Diretoria tem 11 postos e
// 6 pessoas. A RPC devolve o grão (área, regime, pessoa) e a contagem aqui é
// sempre de pessoa distinta.
//
// ⚠ Os dados vêm da FOTO (`fat_orcado`), não do cadastro. O cadastro muda a
// cada importação mensal e os gráficos deixariam de representar o planejamento
// — foi a pergunta do Ricardo que achou essa inconsistência. Consequência do
// rótulo: a foto conta **quem custa**, então posto de salário zero não aparece.
function VisaoPessoas({ S, linhas, erro, rotulo, ano }: any) {
  const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')
  const pct = (n: number) => `${n.toFixed(1)}%`

  const { areas, regimes, multiReg, totPess, totDesp, totGente } = useMemo(() => {
    const pes = linhas.filter((l: any) => l.tipo === 'PESSOA')
    const des = linhas.filter((l: any) => l.tipo === 'DESPESA')
    const porArea = new Map<string, { nome: string; custo: number; gente: Set<string>; desp: number }>()
    const get = (nome: string) => {
      let a = porArea.get(nome)
      if (!a) { a = { nome, custo: 0, gente: new Set(), desp: 0 }; porArea.set(nome, a) }
      return a
    }
    for (const l of pes) { const a = get(l.area_nome); a.custo += Number(l.valor) || 0; a.gente.add(l.pessoa) }
    for (const l of des) get(l.area_nome).desp += Number(l.valor) || 0
    const porReg = new Map<string, { custo: number; gente: Set<string> }>()
    for (const l of pes) {
      let r = porReg.get(l.regime); if (!r) { r = { custo: 0, gente: new Set() }; porReg.set(l.regime, r) }
      r.custo += Number(l.valor) || 0; r.gente.add(l.pessoa)
    }
    const areas = [...porArea.values()].map(a => ({ ...a, pessoas: a.gente.size })).sort((a, b) => b.custo - a.custo)
    const regimes = [...porReg.entries()].map(([k, v]) => ({ regime: k, custo: v.custo, pessoas: v.gente.size }))
      .sort((a, b) => b.custo - a.custo)
    // Quantas pessoas aparecem em MAIS DE UM regime — medido: 6, todas
    // prestador + pró-labore. É por elas que a coluna de % passa de 100%, e a
    // tela diz isso em vez de normalizar pela soma e esconder o fato.
    const regDe = new Map<string, Set<string>>()
    for (const l of pes) { let g = regDe.get(l.pessoa); if (!g) { g = new Set(); regDe.set(l.pessoa, g) } g.add(l.regime) }
    const multiReg = [...regDe.values()].filter(g => g.size > 1).length
    return {
      areas, regimes, multiReg,
      // ⚠ Pessoa distinta no TOTAL, não soma das áreas: se um dia alguém tiver
      // custo em duas áreas, somar os subtotais a contaria duas vezes.
      totPess: new Set(pes.map((l: any) => l.pessoa)).size,
      totDesp: des.reduce((t: number, l: any) => t + (Number(l.valor) || 0), 0),
      totGente: pes.reduce((t: number, l: any) => t + (Number(l.valor) || 0), 0),
    }
  }, [linhas])

  if (erro) return <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48, lineHeight: 1.7 }}>
    <strong style={{ color: 'var(--orange)' }}>A consulta não terminou</strong> — <i>{String(erro)}</i>.
    <br />Não é ausência de dado: nada foi lido. Estreite o período ou os filtros e tente de novo.</div>

  if (!areas.length) return <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48 }}>
    Sem orçado de pessoal nesta versão. Rode o <strong>Aplicar no orçado</strong> na tela de Postos.</div>

  const maxP = Math.max(...areas.map(a => a.pessoas), 1)
  const barra = (v: number, max: number, cor: string) => (
    <div style={{ height: 8, background: 'var(--bg-soft)', borderRadius: 99, overflow: 'hidden', minWidth: 60 }}>
      <div style={{ width: `${Math.max(1, v / max * 100)}%`, height: '100%', background: cor, borderRadius: 99 }} />
    </div>)

  return (
    <>
      {/* ── 1 · composição ── */}
      <div style={S.sec}>
        <div style={S.secH}><div>
          <div style={S.secT}>Quanto de cada área é gente</div>
          <div style={S.secD}>
            {rotulo} · {ano}. <strong>{pct(totGente / (totDesp || 1) * 100)}</strong> da despesa operacional da empresa é
            pessoal — {fmt(totGente)} de {fmt(totDesp)}.
            {' '}⚠ A barra compara cada área com a <strong>própria despesa</strong>: áreas que <em>são</em> gente
            (Serviços, Comercial) chegam perto de 90% por natureza, não por eficiência.
          </div></div></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...S.th, textAlign: 'left' }}>área</th>
            <th style={S.th}>pessoal</th>
            <th style={S.th} title="pessoal da área ÷ pessoal de TODA a empresa">% do pessoal</th>
            <th style={S.th}>despesa da área</th>
            <th style={{ ...S.th, width: 150 }}>% da própria área</th>
            <th style={S.th} title="pessoal da área ÷ despesa operacional da EMPRESA">% da despesa</th>
          </tr></thead>
          <tbody>
            {areas.map(a => (
              <tr key={a.nome}>
                <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>{a.nome}</td>
                <td style={S.td}>{fmt(a.custo)}</td>
                {/* Quanto da FOLHA da empresa está nesta área — pergunta
                    diferente de "% da despesa" (que divide pela despesa total)
                    e de "% da própria área" (que divide pela despesa dela). */}
                <td style={S.td}>{pct(a.custo / (totGente || 1) * 100)}</td>
                <td style={{ ...S.td, color: 'var(--muted)' }}>{fmt(a.desp)}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {barra(a.desp ? a.custo / a.desp * 100 : 0, 100, 'var(--violet)')}
                    <span style={{ minWidth: 48 }}>{a.desp ? pct(a.custo / a.desp * 100) : '—'}</span>
                  </div></td>
                <td style={S.td}>{pct(a.custo / (totDesp || 1) * 100)}</td>
              </tr>))}
            <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>total</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{fmt(totGente)}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{pct(100)}</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{fmt(totDesp)}</td>
              <td style={S.td} /><td style={{ ...S.td, fontWeight: 700 }}>{pct(totGente / (totDesp || 1) * 100)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── 2 · pessoas e custo médio ── */}
      <div style={S.sec}>
        <div style={S.secH}><div>
          <div style={S.secT}>Pessoas por área</div>
          <div style={S.secD}>
            {totPess} pessoas no orçado. ⚠ O número sozinho engana: o <strong>custo médio</strong> ao lado é o que
            diz se duas áreas do mesmo tamanho pesam igual. Conta <strong>pessoa</strong>, não posto — pró-labore é
            pago por empresa e duplicaria.
          </div></div></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...S.th, textAlign: 'left' }}>área</th>
            <th style={{ ...S.th, width: 180 }}>pessoas</th>
            <th style={S.th}>% das pessoas</th>
            <th style={S.th}>custo médio</th><th style={S.th}>pessoal</th>
          </tr></thead>
          <tbody>
            {areas.map(a => (
              <tr key={a.nome}>
                <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>{a.nome}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {barra(a.pessoas, maxP, 'var(--blue)')}
                    <span style={{ minWidth: 32 }}>{a.pessoas}</span>
                  </div></td>
                {/* O par com a coluna "pessoal" é o ponto: área com 57% da gente
                    e 56% do custo é equilibrada; 13% da gente com 27% do custo
                    não é — e sem o percentual de pessoas essa leitura exige
                    dividir de cabeça. */}
                <td style={S.td}>{pct(a.pessoas / (totPess || 1) * 100)}</td>
                <td style={S.td}>{a.pessoas ? fmt(a.custo / a.pessoas) : '—'}</td>
                <td style={{ ...S.td, color: 'var(--muted)' }}>{fmt(a.custo)}</td>
              </tr>))}
            <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>total</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{totPess}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{pct(100)}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{fmt(totGente / (totPess || 1))}</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{fmt(totGente)}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── 3 · regime ── */}
      <div style={S.sec}>
        <div style={S.secH}><div>
          <div style={S.secT}>Pessoas e custo por regime</div>
          <div style={S.secD}>
            {multiReg > 0 && <>
              ⚠ <strong>{multiReg} pessoa(s) têm dois regimes</strong> (prestador e pró-labore), então contam nos
              dois e a coluna <strong>% das pessoas</strong> passa de 100%. O denominador é o total de pessoas
              distintas, o mesmo do quadro acima.<br />
            </>}
            ⚠ A coluna <strong>por pessoa</strong> levanta uma pergunta e não a responde: a diferença entre regimes
            pode ser preço de contratação ou <strong>mistura de senioridade</strong> — um consultor sênior PJ contra
            um auxiliar CLT. Quem responde é a pirâmide de cargos, não este quadro.
          </div></div></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...S.th, textAlign: 'left' }}>regime</th><th style={S.th}>pessoas</th>
            <th style={S.th}>% das pessoas</th>
            <th style={{ ...S.th, width: 170 }}>custo</th><th style={S.th}>% do custo</th><th style={S.th}>por pessoa</th>
          </tr></thead>
          <tbody>
            {regimes.map(r => (
              <tr key={r.regime}>
                <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>{r.regime}</td>
                <td style={S.td}>{r.pessoas}</td>
                {/* ⚠ O denominador é o total de pessoas DISTINTAS (o mesmo do
                    resto da tela), não a soma da coluna. Quem tem dois regimes
                    conta nos dois, então o total passa de 100% — e isso é
                    informação, não defeito: normalizar pela soma esconderia
                    que existem pessoas em dois regimes. A nota acima diz
                    quantas são. */}
                <td style={S.td}>{pct(r.pessoas / (totPess || 1) * 100)}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    {barra(r.custo, Math.max(...regimes.map(x => x.custo), 1), 'var(--green)')}
                    <span style={{ minWidth: 76 }}>{fmt(r.custo)}</span>
                  </div></td>
                <td style={S.td}>{pct(r.custo / (totGente || 1) * 100)}</td>
                <td style={S.td}>{r.pessoas ? fmt(r.custo / r.pessoas) : '—'}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── 2 · VARIAÇÃO POR LINHA ──────────────────────────────────
// Limiar DUPLO: percentual E valor mínimo, juntos. 40% numa conta de R$ 800 é
// ruído; 3% na folha é a maior conversa do orçamento. Só o percentual enche a
// tela de bobagem; só o absoluto esconde a conta pequena que dobrou.
// ⚠ Mesma assinatura da Ponte: `origem`/`destino`, e quem decide é a página.
// O sentido vale para os DOIS — lá como narrativa, aqui como coluna e sinal.
function Variacao({ S, cfg, setCfg, linhas, nome, origem, destino, val, fac, rotOrigem, rotDestino,
                    aba, setAba, nivel, setNivel, nat, setNat }: any) {
  // ⚠⚠ O CONJUNTO VEM DO CORTE, não de escolha manual. Era a seleção livre que
  // deixava marcar `Despesas` junto com `Despesas com Pessoal` e produzir a
  // duplicata — num ranking, seleção à mão reintroduz exatamente o defeito.
  // `cfg.sel` continua sendo o armazenamento porque é ele que vai para o
  // preset do cartão; só deixou de ser digitado.
  const { conjunto, foraPorNat } = useCorte(linhas, aba, nivel, nat)
  useSincronizaSel(cfg, setCfg, conjunto)

  // O limiar foca a atenção; esconder o resto para sempre tira a conferência.
  const [todas, setTodas] = useState(false)
  // ⚠ O denominador do limiar é o DESTINO — o retrato final. No modo
  // Orçado × Orçado ele é o analisado, que é exatamente o que já era, então
  // trocar o sentido não remexe nos limiares de quem compara orçamentos.
  const total = cfg.sel.reduce((s: number, id: string) => s + Math.abs(val(destino, id)), 0)
  const minAbs = total * (cfg.minPctTotal / 100)
  // `b` = destino, `c` = origem: os nomes curtos ficaram, a semântica é a do
  // sentido escolhido no cabeçalho.
  const linhasCruas = cfg.sel.map((id: string) => {
    const b = val(destino, id), c = val(origem, id)
    return { id, nome: nome(id), b, c, d: b - c, pct: c !== 0 ? ((b - c) / Math.abs(c)) * 100 : (b !== 0 ? Infinity : 0) }
  })
  // ⚠ ZERO NOS DOIS PERÍODOS não é "variação pequena", é AUSÊNCIA de conteúdo:
  // a linha existe na estrutura e não foi orçada em nenhum dos lados. Com o
  // limiar em 0 — que é como se vê tudo — elas enchiam a lista e empurravam o
  // que importa para baixo. Sai sem perda: não há informação em 0 → 0.
  // ⚠ Epsilon e não `=== 0`: resíduo de arredondamento em fórmula não deve
  // ressuscitar uma linha vazia.
  const vazia = (x: any) => Math.abs(x.b) < 0.005 && Math.abs(x.c) < 0.005
  const nVazias = linhasCruas.filter(vazia).length
  const linhasTodas = linhasCruas.filter((x: any) => !vazia(x))
  // ⚠ A cor diz BOM ou RUIM, não positivo ou negativo. Numa despesa, cair é
  // bom: Custo Pessoas −9,8 mi pintado de vermelho lê ao contrário do que
  // aconteceu.
  //
  // `fac` serve aqui como SEMÂNTICA, não como sinal: fator −1 significa que a
  // linha é de natureza DESPESA (própria ou herdada do pai), ou seja, é custo.
  // E em custo o que é bom é ENCOLHER.
  //
  // Encolher é comparação de MAGNITUDE, de propósito. A primeira versão desta
  // regra olhava a direção do Δ, o que embute a suposição de que despesa está
  // guardada com valor negativo — e tem linha que não está: os INDICADOR de
  // Custo Pessoas e Folha montam o valor pela EXPRESSÃO, que devolve custo
  // positivo. Com a direção do Δ, a mesma linha dava vermelho nas DUAS
  // naturezas possíveis, porque regra e exibição concordavam entre si e
  // discordavam do dado. Magnitude não pergunta como o número foi guardado.
  //
  // As outras linhas — receita, e as neutras como EBITDA ou Resultado
  // Financeiro — não têm essa ambiguidade: valem mais quando sobem, e
  // `Resultado Financeiro` indo de −727 mil para −643 mil sobe de verdade.
  //
  // Limite conhecido: despesa que ATRAVESSA o zero no período (virar
  // recuperação) não é lida bem por magnitude. É patológico num custo e
  // preferível à suposição que já falhou.
  const ehCusto = (x: any) => fac?.(x.id) === -1
  const bom = (x: any) => (ehCusto(x) ? Math.abs(x.b) < Math.abs(x.c) : x.b > x.c)
  const marca = (x: any) => Math.abs(x.d) >= minAbs && (Math.abs(x.pct) >= cfg.pct || !Number.isFinite(x.pct))
  // ⚠⚠ INDICADOR ORDENA POR %, não por valor. Eles misturam unidades — `% EBITDA`
  // varia em pontos percentuais, `Custo Pessoas` em reais, `Receita por FTE` em
  // R$/FTE. Ordenar por variação absoluta compara grandezas diferentes e põe
  // sempre os de reais no topo, como se fossem os que mais mudaram.
  const ordem = aba === 'INDIC'
    ? (a: any, b: any) => (Number.isFinite(b.pct) ? Math.abs(b.pct) : Infinity) - (Number.isFinite(a.pct) ? Math.abs(a.pct) : Infinity)
    : (a: any, b: any) => Math.abs(b.d) - Math.abs(a.d)
  const destaque = linhasTodas.filter(marca).sort(ordem)
  const resto = linhasTodas.filter((x: any) => !marca(x))
  const somaResto = resto.reduce((s: number, x: any) => s + x.d, 0)
  const todas0 = linhasTodas.length

  return (
    <div style={S.sec}>
      <div>
        <div><div style={S.secT}>O que mudou</div>
          <div style={S.secD}>
            Ordenado por <strong>impacto</strong>, não por tamanho. Marcado o que passa de {cfg.pct}% <em>e</em> de {cfg.minPctTotal}% do total ({fmt(minAbs)}).
            {' '}<span style={{ color: 'var(--green)' }}>Verde</span> é melhora e <span style={{ color: 'var(--red)' }}>vermelho</span> é piora — numa despesa, cair é melhorar.
            {' '}⚠ Aqui o nível é um <strong>corte</strong>: <em>2</em> traz só o nível 2 e as folhas acima,
            nunca o nível 1 junto. É o que impede a lista de contar o mesmo dinheiro duas vezes —
            na <em>ponte</em> o mesmo botão é cumulativo.
            {' '}A variação é <strong>{rotDestino} − {rotOrigem}</strong>, no sentido escolhido no cabeçalho.
            {nVazias > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}· {nVazias} linha(s) zerada(s) nos dois períodos ficam de fora.
              </span>
            )}
            {foraPorNat > 0 && (
              <><br /><span style={{ color: 'var(--orange)' }}>
                {foraPorNat} linha(s) fora deste recorte de natureza — entre elas as <b>neutras</b>
                {' '}(impostos, resultado financeiro), que não são receita nem despesa na estrutura.
                {' '}Use <b>Todas</b> para vê-las.
              </span></>
            )}
            {resto.length > 0 && (
              <span data-noexport style={{ marginLeft: 8, color: 'var(--violet)', cursor: 'pointer' }} onClick={() => setTodas(v => !v)}>
                {todas ? `ver só as ${destaque.length} acima do limiar` : `mostrar todas as ${todas0} linhas`}
              </span>
            )}
          </div></div>
        <BarraCorte S={S} aba={aba} setAba={setAba} nivel={nivel} setNivel={setNivel}
          nat={nat} setNat={setNat} cfg={cfg} setCfg={setCfg} n={conjunto.length} />
      </div>
      <Tabela S={S} arquivo={`variacao-${rotDestino}`}
        rows={(todas ? [...destaque, ...resto.map((r: any) => ({ ...r, _fraco: true }))] : destaque)}
        cols={[
          { key: 'nome', label: 'linha' },
          { key: 'c', label: String(rotOrigem), num: true, render: (r: any) => fmt(r.c) },
          { key: 'b', label: String(rotDestino), num: true, render: (r: any) => fmt(r.b) },
          { key: 'd', label: 'variação', num: true,
            render: (r: any) => (
              <span style={{ color: r.d === 0 ? 'var(--muted)' : bom(r) ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}
                    title={r.d === 0 ? 'sem variação'
                      : `${bom(r) ? 'Melhora' : 'Piora'} o resultado · ${ehCusto(r) ? 'linha de despesa: vale pelo tamanho do custo, não pelo sinal' : 'vale mais quando sobe'}`}>
                {r.d >= 0 ? '+' : ''}{fmt(r.d)}
              </span>
            ) },
          { key: 'pct', label: '%', num: true, bruto: (r: any) => (Number.isFinite(r.pct) ? r.pct : null),
            render: (r: any) => <span style={{ color: 'var(--muted)' }}>{Number.isFinite(r.pct) ? fmtPct(r.pct) : 'novo'}</span> },
        ]}
        rodape={resto.length > 0 && !todas ? (
          <tr onClick={() => setTodas(true)} style={{ cursor: 'pointer' }} data-noexport>
            <td style={{ ...S.td, textAlign: 'left', color: 'var(--violet)', fontStyle: 'italic' }}>
              demais {resto.length} linha(s), abaixo do limiar — <strong>mostrar</strong></td>
            <td style={S.td} /><td style={S.td} />
            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{somaResto >= 0 ? '+' : ''}{fmt(somaResto)}</td>
            <td style={S.td} />
          </tr>
        ) : null} />
    </div>
  )
}

// ── 3 · ACURÁCIA DO ORÇAMENTO ANTERIOR ──────────────────────
// Não serve para julgar o passado: serve para CALIBRAR A CONFIANÇA no futuro.
// Linha que errou 12% e vem com número redondo e confiante merece pergunta.
function Acuracia({ S, cfg, setCfg, linhas, nome, orc, real, val, ano,
                    aba, setAba, nivel, setNivel, nat, setNat }: any) {
  // ⚠⚠ MESMO CORTE DE *O QUE MUDOU*, e pela mesma razão: a Acurácia é um
  // ranking por tamanho do erro, e a seleção livre deixava marcar `Despesas`
  // junto com `Despesas com Pessoal` — o mesmo erro aparecia duas vezes e a
  // conversa virava "a folha errou, e as despesas também". Partição não repete
  // e não perde. ⚠ Aqui ela vale ainda mais do que lá: o erro é o que se leva
  // para a próxima rodada de orçamento, e contá-lo em dobro calibra a
  // desconfiança no lugar errado.
  const { conjunto, foraPorNat } = useCorte(linhas, aba, nivel, nat)
  useSincronizaSel(cfg, setCfg, conjunto)

  // O limiar foca a atenção; esconder o resto para sempre tira a conferência.
  const [todas, setTodas] = useState(false)
  const total = cfg.sel.reduce((s: number, id: string) => s + Math.abs(val(orc, id)), 0)
  const minAbs = total * (cfg.minPctTotal / 100)
  const cruas = cfg.sel.map((id: string) => {
    const o = val(orc, id), r = val(real, id)
    return { id, nome: nome(id), o, r, erro: r - o, pct: o !== 0 ? ((r - o) / Math.abs(o)) * 100 : (r !== 0 ? Infinity : 0) }
  })
  // ⚠ Zero nos DOIS lados não é "erro pequeno", é ausência de conteúdo: a linha
  // existe na estrutura e não foi orçada nem realizada. Mesma regra da
  // *Variação* — divergir faria os dois cartões listarem conjuntos diferentes
  // do mesmo relatório.
  const vazia = (x: any) => Math.abs(x.o) < 0.005 && Math.abs(x.r) < 0.005
  const nVazias = cruas.filter(vazia).length
  const itensTodos = cruas.filter((x: any) => !vazia(x))
  const marca = (x: any) => Math.abs(x.erro) >= minAbs && (Math.abs(x.pct) >= cfg.pct || !Number.isFinite(x.pct))
  const ordem = (a: any, b: any) => Math.abs(b.erro) - Math.abs(a.erro)
  const destaque = itensTodos.filter(marca).sort(ordem)
  const resto = itensTodos.filter((x: any) => !marca(x)).sort(ordem)
  const somaResto = resto.reduce((s: number, x: any) => s + x.erro, 0)
  const itens = todas ? [...destaque, ...resto.map((r: any) => ({ ...r, _fraco: true }))] : destaque

  return (
    <div style={S.sec}>
      <div>
        <div><div style={S.secT}>Acurácia do orçamento de {ano ?? '—'}</div>
          <div style={S.secD}>
            Orçado × realizado do ano comparado. Não é para julgar o passado — é para saber
            <strong> em quem acreditar</strong> no orçamento novo.
            {' '}⚠ Este quadro <strong>não segue o sentido do cabeçalho</strong>: ele compara o
            orçado de {ano ?? '—'} com o realizado de {ano ?? '—'}, e o erro é sempre
            <em> realizado − orçado</em>. Não existe a outra direção — orçamento se mede contra o
            que aconteceu, nunca o contrário.
            {' '}Marcado o que errou mais de {cfg.pct}% <em>e</em> mais de {cfg.minPctTotal}% do orçado total ({fmt(minAbs)}).
            {' '}⚠ Como em <em>O que mudou</em>, o nível é um <strong>corte</strong>: <em>2</em> traz só o
            nível 2 e as folhas acima, nunca o nível 1 junto — senão o mesmo erro conta duas vezes.
            {nVazias > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}· {nVazias} linha(s) sem orçado e sem realizado ficam de fora.
              </span>
            )}
            {foraPorNat > 0 && (
              <><br /><span style={{ color: 'var(--orange)' }}>
                {foraPorNat} linha(s) fora deste recorte de natureza — entre elas as <b>neutras</b>
                {' '}(impostos, resultado financeiro), que não são receita nem despesa na estrutura.
                {' '}Use <b>Todas</b> para vê-las.
              </span></>
            )}
            {resto.length > 0 && (
              <span data-noexport style={{ marginLeft: 8, color: 'var(--violet)', cursor: 'pointer' }} onClick={() => setTodas(v => !v)}>
                {todas ? `ver só as ${destaque.length} acima do limiar` : `mostrar todas as ${itensTodos.length} linhas`}
              </span>
            )}
          </div></div>
        <BarraCorte S={S} aba={aba} setAba={setAba} nivel={nivel} setNivel={setNivel}
          nat={nat} setNat={setNat} cfg={cfg} setCfg={setCfg} n={conjunto.length} />
      </div>
      {!itens.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sem dados no ano comparado.</div> : (
        <Tabela S={S} arquivo={`acuracia-${ano ?? ''}`} rows={itens}
          cols={[
            { key: 'nome', label: 'linha' },
            { key: 'o', label: 'orçado', num: true, render: (r: any) => fmt(r.o) },
            { key: 'r', label: 'realizado', num: true, render: (r: any) => fmt(r.r) },
            { key: 'erro', label: 'erro', num: true,
              render: (r: any) => <span style={{ color: Math.abs(r.pct) >= 15 ? 'var(--orange)' : 'var(--text-mid)' }}>{r.erro >= 0 ? '+' : ''}{fmt(r.erro)}</span> },
            { key: 'pct', label: '%', num: true, bruto: (r: any) => (Number.isFinite(r.pct) ? r.pct : null),
              render: (r: any) => <span style={{ color: 'var(--muted)' }}>{Number.isFinite(r.pct) ? fmtPct(r.pct) : '—'}</span> },
            { key: 'leitura', label: 'leitura',
              bruto: (r: any) => {
                const a = Math.abs(r.pct)
                return !Number.isFinite(r.pct) ? 'não estava orçado'
                  : a < 5 ? 'acertou' : a < 15 ? (r.erro > 0 ? 'passou do orçado' : 'ficou abaixo') : 'errou muito'
              },
              render: (r: any) => {
                const a = Math.abs(r.pct)
                const t = !Number.isFinite(r.pct) ? 'não estava orçado'
                  : a < 5 ? 'acertou' : a < 15 ? (r.erro > 0 ? 'passou do orçado' : 'ficou abaixo') : '⚠ errou muito'
                return <span style={{ fontSize: 12, color: a >= 15 ? 'var(--orange)' : 'var(--muted)' }}>{t}</span>
              } },
          ]}
          rodape={resto.length > 0 && !todas ? (
            <tr onClick={() => setTodas(true)} style={{ cursor: 'pointer' }} data-noexport>
              <td style={{ ...S.td, textAlign: 'left', color: 'var(--violet)', fontStyle: 'italic' }}>
                demais {resto.length} linha(s), abaixo do limiar — <strong>mostrar</strong></td>
              <td style={S.td} /><td style={S.td} />
              <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{somaResto >= 0 ? '+' : ''}{fmt(somaResto)}</td>
              <td style={S.td} /><td style={S.td} />
            </tr>
          ) : null} />
      )}
    </div>
  )
}

// ── 4 · ALERTAS ─────────────────────────────────────────────
// Barato de calcular e pega problema real. O mais importante é "sumiu": linha
// que desaparece não aparece em lugar nenhum — só o total denuncia, e tarde.
//
// ⚠⚠ NÃO TEM SELETOR, E É O PONTO. O cartão recebia `secVar.sel` — a seleção
// de *O que mudou* —, e isso errava das duas pontas: no nível 1 ele apontava
// subtotais (onde "sumiu" não significa nada, porque o subtotal só reflete as
// filhas) e NENHUMA linha de lançamento era conferida. Alerta é sobre O
// ORÇAMENTO, não sobre o recorte que outro quadro está mostrando — o conjunto
// são as folhas analíticas do relatório, sempre as mesmas. De graça, o cartão
// sai do caminho da recarga: mudar seleção não mexe nele.
const MAX_ALERTA = 30
function Alertas({ S, linhas, nome, base, comp, mensal, val, nMeses }: any) {
  // Folha = linha sem filha. Subtotal e fórmula ficam de fora porque ali o
  // alerta é consequência, não causa; indicador é razão, não valor orçado.
  const folhas = useMemo(() => {
    const temFilha = new Set<string>()
    linhas.forEach((l: LinhaRel) => { if (l.pai_id) temFilha.add(l.pai_id) })
    return linhas.filter((l: LinhaRel) => !l.desativada && !temFilha.has(l.id)
      && l.tipo_linha !== 'INDICADOR' && l.tipo_linha !== 'FORMULA').map((l: LinhaRel) => l.id)
  }, [linhas])

  const alertas: { tipo: string; cor: string; nome: string; detalhe: string; peso: number; mag: number }[] = []
  for (const id of folhas) {
    const b = val(base, id), c = val(comp, id)
    const mm = mensal[id] || []
    const mag = Math.max(Math.abs(b), Math.abs(c))
    if (Math.abs(b) < 0.005 && Math.abs(c) > 0.005)
      alertas.push({ tipo: 'sumiu', cor: 'var(--red)', nome: nome(id), detalhe: `tinha ${fmt(c)} e ficou sem orçado`, peso: 0, mag })
    else if (Math.abs(c) < 0.005 && Math.abs(b) > 0.005)
      alertas.push({ tipo: 'nova', cor: 'var(--cyan)', nome: nome(id), detalhe: `${fmt(b)} sem nada no comparado — merece justificativa`, peso: 1, mag })
    else if (Math.abs(b - c) < 0.005 && Math.abs(b) > 0.005)
      alertas.push({ tipo: 'idêntica', cor: 'var(--orange)', nome: nome(id), detalhe: `igual ao comparado, centavo a centavo — copiada sem revisar?`, peso: 2, mag })
    if (nMeses >= 6 && mm.length === nMeses && Math.abs(mm[0]) > 0.005 && mm.every((v: number) => Math.abs(v - mm[0]) < 0.005))
      alertas.push({ tipo: 'linha reta', cor: 'var(--orange)', nome: nome(id), detalhe: `os ${nMeses} meses são idênticos — "dividi por doze"?`, peso: 3, mag })
  }
  // ⚠ Sem seleção o conjunto cresce, então a ORDEM passa a importar: tipo
  // primeiro (o que sumiu é mais urgente que o que foi copiado), valor depois.
  // E a lista cortada diz quantas ficaram — corte calado faz quem leu as 30
  // primeiras achar que conferiu tudo.
  alertas.sort((a, b2) => a.peso - b2.peso || b2.mag - a.mag)
  const mostra = alertas.slice(0, MAX_ALERTA)
  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>Alertas</div>
          <div style={S.secD}>Orçamento feito no automático, e o que sumiu. Varre as {folhas.length} linhas de lançamento do relatório — não depende da seleção dos outros quadros.</div></div>
      </div>
      {!alertas.length ? (
        <div style={{ fontSize: 13, color: 'var(--green)' }}>✓ Nada a apontar nas linhas de lançamento.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mostra.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13 }}>
              <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: .5, color: a.cor, minWidth: 82, fontWeight: 700 }}>{a.tipo}</span>
              <span style={{ color: 'var(--text)' }}>{a.nome}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>— {a.detalhe}</span>
            </div>
          ))}
          {alertas.length > mostra.length && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              + {alertas.length - mostra.length} alerta(s) além dos {MAX_ALERTA} de maior valor.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
