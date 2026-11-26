import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronLeft, AlertTriangle, Layers, ListFilter, EyeOff, GitCompare, BadgeCheck, Loader2, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { carregarVersoes } from '../../lib/escopoDados'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useLocalPref } from '../../lib/uiPrefs'
import { effectiveCcFilter, escopoFiltro, FiltrosButton, PillsDim } from '../dashboard/DashFiltros'
import { useCapacidades } from '../../hooks/useCapacidades'
import DrillCombinacoes from './DrillCombinacoes'
import NovoCenario from './NovoCenario'
import VereditoLinha, { type Veredito } from './VereditoLinha'
import LiberarCenario from './LiberarCenario'
import CenarioManutencao from './CenarioManutencao'
import HistoricoLiberacao from './HistoricoLiberacao'
import { variacaoBoa } from '../../lib/refRelatorio'

// ============================================================
// Orçar por LINHA — a visão de quem analisa, não de quem digita célula.
//
// A grade (`/orcar-grade`) fixa UMA combinação empresa×filial×CC no cabeçalho:
// é a tela certa para preencher, e errada para enxergar. Um gerente com seis
// centros de custo via o número partido em seis e tinha de entrar em cada um
// para somar de cabeça.
//
// Aqui a linha vem INTEIRA, somando tudo que está no escopo. E o consolidado é
// **só leitura**, de propósito:
//
// ⚠ NÃO EXISTE "GRAVAR CONSOLIDADO". `fat_orcado` é único por (versão, linha,
// empresa, filial, cc, ano, mês): para digitar num total alguém teria de
// decidir em qual combinação aquilo cai. As saídas seriam ratear (regra nova,
// que engana — você digita 100, vê 100, e virou 37+41+22) ou gravar numa linha
// de filial/CC nulos, que é como a grade trata "— consolidado —" e é a origem
// das 15.613 linhas de grão consolidado e de 50 dos 122 grupos MISTOS (conta
// 20601, versão de 2026). Por isso: aqui se lê o total e se edita no DRILL.
//
// Os outros 72 grupos NÃO vêm da digitação: são rateio de posto cujo destino
// não tem CC (19 dos 25 `rateio_destino`), e aí os dois lados somam em vez de
// se sobrepor. Medido em 04/nov — vale saber antes de sair "consertando" o
// aviso ⚠ como se fosse tudo a mesma causa. 2027 não tem nenhum dos dois.
//
// ⚠ `fat_orcado.linha_id` É O MASTER (`conta_orcamentaria`), não `relatorio_linha`.
// O CLAUDE.md dizia o contrário e foi o que me fez escrever a primeira versão
// desta tela somando por id de linha de relatório — tudo vinha vazio, sem erro
// nenhum, porque os dois lados são uuid e simplesmente não casam. A ponte é
// `relatorio_linha.linha_orc_id`.
//
// ⚠ E esta é a única tela onde o grão misto aparece: somando tudo, uma linha
// que tem consolidado E detalhe soma os dois e infla. O aviso ⚠ na linha
// denuncia em vez de deixar o número mentir — era invisível na grade, porque
// lá cada grão fica num filtro diferente.
// ============================================================

type Linha = { id: string; pai_id: string | null; codigo: string; descricao: string; tipo_linha: any; expressao: string | null; natureza: string | null; linha_orc_id: string | null; desativada: boolean; nao_soma: boolean; ordem: number | null }
type Opt = { id: string; codigo: string; descricao: string }
type Versao = { id: string; codigo: string; ano: number; bloqueada: boolean; origem_versao_id: string | null; aprovado_em: string | null }

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const S = {
  sel: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--panel)', color: 'var(--text)', fontSize: 13 } as React.CSSProperties,
  lbl: { fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 4 },
  th: { padding: '8px 10px', fontSize: 12, color: 'var(--muted)', fontWeight: 600, background: 'var(--bg)', borderBottom: '1px solid var(--border)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const },
  td: { padding: '5px 10px', borderBottom: '1px solid var(--panel-2)', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
}

export default function OrcarLinhaPage() {
  const { id: relId } = useParams()
  const acesso = useUserAccess()
  const cap = useCapacidades()
  const [relNome, setRelNome] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Opt[]>([])
  // ⚠ TODA configuração desta tela é lembrada POR RELATÓRIO. Remontar versão,
  // ano, filtros e seções a cada visita é o atrito que faz a pessoa parar de
  // usar o recorte — e aqui são seis controles, não um. A chave leva o `relId`
  // porque a seleção de seções de uma DRE não faz sentido noutra.
  const pref = `planorc_orcarlinha_${relId}`
  const [versaoId, setVersaoId] = useLocalPref<string>(`${pref}_versao`, '')
  // Mesmo filtro das outras telas (dashboards, Memória, Organograma): empresa,
  // filial, CC e as facetas área/divisão/BU, cruzados com o escopo do usuário.
  const [empresaSel, setEmpresaSel] = useLocalPref<string[]>(`${pref}_empresa`, [])
  const [filialSel, setFilialSel] = useLocalPref<string[]>(`${pref}_filial`, [])
  const [ccSel, setCcSel] = useLocalPref<string[]>(`${pref}_cc`, [])
  const [areaSel, setAreaSel] = useLocalPref<string[]>(`${pref}_area`, [])
  const [divisaoSel, setDivisaoSel] = useLocalPref<string[]>(`${pref}_divisao`, [])
  const [buSel, setBuSel] = useLocalPref<string[]>(`${pref}_bu`, [])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [ano, setAno] = useLocalPref<number>(`${pref}_ano`, new Date().getFullYear())
  const [semZeradas, setSemZeradas] = useLocalPref<boolean>(`${pref}_semzeradas`, false)
  const [secOcultas, setSecOcultas] = useLocalPref<string[]>(`${pref}_secoes`, [])
  const [secAberto, setSecAberto] = useState(false)
  const [cels, setCels] = useState<Record<string, Record<number, { v: number; n: number }>>>({})
  const [misto, setMisto] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [carregandoCels, setCarregandoCels] = useState(false)
  const [drill, setDrill] = useState<Linha | null>(null)
  const [erro, setErro] = useState('')
  const [recarga, setRecarga] = useState(0)   // o drill mexeu no dado: força o consolidado a refazer
  // --- cenário (B2) ---
  const [celsBase, setCelsBase] = useState<Record<string, Record<number, { v: number; n: number }>>>({})
  const [vereditos, setVereditos] = useState<Record<string, Veredito>>({})
  const [modoComp, setModoComp] = useState(true)
  const [soAlteradas, setSoAlteradas] = useLocalPref<boolean>(`${pref}_soalteradas`, false)
  const [fechando, setFechando] = useState(false)
  const [carimbo, setCarimbo] = useState<{ em: string | null; nota: string | null; mesclado: string | null }>({ em: null, nota: null, mesclado: null })
  // ⚠ O DIFF VEM DO SERVIDOR, não da tela. A completude do cenário não pode
  // depender do filtro de quem olha: com Seções em 1/32 a barra dizia "1 linha
  // alterada · todas decididas" enquanto havia uma receita de -696 mil sem
  // veredito, escondida pelo recorte — e o fechamento era recusado sem que
  // desse para ver por quê. `cenario_orcado_diff` é a MESMA fonte que
  // `aprovar_cenario` usa para contar, então as duas passam a concordar.
  const [diffServidor, setDiffServidor] = useState<{ linha_id: string; base: number; cenario: number; celulas_dif?: number }[]>([])
  // ⚠⚠ GRÃO DIFERENTE COM SOMA IGUAL (v3_208). Trocar o CC de uma célula não
  // mexe no total da linha — e até aqui isso era invisível em toda parte: o
  // comparativo não mostrava Δ, o botão de ressincronizar nem aparecia, e
  // `cenario_orcado_pendentes` não pedia veredito. **Movia-se dinheiro de área
  // sem que ninguém decidisse.** Agora a RPC conta as células que divergem por
  // `empresa·filial·cc·mês`, e esta marca é o que torna isso visível na linha.
  const soGrao = useMemo(() => {
    const m = new Set<string>()
    for (const d of diffServidor)
      if ((d.celulas_dif || 0) > 0 && Math.abs((d.cenario || 0) - (d.base || 0)) <= 0.005) m.add(d.linha_id)
    return m
  }, [diffServidor])

  useEffect(() => {
    (async () => {
      const [rel, lr, vs, emp, fl, cc] = await Promise.all([
        supabase.from('relatorio').select('nome').eq('id', relId).maybeSingle(),
        supabase.from('relatorio_linha').select('id,pai_id,codigo,descricao,tipo_linha,expressao,natureza,linha_orc_id,desativada,nao_soma,ordem').eq('relatorio_id', relId).order('ordem', { nullsFirst: false }),
        carregarVersoes('id,codigo,ano,bloqueada,origem_versao_id,aprovado_em', { ativa: true, ordem: 'ano_desc' }).then(d => ({ data: d })),
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      ])
      setRelNome(rel.data?.nome || '')
      setLinhas((lr.data || []) as Linha[])
      setVersoes((vs.data || []) as Versao[])
      setEmpresas((emp.data || []) as Opt[])
      setFiliais(fl.data || []); setCcs(cc.data || [])
      setLoading(false)
    })()
  }, [relId])

  // Depois de semear, a lista de versões tem de incluir a nova — e a tela tem
  // de ir para ela, senão quem acabou de criar o cenário continua olhando a
  // baseline e edita o lugar errado.
  async function recarregarVersoes(selecionar?: string) {
    const vs = await carregarVersoes('id,codigo,ano,bloqueada,origem_versao_id,aprovado_em', { ativa: true, ordem: 'ano_desc' })
    setVersoes((vs || []) as Versao[])
    if (selecionar) { setVersaoId(selecionar); return }
    // ⚠ A versão escolhida pode ter deixado de existir — excluir o cenário é
    // justamente isso. Sem soltar a seleção, a tela seguiria pedindo células de
    // uma versão apagada e viria vazia, sem erro e sem explicação.
    if (versaoId && !(vs || []).some((v: any) => v.id === versaoId)) setVersaoId('')
  }

  const empresasEscopo = useMemo(() => acesso.filterList('empresa', empresas as any) as Opt[], [empresas, acesso])
  // Seleção de tela ∩ escopo do usuário — `escopoFiltro` faz a interseção, e
  // seleção vazia cai no escopo permitido, não em "tudo".
  const filtro = useMemo(() => ({
    emp: escopoFiltro(empresaSel.length ? empresaSel : null, empresas as any, 'empresa', acesso.canSee),
    fil: escopoFiltro((filialSel.length && filialSel.length < filiais.length) ? filialSel : null, filiais as any, 'filial', acesso.canSee),
    cc: escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee),
  }), [empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, empresas, filiais, ccs, acesso])
  const versao = versoes.find(v => v.id === versaoId)
  // Versão com origem é CENÁRIO: é o que liga o modo comparativo e o veredito.
  const baseId = versao?.origem_versao_id || null
  useEffect(() => { if (versao?.ano) setAno(versao.ano) }, [versao?.ano]) // eslint-disable-line

  const byId = useMemo(() => Object.fromEntries(linhas.map(l => [l.id, l])), [linhas])
  const natEff = (id: string | null): string => { let c: any = id ? byId[id] : undefined, g = 0; while (c && g++ < 60) { if (c.natureza === 'RECEITA' || c.natureza === 'DESPESA') return c.natureza; c = c.pai_id ? byId[c.pai_id] : undefined } return '' }
  const fac = (l: Linha) => natEff(l.id) === 'DESPESA' ? -1 : 1
  const depth = (l: Linha) => { let d = 0, c: any = l; while (c?.pai_id && byId[c.pai_id] && d < 60) { d++; c = byId[c.pai_id] } return d }
  const ordered = useMemo(() => {
    const byPai: Record<string, Linha[]> = {}
    linhas.forEach(l => { const k = l.pai_id || '__root'; (byPai[k] = byPai[k] || []).push(l) })
    Object.values(byPai).forEach(a => a.sort((x, y) => (x.ordem ?? 9999) - (y.ordem ?? 9999)))
    const out: Linha[] = [], seen = new Set<string>()
    const walk = (p: string) => { for (const n of byPai[p] || []) { if (seen.has(n.id)) continue; seen.add(n.id); out.push(n); walk(n.id) } }
    walk('__root'); for (const l of linhas) if (!seen.has(l.id)) { seen.add(l.id); out.push(l) }
    return out
  }, [linhas])
  // Mesmo recorte por natureza da grade: quem só orça despesa não precisa da receita.
  const natOk = (l: Linha) => { const n = natEff(l.id); return n === 'RECEITA' ? cap.can('orcar.receita') : n === 'DESPESA' ? cap.can('orcar.despesa') : cap.can('orcar.neutra') }
  // Rollup: sintética soma as filhas; analítica usa o que veio do banco.
  // Fica ANTES de `vis` porque esconder zeradas depende dele.
  const rollup = (fonte: Record<string, Record<number, { v: number; n: number }>>) => {
    const out: Record<string, Record<number, number>> = {}
    const filhos: Record<string, Linha[]> = {}
    linhas.forEach(l => { const k = l.pai_id || '__root'; (filhos[k] = filhos[k] || []).push(l) })
    const calc = (l: Linha): Record<number, number> => {
      if (out[l.id]) return out[l.id]
      const r: Record<number, number> = {}
      const fs = filhos[l.id] || []
      if (fs.length) { for (const f of fs) { const v = calc(f); for (let m = 1; m <= 12; m++) r[m] = (r[m] || 0) + (v[m] || 0) } }
      else { const c = (l.linha_orc_id && !l.nao_soma ? fonte[l.linha_orc_id] : null) || {}; for (let m = 1; m <= 12; m++) r[m] = c[m]?.v || 0 }
      out[l.id] = r; return r
    }
    linhas.forEach(calc)
    return out
  }
  const total = useMemo(() => rollup(cels), [linhas, cels]) // eslint-disable-line
  // Mesmo rollup para a baseline: somar de um jeito aqui e de outro ali daria
  // um Δ que é diferença de método, não de proposta.
  const totalBase = useMemo(() => rollup(celsBase), [linhas, celsBase]) // eslint-disable-line

  const secoes = useMemo(() => ordered.filter(l => !l.pai_id), [ordered])
  const secOcultasSet = useMemo(() => new Set(secOcultas), [secOcultas])
  // Raiz de cada linha: esconder uma seção leva as filhas junto — ninguém
  // desmarca linha a linha.
  const raizDe = (l: Linha): string => { let c: any = l; let g = 0; while (c?.pai_id && byId[c.pai_id] && g++ < 60) c = byId[c.pai_id]; return c?.id || l.id }

  const vis = useMemo(() => {
    const base = ordered.filter(natOk).filter(l => !secOcultasSet.has(raizDe(l)))
    if (!semZeradas) return base
    // ⚠ Esconder zerada é de EXIBIÇÃO: o rollup já foi calculado com tudo, e
    // sintética que ficou sem filha visível também sai — senão sobra um
    // cabeçalho sem conteúdo, que parece defeito.
    const temValor = (l: Linha) => Object.values(total[l.id] || {}).some(v => v !== 0)
    return base.filter(temValor)
  }, [ordered, cap, secOcultasSet, semZeradas, total]) // eslint-disable-line

  const anoDe = (t: Record<string, Record<number, number>>, id: string) =>
    Object.values(t[id] || {}).reduce((s, x) => s + x, 0)
  const ehCenario = !!baseId
  const comparando = ehCenario && modoComp
  // "Só alteradas" guarda a SINTÉTICA cujo filho mudou — o Δ dela já soma as
  // filhas, então o contexto da árvore se preserva sozinho. Esconder os pais
  // deixaria uma lista de linhas soltas sem dizer de que bloco saíram.
  const visComp = useMemo(() => {
    if (!comparando || !soAlteradas) return vis
    // ⚠⚠ "Alterada" inclui a que só mudou de GRÃO. Filtrando só por valor, a
    // linha cujo CC mudou era escondida **justamente** de quem pediu para ver
    // só as alteradas — e é a mais difícil de achar, porque o total não
    // denuncia. Mesmo defeito do botão ↺ que sumia, um nível acima.
    return vis.filter(l => Math.abs(anoDe(total, l.id) - anoDe(totalBase, l.id)) > 0.005
      || !!(l.linha_orc_id && soGrao.has(l.linha_orc_id)))
  }, [vis, comparando, soAlteradas, total, totalBase, soGrao]) // eslint-disable-line

  // Nome legível de um MASTER (conta_orcamentaria), pela árvore do relatório.
  const nomeMaster = (mid: string | null) => {
    if (!mid) return '—'
    const l = linhas.find(x => x.linha_orc_id === mid)
    return l ? l.descricao : (mid || '').slice(0, 8)
  }

  // ⚠ Conta pelo DIFF DO SERVIDOR, não pelo que a tela mostra. Era por linha
  // visível, e com filtro a barra dizia "todas decididas" enquanto o
  // fechamento era recusado — o número da tela e o do banco discordavam, e o
  // da tela era o errado.
  const resumoCenario = useMemo(() => {
    if (!comparando) return { mudadas: 0, pendentes: 0, ocultas: [] as string[] }
    const pend = diffServidor.filter(d => vereditos[d.linha_id]?.aprovado == null)
    const visiveis = new Set(vis.map(l => l.linha_orc_id).filter(Boolean) as string[])
    return { mudadas: diffServidor.length, pendentes: pend.length,
             ocultas: pend.filter(d => !visiveis.has(d.linha_id)).map(d => nomeMaster(d.linha_id)) }
  }, [comparando, diffServidor, vereditos, vis, linhas]) // eslint-disable-line

  // Carrega o consolidado. Lê fat_orcado direto (e não a RPC de agregação)
  // porque além do total precisamos saber se há GRÃO MISTO — e isso só se vê
  // olhando se existem linhas com cc nulo e não nulo na mesma célula.
  //
  // ⚠ A BASELINE É LIDA COM O MESMO RECORTE do cenário. Comparar o escopo de
  // alguém contra o total da empresa daria um Δ que é a diferença de recorte,
  // não de proposta — e pareceria um corte gigantesco em toda linha.
  async function carregarCels(vid: string) {
    const alvo = filtro.emp ?? empresasEscopo.map(e => e.id)
    let q = supabase.from('fat_orcado')
      .select('linha_id,mes,valor,cc_id').eq('versao_id', vid).eq('ano', ano).in('empresa_id', alvo)
    if (filtro.fil) q = q.in('filial_id', filtro.fil)
    if (filtro.cc) q = q.in('cc_id', filtro.cc)
    const rows = await pageAll(() => q)
    const c: Record<string, Record<number, { v: number; n: number }>> = {}
    const semCc: Record<string, Set<number>> = {}, comCc: Record<string, Set<number>> = {}
    for (const r of rows as any[]) {
      const m = (c[r.linha_id] ||= {}); const cur = (m[r.mes] ||= { v: 0, n: 0 })
      cur.v += Number(r.valor) || 0; cur.n++
      const bag = r.cc_id == null ? (semCc[r.linha_id] ||= new Set()) : (comCc[r.linha_id] ||= new Set())
      bag.add(r.mes)
    }
    const mix = new Set<string>()
    for (const lid of Object.keys(semCc)) for (const m of semCc[lid]) if (comCc[lid]?.has(m)) mix.add(lid)
    return { c, mix }
  }

  useEffect(() => {
    if (!versaoId || !empresasEscopo.length) { setCels({}); setCelsBase({}); setMisto(new Set()); return }
    let vivo = true
    ;(async () => {
      setCarregandoCels(true); setErro('')
      try {
        const [atual, base] = await Promise.all([
          carregarCels(versaoId),
          baseId ? carregarCels(baseId) : Promise.resolve(null),
        ])
        if (!vivo) return
        setCels(atual.c); setMisto(atual.mix)
        setCelsBase(base?.c || {})
      } catch (e: any) { if (vivo) setErro(e?.message || String(e)) }
      finally { if (vivo) setCarregandoCels(false) }
    })()
    return () => { vivo = false }
  }, [versaoId, baseId, ano, empresasEscopo.length, recarga, JSON.stringify(filtro)]) // eslint-disable-line

  // Vereditos e carimbo do cenário.
  useEffect(() => {
    if (!baseId || !versaoId) { setVereditos({}); setDiffServidor([]); setCarimbo({ em: null, nota: null, mesclado: null }); return }
    let vivo = true
    ;(async () => {
      const [vr, vs, df] = await Promise.all([
        supabase.from('orcado_veredito').select('linha_id,aprovado,nota,aprov_nota').eq('versao_id', versaoId),
        supabase.from('versao_orcamento').select('aprovado_em,aprovacao_nota,mesclado_em').eq('id', versaoId).maybeSingle(),
        supabase.rpc('cenario_orcado_diff', { p_versao: versaoId }),
      ])
      if (!vivo) return
      setDiffServidor((df.data || []) as any)
      setVereditos(Object.fromEntries((vr.data || []).map((r: any) => [r.linha_id, r as Veredito])))
      setCarimbo({ em: vs.data?.aprovado_em || null, nota: vs.data?.aprovacao_nota || null, mesclado: vs.data?.mesclado_em || null })
    })()
    return () => { vivo = false }
  }, [versaoId, baseId, recarga])

  const anos = useMemo(() => [...new Set(versoes.map(v => v.ano).filter(Boolean))].sort((a, b) => b - a), [versoes])

  const podeAprovar = cap.can('cenario.aprovar')
  const podeResponder = acesso.podeEscrever && cap.can('orcar')

  // ⚠⚠ RESSINCRONIZAR UMA LINHA — "pega da baseline e traz" (26/nov).
  // A função que faz isso JÁ EXISTIA e só trabalhava no cenário inteiro; o que
  // entrou foi o recorte (`p_linha`), não lógica nova.
  // ⚠ Funciona para o acidente porque ZERAR AQUI É APAGAR: `fat_orcado` guarda
  // ausência, não zero, então a célula some e a ressincronização a classifica
  // como `incluir`. Célula EDITADA para outro valor conta como `preservada` e
  // NÃO volta — ali houve decisão, não acidente, e a prévia diz quantas são.
  // ⚠⚠ O RECORTE DA TELA VAI JUNTO (v3_207, consertando o mesmo dia). Sem ele
  // o ↺ trazia TODAS as empresas de volta, inclusive a desmarcada no filtro:
  // no cenário sem-MS a linha recebeu de volta as 92 células do MS junto com
  // as 459 que se queria desfazer, e a auditoria mostra dois DELETE de 92
  // linhas — o MS teve de ser limpo à mão, duas vezes.
  // ⚠ O precedente do semear (que IGNORA o filtro, v3_175) não vale aqui: lá
  // o ato é sobre a VERSÃO inteira; aqui é sobre o que se está olhando.
  const recorteRpc = () => ({ p_empresas: filtro.emp, p_filiais: filtro.fil, p_ccs: filtro.cc })
  const [ressync, setRessync] = useState<{ master: string; nome: string; sim: any[] } | null>(null)
  const [ressyncBusy, setRessyncBusy] = useState(false)

  async function pedirRessync(master: string, nomeLinha: string) {
    setRessyncBusy(true)
    const { data, error } = await supabase.rpc('ressincronizar_cenario',
      { p_versao: versaoId, p_simular: true, p_linha: master, ...recorteRpc() })
    setRessyncBusy(false)
    if (error) {
      alert(error.message.includes('function')
        ? 'Falta rodar a migration v3_207 (ressincronizar por linha, com recorte) no SQL Editor.'
        : 'Não foi possível simular: ' + error.message)
      return
    }
    setRessync({ master, nome: nomeLinha, sim: (data as any[]) || [] })
  }

  async function aplicarRessync() {
    if (!ressync) return
    setRessyncBusy(true)
    const { error } = await supabase.rpc('ressincronizar_cenario',
      { p_versao: versaoId, p_simular: false, p_linha: ressync.master, ...recorteRpc() })
    setRessyncBusy(false)
    if (error) { alert('Não foi possível ressincronizar: ' + error.message); return }
    setRessync(null)
    setRecarga(r => r + 1)   // o valor mudou no banco: reler, não adivinhar
  }

  async function decidir(master: string, aprovado: boolean, nota?: string) {
    const { error } = await supabase.rpc('decidir_linha_orcado',
      { p_versao: versaoId, p_linha: master, p_aprovado: aprovado, p_nota: nota ?? null })
    if (error) { setErro(error.message); return }
    setErro('')
    setVereditos(v => ({ ...v, [master]: { aprovado, nota: v[master]?.nota ?? null, aprov_nota: aprovado ? null : (nota ?? null) } }))
    // O gatilho da v3_172 derruba o carimbo quando um veredito muda — a tela
    // espelha na hora, senão o selo "fechado" continua ali mentindo até o F5.
    setCarimbo(c => ({ ...c, em: null, nota: null }))
  }

  async function responder(master: string, nota: string) {
    const { error } = await supabase.rpc('reabrir_linha_orcado',
      { p_versao: versaoId, p_linha: master, p_nota: nota })
    if (error) { setErro(error.message); return }
    setErro('')
    setVereditos(v => ({ ...v, [master]: { aprovado: null, nota, aprov_nota: v[master]?.aprov_nota ?? null } }))
    setCarimbo(c => ({ ...c, em: null, nota: null }))
  }

  // Reabrir = tirar o carimbo. Os vereditos ficam: o que volta a ser possível
  // é revê-los e responder. `reprovar_cenario` já existia da v3_165 e nunca
  // tinha botão — fechar sem caminho de volta é cilada, não governança.
  async function reabrir() {
    const { error } = await supabase.rpc('reprovar_cenario', { p_versao: versaoId, p_nota: null })
    if (error) { setErro(error.message); return }
    setErro(''); setCarimbo(c => ({ ...c, em: null, nota: null }))
  }

  async function fechar() {
    setFechando(true)
    const { data, error } = await supabase.rpc('aprovar_cenario', { p_versao: versaoId, p_nota: null })
    setFechando(false)
    if (error) { setErro(error.message); return }
    const r: any = Array.isArray(data) ? data[0] : data
    setErro(''); setCarimbo(c => ({ ...c, em: r?.aprovado_em || new Date().toISOString(), nota: null }))
  }

  if (loading) return <div style={{ padding: 28, color: 'var(--muted)' }}>Carregando…</div>

  return (
    <div style={{ padding: '22px 26px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <Link to="/orcar-linha" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--muted)', textDecoration: 'none', fontSize: 13 }}>
          <ChevronLeft size={15} /> Voltar
        </Link>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Orçar por linha — {relNome}</h1>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 16px', maxWidth: '96ch', lineHeight: 1.6 }}>
        A linha <b>inteira</b>, somando todas as filiais e centros de custo do seu escopo. Aqui só se
        lê: <b>clique numa linha analítica</b> para abrir as combinações e editar lá — é onde o valor
        de fato mora.
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div><div style={S.lbl}>Versão</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* O cenário diz de QUAL baseline saiu, por extenso.
                ⚠ Antes vinha recuado com `↳`, e recuo em <option> é lido como
                "filho do item de cima" — que é o vizinho da lista, não a
                origem. O combo afirmava uma ascendência errada sem nenhum dado
                errado por trás. Hierarquia não cabe num <select>; o nome cabe. */}
            <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
              <option value="">— selecione —</option>
              {versoes.map(v => <option key={v.id} value={v.id}>
                {v.codigo}
                {v.origem_versao_id
                  ? ` · cenário de ${versoes.find(b => b.id === v.origem_versao_id)?.codigo || 'outra versão'}`
                  : ''}
                {v.bloqueada ? ' 🔒' : ''}
              </option>)}
            </select>
            {acesso.isAdmin && (
              <NovoCenario versoes={versoes} baseSugerida={versao?.origem_versao_id || versaoId}
                onCriado={id => recarregarVersoes(id)} />
            )}
          </div></div>
        <div><div style={S.lbl}>Filtros</div>
          <FiltrosButton
            empresas={acesso.filterList('empresa', empresas as any) as any}
            filiais={acesso.filterList('filial', filiais as any) as any}
            ccs={acesso.filterList('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel}
            filialSel={filialSel} setFilialSel={setFilialSel}
            ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel}
            divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel}
            buSel={buSel} setBuSel={setBuSel} /></div>
        <div><div style={S.lbl}>Ano</div>
          <select style={S.sel} value={ano} onChange={e => setAno(Number(e.target.value))}>
            {(anos.length ? anos : [ano]).map(a => <option key={a} value={a}>{a}</option>)}
          </select></div>

        {/* Seções: esconder "Receitas" para analisar só despesas. É filtro de
            EXIBIÇÃO — o rollup já foi somado com tudo, então nenhum total muda.
            Esconder uma seção leva as filhas junto, porque ninguém desmarca
            linha a linha numa DRE de 169 linhas. */}
        {secoes.length > 1 && (
          <div><div style={S.lbl}>Seções</div>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setSecAberto(v => !v)}
                title="Escolher quais seções aparecem. Só esconde a linha — os totais continuam somados com tudo."
                style={{ ...S.sel, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  borderColor: secOcultas.length ? 'var(--violet)' : 'var(--border-strong)',
                  color: secOcultas.length ? 'var(--violet)' : 'var(--text)' }}>
                <ListFilter size={13} /> Seções{secOcultas.length ? ` (${secoes.length - secOcultas.length}/${secoes.length})` : ''}
              </button>
              {secAberto && (<>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setSecAberto(false)} />
                <div style={{ position: 'absolute', top: 38, left: 0, zIndex: 41, minWidth: 280, maxHeight: 360, overflow: 'auto',
                              background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 9, padding: 7,
                              boxShadow: '0 10px 28px rgba(0,0,0,0.45)' }}>
                  <div style={{ display: 'flex', gap: 6, padding: '2px 4px 8px' }}>
                    <button onClick={() => setSecOcultas([])} style={{ ...S.sel, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer' }}>Todas</button>
                    <button onClick={() => setSecOcultas(secoes.map(x => x.id))} style={{ ...S.sel, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer' }}>Nenhuma</button>
                  </div>
                  {secoes.map(sec => {
                    const on = !secOcultasSet.has(sec.id)
                    return (
                      <div key={sec.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 5px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 12.5, color: on ? 'var(--text)' : 'var(--muted)' }}>
                          <input type="checkbox" checked={on}
                            onChange={() => setSecOcultas(on ? [...secOcultas, sec.id] : secOcultas.filter(x => x !== sec.id))} />
                          {sec.descricao}
                        </label>
                        {/* "só esta" é o gesto real: isolar despesas, não desmarcar dezoito caixas */}
                        <button onClick={() => setSecOcultas(secoes.filter(x => x.id !== sec.id).map(x => x.id))}
                          title="Mostrar só esta seção"
                          style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border-strong)',
                                   background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>só esta</button>
                      </div>
                    )
                  })}
                </div>
              </>)}
            </div></div>
        )}

        <div><div style={S.lbl}>&nbsp;</div>
          <button onClick={() => setSemZeradas(v => !v)}
            title="Esconder as linhas sem nenhum valor no ano. Sintética que ficar sem filha visível some junto."
            style={{ ...S.sel, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              borderColor: semZeradas ? 'var(--violet)' : 'var(--border-strong)',
              color: semZeradas ? 'var(--violet)' : 'var(--text)' }}>
            <EyeOff size={13} /> {semZeradas ? 'Zeradas ocultas' : 'Mostrando zeradas'}
          </button></div>

        {ehCenario && (<>
          <div><div style={S.lbl}>Cenário</div>
            <button onClick={() => setModoComp(v => !v)}
              title="Mostrar baseline, cenário e a diferença, em vez dos 12 meses"
              style={{ ...S.sel, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                borderColor: comparando ? 'var(--violet)' : 'var(--border-strong)',
                color: comparando ? 'var(--violet)' : 'var(--text)' }}>
              <GitCompare size={13} /> {comparando ? 'Comparando' : 'Comparar'}
            </button></div>
          {comparando && (
            <div><div style={S.lbl}>&nbsp;</div>
              <button onClick={() => setSoAlteradas(v => !v)}
                style={{ ...S.sel, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  borderColor: soAlteradas ? 'var(--violet)' : 'var(--border-strong)',
                  color: soAlteradas ? 'var(--violet)' : 'var(--text)' }}>
                {soAlteradas ? 'Só alteradas' : 'Todas as linhas'}
              </button></div>
          )}
        </>)}
      </div>

      {/* Atalho das duas perguntas do dia a dia — mesmo estado do modal. */}
      <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PillsDim ccs={acesso.filterList('centro_custo', ccs as any) as any}
          codKey="area_cod" nomeKey="area_nome" titulo="Área" sel={areaSel} setSel={setAreaSel} />
        <PillsDim ccs={acesso.filterList('centro_custo', ccs as any) as any}
          codKey="divisao_cod" nomeKey="divisao_nome" titulo="Divisão" sel={divisaoSel} setSel={setDivisaoSel} />
      </div>

      {/* A barra do cenário: contra qual baseline, quanto falta decidir e o
          fechamento. Fica acima da tabela porque é o estado do trabalho, não
          um filtro — e porque o número de pendentes é o que explica o botão
          recusar o fechamento. */}
      {comparando && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14,
                      padding: '11px 14px', borderRadius: 10, border: '1px solid var(--border-strong)',
                      background: 'var(--panel)' }}>
          <GitCompare size={16} style={{ color: 'var(--violet)' }} />
          <div style={{ flex: 1, minWidth: 260, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
            <b>{versao?.codigo}</b> contra <b>{versoes.find(v => v.id === baseId)?.codigo || 'baseline'}</b>
            {' · '}{resumoCenario.mudadas} linha(s) alterada(s)
            {resumoCenario.mudadas === 0
              ? <span style={{ color: 'var(--muted)' }}> · nada proposto ainda</span>
              : resumoCenario.pendentes > 0
                ? <span style={{ color: 'var(--orange)' }}>{` · ${resumoCenario.pendentes} sem veredito`}</span>
                : <span style={{ color: 'var(--green)' }}> · todas decididas</span>}
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              A baseline é lida com o <b>mesmo filtro</b> desta tela — o Δ é de proposta, não de recorte.
              {' '}A contagem acima, porém, é do <b>cenário inteiro</b>: é ela que o fechamento exige.
            </div>
            {/* Sem nomear o que está fora da vista, "faltam N" vira um número
                que não se consegue perseguir — foi assim que uma receita de
                -696 mil ficou pendente atrás do filtro de Seções. */}
            {!!resumoCenario.ocultas.length && (
              <div style={{ fontSize: 11.5, color: 'var(--orange)', marginTop: 3 }}>
                Fora da vista atual (ajuste Filtros/Seções para decidir):{' '}
                <b>{resumoCenario.ocultas.slice(0, 6).join(' · ')}</b>
                {resumoCenario.ocultas.length > 6 ? ` e mais ${resumoCenario.ocultas.length - 6}` : ''}
              </div>
            )}
          </div>
          {/* ⚠ Fechar o cenário escondia Ressincronizar, excluir e qualquer
              volta atrás — e fechar é reversível de propósito (o carimbo é
              carimbo, não cadeado). Os caminhos continuam à mão até a
              liberação, que é o único passo sem desfazer. */}
          {carimbo.mesclado ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--green)' }}>
                <BadgeCheck size={16} /> Liberado na baseline em {new Date(carimbo.mesclado).toLocaleDateString('pt-BR')}
              </span>
              <HistoricoLiberacao versaoId={versaoId} nomeLinha={nomeMaster} />
            </div>
          ) : carimbo.em ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--green)' }}>
                <BadgeCheck size={16} /> Fechado em {new Date(carimbo.em).toLocaleDateString('pt-BR')}
              </span>
              {podeAprovar && (
                <button onClick={reabrir} title="Tirar o carimbo e voltar à análise — os vereditos ficam"
                  style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)',
                           background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12.5, cursor: 'pointer',
                           display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <RotateCcw size={13} /> Reabrir
                </button>
              )}
              {acesso.isAdmin && (
                <CenarioManutencao versaoId={versaoId} codigo={versao?.codigo}
                  onMudou={() => { recarregarVersoes(); setRecarga(r => r + 1) }} />
              )}
              {podeAprovar && (
                <LiberarCenario versaoId={versaoId} codigo={versao?.codigo}
                  baselineCodigo={versoes.find(v => v.id === baseId)?.codigo}
                  onLiberado={() => { setCarimbo(c => ({ ...c, mesclado: new Date().toISOString() })); setRecarga(r => r + 1) }} />
              )}
            </div>
          ) : (<>
            {/* Manutenção fica ao lado do fechar porque é o que se faz ANTES
                de fechar — a baseline em construção move o Δ por baixo. */}
            {acesso.isAdmin && (
              <CenarioManutencao versaoId={versaoId} codigo={versao?.codigo}
                onMudou={() => { recarregarVersoes(); setRecarga(r => r + 1) }} />
            )}
            {podeAprovar && (
            <button onClick={fechar} disabled={fechando || resumoCenario.pendentes > 0}
              title={resumoCenario.pendentes > 0
                ? `Decida as ${resumoCenario.pendentes} linha(s) pendentes na coluna Veredito`
                : 'Carimbar o cenário como revisado'}
              style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600,
                       background: resumoCenario.pendentes > 0 ? 'var(--panel-2)' : 'var(--green)',
                       color: resumoCenario.pendentes > 0 ? 'var(--muted)' : '#fff',
                       cursor: resumoCenario.pendentes > 0 || fechando ? 'default' : 'pointer',
                       display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {fechando && <Loader2 size={13} className="animate-spin" />}
              Fechar cenário
            </button>
            )}
          </>)}
        </div>
      )}

      {erro && <div style={{ fontSize: 12.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>{erro}</div>}

      {/* Combo de versão vazio é AMBÍGUO — pode ser escopo, pode ser consulta
          que falhou (foi o que houve ao pedir `origem_versao_id` antes da
          v3_171 rodar). Dizer as duas causas custa uma linha e economiza a
          sessão inteira de diagnóstico que um combo calado provoca. */}
      {!loading && !versoes.length && (
        <div style={{ fontSize: 12.5, color: 'var(--orange)', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)',
                      borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
          Nenhuma versão para escolher. Ou não há versão ativa no seu escopo (Configurações → acesso),
          ou a consulta falhou — o console do navegador diz qual das duas.
        </div>
      )}

      {misto.size > 0 && (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--orange)',
                      background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.35)',
                      borderRadius: 9, padding: '10px 13px', marginBottom: 14, lineHeight: 1.6 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <b>{misto.size} linha(s) com grão misto.</b> Têm valor lançado no consolidado
            (sem centro de custo) <i>e</i> detalhado por CC no mesmo mês — então o total aqui
            <b> soma os dois e infla</b>. Abra o drill para ver as duas pontas e apagar a que
            sobra. Na grade isso é invisível, porque cada grão fica num filtro diferente.
          </span>
        </div>
      )}

      {!versaoId ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          Selecione a <b>versão</b> para ver o orçamento.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              <th style={{ ...S.th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)', minWidth: 300 }}>Linha</th>
              {comparando ? (<>
                <th style={S.th}>Baseline</th>
                <th style={{ ...S.th, color: 'var(--text)' }}>Cenário</th>
                <th style={S.th}>Δ</th>
                <th style={{ ...S.th, textAlign: 'left' }}>Veredito</th>
              </>) : (<>
                {MES.map(m => <th key={m} style={S.th}>{m}</th>)}
                <th style={{ ...S.th, color: 'var(--text)' }}>Ano</th>
              </>)}
            </tr></thead>
            <tbody>
              {(comparando ? visComp : vis).map(l => {
                const sint = !!(linhas.find(x => x.pai_id === l.id))
                const t = total[l.id] || {}
                const anoT = Object.values(t).reduce((s, x) => s + x, 0)
                const f = fac(l)
                const clicavel = !sint && !!l.linha_orc_id && !l.nao_soma && !l.desativada
                const vazia = anoT === 0
                return (
                  <tr key={l.id} style={{ background: sint ? 'var(--bg-soft)' : undefined }}>
                    <td style={{ ...S.td, textAlign: 'left', position: 'sticky', left: 0, background: sint ? 'var(--bg-soft)' : 'var(--panel)',
                                 fontWeight: sint ? 700 : 400, color: vazia && !sint ? 'var(--muted)' : 'var(--text)' }}>
                      <span style={{ paddingLeft: depth(l) * 14 }}>
                        {clicavel
                          ? <button onClick={() => setDrill(l)}
                              title="Abrir as combinações empresa · filial · centro de custo desta linha para editar"
                              style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit',
                                       cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                              {l.descricao}
                            </button>
                          : l.descricao}
                        {!!l.linha_orc_id && misto.has(l.linha_orc_id) && <AlertTriangle size={12} style={{ color: 'var(--orange)', marginLeft: 6, verticalAlign: -2 }} />}
                        {clicavel && (cels[l.linha_orc_id!] ? Object.values(cels[l.linha_orc_id!]).some(x => x.n > 1) : false) && (
                          <Layers size={11} style={{ color: 'var(--muted)', marginLeft: 5, verticalAlign: -1 }} />
                        )}
                      </span>
                    </td>
                    {comparando ? (() => {
                      const baseT = anoDe(totalBase, l.id)
                      const d = anoT - baseT
                      // ⚠ Cor = bom ou ruim, NUNCA o sinal (convenção do projeto).
                      // ⚠⚠ `d` é CRU, e `variacaoBoa` espera cru: aplicar `f` aqui
                      // inverteria duas vezes — era o defeito, e fazia o corte de
                      // R$ 1,12 mi em pessoal aparecer em vermelho.
                      const bom = variacaoBoa(d)
                      const master = !sint && !l.nao_soma ? l.linha_orc_id : null
                      return (<>
                        <td style={{ ...S.td, color: baseT === 0 ? 'var(--faint)' : 'var(--text-mid)' }}>
                          {baseT === 0 ? '—' : money(baseT * f)}
                        </td>
                        <td style={{ ...S.td, fontWeight: sint ? 700 : 600, color: anoT === 0 ? 'var(--faint)' : 'var(--text)' }}>
                          {anoT === 0 ? '—' : money(anoT * f)}
                        </td>
                        <td style={{ ...S.td, fontWeight: 600,
                                     color: Math.abs(d) < 0.005 ? 'var(--faint)' : bom ? 'var(--green)' : 'var(--red)' }}>
                          {Math.abs(d) < 0.005 ? '—' : (d * f > 0 ? '+' : '') + money(d * f)}
                        </td>
                        <td style={{ ...S.td, textAlign: 'left' }}>
                          {master && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {/* O veredito continua só onde há o que decidir em VALOR
                                  — ou onde só o grão mudou, que agora também conta. */}
                              {(Math.abs(d) >= 0.005 || soGrao.has(master)) && (
                                <VereditoLinha v={vereditos[master]} podeAprovar={podeAprovar} podeResponder={podeResponder}
                                  onDecidir={(ap, nota) => decidir(master, ap, nota)}
                                  onReabrir={nota => responder(master, nota)} />
                              )}
                              {/* ⚠⚠ MARCA DE GRÃO: mesma soma, outro lugar. Sem ela a linha
                                  fica idêntica à da baseline e nada denuncia que o dinheiro
                                  trocou de empresa, filial, CC ou mês. */}
                              {soGrao.has(master) && (
                                <span title="Mesmo total, grão diferente — alguma célula mudou de empresa, filial, centro de custo ou mês. Precisa de veredito e pode precisar de ressincronização."
                                      style={{ fontSize: 10, color: 'var(--orange)', border: '1px solid var(--orange)',
                                               borderRadius: 4, padding: '0 4px', whiteSpace: 'nowrap' }}>
                                  grão ≠
                                </span>
                              )}
                              {/* ⚠ O ↺ aparece em TODA linha com master, não só nas que
                                  divergem em valor (26/nov). Trocar o CC não muda o total,
                                  e era justamente aí que o botão sumia — some o controle
                                  exatamente no caso em que ele é necessário.
                                  ⚠ Admin só: a RPC levanta 42501 para o resto, e mostrar
                                  botão a quem leva erro é oferecer e recusar. */}
                              {acesso.isAdmin && !carimbo.mesclado && (
                                <button onClick={() => pedirRessync(master, l.descricao || '')} disabled={ressyncBusy}
                                  title="Trazer esta linha de volta da baseline — desfaz o que foi apagado ou movido aqui"
                                  style={{ background: 'none', border: '1px solid var(--border-strong)', borderRadius: 6,
                                           padding: '2px 4px', cursor: 'pointer', color: 'var(--muted)', display: 'inline-flex' }}>
                                  <RotateCcw size={13} />
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </>)
                    })() : (<>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <td key={m} style={{ ...S.td, color: (t[m] || 0) === 0 ? 'var(--faint)' : sint ? 'var(--text)' : 'var(--text-mid)', fontWeight: sint ? 600 : 400 }}>
                          {(t[m] || 0) === 0 ? '—' : money((t[m] || 0) * f)}
                        </td>
                      ))}
                      <td style={{ ...S.td, fontWeight: 700, color: anoT === 0 ? 'var(--faint)' : 'var(--text)' }}>
                        {anoT === 0 ? '—' : money(anoT * f)}
                      </td>
                    </>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {carregandoCels && <div style={{ padding: 10, fontSize: 12, color: 'var(--muted)' }}>Somando…</div>}
          {/* Quem confere total precisa saber que há linha fora da vista, senão
              procura defeito no número. */}
          {ordered.length > (comparando ? visComp : vis).length && (
            <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
              {ordered.length - (comparando ? visComp : vis).length} linha(s) ocultas pelos filtros de exibição — os totais acima continuam somando tudo.
            </div>
          )}
        </div>
      )}

      {/* ⚠ A PRÉVIA EXISTE POR UMA RAZÃO SÓ: dizer quantas células NÃO voltam.
          A ressincronização preserva o que foi editado à mão nesta linha (ali
          houve decisão, não acidente) — e sem esse número a pessoa acha que a
          linha volta inteira ao estado da baseline, o que não é o caso.
          `p_simular` já é o default da própria RPC: a prévia é uma chamada, não
          uma segunda implementação da regra. */}
      {ressync && (() => {
        const n = (a: string) => Number(ressync.sim.find((x: any) => x.acao === a)?.celulas || 0)
        const volta = n('incluir'), atualiza = n('atualizar'), tira = n('remover'), mantem = n('preservada')
        const nada = !volta && !atualiza && !tira
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
               onClick={e => e.target === e.currentTarget && !ressyncBusy && setRessync(null)}>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 480, maxWidth: '94vw' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Trazer da baseline</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 14px' }}>
                Linha <b style={{ color: 'var(--text)' }}>{ressync.nome}</b> — só esta, o resto do cenário não é tocado.
              </div>
              {/* ⚠ Dizer o recorte é metade do conserto: sem a frase, quem
                  clica com a tela filtrada não sabe se o botão respeita o
                  filtro — e foi justamente essa dúvida que descobriu o
                  defeito ("estava com MS desmarcado e voltou de lá"). */}
              <div style={{ fontSize: 12, color: 'var(--violet)', background: 'rgba(139,92,246,0.10)',
                            border: '1px solid rgba(139,92,246,0.30)', borderRadius: 8, padding: '7px 10px', marginBottom: 14, lineHeight: 1.6 }}>
                {filtro.emp || filtro.fil || filtro.cc ? (<>
                  Vale <b>só dentro do recorte desta tela</b>
                  {filtro.emp ? ` · ${filtro.emp.length} empresa(s)` : ''}
                  {filtro.fil ? ` · ${filtro.fil.length} filial(is)` : ''}
                  {filtro.cc ? ` · ${filtro.cc.length} centro(s) de custo` : ''}.
                  {' '}O que está fora do filtro <b>não é tocado</b> — nem volta, nem sai.
                </>) : (<>
                  <b>Sem filtro na tela</b>: alcança todas as empresas, filiais e centros de custo
                  {' '}desta linha. Para limitar, filtre antes de clicar.
                </>)}
              </div>
              {nada ? (
                <div style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.7 }}>
                  Nada a trazer: esta linha já está igual à baseline, ou tudo o que difere foi
                  <b> editado à mão</b> aqui ({mantem} célula(s)) — e isso a ressincronização preserva.
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.8 }}>
                  {volta > 0 && <div>• <b style={{ color: 'var(--green)' }}>{volta}</b> célula(s) <b>voltam</b> — estavam apagadas aqui e existem na baseline.</div>}
                  {atualiza > 0 && <div>• <b>{atualiza}</b> célula(s) <b>atualizadas</b> com o valor de hoje da baseline.</div>}
                  {tira > 0 && <div>• <b style={{ color: 'var(--red)' }}>{tira}</b> célula(s) <b>retiradas</b> — a baseline não as tem mais.</div>}
                  {mantem > 0 && (
                    <div style={{ color: 'var(--orange)', marginTop: 8 }}>
                      ⚠ <b>{mantem}</b> célula(s) <b>não voltam</b>: foram editadas à mão neste cenário, e a
                      {' '}ressincronização trata isso como proposta, não como acidente. Para desfazer uma
                      {' '}edição deliberada, digite o valor de volta no drill.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                    O veredito desta linha volta a <b>pendente</b> — o ✓ ou ✗ anterior era sobre outro número.
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button disabled={ressyncBusy} onClick={() => setRessync(null)}
                  style={{ padding: '6px 12px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer' }}>
                  {nada ? 'Fechar' : 'Cancelar'}
                </button>
                {!nada && (
                  <button disabled={ressyncBusy} onClick={aplicarRessync}
                    style={{ padding: '6px 12px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--violet)', background: 'var(--violet)', color: '#fff', cursor: 'pointer' }}>
                    {ressyncBusy ? 'Trazendo…' : 'Trazer'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {drill && versao && (
        <DrillCombinacoes
          linha={drill} versao={versao} ano={ano} fator={fac(drill)}
          empresas={filtro.emp ? empresasEscopo.filter(e => filtro.emp!.includes(e.id)) : empresasEscopo}
          filialIds={filtro.fil} ccIds={filtro.cc}
          onFechar={(mudou: boolean) => { setDrill(null); if (mudou) setRecarga(n => n + 1) }}
        />
      )}
    </div>
  )
}
