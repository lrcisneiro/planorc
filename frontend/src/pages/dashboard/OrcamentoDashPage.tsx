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
import { totaisRelatorio, totaisRelatorioMes } from '../../lib/relatorioTotais'
import { useDiscreto, idsRestritos, DOMINANCIA, removerDominadas } from '../../lib/discricao'
import { COLS_LINHA, emArvore, fatorExibicao, linhasConciliaveis, type LinhaRel } from '../../lib/refRelatorio'
import { Ponte, componentesDe } from '../../lib/Ponte'
import {
  ExportarButton, FiltrosButton, PillsDim, SalvarCardButton, useCardPreset,
  effectiveCcFilter, escopoFiltro, BotaoDiscreto, type CC,
} from './DashFiltros'
import { ChevronLeft, AlertTriangle, Info, ChevronUp, ChevronDown, ListChecks } from 'lucide-react'
import { ResponsiveBar } from '@nivo/bar'
import { fmtEixo } from '../../lib/fmtEixo'
import { ResponsiveLine } from '@nivo/line'
import { nivoTheme } from '../../lib/nivoTheme'
import { computeTotais, formatValor, pkey, type Computed, type LinhaCalc, type Periodo } from '../../lib/engine'
import { carregarMetas, resolverMeta, type IndicadorMeta } from '../../lib/indicadorMeta'
import { ChipMeta } from './IndicCard'
import DrillModal from './DrillModal'

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
import {
  Tabela, QuemCausou, Variacao, useCorte, useSincronizaSel, BarraCorte,
  SEC_PADRAO, type SecCfg, type LadoPorMaster, type DimBruto, type DimQuem,
} from '../../lib/AnaliseVariacao'

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
  // ⚠⚠ `comReal` NÃO é "mostrar mais uma coluna": é dizer que o drill tem o
  // que mostrar. Esta tela abre o drill de vários pontos que só falam de
  // ORÇADO (por área, por empresa), e lá o realizado seria ruído. Vindo da
  // ponte em Orçado × Realizado, o razão é justamente o que se foi buscar.
  // ⚠ E só quando os anos COINCIDEM: o `DrillModal` recebe UM conjunto de
  // anos e lê os dois lados dele. Com Orçado2027 × Realizado 2026, pedir o
  // realizado de 2027 devolveria vazio — e vazio parece "não houve
  // movimento", não "perguntei o ano errado".
  const [drill, setDrill] = useState<{ nodeId: string; ccFilter?: string[] | null; comReal?: boolean } | null>(null)
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
  // ── capacidade de serviços (v3_199..201)
  // ⚠⚠ OS PARÂMETROS SÃO DA SIMULAÇÃO, não do cadastro: vão para o PRESET do
  // card, não para uma tabela. É o uso real — cada diretor salva o cenário
  // dele e a conversa é comparar os cards. Virando número oficial um dia,
  // migra para tabela por versão; antes disso seria cadastro sem dono.
  const [cap, setCap] = useState<any[] | null>(null)
  // ⚠ LISTA, não uma linha só: a receita de serviços pode ser a agrupadora ou
  // várias filhas (Horas Abertas + Banco de Horas + Projetos Fechados…), e o
  // mesmo vale para os terceiros. `capLinha`/`capTerc` no singular sobrevivem
  // na leitura, para o preset salvo antes não abrir vazio.
  const umaLista = (v: any, velho: any) => Array.isArray(v) ? v : (velho ? [velho] : [])
  const [capLinhas, setCapLinhas] = useState<string[]>(umaLista(sv.capLinhas, sv.capLinha))
  const [capTercs, setCapTercs] = useState<string[]>(umaLista(sv.capTercs, sv.capTerc))
  // ⚠ A ÁREA É ESCOLHIDA, não chumbada. "3 = Serviços" é cadastro desta
  // instalação — o mesmo eixo que o `filtro_escopo` da linha *Margem Serviço*
  // já usa (`{"area":["3"]}`). Fixar `'3'` no código repetiria a regra num
  // lugar onde ninguém a encontraria ao mudar o cadastro. Default no 3 porque
  // é o caso de hoje; o seletor é o que torna o quadro reusável nas outras
  // áreas, que é o próximo passo pedido.
  const [capArea, setCapArea] = useState<string>(sv.capArea || '3')
  const [capTot, setCapTot] = useState<Record<string, number> | null>(null)
  // Linhas do imposto e da despesa da área, e o que sai das despesas (viagens).
  // ⚠ Viagens sai dos DOIS lados: o reembolso saiu da receita, então a despesa
  // reembolsável tem de sair junto — é o `[2]-[205]` da fórmula do DRE.
  const [capImp, setCapImp] = useState<string[]>(sv.capImp || [])
  const [capDesp, setCapDesp] = useState<string[]>(sv.capDesp || [])
  const [capExcl, setCapExcl] = useState<string[]>(sv.capExcl || [])
  const [capPar, setCapPar] = useState<any>(sv.capPar || {
    PRODUCAO:    { horas: 160, fator: null, valor: 200 },
    COORDENACAO: { horas: 160, fator: null, valor: 250 },
  })
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
    // árvore inteira no escopo de cada linha com `filtro_escopo` — ver a ponte
    arvBase: Record<string, Record<string, number>>; arvComp: Record<string, Record<string, number>>
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
    if (f.capLinhas || f.capLinha) setCapLinhas(umaLista(f.capLinhas, f.capLinha))
    if (f.capTercs || f.capTerc) setCapTercs(umaLista(f.capTercs, f.capTerc))
    if (f.capArea) setCapArea(f.capArea)
    if (f.capImp) setCapImp(f.capImp)
    if (f.capDesp) setCapDesp(f.capDesp)
    if (f.capExcl) setCapExcl(f.capExcl)
    if (f.capPar) setCapPar(f.capPar)
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
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome,restrito').order('codigo')
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
    capLinhas, capTercs, capArea, capImp, capDesp, capExcl, capPar,
    secPonte, secVar, secAcur, secOrc,
  })
  useEffect(() => {
    if (cardId) return   // vendo um card: não contaminar o estado próprio da tela
    localStorage.setItem(SAVE, JSON.stringify(estado()))
  }, [cardId, relId, vBase, modo, vComp, mesIni, mesFim, proj, aba, indicSel, linhaSel, empLinha,
      empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, sentidoOrigem, capLinhas, capTercs, capArea, capImp, capDesp, capExcl, capPar, secPonte, secVar, secAcur, secOrc]) // eslint-disable-line

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
  // ⚠ Modo discreto: máscara de DESENHO, nenhuma recarga — os totais pedidos
  // ao banco são os mesmos, que é o pedido.
  const discreto = useDiscreto()
  const restritos = useMemo(() => idsRestritos(ccs as any, discreto), [ccs, discreto])
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
  const [pessRestr, setPessRestr] = useState<any[]>([])   // a parcela restrita, por área — ver abaixo
  // ⚠⚠ ÁREA DOMINADA por CC restrito vira "Outros" — a mesma regra de
  // `discricao.tsx`, 80% em magnitude. Aqui também a 1ª versão exigiu 99,9% e
  // a área 4 "Diretoria" passou batida por R$ 66.955 num CC legado.
  // ⚠ |valor|, porque uma área com +100 restrito e −100 livre soma zero e
  // passaria pelo teste ingênuo.
  // ⚠ A máscara é de EXIBIÇÃO: as linhas continuam somando no total da aba,
  // que é o que não pode mudar. Só o RÓTULO delas muda.
  const pessVis = useMemo(() => {
    if (!restritos.size || !pessRestr.length || !pess) return pess
    const mag = (arr: any[]) => { const m: Record<string, number> = {}
      for (const l of arr) m[l.area_nome || ''] = (m[l.area_nome || ''] || 0) + Math.abs(Number(l.valor) || 0); return m }
    const todo = mag(pess as any[]), rest = mag(pessRestr)
    const mascarar = new Set(Object.keys(rest).filter(a => todo[a] > 0 && rest[a] >= todo[a] * DOMINANCIA))
    if (!mascarar.size) return pess
    // ⚠⚠ SAI DA LISTA, não vira "Outros": com uma área só mascarada o balde É
    // a Diretoria, com headcount e custo médio dos diretores legíveis.
    // ⚠ Os percentuais da aba passam a ser sobre o que está listado — é a
    // consequência de tirar linhas, e o aviso abaixo do quadro diz isso.
    return (pess as any[]).filter((l: any) => !mascarar.has(l.area_nome || ''))
  }, [pess, pessRestr, restritos])
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
    // ⚠⚠ O LADO RESTRITO, MEDIDO POR VALOR — não deduzido do cadastro.
    // `analise_pessoas_agg` agrupa por ÁREA e não devolve CC, então não dá
    // para saber pela linha se ela é restrita. A área 4 "Diretoria" tem 4 CCs
    // cadastrados e **todo o valor dela é do 411**: conferir por contagem de
    // CCs diria que ela "mistura" e a deixaria exposta, com headcount e custo
    // médio dos diretores à vista.
    // A mesma função, com `p_ccs` = só os restritos, responde quanto de cada
    // área vem deles. É a mesma fonte, logo não há duas verdades.
    // ⚠ Chamada só com o modo LIGADO: no uso normal ela não existe.
    if (restritos.size) {
      const alvo = (ccFilter ?? (ccs as any[]).map(c => c.id)).filter((id: string) => restritos.has(id))
      if (alvo.length) {
        supabase.rpc('analise_pessoas_agg', {
          p_versao: vBase, p_ano: anoBase, p_empresas: empFiltradas, p_filiais: filialFilter, p_ccs: alvo,
        }).then(({ data, error }) => { if (vivo && !error) setPessRestr(data || []) })
      } else setPessRestr([])
    } else setPessRestr([])
    // ⚠ Chamada SEPARADA de propósito: se a capacidade falhar (RPC ainda não
    // aplicada noutro tenant, por exemplo), a análise de pessoas continua —
    // uma peça nova não pode derrubar a que já funcionava.
    // ⚠⚠ O RECORTE DA ÁREA VAI NA CHAMADA, não num aviso. Sem ele a RPC
    // devolvia os 570 postos da empresa e o quadro mostrava 247 FTE de
    // "produção de serviços" — número plausível e errado, que é o pior tipo.
    // ⚠ INTERSEÇÃO com o filtro da tela: quem filtra "Serviços › Base" tem de
    // ver só aquilo. Interseção vazia (filtrou outra área) devolve zero e o
    // quadro some — é um quadro de Serviços, não aparece olhando Comercial.
    const ccsArea = (ccs as any[]).filter(c => c.area_cod === capArea).map(c => c.id)
    const ccsCap = ccFilter ? ccFilter.filter((id: string) => ccsArea.includes(id)) : ccsArea
    // ⚠⚠ OS TOTAIS DO QUADRO SÃO DA ÁREA, não do filtro da tela. Usar `base`
    // misturava capacidade recortada com receita e despesa da empresa inteira
    // — e, pior, deixava de fora TODAS as despesas que não são pessoal
    // (aluguel, software, administrativas): a margem da área saía
    // superestimada, porque o quadro só somava `origem POSTO` e terceiros.
    // ⚠ É a MESMA função do relatório (`totaisRelatorio`), então os números
    // batem com a DRE por construção — inclusive o `filtro_escopo` das linhas.
    if (linhas.length) {
      totaisRelatorio({
        linhas, ccs, cen: vBase, anos: [anoBase], meses,
        empresas: empFiltradas, filialFilter, ccFilter: ccsCap, ccPermitidos: null,
        slot: 1,
      }).then(t => { if (vivo) setCapTot(t) }).catch(() => { if (vivo) setCapTot(null) })
    }
    supabase.rpc('servico_capacidade_agg', {
      p_versao: vBase, p_ano: anoBase,
      p_empresas: empFiltradas, p_filiais: filialFilter, p_ccs: ccsCap,
      p_ano_apont: null,
    }).then(({ data, error }) => {
      if (!vivo) return
      setCap(error ? [] : (data || []))
    })
    return () => { vivo = false }
  }, [aba, vBase, anoBase, capArea, empFiltradas.join(','), filialFilter?.join(','), ccFilter?.join(',')]) // eslint-disable-line

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
      type Resp = { total: Record<string, number>; mes: Record<string, number[]>; arvore: Record<string, Record<string, number>> }
      const voos = new Map<string, Promise<Resp>>()
      const chamarMes = (cen: string, anos: number[], ms: number[]): Promise<Resp> => {
        if (!ms.length) return Promise.resolve({ total: {}, mes: {}, arvore: {} } as Resp)
        const k = `${cen}|${anos.join(',')}|${ms.join(',')}`
        let p = voos.get(k)
        if (!p) { p = totaisRelatorioMes({ ...base, cen, anos, meses: ms }); voos.set(k, p) }
        return p
      }
      const chamar = async (cen: string, anos: number[], ms: number[]) => (await chamarMes(cen, anos, ms)).total

      // Uma SÉRIE = o período pedido, mais a projeção dos meses seguintes até
      // dezembro. A projeção se compõe de outra leitura com faixa de meses
      // diferente, vezes um fator — não precisa de dado mensal cru.
      // ⚠ A ÁRVORE ESCOPADA ACOMPANHA A PROJEÇÃO. Ela é a ponte de uma linha
      // com `filtro_escopo` (ver o cartão), e projetar só o total deixaria o
      // começo e o fim da ponte projetados sobre componentes que não são —
      // a ponte deixaria de fechar exatamente quando a projeção está ligada.
      const serie = async (cen: string, ano: number): Promise<Resp> => {
        const periodo = await chamarMes(cen, [ano], meses)
        if (!mesesProj.length) return periodo
        let fonte: Resp, fator: number
        if (proj === 'ORCADO' && cen === 'REALIZADO') {
          // a estimativa da própria empresa para aqueles meses
          fonte = await chamarMes(vComp, [ano], mesesProj); fator = 1
        } else if (proj === 'MEDIA3') {
          const u3 = meses.slice(-3)
          fonte = await chamarMes(cen, [ano], u3); fator = u3.length ? mesesProj.length / u3.length : 0
        } else if (proj === 'MEDIAPER') {
          fonte = periodo; fator = meses.length ? mesesProj.length / meses.length : 0
        } else {  // ULTIMO
          fonte = await chamarMes(cen, [ano], [mesFim]); fator = mesesProj.length
        }
        const total = { ...periodo.total }
        for (const k in fonte.total) total[k] = (total[k] || 0) + fonte.total[k] * fator
        const arvore: Record<string, Record<string, number>> = {}
        for (const lid in periodo.arvore) {
          const t = { ...periodo.arvore[lid] }, f = fonte.arvore[lid] || {}
          for (const k in f) t[k] = (t[k] || 0) + f[k] * fator
          arvore[lid] = t
        }
        return { total, mes: periodo.mes, arvore }
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

      const comp = c.total
      const mensalBase = det.mes

      setDados({ base: b.total, comp, orcAnt: oa, realAnt: ra, mensalBase,
                 arvBase: b.arvore, arvComp: c.arvore })

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
  // ⚠⚠ LINHA ESCOPADA NÃO SE DECOMPÕE COM OS COMPONENTES DA TELA. `base`/
  // `comp` dão à linha com `filtro_escopo` o valor do escopo dela e a todas as
  // outras o valor do filtro da tela: *Margem Sustentação* (CC 317) ao lado de
  // `Receitas` da empresa inteira dava resíduo de 1625% da variação.
  // ⚠ O escopo vem do PONTO DE ENTRADA (`trilha[0]`), não da linha atual —
  // descendo para um componente sem escopo próprio, a ponte saltaria de volta
  // para a empresa inteira no meio da navegação, calada.
  const ponteRaiz = trilhaPonte[0] ?? secPonte.resultado
  const arvB = ponteRaiz ? dados?.arvBase[ponteRaiz] : undefined
  const arvC = ponteRaiz ? dados?.arvComp[ponteRaiz] : undefined
  const ponteNota = arvB
    ? `Recorte próprio de ${nome(ponteRaiz)} — os componentes abaixo são calculados no mesmo escopo dela, senão a ponte não fecha.`
    : undefined
  const pBase = arvB || dados?.base, pComp = arvC || dados?.comp
  const pOrigem = origemAnalisado ? pBase : pComp
  const pDestino = origemAnalisado ? pComp : pBase
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

        <BotaoDiscreto ccs={ccsVisiveis as any} />
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
          : <>
              <VisaoPessoas S={S} linhas={pessVis} oculto={!!pess && !!pessVis && pessVis.length < (pess as any[]).length} erro={erroPess} rotulo={versao(vBase)?.codigo ?? ''} ano={anoBase} />
              {/* ⚠ Depois do que já existe, como grupo próprio: "quanto de
                  cada área é gente" descreve a empresa toda; a capacidade é
                  uma pergunta de UMA área. Misturar os dois faria a segunda
                  parecer válida para todas. */}
              {dados && <CapacidadeServicos S={S} cap={cap} linhas={linhas} base={dados.base} val={val}
                capLinhas={capLinhas} setCapLinhas={setCapLinhas} capTercs={capTercs} setCapTercs={setCapTercs}
                capArea={capArea} setCapArea={setCapArea} ccs={ccs} tot={capTot}
                capImp={capImp} setCapImp={setCapImp} capDesp={capDesp} setCapDesp={setCapDesp}
                capExcl={capExcl} setCapExcl={setCapExcl}
                par={capPar} setPar={setCapPar}
                rotulo={versao(vBase)?.codigo ?? ''} ano={anoBase} />}
            </>
      ) : !dados ? null : aba === 'orcamento' ? (
        <VisaoOrcamento S={S} cfg={secOrc} setCfg={setSecOrc} linhas={linhas} nome={nome} val={val} fac={fac}
          base={dados.base} comp={dados.comp} mensal={dados.mensalBase} meses={meses} MES={MES}
          metas={metas} anoBase={anoBase} indicSel={indicSel} setIndicSel={setIndicSel} pick={pickIndic} setPick={setPickIndic}
          linhaSel={linhaSel} setLinhaSel={setLinhaSel} pickLinha={pickLinha} setPickLinha={setPickLinha}
          empLinha={empLinha} setEmpLinha={setEmpLinha}
          porEmp={porEmp} porArea={porArea} setDrill={setDrill} restritos={restritos}
          rotuloBase={rotuloBase} rotuloComp={rotuloComp} />
      ) : (
        <>
          <Ponte S={S} cfg={secPonte} setCfg={setSecPonte} linhas={linhas} nome={nome}
            trilha={trilhaPonte} setTrilha={setTrilhaPonte} navRef={navPonte}
            nat={ponteNat} setNat={setPonteNat} ate={ponteAte} setAte={setPonteAte}
            origem={pOrigem} destino={pDestino} rotOrigem={rotOrigem} rotDestino={rotDestino} nota={ponteNota}
            onDrill={(id: string) => setDrill({ nodeId: id, comReal: modo === 'REAL' && anoBase === anoComp })} />

          <QuemCausou S={S} linhas={linhas} nome={nome} bruto={dimBruto} empresas={empresas} ccs={ccs}
            resId={secPonte.resultado} componentes={secPonte.sel} invertido={origemAnalisado}
            rotOrigem={rotOrigem} rotDestino={rotDestino} dim={quemDim} setDim={setQuemDim}
            restritos={restritos}
            ano={anoBase} dTotal={secPonte.resultado
              ? (pDestino?.[secPonte.resultado] ?? 0) - (pOrigem?.[secPonte.resultado] ?? 0) : 0} />

          <Variacao S={S} cfg={secVar} setCfg={setSecVar} linhas={linhas} nome={nome} fac={fac}
            aba={varAba} setAba={setVarAba} nivel={varNivel} setNivel={setVarNivel}
            nat={varNat} setNat={setVarNat}
            origem={origemAnalisado ? dados.base : dados.comp} destino={origemAnalisado ? dados.comp : dados.base}
            val={val} rotOrigem={rotOrigem} rotDestino={rotDestino} />

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
        <DrillModal relId={relId} versaoId={vBase} empIds={empFiltradas} anos={[anoBase!]} meses={meses} restritos={restritos}
          filFilter={filialFilter} ccFilter={drill.ccFilter !== undefined ? drill.ccFilter : ccFilter}
          startNodeId={drill.nodeId} slot={1} soOrcado={!drill.comReal} onClose={() => setDrill(null)} />
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

  // ⚠ `pes` = magnitude por CC dentro da barra. O modo discreto decide por
  // DOMINÂNCIA (ver `lib/discricao.tsx`), então o conjunto de ids não basta:
  // precisa de quanto cada um vale.
  type Bal = { v: number; ccs: Set<string>; pes: Record<string, number> }
  const recA: Record<string, Bal> = {}, despA: Record<string, Bal> = {}
  const recC: Record<string, Bal> = {}, despC: Record<string, Bal> = {}
  const recM: Record<number, number> = {}, despM: Record<number, number> = {}
  const acum = (m: Record<string, Bal>, k: string, v: number, cc: string | null) => {
    const b = (m[k] = m[k] || { v: 0, ccs: new Set<string>(), pes: {} }); b.v += v
    if (cc) { b.ccs.add(cc); b.pes[cc] = (b.pes[cc] || 0) + Math.abs(v) }
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
  const lista = (m: Record<string, Bal>, chave: string) =>
    Object.entries(m).filter(([, b]) => b.v).map(([k, b]) => ({ [chave]: k, Orçado: Math.round(b.v), _ccs: [...b.ccs], _pes: b.pes }))
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
function VisaoOrcamento({ S, cfg, setCfg, linhas, nome, val, fac, base, comp, mensal, meses, MES, metas, anoBase, indicSel, setIndicSel, pick, setPick, linhaSel, setLinhaSel, pickLinha, setPickLinha, empLinha, setEmpLinha, porEmp, porArea, setDrill, rotuloBase, rotuloComp, restritos }: any) {
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
        // ⚠⚠ UM SÓ PONTO PARA AS QUATRO BARRAS (receita/despesa × área/CC).
        // Mascarar em cada uma seria o jeito de esquecer a próxima — foi
        // exatamente o que aconteceu no acompanhamento, onde os gráficos por
        // ÁREA ficaram de fora na primeira versão.
        const bruto = (porArea as any)[chave] as any[]
        const vis = removerDominadas<any>(bruto || [], (d: any) => d._pes || {}, restritos || new Set())
        const dados = vis.linhas
        if (!dados?.length) return null
        return (
          <div key={chave} style={S.sec}>
            <div style={S.secH}><div>
              <div style={S.secT}>{titulo}</div>
              <div style={S.secD}>Orçado de {rotuloBase}. <span style={{ color: 'var(--violet)' }}>Clique numa barra para abrir a linha do relatório e chegar ao razão.</span>
                {vis.ocultadas > 0 && <span style={{ color: 'var(--violet)' }}> · {vis.ocultadas} não detalhada(s) pelo modo discreto.</span>}</div>
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
function VisaoPessoas({ S, linhas, erro, rotulo, ano, oculto }: any) {
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
      {/* ⚠ O corte é DITO e SEM o valor: dizer quanto foi omitido devolveria
          o número que a omissão existe para esconder. E o aviso precisa estar
          aqui porque os percentuais abaixo passam a ter outro denominador —
          são sobre o que está listado, não sobre a empresa. */}
      {oculto && (
        <div style={{ ...S.sec, padding: '10px 14px', fontSize: 12, color: 'var(--violet)', border: '1px solid var(--violet)' }}>
          Modo discreto: área(s) dominada(s) por centro de custo restrito não aparecem, e os
          percentuais abaixo são sobre o que está listado.
        </div>
      )}
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

// ── CAPACIDADE PRODUTIVA · SERVIÇOS ─────────────────────────
// Confronta o TAMANHO DA EQUIPE com a RECEITA ORÇADA: o orçamento de serviços
// cabe nesta gente? A resposta sai como **valor-hora implícito**, que é
// comparável com o preço praticado — um gap em reais ninguém sabe interpretar.
//
// ⚠⚠ O FATOR É A ALAVANCA, e por isso é editável. Medido no apontamento de
// 2026 (sem intercâmbio), a produção dá 162 h/mês — 101% sobre 160. Isso NÃO é
// utilização faturável: inclui hora extra e hora em projeto interno. A
// literatura põe IT services em 70–80%. Com 80%, a capacidade da produção cai
// de R$ 55,5 mi para R$ 43,9 mi e o quadro INVERTE, de folga para déficit. O
// medido informa; quem decide é quem simula.
//
// ⚠ Três papéis (v3_201): PRODUCAO e COORDENACAO vendem hora e entram na
// margem DIRETA; ESTRUTURA não vende e entra só na margem da ÁREA. A diferença
// entre as duas margens é exatamente o custo de quem não vende hora.
//
// ⚠ A receita sai de `base`, que já respeita o filtro da tela. Somar a linha
// direto do banco incluiria a Bolívia (R$ 7,4 mi, sem equipe no CC 3) e o
// quadro ficaria 13% otimista — erro que eu cometi ao desenhar este quadro.
const PAPEL_ROT: Record<string, string> = {
  PRODUCAO: 'Produção', COORDENACAO: 'Coordenação',
  ESTRUTURA: 'Estrutura', SEM_PAPEL: 'Sem papel definido',
}
function CapacidadeServicos({ S, cap, linhas, base, val, capLinhas, setCapLinhas,
                              capTercs, setCapTercs, capArea, setCapArea, ccs, tot,
                              capImp, setCapImp, capDesp, setCapDesp, capExcl, setCapExcl,
                              par, setPar, rotulo, ano }: any) {
  const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR')
  const [abrir, setAbrir] = useState(false)
  const areasCc = useMemo(() => {
    const m = new Map<string, string>()
    ;(ccs as any[]).forEach(c => { if (c.area_cod) m.set(c.area_cod, c.area_nome || c.area_cod) })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cod, nome]) => ({ cod, nome }))
  }, [ccs])

  // ⚠ `vArea` lê os totais DA ÁREA; `val`/`base` (filtro da tela) ficam só
  // como reserva enquanto a carta da área não chegou — sem isso o quadro
  // piscaria com o número da empresa inteira antes de se corrigir, e quem
  // olhasse rápido leria o errado.
  const vArea = (id: string) => Math.abs((tot ? tot[id] : val(base, id)) ?? 0)
  const opcoes = useMemo(() => emArvore(linhas as any)
    .filter((l: any) => !l.desativada && Math.abs((tot ? tot[l.id] : val(base, l.id)) ?? 0) > 0.005)
    .map((l: any) => ({ id: l.id, nome: l.descricao, prof: l.prof })), [linhas, base, val, tot])

  // ⚠⚠ MARCAR A AGRUPADORA JUNTO COM AS FILHAS CONTA DUAS VEZES — é o mesmo
  // defeito da ponte e do botão Seções, e aqui seria pior: a receita dobraria
  // e a capacidade pareceria insuficiente por um erro de seleção.
  // Ao marcar uma linha, somem os ancestrais e os descendentes dela.
  const ancestrais = useMemo(() => {
    const byId: Record<string, any> = Object.fromEntries((linhas as LinhaRel[]).map(l => [l.id, l]))
    return (id: string) => { const o: string[] = []; let p = byId[id]?.pai_id
                             while (p && byId[p]) { o.push(p); p = byId[p].pai_id } return o }
  }, [linhas])
  const descendentes = useMemo(() => {
    const filhos: Record<string, string[]> = {}
    ;(linhas as LinhaRel[]).forEach(l => { if (l.pai_id) (filhos[l.pai_id] = filhos[l.pai_id] || []).push(l.id) })
    return (id: string) => { const o: string[] = []; const fila = [...(filhos[id] || [])]
                             while (fila.length) { const x = fila.shift()!; o.push(x); fila.push(...(filhos[x] || [])) } return o }
  }, [linhas])
  const alterna = (sel: string[], set: (v: string[]) => void) => (id: string) => {
    if (sel.includes(id)) return set(sel.filter(x => x !== id))
    const fora = new Set([...ancestrais(id), ...descendentes(id)])
    set([...sel.filter(x => !fora.has(x)), id])
  }

  const soma = (ids: string[]) => ids.reduce((a, id) => a + vArea(id), 0)

  const Picker = ({ titulo, sel, set }: any) => {
    const [open, setOpen] = useState(false)
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <button onClick={() => setOpen(v => !v)}
          style={{ padding: '5px 9px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7,
                   background: 'var(--bg-soft)', color: 'var(--text)', cursor: 'pointer' }}>
          {titulo} ({sel.length}) ▾
        </button>
        {open && (
          <>
            <span style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setOpen(false)} />
            <span style={{ position: 'absolute', top: '100%', left: 0, zIndex: 61, marginTop: 4, width: 330,
                           maxHeight: 300, overflow: 'auto', display: 'block',
                           background: 'var(--panel)', border: '1px solid var(--border-strong)',
                           borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,.3)', padding: 6 }}>
              {opcoes.map((o: any) => (
                <label key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 6px',
                                           fontSize: 12.5, cursor: 'pointer',
                                           paddingLeft: 6 + o.prof * 12 }}>
                  <input type="checkbox" checked={sel.includes(o.id)} onChange={() => alterna(sel, set)(o.id)} />
                  <span style={{ flex: 1 }}>{o.nome}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>{fmt(vArea(o.id))}</span>
                </label>
              ))}
              <div style={{ fontSize: 11, color: 'var(--faint)', padding: '6px 6px 2px', borderTop: '1px solid var(--border)' }}>
                ⚠ Marcar uma linha desmarca a agrupadora dela e as filhas — somar os dois contaria o
                mesmo dinheiro duas vezes.
              </div>
            </span>
          </>
        )}
      </span>
    )
  }

  // ⚠ Heurística de nome UMA vez, só para o default — o seletor manda. Mesmo
  // padrão do `resNode` do acompanhamento.
  // ⚠ Heurística de nome só para o DEFAULT, uma vez — o checkbox manda.
  useEffect(() => {
    if (capLinhas.length || !opcoes.length) return
    const a = opcoes.find((o: any) => /receita de servi/i.test(o.nome))
    if (a) setCapLinhas([a.id])
  }, [opcoes]) // eslint-disable-line
  useEffect(() => {
    if (capTercs.length || !opcoes.length) return
    const a = opcoes.find((o: any) => /terceiro/i.test(o.nome) && /extern/i.test(o.nome))
    if (a) setCapTercs([a.id])
  }, [opcoes]) // eslint-disable-line
  useEffect(() => {
    if (capImp.length || !opcoes.length) return
    const a = opcoes.find((o: any) => /imposto/i.test(o.nome) && /fatura/i.test(o.nome))
    if (a) setCapImp([a.id])
  }, [opcoes]) // eslint-disable-line
  useEffect(() => {
    if (capDesp.length || !opcoes.length) return
    const a = opcoes.find((o: any) => /^despesas$/i.test(o.nome.trim()))
    if (a) setCapDesp([a.id])
  }, [opcoes]) // eslint-disable-line
  useEffect(() => {
    if (capExcl.length || !opcoes.length) return
    const a = opcoes.find((o: any) => /^viagens$/i.test(o.nome.trim()))
    if (a) setCapExcl([a.id])
  }, [opcoes]) // eslint-disable-line

  const receita = soma(capLinhas)
  const linhasCap = (cap || []) as any[]
  const de = (p: string) => linhasCap.find(x => x.papel === p)
  const vende = ['PRODUCAO', 'COORDENACAO']

  const calc = vende.map(p => {
    const d = de(p)
    const pr = par[p] || { horas: 160, fator: null, valor: 0 }
    const medido = d?.horas_mes ? (d.horas_mes / (pr.horas || 160)) * 100 : null
    // Sem fator escolhido vale o MEDIDO; sem medido, 100% — e a tela diz qual
    // dos dois está em uso, porque a conclusão depende disso.
    const fator = pr.fator != null ? pr.fator : (medido ?? 100)
    const fte = Number(d?.fte || 0)
    const horasAno = fte * (pr.horas || 160) * (fator / 100) * 12
    return { papel: p, d, pr, medido, fator, fte, horasAno, capac: horasAno * (pr.valor || 0) }
  })

  const capacidade = calc.reduce((a, x) => a + x.capac, 0)
  const horasAno = calc.reduce((a, x) => a + x.horasAno, 0)
  const custoVende = vende.reduce((a, p) => a + Number(de(p)?.custo || 0), 0)
  const custoArea = linhasCap.reduce((a, x) => a + Number(x.custo || 0), 0)
  // ⚠⚠ TERCEIROS EXTERNOS É CUSTO DIRETO, MAS ELÁSTICO — contratado sob
  // demanda. Por isso ele NÃO entra na margem direta (que mede a eficiência da
  // equipe própria) e aparece numa margem PRÓPRIA logo abaixo: assim dá para
  // ver quanto da entrega depende de gente que não está no quadro.
  // ⚠ Ele também não entra na CAPACIDADE: quem está no `posto` é quem a
  // empresa tem; terceiro é a válvula para o que não cabe. Somá-lo ali faria a
  // capacidade crescer com a contratação, e a pergunta "cabe na equipe?"
  // deixaria de existir.
  const terceiros = soma(capTercs)

  // ⚠⚠ O IMPOSTO É PROPORCIONAL ÀS LINHAS MARCADAS, não o total da área. É o
  // mesmo raciocínio do `[130]*([111]/[1])` da fórmula do DRE: tirando o
  // reembolso da receita, o imposto que incidia sobre ele tem de sair junto.
  // Aqui a conta é a recíproca — do imposto da área, fica a fração que cabe à
  // receita escolhida.
  const recTotArea = soma(opcoes.filter((o: any) => /receita/i.test(o.nome) && o.prof === 1).map((o: any) => o.id))
  const impArea = soma(capImp)
  const imposto = recTotArea > 0 ? impArea * (receita / recTotArea) : 0
  const recLiq = receita - imposto

  // ⚠ "Demais despesas" é o RESTO: total da área, menos o que já foi nomeado.
  // Somar linha a linha exigiria marcar dezenas delas e qualquer esquecimento
  // viraria margem a mais, em silêncio. Como resto, tudo que existe entra.
  const despArea = soma(capDesp) - soma(capExcl)
  const demais = Math.max(0, despArea - custoVende - terceiros)

  const gap = capacidade - recLiq
  const implicito = horasAno > 0 ? recLiq / horasAno : 0

  const num = (v: any, on: (n: number) => void, suf?: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <input type="number" value={v ?? ''} onChange={e => on(Number(e.target.value))}
        style={{ width: 58, padding: '2px 4px', fontSize: 12.5, textAlign: 'right', fontFamily: 'monospace',
                 background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6 }} />
      {suf && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{suf}</span>}
    </span>
  )
  const setP = (p: string, k: string, v: number) => setPar({ ...par, [p]: { ...par[p], [k]: v } })

  if (!linhasCap.length) return null
  return (
    <div style={{ ...S.sec, marginTop: 18 }}>
      <div><div style={S.secT}>Capacidade produtiva — Serviços</div>
        <div style={S.secD}>
          {rotulo} · {ano}. O orçamento de serviços cabe nesta equipe? A resposta é o
          {' '}<strong>valor-hora implícito</strong>, comparável com o que você pratica.
          {' '}<strong>Os parâmetros são editáveis</strong> — mexa neles para simular.
          {' '}⚠ <strong>Estrutura</strong> (diretoria, gerência executiva) não vende hora: entra só na
          margem da área. ⚠ Reembolso de despesas fica fora desta conta.
          {' '}⚠⚠ <strong>Capacidade e custo</strong> são da área escolhida; a <strong>receita</strong> é a
          do filtro da tela. Medido em 2027: <strong>99%</strong> da receita de serviços está na área 3,
          então a diferença é pequena — mas ela existe, e cresce se a receita for lançada fora da área.
        </div></div>

      <div style={{ ...S.secBarra }}>
        {/* O recorte é do QUADRO e não da tela: trocar a área aqui não mexe nos
            outros cartões da aba, que falam da empresa inteira. */}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Área:</span>
        <select value={capArea} onChange={e => setCapArea(e.target.value)}
          style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text)' }}>
          {areasCc.map((a: any) => <option key={a.cod} value={a.cod}>{a.cod} · {a.nome}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>Receita:</span>
        <Picker titulo="linhas de receita" sel={capLinhas} set={setCapLinhas} />
        <strong style={{ fontFamily: 'monospace' }}>{fmt(receita)}</strong>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...S.th, textAlign: 'left' }}>grupo</th>
          <th style={S.th}>FTE</th><th style={S.th}>h/mês</th><th style={S.th}>fator</th>
          <th style={S.th}>R$/h</th><th style={S.th}>horas/ano</th>
          <th style={S.th}>capacidade</th><th style={S.th}>custo</th>
        </tr></thead>
        <tbody>
          {calc.map(x => (
            <tr key={x.papel}>
              <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>{PAPEL_ROT[x.papel]}</td>
              <td style={S.td}>{x.fte.toFixed(1)}</td>
              <td style={S.td}>{num(x.pr.horas, v => setP(x.papel, 'horas', v))}</td>
              <td style={S.td}>
                {num(x.pr.fator ?? Math.round(x.fator), v => setP(x.papel, 'fator', v), '%')}
                {/* ⚠ O medido fica à VISTA ao lado do campo: o número tem de
                    ter origem, senão a simulação vira chute com casas decimais. */}
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'inherit' }}>
                  {x.d?.horas_mes ? `medido ${Math.round(x.d.horas_mes)}h · ${Math.round(x.medido!)}%` : 'sem apontamento'}
                </div>
              </td>
              <td style={S.td}>{num(x.pr.valor, v => setP(x.papel, 'valor', v))}</td>
              <td style={S.td}>{fmt(x.horasAno)}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{fmt(x.capac)}</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{fmt(Number(x.d?.custo || 0))}</td>
            </tr>
          ))}
          {linhasCap.filter(x => !vende.includes(x.papel)).map(x => (
            <tr key={x.papel}>
              <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--muted)' }}>
                {PAPEL_ROT[x.papel] || x.papel}
                <span style={{ fontSize: 11, marginLeft: 6 }}>não vende hora</span>
              </td>
              <td style={S.td}>{Number(x.fte).toFixed(1)}</td>
              <td style={S.td} colSpan={4} />
              <td style={S.td}>—</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{fmt(Number(x.custo || 0))}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>capacidade instalada</td>
            <td style={S.td} colSpan={5} />
            <td style={{ ...S.td, fontWeight: 700 }}>{fmt(capacidade)}</td>
            <td style={{ ...S.td, fontWeight: 700 }}>{fmt(custoArea)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginTop: 14 }}>
        {[
          { r: gap >= 0 ? 'Folga de capacidade' : 'Déficit de capacidade',
            v: `${gap >= 0 ? '+' : ''}${fmt(gap)}  ${receita ? `(${(gap / receita * 100).toFixed(0)}%)` : ''}`,
            c: gap >= 0 ? 'var(--green)' : 'var(--red)', d: 'capacidade − receita orçada' },
          { r: 'Valor-hora implícito', v: `R$ ${implicito.toFixed(2)}`, c: 'var(--violet)',
            d: 'receita / horas vendáveis — compare com o praticado' },
        ].map(k => (
          <div key={k.r} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .4 }}>{k.r}</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'monospace', color: k.c, marginTop: 2 }}>{k.v}</div>
            {k.d && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{k.d}</div>}
          </div>
        ))}
      </div>

      {/* ⚠ CASCATA, não cartões soltos: cada margem é a anterior menos um
          custo, e a ordem conta a história — primeiro a equipe própria, depois
          o elástico, por último a estrutura. Em cartões lado a lado, três
          percentuais diferentes para "margem de serviços" parecem contradição. */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
        <tbody>
          {(() => {
            // ⚠⚠ TERCEIROS POR ÚLTIMO, e não no meio. As duas margens que a
            // empresa já usa — a direta e a da área — ficam LIMPAS do custo
            // elástico, e aí a terceira mostra o efeito dele. Com terceiros no
            // meio, a "margem da área" deixava de ser a mesma coisa que a
            // `Margem Serviço` do DRE e nenhuma das duas era comparável com o
            // que já se reporta.
            // ⚠ TERCEIROS LOGO APÓS O PESSOAL: ele é MÃO DE OBRA contratada,
            // quase tão direto quanto o próprio — agrupá-lo com aluguel e
            // software esconderia que a entrega depende dele. A sequência é
            // "quem executa" → "quem apoia", não "fixo" → "variável".
            const m1 = recLiq - custoVende           // só de pessoas próprias
            const m2 = m1 - terceiros                 // + mão de obra contratada
            const m3 = m2 - demais                    // + todo o resto = a área
            const lin = (rot: string, val: number, det: string, forte = false, margem = false) => (
              <tr key={rot}>
                <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit',
                             fontWeight: forte ? 700 : 400, color: margem ? 'var(--text)' : 'var(--muted)' }}>
                  {rot}<span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 8 }}>{det}</span>
                </td>
                <td style={{ ...S.td, fontWeight: forte ? 700 : 400,
                             color: margem ? (val >= 0 ? 'var(--text)' : 'var(--red)') : 'var(--muted)' }}>
                  {margem ? fmt(val) : `− ${fmt(val)}`}
                </td>
                {/* ⚠ O percentual é sobre a RECEITA LÍQUIDA, não a bruta — é a
                    calibragem que faltava também na fórmula do DRE, onde o
                    numerador já era líquido e o denominador não. */}
                <td style={{ ...S.td, width: 70, color: 'var(--muted)' }}>
                  {margem && recLiq ? `${(val / recLiq * 100).toFixed(1)}%` : ''}
                </td>
              </tr>
            )
            return [
              lin('Receita de serviços', receita, 'linhas marcadas', false, true),
              lin('Impostos s/ faturamento', imposto, `proporcional — ${recTotArea ? (receita / recTotArea * 100).toFixed(0) : 0}% da receita da área`),
              lin('= Receita líquida', recLiq, 'a base de todas as margens abaixo', true, true),
              lin('Pessoal próprio direto', custoVende, 'produção + coordenação'),
              lin('= Margem direta', m1, 'só da equipe própria', true, true),
              lin('Terceiros externos', terceiros, 'mão de obra contratada sob demanda — a parte elástica'),
              lin('= Margem com terceiros', m2, 'toda a mão de obra que entrega', true, true),
              lin('Demais despesas da área', demais, 'estrutura e tudo mais, sem viagens'),
              lin('= Margem da área', m3, 'a margem que a DRE reporta', true, true),
            ]
          })()}
        </tbody>
      </table>
      <div style={{ ...S.secBarra, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Terceiros externos:</span>
        <Picker titulo="linhas" sel={capTercs} set={setCapTercs} />
        <strong style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{fmt(terceiros)}</strong>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>Impostos:</span>
        <Picker titulo="linhas" sel={capImp} set={setCapImp} />
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>Despesas da área:</span>
        <Picker titulo="linhas" sel={capDesp} set={setCapDesp} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>menos</span>
        <Picker titulo="viagens etc." sel={capExcl} set={setCapExcl} />
      </div>

      <div data-noexport style={{ marginTop: 10, fontSize: 11.5, color: 'var(--violet)', cursor: 'pointer' }}
        onClick={() => setAbrir(v => !v)}>
        {abrir ? '▾' : '▸'} composição dos grupos
      </div>
      {abrir && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          {linhasCap.map(x => (
            <div key={x.papel}>
              <strong style={{ color: 'var(--text-mid)' }}>{PAPEL_ROT[x.papel] || x.papel}</strong>
              {' · '}{x.pessoas} pessoa(s) · FTE {Number(x.fte).toFixed(1)}
              {' · '}{x.com_hora} com apontamento
              {x.horas_mes ? ` · ${Math.round(x.horas_mes)} h/mês` : ' · sem horas'}
              {' · R$ '}{fmt(Number(x.custo || 0))}
            </div>
          ))}
          <div style={{ marginTop: 6, color: 'var(--faint)' }}>
            ⚠ O papel vem do <strong>cargo</strong> e pode ser ajustado por pessoa no cadastro do posto.
            Quem aparece em <em>Sem papel definido</em> está sem cargo — some do grupo, mas continua
            no custo da área.
          </div>
        </div>
      )}
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
