import { useEffect, useState, useRef, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { carregarVersoes, carregarRelatorios } from '../../lib/escopoDados'
import { computeCenario, computeTotais, pkey } from '../../lib/engine'
import type { LinhaCalc, Computed, Periodo, RawValues } from '../../lib/engine'
import { PeriodPicker } from './PeriodPicker'
import { totaisRelatorio, totaisRelatorioArv } from '../../lib/relatorioTotais'
import { MemoriaModal, componentesMem } from '../../lib/MemoriaCalculo'
import { useDiscreto, idsRestritos, removerDominadas } from '../../lib/discricao'
import type { RLData } from '../../lib/relatorioTotais'
import { ResponsiveBar } from '@nivo/bar'
import { fmtEixo } from '../../lib/fmtEixo'
import { Ponte } from '../../lib/Ponte'
import { QuemCausou, Variacao, SEC_PADRAO, type SecCfg, type DimBruto, type DimQuem, type LadoPorMaster } from '../../lib/AnaliseVariacao'
import { fatorExibicao } from '../../lib/refRelatorio'
import { nivoTheme } from '../../lib/nivoTheme'
import { ResponsiveLine } from '@nivo/line'
import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, RefreshCw, ArrowLeft } from 'lucide-react'
import DrillModal from './DrillModal'
import IndicCard from './IndicCard'
import type { IC } from './IndicCard'
import { carregarMetas, resolverMeta } from '../../lib/indicadorMeta'
import type { IndicadorMeta } from '../../lib/indicadorMeta'
import { effectiveCcFilter, escopoFiltro, ExportarButton, FiltrosButton, MoedaSelect, PeriodoButton, PillsDim, SalvarCardButton, useCardPreset, useMoedaView, BotaoDiscreto } from './DashFiltros'
import { PickerLinhas } from '../../lib/PickerLinhas'
import { useUserAccess } from '../../hooks/useUserAccess'
import { ListChecks } from 'lucide-react'

// ⚠⚠ OS GRUPOS SÃO CADASTRO DESTA INSTALAÇÃO, não regra do produto. O eixo é o
// `area_cod` do centro de custo — 1 CSC · 2 Comercial · 3 Serviços ·
// 4 Diretoria · 5 Marketing — e o agrupamento responde a COMO ESTA EMPRESA LÊ
// a despesa: quem vende junto com quem divulga, quem entrega, e quem sustenta.
// Despesa existe em TODA área, então um gráfico único por área fica ilegível
// (pedido do Ricardo, 27/nov); receita, não — ela nasce em duas.
// ⚠ Por CÓDIGO, nunca por nome: renomear a área no cadastro não pode mudar o
// gráfico. É a mesma proibição da cor de variação e do default da ponte.
// ⚠ Área fora de todo grupo NÃO some — cai em "Outras áreas", e esse cartão só
// existe quando há algo nele (a regra do `cortado` em situacaoPosto).
const GRUPOS_DESPESA: { titulo: string; areas: string[] }[] = [
  { titulo: 'Comercial e Marketing', areas: ['2', '5'] },
  { titulo: 'Serviços', areas: ['3'] },
  { titulo: 'CSC e Diretoria', areas: ['1', '4'] },
]
/** Quem fatura. As outras áreas têm receita residual e poluíam o gráfico. */
const AREAS_RECEITA = ['2', '3']
const codDaArea = (a: string) => String(a).split('-')[0]

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ANOS = [2024, 2025, 2026, 2027, 2028]
const CAT = ['#3b5bdb', '#f59f00', '#2f9e44', '#e8590c', '#7048e8', '#1098ad', '#e64980', '#0ca678', '#f76707', '#4263eb']
const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
// ⚠ NÃO É RÓTULO DE EIXO — é o valor escrito SOBRE o ponto da linha, onde a
// precisão importa para comparar meses: "1.536k" distingue o que "1,5 mi"
// achata. Os eixos usam `fmtEixo`; esta função sobrevive só para isto, e o
// nome diz qual é o papel dela.
const fmtPonto = (v: number) => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + 'k' : String(Math.round(v))
const pctOf = (real: number, orc: number) => orc === 0 ? null : (real / orc) * 100
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const tipBox: CSSProperties = { background: 'var(--panel)', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }
// cor do Δ (R−O), valores em EXIBIÇÃO (positivos): receita/resultado → +verde; despesa → +vermelho (gastou mais que o orçado)
const corDelta = (d: number, desp?: boolean) => ((desp ? d <= 0 : d >= 0) ? '#2f9e44' : '#e03131')

// tooltip de Orçado × Realizado com Δ (R−O) e separador de milhar. `desp` inverte o bom/ruim do Δ.
// ⚠ `pct` não é só formatação: num percentual a diferença se lê em PONTOS
// percentuais, não em "reais a mais". "Δ 2,3" sem a unidade seria lido como
// 2,3% de variação — que é outro número.
function TipOR({ titulo, data, hint, desp, pct }: { titulo: string; data: any; hint?: string; desp?: boolean; pct?: boolean }) {
  const o = Number(data['Orçado'] || 0), r = Number(data['Realizado'] || 0), d = r - o
  const v = (n: number) => pct ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : fmt(n)
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{titulo}</div>
      <div><span style={{ color: 'var(--muted)' }}>Orçado:</span> {v(o)}</div>
      <div><span style={{ color: 'var(--muted)' }}>Realizado:</span> {v(r)}</div>
      <div style={{ color: corDelta(d, desp ?? !!data.desp), fontWeight: 600 }}>
        Δ (R−O): {pct ? `${d >= 0 ? '+' : ''}${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pp` : fmt(d)}</div>
      {hint && <div style={{ color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

type Rel = { id: string; codigo: string; nome: string }
type Versao = { id: string; codigo: string }
type Item = { id: string; codigo: string; descricao: string }
type RL = { id: string; pai_id: string | null; codigo: string; tipo_linha: any; expressao: string | null; desativada: boolean; natureza: string | null; linha_orc_id: string | null; descricao: string; ordem: number | null; visivel_dashboard?: boolean; nao_soma?: boolean; filtro_escopo?: any; formato?: any; casas_decimais?: number; redutora?: boolean }

const S: Record<string, CSSProperties> = {
  page:   { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title:  { fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 },
  sub:    { fontSize: 13, color: 'var(--muted)', margin: '4px 0 16px' },
  bar:    { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  sel:    { padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', color: 'var(--text-mid)' },
  btn:    { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  chip:   { fontSize: 12, color: 'var(--muted)', marginBottom: 16 },
  kpis:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 16 },
  kpi:    { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 },
  kpiLbl: { fontSize: 12, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiVal: { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '6px 0 2px' },
  kpiSub: { fontSize: 12, color: 'var(--muted)' },
  grid2:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 },
  // ⚠ DOIS POR LINHA, NUNCA TRÊS. `auto-fit` com largura fixa enche a tela —
  // num monitor largo os três viravam quatro e cada gráfico ficava estreito
  // demais para dez meses. O piso em PORCENTAGEM é o que limita: 2×44% cabem,
  // 3×44% não. O `380px` mantém a degradação para uma coluna no monitor
  // pequeno, em vez de duas espremidas.
  grid3:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(max(44%, 380px), 1fr))', gap: 16 },
  card:   { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardT:  { fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  // ⚠ `flexBasis: '100%'` força a quebra: `cardT` é flex com wrap, então o
  // subtítulo só descia quando o TÍTULO era comprido — "Despesas · Serviços"
  // cabia na mesma linha e "Despesas · Comercial e Marketing" não, deixando
  // dois cartões lado a lado com alturas e alinhamentos diferentes.
  cardSub: { fontSize: 11, fontWeight: 400, color: 'var(--muted)', flexBasis: '100%' },
  chart:  { height: 320, background: 'var(--chart-bg)', borderRadius: 10, padding: 8 },
  empty:  { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 },
  label:  { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-mid)', marginBottom: 6 },
  input:  { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' },
  pop:    { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1500, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', padding: 16, width: 'min(860px, calc(100vw - 40px))', maxHeight: '85vh', overflowY: 'auto', overflowX: 'hidden' },
  miniSeg:{ padding: '3px 10px', fontSize: 12, border: '1px solid var(--border-strong)', cursor: 'pointer', background: 'var(--panel)', color: 'var(--text-mid)' },
}
const miniBtn: CSSProperties = { padding: '2px 8px', fontSize: 11, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--panel)', cursor: 'pointer', color: 'var(--text-mid)' }


const ALLM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
// Cada quadrado é um período (ano, mês) — mesmo picker do relatório. anosSel/mesesSel saem daqui por derivação.
const toPeriodos = (anos: number[], meses: number[]): Periodo[] => anos.flatMap(y => meses.map(m => ({ ano: y, mes: m })))

function AnoMesGrid({ periodosSel, setPeriodosSel }: { periodosSel: Periodo[]; setPeriodosSel: (v: Periodo[]) => void }) {
  const anoInteiro = (y: number) => ALLM.map(m => ({ ano: y, mes: m }))
  return (
    <div>
      <PeriodPicker anos={ANOS} sel={periodosSel} onChange={setPeriodosSel} />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button style={miniBtn} onClick={() => setPeriodosSel(ANOS.flatMap(anoInteiro))}>Todos anos</button>
        <button style={miniBtn} onClick={() => setPeriodosSel(anoInteiro(2026))}>Só 2026</button>
        <button style={miniBtn} onClick={() => setPeriodosSel([])}>Limpar</button>
      </div>
    </div>
  )
}

function Gauge({ label, pct, desp }: { label: string; pct: number | null; desp?: boolean }) {
  const cx = 90, cy = 92, r = 70
  const f = pct == null ? 0 : Math.max(0, Math.min(pct, 150)) / 150
  const pt = (deg: number) => [cx + r * Math.cos(deg * Math.PI / 180), cy - r * Math.sin(deg * Math.PI / 180)]
  const av = 180 - f * 180
  const [tx0, ty0] = pt(180), [tx1, ty1] = pt(0), [vx, vy] = pt(av)
  // despesa: executar ACIMA de 100% é ruim (gastou mais que o orçado) → inverte o bom/ruim
  const cor = pct == null ? 'var(--border-strong)'
    : desp ? (pct <= 100 ? '#2f9e44' : pct <= 110 ? '#f59f00' : '#e03131')
           : (pct >= 100 ? '#2f9e44' : pct >= 80 ? '#f59f00' : '#e03131')
  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 180 110" width="100%" style={{ maxWidth: 220 }}>
        <path d={`M ${tx0} ${ty0} A ${r} ${r} 0 0 1 ${tx1} ${ty1}`} fill="none" stroke="#edf0f2" strokeWidth={14} strokeLinecap="round" />
        <path d={`M ${tx0} ${ty0} A ${r} ${r} 0 0 1 ${vx} ${vy}`} fill="none" stroke={cor} strokeWidth={14} strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--text)">{pct == null ? '—' : Math.round(pct) + '%'}</text>
      </svg>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginTop: -6 }}>{label}</div>
    </div>
  )
}

const SAVE = 'planorc_dash_filtro'
function loadSaved(): any { try { return JSON.parse(localStorage.getItem(SAVE) || '{}') } catch { return {} } }

export default function DashboardPage() {
  const [rels, setRels] = useState<Rel[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [empresas, setEmpresas] = useState<Item[]>([])
  const [filiais, setFiliais] = useState<Item[]>([])
  const [ccs, setCcs] = useState<Item[]>([])
  const sv = loadSaved()
  const [relId, setRelId] = useState('')
  const [versaoId, setVersaoId] = useState('')
  const [agrupId, setAgrupId] = useState<string>(sv.agrupId || '')
  const [agrupOpts, setAgrupOpts] = useState<{ id: string; label: string }[]>([])
  const [periodosSel, setPeriodosSel] = useState<Periodo[]>(
    Array.isArray(sv.periodosSel) && sv.periodosSel.length
      ? sv.periodosSel  // formato novo (por célula)
      : toPeriodos(Array.isArray(sv.anosSel) && sv.anosSel.length ? sv.anosSel : [2026], Array.isArray(sv.mesesSel) && sv.mesesSel.length ? sv.mesesSel : ALLM))  // migra o formato antigo (anos × meses)
  // anosSel/mesesSel derivam das células marcadas → alimentam as RPCs (cross-product; over-seleção aceita p/ marcações não-retangulares)
  const anosSel = useMemo(() => [...new Set(periodosSel.map(p => p.ano))].sort((a, b) => a - b), [periodosSel])
  const mesesSel = useMemo(() => [...new Set(periodosSel.map(p => p.mes))].sort((a, b) => a - b), [periodosSel])
  const [empresaSel, setEmpresaSel] = useState<string[]>(Array.isArray(sv.empresaSel) ? sv.empresaSel : [])
  const acessoDash = useUserAccess()
  const { moedas, slot: moedaSlot, setSlot: setMoedaSlot } = useMoedaView()
  const [filialSel, setFilialSel] = useState<string[]>(Array.isArray(sv.filialSel) ? sv.filialSel : [])
  const [ccSel, setCcSel] = useState<string[]>(Array.isArray(sv.ccSel) ? sv.ccSel : [])
  const [areaSel, setAreaSel] = useState<string[]>(Array.isArray(sv.areaSel) ? sv.areaSel : [])
  const [divisaoSel, setDivisaoSel] = useState<string[]>(Array.isArray(sv.divisaoSel) ? sv.divisaoSel : [])
  const [buSel, setBuSel] = useState<string[]>(Array.isArray(sv.buSel) ? sv.buSel : [])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const loadSeq = useRef(0)
  const dashRef = useRef<HTMLDivElement>(null)   // alvo da exportação (PNG/PDF)

  // Meus Cards: aplica preset quando ?card=<id> bate com este dashboard
  const { cardId, nome: cardNome } = useCardPreset('/dashboard', (f) => {
    if (f.relId !== undefined) setRelId(f.relId); if (f.versaoId !== undefined) setVersaoId(f.versaoId); if (f.agrupId !== undefined) setAgrupId(f.agrupId)
    if (Array.isArray(f.periodosSel)) setPeriodosSel(f.periodosSel)
    else if (Array.isArray(f.anosSel) && Array.isArray(f.mesesSel)) setPeriodosSel(toPeriodos(f.anosSel, f.mesesSel))
    if (Array.isArray(f.empresaSel)) setEmpresaSel(f.empresaSel); if (Array.isArray(f.filialSel)) setFilialSel(f.filialSel); if (Array.isArray(f.ccSel)) setCcSel(f.ccSel)
    if (Array.isArray(f.areaSel)) setAreaSel(f.areaSel); if (Array.isArray(f.divisaoSel)) setDivisaoSel(f.divisaoSel); if (Array.isArray(f.buSel)) setBuSel(f.buSel)
    if (Array.isArray(f.indicSel)) setIndicSel(f.indicSel)
  })

  const [escopoNome, setEscopoNome] = useState('Relatório inteiro')
  // ⚠ O NOME DA LINHA QUE O GRÁFICO DESENHA. Não é o `escopoNome`: sem linha
  // agrupadora o escopo é "Relatório inteiro", mas as barras mostram o
  // Resultado Líquido — e um título que diz "relatório inteiro" sobre um
  // número que é o resultado é a mesma classe de erro que o gráfico tinha
  // antes, só que no texto.
  const [nomeGraf, setNomeGraf] = useState('')
  const [escopoDesp, setEscopoDesp] = useState(false)   // natureza do escopo: despesa → inverte bom/ruim do Δ
  const [kpi, setKpi] = useState({ resOrc: 0, resReal: 0, recOrc: 0, recReal: 0, despOrc: 0, despReal: 0, resPrev: 0, recPrev: 0, despPrev: 0, recBrutaOrc: 0, recBrutaReal: 0, recBrutaPrev: 0 })
  const [orcRealMes, setOrcRealMes] = useState<any[]>([])
  const [resMes, setResMes] = useState<{ mes: string; res: number }[]>([])
  const [accLines, setAccLines] = useState<any[]>([])
  const [composicao, setComposicao] = useState<any[]>([])
  const [compOcultas, setCompOcultas] = useState(0)
  const [indicCards, setIndicCards] = useState<IC[]>([])
  const [indicSel, setIndicSel] = useState<string[]>(Array.isArray(sv.indicSel) ? sv.indicSel : [])   // quais indicadores exibir (vazio = todos)
  const [pickIndic, setPickIndic] = useState(false)
  const [metas, setMetas] = useState<IndicadorMeta[]>([])   // faixas de status por indicador (v3_079)
  const [filhasMes, setFilhasMes] = useState<any[]>([])
  const [cascata, setCascata] = useState<any[]>([])
  const [porEmpresa, setPorEmpresa] = useState<any[]>([])
  const [ebitdaPctEmp, setEbitdaPctEmp] = useState<any[]>([])
  // ── a ponte (mesmo componente do dash de análise, extraído em 23/nov)
  // ⚠⚠ O SENTIDO AQUI É FIXO: orçado → realizado. Na análise ele é escolhido
  // porque lá a comparação pode ser entre dois orçamentos; aqui a tela faz UMA
  // pergunta — "planejei X, o que aconteceu?" —, e um seletor com uma resposta
  // só é controle morto.
  const [totais, setTotais] = useState<{ orc: Record<string, number>; real: Record<string, number>
    arvOrc: Record<string, Record<string, number>>; arvReal: Record<string, Record<string, number>> } | null>(null)
  const [pCfg, setPCfg] = useState<any>({ sel: [], pct: 10, minPctTotal: 0.5, resultado: '' })
  // ⚠ Trilha e navegação na PÁGINA, não no componente: `loading` troca o
  // conteúdo inteiro e desmontaria a Ponte, levando o caminho percorrido
  // junto. Mesma razão documentada no dash de análise.
  const [pTrilha, setPTrilha] = useState<string[]>([])
  const pNav = useRef<string | null>(null)
  const [pNat, setPNat] = useState<'TODAS' | 'RECEITA' | 'DESPESA'>('TODAS')
  const [pAte, setPAte] = useState<number | 'tudo'>(1)
  // ── "quem causou" e "o que mudou", os mesmos dois da análise
  const [dimBruto, setDimBruto] = useState<DimBruto>({ emp: {}, cc: {} })
  const [quemDim, setQuemDim] = useState<DimQuem>('area')
  const [vCfg, setVCfg] = useState<SecCfg>(SEC_PADRAO)
  const [vAba, setVAba] = useState<'LINHA' | 'INDIC'>('LINHA')
  const [vNivel, setVNivel] = useState<number | 'folhas'>(1)
  const [vNat, setVNat] = useState<'TODAS' | 'RECEITA' | 'DESPESA'>('TODAS')
  const [linhasRel, setLinhasRel] = useState<RL[]>([])
  const [memoria, setMemoria] = useState<string | null>(null)   // id da linha com a memória aberta
  // ⚠⚠ O MODO DISCRETO NÃO RECARREGA NADA. Os totais pedidos ao banco são os
  // mesmos — o pedido é justamente que eles não mudem —, e o que muda é só o
  // DESENHO. Por isso a máscara é `useMemo` sobre o estado já carregado, nunca
  // dependência da carga (lição do "seleção dentro de um cartão não recarrega").
  const discreto = useDiscreto()
  const restritos = useMemo(() => idsRestritos(ccs as any, discreto), [ccs, discreto])
  // Uma barra do gráfico é o NÍVEL 2 e agrega vários CCs; só vira "Outros"
  // quando TODOS os dela são restritos — a mesma regra do grupo de dimensão.
  const mascararBarras = (arr: any[]) => removerDominadas<any>(arr, b => (b._pes || {}), restritos)
  // ⚠ O cartão ARRASTA e agora também ABRE. O `click` do HTML5 drag não é
  // confiável como separador (alguns navegadores o emitem depois do drop), e
  // perder o arrasto para ganhar o modal seria trocar um gesto por outro.
  // Quem separa é o DESLOCAMENTO: abaixo de 5px foi clique, acima foi arrasto.
  const toqueInd = useRef<{ x: number; y: number } | null>(null)
  // ⚠ `val` aplica `fatorExibicao` — despesa sai POSITIVA, como no resto do
  // produto. O ranking usa isso; a ponte, não (lá o sinal é econômico cru, e
  // é exceção declarada). São as duas convenções do CLAUDE.md convivendo na
  // mesma tela, cada peça com a sua.
  const byIdRel = useMemo(() => Object.fromEntries(linhasRel.map(l => [l.id, l])) as any, [linhasRel])
  const facRel = (id: string) => fatorExibicao(id, byIdRel)
  const valRel = (src: Record<string, number> | undefined, id: string) => (src?.[id] ?? 0) * facRel(id)
  // ── arrastar os indicadores para reordenar (mesmo gesto do dash de análise)
  // ⚠ `indicSel` JÁ ERA a lista de quais exibir, já persistida no localStorage
  // e no preset do card — só não era usada como ORDEM: a renderização filtrava
  // `indicCards` (ordem da estrutura) em vez de percorrer a seleção. Então
  // reordenar não exigiu campo novo, nem migration: exigiu ler o array na
  // ordem em que ele já estava gravado.
  const [arrInd, setArrInd] = useState<string | null>(null)
  const [sobreInd, setSobreInd] = useState<string | null>(null)
  const soltarInd = (destinoId: string) => {
    const origemId = arrInd
    setArrInd(null); setSobreInd(null)
    if (!origemId || origemId === destinoId) return
    setIndicSel(p => {
      const o = [...p]
      const de = o.indexOf(origemId), para = o.indexOf(destinoId)
      if (de < 0 || para < 0) return p
      o.splice(para, 0, ...o.splice(de, 1))
      return o
    })
  }
  const [ebitdaEmp, setEbitdaEmp] = useState<any[]>([])
  const [desvios, setDesvios] = useState<any[]>([])
  // gráficos por Área / Centro de Custo (cruzam CC × natureza da linha)
  const [recAreaLinhas, setRecAreaLinhas] = useState<any[]>([])   // receitas por área: realizado (cheia) + orçado (tracejada)
  const [despGrupos, setDespGrupos] = useState<{ titulo: string; linhas: any[] }[]>([])  // despesas por grupo de área
  const [recDespLinhas, setRecDespLinhas] = useState<any[]>([])   // 3: evolução receitas × despesas (linhas)
  const [recAreaBar, setRecAreaBar] = useState<any[]>([])         // 2: receitas por área O×R+Δ (barras)
  const [despAreaBar, setDespAreaBar] = useState<any[]>([])       // 4: despesas por área O×R+Δ (barras)
  const [despCcBar, setDespCcBar] = useState<any[]>([])           // 5: despesas por CC (nível 2) O×R+Δ
  const [recCcBar, setRecCcBar] = useState<any[]>([])             // 6: receitas por CC (nível 2) O×R+Δ
  const despCcVis = useMemo(() => mascararBarras(despCcBar), [despCcBar, restritos])   // eslint-disable-line
  const recCcVis  = useMemo(() => mascararBarras(recCcBar),  [recCcBar, restritos])    // eslint-disable-line
  // ⚠ Os gráficos por ÁREA usam a MESMA função — era o que faltava: na 1ª
  // versão só os por CC foram mascarados e "4-Diretoria" seguiu desenhada.
  const recAreaVis  = useMemo(() => mascararBarras(recAreaBar),  [recAreaBar, restritos])  // eslint-disable-line
  const despAreaVis = useMemo(() => mascararBarras(despAreaBar), [despAreaBar, restritos]) // eslint-disable-line
  const recAreaLinVis = useMemo(() => mascararBarras(recAreaLinhas), [recAreaLinhas, restritos]) // eslint-disable-line
  // ⚠ A máscara do modo discreto vale em TODOS os gráficos por área — foi a
  // cobertura parcial que já falhou duas vezes aqui. Um `map` sobre os grupos
  // garante que o próximo grupo nasça mascarado sem ninguém lembrar.
  const despGruposVis = useMemo(() => despGrupos.map(g => ({ titulo: g.titulo, ...mascararBarras(g.linhas) })),
    [despGrupos, restritos]) // eslint-disable-line
  // ⚠ A barra "Outros" NÃO abre: ela é um balde, e abrir entregaria no drill
  // exatamente o grão que a barra agregou para esconder.
  // ⚠ A barra "Outros" NÃO abre, e basta UM CC restrito nela: o drill não
  // agrega, ele lista — e listaria exatamente o grão que a barra escondeu.
  const podeDrill = (ids: string[]) => !ids.some(id => restritos.has(id))
  const [temDados, setTemDados] = useState(false)
  const [drill, setDrill] = useState<{ nodeId: string; meses?: number[]; ccFilter?: string[] | null } | null>(null)
  const [qparams, setQparams] = useState<{ empIds: string[]; anos: number[]; meses: number[]; filFilter: string[] | null; ccFilter: string[] | null } | null>(null)

  useEffect(() => {
    carregarRelatorios('id,codigo,nome', 'nome').then(rs => { setRels(rs); if (rs.length) setRelId(p => (p && rs.some((x: any) => x.id === p) ? p : (rs.some((x: any) => x.id === sv.relId) ? sv.relId : rs[0].id))) })
    carregarVersoes().then(vs => { setVersoes(vs); if (vs.length) setVersaoId(p => (p && vs.some((x: any) => x.id === p) ? p : (vs.some((x: any) => x.id === sv.versaoId) ? sv.versaoId : vs[0].id))) })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => setEmpresas(r.data || []))
    carregarMetas().then(setMetas)
    supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome,restrito').order('codigo').then(r => setCcs(r.data || []))
  }, []) // eslint-disable-line

  useEffect(() => { if (cardId) return; localStorage.setItem(SAVE, JSON.stringify({ relId, versaoId, agrupId, periodosSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel })) }, [cardId, relId, versaoId, agrupId, periodosSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel])

  const load = async () => {
    if (!relId || !versaoId || !anosSel.length || !mesesSel.length) return
    const myseq = ++loadSeq.current   // descarta resultados de cargas antigas (ex.: preset aplica filtro e dispara 2ª carga)
    setLoading(true); setErro(null)
    try {
      const { data: linhasRaw } = await supabase.from('relatorio_linha').select('id,pai_id,codigo,tipo_linha,expressao,desativada,natureza,linha_orc_id,descricao,ordem,visivel_dashboard,nao_soma,filtro_escopo,formato,casas_decimais,redutora').eq('relatorio_id', relId)
      const linhas = (linhasRaw || []) as RL[]
      const byId: Record<string, RL> = {}; linhas.forEach(l => { byId[l.id] = l })
      const childrenByPai: Record<string, RL[]> = {}
      linhas.forEach(l => { const k = l.pai_id || '__root'; (childrenByPai[k] = childrenByPai[k] || []).push(l) })
      Object.values(childrenByPai).forEach(arr => arr.sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999)))
      // sequência de exibição = ordem da árvore do relatório (DFS), p/ ordenar os cards de indicadores
      const seqOrd: Record<string, number> = {}; let _si = 0
      const dfsSeq = (k: string) => { for (const c of (childrenByPai[k] || [])) { seqOrd[c.id] = _si++; dfsSeq(c.id) } }
      dfsSeq('__root')
      const masterIds = [...new Set(linhas.map(l => l.linha_orc_id).filter(Boolean))] as string[]
      const descByMaster: Record<string, string> = {}, rlOfMaster: Record<string, string> = {}
      linhas.forEach(l => { if (l.linha_orc_id) { descByMaster[l.linha_orc_id] = l.descricao; rlOfMaster[l.linha_orc_id] = l.id } })
      // masters de linhas DESATIVADAS — excluídos das somatórias (como no relatório)
      const disabledMasters = new Set<string>(); linhas.forEach(l => { if (l.desativada && l.linha_orc_id) disabledMasters.add(l.linha_orc_id) })
      // natureza vem do dado (relatorio_linha/conta_orcamentaria); folha sem natureza herda do ANCESTRAL
      const natCache: Record<string, string | null> = {}
      const natOfLine = (id: string | null): string | null => {
        if (!id) return null
        if (id in natCache) return natCache[id]
        const l = byId[id]; if (!l) return null
        const n = (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOfLine(l.pai_id)
        natCache[id] = n; return n
      }
      const natByMaster: Record<string, string> = {}
      masterIds.forEach(m => { const n = natOfLine(rlOfMaster[m]); if (n) natByMaster[m] = n })
      // linha marcada como "redutora de receita" (imposto) → separa bruta/líquida
      const redutoraByMaster: Record<string, boolean> = {}
      masterIds.forEach(m => { redutoraByMaster[m] = !!byId[rlOfMaster[m]]?.redutora })

      // opções de linha agrupadora (apenas nós com filhas), indentadas
      const opts: { id: string; label: string }[] = []
      const walk = (paiKey: string, depth: number) => {
        for (const c of (childrenByPai[paiKey] || [])) {
          if ((childrenByPai[c.id] || []).length) { opts.push({ id: c.id, label: ' '.repeat(depth * 3) + c.descricao }); walk(c.id, depth + 1) }
        }
      }
      walk('__root', 0)
      setAgrupOpts(opts)
      const agrup = agrupId && byId[agrupId] ? agrupId : ''
      if (agrupId && !byId[agrupId]) setAgrupId('')
      setEscopoNome(agrup ? byId[agrup].descricao : 'Relatório inteiro')
      setEscopoDesp(agrup ? natOfLine(agrup) === 'DESPESA' : false)   // escopo = linha de despesa? inverte bom/ruim

      // subárvore de masters de um nó (inclui o próprio e descendentes)
      const subMasters = (nodeId: string): string[] => { const acc: string[] = [], st = [nodeId]; while (st.length) { const n = st.pop()!; if (byId[n]?.linha_orc_id) acc.push(byId[n].linha_orc_id!); (childrenByPai[n] || []).forEach(c => st.push(c.id)) } return acc }
      const scopedMasters = agrup ? subMasters(agrup) : masterIds
      const scopedSet = new Set(scopedMasters)
      // filhas diretas do nó (ou raiz) e a qual filha cada master pertence
      // visivel_dashboard=false some do display, mas continua no cálculo (totais/EBITDA via leaves+engine)
      const allChildren = (childrenByPai[agrup || '__root'] || []).filter(c => c.tipo_linha !== 'ESPACO' && !c.nao_soma)
      const nodeChildren = allChildren.filter(c => c.visivel_dashboard !== false)
      const childrenOcultas = allChildren.length - nodeChildren.length
      const masterToChild: Record<string, string> = {}, childDesc: Record<string, string> = {}
      nodeChildren.forEach(c => { childDesc[c.id] = c.descricao; subMasters(c.id).forEach(m => { masterToChild[m] = c.id }) })

      const allEmp = empresas.map(e => e.id)
      const empIds = escopoFiltro(empresaSel.length ? empresaSel : allEmp, empresas, 'empresa', acessoDash.canSee) ?? []
      const empSet = new Set(empIds)
      const filFilter = escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acessoDash.canSee)
      const ccFilter = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acessoDash.canSee)
      if (!scopedMasters.length || !empIds.length) { setTemDados(false); setLoading(false); return }
      const anos = [...anosSel].sort((a, b) => a - b), meses = [...mesesSel].sort((a, b) => a - b)
      setQparams({ empIds, anos, meses, filFilter, ccFilter })

      // cards dinâmicos: linhas de apoio/indicador do relatório (respeita visivel_dashboard) — usa o helper p/ escopo de CC
      // ⚠⚠ TODA LINHA PODE VIRAR CARTÃO (26/nov). Era só INDICADOR/`nao_soma`,
      // então pôr *Receita* ao lado do *EBITDA* era impossível — e a razão era
      // acidente de arquitetura, não decisão: no banco os dois são
      // `relatorio_linha`, distintos só pelo `tipo_linha`.
      // ⚠ `visivel_dashboard !== false` fica e vira o opt-out explícito da
      // linha. Medido na DRE Gerencial: ele é `true` em 162 das 166 linhas
      // ativas, então alargar não esconde nada por omissão.
      // ⚠ Isto NÃO enche a tela: a seção percorre `indicSel`, e vazio = nenhum
      // cartão. Aumentar o que se OFERECE não muda o que se MOSTRA.
      const indicLines = linhas.filter(l => l.tipo_linha !== 'ESPACO' && !l.desativada && l.visivel_dashboard !== false)
        .sort((a, b) => (seqOrd[a.id] ?? 9999) - (seqOrd[b.id] ?? 9999))
      // ⚠⚠ ESTES TOTAIS RESPEITAM O `filtro_escopo` DA LINHA, e `tOrc`/`tReal`
      // não. Eram "duas verdades" convivendo: o cartão de *Margem Sustentação*
      // (escopo `cc:[317]`) mostrava 4.312.927 e a PONTE, lendo `tOrc`,
      // mostrava 28.064.670 — a margem da empresa inteira. Mesma linha, mesma
      // tela, 6× de diferença.
      // Por isso saíram de dentro do `if (indicLines.length)`: a ponte e os
      // quadros precisam deles mesmo num relatório sem indicador.
      let iOrcG: Record<string, number> = {}, iRealG: Record<string, number> = {}
      let arvOrcG: Record<string, Record<string, number>> = {}, arvRealG: Record<string, Record<string, number>> = {}
      {
        const ccPermI = (ccs as any).every((c: any) => acessoDash.canSee('centro_custo', c.id)) ? null : (ccs as any).filter((c: any) => acessoDash.canSee('centro_custo', c.id)).map((c: any) => c.id)
        const baseI = { linhas: linhas as RLData[], ccs: ccs as any, empresas: empIds, meses, filialFilter: filFilter, ccFilter, ccPermitidos: ccPermI, slot: moedaSlot }
        const [rOrc, rReal, iPrev] = await Promise.all([
          totaisRelatorioArv({ ...baseI, cen: versaoId, anos }),
          totaisRelatorioArv({ ...baseI, cen: 'REALIZADO', anos }),
          totaisRelatorio({ ...baseI, cen: 'REALIZADO', anos: anos.map(a => a - 1) }),
        ])
        const iOrc = rOrc.total, iReal = rReal.total
        if (myseq !== loadSeq.current) return   // carga mais nova já começou → não sobrescreve com dados antigos
        const byIdI: Record<string, RL> = {}; linhas.forEach(l => { byIdI[l.id] = l })
        const natOfI = (id: string | null): string | null => { if (!id) return null; const l = byIdI[id]; if (!l) return null; return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : natOfI(l.pai_id) }
        iOrcG = iOrc; iRealG = iReal; arvOrcG = rOrc.arvore; arvRealG = rReal.arvore
        setIndicCards(indicLines.length ? indicLines.map(l => { const f = natOfI(l.id) === 'DESPESA' ? -1 : 1; return { id: l.id, label: l.descricao, isPct: l.formato === 'PERCENTUAL', desp: natOfI(l.id) === 'DESPESA', casas: l.casas_decimais ?? (l.formato === 'PERCENTUAL' ? 1 : 0), formato: l.formato, R: f * (iReal[l.id] || 0), O: f * (iOrc[l.id] || 0), P: f * (iPrev[l.id] || 0) } }) : [])
      }

      // orçado/realizado ESCOPADOS ao nó; lineEmp FULL (p/ EBITDA = fórmula do relatório inteiro)
      // ⚠⚠ O VALOR E O PERCENTUAL SÃO DUAS LINHAS, e o `find` antigo pegava a
      // PRIMEIRA com "ebitda" no nome — se `% EBITDA` viesse antes na ordem do
      // relatório, o gráfico de VALOR mostraria percentual, em silêncio.
      // Agora cada um é escolhido pelo `formato`, que é o campo que diz isso.
      const ehEbitda = (l: RL) => (l.descricao || '').toLowerCase().includes('ebitda')
      const ebNode = linhas.find(l => ehEbitda(l) && (l as any).formato !== 'PERCENTUAL')
      const ebPctNode = linhas.find(l => ehEbitda(l) && (l as any).formato === 'PERCENTUAL')
      const linhasCalc: LinhaCalc[] = linhas.map(l => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
      // dashboard_cc_agg retorna cc×linha×mês (muitas linhas) → PAGINAR pra não truncar no limite do Supabase
      const fetchCcAggAll = async (): Promise<any[]> => {
        const out: any[] = []; const size = 1000; let from = 0
        for (;;) {
          const { data, error } = await supabase.rpc('dashboard_cc_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter, p_slot: moedaSlot }).range(from, from + size - 1)
          if (error || !data || !data.length) break   // não-fatal: se a RPC não existe, fica vazio
          out.push(...data)
          if (data.length < size) break
          from += size
        }
        return out
      }
      const [orcR, realR, lineEmpR, realPrevR, ccAggRows] = await Promise.all([
        supabase.rpc('relatorio_orcado_agg', { p_versao: versaoId, p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter, p_slot: moedaSlot }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter, p_slot: moedaSlot }),
        supabase.rpc('relatorio_linha_empresa_agg', { p_versao: versaoId, p_anos: anos, p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter, p_slot: moedaSlot }),
        supabase.rpc('relatorio_realizado_agg', { p_empresas: empIds, p_anos: anos.map(a => a - 1), p_meses: meses, p_linhas: masterIds, p_filiais: filFilter, p_ccs: ccFilter, p_slot: moedaSlot }),
        fetchCcAggAll(),
      ])
      if (orcR.error) throw new Error(orcR.error.message)
      if (realR.error) throw new Error(realR.error.message)
      if (lineEmpR.error) throw new Error(lineEmpR.error.message)
      if (realPrevR.error) throw new Error(realPrevR.error.message)

      // ── período como lista e avaliação via ENGINE (orçado avalia fórmula de célula, igual ao relatório) ──
      const periodos: Periodo[] = []
      for (const y of anos) for (const m of meses) periodos.push({ ano: y, mes: m })
      periodos.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
      const rawOrc: RawValues = {}, rawReal: RawValues = {}
      for (const r of orcR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawOrc[rl] = rawOrc[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: r.expr ?? null } }
      for (const r of realR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawReal[rl] = rawReal[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const cOrc = computeCenario(linhasCalc, rawOrc, periodos), cReal = computeCenario(linhasCalc, rawReal, periodos)
      const tOrc = computeTotais(linhasCalc, cOrc, periodos), tReal = computeTotais(linhasCalc, cReal, periodos)
      // realizado do ano ANTERIOR (mesmos nós) p/ o comparativo YoY nos gauges
      const periodosPrev: Periodo[] = []
      for (const y of anos) for (const m of meses) periodosPrev.push({ ano: y - 1, mes: m })
      periodosPrev.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
      const rawRealPrev: RawValues = {}
      for (const r of realPrevR.data || []) { const rl = rlOfMaster[r.linha_id]; if (!rl || disabledMasters.has(r.linha_id)) continue; (rawRealPrev[rl] = rawRealPrev[rl] || {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0, expressao: null } }
      const tRealPrev = computeTotais(linhasCalc, computeCenario(linhasCalc, rawRealPrev, periodosPrev), periodosPrev)
      const leaves = linhas.filter(l => l.tipo_linha === 'ANALITICA' && !l.desativada && l.linha_orc_id && !l.nao_soma)

      // agregações ESCOPADAS (por mês/ano, por master, por filha) a partir da engine
      const omYM: Record<number, Record<number, number>> = {}, rmYM: Record<number, Record<number, number>> = {}
      const omM: Record<number, number> = {}, rmM: Record<number, number> = {}
      const orcByMaster: Record<string, number> = {}, realByMaster: Record<string, number> = {}
      const childMonthReal: Record<string, Record<number, number>> = {}
      const childOrc: Record<string, number> = {}, childReal: Record<string, number> = {}
      for (const l of leaves) {
        const m = l.linha_orc_id!; if (!scopedSet.has(m)) continue
        orcByMaster[m] = tOrc[l.id] || 0; realByMaster[m] = tReal[l.id] || 0
        const ch = masterToChild[m]
        if (ch) { childOrc[ch] = (childOrc[ch] || 0) + (tOrc[l.id] || 0); childReal[ch] = (childReal[ch] || 0) + (tReal[l.id] || 0) }
        for (const p of periodos) {
          const k = pkey(p), ov = cOrc[l.id]?.[k] || 0, rv = cReal[l.id]?.[k] || 0
          ;(omYM[p.ano] = omYM[p.ano] || {})[p.mes] = (omYM[p.ano]?.[p.mes] || 0) + ov
          ;(rmYM[p.ano] = rmYM[p.ano] || {})[p.mes] = (rmYM[p.ano]?.[p.mes] || 0) + rv
          omM[p.mes] = (omM[p.mes] || 0) + ov; rmM[p.mes] = (rmM[p.mes] || 0) + rv
          if (ch) (childMonthReal[ch] = childMonthReal[ch] || {})[p.mes] = (childMonthReal[ch]?.[p.mes] || 0) + rv
        }
      }

      // ⚠⚠ O GRÁFICO PASSA A LER O NÓ, NÃO A SOMA DAS FOLHAS (22/nov).
      // A soma de `leaves` exclui `tipo_linha` FORMULA e INDICADOR — são 14
      // linhas com master nesta DRE —, e a mais cara delas é o `IRPJ/CSLL`
      // (`=[…]*0,1520`). Resultado medido: as barras mostravam 25.049.791 de
      // orçado e o cartão ao lado 21.124.823, **diferindo exatamente pelo
      // imposto sobre o resultado**; no realizado, 20.477.541 contra
      // 17.261.200, de novo o imposto (3.216.341).
      // O cartão sempre esteve certo porque lê o NÓ pelo motor; as barras
      // somavam folhas. Duas definições de "o resultado" na mesma tela, e a
      // que aparecia maior era a errada.
      // ⚠ A mecânica não é nova: a linha laranja já lia `cReal[resNode.id]`
      // por período desde sempre — era só as barras fazerem o mesmo.
      // ⚠ Sem nó identificável (relatório sem "Resultado Líquido"), mantém a
      // soma das folhas: melhor um gráfico aproximado que um gráfico vazio.
      // Subiu de lugar: o gráfico passou a precisar dele antes dos KPIs.
      const resNode = linhas.find(l => norm(l.descricao).includes('resultado liquido'))
      const noGraf = agrup || resNode?.id || null
      setNomeGraf(noGraf ? (byId[noGraf]?.descricao || escopoNome) : escopoNome)
      if (noGraf && (cOrc[noGraf] || cReal[noGraf])) {
        for (const p of periodos) {
          const k = pkey(p)
          omM[p.mes] = cOrc[noGraf]?.[k] || 0
          rmM[p.mes] = cReal[noGraf]?.[k] || 0
        }
      }

      // EXIBIÇÃO: despesa mostrada positiva (dado continua com sinal p/ cálculo). Fator pela natureza.
      const natFac = (n: string) => n === 'DESPESA' ? -1 : 1
      const nodeFac = agrup ? natFac(natOfLine(agrup) || '') : 1
      const childNat: Record<string, string> = {}; nodeChildren.forEach(c => { childNat[c.id] = natOfLine(c.id) || '' })

      const orMes = meses.map(m => ({ mes: MESES[m - 1], mesN: m, Orçado: Math.round(nodeFac * (omM[m] || 0)), Realizado: Math.round(nodeFac * (rmM[m] || 0)) }))
      // acumulado dos anos selecionados agregados (a comparação ano a ano vive no dash Comparativo Anual)
      let accR = 0, accO = 0
      const acc = [
        { id: 'Realizado', data: meses.map(m => { accR += rmM[m] || 0; return { x: MESES[m - 1], y: Math.round(nodeFac * accR) } }) },
        { id: 'Orçado', data: meses.map(m => { accO += omM[m] || 0; return { x: MESES[m - 1], y: Math.round(nodeFac * accO) } }) },
      ]

      const comps = nodeChildren.filter(c => (childOrc[c.id] || childReal[c.id])).map(c => { const f = natFac(childNat[c.id]); return { id: c.id, filha: cut(childDesc[c.id], 26), Orçado: Math.round(f * (childOrc[c.id] || 0)), Realizado: Math.round(f * (childReal[c.id] || 0)), desp: childNat[c.id] === 'DESPESA' } })
        // ordena por magnitude (Realizado, fallback Orçado): ascendente p/ o gráfico horizontal exibir o maior no topo
        .sort((a, b) => (Math.abs(a.Realizado || a.Orçado)) - (Math.abs(b.Realizado || b.Orçado)))
      let run = 0
      const steps: any[] = []
      for (const c of nodeChildren) { const d = childReal[c.id] || 0; if (!d && !(childOrc[c.id])) continue; steps.push({ step: cut(childDesc[c.id], 14), base: Math.round(Math.min(run, run + d)), total: 0, pos: d >= 0 ? Math.round(Math.abs(d)) : 0, neg: d < 0 ? Math.round(Math.abs(d)) : 0 }); run += d }
      steps.push({ step: 'Total', base: 0, total: Math.round(run), pos: 0, neg: 0 })
      const childByTotal = nodeChildren.filter(c => childReal[c.id]).sort((a, b) => Math.abs(childReal[b.id]) - Math.abs(childReal[a.id])).slice(0, 8)
      const fMes = childByTotal.map(c => { const f = natFac(childNat[c.id]); return { id: cut(childDesc[c.id], 18), data: meses.map(m => ({ x: MESES[m - 1], y: Math.round(f * (childMonthReal[c.id]?.[m] || 0)) })) } })

      // KPIs do TOPO = relatório INTEIRO (todas as linhas), via engine
      let recOF = 0, recRF = 0, despOF = 0, despRF = 0, recBrutaOF = 0, recBrutaRF = 0
      for (const l of leaves) {
        const nat = natByMaster[l.linha_orc_id!]
        if (nat === 'RECEITA') {
          recOF += tOrc[l.id] || 0; recRF += tReal[l.id] || 0                                  // líquida (com redutoras)
          if (!redutoraByMaster[l.linha_orc_id!]) { recBrutaOF += tOrc[l.id] || 0; recBrutaRF += tReal[l.id] || 0 }  // bruta (sem redutoras)
        } else if (nat === 'DESPESA') { despOF += tOrc[l.id] || 0; despRF += tReal[l.id] || 0 }
      }
      const resOrcKpi = resNode ? (tOrc[resNode.id] || 0) : leaves.reduce((s, l) => s + (tOrc[l.id] || 0), 0)
      const resRealKpi = resNode ? (tReal[resNode.id] || 0) : leaves.reduce((s, l) => s + (tReal[l.id] || 0), 0)
      // ano anterior (mesma lógica de resultado/receita/despesa, sobre o realizado de anos-1)
      let recPF = 0, despPF = 0, recBrutaPF = 0
      for (const l of leaves) {
        const nat = natByMaster[l.linha_orc_id!]
        if (nat === 'RECEITA') { recPF += tRealPrev[l.id] || 0; if (!redutoraByMaster[l.linha_orc_id!]) recBrutaPF += tRealPrev[l.id] || 0 }
        else if (nat === 'DESPESA') despPF += tRealPrev[l.id] || 0
      }
      const resPrevKpi = resNode ? (tRealPrev[resNode.id] || 0) : leaves.reduce((s, l) => s + (tRealPrev[l.id] || 0), 0)
      // Resultado Líquido realizado por mês (linha sobreposta no gráfico Orçado × Realizado)
      const resByMesN: Record<number, number> = {}
      if (resNode) for (const p of periodos) resByMesN[p.mes] = (resByMesN[p.mes] || 0) + (cReal[resNode.id]?.[pkey(p)] || 0)
      // ⚠ A linha laranja some quando as BARRAS já são o Resultado Líquido —
      // isto é, no escopo "Relatório inteiro". Ela existe para comparar o
      // resultado contra o recorte que está sendo olhado; sobre ele mesmo,
      // desenharia exatamente em cima da barra azul e viraria enfeite.
      const resMesArr = (noGraf && resNode && noGraf === resNode.id) ? []
        : meses.map(m => ({ mes: MESES[m - 1], res: Math.round(resByMesN[m] || 0) }))

      // ── Gráficos por Área / Centro de Custo (dashboard_cc_agg → cc_id × linha × mês) ──
      // mesmos masters que o card/engine contam (folhas analíticas válidas: exclui desativada/não-soma)
      const leafMasters = new Set<string>(leaves.map(l => l.linha_orc_id as string))
      const ccInfo: Record<string, { area: string; cc: string }> = {}
      ;(ccs as any[]).forEach(c => {
        const area = c.area_cod ? `${c.area_cod}-${c.area_nome || ''}`.trim() : (c.area_nome || 'Sem área')
        ccInfo[c.id] = { area: area || 'Sem área', cc: `${c.codigo} · ${cut(c.descricao, 22)}` }
      })
      const areaDe = (cc: string | null) => (cc && ccInfo[cc]) ? ccInfo[cc].area : 'Sem área'
      // nível do meio do CC = 2 primeiros dígitos do código (área + divisão); rótulo do CC-pai se existir
      const ccById2: Record<string, any> = {}; (ccs as any[]).forEach(c => { ccById2[c.id] = c })
      const ccByCode2: Record<string, any> = {}; (ccs as any[]).forEach(c => { ccByCode2[String(c.codigo)] = c })
      const nivel2De = (ccid: string | null) => {
        const c = ccid ? ccById2[ccid] : null
        if (!c) return 'Sem CC'
        const cod2 = String(c.codigo || '').slice(0, 2)
        if (cod2.length < 2) return `${c.codigo} · ${cut(c.descricao, 20)}`
        const nome = ccByCode2[cod2]?.descricao || `${c.area_nome || ''}${c.divisao_nome ? ' / ' + c.divisao_nome : ''}`.trim() || cod2
        return `${cod2} · ${cut(nome, 20)}`
      }
      const recAreaMesA: Record<string, Record<number, number>> = {}        // 1 (realizado)
      const recAreaMesAOrc: Record<string, Record<number, number>> = {}     // 1b (orçado, p/ investigar)
      const despAreaMesA: Record<string, Record<number, number>> = {}       // 1c (despesa realizada)
      const despAreaMesAOrc: Record<string, Record<number, number>> = {}    // 1d (despesa orçada)
      const recMesT: Record<number, number> = {}, despMesT: Record<number, number> = {}  // 3
      // ⚠⚠ O PESO POR CC É ACUMULADO UMA VEZ, POR ÁREA, e serve aos TRÊS
      // gráficos por área (receita, despesa e a linha mensal). Na 1ª versão
      // só os gráficos por CC levaram a máscara e a área "4-Diretoria"
      // continuou desenhada — o Ricardo viu na tela. Guardar o peso num lugar
      // só é o que impede o próximo gráfico por área de nascer sem máscara.
      const pesAreaCc: Record<string, Record<string, number>> = {}
      const pesArea = (a: string, cc: string | null, od: number, rd: number) => {
        if (!cc) return
        const m = (pesAreaCc[a] = pesAreaCc[a] || {})
        m[cc] = (m[cc] || 0) + Math.abs(od) + Math.abs(rd)
      }
      const recAreaB: Record<string, { o: number; r: number }> = {}         // 2
      const despAreaB: Record<string, { o: number; r: number }> = {}        // 4
      // ⚠ `pes` = magnitude por CC dentro da barra. A barra é o NÍVEL 2 e
      // agrega vários CCs; a regra de dominância do modo discreto precisa
      // saber quanto de cada um, não só quais são (ver `lib/discricao.tsx`).
      const despCcB: Record<string, { o: number; r: number; ccs: Set<string>; pes: Record<string, number> }> = {}   // 5 (despesa nível 2 do CC)
      const recCcB: Record<string, { o: number; r: number; ccs: Set<string>; pes: Record<string, number> }> = {}    // 6 (receita nível 2 do CC)
      for (const row of ccAggRows) {
        if (!leafMasters.has(row.linha_id)) continue   // só folhas válidas (igual ao card; exclui desativada/não-soma)
        const nat = natByMaster[row.linha_id]
        if (nat !== 'RECEITA' && nat !== 'DESPESA') continue
        if (nat === 'RECEITA' && redutoraByMaster[row.linha_id]) continue   // receita por área = BRUTA (sem redutoras)
        const fac = nat === 'DESPESA' ? -1 : 1
        const od = fac * (Number(row.orcado) || 0), rd = fac * (Number(row.realizado) || 0)   // exibição (positivo)
        const area = areaDe(row.cc_id)
        if (nat === 'RECEITA') {
          ;(recAreaMesA[area] = recAreaMesA[area] || {})[row.mes] = (recAreaMesA[area]?.[row.mes] || 0) + rd
          ;(recAreaMesAOrc[area] = recAreaMesAOrc[area] || {})[row.mes] = (recAreaMesAOrc[area]?.[row.mes] || 0) + od
          recMesT[row.mes] = (recMesT[row.mes] || 0) + rd
          const b = (recAreaB[area] = recAreaB[area] || { o: 0, r: 0 }); b.o += od; b.r += rd
          pesArea(area, row.cc_id, od, rd)
          const cnr = nivel2De(row.cc_id); const bcr = (recCcB[cnr] = recCcB[cnr] || { o: 0, r: 0, ccs: new Set<string>(), pes: {} }); bcr.o += od; bcr.r += rd
          if (row.cc_id) { bcr.ccs.add(row.cc_id); bcr.pes[row.cc_id] = (bcr.pes[row.cc_id] || 0) + Math.abs(od) + Math.abs(rd) }
        } else {
          ;(despAreaMesA[area] = despAreaMesA[area] || {})[row.mes] = (despAreaMesA[area]?.[row.mes] || 0) + rd
          ;(despAreaMesAOrc[area] = despAreaMesAOrc[area] || {})[row.mes] = (despAreaMesAOrc[area]?.[row.mes] || 0) + od
          despMesT[row.mes] = (despMesT[row.mes] || 0) + rd
          const b = (despAreaB[area] = despAreaB[area] || { o: 0, r: 0 }); b.o += od; b.r += rd
          pesArea(area, row.cc_id, od, rd)
          const cn = nivel2De(row.cc_id); const bc = (despCcB[cn] = despCcB[cn] || { o: 0, r: 0, ccs: new Set<string>(), pes: {} }); bc.o += od; bc.r += rd
          if (row.cc_id) { bc.ccs.add(row.cc_id); bc.pes[row.cc_id] = (bc.pes[row.cc_id] || 0) + Math.abs(od) + Math.abs(rd) }
        }
      }
      const mesesOrd = [...meses].sort((a, b) => a - b)
      const PALETA = ['#3b5bdb', '#e8590c', '#2f9e44', '#7048e8', '#1098ad', '#f59f00', '#e64980', '#15aabf']
      // Realizado (cheia) + orçado (tracejada, id "… (orç)"), mesma cor por área.
      // ⚠ A COR SAI DE TODAS AS ÁREAS, não só das do gráfico: assim "3-Serviços"
      // é a mesma cor na receita e na despesa, e filtrar um gráfico não repinta
      // o outro — o que faria a mesma área parecer duas.
      const todasAreas = [...new Set([...Object.keys(recAreaMesA), ...Object.keys(recAreaMesAOrc),
                                      ...Object.keys(despAreaMesA), ...Object.keys(despAreaMesAOrc)])].sort()
      const corArea: Record<string, string> = {}; todasAreas.forEach((a, i) => { corArea[a] = PALETA[i % PALETA.length] })
      // ⚠ `acum` soma mês a mês ao longo do período EXIBIDO (`mesesOrd`), não
      // do ano civil: com o filtro em jun–set, o acumulado começa em junho. É o
      // que o resto da tela faz — tudo aqui responde ao período escolhido.
      const serieArea = (real: Record<string, Record<number, number>>, orc: Record<string, Record<number, number>>,
                         codigos: string[] | null, acum = false) => {
        const serie = (fonte: Record<number, number> | undefined) => {
          let soma = 0
          return mesesOrd.map(m => {
            const v = fonte?.[m] || 0
            soma += v
            return { x: MESES[m - 1], y: Math.round(acum ? soma : v) }
          })
        }
        const lista = [...new Set([...Object.keys(real), ...Object.keys(orc)])]
          .filter(a => !codigos || codigos.includes(codDaArea(a)))
          .filter(a => mesesOrd.some(m => (real[a]?.[m] || 0) || (orc[a]?.[m] || 0)))   // área zerada não vira legenda
          .sort()
        const out: any[] = []
        for (const a of lista) {
          const pes = pesAreaCc[a] || {}
          out.push({ id: a, color: corArea[a], _pes: pes, data: serie(real[a]) })
          out.push({ id: `${a} (orç)`, color: corArea[a], _pes: pes, data: serie(orc[a]) })
        }
        return out
      }
      const recAreaLinhasD = serieArea(recAreaMesA, recAreaMesAOrc, AREAS_RECEITA)
      // ⚠⚠ O CORTE NÃO É DITO AQUI, E ISSO É DELIBERADO (27/nov). A 1ª versão
      // nomeava em laranja as áreas com receita que ficavam de fora — e elas
      // são SEMPRE as mesmas (1-CSC e 4-Diretoria, receita que o Ricardo
      // identificou como erro de lançamento). Aviso que acende em toda sessão
      // deixa de avisar, como o asterisco da PLR. E o corte não fica calado:
      // o comparativo de barras logo abaixo (`recAreaBar`) é montado de
      // `recAreaB`, SEM filtro de área — toda área com receita aparece lá.
      // ⚠ Ao mexer naquele gráfico, não lhe acrescente o filtro de área: é ele
      // que impede este recorte de esconder dinheiro.
      const agrupadas = new Set(GRUPOS_DESPESA.flatMap(g => g.areas))
      // ⚠⚠ DESPESA VAI ACUMULADA, RECEITA NÃO — e os dois cartões ficam na mesma
      // tela, então o subtítulo de cada um DIZ qual é. Despesa mês a mês oscila
      // com competência (13º, férias, provisão), e a pergunta real é se o ano
      // está dentro do orçado; acumulada, o afastamento entre a cheia e a
      // tracejada é a resposta. Duas convenções sem rótulo é como se lê o
      // número errado com confiança.
      const despGruposD = [
        ...GRUPOS_DESPESA.map(g => ({ titulo: g.titulo, linhas: serieArea(despAreaMesA, despAreaMesAOrc, g.areas, true) })),
        { titulo: 'Outras áreas', linhas: serieArea(despAreaMesA, despAreaMesAOrc, null, true)
            .filter(s => !agrupadas.has(codDaArea(String(s.id)))) },
      ].filter(g => g.linhas.length)
      const recDespLinhasD = [
        { id: 'Receitas', data: mesesOrd.map(m => ({ x: MESES[m - 1], y: Math.round(recMesT[m] || 0) })) },
        { id: 'Despesas', data: mesesOrd.map(m => ({ x: MESES[m - 1], y: Math.round(despMesT[m] || 0) })) },
      ]
      const barDe = (acc: Record<string, { o: number; r: number }>, key: string) => Object.entries(acc).filter(([, v]) => v.o || v.r)
        .map(([k, v]) => ({ [key]: k, 'Orçado': Math.round(v.o), 'Realizado': Math.round(v.r), 'Δ': Math.round(v.r - v.o), _pes: pesAreaCc[k] || {} }))
        .sort((a, b) => (b['Realizado'] as number) - (a['Realizado'] as number))
      const recAreaBarD = barDe(recAreaB, 'area'), despAreaBarD = barDe(despAreaB, 'area')
      const ccBar = (acc: Record<string, { o: number; r: number; ccs: Set<string>; pes: Record<string, number> }>) => Object.entries(acc).filter(([, v]) => v.o || v.r)
        .map(([k, v]) => ({ cc: k, 'Orçado': Math.round(v.o), 'Realizado': Math.round(v.r), 'Δ': Math.round(v.r - v.o), _ccs: [...v.ccs], _pes: v.pes }))
        .sort((a, b) => String(a.cc).localeCompare(String(b.cc), 'pt-BR', { numeric: true }))   // ordena pelo rótulo do eixo X (nível 2)
      const despCcBarD = ccBar(despCcB), recCcBarD = ccBar(recCcB)

      // por empresa (016) + EBITDA por empresa (engine por empresa)
      const empName: Record<string, string> = {}; empresas.forEach(e => { empName[e.id] = `${e.codigo} · ${cut(e.descricao, 22)}` })
      const totByEmp: Record<string, { o: number; r: number }> = {}
      const orcEM: Record<string, Record<string, number>> = {}, realEM: Record<string, Record<string, number>> = {}
      for (const x of lineEmpR.data || []) {
        if (!empSet.has(x.empresa_id) || disabledMasters.has(x.linha_id)) continue
        const e = x.empresa_id, m = x.linha_id, o = Number(x.orcado) || 0, r = Number(x.realizado) || 0
        ;(orcEM[e] = orcEM[e] || {})[m] = o; (realEM[e] = realEM[e] || {})[m] = r
        if (scopedSet.has(m)) { (totByEmp[e] = totByEmp[e] || { o: 0, r: 0 }).o += o; totByEmp[e].r += r }
      }
      // top 14 por Realizado; ascendente p/ o gráfico horizontal exibir o maior no topo
      const pe = Object.entries(totByEmp).map(([id, v]) => ({ empresa: empName[id] || '?', Orçado: Math.round(nodeFac * v.o), Realizado: Math.round(nodeFac * v.r) })).sort((a, b) => b.Realizado - a.Realizado).slice(0, 14).reverse()

      const SP: Periodo = { ano: 0, mes: 1 }; const EPK = pkey(SP)
      const evalTot = (lineId: string, valByMaster?: Record<string, number>) => {
        const computed: Computed = {}; linhasCalc.forEach(l => { computed[l.id] = {} })
        for (const mm of masterIds) { const rl = rlOfMaster[mm]; if (rl) computed[rl][EPK] = (valByMaster?.[mm]) || 0 }
        return computeTotais(linhasCalc, computed, [SP])[lineId] || 0
      }
      let eb: any[] = []
      if (ebNode) {
        eb = Object.keys(orcEM).filter(id => empSet.has(id)).map(id => ({ empresa: empName[id] || '?', Orçado: Math.round(evalTot(ebNode.id, orcEM[id])), Realizado: Math.round(evalTot(ebNode.id, realEM[id])) }))
          .filter(x => x.Orçado || x.Realizado).sort((a, b) => b.Realizado - a.Realizado).slice(0, 14).reverse()
      }

      // % EBITDA por empresa — a pergunta que o valor não responde: BAURU é a
      // maior, mas é a mais eficiente? Mesmo motor por empresa do EBITDA ao
      // lado, só que na linha percentual do próprio relatório: a definição de
      // "% EBITDA" (sobre receita líquida ou bruta) é do cadastro, não daqui.
      let ebPct: any[] = []
      if (ebPctNode) {
        const r1 = (n: number) => Math.round(n * 10) / 10
        ebPct = Object.keys(orcEM).filter(id => empSet.has(id))
          .map(id => ({ empresa: empName[id] || '?', Orçado: r1(evalTot(ebPctNode.id, orcEM[id])), Realizado: r1(evalTot(ebPctNode.id, realEM[id])) }))
          .filter(x => x.Orçado || x.Realizado).sort((a, b) => b.Realizado - a.Realizado).slice(0, 14).reverse()
      }

      const desv = scopedMasters.map(m => ({ m, conta: descByMaster[m] || '—', d: (realByMaster[m] || 0) - (orcByMaster[m] || 0) }))
        .filter(x => x.d).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 12).reverse().map(x => ({ conta: cut(x.conta, 26), Δ: Math.round(x.d), nodeId: rlOfMaster[x.m] }))

      if (myseq !== loadSeq.current) return   // carga mais nova já começou → descarta esta
      setKpi({ resOrc: resOrcKpi, resReal: resRealKpi, recOrc: recOF, recReal: recRF, despOrc: despOF, despReal: despRF, resPrev: resPrevKpi, recPrev: recPF, despPrev: despPF, recBrutaOrc: recBrutaOF, recBrutaReal: recBrutaRF, recBrutaPrev: recBrutaPF })
      setOrcRealMes(orMes); setResMes(resMesArr); setAccLines(acc); setComposicao(comps); setCompOcultas(childrenOcultas); setFilhasMes(fMes); setCascata(steps)
      setRecAreaLinhas(recAreaLinhasD); setDespGrupos(despGruposD); setRecDespLinhas(recDespLinhasD); setRecAreaBar(recAreaBarD); setDespAreaBar(despAreaBarD); setDespCcBar(despCcBarD); setRecCcBar(recCcBarD)
      setPorEmpresa(pe); setEbitdaEmp(eb); setEbitdaPctEmp(ebPct); setDesvios(desv)
      // ⚠⚠ A ponte e os quadros leem os totais de `totaisRelatorio`, NÃO
      // `tOrc`/`tReal`: os dois passaram pelo motor, mas só o primeiro aplica o
      // `filtro_escopo` da linha. Com `tOrc`, *Margem Sustentação* (escopo
      // `cc:[317]`) abria a ponte em 28.064.670 — a margem da empresa inteira —
      // enquanto o cartão ao lado dizia 4.312.927. **Mesma linha, mesma tela,
      // 6× de diferença, e nada na tela dizia qual era qual.**
      // A ponte não recalcula nada: ela decompõe o que o cartão mostra, então
      // tem de ler da mesma fonte que ele.
      setTotais({ orc: iOrcG, real: iRealG, arvOrc: arvOrcG, arvReal: arvRealG })
      // ⚠⚠ ZERO CONSULTA NOVA. `lineEmpR` (empresa × linha) e `ccAggRows`
      // (cc × linha × mês) já trazem `orcado` E `realizado` e já eram
      // carregados por esta tela — o quadro "quem causou" só precisava que
      // alguém guardasse os dois lados em vez de descartar um.
      // `b` = orçado, `c` = realizado; `invertido` diz à peça que a ORIGEM é o
      // lado `b`, que aqui é sempre o plano.
      const dEmp: LadoPorMaster = {}, dCc: LadoPorMaster = {}
      const acum = (alvo: LadoPorMaster, chave: string | null, master: string, campo: 'b' | 'c', v: number) => {
        if (!v) return
        const m = (alvo[chave || '__sem'] = alvo[chave || '__sem'] || {})
        const cel = (m[master] = m[master] || { b: 0, c: 0 })
        cel[campo] += v
      }
      for (const x of lineEmpR.data || []) {
        if (!empSet.has(x.empresa_id) || disabledMasters.has(x.linha_id)) continue
        acum(dEmp, x.empresa_id, x.linha_id, 'b', Number(x.orcado) || 0)
        acum(dEmp, x.empresa_id, x.linha_id, 'c', Number(x.realizado) || 0)
      }
      for (const r of ccAggRows) {
        if (disabledMasters.has(r.linha_id)) continue
        acum(dCc, r.cc_id, r.linha_id, 'b', Number(r.orcado) || 0)
        acum(dCc, r.cc_id, r.linha_id, 'c', Number(r.realizado) || 0)
      }
      setDimBruto({ emp: dEmp, cc: dCc })
      setLinhasRel(linhas)
      // A linha de partida acompanha o escopo: sem agrupadora, o Resultado
      // Líquido — o mesmo nó do gráfico mensal e do cartão.
      setPCfg((p: any) => (p.resultado && linhas.some(l => l.id === p.resultado)) ? p : { ...p, resultado: noGraf || '' })
      setTemDados(Object.keys(omM).length > 0 || Object.keys(rmM).length > 0)
    } catch (e: any) { if (myseq === loadSeq.current) setErro(e?.message ?? String(e)) }
    if (myseq === loadSeq.current) setLoading(false)
  }
  useEffect(() => { load() }, [relId, versaoId, agrupId, anosSel, mesesSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, empresas, filiais, ccs, acessoDash.loading, moedaSlot]) // eslint-disable-line

  const anosOrd = [...anosSel].sort((a, b) => a - b)
  const deltaMes = orcRealMes.map((m: any) => ({ mes: m.mes, 'Δ': Math.round((m.Realizado || 0) - (m.Orçado || 0)) }))
  // mapas p/ o drill dos gráficos por área/CC (área/CC clicada → cc_ids, só os visíveis ao usuário)
  const areaToCcs: Record<string, string[]> = {}
  ;(ccs as any[]).forEach(c => {
    if (!acessoDash.canSee('centro_custo', c.id)) return
    const area = ((c.area_cod ? `${c.area_cod}-${c.area_nome || ''}`.trim() : (c.area_nome || 'Sem área')) || 'Sem área')
    ;(areaToCcs[area] = areaToCcs[area] || []).push(c.id)
  })
  const drillPorCcs = (ids: string[], meses?: number[]) => {
    if (!qparams || !ids.length) return
    const f = qparams.ccFilter ? ids.filter(i => qparams.ccFilter!.includes(i)) : ids
    if (f.length) setDrill({ nodeId: '__root', ccFilter: f, meses: meses?.length ? meses : undefined })
  }
  // drill a partir de um ponto de linha (área × mês) → razão escopado àquela área e mês
  // ⚠⚠ NUM GRÁFICO ACUMULADO O PONTO NÃO É O MÊS, É O PERÍODO ATÉ ELE — e o
  // drill tem de abrir o mesmo recorte, senão o detalhe não soma o total que o
  // abriu (a regra do `DrillCombinacoes`). Clicar em "Jun" no acumulado traz
  // jan–jun; no mês a mês continua trazendo só junho.
  const drillAreaMes = (area: string, mesLabel: string, acum = false) => {
    const a = String(area).replace(' (orç)', '')   // série de orçado compartilha os CCs da área
    const m = MESES.indexOf(String(mesLabel)) + 1
    if (m <= 0) { drillPorCcs(areaToCcs[a] || []); return }
    const ord = [...mesesSel].sort((x, y) => x - y)
    const ate = ord.indexOf(m)
    drillPorCcs(areaToCcs[a] || [], acum && ate >= 0 ? ord.slice(0, ate + 1) : [m])
  }
  const chip = `${escopoNome} · ${anosOrd.join(', ') || '—'} · ${mesesSel.length === 12 ? 'todos os meses' : mesesSel.length + ' meses'}`
    + ` · ${empresaSel.length ? empresaSel.length + ' empresa(s)' : 'todas as empresas'}`
    + (filialSel.length && filialSel.length < filiais.length ? ` · ${filialSel.length} filial` : '')
    + (ccSel.length && ccSel.length < ccs.length ? ` · ${ccSel.length} CC` : '')

  const KpiCard = ({ lbl, orc, real, prev, anoPrev, desp, liq }: { lbl: string; orc: number; real: number; prev?: number; anoPrev?: number; desp?: boolean; liq?: number }) => {
    const p = pctOf(real, orc); const up = real >= orc
    const f = desp ? -1 : 1   // despesa exibida positiva (dado é negativo)
    const d = f * (real - orc)   // delta (Realizado − Orçado) na orientação exibida
    // comparativo com o ano anterior (mesma lógica dos cards personalizados)
    const temP = prev != null && anoPrev != null
    const Rv = f * real, Pv = temP ? f * (prev as number) : 0
    const yoy = temP && Pv !== 0 ? (Rv / Pv - 1) * 100 : null
    const bomY = desp ? Rv <= Pv : Rv >= Pv
    return (
      <div style={S.kpi}>
        <div style={S.kpiLbl}>{lbl}</div>
        <div style={{ ...S.kpiVal, color: desp ? '#e03131' : 'var(--text)' }}>{fmt(f * real)}</div>
        <div style={S.kpiSub}>Orçado {fmt(f * orc)} <span style={{ color: up ? '#2f9e44' : '#e03131', fontWeight: 600 }}>({d >= 0 ? '+' : ''}{fmt(d)})</span> · {p == null ? '—' : <span style={{ color: up ? '#2f9e44' : '#e03131', fontWeight: 600 }}>{up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {p.toFixed(0)}%</span>}</div>
        {temP && (Pv !== 0
          ? <div style={{ ...S.kpiSub, marginTop: 2 }}>{anoPrev}: {fmt(Pv)} <span style={{ color: bomY ? '#2f9e44' : '#e03131', fontWeight: 600 }}>{yoy != null ? `(${yoy >= 0 ? '+' : ''}${yoy.toFixed(0)}%)` : ''}</span></div>
          : <div style={{ ...S.kpiSub, marginTop: 2, color: 'var(--faint)' }}>sem dado {anoPrev}</div>)}
        {liq != null && <div style={{ ...S.kpiSub, marginTop: 2 }}>Líquida: <strong style={{ color: 'var(--text-mid)' }}>{fmt(liq)}</strong></div>}
      </div>
    )
  }

  // Layer custom do @nivo/line: orçado (id "… orç") sai tracejado; realizado, cheio
  const AccLinhas = ({ series, lineGenerator }: any) => (
    <g>
      {series.map((s: any) => (
        <path key={s.id} d={lineGenerator(s.data.map((d: any) => d.position))} fill="none" stroke={s.color} strokeWidth={2}
          strokeDasharray={String(s.id).toLowerCase().includes('orç') ? '6 4' : undefined} />
      ))}
    </g>
  )

  // ⚠⚠ A LEGENDA LISTA SÓ O REALIZADO. Cada área tem DUAS séries — a cheia e a
  // tracejada —, e o quadradinho da legenda não sabe desenhar traço: as duas
  // entradas saem com a MESMA cor e o MESMO símbolo, dobrando a largura para
  // repetir o que o subtítulo já diz ("cheia = realizado · tracejada = orçado").
  // Com 4 séries ela transbordava o cartão e caía sobre as linhas.
  const legArea = (linhas: any[]) => linhas
    .filter((se: any) => !String(se.id).includes('(orç)'))
    .map((se: any) => ({ id: se.id, label: se.id, color: se.color }))
  // ⚠ Abaixo do eixo X, não no canto superior: ancorada em cima ela disputa
  // espaço justamente onde a linha de maior valor passa. O `bottom: 76` da
  // margem é o que abre a faixa — mexer num sem o outro põe a legenda em cima
  // dos rótulos dos meses.
  const LEG_BAIXO: any = { anchor: 'bottom', direction: 'row', translateY: 62, itemWidth: 104, itemHeight: 16, symbolSize: 12, itemsSpacing: 4 }
  const MARG_LEG = { top: 10, right: 16, bottom: 76, left: 56 }

  // Tooltip dos comparativos por área/CC (Orçado/Realizado/Δ; cor do Δ por bom/ruim, despesa invertida)
  const barTip = (titulo: string, data: any, desp: boolean) => {
    const o = Number(data['Orçado'] || 0), r = Number(data['Realizado'] || 0), dd = Number(data['Δ'] || 0)
    const bom = desp ? dd <= 0 : dd >= 0
    return <div style={tipBox}><strong>{titulo}</strong><br />Orçado: {fmt(o)}<br />Realizado: <strong>{fmt(r)}</strong><br /><span style={{ color: bom ? '#2f9e44' : '#e03131', fontWeight: 600 }}>Δ (R−O): {(dd >= 0 ? '+' : '') + fmt(dd)}</span></div>
  }

  // Layer custom do @nivo/bar: sobrepõe a linha de Resultado Líquido (realizado) por mês, com rótulos
  const LinhaResultado = ({ bars, yScale }: any) => {
    if (!resMes.length || !bars?.length) return null
    const centro: Record<string, { sx: number; n: number }> = {}
    bars.forEach((b: any) => { const k = String(b.data.indexValue); const c = centro[k] || (centro[k] = { sx: 0, n: 0 }); c.sx += b.x + b.width / 2; c.n++ })
    const pts = resMes.filter(r => centro[r.mes]).map(r => ({ x: centro[r.mes].sx / centro[r.mes].n, y: yScale(r.res), v: r.res }))
    if (!pts.length) return null
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    return (
      <g>
        <path d={d} fill="none" stroke="#f59f00" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="#f59f00" stroke="var(--panel)" strokeWidth={1} />
            <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize={9} fontWeight={700} fill="#f59f00">{fmtPonto(p.v)}</text>
          </g>
        ))}
      </g>
    )
  }

  return (
    <div style={S.page} ref={dashRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <Link to="/dashboards" style={{ ...S.btn, textDecoration: 'none' }}><ArrowLeft size={14} /> Dashboards</Link>
        <h1 style={S.title}>DRE — Acompanhamento{cardNome && <span style={{ color: '#3b5bdb' }}> · {cardNome}</span>}</h1>
      </div>
      <p style={S.sub}>Escopo: <strong>{escopoNome}</strong>. Execução orçado × realizado, por filha e por empresa.</p>

      <div style={S.bar} data-noexport>
        <select style={S.sel} value={relId} onChange={e => { setRelId(e.target.value); setAgrupId('') }}>
          <option value="">— Relatório —</option>
          {rels.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <select style={{ ...S.sel, maxWidth: 260 }} value={agrupId} onChange={e => setAgrupId(e.target.value)} title="Linha agrupadora">
          <option value="">Relatório inteiro</option>
          {agrupOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
          <option value="">— Versão —</option>
          {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
        </select>
        <PeriodoButton resumo={`${anosOrd.join(', ') || '—'} · ${mesesSel.length === 12 ? 'todos meses' : mesesSel.length + ' meses'}`}>
          <label style={S.label}>Período — clique nas células (anos × meses)</label>
          <div style={{ overflowX: 'auto' }}>
            <AnoMesGrid periodosSel={periodosSel} setPeriodosSel={setPeriodosSel} />
          </div>
        </PeriodoButton>
        <BotaoDiscreto ccs={acessoDash.filterList('centro_custo', ccs as any) as any} />
        <FiltrosButton empresas={acessoDash.filterList('empresa', empresas)} filiais={acessoDash.filterList('filial', filiais)} ccs={acessoDash.filterList('centro_custo', ccs as any) as any} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel} areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        <MoedaSelect moedas={moedas} slot={moedaSlot} setSlot={setMoedaSlot} />
        <button style={S.btn} onClick={load} title="Recarregar"><RefreshCw size={13} /></button>
        <SalvarCardButton base="/dashboard" cor="#3b5bdb" cardId={cardId} getFiltros={() => ({ relId, versaoId, agrupId, periodosSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, indicSel })} />
        <ExportarButton alvo={dashRef} nome="dre-acompanhamento" titulo={`DRE — Acompanhamento${cardNome ? ` · ${cardNome}` : ''}`} legenda={`${escopoNome} · ${anosOrd.join(', ')} · ${mesesSel.length === 12 ? 'todos os meses' : `${mesesSel.length} meses`}`} />
        {indicCards.length > 0 && <button style={S.btn} onClick={() => setPickIndic(true)} title="Escolher e ordenar os cartões do painel"><ListChecks size={13} /> Cartões{indicSel.length ? ` (${indicSel.length})` : ''}</button>}
        {loading && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Carregando…</span>}
      </div>

      {/* Atalho das duas perguntas do dia a dia. Escreve no MESMO estado do
          modal de Filtros, então a contagem do botão acompanha. */}
      <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <PillsDim ccs={acessoDash.filterList('centro_custo', ccs as any) as any}
          codKey="area_cod" nomeKey="area_nome" titulo="Área" sel={areaSel} setSel={setAreaSel} />
        <PillsDim ccs={acessoDash.filterList('centro_custo', ccs as any) as any}
          codKey="divisao_cod" nomeKey="divisao_nome" titulo="Divisão" sel={divisaoSel} setSel={setDivisaoSel} />
      </div>
      {/* ⚠ `PickerLinhas` no lugar do `Checklist`: o checklist dizia QUAIS e não
          dizia em que ORDEM, e `indicSel` é a ordem desde 23/nov. O arrasto no
          card resolvia metade — quem monta o painel pelo modal não tinha como.
          É o MESMO componente da análise de orçamento, de propósito. */}
      {pickIndic && (
        <PickerLinhas titulo="Cartões do painel" sel={indicSel} setSel={setIndicSel} fechar={() => setPickIndic(false)}
          candidatos={indicCards.map(c => ({ id: c.id, descricao: c.label, tipo_linha: byIdRel[c.id]?.tipo_linha, formato: c.formato }))}
          nota="Indicadores e linhas do relatório na MESMA lista — dá para pôr Receita ao lado do EBITDA. A ordem desta lista é a ordem dos cards; arrastar o card na tela faz o mesmo." />
      )}
      <div style={S.chip}>{chip}</div>

      {erro && <div style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid #ffc9c9', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>⚠ {erro}</div>}

      {!temDados && !loading ? (
        <div style={S.empty}>Sem dados para os filtros selecionados.</div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 8 }}>Visão geral do relatório (não afetada pela linha agrupadora)</div>
          <div style={S.kpis}>
            <KpiCard lbl="Resultado" orc={kpi.resOrc} real={kpi.resReal} prev={kpi.resPrev} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} />
            <KpiCard lbl="Receita Bruta" orc={kpi.recBrutaOrc} real={kpi.recBrutaReal} prev={kpi.recBrutaPrev} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} liq={kpi.recReal} />
            <KpiCard lbl="Despesa" orc={kpi.despOrc} real={kpi.despReal} prev={kpi.despPrev} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} desp />
          </div>

          <div style={{ ...S.card, display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16 }}>
            <Gauge label="Execução Resultado" pct={pctOf(kpi.resReal, kpi.resOrc)} />
            <Gauge label="Execução Receita" pct={pctOf(kpi.recReal, kpi.recOrc)} />
            <Gauge label="Execução Despesa" pct={pctOf(kpi.despReal, kpi.despOrc)} desp />
          </div>

          {/* ⚠ PERCORRE `indicSel`, não filtra `indicCards`. Filtrando, a ordem
              era sempre a da estrutura do relatório e o arrasto não teria onde
              aparecer — o array já guardava a ordem, a tela é que a ignorava.
              O `.filter(Boolean)` descarta id de indicador que não existe mais
              (relatório trocado), como o filtro antigo fazia de graça. */}
          {(() => {
            const vis = indicSel.map(id => indicCards.find(c => c.id === id)).filter(Boolean) as IC[]
            return vis.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '16px 0 8px' }}>
                Cartões do painel
                <span data-noexport style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--faint)' }}>
                  clique para a memória de cálculo · arraste para reordenar
                </span>
              </div>
              <div style={S.kpis}>
                {vis.map(c => (
                  <div key={c.id} draggable
                    onPointerDown={e => { toqueInd.current = { x: e.clientX, y: e.clientY } }}
                    onClick={e => {
                      const t = toqueInd.current
                      // ⚠ Só abre onde há o que abrir — ver `decompoe` na análise.
                      if (!componentesMem(byIdRel[c.id], linhasRel as any).length) return
                      if (t && Math.abs(e.clientX - t.x) < 5 && Math.abs(e.clientY - t.y) < 5) setMemoria(c.id)
                    }}
                    title={componentesMem(byIdRel[c.id], linhasRel as any).length
                      ? 'clique para ver a memória de cálculo · arraste para reordenar'
                      : 'arraste para reordenar'}
                    onDragStart={e => { setArrInd(c.id); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setArrInd(null); setSobreInd(null) }}
                    onDragOver={e => { e.preventDefault(); if (sobreInd !== c.id) setSobreInd(c.id) }}
                    onDrop={e => { e.preventDefault(); soltarInd(c.id) }}
                    style={{ cursor: 'grab', borderRadius: 12,
                             opacity: arrInd === c.id ? 0.45 : 1,
                             outline: sobreInd === c.id && arrInd && arrInd !== c.id ? '2px dashed var(--violet)' : 'none',
                             outlineOffset: 2, transition: 'opacity .12s' }}>
                    <IndicCard c={c} anoPrev={(anosSel.length ? Math.min(...anosSel) : 0) - 1} meta={resolverMeta(metas, c.id, anosSel.length ? Math.max(...anosSel) : 0, empresaSel.length === 1 ? empresaSel[0] : null)} />
                  </div>
                ))}
              </div>
            </>
          ) })()}

          {/* ⚠ Depois dos indicadores, de propósito: os cartões respondem
              "quanto", a ponte responde "de onde vem" — e a segunda pergunta
              só faz sentido depois da primeira. */}
          {/* ⚠⚠ A MEMÓRIA NÃO É A PONTE, e a diferença é a pergunta: a ponte
              decompõe a VARIAÇÃO entre dois números, a memória decompõe o
              NÚMERO. Quem confere uma fórmula quer a segunda — e a primeira
              exige um comparativo que pode nem fazer sentido.
              ⚠ As colunas saem da ÁRVORE ESCOPADA quando a linha tem
              `filtro_escopo`: mesma razão da ponte, mesma fonte. */}
          {memoria && totais && (() => {
            const lm = linhasRel.find(l => l.id === memoria)
            const esc = !!totais.arvOrc[memoria]
            return <MemoriaModal id={memoria} linhas={linhasRel as any} onClose={() => setMemoria(null)}
              nota={esc ? `Recorte próprio de ${lm?.descricao ?? 'linha'} — os termos abaixo são calculados no escopo dela.` : undefined}
              // ⚠ O razão fecha a descida: na folha da estrutura não há mais
              // fórmula, há lançamento. É o MESMO `DrillModal` da ponte.
              // ⚠⚠ Mas ele herda o RECORTE DA LINHA quando ela é escopada —
              // abrir com o filtro da tela daria um número maior que o da
              // linha que o abriu, que é o defeito do drill já registrado.
              onRazao={qparams ? (lid: string) => {
                const e = (lm as any)?.filtro_escopo
                let cc: string[] | null | undefined = undefined
                if (e && Object.values(e).some((a: any) => (a || []).length)) {
                  let x = effectiveCcFilter(ccs as any, e.cc || [], e.area || [], e.divisao || [], e.bu || [])
                  if (qparams.ccFilter) x = x === null ? [...qparams.ccFilter] : x.filter(z => qparams.ccFilter!.includes(z))
                  cc = x ?? undefined
                }
                setDrill({ nodeId: lid, ...(cc !== undefined ? { ccFilter: cc } : {}) })
              } : undefined}
              colInicial={1}   // o cartão lidera com o realizado; abrir no orçado parecia erro de conta
              cols={[
                { rot: versoes.find(v => v.id === versaoId)?.codigo || 'Orçado', val: totais.arvOrc[memoria] || totais.orc },
                { rot: 'Realizado', val: totais.arvReal[memoria] || totais.real },
              ]} />
          })()}

          {totais && pCfg.resultado && (() => {
            // ⚠⚠ LINHA ESCOPADA NÃO SE DECOMPÕE COM OS COMPONENTES DA TELA.
            // `totais.orc/real` dá à linha com `filtro_escopo` o valor do
            // escopo dela e a todas as outras o valor do filtro da tela — e aí
            // *Margem Sustentação* (CC 317) ficava ao lado de `Receitas` da
            // empresa inteira: Δ de 353.052 com resíduo de 5.736.247, 1625%.
            // `arvOrc/arvReal` trazem a árvore TODA no escopo da linha.
            // ⚠ O escopo vem do PONTO DE ENTRADA (`trilha[0]`), não da linha
            // atual: descendo de Margem Sustentação para Receitas, a linha de
            // destino não tem escopo próprio e a ponte saltaria de volta para a
            // empresa inteira **no meio da navegação**, sem dizer nada.
            const raiz = pTrilha[0] ?? pCfg.resultado
            const aOrc = totais.arvOrc[raiz], aReal = totais.arvReal[raiz]
            const lr = linhasRel.find((l: any) => l.id === raiz)
            return (
            <Ponte linhas={linhasRel} nome={(id: string) => linhasRel.find(l => l.id === id)?.descricao ?? '—'}
              cfg={pCfg} setCfg={setPCfg}
              nota={aOrc ? `Recorte próprio de ${lr?.descricao ?? 'linha'} — os componentes abaixo são calculados no mesmo escopo dela, senão a ponte não fecha.` : undefined}
              origem={aOrc || totais.orc} destino={aReal || totais.real}
              rotOrigem={versoes.find(v => v.id === versaoId)?.codigo || 'Orçado'} rotDestino="Realizado"
              trilha={pTrilha} setTrilha={setPTrilha} navRef={pNav}
              nat={pNat} setNat={setPNat} ate={pAte} setAte={setPAte}
              onDrill={qparams ? (id: string) => setDrill({ nodeId: id }) : undefined} />
            )
          })()}

          {/* ⚠ A MESMA variação, por três eixos: a ponte por LINHA, o "quem
              causou" por DIMENSÃO e o "o que mudou" como RANKING. Os três
              fecham no mesmo Δ, e é isso que permite ler um contra o outro. */}
          {totais && pCfg.resultado && (
            <QuemCausou linhas={linhasRel} nome={(id: string) => linhasRel.find(l => l.id === id)?.descricao ?? '—'}
              bruto={dimBruto} empresas={empresas} ccs={ccs}
              resId={pCfg.resultado} componentes={pCfg.sel} invertido
              rotOrigem={versoes.find(v => v.id === versaoId)?.codigo || 'Orçado'} rotDestino="Realizado"
            restritos={restritos}
              dim={quemDim} setDim={setQuemDim} ano={anosSel.length ? Math.max(...anosSel) : 0}
              dTotal={(totais.real[pCfg.resultado] ?? 0) - (totais.orc[pCfg.resultado] ?? 0)}
              totOrigem={totais.orc[pCfg.resultado]} totDestino={totais.real[pCfg.resultado]} />
          )}

          {totais && (
            <Variacao cfg={vCfg} setCfg={setVCfg} linhas={linhasRel}
              nome={(id: string) => linhasRel.find(l => l.id === id)?.descricao ?? '—'}
              origem={totais.orc} destino={totais.real} val={valRel} fac={facRel}
              rotOrigem={versoes.find(v => v.id === versaoId)?.codigo || 'Orçado'} rotDestino="Realizado"
              aba={vAba} setAba={setVAba} nivel={vNivel} setNivel={setVNivel} nat={vNat} setNat={setVNat} />
          )}

          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>Composição por filha — {escopoNome}
                {compOcultas > 0 && <span title="Há linhas marcadas como não visíveis no dashboard. Elas continuam no cálculo, por isso as filhas podem não somar o total." style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#7048e8', border: '1px solid #d0bfff', borderRadius: 4, padding: '1px 6px' }}>+{compOcultas} oculta{compOcultas > 1 ? 's' : ''}</span>}
              </div>
              {composicao.length ? (
                <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, composicao.length * 34 + 50) }}>
                  <ResponsiveBar theme={nivoTheme()} data={composicao} keys={['Orçado', 'Realizado']} indexBy="filha" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 160 }} padding={0.25} innerPadding={2}
                    colors={['#9aa0aa', '#3b5bdb']} axisBottom={{ format: (v: any) => fmtEixo(Number(v)) }}
                    enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate onClick={(d: any) => d.data.id && qparams && setDrill({ nodeId: d.data.id })}
                    tooltip={({ data }: any) => <TipOR titulo={data.filha} data={data} hint="clique para detalhar" />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Esta linha não tem filhas com valor.</div>}
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Filhas ao longo dos meses (realizado)</div>
              {filhasMes.length ? (
                <div style={S.chart}>
                  <ResponsiveLine theme={nivoTheme()} data={filhasMes} margin={{ top: 10, right: 16, bottom: 64, left: 56 }}
                    xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                    colors={filhasMes.map((_, i) => CAT[i % CAT.length])} pointSize={5} useMesh curve="monotoneX"
                    axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }}
                    legends={[{ anchor: 'bottom', direction: 'row', translateY: 56, itemWidth: 110, itemHeight: 14, symbolSize: 10, itemsSpacing: 2 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Sem filhas com realizado.</div>}
            </div>
          </div>


          <div style={S.grid2}>
            <div style={S.card}>
              {/* ⚠ O cartão DIZ de que linha ele fala. Antes era só "Orçado ×
                  Realizado por mês", e as barras somavam folhas — então o
                  número não era o de lugar nenhum da DRE. Agora é o nó, e o
                  nome dele fica no título: um gráfico de resultado tem de
                  declarar qual resultado. */}
              <div style={S.cardT}>{nomeGraf || escopoNome} — orçado × realizado por mês{' '}
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(clique no mês p/ detalhar)</span>
                {resMes.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#f59f00' }}> — linha: Resultado Líquido</span>}</div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={orcRealMes} keys={['Orçado', 'Realizado']} indexBy="mes" groupMode="grouped"
                  margin={{ top: 18, right: 10, bottom: 40, left: 56 }} padding={0.25} innerPadding={2}
                  colors={['#9aa0aa', '#3b5bdb']} borderRadius={3}
                  layers={['grid', 'axes', 'bars', LinhaResultado, 'markers', 'legends']}
                  axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  onClick={(d: any) => { const m = d.data?.mesN || (MESES.indexOf(String(d.indexValue)) + 1); if (m > 0 && qparams) setDrill({ nodeId: agrupId || '__root', meses: [m] }) }}
                  tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} desp={escopoDesp} />}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Diferença (Realizado − Orçado) por mês</div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={deltaMes} keys={['Δ']} indexBy="mes"
                  margin={{ top: 10, right: 10, bottom: 40, left: 56 }} padding={0.3} borderRadius={3}
                  colors={(b: any) => corDelta(Number(b.value), escopoDesp)}
                  axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, value }: any) => <div style={tipBox}><strong>{String(indexValue)}</strong><br /><span style={{ color: corDelta(Number(value), escopoDesp), fontWeight: 600 }}>Δ (R−O): {fmt(Number(value))}</span></div>} />
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Acumulado por ano <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(linha cheia = realizado · tracejada = orçado)</span></div>
            <div style={S.chart}>
              <ResponsiveLine theme={nivoTheme()} data={accLines} margin={{ top: 10, right: 16, bottom: 40, left: 56 }}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={(s: any) => s.id === 'Orçado' ? '#9aa0aa' : '#3b5bdb'}
                pointSize={6} pointBorderWidth={1} useMesh curve="monotoneX"
                axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }}
                layers={['grid', 'markers', 'axes', AccLinhas, 'points', 'slices', 'mesh', 'legends']}
                legends={[{ anchor: 'top-left', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Cascata — {escopoNome} (realizado, por filha)</div>
            <div style={S.chart}>
              <ResponsiveBar theme={nivoTheme()} data={cascata} keys={['base', 'neg', 'pos', 'total']} indexBy="step"
                margin={{ top: 10, right: 10, bottom: 50, left: 56 }} padding={0.3}
                colors={(b: any) => b.id === 'base' ? 'transparent' : b.id === 'total' ? '#3b5bdb' : b.id === 'pos' ? '#2f9e44' : '#e03131'}
                axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} axisBottom={{ tickRotation: -30 }}
                enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate />
            </div>
          </div>

          <div style={S.grid2}>
            {/* ⚠⚠ MARGEM, NÃO TAMANHO (22/nov). Aqui ficava "{escopo} por
                empresa", somando as folhas de cada uma — e no "Relatório
                inteiro" isso não é número de lugar nenhum da DRE (mesmo
                defeito do gráfico mensal). Pior: ao lado do EBITDA em valor,
                ele repetia a mesma leitura — as duas barras maiores eram a
                mesma empresa, pelo mesmo motivo. O % EBITDA responde o que o
                valor não responde: BAURU é a maior, mas é a mais eficiente?
                ⚠ Cai no gráfico antigo quando o relatório não tem linha de %
                EBITDA (o Balanço, por exemplo) — melhor a leitura imperfeita
                que um card vazio. */}
            {ebitdaPctEmp.length ? (
              <div style={S.card}>
                <div style={S.cardT}>% EBITDA por empresa <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(margem — orçado × realizado)</span></div>
                <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, ebitdaPctEmp.length * 30 + 50) }}>
                  <ResponsiveBar theme={nivoTheme()} data={ebitdaPctEmp} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                    colors={['#9aa0aa', '#3b5bdb']}
                    axisBottom={{ format: (v: any) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` }}
                    enableLabel={false} valueFormat={(v: any) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} animate
                    tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} pct />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              </div>
            ) : (
            <div style={S.card}>
              <div style={S.cardT}>{escopoNome} por empresa</div>
              <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, porEmpresa.length * 30 + 50) }}>
                <ResponsiveBar theme={nivoTheme()} data={porEmpresa} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                  margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                  colors={['#9aa0aa', '#3b5bdb']} axisBottom={{ format: (v: any) => fmtEixo(Number(v)) }}
                  enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} desp={escopoDesp} />}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            )}
            <div style={S.card}>
              <div style={S.cardT}>EBITDA por empresa</div>
              {ebitdaEmp.length ? (
                <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, ebitdaEmp.length * 30 + 50) }}>
                  <ResponsiveBar theme={nivoTheme()} data={ebitdaEmp} keys={['Orçado', 'Realizado']} indexBy="empresa" layout="horizontal" groupMode="grouped"
                    margin={{ top: 6, right: 24, bottom: 30, left: 150 }} padding={0.25} innerPadding={2}
                    colors={['#ffd8a8', '#e8590c']} axisBottom={{ format: (v: any) => fmtEixo(Number(v)) }}
                    enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                    tooltip={({ indexValue, data }: any) => <TipOR titulo={String(indexValue)} data={data} />}
                    legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 80, itemHeight: 16, symbolSize: 12 }]} />
                </div>
              ) : <div style={{ padding: '40px 12px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Nenhuma linha "EBITDA" encontrada neste relatório.</div>}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Maiores desvios (Realizado − Orçado) — {escopoNome}</div>
            <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: Math.max(220, desvios.length * 26 + 50) }}>
              <ResponsiveBar theme={nivoTheme()} data={desvios} keys={['Δ']} indexBy="conta" layout="horizontal"
                margin={{ top: 6, right: 24, bottom: 24, left: 200 }} padding={0.3}
                colors={(b: any) => (b.value >= 0 ? '#2f9e44' : '#e03131')} enableGridX
                axisBottom={{ format: (v: any) => fmtEixo(Number(v)) }} valueFormat={(v: any) => fmt(Number(v))}
                labelSkipWidth={9999} animate onClick={(d: any) => d.data.nodeId && qparams && setDrill({ nodeId: d.data.nodeId })} />
            </div>
          </div>

          {/* ── Por Área / Centro de Custo (cruza CC × natureza da linha) ── */}
          <div style={S.grid2}>
          <div style={S.card}>
            <div style={S.cardT}>Evolução Receitas × Despesas <span style={S.cardSub}>(realizado)</span></div>
            <div style={S.chart}>
              <ResponsiveLine theme={nivoTheme()} data={recDespLinhas} margin={MARG_LEG}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={(s: any) => s.id === 'Receitas' ? '#2f9e44' : '#e03131'} pointSize={6} pointBorderWidth={1} useMesh curve="monotoneX"
                axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }}
                legends={[{ ...LEG_BAIXO, itemWidth: 88 }]} />
            </div>
          </div>
          <div style={S.card}>
            <div style={S.cardT}>Receitas por área <span style={S.cardSub}>
              (mês a mês · Comercial e Serviços · cheia = realizado · tracejada = orçado · clique p/ razão){recAreaLinVis.ocultadas > 0 && ` · ${recAreaLinVis.ocultadas / 2} não detalhada(s)`}
            </span></div>
            <div style={S.chart}>
              <ResponsiveLine theme={nivoTheme()} data={recAreaLinVis.linhas} margin={MARG_LEG}
                xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                colors={(s: any) => s.color} pointSize={5} pointBorderWidth={1} useMesh curve="monotoneX"
                onClick={(p: any) => drillAreaMes(String(p.serieId), String(p.data?.x))}
                axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }}
                layers={['grid', 'markers', 'axes', AccLinhas, 'points', 'slices', 'mesh', 'legends']}
                legends={[{ ...LEG_BAIXO, data: legArea(recAreaLinVis.linhas) }]} />
            </div>
          </div>
          </div>

          {/* ⚠ DESPESA EXISTE EM TODA ÁREA — um gráfico só fica ilegível. Os
              grupos são cadastro desta instalação (GRUPOS_DESPESA, no topo).
              Mesma gramática da receita: cheia = realizado, tracejada = orçado,
              clique no ponto abre o razão daquela área naquele mês. */}
          {despGruposVis.length > 0 && (
            <div style={S.grid3}>
              {despGruposVis.map(g => (
                <div key={g.titulo} style={S.card}>
                  <div style={S.cardT}>Despesas · {g.titulo} <span style={S.cardSub}>
                    (ACUMULADO no período · cheia = realizado · tracejada = orçado · clique p/ razão){g.ocultadas > 0 && ` · ${g.ocultadas / 2} não detalhada(s)`}
                  </span></div>
                  <div style={S.chart}>
                    <ResponsiveLine theme={nivoTheme()} data={g.linhas} margin={MARG_LEG}
                      xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 'auto', max: 'auto' }} yFormat={(v: any) => fmt(Number(v))}
                      colors={(se: any) => se.color} pointSize={5} pointBorderWidth={1} useMesh curve="monotoneX"
                      onClick={(pt: any) => drillAreaMes(String(pt.serieId), String(pt.data?.x), true)}
                      axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }}
                      layers={['grid', 'markers', 'axes', AccLinhas, 'points', 'slices', 'mesh', 'legends']}
                      legends={[{ ...LEG_BAIXO, data: legArea(g.linhas) }]} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={S.grid2}>
            <div style={S.card}>
              <div style={S.cardT}>Receitas por área <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · clique p/ detalhar){recAreaVis.ocultadas > 0 && ` · ${recAreaVis.ocultadas} não detalhada(s)`}</span></div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={recAreaVis.linhas} keys={['Orçado', 'Realizado', 'Δ']} indexBy="area" groupMode="grouped"
                  onClick={(d: any) => { const ids = areaToCcs[String(d.indexValue)] || []; if (podeDrill(ids)) drillPorCcs(ids) }}
                  margin={{ top: 18, right: 10, bottom: 60, left: 56 }} padding={0.3} innerPadding={2}
                  colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={3}
                  axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} axisBottom={{ tickRotation: -20 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, false)}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
            <div style={S.card}>
              <div style={S.cardT}>Despesas por área <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · clique p/ detalhar){despAreaVis.ocultadas > 0 && ` · ${despAreaVis.ocultadas} não detalhada(s)`}</span></div>
              <div style={S.chart}>
                <ResponsiveBar theme={nivoTheme()} data={despAreaVis.linhas} keys={['Orçado', 'Realizado', 'Δ']} indexBy="area" groupMode="grouped"
                  onClick={(d: any) => { const ids = areaToCcs[String(d.indexValue)] || []; if (podeDrill(ids)) drillPorCcs(ids) }}
                  margin={{ top: 18, right: 10, bottom: 60, left: 56 }} padding={0.3} innerPadding={2}
                  colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={3}
                  axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} axisBottom={{ tickRotation: -20 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                  tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, true)}
                  legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Despesas por centro de custo (nível 2 — área/divisão) <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · acumulado · clique p/ detalhar){despCcVis.ocultadas > 0 && ` · ${despCcVis.ocultadas} não detalhado(s)`}</span></div>
            <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: 340 }}>
              <ResponsiveBar theme={nivoTheme()} data={despCcVis.linhas} keys={['Orçado', 'Realizado', 'Δ']} indexBy="cc" groupMode="grouped"
                onClick={(d: any) => { const ids = (d.data?._ccs || []) as string[]; if (ids.length && podeDrill(ids)) drillPorCcs(ids) }}
                margin={{ top: 18, right: 10, bottom: 110, left: 56 }} padding={0.3} innerPadding={1}
                colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={2}
                axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} axisBottom={{ tickRotation: -45 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, true)}
                legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardT}>Receitas por centro de custo (nível 2 — área/divisão) <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(Orçado × Realizado · Δ · bruta · clique p/ detalhar){recCcVis.ocultadas > 0 && ` · ${recCcVis.ocultadas} não detalhado(s)`}</span></div>
            <div style={{ background: 'var(--chart-bg)', borderRadius: 10, padding: 8, height: 340 }}>
              <ResponsiveBar theme={nivoTheme()} data={recCcVis.linhas} keys={['Orçado', 'Realizado', 'Δ']} indexBy="cc" groupMode="grouped"
                onClick={(d: any) => { const ids = (d.data?._ccs || []) as string[]; if (ids.length && podeDrill(ids)) drillPorCcs(ids) }}
                margin={{ top: 18, right: 10, bottom: 110, left: 56 }} padding={0.3} innerPadding={1}
                colors={(b: any) => b.id === 'Orçado' ? '#9aa0aa' : b.id === 'Realizado' ? '#3b5bdb' : '#1098ad'} borderRadius={2}
                axisLeft={{ format: (v: any) => fmtEixo(Number(v)) }} axisBottom={{ tickRotation: -45 }} enableLabel={false} valueFormat={(v: any) => fmt(Number(v))} animate
                tooltip={({ indexValue, data }: any) => barTip(String(indexValue), data, false)}
                legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -2, itemWidth: 76, itemHeight: 16, symbolSize: 12 }]} />
            </div>
          </div>
        </>
      )}

      {drill && qparams && (
        <DrillModal relId={relId} versaoId={versaoId} empIds={qparams.empIds} anos={qparams.anos} meses={drill.meses || qparams.meses} restritos={restritos}
          filFilter={qparams.filFilter} ccFilter={drill.ccFilter !== undefined ? drill.ccFilter : qparams.ccFilter} startNodeId={drill.nodeId} slot={moedaSlot} onClose={() => setDrill(null)} />
      )}
    </div>
  )
}
