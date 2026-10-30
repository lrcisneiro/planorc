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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { carregarVersoes, carregarRelatorios } from '../../lib/escopoDados'
import { useUserAccess } from '../../hooks/useUserAccess'
import { totaisRelatorio } from '../../lib/relatorioTotais'
import { COLS_LINHA, emArvore, fatorExibicao, linhasConciliaveis, type LinhaRel } from '../../lib/refRelatorio'
import {
  ExportarButton, FiltrosButton, SalvarCardButton, useCardPreset,
  effectiveCcFilter, escopoFiltro, type CC,
} from './DashFiltros'
import { ChevronLeft, AlertTriangle, Info, Download, ChevronUp, ChevronDown, ListChecks } from 'lucide-react'
import { ResponsiveBar } from '@nivo/bar'
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
function componentesDe(l: LinhaRel | undefined, linhas: LinhaRel[]): string[] {
  if (!l) return []
  if ((l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') && l.expressao) {
    const cods = new Set(Array.from(l.expressao.matchAll(/\[([^\]]+)\]/g), m => m[1]))
    return linhas.filter(x => cods.has(x.codigo)).map(x => x.id)
  }
  if (l.tipo_linha === 'SOMAR_FILHOS') return linhas.filter(x => x.pai_id === l.id).map(x => x.id)
  return []
}

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
  const [aba, setAba] = useState<'orcamento' | 'comparativo'>(sv.aba === 'comparativo' ? 'comparativo' : 'orcamento')
  const [secOrc, setSecOrc] = useState<SecCfg>(SEC_PADRAO)
  const [metas, setMetas] = useState<IndicadorMeta[]>([])
  const [indicSel, setIndicSel] = useState<string[]>(arr(sv.indicSel) || [])
  const [pickIndic, setPickIndic] = useState(false)
  // Seção irmã, para linhas que NÃO são indicador — receita bruta, despesas
  // totais, um subtotal qualquer. Aqui vazio = NENHUMA, ao contrário dos
  // indicadores: são centenas de linhas, e "todas" encheria a tela de ruído.
  const [linhaSel, setLinhaSel] = useState<string[]>(arr(sv.linhaSel) || [])
  const [pickLinha, setPickLinha] = useState(false)
  const [porEmp, setPorEmp] = useState<{ empresa: string; valor: number }[]>([])
  const [porArea, setPorArea] = useState<{ rec: any[]; desp: any[]; ccRec: any[]; ccDesp: any[]; mes: any[] }>({ rec: [], desp: [], ccRec: [], ccDesp: [], mes: [] })
  const [drill, setDrill] = useState<{ nodeId: string; ccFilter?: string[] | null } | null>(null)
  const [secPonte, setSecPonte] = useState<SecCfg>(SEC_PADRAO)
  const [secVar, setSecVar] = useState<SecCfg>(SEC_PADRAO)
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
    f.aba && setAba(f.aba); Array.isArray(f.indicSel) && setIndicSel(f.indicSel); Array.isArray(f.linhaSel) && setLinhaSel(f.linhaSel)
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
    relId, vBase, modo, vComp, mesIni, mesFim, proj, aba, indicSel, linhaSel,
    empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel,
    secPonte, secVar, secAcur, secOrc,
  })
  useEffect(() => {
    if (cardId) return   // vendo um card: não contaminar o estado próprio da tela
    localStorage.setItem(SAVE, JSON.stringify(estado()))
  }, [cardId, relId, vBase, modo, vComp, mesIni, mesFim, proj, aba, indicSel, linhaSel,
      empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, secPonte, secVar, secAcur, secOrc]) // eslint-disable-line

  const meses = useMemo(() => Array.from({ length: Math.max(0, mesFim - mesIni + 1) }, (_, i) => mesIni + i), [mesIni, mesFim])
  // os meses DEPOIS do período, até dezembro
  const mesesProj = useMemo(
    () => (proj === 'OFF' ? [] : Array.from({ length: 12 - mesFim }, (_, i) => mesFim + 1 + i)),
    [proj, mesFim])

  const filialFilter = useMemo(() => escopoFiltro(filialSel.length ? filialSel : null, filiais, 'filial', acesso.canSee), [filialSel, filiais, acesso])
  const ccFilter = useMemo(() => escopoFiltro(effectiveCcFilter(ccs, ccSel, areaSel, divisaoSel, buSel), ccs, 'centro_custo', acesso.canSee), [ccs, ccSel, areaSel, divisaoSel, buSel, acesso])
  const empFiltradas = useMemo(() => empresaSel.filter(id => acesso.canSee('empresa', id)), [empresaSel, acesso])

  // ⚠ Os dois lados compartilham a versão da projeção: os meses projetados
  // ficam idênticos POR CONSTRUÇÃO e a variação neles é zero de mentira.
  const projContamina = modo === 'REAL' && proj === 'ORCADO' && vBase === vComp && mesesProj.length > 0
  // O realizado não cobre o período pedido: os meses que faltam entram como
  // ZERO. Vale nos DOIS modos — a seção de Acurácia usa realizado sempre, mesmo
  // quando a comparação principal é entre dois orçados. Antes o aviso só saía
  // no modo Realizado, e a acurácia comparava 12 meses de orçado contra 9 de
  // realizado em silêncio, fazendo tudo parecer "ficou abaixo".
  const realCurto = realAte > 0 && realAte < mesFim

  const todasSel = useMemo(
    () => Array.from(new Set([...secPonte.sel, ...secVar.sel, ...secAcur.sel])),
    [secPonte.sel, secVar.sel, secAcur.sel])

  const carregar = async () => {
    // ⚠ `anoBase`/`anoComp` saem do CATÁLOGO de versões, não do id. Com o id
    // restaurado do localStorage a guarda do id já passa antes de o catálogo
    // chegar — e aí a consulta ia com ano `undefined` e voltava vazia, com a
    // tela inteira zerada. Mexer em qualquer combo recarregava e "consertava",
    // que é o sintoma clássico de carga disparada cedo demais.
    if (!relId || !vBase || !vComp || !anoBase || !anoComp || !linhas.length || !empFiltradas.length || !todasSel.length) { setDados(null); return }
    setCarregando(true); setErro(null)
    try {
      const base = { linhas, ccs, empresas: empFiltradas, filialFilter, ccFilter, ccPermitidos: null as string[] | null }
      const chamar = (cen: string, anos: number[], ms: number[]) =>
        ms.length ? totaisRelatorio({ ...base, cen, anos, meses: ms }) : Promise.resolve({} as Record<string, number>)

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

      const [b, c, oa, ra, mens] = await Promise.all([
        serie(vBase, anoBase!),
        modo === 'ORC' ? serie(vComp, anoComp!) : serie('REALIZADO', anoComp!),
        // acurácia: orçado × realizado do ano comparado, sempre no período
        chamar(vComp, [anoComp!], meses),
        chamar('REALIZADO', [anoComp!], meses),
        // mensal da base: alimenta o detector de "linha reta"
        Promise.all(meses.map(m => chamar(vBase, [anoBase!], [m]))),
      ])

      const comp = c
      const mensalBase: Record<string, number[]> = {}
      mens.forEach((mm, i) => { for (const k in mm) (mensalBase[k] = mensalBase[k] || Array(meses.length).fill(0))[i] = mm[k] })

      setDados({ base: b, comp, orcAnt: oa, realAnt: ra, mensalBase })

      // ── orçado por empresa (aba Orçamento)
      // Uma chamada só e o motor roda por empresa, em vez de N chamadas de
      // totaisRelatorio: a linha de resultado costuma ser FÓRMULA, e somar o
      // agregado direto daria um número que não existe na DRE.
      const masters = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const alvo = secOrc.resultado
      if (masters.length && alvo) {
        const { data: le } = await supabase.rpc('relatorio_linha_empresa_agg', {
          p_versao: vBase, p_anos: [anoBase!], p_meses: meses,
          p_linhas: masters, p_filiais: filialFilter, p_ccs: ccFilter, p_slot: 1,
        })
        const rlOf: Record<string, string> = {}
        linhas.forEach(l => { if (l.linha_orc_id && !l.nao_soma) rlOf[l.linha_orc_id] = l.id })
        const calc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
        const PER: Periodo = { ano: anoBase!, mes: 1 }; const K = pkey(PER)
        const porEmpM: Record<string, Record<string, number>> = {}
        for (const x of (le as any[]) || []) {
          if (!empFiltradas.includes(x.empresa_id)) continue
          ;(porEmpM[x.empresa_id] = porEmpM[x.empresa_id] || {})[x.linha_id] = Number(x.orcado) || 0
        }
        const nomeEmp: Record<string, string> = {}
        empresas.forEach((e: any) => { nomeEmp[e.id] = `${e.codigo} · ${String(e.descricao || '').slice(0, 20)}` })
        const fAlvo = fatorExibicao(alvo, Object.fromEntries(linhas.map(l => [l.id, l])) as any)
        setPorEmp(Object.entries(porEmpM).map(([eid, byMaster]) => {
          const computed: Computed = {}; calc.forEach(l => { computed[l.id] = {} })
          for (const mm of masters) { const rl = rlOf[mm]; if (rl) computed[rl][K] = byMaster[mm] || 0 }
          return { empresa: nomeEmp[eid] || '?', valor: Math.round(fAlvo * (computeTotais(calc, computed, [PER])[alvo] || 0)) }
        }).filter(x => x.valor).sort((a, b) => b.valor - a.valor).slice(0, 14).reverse())
      } else setPorEmp([])

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
    } catch (e: any) {
      setErro(e?.message ?? String(e)); setDados(null)
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [relId, vBase, vComp, modo, mesIni, mesFim, proj, todasSel.join(','), empFiltradas.join(','), filialSel.join(','), ccSel.join(','), areaSel.join(','), divisaoSel.join(','), buSel.join(','), linhas.length, secOrc.resultado, anoBase, anoComp])

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
    secT: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
    secD: { fontSize: 12, color: 'var(--muted)', marginTop: 2 },
    th: { textAlign: 'right' as const, padding: '6px 8px', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: .4, color: 'var(--muted)', borderBottom: '1px solid var(--border)' },
    td: { textAlign: 'right' as const, padding: '6px 8px', fontSize: 13, fontFamily: 'monospace', borderBottom: '1px solid var(--panel)' },
  }

  const rotuloComp = modo === 'REAL'
    ? `Realizado ${anoComp ?? ''}` + (proj !== 'OFF' && mesesProj.length ? ` + projeção` : '')
    : `${versao(vComp)?.codigo ?? ''} · ${anoComp ?? ''}`

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
          <select style={S.sel} value={vComp} onChange={e => setVComp(e.target.value)}>
            {versoes.map(v => (
              // No modo Realizado a versão só serve para dizer o ANO. Mostrar o
              // código sugeriria que aquele realizado pertence àquela versão,
              // o que não existe.
              <option key={v.id} value={v.id}>{modo === 'REAL' ? `Realizado ${v.ano}` : `${v.codigo} · ${v.ano}`}</option>
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
        {mesFim < 12 && (
          <div><div style={S.lbl}>Meses seguintes ({MES[mesFim]}–dez)</div>
            <select style={{ ...S.sel, maxWidth: 320 }} value={proj} onChange={e => setProj(e.target.value as Proj)}>
              {(['OFF', 'MEDIA3', 'MEDIAPER', 'ULTIMO', ...(modo === 'REAL' ? ['ORCADO' as Proj] : [])] as Proj[])
                .map(k => <option key={k} value={k}>{PROJ_ROTULO[k]}</option>)}
            </select></div>
        )}

        <FiltrosButton empresas={empresas} filiais={filiais} ccs={ccs}
          empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel}
          ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel}
          divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
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
          {([['orcamento', 'Orçamento'], ['comparativo', 'Comparativo']] as const).map(([k, lbl]) => (
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
      ) : !dados ? null : aba === 'orcamento' ? (
        <VisaoOrcamento S={S} cfg={secOrc} setCfg={setSecOrc} linhas={linhas} nome={nome} val={val} fac={fac}
          base={dados.base} comp={dados.comp} mensal={dados.mensalBase} meses={meses} MES={MES}
          metas={metas} anoBase={anoBase} indicSel={indicSel} setIndicSel={setIndicSel} pick={pickIndic} setPick={setPickIndic}
          linhaSel={linhaSel} setLinhaSel={setLinhaSel} pickLinha={pickLinha} setPickLinha={setPickLinha}
          porEmp={porEmp} porArea={porArea} setDrill={setDrill}
          rotuloBase={versao(vBase)?.codigo ?? ''} rotuloComp={rotuloComp} />
      ) : (
        <>
          <Ponte S={S} cfg={secPonte} setCfg={setSecPonte} linhas={linhas} nome={nome}
            base={dados.base} comp={dados.comp} rotuloBase={versao(vBase)?.codigo ?? ''} rotuloComp={rotuloComp} />

          <Variacao S={S} cfg={secVar} setCfg={setSecVar} linhas={linhas} nome={nome} fac={fac}
            base={dados.base} comp={dados.comp} val={val} rotuloBase={versao(vBase)?.codigo ?? ''} rotuloComp={rotuloComp} />

          <Acuracia S={S} cfg={secAcur} setCfg={setSecAcur} linhas={linhas} nome={nome}
            orc={dados.orcAnt} real={dados.realAnt} val={val} ano={anoComp} />

          <Alertas S={S} linhas={linhas} nome={nome} sel={secVar.sel}
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
function VisaoOrcamento({ S, cfg, setCfg, linhas, nome, val, fac, base, comp, mensal, meses, MES, metas, anoBase, indicSel, setIndicSel, pick, setPick, linhaSel, setLinhaSel, pickLinha, setPickLinha, porEmp, porArea, setDrill, rotuloBase, rotuloComp }: any) {
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
              axisLeft={{ format: (v: any) => fmt(Number(v)) }} enablePoints pointSize={5} useMesh
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
                axisBottom={{ format: (v: any) => fmt(Number(v)) }} enableGridY={false}
                labelSkipWidth={44} label={(d: any) => fmt(Number(d.value))} />
            </div>
          )}
        </div>

        <div style={S.sec}>
          <div style={S.secH}><div>
            <div style={S.secT}>Por empresa</div>
            <div style={S.secD}>{alvo ? alvo.descricao : '—'} orçado em {rotuloBase}, por empresa.</div>
          </div></div>
          {!porEmp.length ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>Sem valor por empresa para os filtros atuais.</div> : (
            <div style={{ ...cx, height: alt(porEmp.length) }}>
              <ResponsiveBar theme={nivoTheme()} data={porEmp} keys={['valor']} indexBy="empresa"
                layout="horizontal" margin={{ top: 6, right: 24, bottom: 34, left: 150 }}
                colors={({ data }: any) => (data.valor >= 0 ? '#5f3dc4' : '#e03131')}
                axisBottom={{ format: (v: any) => fmt(Number(v)) }} enableGridY={false}
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
              xScale={{ type: 'point' }} yScale={{ type: 'linear' }} axisLeft={{ format: (v: any) => fmt(Number(v)) }}
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
                colors={cor} enableGridY={false} axisBottom={{ format: (v: any) => fmt(Number(v)) }}
                labelSkipWidth={44} label={(d: any) => fmt(Number(d.value))}
                onClick={(d: any) => {
                  const no = raizDe(chave === 'rec' || chave === 'ccRec' ? 'RECEITA' : 'DESPESA') || cfg.resultado
                  if (no) setDrill({ nodeId: no, ccFilter: d.data._ccs?.length ? d.data._ccs : null })
                }} />
            </div>
          </div>
        )
      })}

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

/** Seletor de linhas da seção, em ordem de ÁRVORE (ver emArvore). */
function SelLinhas({ cfg, setCfg, linhas, limiar }: { cfg: SecCfg; setCfg: (c: SecCfg) => void; linhas: LinhaRel[]; limiar?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const ok = useMemo(() => new Set(linhasConciliaveis(linhas).map((l: any) => l.id)), [linhas])
  const arv = useMemo(() => emArvore(linhas as any).filter((l: any) => ok.has(l.id)), [linhas, ok])
  return (
    <div style={{ position: 'relative' }} data-noexport>
      <button onClick={() => setAberto(v => !v)}
        style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text-mid)', cursor: 'pointer' }}>
        {cfg.sel.length} linha(s){limiar ? ` · ≥${cfg.pct}% e ≥${cfg.minPctTotal}% do total` : ''} ▾
      </button>
      {aberto && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setAberto(false)} />
          <div style={{ position: 'absolute', top: 32, right: 0, zIndex: 41, width: 360, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
            {limiar && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                <label style={{ flex: 1, fontSize: 11, color: 'var(--muted)' }}>variação ≥
                  <input type="number" value={cfg.pct} onChange={e => setCfg({ ...cfg, pct: Number(e.target.value) })}
                    style={{ width: '100%', marginTop: 3, padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} /> %
                </label>
                {/* Auto-escalar: limiar fixo em R$ está errado em alguma seção
                    por definição — receita e despesa de viagem não cabem no
                    mesmo número. */}
                <label style={{ flex: 1, fontSize: 11, color: 'var(--muted)' }}>e ≥ % do total
                  <input type="number" step="0.1" value={cfg.minPctTotal} onChange={e => setCfg({ ...cfg, minPctTotal: Number(e.target.value) })}
                    style={{ width: '100%', marginTop: 3, padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
                </label>
              </div>
            )}
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {arv.map((l: any) => (
                <label key={l.id} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', padding: '3px 4px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}>
                  <input type="checkbox" checked={cfg.sel.includes(l.id)} style={{ marginTop: 2, flexShrink: 0 }}
                    onChange={() => setCfg({ ...cfg, sel: cfg.sel.includes(l.id) ? cfg.sel.filter(x => x !== l.id) : [...cfg.sel, l.id] })} />
                  <span style={{ paddingLeft: l.prof * 13, fontWeight: l.prof === 0 ? 600 : 400 }}>{l.descricao}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── 1 · A PONTE ─────────────────────────────────────────────
// O único gráfico que responde "de onde vem o crescimento" numa imagem.
// Sempre com a TABELA ao lado: cascata se lê por aproximação — a altura dá
// ordem de grandeza, não valor, e quem aprova precisa do número exato.
function Ponte({ S, cfg, setCfg, linhas, nome, base, comp, rotuloBase, rotuloComp }: any) {
  // ⚠ SINAL ECONÔMICO, não o de exibição. O resto da tela mostra despesa
  // positiva (fatorExibicao inverte), mas numa ponte isso quebra tudo: uma
  // despesa que CRESCE 20 viraria barra verde +20, sugerindo melhora, quando o
  // efeito no resultado é −20 — e o caminho nunca fecharia no fim.
  // Com o sinal cru, receita entra positiva, despesa negativa, e a soma dos
  // componentes dá a variação do resultado. É o que faz a ponte fechar.
  const v = (src: any, id: string) => src?.[id] ?? 0
  const resId = cfg.resultado
  const ini = resId ? v(comp, resId) : 0
  const fim = resId ? v(base, resId) : 0

  const itens = cfg.sel.filter((id: string) => id !== resId)
    .map((id: string) => ({ id, nome: nome(id), d: v(base, id) - v(comp, id) }))
    .filter((x: any) => Math.abs(x.d) > 0.005)
    .sort((a: any, b: any) => Math.abs(b.d) - Math.abs(a.d))

  // O RESÍDUO é a honestidade da ponte: se os componentes não explicam a
  // variação do resultado, a decomposição está incompleta ou se sobrepõe — e
  // isso tem de aparecer em vez de o gráfico fingir que fecha.
  const explicado = itens.reduce((s: number, x: any) => s + x.d, 0)
  const residuo = (fim - ini) - explicado
  const barras = [...itens, ...(Math.abs(residuo) > Math.max(1, Math.abs(fim - ini) * 0.001)
    ? [{ id: '__resid', nome: 'não explicado', d: residuo }] : [])]

  // Escala SEM forçar o zero: num bridge o início é muito maior que as
  // variações, e incluir o zero achata tudo — foi o que aconteceu na primeira
  // versão. Eixo na faixa do caminho, com folga.
  let ac = ini; const pts = [ini, fim]
  for (const b of barras) { ac += b.d; pts.push(ac) }
  const mn = Math.min(...pts), mx = Math.max(...pts)
  const folga = (mx - mn || Math.abs(mx) || 1) * 0.18
  const lo = mn - folga, hi = mx + folga, amp = hi - lo || 1
  const H = 210
  const y = (v: number) => ((hi - v) / amp) * H

  let cur = ini
  const passos = barras.map((b: any) => { const de = cur; cur += b.d; return { ...b, de, ate: cur } })
  const cols = [{ tot: true, lab: rotuloComp, v: ini, de: lo, ate: ini },
                ...passos.map((p: any) => ({ tot: false, lab: p.nome, v: p.d, de: p.de, ate: p.ate, id: p.id })),
                { tot: true, lab: rotuloBase, v: fim, de: lo, ate: fim }]
  const W = 78

  const opcoes = emArvore(linhas as any).filter((l: any) => linhasConciliaveis(linhas).some((x: any) => x.id === l.id))

  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>A ponte — de onde vem a variação</div>
          <div style={S.secD}>
            Decompõe a variação de <strong>uma</strong> linha de resultado. Os componentes precisam
            ser <strong>independentes</strong> — subtotal junto com componente conta duas vezes, e o
            resíduo denuncia. Os componentes saem da <strong>própria estrutura do relatório</strong> — a fórmula da linha, ou as filhas de um subtotal. Aqui a despesa aparece <strong>negativa</strong>: a barra mostra o efeito
            no resultado, não a convenção de exibição do resto da tela.
          </div></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} data-noexport>
          <select value={resId ?? ''} onChange={e => {
              const novo = e.target.value
              const der = componentesDe(linhas.find((l: LinhaRel) => l.id === novo), linhas)
              // se a estrutura não souber dizer, preserva a escolha manual
              setCfg({ ...cfg, resultado: novo, sel: der.length ? der : cfg.sel })
            }}
            style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text)', maxWidth: 220 }}>
            <option value="">— linha de resultado —</option>
            {opcoes.map((l: any) => <option key={l.id} value={l.id}>{'\u00A0'.repeat(l.prof * 2)}{l.descricao}</option>)}
          </select>
          {componentesDe(linhas.find((l: LinhaRel) => l.id === resId), linhas).length > 0 && (
            <button onClick={() => setCfg({ ...cfg, sel: componentesDe(linhas.find((l: LinhaRel) => l.id === resId), linhas) })}
              title="Voltar aos componentes que a própria estrutura do relatório declara"
              style={{ padding: '5px 10px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--violet)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              usar os da estrutura
            </button>
          )}
          <SelLinhas cfg={cfg} setCfg={setCfg} linhas={linhas} />
        </div>
      </div>

      {!resId ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Escolha a linha de resultado a decompor.</div>
       : !barras.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sem variação nos componentes escolhidos.</div> : (
        <>
          {Math.abs(residuo) > Math.abs(fim - ini) * 0.15 && (
            <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 10 }}>
              ⚠ {fmt(Math.abs(residuo))} ({Math.abs(residuo / ((fim - ini) || 1) * 100).toFixed(0)}% da variação) não é explicado
              pelos componentes. Provavelmente há <strong>subtotal junto com componente</strong> na seleção, ou falta um componente.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(290px, 400px)', gap: 20, alignItems: 'start' }}>
            <div style={{ overflowX: 'auto' }}>
              <svg width={Math.max(380, cols.length * W)} height={H + 46}>
                {cols.map((c: any, i: number) => {
                  const y0 = y(Math.max(c.de, c.ate)), y1 = y(Math.min(c.de, c.ate))
                  const cor = c.tot ? 'var(--violet)' : c.id === '__resid' ? 'var(--orange)' : c.v >= 0 ? 'var(--green)' : 'var(--red)'
                  return (
                    <g key={i}>
                      <rect x={i * W + 12} y={y0} width={W - 26} height={Math.max(3, y1 - y0)} fill={cor} rx={3} opacity={c.tot ? 1 : .9} />
                      <text x={i * W + (W - 2) / 2} y={Math.max(11, y0 - 5)} textAnchor="middle" fontSize={10} fill="var(--text-mid)" fontFamily="monospace">
                        {c.tot ? fmt(c.v) : `${c.v >= 0 ? '+' : ''}${fmt(c.v)}`}
                      </text>
                      <text x={i * W + (W - 2) / 2} y={H + 18} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
                        {String(c.lab).length > 12 ? String(c.lab).slice(0, 11) + '…' : c.lab}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...S.th, textAlign: 'left' }}>{nome(resId)}</th><th style={S.th}>variação</th></tr></thead>
              <tbody>
                <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--muted)' }}>{rotuloComp}</td><td style={S.td}>{fmt(ini)}</td></tr>
                {passos.map((b: any) => (
                  <tr key={b.id}><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: b.id === '__resid' ? 'var(--orange)' : undefined }}>{b.nome}</td>
                    <td style={{ ...S.td, color: b.id === '__resid' ? 'var(--orange)' : b.d >= 0 ? 'var(--green)' : 'var(--red)' }}>{b.d >= 0 ? '+' : ''}{fmt(b.d)}</td></tr>
                ))}
                <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>{rotuloBase}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{fmt(fim)}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── 2 · VARIAÇÃO POR LINHA ──────────────────────────────────
// Limiar DUPLO: percentual E valor mínimo, juntos. 40% numa conta de R$ 800 é
// ruído; 3% na folha é a maior conversa do orçamento. Só o percentual enche a
// tela de bobagem; só o absoluto esconde a conta pequena que dobrou.
function Variacao({ S, cfg, setCfg, linhas, nome, base, comp, val, fac, rotuloBase, rotuloComp }: any) {
  // O limiar foca a atenção; esconder o resto para sempre tira a conferência.
  const [todas, setTodas] = useState(false)
  const total = cfg.sel.reduce((s: number, id: string) => s + Math.abs(val(base, id)), 0)
  const minAbs = total * (cfg.minPctTotal / 100)
  const linhasTodas = cfg.sel.map((id: string) => {
    const b = val(base, id), c = val(comp, id)
    return { id, nome: nome(id), b, c, d: b - c, pct: c !== 0 ? ((b - c) / Math.abs(c)) * 100 : (b !== 0 ? Infinity : 0) }
  })
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
  const destaque = linhasTodas.filter(marca).sort((a: any, b: any) => Math.abs(b.d) - Math.abs(a.d))
  const resto = linhasTodas.filter((x: any) => !marca(x))
  const somaResto = resto.reduce((s: number, x: any) => s + x.d, 0)
  const todas0 = linhasTodas.length

  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>O que mudou</div>
          <div style={S.secD}>
            Ordenado por <strong>impacto</strong>, não por tamanho. Marcado o que passa de {cfg.pct}% <em>e</em> de {cfg.minPctTotal}% do total ({fmt(minAbs)}).
            {' '}<span style={{ color: 'var(--green)' }}>Verde</span> é melhora e <span style={{ color: 'var(--red)' }}>vermelho</span> é piora — numa despesa, cair é melhorar.
            {resto.length > 0 && (
              <span data-noexport style={{ marginLeft: 8, color: 'var(--violet)', cursor: 'pointer' }} onClick={() => setTodas(v => !v)}>
                {todas ? `ver só as ${destaque.length} acima do limiar` : `mostrar todas as ${todas0} linhas`}
              </span>
            )}
          </div></div>
        <SelLinhas cfg={cfg} setCfg={setCfg} linhas={linhas} limiar />
      </div>
      <Tabela S={S} arquivo={`variacao-${rotuloBase}`}
        rows={(todas ? [...destaque, ...resto.map((r: any) => ({ ...r, _fraco: true }))] : destaque)}
        cols={[
          { key: 'nome', label: 'linha' },
          { key: 'c', label: String(rotuloComp), num: true, render: (r: any) => fmt(r.c) },
          { key: 'b', label: String(rotuloBase), num: true, render: (r: any) => fmt(r.b) },
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
function Acuracia({ S, cfg, setCfg, linhas, nome, orc, real, val, ano }: any) {
  // Por padrão esconde linha sem nada nos dois lados; mas esconder para sempre
  // tira a conferência de "por que esta linha não aparece?".
  const [todas, setTodas] = useState(false)
  const itens = cfg.sel.map((id: string) => {
    const o = val(orc, id), r = val(real, id)
    return { id, nome: nome(id), o, r, erro: r - o, pct: o !== 0 ? ((r - o) / Math.abs(o)) * 100 : (r !== 0 ? Infinity : 0) }
  }).map((x: any) => ({ ...x, _fraco: x.o === 0 && x.r === 0 }))
    .filter((x: any) => todas || !x._fraco)
    .sort((a: any, b: any) => Math.abs(b.erro) - Math.abs(a.erro))
  const vazias = cfg.sel.length - itens.filter((x: any) => !x._fraco).length

  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>Acurácia do orçamento de {ano ?? '—'}</div>
          <div style={S.secD}>
            Orçado × realizado do ano comparado. Não é para julgar o passado — é para saber
            <strong> em quem acreditar</strong> no orçamento novo.
            {vazias > 0 && (
              <span data-noexport style={{ marginLeft: 8, color: 'var(--violet)', cursor: 'pointer' }} onClick={() => setTodas(v => !v)}>
                {todas ? 'ocultar as sem valor' : `mostrar todas (${vazias} sem valor)`}
              </span>
            )}
          </div></div>
        <SelLinhas cfg={cfg} setCfg={setCfg} linhas={linhas} />
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
          ]} />
      )}
    </div>
  )
}

// ── 4 · ALERTAS ─────────────────────────────────────────────
// Barato de calcular e pega problema real. O mais importante é "sumiu": linha
// que desaparece não aparece em lugar nenhum — só o total denuncia, e tarde.
function Alertas({ S, nome, sel, base, comp, mensal, val, nMeses }: any) {
  const alertas: { tipo: string; cor: string; nome: string; detalhe: string }[] = []
  for (const id of sel) {
    const b = val(base, id), c = val(comp, id)
    const mm = mensal[id] || []
    if (Math.abs(b) < 0.005 && Math.abs(c) > 0.005)
      alertas.push({ tipo: 'sumiu', cor: 'var(--red)', nome: nome(id), detalhe: `tinha ${fmt(c)} e ficou sem orçado` })
    else if (Math.abs(c) < 0.005 && Math.abs(b) > 0.005)
      alertas.push({ tipo: 'nova', cor: 'var(--cyan)', nome: nome(id), detalhe: `${fmt(b)} sem nada no comparado — merece justificativa` })
    else if (Math.abs(b - c) < 0.005 && Math.abs(b) > 0.005)
      alertas.push({ tipo: 'idêntica', cor: 'var(--orange)', nome: nome(id), detalhe: `igual ao comparado, centavo a centavo — copiada sem revisar?` })
    if (nMeses >= 6 && mm.length === nMeses && Math.abs(mm[0]) > 0.005 && mm.every((v: number) => Math.abs(v - mm[0]) < 0.005))
      alertas.push({ tipo: 'linha reta', cor: 'var(--orange)', nome: nome(id), detalhe: `os ${nMeses} meses são idênticos — "dividi por doze"?` })
  }
  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>Alertas</div>
          <div style={S.secD}>Orçamento feito no automático, e o que sumiu. Usa as linhas da seção <em>O que mudou</em>.</div></div>
      </div>
      {!alertas.length ? (
        <div style={{ fontSize: 13, color: 'var(--green)' }}>✓ Nada a apontar nas linhas analisadas.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alertas.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13 }}>
              <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: .5, color: a.cor, minWidth: 82, fontWeight: 700 }}>{a.tipo}</span>
              <span style={{ color: 'var(--text)' }}>{a.nome}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>— {a.detalhe}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
