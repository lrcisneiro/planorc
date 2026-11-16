import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { carregarVersoes } from '../../lib/escopoDados'
import { PostosPills, usePassoLabel } from './PostosPills'
import { useTenantFlags } from '../../lib/tenantFlags'
import { nomeCurto } from '../../lib/nomePessoa'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { calcularPosto, regimeAplica, paisAplica, verbasDoRegime, CATEGORIAS } from '../../lib/motorFolha'
import type { VerbaRegra, ResultadoPosto } from '../../lib/motorFolha'
import { ClipboardCheck, Upload, Trash2, AlertCircle, CheckCircle2, Play, ChevronDown, ChevronRight, X, Search, Plus, Pencil, Undo2 } from 'lucide-react'
import { RateioModal } from './RateioModal'
import { cascataRateio } from '../../lib/rateioFolha'
import { usePostoCtx } from '../../lib/postoCtx'
import { useLocalPref } from '../../lib/uiPrefs'
import { pageAll } from '../../lib/pageAll'
import { slugCargo as slug } from '../../lib/slugCargo'
import { pessoaChave } from '../../lib/pessoaChave'
import { situacaoPosto, SeletorSituacao, type Situacao } from '../../lib/situacaoPosto'
import { resolvePosto, camposAlterados, overlayVazio, CAMPOS_CENARIO } from '../../lib/postoVersao'
import CenarioDiffModal from './CenarioDiffModal'
import type { PostoVersao, CampoCenario } from '../../lib/postoVersao'
import { taxaOrcada, materializa } from '../../lib/cambio'

// Grade de Postos (P1 step 3) — orçamento de folha por posto, agrupado por CC.
// Custo c/ encargos, rateio, sindicato e "Aplicar" vêm dos steps 4-5 (placeholder por ora).

declare const XLSX: any
type Row = Record<string, string>
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function parseCsv(text: string): Row[] {
  text = text.replace(/^﻿/, '')
  const linhas = text.split(/\r?\n/).filter(l => l.trim().length)
  if (!linhas.length) return []
  const pl = (l: string): string[] => {
    const out: string[] = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) { const c = l[i]
      if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
      else if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c }
    out.push(cur); return out
  }
  const hdr = pl(linhas[0]).map(h => h.trim())
  return linhas.slice(1).map(l => { const f = pl(l); const o: Row = {}; hdr.forEach((h, i) => o[h] = (f[i] ?? '').trim()); return o })
}
function parseXlsxRows(file: File): Promise<Row[]> {
  return new Promise((res, rej) => { const r = new FileReader()
    r.onload = e => { try { const wb = XLSX.read(e.target?.result, { type: 'binary' }); res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Row[]) } catch (err) { rej(err) } }
    r.readAsBinaryString(file) })
}
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inpNum = (v: any) => String(v ?? '').replace('.', ',')   // p/ inputs: vírgula decimal, sem separador de milhar
// Dinheiro em campo EDITÁVEL: com separador de milhar, porque "33294,97" se lê
// contando dígito por dígito e "33.294,97" não. Só para valor monetário — o FTE
// usa `inpNum`, que não leva separador nenhum (1,00 não precisa).
const inp2 = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ⚠⚠ O SEPARADOR DE MILHAR NA MÁSCARA CRIA UM CASO QUE NÃO EXISTIA: o usuário
// apaga os centavos e deixa "33.294". Sem vírgula, a regra antiga mandava no
// `parseFloat`, que lê o ponto como DECIMAL e devolve 33,294 — mil vezes menos,
// gravado sem erro nenhum. É a mesma família do salário 100× de nov/26, só que
// na direção oposta.
// Então a leitura é por FORMA, não por "tem vírgula ou não":
//   "3.908,71" e "3908,71" → vírgula manda, ponto é milhar
//   "33.294" e "1.234.567" → grupos de 3 dígitos, ponto é milhar
//   "3908.71" e "6000.5"   → ponto é decimal (é o que o arquivo do ERP manda)
// O caso ambíguo "1.500" resolve como 1500, que é o que alguém digitando num
// campo com máscara pt-BR quis dizer.
const MILHAR = /^-?\d{1,3}(\.\d{3})+$/
const parseNum = (s: string): number => {
  const r = (s || '').trim()
  if (r.includes(',')) return parseFloat(r.replace(/\./g, '').replace(',', '.'))
  if (MILHAR.test(r)) return parseFloat(r.replace(/\./g, ''))
  return parseFloat(r)
}
const milAno = (v: number) => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${money(v)}`
const REGIMES = ['BR-CLT', 'BR-ESTAGIO', 'BR-PRESTADOR', 'BR-PROLABORE', 'PY-IPS', 'PY-CONTRATO']
// sindicato por empresa (regra Ricardo): 06→MS, 08/YY/ZZ→PR, demais→SP. O import atribui (persiste no reimport).
const sindCodPorEmp = (empCod: string) => empCod === '06' ? 'SINDPDMS' : ['08', 'YY', 'ZZ'].includes(empCod) ? 'SINDPDPR' : 'SINDPDSP'
// nome curto do ocupante: ver lib/nomePessoa.ts

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  top:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 720, lineHeight: 1.5 },
  bar:   { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '20px 0 16px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  btnPri:{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiH:  { fontSize: 11.5, color: 'var(--muted)' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '9px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  gh:    { padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' },
  td:    { padding: '7px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap' },
  inp:   { padding: '3px 6px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)', width: 80, textAlign: 'right', boxSizing: 'border-box' },
  selCel:{ padding: '3px 6px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' },
  del:   { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-strong)', padding: 3 },
  info:  { display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.30)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-mid)', fontSize: 12.5, margin: '0 0 14px', lineHeight: 1.5 },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 14px' },
  empty: { padding: '44px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  overlay:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 },
  modal:  { background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 'min(680px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' },
  mth:    { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)' },
  mtd:    { padding: '5px 8px', fontSize: 12.5, borderBottom: '1px solid var(--panel-2)', color: 'var(--text)' },
  finp:   { padding: '7px 9px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' },
  flbl:   { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 },
  btnPri2:{ padding: '8px 16px', fontSize: 13, background: 'var(--violet)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
}
const MESES_NUM = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const catCor: Record<string, string> = { 'Rescisão': 'var(--red)', 'Salário': 'var(--green)', Encargos: 'var(--orange)', 'Provisões': 'var(--blue)', 'Benefícios': 'var(--violet)' }
const tag = (bg: string, cor: string, brd: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: bg, color: cor, border: `1px solid ${brd}` })
const T = {
  // ⚠ Um ponto maior que as outras etiquetas, de propósito: a PESSOA é o assunto
  // da linha. Quem lê a grade procura "quanto custa o Fulano", não "quanto custa
  // o ESPECIALISTA DE DESENVOLVIMENTO" — e com todas as etiquetas do mesmo
  // tamanho o nome se perdia entre modelo, rateio e sindicato.
  ocup: { ...tag('rgba(52,211,153,0.12)', 'var(--green)', 'rgba(52,211,153,0.35)'), fontSize: 12 },
  vaga: { ...tag('rgba(251,191,36,0.12)', 'var(--orange)', 'rgba(251,191,36,0.4)'), fontSize: 12 },
  rateio: tag('rgba(34,211,238,0.12)', 'var(--blue)', 'rgba(34,211,238,0.4)'),
  sind: tag('var(--panel-2)', 'var(--muted)', 'var(--border)'),
}
const tagRegime = (r: string | null): CSSProperties =>
  r === 'BR-CLT' ? tag('rgba(59,130,246,0.12)', 'var(--blue)', 'rgba(59,130,246,0.4)')
  : r === 'BR-PRESTADOR' ? tag('rgba(251,146,60,0.12)', 'var(--orange)', 'rgba(251,146,60,0.4)')
  : r === 'BR-PROLABORE' ? tag('rgba(139,92,246,0.12)', 'var(--violet)', 'rgba(139,92,246,0.4)')
  : r === 'PY-IPS' ? tag('rgba(52,211,153,0.12)', 'var(--green)', 'rgba(52,211,153,0.4)')
  : r === 'PY-CONTRATO' ? tag('rgba(34,211,238,0.12)', 'var(--cyan)', 'rgba(34,211,238,0.4)')
  : r === 'BR-ESTAGIO' ? tag('rgba(52,211,153,0.12)', 'var(--green)', 'rgba(52,211,153,0.4)')
  : T.sind
const REGIMES_LABEL: Record<string, string> = { 'BR-CLT': 'BR · CLT', 'BR-ESTAGIO': 'BR · Estágio', 'BR-PRESTADOR': 'BR · Prestador', 'BR-PROLABORE': 'BR · Pró-labore', 'PY-IPS': 'PY · IPS', 'PY-CONTRATO': 'PY · Contrato' }

type Posto = {
  id: string; codigo: string; nome: string | null; matricula: string | null; regime: string | null; ativo?: boolean
  salario_base: number; fte: number; ini_ano: number | null; ini_mes: number | null; fim_ano: number | null; fim_mes: number | null
  reajuste_mes: number | null; reajuste_pct: number | null; reajuste_valor: number | null   // v3_116
  afast_ini_ano: number | null; afast_ini_mes: number | null                                 // v3_117
  afast_fim_ano: number | null; afast_fim_mes: number | null; afast_motivo: string | null
  admissao: string | null                                                                    // v3_118 (rescisão)
  empresa_id: string; filial_id: string | null; cc_id: string | null; cargo_id: string | null; sindicato_id: string | null
  recurso_cod?: string | null                  // SRA.RA_X_RECUR — liga ao apontamento
  recebe_hora?: boolean | null                 // exceção sobre a função; null = segue a função
  cargo?: { nome: string } | null; empresa?: { codigo: string } | null; filial?: { codigo: string } | null
  centro_custo?: { codigo: string; descricao: string } | null; sindicato?: { codigo: string } | null
}

export default function PostosGradePage() {
  const acesso = useUserAccess()
  const cap = useCapacidades()
  // ⚠ Salário mascarado chega como NULO, e `Number(null) || 0` vira ZERO — a
  // tela diria "ganha R$ 0" para quem não pode ver. Num papel de CONFERÊNCIA
  // isso é pior que a ausência: a pessoa compara contra o ERP e reporta uma
  // divergência que não existe. Número errado > número ausente, sempre.
  const semFolha = !cap.can('posto.salario')
  const oculto = <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}
                       title="Você não tem permissão para ver salário e custo dos postos">sem permissão</span>
  const passoLabel = usePassoLabel()
  const flags = useTenantFlags()
  // a coluna "recebe por hora" só existe onde se aponta hora em projeto
  const nCols = flags.usa_apontamento ? 13 : 12   // -1: FTE saiu da lista (nov/2026)
  // Editar depende de QUAL lado se está olhando. O cadastro vem do ERP e é
  // regravado pela próxima importação do RH, então mexer nele é privilégio
  // separado; decidir no cenário é o trabalho normal de quem planeja a área.
  // ⚠ `orcar` continua sendo o piso: sem ele não se edita nada dos dois lados.
  const podeCadastro = cap.can('orcar') && cap.can('posto.cadastro.editar')
  const podeCenario  = cap.can('orcar') && cap.can('posto.cenario.decidir')
  // Separadas de `editavel` de propósito: mexer no quadro da sua área é uma
  // coisa; gravar no orçado do grupo e recarregar a base do RH são outras duas.
  // O Aplicar SUBSTITUI todo o orçado de origem POSTO da versão — não é edição,
  // é publicação.
  const podeAplicar  = cap.can('posto.aplicar')
  const podeImportar = cap.can('posto.importar')

  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [cargos, setCargos] = useState<any[]>([])
  const [areasFunc, setAreasFunc] = useState<any[]>([])
  const [postos, setPostos] = useState<Posto[]>([])
  const [empresaSel, setEmpresaSel] = usePostoCtx('empresaSel', [])
  const [filialSel, setFilialSel] = usePostoCtx('filialSel', [])
  const [ccSel, setCcSel] = usePostoCtx('ccSel', [])
  const [areaSel, setAreaSel] = usePostoCtx('areaSel', [])
  const [divisaoSel, setDivisaoSel] = usePostoCtx('divisaoSel', [])
  const [buSel, setBuSel] = usePostoCtx('buSel', [])
  const [modo, setModo] = useState<'upsert' | 'substituir'>('upsert')
  // 'nenhum' existe para ordenar a EMPRESA INTEIRA por custo. Com agrupamento
  // a ordenação acontece dentro de cada grupo, então "os dez mais caros da
  // empresa" era uma pergunta que a tela não respondia.
  const [agruparPor, setAgruparPor] = useLocalPref<'cc' | 'cargo' | 'nenhum'>('planorc_postos_grade_agrupar', 'cc')
  // Ordenação DENTRO do grupo — o agrupamento continua mandando. `null` volta à
  // ordem natural (código do posto), que é a terceira parada do ciclo: sem ela,
  // quem ordena por salário não tem como desfazer.
  const [ordem, setOrdem] = useLocalPref<{ col: string | null; dir: 'asc' | 'desc' }>(
    'planorc_postos_grade_ordem', { col: null, dir: 'asc' })
  const [regimeSel, setRegimeSel] = useState('')
  const [busca, setBusca] = useState('')
  // CENÁRIO (v3_120). O quadro mestre é a realidade; a sobreposição por versão
  // guarda as DECISÕES. O modo é explícito de propósito: sem ele, corrigir um
  // salário errado viraria "decisão do cenário" sem ninguém perceber.
  const [modoCenario, setModoCenario] = useState(false)
  const [overlays, setOverlays] = useState<Map<string, PostoVersao>>(new Map())
  const [verDiff, setVerDiff] = useState(false)   // comparativo cadastro × cenário, para aprovação
  const [soAlteradas, setSoAlteradas] = useState(false)
  // ⚠ Lembrado por usuário e DESLIGADO por padrão: quem abre a tela pela
  // primeira vez tem de ver o quadro inteiro. Esconder por padrão faria o
  // número do topo discordar da lista sem ninguém ter pedido nada.
  const [semSal, setSemSal] = useLocalPref<boolean>('planorc_postos_ocultar_sem_salario', false)
  const [cenForm, setCenForm] = useState<{ posto: Posto; ov: PostoVersao | null } | null>(null)
  // Quatro estados em vez de "demitido sim/não": o toggle antigo deixava
  // afastado e em férias contando como ativo no headcount, no FTE e no custo.
  // ⚠ O PADRÃO É TUDO MENOS DEMITIDO. Só `['ativo']` escondia quem está de
  // FÉRIAS e AFASTADO — e os dois CONTINUAM CUSTANDO: o afastado mantém as
  // verbas marcadas como devidas, e férias a empresa paga (a provisão 1/12 do
  // motor cobre). Quem abria a tela via um quadro menor que o real e não tinha
  // como saber por quê — foi assim que um gerente não achou um posto que lhe
  // tinham liberado (16/nov).
  // ⚠ A CHAVE MUDOU DE NOME de propósito. `useLocalPref` só usa o padrão quando
  // não há valor salvo, e quem já abriu a tela tem `['ativo']` gravado — trocar
  // só o padrão não alcançaria ninguém que já usou. Com a chave nova todos
  // recebem o padrão novo uma vez; quem tinha um recorte próprio o refaz, e
  // dali em diante ele é lembrado como antes.
  const [sits, setSits] = useLocalPref<Situacao[]>('planorc_postos_situacoes_v2', ['ativo', 'afastado', 'ferias'])
  const [erro, setErro] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<{ gravados: number; apagados: number; modo: string; semEmp: string[]; semFil: string[]; semCc: string[]; foraEscopo: number; cargosNovos: number; cargoDesativado: number; beneficios: number; benefColunas: number; rateioPostos: number; rateioCol: boolean; rateioNaoAchados: string[]; afastados: number; cargoAmbiguo: number; semSalario: number; salarioFora: number; areasNaoAchadas: string[]; codsNaoAchados: string[]; comAreaFunc: number; demitidos: number } | null>(null)
  const [importando, setImportando] = useState(false)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  // motor de custo
  const [versoes, setVersoes] = useState<any[]>([])
  const [versaoSel, setVersaoSel] = usePostoCtx('versaoId', '')
  // Escopo de DADOS sobre a versão — pergunta diferente da capacidade. A
  // capacidade diz se a pessoa pode aplicar; isto diz em QUAL orçamento ela
  // mexe. Cadastrado em Configurações → acesso, dimensão "Versão do orçamento".
  // `carregarVersoes` já devolve a lista recortada — este alias existe só para
  // deixar explícito, onde o dropdown é montado, que ela NÃO é a lista crua.
  const versoesVisiveis = versoes
  // As regras de acesso chegam DEPOIS dos catálogos — enquanto carregam, o
  // hook responde "pode tudo" (ausência de regra = sem restrição). Sem esta
  // recondução a tela escolheria o default antes de saber o escopo e ficaria
  // parada numa versão proibida, que é o pior jeito de falhar: silencioso.
  useEffect(() => {
    if (acesso.loading || !versoes.length) return
    if (!versoesVisiveis.length) { if (versaoSel) setVersaoSel(''); return }
    if (!versoesVisiveis.some((v: any) => v.id === versaoSel)) setVersaoSel(versoesVisiveis[0].id)
  }, [acesso.loading, versoes.length, versaoSel])   // eslint-disable-line
  const [verbas, setVerbas] = useState<VerbaRegra[]>([])
  const [sindMesBase, setSindMesBase] = useState<Record<string, number>>({})
  const [sindByCod, setSindByCod] = useState<Record<string, string>>({})   // codigo → sindicato_id
  const [sindicatos, setSindicatos] = useState<any[]>([])
  const [dissidio, setDissidio] = useState<Record<string, number>>({})   // sindicato_id → pct (da versão)
  const [form, setForm] = useState<any | null>(null)   // modal novo/editar posto
  const [postoVerbas, setPostoVerbas] = useState<Record<string, Record<string, number>>>({})  // posto_id → { verba_id: valor }
  const [rateioCods, setRateioCods] = useState<any[]>([])   // catálogo de códigos de rateio
  const [destByRegra, setDestByRegra] = useState<Record<string, any[]>>({})   // regra_id → destinos
  const [postoRateios, setPostoRateios] = useState<Record<string, { regra_id: string; ordem: number }[]>>({})  // posto_id → códigos anexados
  const [rateModal, setRateModal] = useState<Posto | null>(null)
  const [drill, setDrill] = useState<Posto | null>(null)

  const loadLookups = async () => {
    const [e, f, c, cg, vs, vb, si, rr, rd, af] = await Promise.all([
      supabase.from('empresa').select('id,codigo,descricao,pais').eq('ativo', true).order('codigo'),
      supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
      supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
      pageAll(() => supabase.from('cargo').select('id,codigo,nome,sub_cod,ativo').order('nome')).then(data => ({ data })),
      carregarVersoes('id,codigo,ano,descricao,bloqueada,aprovado_em,aprovado_por,aprovacao_nota,origem_versao_id').then(data => ({ data })),
      supabase.from('verba_folha').select('id,codigo,descricao,tipo_calculo,parametro,calendario,verba_ref,conta_destino_id,incide_encargos,mantem_afastado,regime,pais,ordem,categoria').eq('ativo', true).order('ordem', { nullsFirst: false }),
      supabase.from('sindicato').select('id,codigo,mes_database'),
      supabase.from('rateio_regra').select('id,nome,dimensao').eq('ativo', true).order('nome'),
      supabase.from('rateio_destino').select('regra_id,empresa_id,cc_id,pct'),
      supabase.from('area_funcional').select('id,codigo,nome'),
    ])
    setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || []); setCargos(cg.data || [])
    setAreasFunc(af.data || [])
    setRateioCods(rr.data || [])
    const dbr: Record<string, any[]> = {}
    for (const d of rd.data || []) (dbr[d.regra_id] ||= []).push({ empresa_id: d.empresa_id, cc_id: d.cc_id, pct: Number(d.pct) || 0 })
    setDestByRegra(dbr)
    setVersoes(vs.data || []); setVerbas((vb.data || []) as VerbaRegra[])
    setSindMesBase(Object.fromEntries((si.data || []).map((s: any) => [s.id, s.mes_database || 1])))
    setSindByCod(Object.fromEntries((si.data || []).map((s: any) => [String(s.codigo), s.id])))
    setSindicatos(si.data || [])
    // O default tem de cair numa versão PERMITIDA, não na primeira que veio do
    // banco — senão a tela abre numa versão fora do escopo e o escopo não vale
    // nada. Mesma razão para reconduzir quando o id guardado em localStorage
    // (usePostoCtx) aponta para uma versão que esta pessoa não pode ver.
    const permitidas = vs.data || []   // já recortadas na origem
    if (permitidas.length) setVersaoSel(prev => permitidas.some((x: any) => x.id === prev) ? prev : permitidas[0].id)
    else setVersaoSel('')
  }
  useEffect(() => {
    if (!versaoSel) { setDissidio({}); return }
    supabase.from('premissa_dissidio').select('sindicato_id,pct').eq('versao_id', versaoSel)
      .then(r => setDissidio(Object.fromEntries((r.data || []).map((x: any) => [x.sindicato_id, Number(x.pct) || 0]))))
  }, [versaoSel])
  const loadPostos = async () => {
    // paginado: posto/posto_verba/posto_rateio escalam com o quadro (postos × verbas/
    // rateios) e passam de 1000 fácil — sem isto a grade cortaria overrides/rateios de
    // parte dos postos e calcularia o custo errado, sem avisar.
    let data: any[]
    try { data = await pageAll(() => supabase.from('posto_v').select('*, cargo(nome), empresa(codigo), filial(codigo), centro_custo(codigo,descricao), sindicato(codigo)').order('codigo')) }
    catch (e: any) { setErro(e?.message || String(e)); return }
    setPostos((data || []) as Posto[])
    const pv = await pageAll(() => supabase.from('posto_verba').select('posto_id,verba_id,valor').eq('ativo', true))
    const m: Record<string, Record<string, number>> = {}
    for (const r of pv || []) (m[r.posto_id] ||= {})[r.verba_id] = Number(r.valor) || 0
    setPostoVerbas(m)
    const pr = await pageAll(() => supabase.from('posto_rateio').select('posto_id,regra_id,ordem'))
    const rm: Record<string, { regra_id: string; ordem: number }[]> = {}
    for (const r of pr || []) (rm[r.posto_id] ||= []).push({ regra_id: r.regra_id, ordem: Number(r.ordem) || 1 })
    for (const k in rm) rm[k].sort((a, b) => a.ordem - b.ordem)
    setPostoRateios(rm)
  }
  useEffect(() => { loadLookups(); loadPostos() }, [])

  // sobreposição da versão selecionada (paginado: um por posto, 571 e subindo)
  const loadOverlays = async (versaoId: string) => {
    if (!versaoId) { setOverlays(new Map()); return }
    try {
      const rows = await pageAll(() => supabase.from('posto_versao').select('*').eq('versao_id', versaoId))
      setOverlays(new Map((rows || []).map((r: any) => [r.posto_id, r as PostoVersao])))
    } catch (e: any) { setErro('Cenário: ' + (e?.message || e)) }
  }
  useEffect(() => { loadOverlays(versaoSel) }, [versaoSel])   // eslint-disable-line

  const editavel = modoCenario ? podeCenario : podeCadastro
  const vAtual: any = versoes.find((v: any) => v.id === versaoSel)
  const aprovadoEm: string | null = vAtual?.aprovado_em ?? null
  const podeAprovar = cap.can('cenario.aprovar')
  // ⚠ Pelo ID, nunca pelo embed `p.cargo`: o embed vem do MESTRE e não enxerga
  // a promoção decidida no cenário (v3_164). Três pontos liam o embed —
  // a célula, o agrupamento e a ordenação — e os três mostrariam o cargo
  // antigo numa promoção, sem nada na tela denunciando.
  const nomeCargo = (id: string | null | undefined) =>
    (id && cargos.find((c: any) => c.id === id)?.nome) || ''

  // ⚠ O SELETOR SÓ OFERECE CARGO ATIVO — mas CONTINUA MOSTRANDO o inativo que
  // o posto já tem. A v3_181 desativou o catálogo anterior; a lista era
  // carregada sem olhar `ativo`, então os nomes abreviados do ERP voltavam a
  // aparecer como se fossem escolha válida. Filtrar sem a exceção seria pior:
  // o <select> perderia o valor atual e a primeira edição de um posto de
  // demitido trocaria o cargo dele em silêncio.
  const opcoesCargo = (atual?: string | null) =>
    cargos.filter((c: any) => c.ativo !== false || c.id === atual)
  const mestreById = useMemo(() => new Map(postos.map(p => [p.id, p])), [postos])
  // O quadro EFETIVO do cenário. Fora do modo cenário é o mestre, pela mesma
  // referência — nada muda para quem só cuida do cadastro.
  const postosEf = useMemo(() =>
    modoCenario ? postos.map(p => resolvePosto(p, overlays.get(p.id))) : postos,
    [postos, overlays, modoCenario])
  const alterados = useMemo(() => {
    const m = new Map<string, CampoCenario[]>()
    if (!modoCenario) return m
    for (const p of postos) {
      const c = camposAlterados(p, overlays.get(p.id))
      if (c.length) m.set(p.id, c)
    }
    return m
  }, [postos, overlays, modoCenario])

  const importar = async (rows: Row[]) => {
    setErro(null); setImportInfo(null)
    if (!rows.length) { setErro('Arquivo vazio.'); return }
    setImportando(true)
    try {
      const empByCod = new Map(empresas.map(e => [String(e.codigo).trim(), e.id]))
      const filByCod = new Map(filiais.map(f => [String(f.codigo).trim(), f.id]))
      const ccByCod = new Map(ccs.map(c => [String(c.codigo).trim(), c.id]))
      // ⚠ NOME DEIXOU DE IDENTIFICAR CARGO (v3_161). São quatro `ESPECIALISTA DE
      // DESENVOLVIMENTO DE SOFTWARE I`, um por subárea. Um `Map` por nome fica
      // com o ÚLTIMO e atribui subárea arbitrária, sem erro — a mesma classe de
      // falha do `ON CONFLICT` que já custou a v3_157.
      // A regra: nome ambíguo não é resolvido por adivinhação. Mantém-se o que
      // o posto JÁ tem (decisão de alguém, não minha) e o que sobra é contado.
      const porNome = new Map<string, string[]>()
      for (const c of cargos) {
        const k = String(c.nome).trim().toUpperCase()
        porNome.set(k, [...(porNome.get(k) || []), c.id])
      }
      // ⚠ Só cargo ATIVO entra no casamento por nome: um nome que só existe
      // desativado tem de criar/usar o novo, não ressuscitar o antigo.
      const cargosAtivos = cargos.filter((c: any) => c.ativo !== false)
      const porNomeAtivo = new Map<string, string[]>()
      for (const c of cargosAtivos) {
        const k = String(c.nome).trim().toUpperCase()
        porNomeAtivo.set(k, [...(porNomeAtivo.get(k) || []), c.id])
      }
      let cargoByNome = new Map([...porNomeAtivo].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]))
      const ambiguos = new Set([...porNomeAtivo].filter(([, v]) => v.length > 1).map(([k]) => k))
      const cargoAtual = new Map(postos.map((p: any) => [String(p.codigo), p.cargo_id]))
      const idsPorNome = porNome
      let cargoAmbiguo = 0
      // Quem traz código não gera cargo novo: o código já aponta para um que
      // existe, e criar outro pelo nome duplicaria o catálogo.
      const nomesNovos = [...new Set(rows.filter(r => !((r as any).cargo_codigo || '').trim())
        .map(r => (r.cargo || '').trim())
        .filter(n => n && !cargoByNome.has(n.toUpperCase()) && !ambiguos.has(n.toUpperCase())))]
      // Nome que SÓ existe desativado: o casamento acima o ignora de propósito.
      // Guardado para não virar `cargo_id = null` lá embaixo — apagar o cargo
      // de 235 postos seria perder informação para "arrumar" o catálogo.
      const soInativos = new Set([...porNome.keys()].filter(k => !porNomeAtivo.has(k)))
      let cargoDesativado = 0
      let cargosCriados = 0
      if (nomesNovos.length) {
        const novos = nomesNovos.map(nome => ({ tenant_id: TENANT_ID, codigo: slug(nome), nome, ativo: true }))
        // ⚠ `.select` para saber o que foi CRIADO: com `ignoreDuplicates` o
        // conflito não é erro, e contar `nomesNovos` reportava a INTENÇÃO. Na
        // carga de nov/26 a tela disse "50 cargos criados" e **um** foi criado
        // — os outros 49 bateram no `codigo` de cargos desativados, porque o
        // slug do nome é o mesmo. Mesma família do `ON CONFLICT` da v3_157.
        const { data: inseridos, error } = await supabase.from('cargo')
          .upsert(novos, { onConflict: 'tenant_id,codigo', ignoreDuplicates: true }).select('id')
        if (error) { setErro('Erro criando cargos: ' + error.message); return }
        cargosCriados = (inseridos || []).length
        const { data } = await supabase.from('cargo').select('id,nome,ativo')
        // ⚠ O mapa se reconstrói SÓ COM ATIVO, como o de cima. Antes relia a
        // tabela inteira e o filtro de 20 linhas acima era desfeito em silêncio:
        // o nome voltava a casar com o cargo desativado e 236 postos foram parar
        // no catálogo que tinha acabado de ser aposentado.
        const pn = new Map<string, string[]>()
        for (const c of (data || []) as any[]) {
          if (c.ativo === false) continue
          const k = String(c.nome).trim().toUpperCase()
          pn.set(k, [...(pn.get(k) || []), c.id])
        }
        cargoByNome = new Map([...pn].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]))
        for (const [k, v] of pn) if (v.length > 1) ambiguos.add(k)
        for (const k of pn.keys()) soInativos.delete(k)
        setCargos(data || [])
      }
      const semEmp = new Set<string>(), semFil = new Set<string>(), semCc = new Set<string>()
      const foraEscopo = new Set<string>()   // linhas fora do que o usuário pode orçar (empresa/filial/CC)
      // A coluna `recebe_hora` entra no upsert TUDO ou NADA. Incluí-la só em
      // algumas linhas deixaria o resultado por conta de como o PostgREST une as
      // chaves do lote — e o efeito seria apagar em silêncio a marcação de quem
      // o export não classificou. Com o arquivo trazendo a categoria, o cadastro
      // da folha manda em todo mundo; sem ela, a coluna nem é tocada.
      const temCatFunc = rows.some(r => (r.recebe_hora || '').trim())
      // Mesma regra para o afastamento: sem a coluna no arquivo, o import não
      // toca na janela — senão uma carga de um export antigo apagaria o retorno
      // que alguém já previu na grade.
      const temAfast = rows.some(r => 'afastado_desde' in r)
      // ⚠ Mesma regra das outras colunas opcionais: presente no arquivo → grava;
      // ausente → NÃO TOCA. A área funcional é atribuída à mão no Organograma,
      // e uma carga mensal que não fala dela não pode apagá-la (foi o que o
      // "substituir escopo" fez com 350 postos em 05/nov).
      const temAreaFunc = rows.some(r => 'area_funcional' in r)
      // ⚠ A SITUAÇÃO NUNCA FOI GRAVADA PELA IMPORTAÇÃO. A v3_152 carimbou
      // `sit_folha` uma vez por SQL e o import nunca a manteve — então quando
      // os postos foram recriados em 05/nov ela ficou NULA nos 570, e os 243
      // demitidos passaram a contar como ativos no headcount, no FTE e no
      // custo. `RA_SITFOLH` é uma letra: D demitido, A afastado, F férias,
      // vazio trabalhando.
      const temSit = rows.some(r => 'situacao' in r)
      let nDemitidos = 0
      const areaByCod = new Map(areasFunc.map(a => [String(a.codigo).trim(), a.id]))
      const areasNaoAchadas = new Set<string>()
      // ⚠ `cargo_codigo` RESOLVE A AMBIGUIDADE QUE O NOME NÃO RESOLVE. O mesmo
      // nome existe em até quatro subáreas; quem sabe qual é a subárea da
      // pessoa é o arquivo do RH, e o script a traduz em código antes de
      // chegar aqui. Com código, 106 postos deixam de ficar sem cargo.
      const cargoByCod = new Map(cargos.map((c: any) => [String(c.codigo).trim(), c.id]))
      const codsNaoAchados = new Set<string>()
      let nAfast = 0
      const payload: any[] = []
      for (const r of rows) {
        if (!r.posto_codigo) continue
        const empresa_id = empByCod.get((r.empresa || '').trim())
        if (!empresa_id) { if (r.empresa) semEmp.add(r.empresa); continue }
        const filial_id = filByCod.get((r.filial || '').trim()) || null; if (!filial_id && r.filial) semFil.add(r.filial)
        const cc_id = ccByCod.get((r.cc || '').trim()) || null; if (!cc_id && r.cc) semCc.add(r.cc)
        // escopo de EDIÇÃO: não importa nada fora do que o usuário pode orçar (admin passa tudo)
        if (!acesso.canEditPessoas('empresa', empresa_id) || (filial_id && !acesso.canEditPessoas('filial', filial_id)) || (cc_id && !acesso.canEditPessoas('centro_custo', cc_id))) {
          foraEscopo.add(r.posto_codigo); continue
        }
        const nomeCargo = (r.cargo || '').trim().toUpperCase()
        const codCargo = ((r as any).cargo_codigo || '').trim()
        let cargo_id = (codCargo ? cargoByCod.get(codCargo) : null) || null
        if (codCargo && !cargo_id) codsNaoAchados.add(codCargo)
        if (!cargo_id) cargo_id = cargoByNome.get(nomeCargo) || null
        if (!cargo_id && ambiguos.has(nomeCargo)) {
          // Preserva a escolha já feita; só conta quem fica sem.
          const jaTem = cargoAtual.get(r.posto_codigo)
          if (jaTem && (idsPorNome.get(nomeCargo) || []).includes(jaTem)) cargo_id = jaTem
          else cargoAmbiguo++
        }
        if (!cargo_id && soInativos.has(nomeCargo)) {
          // O arquivo ainda fala a língua do catálogo antigo. Mantém o cargo que
          // o posto já tem e CONTA: é o que diz quanto do quadro continua preso
          // ao catálogo aposentado, que some quando o ERP mandar o código.
          cargo_id = cargoAtual.get(r.posto_codigo) || null
          cargoDesativado++
        }
        const [ay, am] = (r.admissao || '').split('-')
        payload.push({ tenant_id: TENANT_ID, codigo: r.posto_codigo, empresa_id, filial_id, cc_id, cargo_id,
          sindicato_id: sindByCod[sindCodPorEmp((r.empresa || '').trim())] || null,
          regime: (() => { const s = (r.regime || '').trim(); return s ? (s.includes('-') ? s : 'BR-' + s) : null })(),
          // ⚠ SALÁRIO VAZIO NÃO É ZERO. Antes era `r.salario ? parseFloat(...) : 0`, e como
          // o `Funcionarios.csv` do RH NÃO TRAZ salário, uma importação de rotina zeraria
          // os 339 postos que tinham valor (R$ 3,5 mi) — sem erro e sem aviso. O valor fica
          // num campo auxiliar e só entra no upsert de quem realmente tem; `salario_base` é
          // NOT NULL DEFAULT 0, então omiti-lo preserva no UPDATE e dá zero no INSERT.
          // Mesma família do `Number(null) || 0` que já mordeu na grade.
          // ⚠ PONTO É DECIMAL AQUI. O arquivo sai do conversor com "18000.00";
          // tratar o ponto como separador de milhar multiplicava por 100 e
          // gravou salário de R$ 1.800.000. Só é formato brasileiro quando há
          // VÍRGULA — aí o ponto é milhar. Mesmo erro que eu tinha acabado de
          // corrigir no script Python e repeti aqui.
          _sal: (() => {
            let t = (r.salario || '').trim()
            if (!t) return null
            t = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
            const n = parseFloat(t); return isFinite(n) ? n : null })(),
          nome: (r.nome || '').trim() || null, matricula: (r.matricula || '').trim() || null,
          // código do recurso no apontamento de horas (SRA.RA_X_RECUR). É o que liga o
          // posto ao Extrato de Horas Apontadas — lá a pessoa é identificada por recurso,
          // não por matrícula. Vazio em vaga planejada e em quem não aponta.
          recurso_cod: (r.recurso || '').trim() || null,
          // roteiro AUT (RA_CATFUNC='A'): quem o integrador do apontamento paga
          // POR HORA. Quem não é aponta para dizer onde o custo cai, e some da
          // conferência Apontamento × Folha.
          ...(temCatFunc ? { recebe_hora: (() => { const s = (r.recebe_hora || '').trim().toLowerCase(); return s ? s !== 'nao' : null })() } : {}),
          // afastado_desde = 'AAAA-MM' do export. O ERP não sabe o retorno, então
          // ele entra em aberto (motor zera os 12 meses) e a grade marca a linha
          // com o chip AFASTADO para ser conferida.
          ...(temAfast ? (() => {
            const [fy, fm] = (r.afastado_desde || '').trim().split('-')
            if (!fy || !fm) return { afast_ini_ano: null, afast_ini_mes: null, afast_fim_ano: null, afast_fim_mes: null, afast_motivo: null }
            nAfast++
            return { afast_ini_ano: parseInt(fy, 10), afast_ini_mes: parseInt(fm, 10), afast_fim_ano: null, afast_fim_mes: null,
              afast_motivo: `${(r.situacao || 'afastado').trim()} (do RH em ${r.afastado_desde}) — confirmar retorno` }
          })() : {}),
          // a admissão alimenta DUAS coisas: a vigência de início (o posto começa
          // a custar quando a pessoa entrou) e o tempo de casa da rescisão. A
          // segunda fica na sua própria coluna porque a vigência é editável.
          ...(temSit ? (() => {
            const sf = (r.situacao || '').trim().toUpperCase()
            if (sf === 'D') nDemitidos++
            return { sit_folha: sf || null }
          })() : {}),
          ...(temAreaFunc ? (() => {
            const cod = (r.area_funcional || '').trim()
            if (!cod) return { area_func_id: null }
            const id = areaByCod.get(cod)
            if (!id) areasNaoAchadas.add(cod)
            return { area_func_id: id || null }
          })() : {}),
          admissao: (r.admissao || '').trim() || null,
          ini_ano: ay ? parseInt(ay, 10) : null, ini_mes: am ? parseInt(am, 10) : null, fte: 1, ativo: (r.ativo || 'sim') !== 'nao' })
      }
      if (!payload.length) {
        setErro(foraEscopo.size ? `Nenhuma linha dentro do seu escopo de edição (${foraEscopo.size} fora). Você só importa postos das empresas/filiais/CCs que pode orçar.`
          : 'Nenhuma linha resolvida — confira se os códigos de empresa existem nos cadastros.'); return
      }
      let apagados = 0
      let removerIds: string[] = []
      if (modo === 'substituir') {
        const empIds = [...new Set(payload.map(p => p.empresa_id))]
        const cods = empIds.map(id => empresas.find(e => e.id === id)?.codigo || id)
        // O escopo só alcança o que o usuário pode EDITAR: limitado por filial/CC,
        // a remoção se restringe a essas filiais/CCs. Admin/irrestrito: a empresa inteira.
        const editFil = filiais.filter(f => acesso.canEditPessoas('filial', f.id)).map(f => f.id)
        const editCc = ccs.filter(c => acesso.canEditPessoas('centro_custo', c.id)).map(c => c.id)
        const scopedFil = editFil.length < filiais.length, scopedCc = editCc.length < ccs.length

        // ⚠⚠ ATUALIZA E REMOVE OS AUSENTES — não apaga e recria.
        // Apagar e recriar dava ids NOVOS, e `fat_folha.posto_id` /
        // `fat_apontamento.posto_id` são `ON DELETE SET NULL`: em 05/nov/2026
        // uma carga de rotina desligou 59 mil linhas de fato sem apagar um
        // único valor e sem erro nenhum, porque as telas por competência
        // continuam somando certo. Fazendo o upsert PRIMEIRO, quem está no
        // arquivo mantém o id — e mantém junto tudo que o arquivo não traz
        // (área funcional, ajustes de grade), porque o upsert só escreve as
        // colunas do payload.
        const noEscopo = await pageAll<any>(() => {
          let q = supabase.from('posto_v').select('id,codigo,matricula,nome').in('empresa_id', empIds)
          if (scopedFil) q = q.in('filial_id', editFil)
          if (scopedCc) q = q.in('cc_id', editCc)
          return q
        })
        const codsArq = new Set(payload.map(p => p.codigo))
        const fora = noEscopo.filter(p => !codsArq.has(p.codigo))
        // ⚠ VAGA NUNCA É REMOVIDA. Posto sem matrícula é cadastro só do
        // Planorc — o arquivo do RH não pode conter, então "não está no
        // arquivo" não é evidência de nada sobre ela. Quem quer tirar uma
        // vaga tira na grade, que é um clique e é explícito.
        const vagas = fora.filter(p => !(p.matricula || '').trim())
        const ausentes = fora.filter(p => (p.matricula || '').trim())
        removerIds = ausentes.map(p => p.id)

        if (removerIds.length) {
          // Só os que de fato saem perdem ponteiro — número pequeno e
          // verdadeiro, em vez do total da tabela, que assustava sem informar.
          const contar = async (tabela: string) => {
            let n = 0
            for (let i = 0; i < removerIds.length; i += 150) {
              const { count } = await supabase.from(tabela).select('id', { count: 'exact', head: true })
                .in('posto_id', removerIds.slice(i, i + 150))
              n += count || 0
            }
            return n
          }
          const [nFolha, nApont] = await Promise.all([contar('fat_folha'), contar('fat_apontamento')])
          // ⚠ LISTAR OS NOMES, não só contar. Os 6 sócios (matrícula 8000xx)
          // e quem foi cadastrado à mão não estão no arquivo do RH e caem
          // aqui todo mês. Com o nome à vista a pessoa reconhece e cancela;
          // com "12 postos serão removidos" ela confirma e descobre depois.
          const nomes = ausentes.slice(0, 12).map(p => `  · ${p.codigo} ${p.nome || ''}`.trimEnd()).join('\n')
          if (!confirm(
            `SUBSTITUIR nas empresas ${cods.join(', ')}:\n` +
            `  ${payload.length} posto(s) do arquivo serão atualizados (id preservado)\n` +
            `  ${removerIds.length} posto(s) NÃO estão no arquivo e serão REMOVIDOS\n\n` +
            `${nomes}${ausentes.length > 12 ? `\n  … e mais ${ausentes.length - 12}` : ''}\n\n` +
            (vagas.length ? `${vagas.length} vaga(s) sem matrícula ficam — o arquivo do RH não as contém.\n\n` : '') +
            (nFolha || nApont
              ? `Os removidos desligam o vínculo (sem apagar valor):\n` +
                `  · ${nFolha.toLocaleString('pt-BR')} linha(s) de folha\n` +
                `  · ${nApont.toLocaleString('pt-BR')} linha(s) de apontamento\n\n`
              : '') +
            `Continuar?`)) return
        }
      }
      // ⚠ `salario_base` NÃO PODE IR NO UPSERT (v3_179). A v3_143 revogou o
      // `SELECT` dessa coluna, e `ON CONFLICT DO UPDATE SET x = excluded.x`
      // **lê** `excluded.x` — o Postgres então nega a instrução inteira com
      // "permission denied for table posto". Gravar pode (UPDATE está
      // concedido); o upsert é que não. Por isso o salário sai daqui e entra
      // depois, por `atualizar_salario_postos`, que faz UPDATE puro.
      const semAux = (p: any) => { const { _sal, ...resto } = p; return resto }
      const { error } = await supabase.from('posto').upsert(payload.map(semAux), { onConflict: 'tenant_id,codigo' })
      if (error) { setErro('Erro no import: ' + error.message); return }

      // Remoção só agora: se o upsert falhar, nada foi tirado. Por id, em
      // lotes — `not.in` com 500 códigos na URL estoura o limite do servidor.
      for (let i = 0; i < removerIds.length; i += 150) {
        const { error: eDel } = await supabase.from('posto').delete().in('id', removerIds.slice(i, i + 150))
        if (eDel) { setErro(`Postos gravados, mas a remoção dos ausentes falhou: ${eDel.message}`); return }
        apagados += removerIds.slice(i, i + 150).length
      }

      const salarios = payload.filter(p => p._sal != null).map(p => ({ codigo: p.codigo, salario: p._sal }))
      const semSalario = payload.length - salarios.length
      let salarioFora = 0
      if (salarios.length) {
        // Depois do upsert, para o posto novo já existir quando o salário chega.
        const { data: rs, error: eSal } = await supabase.rpc('atualizar_salario_postos', { p_dados: salarios })
        if (eSal) { setErro('Postos gravados, mas o salário falhou: ' + eSal.message); return }
        const r: any = Array.isArray(rs) ? rs[0] : rs
        salarioFora = (r?.fora_escopo || 0) + (r?.nao_encontrados || 0)
      }

      // ids dos postos gravados (reusado por benefícios e rateio)
      const codigos = payload.map(p => p.codigo)
      const idByCod = new Map<string, string>()
      for (let i = 0; i < codigos.length; i += 150) {
        const { data } = await supabase.from('posto_v').select('id,codigo').in('codigo', codigos.slice(i, i + 150))
        for (const x of data || []) idByCod.set(x.codigo, x.id)
      }

      // benefícios por posto: colunas do arquivo que casam com códigos de verba (VALOR_FIXO) → posto_verba
      // ⚠ RELÊ O CATÁLOGO AQUI, não usa o do carregamento da tela. Verba
      // cadastrada DEPOIS que a página abriu — por seed ou por outra aba — não
      // está no estado, e a coluna correspondente do arquivo é ignorada em
      // silêncio: o resumo diz "7 verbas" em vez de 8 e ninguém sabe qual
      // faltou. Foi o que houve com a PLR em 17/nov.
      const { data: verbasAgora } = await supabase.from('verba_folha')
        .select('id,codigo').eq('ativo', true)
      const verbaByCod = new Map((verbasAgora || verbas).map((v: any) => [String(v.codigo).trim().toUpperCase(), v.id]))
      const benefCols = Object.keys(rows[0] || {}).filter(c => verbaByCod.has(c.trim().toUpperCase()))
      let benefCriados = 0
      if (benefCols.length) {
        const pvRows: any[] = []
        for (const r of rows) {
          const pid = idByCod.get(r.posto_codigo); if (!pid) continue
          for (const col of benefCols) {
            const raw = (r[col] || '').trim(); if (!raw) continue
            const val = parseFloat(raw.replace(',', '.')); if (!val || isNaN(val)) continue
            pvRows.push({ tenant_id: TENANT_ID, posto_id: pid, verba_id: verbaByCod.get(col.trim().toUpperCase()), valor: val })
          }
        }
        // ⚠⚠ O DELETE É RECORTADO PELAS COLUNAS DO ARQUIVO. Antes apagava
        // `posto_verba` INTEIRO dos postos do arquivo e reinseria só o que as
        // colunas traziam — então um arquivo com a coluna da PLR e sem as de
        // benefício zerava VA/VR, assistência médica e multibenefícios de todo
        // mundo, sem erro e sem linha no resumo. Mesmo defeito que o rateio
        // tinha, e a mesma regra: o arquivo só manda nas verbas sobre as quais
        // ele DIZ alguma coisa; nas outras, não toca.
        // Tirar um benefício continua possível — na tela do posto, onde
        // remover é um ato, ou mandando a coluna com valor zero.
        const pids = [...idByCod.values()]
        const verbasDoArquivo = benefCols.map(c => verbaByCod.get(c.trim().toUpperCase())).filter(Boolean) as string[]
        if (pids.length && verbasDoArquivo.length) {
          for (let i = 0; i < pids.length; i += 150) {
            const { error } = await supabase.from('posto_verba').delete()
              .in('posto_id', pids.slice(i, i + 150)).in('verba_id', verbasDoArquivo)
            if (error) { setErro('Aviso — benefícios (limpeza): ' + error.message); break }
          }
        }
        if (pvRows.length) { const { error: pvErr } = await supabase.from('posto_verba').upsert(pvRows, { onConflict: 'posto_id,verba_id' }); if (pvErr) setErro('Aviso — benefícios: ' + pvErr.message) }
        benefCriados = pvRows.length
      }

      // rateio por posto: coluna RATEIO com códigos (nome) separados por ; em ordem de cascata → posto_rateio
      const rateioCol = Object.keys(rows[0] || {}).find(c => c.trim().toUpperCase() === 'RATEIO')
      let rateioPostos = 0; const rateioNaoAchados = new Set<string>()
      if (rateioCol) {
        // ⚠⚠ A REGRA SE CHAMA "RATEMP01 - Empresa Padrão Geral" E O ARQUIVO
        // MANDA "RATEMP01". Casar pelo nome inteiro não acha nada — e o
        // sintoma é mudo: "0 postos com rateio substituído", com os códigos
        // listados como não encontrados. Aconteceu na carga de 17/nov.
        // Então o mapa aceita as duas formas: o nome completo e o CÓDIGO, que
        // é o pedaço antes do primeiro hífen. ⚠ Separador sem espaços existe
        // no cadastro ('RATCC02-Serviço Base Novos'), e há regra sem hífen
        // nenhum ('RATCCBASENOVOS'), onde o nome inteiro é o código.
        // ⚠ Código ambíguo entre duas regras NÃO entra: o primeiro venceria em
        // silêncio, que é a armadilha do `ON CONFLICT` da v3_157.
        const regraByNome = new Map<string, string>()
        const codsVistos = new Map<string, number>()
        for (const c of rateioCods) {
          const nome = String(c.nome).trim().toUpperCase()
          regraByNome.set(nome, c.id)
          const cod = nome.split('-')[0].trim()
          codsVistos.set(cod, (codsVistos.get(cod) || 0) + 1)
        }
        for (const c of rateioCods) {
          const nome = String(c.nome).trim().toUpperCase()
          const cod = nome.split('-')[0].trim()
          if (cod && cod !== nome && codsVistos.get(cod) === 1) regraByNome.set(cod, c.id)
        }
        const prRows: any[] = []
        // ⚠ Só os postos que o arquivo DIZ alguma coisa sobre rateio. É o que
        // separa "substituir" de "apagar".
        const pidsComRateio: string[] = []
        for (const r of rows) {
          const pid = idByCod.get(r.posto_codigo); if (!pid) continue
          const toks = String(r[rateioCol] || '').split(/[;,]/).map(t => t.trim()).filter(Boolean)
          if (!toks.length) continue
          let ordem = 0; let anexou = false
          for (const t of toks) {
            const rid = regraByNome.get(t.toUpperCase())
            if (!rid) { rateioNaoAchados.add(t); continue }
            ordem++; prRows.push({ tenant_id: TENANT_ID, posto_id: pid, regra_id: rid, ordem }); anexou = true
          }
          // ⚠⚠ SÓ APAGA QUEM VAI RECEBER. O delete dependia de "o arquivo traz
          // token" e a inserção depende de "o token ACHOU regra" — e as duas
          // coisas se separaram na carga de 17/nov, quando nenhum código casou
          // (as regras chamam-se "RATEMP01 - ..." e o arquivo manda
          // "RATEMP01"): 114 postos tiveram o rateio apagado e nada entrou no
          // lugar. Apagar com base numa intenção que pode falhar é o mesmo
          // erro de quem deleta antes de saber se o insert vai passar.
          if (anexou) { pidsComRateio.push(pid); rateioPostos++ }
        }
        // ⚠⚠ CÉLULA VAZIA NÃO É "SEM RATEIO", É "O ARQUIVO NÃO SABE". Antes o
        // delete ia em TODOS os postos do arquivo e só então reinseria os que
        // tinham token — então todo rateio reclassificado à mão sumia na carga
        // seguinte, sem erro e sem linha no resumo. É a pergunta da v3_163
        // ("nulo é lacuna ou significado?") aplicada a uma coluna de arquivo:
        // aqui é LACUNA, porque o de-para por CC do converter cobre uma parte
        // dos centros de custo e cala sobre o resto.
        // Quem precisa TIRAR um rateio tira na tela, que é onde a remoção é um
        // ato e não um efeito colateral.
        if (pidsComRateio.length) {
          for (let i = 0; i < pidsComRateio.length; i += 150) {
            const { error } = await supabase.from('posto_rateio').delete().in('posto_id', pidsComRateio.slice(i, i + 150))
            if (error) { setErro('Aviso — rateio (limpeza): ' + error.message); break }
          }
        }
        if (prRows.length) { const { error: prErr } = await supabase.from('posto_rateio').upsert(prRows, { onConflict: 'tenant_id,posto_id,regra_id' }); if (prErr) setErro('Aviso — rateio: ' + prErr.message) }
      }

      setImportInfo({ gravados: payload.length, apagados, modo, semEmp: [...semEmp], semFil: [...semFil], semCc: [...semCc], foraEscopo: foraEscopo.size, cargosNovos: cargosCriados, cargoDesativado, beneficios: benefCriados, benefColunas: benefCols.length, rateioPostos, rateioCol: !!rateioCol, rateioNaoAchados: [...rateioNaoAchados], afastados: nAfast, cargoAmbiguo, semSalario, salarioFora, areasNaoAchadas: [...areasNaoAchadas], codsNaoAchados: [...codsNaoAchados], demitidos: temSit ? nDemitidos : -1, comAreaFunc: temAreaFunc ? payload.filter(x => (x as any).area_func_id).length : 0 })
      loadPostos()
    } finally { setImportando(false) }
  }
  const onFile = async (file: File) => {
    try { await importar(file.name.toLowerCase().endsWith('.csv') ? parseCsv(await file.text()) : await parseXlsxRows(file)) }
    catch (e: any) { setErro('Erro ao ler o arquivo: ' + (e?.message || e)) }
  }

  // ── Aplicar no orçado (step 5): grava fat_orcado (origem POSTO) do quadro ativo da versão ──
  const [aplicando, setAplicando] = useState(false)
  // ⚠ O CATÁLOGO DE VERBAS É RELIDO AO VOLTAR PARA A ABA. Ele é carregado na
  // abertura da tela e tudo depende dele: o motor calcula com ele, o painel do
  // posto desenha os campos com ele, o importador casa colunas com ele. Verba
  // criada DEPOIS — por seed, por outra aba, por outra pessoa — não existia
  // para a página até alguém recarregar, e o sintoma é mudo: o campo
  // simplesmente não está lá. Aconteceu com a PLR em 17/nov, duas vezes.
  // Mesmo padrão do cache de escopo em `escopoDados.ts`, e pela mesma razão:
  // invalidar só para quem edita não alcança quem está com a tela aberta.
  useEffect(() => {
    const reler = async () => {
      const { data } = await supabase.from('verba_folha')
        .select('id,codigo,descricao,tipo_calculo,parametro,calendario,verba_ref,conta_destino_id,incide_encargos,mantem_afastado,regime,pais,ordem,categoria').eq('ativo', true).order('ordem', { nullsFirst: false })
      if (data) setVerbas(data as VerbaRegra[])
    }
    window.addEventListener('focus', reler)
    return () => window.removeEventListener('focus', reler)
  }, [])
  // Diálogo do Aplicar: o `confirm()` não comporta um seletor, e as duas
  // perguntas que ele passa a fazer — ONDE pousa e COMO resolve — são
  // escolhas, não um "ok".
  const [aplForm, setAplForm] = useState<{ destino: string; comoAprovado: boolean } | null>(null)
  const [aplicarInfo, setAplicarInfo] = useState<{ linhas: number; postos: number; contas: number; ano: number; fundidas: number; semTaxa: number; semConta: string[]; natEstranha: string[] } | null>(null)
  // A tela só chama; quem confere a autoridade é o banco (`pode_aprovar_cenario`).
  // Conferir o retorno importa: RPC barrada levanta erro, mas versão fora do
  // tenant simplesmente não atualiza linha nenhuma e voltaria "sucesso".
  // Veredito por posto: a conversa. O carimbo do cenário (abaixo) é a trava.
  // Abandonar a decisão: o posto volta a herdar tudo do cadastro. É a segunda
  // saída de uma recusa — a primeira é corrigir. Apaga a sobreposição inteira,
  // e o gatilho derruba o carimbo do cenário junto, como deve.
  const abandonarDecisao = async (postoId: string) => {
    const ov: any = overlays.get(postoId)
    if (ov?.id) {
      const { error } = await supabase.from('posto_versao').delete().eq('id', ov.id)
      if (error) throw new Error(error.message)
    }
    await loadOverlays(versaoSel)
  }

  // Reabrir devolve à fila do aprovador sem aprovar nada — por isso a guarda no
  // banco é `pode_escrever()`, não `pode_aprovar_cenario()`.
  const reabrirDecisao = async (ovId: string, nota: string | null) => {
    const { error } = await supabase.rpc('reabrir_decisao', { p_id: ovId, p_nota: nota })
    if (error) throw new Error(error.message)
    await loadOverlays(versaoSel)
  }

  const decidirPosto = async (ovId: string, aprovado: boolean | null, nota: string | null) => {
    const { error } = await supabase.rpc('decidir_posto_cenario', { p_id: ovId, p_aprovado: aprovado, p_nota: nota })
    if (error) throw new Error(error.message)
    await loadOverlays(versaoSel)
  }
  // Pendentes e reprovados entre as decisões que REALMENTE mudam algo —
  // sobreposição gravada igual ao mestre não é decisão e não deve travar nada.
  const vereditos = useMemo(() => {
    let pend = 0, repr = 0
    for (const [id] of alterados) {
      const ov: any = overlays.get(id)
      if (!ov) continue
      if (ov.aprovado === true) continue
      if (ov.aprovado === false) repr++; else pend++
    }
    // ⚠ Recusada NÃO trava: recusar é decidir — decidir que o posto fica como
    // está no cadastro. O que trava é o PENDENTE, que quer dizer "ninguém olhou".
    return { pend, repr, ok: pend === 0 && alterados.size > 0 }
  }, [alterados, overlays])

  const decidirAprovacao = async (aprovar: boolean, nota: string) => {
    if (!versaoSel) return
    const { data, error } = aprovar
      ? await supabase.rpc('aprovar_cenario', { p_versao: versaoSel, p_nota: nota || null })
      : await supabase.rpc('reprovar_cenario', { p_versao: versaoSel, p_nota: nota || null })
    if (error) throw new Error(error.message)
    if (aprovar && !(data as any[])?.length) throw new Error('Nada foi aprovado — a versão não foi encontrada no seu tenant.')
    await loadLookups()
  }

  // ⚠⚠ DUAS PERGUNTAS DIFERENTES: de onde vêm as DECISÕES e onde o dinheiro
  // POUSA. Eram a mesma — o Aplicar sempre escrevia na versão selecionada —, e
  // é isso que impedia simular: para ver o efeito de um cenário em atualização
  // era preciso aprová-lo, o que inverte a ordem das coisas.
  // As decisões continuam onde estão (`copiar_versao` copia `fat_orcado`, NÃO
  // `posto_versao`); o que muda é o destino. Ver docs/DESIGN_orcado_preliminar.md.
  const ehPreliminar = (vid: string) => !!versoes.find((v: any) => v.id === vid)?.origem_versao_id
  const vSelCodDe = (vid: string) => versoes.find((v: any) => v.id === vid)?.codigo || ''

  const aplicarNoOrcado = async (destinoId?: string, comoAprovado = false) => {
    setErro(null); setAplicarInfo(null)
    if (!versaoSel) { setErro('Selecione a versão do orçamento.'); return }
    const destino = destinoId || versaoSel
    const preliminar = ehPreliminar(destino)
    // Versão bloqueada é versão aprovada: o Aplicar APAGA todo o orçado POSTO dela e
    // regrava do quadro ATUAL — que pode já estar noutra hipótese. O editor de
    // formulário sempre respeitou `bloqueada`; a folha não, e é justamente o maior
    // bloco de custo. Guarda do P0 (docs/DESIGN_cenarios.md §7.6).
    const vDest = versoes.find(v => v.id === destino)
    if (vDest?.bloqueada) {
      setErro(`A versão ${vDest.codigo} está BLOQUEADA (aprovada) — o Aplicar apagaria e regravaria o orçado de folha dela a partir do quadro de postos de hoje. Desbloqueie em Cadastros → Versões se for mesmo para refazer, ou escolha outra versão.`)
      return
    }
    // ⚠ A trava vale pelo TIPO DO DESTINO, não pelo da origem das decisões:
    // baseline é dinheiro e exige carimbo; cenário é hipótese e dispensa.
    // Fora do modo cenário (ou sem nenhuma decisão) o Aplicar é o de sempre:
    // não há o que aprovar quando o quadro é o próprio cadastro.
    // A mesma regra vale no banco (v3_185) — aqui ela é só o aviso decente.
    if (modoCenario && alterados.size > 0 && !preliminar && !vDest?.aprovado_em) {
      setErro(`O cenário ${vSelCodDe(versaoSel)} decide ${alterados.size} posto(s) e ainda NÃO foi aprovado. Revise e aprove em "Comparar com o cadastro" — ou aplique numa versão PRELIMINAR para só simular, sem comprometer o orçamento.`)
      return
    }
    if (comoAprovado && !preliminar) {
      setErro('Resolver "como se tudo passasse" só vale em versão preliminar — numa baseline isso gravaria como acordado o que ninguém decidiu.')
      return
    }
    if (!temMotor) { setErro('Sem verbas cadastradas — cadastre a Estrutura antes de aplicar.'); return }
    // O Aplicar grava o quadro EFETIVO: no modo cenário são as decisões da versão,
    // fora dele é o mestre. Sem isto o cenário existiria só na tela.
    // IGNORA os filtros de tela de propósito: o Aplicar SUBSTITUI todo o orçado
    // POSTO da versão, então gravar só o que está filtrado apagaria o resto.
    // Um filtro esquecido viraria perda de orçamento.
    // ⚠ O APLICAR RESOLVE SÓ O APROVADO. Uma decisão recusada não entra: aquele
    // posto vai com o valor do CADASTRO. Usar `postosEf` aqui gravaria o número
    // do cenário ignorando a recusa — e o pior é que o carimbo diria que foi
    // revisado. A tela continua mostrando a proposta; o aviso abaixo declara a
    // diferença no momento em que ela passa a valer dinheiro.
    // ⚠ `comoAprovado` usa a PROPOSTA mesmo sem veredito — é o que torna a
    // simulação possível com o cenário ainda em atualização, e é por isso que
    // só vale em versão preliminar: numa baseline gravaria como acordado o que
    // ninguém decidiu. O rótulo do número tem de dizer "se tudo passar".
    const aplicaveis = modoCenario
      ? postos.map(p => {
          const ov: any = overlays.get(p.id)
          const usar = comoAprovado ? !!ov : ov?.aprovado === true
          return usar ? resolvePosto(p, ov) : p
        })
      : postosEf
    const recusadasFora = modoCenario && !comoAprovado
      ? [...alterados.keys()].filter(id => (overlays.get(id) as any)?.aprovado === false).length
      : 0
    const semVeredito = modoCenario && comoAprovado
      ? [...alterados.keys()].filter(id => (overlays.get(id) as any)?.aprovado == null).length
      : 0
    const ativos = aplicaveis.filter(p => p.ativo !== false)
    // "ativos" aqui é "não demitidos": férias e afastamento seguem custando —
    // para o afastado o motor zera a base e mantém as verbas marcadas com
    // `mantem_afastado`. Dizer só "ativos" escondia esses 16.
    const fora = ativos.filter(p => situacaoPosto(p as any) !== 'ativo').length
    const versaoCod = vDest?.codigo || String(anoCalc)
    if (!confirm(`Aplicar ${ativos.length} postos no orçado da versão ${versaoCod} (ano ${anoCalc})?${preliminar ? '\n\n⚠ VERSÃO PRELIMINAR — simulação. Não é o orçamento acordado.' : ''}${semVeredito ? `\n\n⚠ ${semVeredito} decisão(ões) SEM VEREDITO entram como se tivessem passado.` : ''}\n\nEntram todos os não demitidos${fora ? `, incluindo ${fora} em férias ou afastados — quem está afastado ou de férias continua custando` : ''}.${recusadasFora ? `\n\n⚠ ${recusadasFora} decisão(ões) RECUSADA(S) não entram: esses postos vão com o valor do CADASTRO, não com o do cenário.` : ''} Os filtros da tela NÃO afetam o que é gravado.\n\nIsto SUBSTITUI todo o orçado de origem POSTO desta versão. Lançamentos manuais e de formulário não são afetados.\n\nDespesa é gravada com sinal NEGATIVO, como o orçado manual e o realizado.`)) return
    setAplicando(true)
    try {
      const round2 = (n: number) => Math.round(n * 100) / 100
      // MULTIMOEDA: moeda_origem = moeda funcional da empresa do POSTO (fonte do custo);
      // converte pela taxa ORÇADA da versão. BR (slot 1) = valor fica base, só preenche val_m2.
      const [{ data: moedasD }, { data: empMoedaD }, vtaxas, contasNat] = await Promise.all([
        supabase.from('moeda').select('slot').eq('ativo', true).order('slot'),
        supabase.from('empresa').select('id,moeda_slot'),
        pageAll(() => supabase.from('versao_taxa').select('moeda_slot,ano,mes,taxa').eq('versao_id', destino)),
        pageAll(() => supabase.from('conta_orcamentaria').select('id,codigo,natureza')),
      ])
      // SINAL: fat_orcado guarda despesa NEGATIVA — é a convenção do orçado
      // MANUAL e do realizado. O motor gravava positivo, e na DRE as duas
      // origens se cancelavam em vez de somar (EBITDA inflado em 517% quando
      // medimos). Decide pela `natureza` da conta, não por "folha é despesa":
      // se amanhã o motor escrever numa conta de outra natureza, acerta sozinho.
      // Não vale para a `fat_folha`: lá o lado realizado vem da folha do ERP,
      // que é positiva, e a conciliação compara os dois crus.
      const natConta = new Map<string, string | null>((contasNat || []).map((c: any) => [c.id, c.natureza]))
      const codConta = new Map<string, string>((contasNat || []).map((c: any) => [c.id, c.codigo]))
      const sinalDe = (conta: string) => natConta.get(conta) === 'DESPESA' ? -1 : 1
      const natEstranha = new Set<string>()   // conta que o motor escreve e não é DESPESA
      const slotsAtivos = (moedasD?.length ? moedasD.map((m: any) => m.slot) : [1]) as number[]
      const empMoeda = new Map<string, number>((empMoedaD || []).map((e: any) => [e.id, e.moeda_slot || 1]))
      let semTaxaOrc = 0
      const matOrc = (row: any) => {   // row.valor em moeda de origem → base + slots
        const orig = row.moeda_origem || 1
        if (orig === 1 && slotsAtivos.every(s => s === 1)) return true
        const { vals } = materializa(row.valor, orig, slotsAtivos, (slot) => taxaOrcada(slot, row.ano, row.mes, vtaxas as any))
        if (vals[1] == null) { semTaxaOrc++; return false }   // origem estrangeira sem taxa orçada
        row.valor = vals[1]; row.val_m2 = vals[2] ?? null; row.val_m3 = vals[3] ?? null; row.val_m4 = vals[4] ?? null; row.val_m5 = vals[5] ?? null; return true
      }
      const byKey = new Map<string, any>()   // dedup pela chave da uq_fat_orcado (soma colisões)
      const contasTocadas = new Set<string>(); let postosAplicados = 0; let gerados = 0
      // Verba COM valor e SEM conta destino não entra no fat_orcado: porContaMes
      // só indexa quem tem conta. O número aparece na grade e não chega à DRE —
      // perda silenciosa, e a rescisão nasce justamente sem conta amarrada.
      const semConta = new Set<string>()
      const verbaById = new Map(verbas.map(v => [v.id, v]))   // p/ orçado por verba (fat_folha ORCADO)
      const folhaRows: any[] = []            // orçado por posto × verba × mês (NÃO rateado)
      for (const p of ativos) {
        const r = custos.get(p.id); if (!r) continue
        const { cells } = cascataRateio({ empresa_id: p.empresa_id, cc_id: p.cc_id || null }, postoRateios[p.id] || [], rateioCods, destByRegra)
        let algo = false
        for (const conta in r.porContaMes) {
          const mensal = r.porContaMes[conta]
          const sin = sinalDe(conta)
          if (sin > 0) natEstranha.add(`${codConta.get(conta) || conta} (${natConta.get(conta) || 'sem natureza'})`)
          for (let mi = 0; mi < 12; mi++) {
            const base = mensal[mi] * sin; if (!base) continue
            for (const cell of cells) {
              const valor = round2(base * cell.pct); if (!valor) continue
              // ⚠ A FILIAL É CONTÁBIL E NÃO ACOMPANHA O RATEIO. A empresa de destino
              // é recorte GERENCIAL — o rateio move o custo entre áreas do grupo —,
              // mas a entidade que contabilizou continua sendo a do posto. Por isso
              // o par (empresa de destino × filial de origem) é o certo aqui, e não
              // uma inconsistência, mesmo com `filial.empresa_id` apontando para
              // outra: empresa é agrupadora, não matriz.
              // Antes a filial era ANULADA quando a empresa mudava, e isso deixou
              // 8.064 das 13.140 células de posto de 2027 (R$ 8,4 mi) sem filial —
              // invisíveis para quem tiver escopo de filial, porque a policy de
              // leitura exige `filial_id IS NOT NULL`, e origem do grão misto na
              // tela de Orçar por linha.
              const filial_id = p.filial_id || null
              const cc_id = cell.cc_id || null
              const dims: any = { posto: p.codigo, posto_id: p.id, nome: p.nome || null, matricula: p.matricula || null, cc_origem: p.cc_id || null, ...(cell.pct < 0.999999 ? { rateio_pct: round2(cell.pct * 100) } : {}) }
              const dk = JSON.stringify(Object.keys(dims).sort().reduce((o: any, k) => (o[k] = dims[k], o), {}))
              const key = `${conta}|${cell.empresa_id}|${filial_id || '-'}|${cc_id || '-'}|${mi + 1}|${dk}`
              gerados++
              const ex = byKey.get(key)
              if (ex) ex.valor = round2(ex.valor + valor)
              else byKey.set(key, { tenant_id: TENANT_ID, versao_id: destino, linha_id: conta, empresa_id: cell.empresa_id, filial_id, cc_id, ano: anoCalc, mes: mi + 1, valor, expressao: null, origem: 'POSTO', dims, moeda_origem: empMoeda.get(p.empresa_id) || 1 })
              contasTocadas.add(conta); algo = true
            }
          }
        }
        if (algo) postosAplicados++
        // orçado POR VERBA (paralelo, não rateado) — na empresa/CC do próprio posto
        for (const vid in r.porVerbaMes) {
          const mensal = r.porVerbaMes[vid]; const vinfo = verbaById.get(vid)
          if (!vinfo?.conta_destino_id && mensal.some(x => x)) semConta.add(vinfo?.codigo || vid)
          for (let mi = 0; mi < 12; mi++) {
            const valor = round2(mensal[mi]); if (!valor) continue
            folhaRows.push({
              tenant_id: TENANT_ID, versao_id: destino, ano: anoCalc, mes: mi + 1, tipo: 'ORCADO', origem: 'POSTO',
              empresa_id: p.empresa_id, filial_id: p.filial_id || null, cc_id: p.cc_id || null,
              matricula: p.matricula || null, nome: p.nome || null, posto_id: p.id,
              verba_cod: vinfo?.codigo || null, verba_desc: vinfo?.descricao || null,
              item_orc_id: vinfo?.conta_destino_id || null, valor, moeda_origem: empMoeda.get(p.empresa_id) || 1,
            })
          }
        }
      }
      // materializa moedas (converte valor→base + val_m2/val_m3 pela taxa orçada); descarta o que não tem base
      const rows = [...byKey.values()].filter(matOrc)
      const folhaOk = folhaRows.filter(matOrc)
      // substitui o orçado origem POSTO da versão e reinsere
      const { error: delErr } = await supabase.from('fat_orcado').delete().eq('versao_id', destino).eq('origem', 'POSTO')
      if (delErr) { setErro('Erro ao limpar o orçado POSTO: ' + delErr.message); return }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('fat_orcado').insert(rows.slice(i, i + 500))
        if (error) { setErro('Erro ao gravar o orçado (parcial): ' + error.message); return }
      }
      // paralelo: orçado por verba na fat_folha (tipo ORCADO) — p/ conciliação por verba
      const delF = await supabase.from('fat_folha').delete().eq('tipo', 'ORCADO').eq('versao_id', destino)
      if (delF.error) { setErro('Aviso — orçado por verba (limpeza): ' + delF.error.message) }
      else for (let i = 0; i < folhaOk.length; i += 500) {
        const { error } = await supabase.from('fat_folha').insert(folhaOk.slice(i, i + 500))
        if (error) { setErro('Aviso — orçado por verba (gravação): ' + error.message); break }
      }
      setAplicarInfo({ linhas: rows.length, postos: postosAplicados, contas: contasTocadas.size, ano: anoCalc, fundidas: gerados - rows.length, semTaxa: semTaxaOrc, semConta: [...semConta], natEstranha: [...natEstranha] })
    } finally { setAplicando(false) }
  }
  // Grava a DECISÃO na versão, não no cadastro. `limpar` marca campos
  // explicitamente vazios no cenário (o mestre demite em maio, o cenário mantém).
  // Overlay que ficou sem nenhuma decisão é APAGADO: cenário não guarda "igual
  // ao mestre" — senão o filtro "só alteradas" encheria de linhas sem mudança.
  const salvarCenario = async (postoId: string, patch: Partial<PostoVersao>, limpar: CampoCenario[] = []) => {
    if (!versaoSel) { setErro('Selecione a versão para editar o cenário.'); return }
    const atual = overlays.get(postoId)
    const limpos = new Set([...(atual?.limpos || [])])
    for (const c of limpar) limpos.add(c)
    for (const k of Object.keys(patch)) if ((patch as any)[k] != null) limpos.delete(k)
    const novo: PostoVersao = { ...(atual || { versao_id: versaoSel, posto_id: postoId }), ...patch, limpos: [...limpos] }
    if (overlayVazio(novo)) {
      if (atual?.id) {
        const { error } = await supabase.from('posto_versao').delete().eq('id', atual.id)
        if (error) { setErro(error.message); return }
      }
      setOverlays(m => { const n = new Map(m); n.delete(postoId); return n })
      return
    }
    const row: any = { tenant_id: TENANT_ID, versao_id: versaoSel, posto_id: postoId, limpos: novo.limpos, nota: novo.nota ?? null }
    for (const c of CAMPOS_CENARIO) row[c] = (novo as any)[c] ?? null
    const { data, error } = await supabase.from('posto_versao')
      .upsert(row, { onConflict: 'versao_id,posto_id' }).select('*').single()
    if (error) { setErro(error.message); return }
    setOverlays(m => new Map(m).set(postoId, data as PostoVersao))
  }

  // ⚠ Saíram com a edição em linha da grade: o roteador `grava()` (cenário →
  // decisão, cadastro → posto) e o `salvar()` de patch solto, que gravava campo
  // a campo sem passar pelas validações do formulário. O que grava hoje é o
  // formulário do posto (registro inteiro) e o `salvarCenario`, pelo formulário
  // de decisões. Um `update` parcial em `posto` é justamente o caminho que
  // deixava salário e FTE escaparem da conferência que o formulário faz.

  // Some com a sobreposição inteira: a linha volta a herdar o cadastro.
  const limparCenario = async (postoId: string) => {
    const ov = overlays.get(postoId)
    if (ov?.id) { const { error } = await supabase.from('posto_versao').delete().eq('id', ov.id); if (error) { setErro(error.message); return } }
    setOverlays(m => { const n = new Map(m); n.delete(postoId); return n })
  }

  // ⚠⚠ APAGAR O POSTO NÃO APAGAVA O ORÇADO QUE ELE GEROU. `fat_orcado` nem tem
  // `posto_id` — a origem fica em `dims->>'posto'`, que é texto e não tem FK —,
  // e em `fat_folha` o `posto_id` é `ON DELETE SET NULL`. O resultado era um
  // posto inexistente seguir custando no orçamento, sem dono e sem rastro:
  // achado num pró-labore que deixou R$ 900.000 em 2026 depois de excluído.
  // ⚠ E o `dims->>'posto'` é o CÓDIGO: criar outro posto com o mesmo código
  // adotava as linhas órfãs do antigo, em silêncio.
  //
  // ⚠ Versão BLOQUEADA fica de fora, de propósito: ela é um retrato do que foi
  // aprovado, e naquele momento o posto existia. Reescrever o passado para
  // arrumar o presente é pior que a sobra — a sobra ao menos se vê.
  const excluir = async (id: string, cod: string) => {
    const vBloq = new Set(versoes.filter((v: any) => v.bloqueada).map((v: any) => v.id))
    const { data: orc } = await supabase.from('fat_orcado')
      .select('id,ano,valor,versao_id').eq('origem', 'POSTO').eq('dims->>posto', cod)
    const limpar = (orc || []).filter((r: any) => !vBloq.has(r.versao_id))
    const congelado = (orc || []).length - limpar.length
    const { data: folhaOrc } = await supabase.from('fat_folha')
      .select('id,versao_id').eq('tipo', 'ORCADO').eq('posto_id', id)
    const folhaLimpar = (folhaOrc || []).filter((r: any) => !vBloq.has(r.versao_id))
    const totOrc = limpar.reduce((s: number, r: any) => s + Math.abs(Number(r.valor) || 0), 0)
    const anos = [...new Set(limpar.map((r: any) => r.ano))].sort().join(', ')

    if (!confirm(
      `Excluir o posto ${cod}?\n\n` +
      (limpar.length
        ? `Sai junto o orçado que ele gerou: ${limpar.length} linha(s) em ${anos}, ` +
          `R$ ${totOrc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.\n` +
          `Sem isso o posto some da tela e continua custando no orçamento.\n\n`
        : 'Ele não gerou orçado em nenhuma versão aberta.\n\n') +
      (congelado ? `${congelado} linha(s) em versão BLOQUEADA ficam — versão fechada é retrato, não se reescreve.\n\n` : '') +
      `A folha e o apontamento realizados NÃO são apagados: o valor foi pago. ` +
      `Eles só perdem o vínculo com este posto.`)) return

    for (let i = 0; i < limpar.length; i += 200) {
      const { error } = await supabase.from('fat_orcado').delete().in('id', limpar.slice(i, i + 200).map((r: any) => r.id))
      if (error) { setErro('Erro ao limpar o orçado do posto: ' + error.message); return }
    }
    for (let i = 0; i < folhaLimpar.length; i += 200) {
      const { error } = await supabase.from('fat_folha').delete().in('id', folhaLimpar.slice(i, i + 200).map((r: any) => r.id))
      if (error) { setErro('Erro ao limpar a folha orçada do posto: ' + error.message); return }
    }
    const { error } = await supabase.from('posto').delete().eq('id', id)
    if (error) { setErro(error.message); return }
    setPostos(ps => ps.filter(p => p.id !== id))
  }
  // novo posto / vaga ou edição (código, ocupante, cargo, local, regime, salário, vigência)
  const novoPosto = (pre?: { cc_id?: string; cargo_id?: string }) => setForm({ codigo: '', codigoAuto: true, nome: '', matricula: '', cargo_id: pre?.cargo_id || '', empresa_id: (empresas[0]?.id || ''), filial_id: '', cc_id: pre?.cc_id || '', sindicato_id: '', regime: 'BR-CLT', recebe_hora: '', salario_base: '', fte: '1', ini_ano: String(anoCalc), ini_mes: '1', fim_ano: '', fim_mes: '', reajuste_mes: '', reajuste_pct: '', reajuste_valor: '', admissao: '', afast_ini_ano: '', afast_ini_mes: '', afast_fim_ano: '', afast_fim_mes: '', afast_motivo: '', sit_folha: '', rateios: [] })
  const editarPosto = (p: Posto) => setForm({ id: p.id, codigo: p.codigo, codigoAuto: false, nome: p.nome || '', matricula: p.matricula || '', cargo_id: p.cargo_id || '', empresa_id: p.empresa_id, filial_id: p.filial_id || '', cc_id: p.cc_id || '', sindicato_id: p.sindicato_id || '', regime: p.regime || '', recebe_hora: p.recebe_hora == null ? '' : (p.recebe_hora ? 'sim' : 'nao'), salario_base: p.salario_base != null ? inp2(p.salario_base) : '', fte: p.fte != null ? String(p.fte) : '1', ini_ano: p.ini_ano ? String(p.ini_ano) : '', ini_mes: p.ini_mes ? String(p.ini_mes) : '', fim_ano: p.fim_ano ? String(p.fim_ano) : '', fim_mes: p.fim_mes ? String(p.fim_mes) : '', reajuste_mes: p.reajuste_mes ? String(p.reajuste_mes) : '', reajuste_pct: p.reajuste_pct != null ? String(p.reajuste_pct) : '', reajuste_valor: p.reajuste_valor != null ? inp2(p.reajuste_valor) : '', afast_ini_ano: p.afast_ini_ano ? String(p.afast_ini_ano) : '', afast_ini_mes: p.afast_ini_mes ? String(p.afast_ini_mes) : '', afast_fim_ano: p.afast_fim_ano ? String(p.afast_fim_ano) : '', afast_fim_mes: p.afast_fim_mes ? String(p.afast_fim_mes) : '', afast_motivo: p.afast_motivo || '', sit_folha: (p as any).sit_folha || '', admissao: p.admissao || '', rateios: (postoRateios[p.id] || []).map(r => ({ ...r })) })
  const salvarPosto = async () => {
    if (!form) return
    if (!form.empresa_id) { setErro('Informe a empresa.'); return }
    if (!form.filial_id) { setErro('Informe a filial.'); return }
    const codigo = ((form.codigoAuto ? gerarCodigoPosto(form.filial_id, form.matricula) : form.codigo) || '').trim()
    if (!codigo) { setErro('Código não gerado — confira a filial.'); return }
    const empCod = empresas.find(e => e.id === form.empresa_id)?.codigo || ''
    const afastOn = !!(form.afast_ini_ano && form.afast_ini_mes)
    const payload: any = {
      tenant_id: TENANT_ID, codigo,
      nome: (form.nome || '').trim() || null, matricula: (form.matricula || '').trim() || null,
      cargo_id: form.cargo_id || null, empresa_id: form.empresa_id, filial_id: form.filial_id || null, cc_id: form.cc_id || null,
      sindicato_id: form.sindicato_id || sindByCod[sindCodPorEmp(empCod)] || null,
      regime: form.regime || null, salario_base: parseNum(form.salario_base) || 0, fte: parseNum(form.fte) || 1,
      // Três estados, e o vazio NÃO é falso: vazio = segue a função do
      // apontamento, que é o padrão da esmagadora maioria. Gravar `false` aí
      // viraria exceção explícita "só aponta" em todo mundo.
      recebe_hora: form.recebe_hora === '' ? null : form.recebe_hora === 'sim',
      ini_ano: form.ini_ano ? parseInt(form.ini_ano, 10) : null, ini_mes: form.ini_mes ? parseInt(form.ini_mes, 10) : null,
      fim_ano: form.fim_ano ? parseInt(form.fim_ano, 10) : null, fim_mes: form.fim_mes ? parseInt(form.fim_mes, 10) : null,
      // o CHECK da v3_116 exige mês quando há pct OU valor, e os dois são
      // alternativos — limpar o par inteiro quando não há mês evita gravar um
      // reajuste sem data, que o motor ignoraria em silêncio
      reajuste_mes: form.reajuste_mes ? parseInt(form.reajuste_mes, 10) : null,
      reajuste_pct: form.reajuste_mes && form.reajuste_pct && !form.reajuste_valor ? parseNum(form.reajuste_pct) : null,
      reajuste_valor: form.reajuste_mes && form.reajuste_valor ? parseNum(form.reajuste_valor) : null,
      // Afastamento: o CHECK da v3_117 exige ano E mês no início. Sem início não
      // há janela, e aí o fim e o motivo não querem dizer nada — por isso o
      // trio é limpo junto, como no reajuste.
      afast_ini_ano: afastOn ? parseInt(form.afast_ini_ano, 10) : null,
      afast_ini_mes: afastOn ? parseInt(form.afast_ini_mes, 10) : null,
      afast_fim_ano: afastOn && form.afast_fim_ano && form.afast_fim_mes ? parseInt(form.afast_fim_ano, 10) : null,
      afast_fim_mes: afastOn && form.afast_fim_ano && form.afast_fim_mes ? parseInt(form.afast_fim_mes, 10) : null,
      afast_motivo: afastOn ? ((form.afast_motivo || '').trim() || null) : null,
      admissao: (form.admissao || '').trim() || null,   // só a rescisão usa (tempo de casa)
      // ⚠⚠ `sit_folha` e `ativo` TÊM DE ANDAR JUNTOS. A grade decide a situação
      // por `situacaoPosto()`, que olha `sit_folha` primeiro; o Aplicar no
      // orçado filtra por `ativo !== false`. Gravar só um deixaria o posto
      // marcado DEMITIDO na tela e ainda custando no orçamento — ou o contrário.
      // Medido antes de mexer: hoje os dois são coerentes em 569 de 569
      // (D ⇔ ativo=false), porque a importação os escreve no mesmo lote.
      sit_folha: (form.sit_folha || '').trim() || null,
      ativo: (form.sit_folha || '').trim().toUpperCase() !== 'D',
    }
    const saved = form.id
      ? await supabase.from('posto').update(payload).eq('id', form.id).select('id').single()
      : await supabase.from('posto').insert(payload).select('id').single()
    if (saved.error) { setErro(saved.error.message); return }
    const postoId = saved.data?.id || form.id
    // sincroniza rateios anexados (posto_rateio)
    if (postoId) {
      await supabase.from('posto_rateio').delete().eq('posto_id', postoId)
      const vistos = new Set<string>()
      const rrows = (form.rateios || []).filter((r: any) => r.regra_id && !vistos.has(r.regra_id) && vistos.add(r.regra_id))
        .map((r: any) => ({ tenant_id: TENANT_ID, posto_id: postoId, regra_id: r.regra_id, ordem: r.ordem || 1 }))
      if (rrows.length) { const { error: rErr } = await supabase.from('posto_rateio').insert(rrows); if (rErr) { setErro('Aviso — rateio: ' + rErr.message) } }
    }
    setForm(null); loadPostos()
  }

  // edita o valor de uma verba (benefício) deste posto: >0 grava, 0/vazio remove
  const salvarBenef = async (postoId: string, verbaId: string, valor: number) => {
    if (valor > 0) {
      const { error } = await supabase.from('posto_verba').upsert({ tenant_id: TENANT_ID, posto_id: postoId, verba_id: verbaId, valor, ativo: true }, { onConflict: 'posto_id,verba_id' })
      if (error) { setErro(error.message); return }
      setPostoVerbas(pv => ({ ...pv, [postoId]: { ...(pv[postoId] || {}), [verbaId]: valor } }))
    } else {
      const { error } = await supabase.from('posto_verba').delete().eq('posto_id', postoId).eq('verba_id', verbaId)
      if (error) { setErro(error.message); return }
      setPostoVerbas(pv => { const p = { ...(pv[postoId] || {}) }; delete p[verbaId]; return { ...pv, [postoId]: p } })
    }
  }

  // filtro compartilhado (empresa/filial/CC/área/divisão/BU) cruzado com o escopo de dados do usuário (F2)
  const regimesUsados = useMemo(
    () => [...new Set(postosEf.map(p => p.regime).filter(Boolean) as string[])]
            .sort((a, b) => (REGIMES_LABEL[a] || a).localeCompare(REGIMES_LABEL[b] || b, 'pt-BR')),
    [postosEf])

  const filtrados = useMemo(() => {
    const empF = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSeePessoas)
    const filF = escopoFiltro((filialSel.length && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSeePessoas)
    const ccF = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSeePessoas)
    const sEmp = empF ? new Set(empF) : null, sFil = filF ? new Set(filF) : null, sCc = ccF ? new Set(ccF) : null
    const q = busca.trim().toLowerCase()
    const match = (p: Posto) => !q || [p.nome, p.matricula, p.cargo?.nome, p.codigo, p.centro_custo?.descricao, p.centro_custo?.codigo]
      .some(x => (x || '').toString().toLowerCase().includes(q))
    return postosEf.filter(p =>
      (!semSal || Number(p.salario_base) > 0) &&
      (!soAlteradas || alterados.has(p.id)) &&
      sits.includes(situacaoPosto(p)) &&
      (!sEmp || sEmp.has(p.empresa_id)) &&
      (!sFil || (p.filial_id != null && sFil.has(p.filial_id))) &&
      (!sCc || (p.cc_id != null && sCc.has(p.cc_id))) &&
      (!regimeSel || p.regime === regimeSel) && match(p)
    )
  }, [postosEf, semSal, soAlteradas, alterados, sits, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, regimeSel, busca, empresas, filiais, ccs, acesso.loading]) // eslint-disable-line

  // ⚠ O contador conta o que ESTE filtro esconde, não "todo posto com salário
  // zero": aplica os demais recortes da tela e só então tira o salário da
  // conta. Um número que ignorasse empresa/CC/situação diria "10 ocultos" numa
  // tela filtrada que esconde dois — e aí o aviso vira ruído.
  const ocultosSemSal = useMemo(() => {
    if (!semSal) return 0
    const vis = new Set(filtrados.map((p: any) => p.id))
    return postosEf.filter(p =>
      !vis.has(p.id) && !(Number(p.salario_base) > 0) &&
      sits.includes(situacaoPosto(p)) &&
      (!soAlteradas || alterados.has(p.id))).length
  }, [semSal, filtrados, postosEf, sits, soAlteradas, alterados])

  // ⚠⚠ O RECORTE PARA O COMPARATIVO SAI DOS POSTOS-MESTRE, não de `filtrados`.
  // `filtrados` deriva de `postosEf`, que no modo cenário já vem RESOLVIDO pelo
  // overlay — passar aquilo ao comparativo faria `camposAlterados(m, ov)`
  // comparar o resolvido com o próprio overlay e não achar diferença nenhuma:
  // a lista viria VAZIA, como se a área não tivesse proposto nada.
  const postosDoRecorte = useMemo(() => {
    const ids = new Set(filtrados.map((p: any) => p.id))
    return postos.filter(p => ids.has(p.id))
  }, [postos, filtrados])


  // ── motor: custo por posto (com encargos/provisões/benefícios) ──
  const anoCalc = useMemo(() => {
    const m = (versoes.find(v => v.id === versaoSel)?.codigo || '').match(/(20\d{2})/)
    return m ? parseInt(m[1], 10) : new Date().getFullYear()
  }, [versoes, versaoSel])
  const temMotor = verbas.length > 0
  const empPais = useMemo(() => new Map((empresas as any[]).map(e => [e.id, e.pais ?? null])), [empresas])
  const custos = useMemo(() => {
    const map = new Map<string, ResultadoPosto>()
    if (!temMotor) return map
    for (const p of postosEf) map.set(p.id, calcularPosto({ ...(p as any), pais: empPais.get(p.empresa_id) ?? null }, verbas, {
      dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
      mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
      ano: anoCalc,
      valoresFixos: postoVerbas[p.id] || {},
    }))
    return map
  }, [postosEf, verbas, dissidio, sindMesBase, anoCalc, temMotor, postoVerbas, empPais])
  // Custo do quadro MESTRE, só no modo cenário: é o que dá o "quanto este
  // cenário muda" sem sair da tela. O EBITDA inteiro continua no relatório —
  // aqui é só a folha.
  const custoBaseAno = useMemo(() => {
    if (!modoCenario || !temMotor) return null
    let t = 0
    for (const p of postos) {
      if (p.ativo === false) continue
      t += calcularPosto({ ...(p as any), pais: empPais.get(p.empresa_id) ?? null }, verbas, {
        dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
        mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
        ano: anoCalc, valoresFixos: postoVerbas[p.id] || {},
      }).totalAno
    }
    return t
  }, [modoCenario, postos, verbas, dissidio, sindMesBase, anoCalc, temMotor, postoVerbas, empPais])

  const custoAnoP = (p: Posto) => custos.get(p.id)?.totalAno ?? (Number(p.salario_base) || 0) * (Number(p.fte) || 1) * 12
  const custoMesP = (p: Posto) => custos.get(p.id)?.totalMes ?? (Number(p.salario_base) || 0) * (Number(p.fte) || 1)
  const empById = useMemo(() => new Map(empresas.map((e: any) => [e.id, e])), [empresas])
  const ccById = useMemo(() => new Map(ccs.map((c: any) => [c.id, c])), [ccs])
  // código automático do posto: {filial}-{matrícula} ou, sem matrícula (vaga), {filial}-VG{seq}
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const proxVagaSeq = (filialCod: string) => {
    const re = new RegExp(`^${escapeRe(filialCod)}-VG(\\d+)$`, 'i')
    let max = 0
    for (const p of postos) { const m = (p.codigo || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
    return max + 1
  }
  const gerarCodigoPosto = (filial_id: string, matricula: string) => {
    const fc = filiais.find((f: any) => f.id === filial_id)?.codigo
    if (!fc) return ''
    const mat = (matricula || '').trim()
    return mat ? `${fc}-${mat}` : `${fc}-VG${String(proxVagaSeq(fc)).padStart(2, '0')}`
  }

  // ⚠⚠ COLUNA QUE SAI DA TABELA TEM DE SAIR DA ORDENAÇÃO SALVA. A ordem fica em
  // localStorage por usuário: quem tinha ordenado por FTE, quando a coluna saiu
  // da lista (nov/2026), continuaria com as linhas ordenadas por um critério
  // invisível — sem cabeçalho para clicar, sem como desfazer, e parecendo ordem
  // aleatória. Ao tirar ou renomear coluna, acrescente aqui.
  const COLS_FORA = new Set(['fte'])
  const colOrdem = ordem.col && !COLS_FORA.has(ordem.col) ? ordem.col : null

  // agrupa por centro de custo OU cargo (seletor)
  // Colunas de dinheiro começam em DECRESCENTE: quem clica em salário quer ver
  // o maior, não o menor. Texto começa em crescente, que é como se lê lista.
  const NUM = new Set(['salario', 'fte', 'custoMes', 'custoAno', 'vigencia', 'rateio'])
  // ⚠ Cada coluna ordena pelo MESMO valor que a célula mostra. Ordenar por um
  // campo e exibir outro faz a ordem parecer aleatória — e quem vê não tem como
  // descobrir por quê.
  const valorDe = (p: Posto, col: string): string | number => {
    switch (col) {
      case 'posto':    return p.codigo || ''
      case 'empfil':   return `${p.empresa?.codigo || ''}·${p.filial?.codigo || ''}·${p.centro_custo?.codigo || ''}`
      case 'cargo':    return nomeCargo(p.cargo_id)
      case 'ocupante': return p.nome || ''   // vaga (sem nome) vai para uma ponta, junta
      case 'modelo':   return REGIMES_LABEL[p.regime || ''] || p.regime || ''
      case 'salario':  return Number(p.salario_base) || 0
      case 'fte':      return Number(p.fte) || 1
      case 'vigencia': {
        // Replica `vig()` em número — ela só é definida mais abaixo, e chamá-la
        // daqui estouraria em TDZ. Ordena pelo mês de início e desempata pelo fim.
        const ini = (p.ini_ano == null || p.ini_ano < anoCalc) ? 1 : (p.ini_ano === anoCalc ? (p.ini_mes || 1) : 13)
        const fim = (p.fim_ano == null || p.fim_ano > anoCalc) ? 12 : (p.fim_ano === anoCalc ? (p.fim_mes || 12) : 0)
        return ini * 100 + fim
      }
      case 'rateio':   return (postoRateios[p.id] || []).length
      case 'custoMes': return custoMesP(p)
      case 'custoAno': return custoAnoP(p)
      default:         return ''
    }
  }
  const clicarCol = (col: string) => setOrdem(o =>
    o.col !== col ? { col, dir: NUM.has(col) ? 'desc' : 'asc' }
    : o.dir === (NUM.has(col) ? 'desc' : 'asc') ? { col, dir: NUM.has(col) ? 'asc' : 'desc' }
    : { col: null, dir: 'asc' })

  const Th = ({ col, children, dir: align }: { col?: string; children?: any; dir?: 'right' }) => {
    // Sem salário visível, ordenar por dinheiro é ordenar por zeros — a coluna
    // deixa de ser clicável em vez de responder com uma ordem que não é ordem.
    const ativo = col && colOrdem === col
    const podeClicar = !!col && !(semFolha && NUM.has(col) && col !== 'fte')
    return (
      <th style={{ ...S.th, ...(align === 'right' ? { textAlign: 'right' } : {}),
                   ...(podeClicar ? { cursor: 'pointer', userSelect: 'none' } : {}),
                   ...(ativo ? { color: 'var(--violet)' } : {}) }}
          onClick={podeClicar ? () => clicarCol(col!) : undefined}
          title={podeClicar ? (agruparPor === 'nenhum' ? 'Ordenar todos os postos' : 'Ordenar dentro de cada grupo') : undefined}>
        {children}{ativo && <span style={{ marginLeft: 4 }}>{ordem.dir === 'asc' ? '▲' : '▼'}</span>}
      </th>
    )
  }

  const grupos = useMemo(() => {
    const porCc = agruparPor === 'cc'
    const custo = (ps: Posto[]) => ps.reduce((s, p) => s + custoAnoP(p), 0)
    const sinal0 = ordem.dir === 'asc' ? 1 : -1
    // Sem agrupamento: UM grupo com tudo, para a ordenação valer sobre a
    // empresa inteira. Mantém o mesmo formato dos outros para o render não
    // precisar de um segundo caminho.
    if (agruparPor === 'nenhum') {
      const todos = colOrdem
        ? [...filtrados].sort((a, b) => {
            const x = valorDe(a, colOrdem!), y = valorDe(b, colOrdem!)
            return sinal0 * (typeof x === 'number' && typeof y === 'number'
              ? x - y : String(x).localeCompare(String(y), 'pt-BR'))
          })
        : filtrados
      return [{ key: '__todos', cod: '', desc: 'Todos os postos', postos: todos, custoAno: custo(todos) }]
    }
    const m = new Map<string, { key: string; cod: string; desc: string; postos: Posto[] }>()
    for (const p of filtrados) {
      const k = (porCc ? p.cc_id : p.cargo_id) || '__sem'
      if (!m.has(k)) m.set(k, {
        key: k, cod: porCc ? (p.centro_custo?.codigo || '') : '',
        desc: (porCc ? p.centro_custo?.descricao : nomeCargo(p.cargo_id)) || (porCc ? 'Sem centro de custo' : 'Sem cargo'),
        postos: [],
      })
      m.get(k)!.postos.push(p)
    }
    // A ordem dos GRUPOS não muda — ordenar o conteúdo não é reordenar a
    // estrutura. Só os postos de dentro de cada um se movem.
    const sinal = ordem.dir === 'asc' ? 1 : -1
    const ordenados = [...m.values()].map(g => ({
      ...g,
      custoAno: custo(g.postos),
      postos: colOrdem
        ? [...g.postos].sort((a, b) => {
            const x = valorDe(a, colOrdem!), y = valorDe(b, colOrdem!)
            return sinal * (typeof x === 'number' && typeof y === 'number'
              ? x - y
              : String(x).localeCompare(String(y), 'pt-BR'))
          })
        : g.postos,
    }))
    return ordenados.sort((a, b) => (a.cod || a.desc || 'zzz').localeCompare(b.cod || b.desc || 'zzz'))
  }, [filtrados, agruparPor, custos, ordem]) // eslint-disable-line
  const toggle = (k: string) => setFechados(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const gruposKeys = useMemo(() => grupos.map(g => 'a:' + g.key), [grupos])
  const algumAberto = gruposKeys.some(k => !fechados.has(k))
  const toggleTodos = () => setFechados(algumAberto ? new Set(gruposKeys) : new Set())

  const tot = useMemo(() => {
    const head = filtrados.length, vagas = filtrados.filter(p => !p.nome).length
    // Headcount ≠ postos: a mesma pessoa pode ter mais de um posto (sócio com
    // prestação de serviço E pró-labore, por exemplo). Para CUSTO os dois contam,
    // são pagamentos reais; para QUADRO, não — "45 pessoas" seria falso se
    // algumas aparecem duas vezes. Conta por matrícula; sem matrícula (vaga
    // planejada ou cadastro incompleto) cada posto é um, que é o mais seguro.
    const pessoas = new Set(filtrados.map(pessoaChave)).size
    const fte = filtrados.reduce((s, p) => s + (Number(p.fte) || 0), 0)
    const ano = filtrados.reduce((s, p) => s + custoAnoP(p), 0)
    const cat = Object.fromEntries(CATEGORIAS.map(c => [c, 0])) as Record<string, number>
    for (const p of filtrados) { const r = custos.get(p.id); if (r) for (const k in r.porCategoria) cat[k] += (r.porCategoria as any)[k] }
    // Rescisão é EVENTO, não custo corrente: entra no custo anual (é desembolso
    // do ano) mas sai do custo médio/FTE, que responde "quanto custa manter uma
    // pessoa por mês" — somá-la ali inflaria o unitário de todo o quadro.
    const resc = filtrados.reduce((s, p) => s + (custos.get(p.id)?.rescisaoAno || 0), 0)
    const saindo = filtrados.filter(p => (custos.get(p.id)?.rescisaoAno || 0) > 0).length
    return { head, vagas, pessoas, fte, ano, cat, resc, saindo, medioFte: fte ? ((ano - resc) / 12) / fte : 0 }
  }, [filtrados, custos]) // eslint-disable-line

  // janela de vigência DENTRO do ano da versão (bate com o motor)
  const vig = (p: Posto) => {
    const iniM = (p.ini_ano == null || p.ini_ano < anoCalc) ? 1 : (p.ini_ano === anoCalc ? (p.ini_mes || 1) : 13)
    const fimM = (p.fim_ano == null || p.fim_ano > anoCalc) ? 12 : (p.fim_ano === anoCalc ? (p.fim_mes || 12) : 0)
    if (iniM > 12 || fimM < 1 || iniM > fimM) return { txt: 'fora do ano', alerta: true }
    return { txt: `${MESES[iniM - 1]}–${MESES[fimM - 1]}`, alerta: iniM > 1 || fimM < 12 }
  }

  // janela de afastamento recortada no ano da versão (bate com afastadoNoMes do motor)
  const afast = (p: Posto) => {
    if (!p.afast_ini_ano) return null
    const ini = p.afast_ini_ano > anoCalc ? 13 : (p.afast_ini_ano === anoCalc ? (p.afast_ini_mes || 1) : 1)
    const fim = p.afast_fim_ano == null ? 12
      : (p.afast_fim_ano < anoCalc ? 0 : (p.afast_fim_ano === anoCalc ? (p.afast_fim_mes || 12) : 12))
    if (ini > 12 || fim < 1 || ini > fim) return null   // afastamento fora do ano orçado
    return { ini, fim, txt: `${MESES[ini - 1]}–${MESES[fim - 1]}`, aberto: p.afast_fim_ano == null }
  }

  const linhaPosto = (p: Posto) => {
    const custoMes = custoMesP(p), custoAno = custoAnoP(p)
    // CUSTO/MÊS é o mês REPRESENTATIVO (o último vigente), não a média: ele
    // responde "quanto essa pessoa custa daqui em diante". Quando há reajuste no
    // meio do ano, custoMes × 12 ≠ custoAno — e sem avisar isso parece erro de
    // conta. O motor já guarda a base do último mês; aqui só marcamos a linha.
    const rc = custos.get(p.id)
    const mesesVig = rc?.mesesVigentes ?? 12
    const mesesAfast = rc?.mesesAfastado ?? 0
    const rescAno = rc?.rescisaoAno || 0
    // Afastamento parcial e rescisão fazem o custo mudar no meio do ano igual ao
    // reajuste, e pelo mesmo motivo merecem o asterisco. Afastada o ano todo não
    // entra: aí custoMes × meses volta a bater com o anual.
    // ⚠ PLR entra na mesma família, e sem ela o asterisco NÃO apareceria: a
    // condição exige uma das três causas, e PLR não é nenhuma delas. O
    // custo/mês mostra o último mês vigente — dezembro, que não tem parcela —,
    // então `custo/mês × 12` fica abaixo do anual e parece erro de conta. Quem
    // tem verba de PARCELAS com valor é justamente quem precisa do aviso.
    const temParcela = verbas.some(v => v.tipo_calculo === 'PARCELAS' && !!(postoVerbas[p.id] || {})[v.id])
    const mudaNoAno = !!custoMes && (!!p.reajuste_mes || mesesAfast > 0 || rescAno > 0 || temParcela)
      && Math.abs(custoMes * mesesVig - custoAno) > 0.01
    const fa = afast(p)
    const v = vig(p)
    // No modo cenário `p` já é o posto RESOLVIDO; o mestre serve para dizer, no
    // title, de onde a célula saiu. Decisão em violeta, herdado normal — mesma
    // convenção da premissa global do formulário.
    const alt = alterados.get(p.id)
    const mestre = mestreById.get(p.id)
    const mud = (c: CampoCenario) => !!alt?.includes(c)
    const cel = (c: CampoCenario): CSSProperties | undefined =>
      mud(c) ? { color: 'var(--violet)', fontWeight: 700 } : undefined
    const titCen = (c: CampoCenario, fmt: (x: any) => string = String) =>
      mud(c) ? `Decisão deste cenário. No cadastro: ${(mestre as any)?.[c] == null ? '—' : fmt((mestre as any)[c])}` : undefined
    return (
      <tr key={p.id} style={p.ativo === false ? { opacity: 0.55 } : undefined}>
        {/* A grade mostra a PROPOSTA; o Aplicar grava só o aprovado. A divergência
            é deliberada (aqui se trabalha, lá se compromete), mas precisa ser
            visível: sem a marca, a linha exibiria um número que não vai virar
            orçamento e nada diria isso. */}
        <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--muted)' }}>{p.codigo}
          {modoCenario && (overlays.get(p.id) as any)?.aprovado === false && (
            <span title="Decisão recusada — este posto entra no orçado com o valor do CADASTRO, não com o que está na tela."
              style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
                color: 'var(--red)', border: '1px solid rgba(248,113,113,0.45)', background: 'rgba(248,113,113,0.12)' }}>
              RECUSADA</span>
          )}
          {p.ativo === false && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5,
            color: mud('ativo') ? 'var(--violet)' : 'var(--red)',
            border: '1px solid ' + (mud('ativo') ? 'var(--violet)55' : 'var(--red)55'),
            background: mud('ativo') ? 'rgba(139,92,246,0.14)' : 'rgba(248,113,113,0.12)' }}
            title={mud('ativo') ? 'Cortado por decisão deste cenário — no cadastro continua ativo' : undefined}>
            {mud('ativo') ? 'CORTADO' : 'DEMITIDO'}</span>}</td>
        <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}
          title={`${p.empresa?.codigo || '?'} · ${p.filial?.codigo || '?'} · ${p.centro_custo?.codigo || '?'} ${p.centro_custo?.descricao || ''}`}>
          {p.empresa?.codigo || '—'}·{p.filial?.codigo || '—'}·{p.centro_custo?.codigo || '—'}</td>
        <td style={S.td}>{p.nome
          ? <span style={T.ocup}>{nomeCurto(p.nome)}</span>
          : <span style={T.vaga}>VAGA{p.ini_mes ? ` · ${MESES[p.ini_mes - 1]}/${String(p.ini_ano || '').slice(2)}` : ''}</span>}
          {fa && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 5, color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.14)' }}
            title={`Afastado ${fa.txt}${fa.aberto ? ' (sem previsão de retorno)' : ''}${p.afast_motivo ? ` — ${p.afast_motivo}` : ''}. Nesses meses o orçamento não leva salário, INSS, FGTS nem provisões; só os benefícios marcados como devidos no afastamento.`}>
            AFASTADO {fa.txt}</span>}</td>
        <td style={S.td}>{p.regime ? <span style={tagRegime(p.regime)}>{REGIMES_LABEL[p.regime] || p.regime}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>

        {/* ⚠ CARGO DEPOIS DO OCUPANTE, e menor. A pessoa é o assunto da linha —
            quem lê procura "quanto custa o Fulano", não "quanto custa o
            ESPECIALISTA DE DESENVOLVIMENTO". Com o cargo em caixa alta logo
            após o CC, ele puxava o olho antes do nome e todas as linhas
            pareciam iguais. Fica como qualificação do salário, que é o número
            ao lado dele.
            Continua truncando com reticência: nomes como COORDENADOR
            ADMINISTRATIVO DE GENTE empurravam o salário para fora da tela. A
            ORDENAÇÃO usa o valor completo, não o truncado — ordenar pelo que foi
            cortado mudaria a ordem conforme a largura da janela. */}
        <td style={{ ...S.td, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                     fontSize: 11.5, color: 'var(--muted)', ...cel('cargo_id' as CampoCenario) }}
            title={titCen('cargo_id' as CampoCenario, (x: any) => nomeCargo(x) || '—') || nomeCargo(p.cargo_id) || undefined}>
          {nomeCargo(p.cargo_id) || '—'}</td>
        {/* ⚠ SÓ LEITURA. Salário e FTE tinham caixa de edição na própria grade,
            e eram os dois únicos campos assim — editar posto acontecia em dois
            lugares com regras diferentes (aqui, campo a campo e sem validação;
            no formulário, o registro inteiro). Um caminho só, no lápis da
            linha: no cadastro abre o formulário do posto, no cenário abre o de
            decisões. A cor da célula continua marcando o que o cenário decidiu
            e o title continua dizendo de onde o valor veio. */}
        <td style={{ ...S.td, textAlign: 'right', ...cel('salario_base') }} title={titCen('salario_base', x => money(Number(x)))}>
          {semFolha ? oculto : money(Number(p.salario_base) || 0)}{!p.nome && !semFolha && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>(ref.)</span>}
        </td>
        {/* A saída já aparecia aqui ("jan–mai"); o que faltava era dizer quanto
            ela custa. O ✂ marca a demissão e o título abre a estimativa. */}
        <td style={{ ...S.td, fontWeight: (mud('fim_ano') || mud('fim_mes') || mud('ini_ano') || mud('ini_mes')) ? 700 : undefined,
          color: (mud('fim_ano') || mud('fim_mes') || mud('ini_ano') || mud('ini_mes')) ? 'var(--violet)' : (v.alerta ? 'var(--orange)' : 'var(--muted)') }}
          title={rescAno ? `Sai em ${MESES_NUM[(rc?.mesFimVigencia || 1) - 1]}/${anoCalc} · rescisão estimada ${money(rescAno)} (${(rescAno / Math.max(1, Number(p.salario_base) || 1)).toFixed(1)} salários). Clique no custo/mês para a memória.` : undefined}>
          {v.txt}{rescAno > 0 && <span style={{ color: 'var(--red)', marginLeft: 4, fontWeight: 700 }}>✂</span>}</td>
        <td style={S.td}>{(() => {
          const rr = postoRateios[p.id] || []
          if (!rr.length) return <span style={{ color: 'var(--muted)' }}>—</span>
          const nomes = rr.map(x => rateioCods.find(c => c.id === x.regra_id)?.nome || '?').join(' → ')
          return <button title={`${nomes} — clique para ver a memória`} onClick={() => setRateModal(p)} style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.14)' }}>{rr.length} cód.</button>
        })()}</td>
        <td style={{ ...S.td, textAlign: 'right', cursor: 'pointer' }} onClick={() => setDrill(p)}
          title={mudaNoAno
            ? `Custo recorrente do último mês vigente (${[p.reajuste_mes ? `reajuste em ${MESES_NUM[p.reajuste_mes - 1]}` : '', mesesAfast ? `${mesesAfast} ${mesesAfast > 1 ? 'meses' : 'mês'} de afastamento` : '', rescAno ? `rescisão de ${money(rescAno)} em ${MESES_NUM[(rc?.mesFimVigencia || 1) - 1]}, fora desta coluna` : ''].filter(Boolean).join('; ')}). O anual de ${money(custoAno)} soma mês a mês. Clique para a memória.`
            : 'Ver memória de cálculo'}>
          {semFolha ? oculto : money(custoMes)}
          {mudaNoAno && <span style={{ color: 'var(--orange)', marginLeft: 3 }}>*</span>}
        </td>
        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, cursor: 'pointer' }} title="Ver memória de cálculo" onClick={() => setDrill(p)}>{money(custoAno)}</td>
        <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{editavel && (modoCenario ? <>
          <button style={{ ...S.del, color: alt ? 'var(--violet)' : undefined }} title="Decisões deste cenário para este posto"
            onClick={() => setCenForm({ posto: mestre as Posto, ov: overlays.get(p.id) || null })}><Pencil size={14} /></button>
          {alt && <button style={S.del} title="Voltar a herdar do cadastro (desfaz as decisões deste cenário)"
            onClick={() => { if (confirm(`Desfazer as decisões do cenário para ${p.nome || p.codigo}?`)) limparCenario(p.id) }}><Undo2 size={15} /></button>}
        </> : <>
          <button style={S.del} title="Editar posto" onClick={() => editarPosto(p)}><Pencil size={14} /></button>
          <button style={S.del} title="Excluir" onClick={() => excluir(p.id, p.codigo)}><Trash2 size={15} /></button>
        </>)}</td>
      </tr>
    )
  }

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Posto de Trabalho</h1>
          <p style={S.sub}>Quadro de pessoal orçado por posto — funcionários nominais + vagas planejadas. O custo com encargos/provisões e o rateio são calculados no <b>Aplicar</b> (motor).</p>
        </div>
        <PostosPills />
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Versão</span>
          <select style={S.sel} value={versaoSel} onChange={e => setVersaoSel(e.target.value)} title="Versão do orçamento — define o dissídio aplicado ao custo">
            {!versoesVisiveis.length && <option value="">—</option>}
            {versoesVisiveis.map((v: any) => <option key={v.id} value={v.id}>{v.codigo}{v.bloqueada ? ' 🔒' : ''}</option>)}
          </select>
        </div>
        {/* Cadastro × Cenário. Explícito de propósito: no modo Cadastro você
            corrige a REALIDADE (vale em todas as versões); no Cenário você
            decide hipóteses (valem só nesta). Misturar os dois faria uma
            correção de salário virar decisão de cenário sem ninguém notar. */}
        <div style={S.fld}><span style={S.lbl}>Editando</span>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
            {([[false, 'Cadastro', podeCadastro ? 'O quadro real, válido em todas as versões' : 'Só leitura: o cadastro vem do ERP. Decida no cenário.'],
               [true, 'Cenário', 'Decisões desta versão (demitir, adiar, promover) — o cadastro não muda']] as const).map(([v, lbl, tit]) => (
              <button key={String(v)} title={tit} onClick={() => { setModoCenario(v); if (!v) setSoAlteradas(false) }}
                style={{ padding: '7px 11px', fontSize: 12.5, fontWeight: modoCenario === v ? 700 : 500, cursor: 'pointer', border: 'none',
                  background: modoCenario === v ? (v ? 'rgba(139,92,246,0.18)' : 'var(--panel-2)') : 'transparent',
                  color: modoCenario === v ? (v ? 'var(--violet)' : 'var(--text)') : 'var(--muted)' }}>{lbl}</button>
            ))}
          </div>
        </div>
        {/* Vínculo sem salário é quase sempre duplicata do mesmo CPF noutra
            empresa, ou cadastro de ERP que não custa nada — e eles poluem a
            leitura de quem procura custo. ⚠ MAS NÃO É SEMPRE: salário zerado
            também é dado FALTANDO (foi assim que apareceu um prestador
            lançado como CLT, que recebia pela folha e custava zero no
            orçamento). Por isso o contador ao lado: o que é escondido continua
            dizendo que existe. Mesma convenção do "Orçar por natureza". */}
        <div style={S.fld}><span style={S.lbl}>Sem salário</span>
          <button onClick={() => setSemSal(x => !x)}
            title="Oculta os postos com salário zerado — duplicatas do mesmo CPF e cadastros que não custam. O contador ao lado diz quantos ficaram de fora; salário zerado também pode ser dado faltando."
            style={{ ...S.sel, cursor: 'pointer', fontWeight: semSal ? 700 : 500, width: 'auto',
              color: semSal ? 'var(--violet)' : 'var(--text)',
              borderColor: semSal ? 'var(--violet)' : 'var(--border)' }}>
            {semSal ? '✓ ' : ''}ocultar zerados{semSal && ocultosSemSal ? ` (${ocultosSemSal})` : ''}
          </button>
        </div>
        {modoCenario && <div style={S.fld}><span style={S.lbl}>Decisões</span>
          <button onClick={() => setSoAlteradas(x => !x)}
            title="Mostra só os postos que ESTE cenário muda — é o diff que se apresenta junto com o EBITDA"
            style={{ ...S.sel, cursor: 'pointer', fontWeight: soAlteradas ? 700 : 500, width: 'auto',
              color: soAlteradas ? 'var(--violet)' : 'var(--text)',
              borderColor: soAlteradas ? 'var(--violet)' : 'var(--border)' }}>
            {soAlteradas ? '✓ ' : ''}só as alteradas ({alterados.size})
          </button>
        </div>}
        {/* Junto do filtro de decisões, não do Aplicar: os dois falam do que o
            cenário decide — um recorta na grade, o outro abre o comparativo.
            Ao lado do Aplicar parecia etapa de aplicação, e não é: é leitura. */}
        {modoCenario && alterados.size > 0 && (
          <div style={S.fld}><span style={S.lbl}>&nbsp;</span>
            {/* Nasceu "Comparar com o cadastro", quando só comparava. Virou o
                lugar onde se aprova, recusa, justifica e reenvia — o nome tinha
                de acompanhar, senão esconde a função principal da tela. */}
            <button onClick={() => setVerDiff(true)}
              title="Revisar e aprovar as decisões deste cenário, posto a posto, comparadas com o cadastro do ERP"
              style={{ ...S.sel, cursor: 'pointer', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ClipboardCheck size={13} /> Aprovação do cenário
            </button>
          </div>
        )}
        <div style={S.fld}><span style={S.lbl}>Buscar</span>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
            <input style={{ ...S.sel, paddingLeft: 28, width: 210 }} placeholder="nome, matrícula, cargo…" value={busca} onChange={e => setBusca(e.target.value)} />
            {busca && <X size={14} style={{ position: 'absolute', right: 8, top: 9, color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setBusca('')} />}
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Filtros</span>
          <FiltrosButton
            empresas={acesso.filterPessoas('empresa', empresas)} filiais={acesso.filterPessoas('filial', filiais)} ccs={acesso.filterPessoas('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        </div>
        <div style={S.fld}><span style={S.lbl}>Agrupar por</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select style={S.sel} value={agruparPor} onChange={e => setAgruparPor(e.target.value as any)}>
              <option value="cc">Centro de custo</option>
              <option value="cargo">Cargo</option>
              <option value="nenhum">Sem agrupamento</option>
            </select>
            <button style={{ ...S.sel, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-mid)' }} onClick={toggleTodos}
              title={algumAberto ? 'Recolher todos os grupos' : 'Expandir todos os grupos'}>
              {algumAberto ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{algumAberto ? 'Recolher' : 'Expandir'}
            </button>
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Modelo</span>
          {/* ⚠ As opções saem DO DADO, não de uma lista escrita à mão. Estavam
              fixas em CLT/PRESTADOR/PROLABORE enquanto `posto.regime` guarda
              `BR-CLT`, `BR-PRESTADOR`, `BR-PROLABORE` — o `===` nunca casava e
              o filtro esvaziava a tela em silêncio. Derivando do universo, o
              valor é sempre o que está no banco, e um regime novo (PY-IPS,
              PY-CONTRATO) aparece sozinho quando houver posto com ele. */}
          <select style={S.sel} value={regimeSel} onChange={e => setRegimeSel(e.target.value)}>
            <option value="">Todos</option>
            {regimesUsados.map(r => <option key={r} value={r}>{REGIMES_LABEL[r] || r}</option>)}
          </select>
        </div>
        <div style={S.fld}>
          <span style={S.lbl} title="Quem fica fora do headcount, do FTE e do custo.">Situação</span>
          <SeletorSituacao sel={sits} setSel={setSits} universo={postosEf} compacto />
        </div>
        <div style={{ flex: 1 }} />
        {podeCadastro && <button style={{ ...S.btn, opacity: modoCenario ? 0.45 : 1, cursor: modoCenario ? 'not-allowed' : 'pointer' }}
          title={modoCenario ? 'Posto novo entra no CADASTRO, não no cenário — vaga que existe só numa versão ainda não é suportada (P3). Troque para Cadastro.' : undefined}
          onClick={() => { if (modoCenario) { setErro('Posto novo entra no cadastro, não no cenário. Troque para "Cadastro" — vaga que existe só numa versão ainda não é suportada.'); return } novoPosto() }}><Plus size={14} /> Posto / vaga</button>}
        {podeAplicar && <button style={S.btnPri} disabled={aplicando || !versaoSel || !temMotor} onClick={() => setAplForm({ destino: versaoSel, comoAprovado: false })}
          title="Grava o custo do quadro ativo desta versão no orçado (origem POSTO), aplicando o rateio.">
          <Play size={13} /> {aplicando ? 'Aplicando…' : 'Aplicar no orçado'}</button>}
      </div>

      {podeImportar && (
        <div style={{ ...S.bar, margin: '0 0 16px' }}>
          <div style={S.fld}><span style={S.lbl}>Importar do RH</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as any)} title="Adicionar/atualizar: atualiza quem está no arquivo e não remove ninguém. Sincronizar com o arquivo: também REMOVE os postos do escopo que não estão nele (vagas sem matrícula ficam). Nos dois, o id do posto é preservado.">
                <option value="upsert">Adicionar/atualizar</option>
                <option value="substituir">Sincronizar com o arquivo</option>
              </select>
              <button style={S.btn} disabled={importando} onClick={() => fileRef.current?.click()}><Upload size={14} /> {importando ? 'Importando…' : 'Importar postos (RH)'}</button>
            </div>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {/* No modo cenário a tela inteira passa a falar de hipótese, e isso precisa
          ficar óbvio: a edição aqui NÃO muda o cadastro. */}
      {/* Grade travada sem explicação parece DEFEITO. Quem não pode editar o
          cadastro precisa saber que é permissão, por que existe (o dado é do
          ERP e a importação regrava), e para onde ir. */}
      {!modoCenario && !podeCadastro && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 12px', padding: '9px 12px', borderRadius: 8,
          border: '1px solid rgba(251,146,60,0.4)', background: 'rgba(251,146,60,0.10)', fontSize: 12.5, color: 'var(--text-mid)' }}>
          <b style={{ color: 'var(--orange)' }}>Cadastro em leitura</b>
          <span>este quadro vem do <b>ERP</b> e é regravado pela próxima importação do RH — editar aqui seria trabalho perdido.
            {podeCenario ? <> Suas decisões de corte e reajuste vão em <b>Cenário</b>.</> : null}</span>
        </div>
      )}
      {modoCenario && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 12px', padding: '9px 12px', borderRadius: 8,
          border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.10)', fontSize: 12.5, color: 'var(--text-mid)' }}>
          <b style={{ color: 'var(--violet)' }}>Cenário {versoes.find((v: any) => v.id === versaoSel)?.codigo || '—'}</b>
          <span>o que você editar vale <b>só nesta versão</b> — o cadastro não muda. {alterados.size
            ? <>Este cenário decide <b>{alterados.size} posto(s)</b>.</>
            : <>Nenhuma decisão ainda: tudo herdado do cadastro.</>}</span>
          <span style={{ flex: 1 }} />
          {/* O selo fica na faixa e não só no modal: quem abre a tela precisa
              saber se o que está vendo já passou por alguém. */}
          {vereditos.repr > 0 && (
            <span title="Decisões recusadas pelo aprovador — abra o comparativo para ver o motivo de cada uma."
              style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
                color: 'var(--red)', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)' }}>
              ✗ {vereditos.repr} reprovada(s)</span>
          )}
          {alterados.size > 0 && (
            aprovadoEm
              ? <span title={vAtual?.aprovacao_nota || undefined}
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
                    color: 'var(--green)', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)' }}>
                  ✓ aprovado {new Date(aprovadoEm).toLocaleDateString('pt-BR')}</span>
              : <span title="O Aplicar no orçado fica bloqueado até alguém aprovar."
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99,
                    color: 'var(--orange)', background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.35)' }}>
                  aguardando aprovação</span>
          )}
          <span style={{ color: 'var(--muted)' }}>O EBITDA do cenário sai no relatório, comparando as versões. Aqui é só a folha.</span>
        </div>
      )}

      {aplicarInfo && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div>Orçado aplicado na versão (ano {aplicarInfo.ano}): <b>{aplicarInfo.linhas.toLocaleString('pt-BR')} linhas</b> gravadas em <b>{aplicarInfo.postos} postos</b> e {aplicarInfo.contas} conta(s), origem POSTO.
            <div style={{ color: 'var(--muted)' }}>Substituiu o orçado POSTO anterior desta versão. Veja em Orçar / DRE (some com o manual/formulário na mesma célula).</div>
            {aplicarInfo.fundidas > 0 && <div style={{ color: 'var(--orange)' }}>⚠ {aplicarInfo.fundidas} lançamento(s) caíram na mesma célula e foram somados — pode indicar posto duplicado nos dados. Confira se há códigos de posto repetidos.</div>}
            {aplicarInfo.natEstranha.length > 0 && <div style={{ color: 'var(--orange)' }}>⚠ {aplicarInfo.natEstranha.length} conta(s) de destino não são de natureza DESPESA, então foram gravadas com sinal <b>positivo</b>: {aplicarInfo.natEstranha.join(', ')}. Confira a natureza em Cadastros → Estrutura — custo de folha deveria ser despesa.</div>}
            {aplicarInfo.semConta.length > 0 && <div style={{ color: 'var(--red)', fontWeight: 600 }}>⚠ {aplicarInfo.semConta.length} verba(s) com valor e <b>sem conta destino</b> — ficaram FORA do orçado (aparecem na grade, não na DRE): {aplicarInfo.semConta.join(', ')}. Amarre a conta em {passoLabel('/postos/regras')} e reaplique.</div>}
            {aplicarInfo.semTaxa > 0 && <div style={{ color: 'var(--red)', fontWeight: 600 }}>⚠ {aplicarInfo.semTaxa} linha(s) DESCARTADA(S) por falta de taxa orçada da moeda de origem (empresa em moeda estrangeira). Cadastre a taxa em Cadastros → Taxa orçada para esta versão e reaplique.</div>}
          </div>
        </div>
      )}
      {importInfo && (
        <div style={S.info}><CheckCircle2 size={16} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 1 }} />
          <div><b>{importInfo.gravados} postos</b> importados{importInfo.cargosNovos ? ` · ${importInfo.cargosNovos} cargos criados` : ''}{importInfo.modo === 'substituir' ? (importInfo.apagados ? ` · ${importInfo.apagados} removido(s) por não estarem no arquivo` : ' · nenhum removido') : ''}.
            <div style={{ color: importInfo.benefColunas ? 'var(--text-mid)' : 'var(--orange)' }}>{importInfo.benefColunas
              ? `${importInfo.beneficios} valores de benefício por posto (posto_verba) atualizados, em ${importInfo.benefColunas} verba(s) da folha.`
              : '⚠ Nenhuma coluna do arquivo casou com verba do catálogo — benefícios NÃO atualizados. Cadastre as verbas (D49, A76, D50, A15, A51…) em Estrutura → Verbas e reimporte.'}</div>
            {/* Dizer o que foi PRESERVADO, não só o que foi gravado: sem essa
                metade, "substituí 21" e "apaguei os outros" leem igual. Mesma
                razão da linha dos salários preservados. */}
            {importInfo.rateioCol && <div style={{ color: 'var(--text-mid)' }}>
              {importInfo.rateioPostos} posto(s) com rateio <b>substituído</b> pela coluna RATEIO.
              {importInfo.gravados - importInfo.rateioPostos > 0 && <> Nos outros {importInfo.gravados - importInfo.rateioPostos} a
              coluna veio vazia e o rateio atual foi <b>mantido</b> — inclusive o que foi reclassificado à mão.</>}
            </div>}
            {/* Quanto do quadro ainda fala a língua do catálogo aposentado. Sem
                esta linha, o número só aparece em Cadastros → Cargos, onde ninguém
                vai olhar depois de uma importação que disse "importados". */}
            {importInfo.cargoDesativado > 0 && <div style={{ color: 'var(--muted)' }}>
              {importInfo.cargoDesativado} posto(s) com <b>cargo só no catálogo desativado</b> — o nome do arquivo
              não existe entre os cargos ativos. O cargo atual foi <b>mantido</b>, nada foi ressuscitado;
              resolve quando o ERP mandar o código do cargo (<code>cargo_codigo</code>).</div>}
            {/* Dizer quantos ficaram sem salário no arquivo é o que diferencia
                "preservei" de "zerei" — sem a linha, as duas parecem iguais. */}
            {importInfo.semSalario > 0 && <div style={{ color: 'var(--muted)' }}>
              {importInfo.semSalario} posto(s) vieram <b>sem salário</b> no arquivo — o valor que já
              estava no cadastro foi <b>mantido</b>, não zerado.
            </div>}
            {importInfo.demitidos >= 0 && <div style={{ color: 'var(--text-mid)' }}>
              {importInfo.demitidos} posto(s) marcados como <b>demitidos</b> pela coluna <code>situacao</code> —
              saem do headcount, do FTE e do custo.
            </div>}
            {importInfo.comAreaFunc > 0 && <div style={{ color: 'var(--text-mid)' }}>
              {importInfo.comAreaFunc} posto(s) com <b>área funcional</b> atribuída pela coluna <code>area_funcional</code>.
            </div>}
            {importInfo.codsNaoAchados.length > 0 && <div style={{ color: 'var(--orange)' }}>
              Códigos de cargo não encontrados: <b>{importInfo.codsNaoAchados.slice(0, 8).join(', ')}</b>
              {importInfo.codsNaoAchados.length > 8 ? ` e mais ${importInfo.codsNaoAchados.length - 8}` : ''} — o cargo ficou pelo nome, se houver.
            </div>}
            {importInfo.areasNaoAchadas.length > 0 && <div style={{ color: 'var(--orange)' }}>
              Códigos de área funcional não encontrados: <b>{importInfo.areasNaoAchadas.join(', ')}</b> — cadastre em Cadastros → Áreas funcionais.
            </div>}
            {importInfo.salarioFora > 0 && <div style={{ color: 'var(--orange)' }}>
              {importInfo.salarioFora} posto(s) tinham salário no arquivo mas <b>não foram atualizados</b> —
              fora do seu escopo de edição ou sem posto correspondente.
            </div>}
            {importInfo.cargoAmbiguo > 0 && <div style={{ color: 'var(--orange)' }}>
              {importInfo.cargoAmbiguo} posto(s) ficaram <b>sem cargo</b>: o nome que veio no arquivo existe em mais de
              uma subárea (<i>ESPECIALISTA DE DESENVOLVIMENTO DE SOFTWARE I</i> existe em quatro) e o arquivo não traz
              o código do ERP para desempatar. Escolher por conta própria poria a pessoa numa subárea ao acaso —
              ajuste no cartão do posto, onde o seletor mostra a subárea ao lado do nome.
            </div>}
            {importInfo.afastados > 0 && <div style={{ color: 'var(--violet)' }}>{importInfo.afastados} posto(s) marcados como <b>afastados</b> pela coluna <code>afastado_desde</code>, <b>sem previsão de retorno</b> — assim o motor zera salário, encargos e provisões os 12 meses. Procure o chip AFASTADO na grade e informe o retorno de quem voltar.</div>}
            {importInfo.rateioNaoAchados.length > 0 && <div style={{ color: 'var(--orange)' }}>Códigos de rateio não encontrados (ignorados): {importInfo.rateioNaoAchados.join(', ')} — confira os nomes em {passoLabel('/postos/rateio')}.</div>}
            {importInfo.foraEscopo > 0 && <div style={{ color: 'var(--orange)' }}>{importInfo.foraEscopo} posto(s) fora do seu escopo de edição (empresa/filial/CC) — ignorados.</div>}
            {importInfo.semEmp.length > 0 && <div style={{ color: 'var(--red)' }}>⚠ Empresas não encontradas (postos ignorados): {importInfo.semEmp.join(', ')}</div>}
            {importInfo.semFil.length > 0 && <div style={{ color: 'var(--orange)' }}>Filiais não encontradas (posto sem filial): {importInfo.semFil.join(', ')}</div>}
            {importInfo.semCc.length > 0 && <div style={{ color: 'var(--orange)' }}>CCs não encontrados (posto sem CC): {importInfo.semCc.slice(0, 20).join(', ')}{importInfo.semCc.length > 20 ? '…' : ''}</div>}
          </div>
        </div>
      )}

      {(() => {
        const t = CATEGORIAS.reduce((s, c) => s + tot.cat[c], 0)
        const pct = (v: number) => t ? Math.round(v / t * 100) : 0
        const comp = temMotor && t
          ? `salários ${pct(tot.cat['Salário'])}% · encargos ${pct(tot.cat.Encargos + tot.cat['Provisões'])}% · benef ${pct(tot.cat['Benefícios'])}%${tot.cat['Rescisão'] ? ` · rescisão ${pct(tot.cat['Rescisão'])}%` : ''}`
          : 'sem motor — cadastre verbas em Estrutura'
        return (
          <>
          {/* ⚠ O AVISO FICA JUNTO DOS NÚMEROS, não só no botão do filtro. Quem
              confere o headcount olha o KPI, não a barra de filtros — e um
              total menor sem explicação manda a pessoa procurar defeito. */}
          {semSal && ocultosSemSal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-mid)', background: 'rgba(139,92,246,0.10)',
                          border: '1px solid rgba(139,92,246,0.35)', borderRadius: 8,
                          padding: '8px 12px', marginBottom: 12 }}>
              <b style={{ color: 'var(--violet)' }}>{ocultosSemSal} posto(s) ocultos</b> por salário zerado —
              não entram nos números acima. São duplicatas do mesmo CPF noutra empresa e cadastros
              que não custam, <b>mas salário zerado também é dado faltando</b>: desmarque "ocultar
              zerados" para conferir a lista.
            </div>
          )}
          <div style={S.kpis}>
            <div style={S.kpi}><div style={S.kpiL}>Postos</div><div style={S.kpiV}>{tot.head}</div><div style={S.kpiH}>{tot.vagas} vaga{tot.vagas === 1 ? '' : 's'} planejada{tot.vagas === 1 ? '' : 's'}</div></div>
            <div style={S.kpi}><div style={S.kpiL}>Headcount</div><div style={S.kpiV}>{tot.pessoas}</div>
              <div style={S.kpiH}>{tot.head > tot.pessoas ? `${tot.head - tot.pessoas} posto(s) a mais que pessoas` : 'uma pessoa por posto'}</div></div>
            <div style={S.kpi}><div style={S.kpiL}>FTE total</div><div style={S.kpiV}>{tot.fte.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div><div style={S.kpiH}>inclui ½ períodos</div></div>
            <div style={S.kpi}><div style={S.kpiL}>Custo anual {temMotor ? '(c/ encargos)' : '(base)'}</div><div style={S.kpiV}>{semFolha ? oculto : milAno(tot.ano)}</div>
              {/* Só com filtro limpo o delta é comparável: `tot.ano` respeita os
                  filtros da tela e o base é o quadro inteiro. */}
              {modoCenario && custoBaseAno != null && filtrados.length === postosEf.filter(x => sits.includes(situacaoPosto(x))).length
                ? <div style={{ ...S.kpiH, color: tot.ano < custoBaseAno ? 'var(--green)' : tot.ano > custoBaseAno ? 'var(--red)' : 'var(--muted)' }}>
                    {tot.ano === custoBaseAno ? 'igual ao cadastro' : `${tot.ano < custoBaseAno ? '−' : '+'}${milAno(Math.abs(tot.ano - custoBaseAno))} vs cadastro`}
                  </div>
                : <div style={S.kpiH}>{comp}</div>}
            </div>
            {/* só aparece quando há demissão no ano: o card vazio vira ruído */}
            {tot.resc > 0 && <div style={S.kpi}><div style={S.kpiL}>Rescisões</div><div style={{ ...S.kpiV, color: 'var(--red)' }}>{milAno(tot.resc)}</div>
              <div style={S.kpiH}>{tot.saindo} saída{tot.saindo === 1 ? '' : 's'} no ano · fora do custo médio</div></div>}
            <div style={S.kpi}><div style={S.kpiL}>Custo médio / FTE</div><div style={S.kpiV}>{semFolha ? oculto : <>R$ {money(tot.medioFte)}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--muted)' }}>/mês</span></>}</div><div style={S.kpiH}>{temMotor ? 'com encargos' : 'base'}</div></div>
          </div>
          </>
        )
      })()}

      <div style={S.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              <Th col="posto">Posto</Th><Th col="empfil">Empr·Fil·CC</Th><Th col="ocupante">Ocupante</Th><Th col="modelo">Modelo</Th><Th col="cargo">Cargo</Th>
              {/* ⚠ FTE saiu da LISTA, não do produto: ele é 1 em quase todo posto
                  (meio período é exceção), então gastava uma coluna para repetir
                  "1,0" linha após linha. Continua no formulário do posto, na
                  decisão do cenário e no KPI "FTE total" do topo — que é onde a
                  informação de fato importa, somada. */}
              <Th col="salario" dir="right">Salário</Th>
              <Th col="vigencia">Vigência</Th><Th col="rateio">Rateio</Th>
              <Th col="custoMes" dir="right">Custo/mês¹</Th><Th col="custoAno" dir="right">Custo ano</Th><th style={S.th} />
            </tr></thead>
            <tbody>
              {grupos.map(g => {
                const k1 = 'a:' + g.key, aberto = !!busca.trim() || !fechados.has(k1)
                return (
                  <Fragment key={g.key}>
                    <tr onClick={() => toggle(k1)}>
                      <td colSpan={nCols} style={S.gh}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1 }}>
                            {aberto ? <ChevronDown size={14} style={{ verticalAlign: -2 }} /> : <ChevronRight size={14} style={{ verticalAlign: -2 }} />}{' '}
                            {g.cod && <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{g.cod} · </span>}{g.desc}
                            <span style={{ color: 'var(--muted)', fontWeight: 400 }}> — {g.postos.length} posto{g.postos.length === 1 ? '' : 's'} · {milAno(g.custoAno)}/ano</span>
                          </span>
                          {editavel && g.key !== '__sem' && g.key !== '__todos' && <button title={`Novo posto ${agruparPor === 'cc' ? 'neste centro de custo' : 'neste cargo'}`}
                            onClick={ev => { ev.stopPropagation(); novoPosto(agruparPor === 'cc' ? { cc_id: g.key } : { cargo_id: g.key }) }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11.5, fontWeight: 600, borderRadius: 6, cursor: 'pointer', color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.12)' }}>
                            <Plus size={12} /> Posto</button>}
                        </div>
                      </td>
                    </tr>
                    {aberto && g.postos.map(linhaPosto)}
                  </Fragment>
                )
              })}
              {!filtrados.length && <tr><td colSpan={nCols} style={S.empty}>
                {postos.length ? 'Nenhum posto para o filtro.'
                  : podeImportar ? 'Nenhum posto ainda. Use "Importar postos (RH)" para carregar do cadastro convertido.'
                  : 'Nenhum posto ainda — a carga do RH é feita por quem tem essa permissão.'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>¹ {temMotor ? 'Custo com encargos/provisões/benefícios pelo motor (clique no valor p/ ver a memória). Rateio entra no step 4.' : 'Custo base (salário × FTE) — cadastre as verbas em Estrutura para o custo com encargos.'}
        <br /><span style={{ color: 'var(--orange)' }}>*</span> o custo mudou durante o ano (reajuste, afastamento, rescisão ou verba paga em parcelas, como a PLR): a coluna mostra o <b>último mês</b>, não a média — por isso ela × 12 não dá o custo ano, que já soma mês a mês.</p>

      {drill && (() => {
        const r = custos.get(drill.id)
        const dis = drill.sindicato_id ? (dissidio[drill.sindicato_id] || 0) : 0
        const fAfast = afast(drill)
        return (
          <div style={S.overlay} onClick={() => setDrill(null)}>
            <div style={S.modal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{drill.nome || 'Vaga'} <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{drill.codigo}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{drill.cargo?.nome || '—'} · {drill.regime || '—'} · {drill.sindicato?.codigo || 'sem sindicato'}{dis ? ` · dissídio ${dis}%` : ''} · base R$ {money((Number(drill.salario_base) || 0) * (Number(drill.fte) || 1))}/mês</div>
                  {/* Sem esta linha, a coluna "Mês" zerada no salário parece erro
                      de cadastro — o mês representativo é um mês de afastamento. */}
                  {!!r?.rescisaoAno && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
                    Sai em {MESES_NUM[(r.mesFimVigencia || 1) - 1]}/{anoCalc} · rescisão estimada <b>R$ {money(r.rescisaoAno)}</b>.
                    Ela está no total do <b>ano</b>, não no mês — a coluna "Mês" é o custo recorrente.
                  </div>}
                  {fAfast && <div style={{ fontSize: 12, color: 'var(--violet)', marginTop: 4 }}>
                    Afastado {fAfast.txt}{fAfast.aberto ? ' (sem previsão de retorno)' : ''}{drill.afast_motivo ? ` — ${drill.afast_motivo}` : ''}.
                    Nesses {r?.mesesAfastado || 0} {(r?.mesesAfastado || 0) > 1 ? 'meses' : 'mês'} o orçamento leva só os benefícios devidos no afastamento.
                  </div>}
                </div>
                <button onClick={() => setDrill(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
              </div>
              {!r || !r.linhas.length ? <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Sem verbas aplicáveis (cadastre em Estrutura ou confira o regime).</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={S.mth}>Verba</th><th style={S.mth}>Categoria</th><th style={{ ...S.mth, textAlign: 'right' }}>Mês</th><th style={{ ...S.mth, textAlign: 'right' }}>Ano</th></tr></thead>
                  <tbody>
                    {r.linhas.map(l => (
                      <tr key={l.verba.id}>
                        <td style={S.mtd}><span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{l.verba.codigo}</span> {l.verba.descricao}</td>
                        <td style={{ ...S.mtd, color: catCor[l.categoria] || 'var(--muted)' }}>{l.categoria}</td>
                        <td style={{ ...S.mtd, textAlign: 'right' }}>{money(l.valorMes)}</td>
                        <td style={{ ...S.mtd, textAlign: 'right' }}>{money(l.valorAno)}</td>
                      </tr>
                    ))}
                    <tr><td style={{ ...S.mtd, fontWeight: 700 }} colSpan={2}>Total</td><td style={{ ...S.mtd, textAlign: 'right', fontWeight: 700 }}>{money(r.totalMes)}</td><td style={{ ...S.mtd, textAlign: 'right', fontWeight: 700 }}>{money(r.totalAno)}</td></tr>
                  </tbody>
                </table>
              )}
              {r && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                {CATEGORIAS.map(c => r.porCategoria[c] ? (
                  <span key={c} style={{ ...tag('var(--bg)', catCor[c], 'var(--border)'), fontSize: 11.5 }}>{c}: R$ {money(r.porCategoria[c])}/ano</span>
                ) : null)}
              </div>}

              {editavel && (() => {
                // ⚠ `PARCELAS` entra aqui junto com `VALOR_FIXO`: as duas guardam
                // valor por pessoa em `posto_verba`, e este painel é o único
                // lugar onde esse valor se edita. Filtrar só por VALOR_FIXO
                // deixava a PLR sem porta de entrada — ela aparecia no catálogo
                // de verbas e em lugar nenhum da tela do posto.
                const cabe = (v: any) => paisAplica(v.pais, empPais.get(drill.empresa_id) ?? null) && regimeAplica(v.regime, drill.regime)
                const benefVerbas = verbas.filter(v => v.tipo_calculo === 'VALOR_FIXO' && cabe(v))
                const parcVerbas  = verbas.filter(v => v.tipo_calculo === 'PARCELAS' && cabe(v))
                if (!benefVerbas.length && !parcVerbas.length) return null
                // ⚠⚠ A UNIDADE É DIFERENTE e precisa estar escrita ao lado do
                // campo: benefício é valor MENSAL, parcelado é o total do ANO.
                // Um rótulo só, dizendo "mensal", faria alguém digitar o valor
                // de um mês de PLR e orçar um doze avos do que vai pagar.
                const meses = (cal?: string | null) => (cal || '').split(';')
                  .map(x => Number(x.split(':')[0])).filter(m => m >= 1 && m <= 12)
                  .map(m => MESES_NUM[m - 1]).join(' e ')
                const campo = (v: any) => (
                  <Fragment key={v.id}>
                    <span style={{ fontSize: 12.5 }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{v.codigo}</span> {v.descricao}
                      {v.tipo_calculo === 'PARCELAS' && (
                        <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>
                          — total do ANO{meses(v.calendario) ? `, pago em ${meses(v.calendario)}` : ''}
                        </span>
                      )}
                    </span>
                    <input style={{ ...S.inp, width: '100%' }} placeholder="0,00"
                      defaultValue={postoVerbas[drill.id]?.[v.id] ? inp2(postoVerbas[drill.id][v.id]) : ''}
                      onBlur={e => { const x = parseNum(e.target.value); salvarBenef(drill.id, v.id, isNaN(x) ? 0 : x) }} />
                  </Fragment>
                )
                return (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    {benefVerbas.length > 0 && <>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Benefícios deste posto <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— valor mensal por pessoa (vazio = não tem)</span></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '4px 12px', alignItems: 'center' }}>
                        {benefVerbas.map(campo)}
                      </div>
                    </>}
                    {parcVerbas.length > 0 && <>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', margin: benefVerbas.length ? '16px 0 8px' : '0 0 8px' }}>Pago em parcelas <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— valor do ANO por pessoa; o motor divide pelos meses do calendário da verba</span></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '4px 12px', alignItems: 'center' }}>
                        {parcVerbas.map(campo)}
                      </div>
                    </>}
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {/* ── Decisões do cenário ──────────────────────────────────────────
          Modal PRÓPRIO, não o do cadastro: aqui só entram campos de DECISÃO, e
          cada um mostra o que herda. O do cadastro gera código, sincroniza
          rateio e grava fatos — nada disso faz sentido num cenário. */}
      {aplForm && (() => {
        const dest = versoes.find((v: any) => v.id === aplForm.destino)
        const prelim = !!dest?.origem_versao_id
        const baseDe = (v: any) => versoes.find((x: any) => x.id === v?.origem_versao_id)?.codigo || ''
        const semVer = modoCenario ? [...alterados.keys()].filter(id => (overlays.get(id) as any)?.aprovado == null).length : 0
        const precisaCarimbo = modoCenario && alterados.size > 0 && !prelim && !dest?.aprovado_em
        return (
          <div style={S.overlay} onClick={e => e.target === e.currentTarget && setAplForm(null)}>
            <div style={{ ...S.modal, width: 560 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Aplicar o quadro no orçado</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 18px' }}>
                As decisões continuam em <b>{vSelCodDe(versaoSel) || '—'}</b>. Aqui você escolhe
                onde o <b>dinheiro</b> pousa.
              </div>

              <div style={{ marginBottom: 14 }}>
                <span style={S.flbl}>Aplicar em</span>
                <select style={S.finp} value={aplForm.destino}
                  onChange={e => setAplForm(f => f && ({ ...f, destino: e.target.value, comoAprovado: false }))}>
                  {versoes.filter((v: any) => v.ano === anoCalc || !v.ano).map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {v.codigo}{v.origem_versao_id ? ` · preliminar (de ${baseDe(v)})` : ' · baseline'}
                      {v.bloqueada ? ' · BLOQUEADA' : ''}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Para simular sem comprometer o orçamento, crie um cenário a partir da
                  baseline em <b>Orçar por linha → Novo cenário</b> e aplique nele.
                </div>
              </div>

              {modoCenario && (
                <div style={{ marginBottom: 16 }}>
                  <span style={S.flbl}>Como resolver as decisões</span>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={!aplForm.comoAprovado} onChange={() => setAplForm(f => f && ({ ...f, comoAprovado: false }))} />
                    <span>Só o <b>aprovado</b> — decisão sem veredito ou recusada entra com o valor do cadastro.</span>
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, marginTop: 8,
                                  cursor: prelim ? 'pointer' : 'not-allowed', opacity: prelim ? 1 : 0.5 }}>
                    <input type="radio" disabled={!prelim} checked={aplForm.comoAprovado}
                      onChange={() => setAplForm(f => f && ({ ...f, comoAprovado: true }))} />
                    <span>
                      <b>Como se tudo passasse</b> — usa a proposta inteira{semVer ? `, inclusive as ${semVer} sem veredito` : ''}.
                      {!prelim && <i style={{ color: 'var(--muted)' }}> Só em versão preliminar: numa baseline isto gravaria
                      como acordado o que ninguém decidiu.</i>}
                    </span>
                  </label>
                </div>
              )}

              {precisaCarimbo && (
                <div style={{ fontSize: 12, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)',
                              border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 14 }}>
                  O cenário decide {alterados.size} posto(s) e a versão de destino é uma <b>baseline não aprovada</b>.
                  Aprove em "Comparar com o cadastro", ou escolha uma versão preliminar.
                </div>
              )}
              {prelim && (
                <div style={{ fontSize: 12, color: 'var(--text-mid)', background: 'var(--bg-soft)',
                              border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', marginBottom: 14 }}>
                  <b style={{ color: 'var(--text)' }}>Simulação.</b> O resultado é "se tudo passar", não o orçamento
                  acordado. Para lê-lo, aponte uma visão do relatório para <b>{dest?.codigo}</b> — ou crie uma visão
                  comparativa com {baseDe(dest) || 'a baseline'}.
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button style={S.btn} onClick={() => setAplForm(null)}>Cancelar</button>
                <button style={S.btnPri} disabled={aplicando || precisaCarimbo}
                  onClick={() => { const f = aplForm; setAplForm(null); aplicarNoOrcado(f.destino, f.comoAprovado) }}>
                  {aplicando ? 'Aplicando…' : 'Aplicar'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {verDiff && (
        <CenarioDiffModal
          postos={postos} postosFiltrados={postosDoRecorte} overlays={overlays} verbas={verbas}
          dissidio={dissidio} sindMesBase={sindMesBase} anoCalc={anoCalc}
          postoVerbas={postoVerbas} empPais={empPais} empById={empById} ccById={ccById}
          filById={new Map((filiais as any[]).map(f => [f.id, f]))}
          aprovadoEm={aprovadoEm} aprovacaoNota={vAtual?.aprovacao_nota || ''}
          podeAprovar={podeAprovar} onDecidir={decidirAprovacao}
          onVeredito={decidirPosto} vereditos={vereditos}
          podeDecidir={podeCenario} onAbandonar={abandonarDecisao} onReabrir={reabrirDecisao}
          cargoNome={(id: string) => cargos.find((c: any) => c.id === id)?.nome || ''}
          versaoLabel={versoes.find((v: any) => v.id === versaoSel)?.codigo || ''}
          onClose={() => setVerDiff(false)} />
      )}
      {cenForm && (() => {
        const m: any = cenForm.posto, ov: any = cenForm.ov || {}
        const limpos = new Set<string>(ov.limpos || [])
        const efet: any = resolvePosto(m, cenForm.ov)
        const decidido = (c: string) => limpos.has(c) || (ov[c] != null && ov[c] !== '')
        const set = (patch: any, limpar: CampoCenario[] = []) => {
          salvarCenario(m.id, patch, limpar)
          setCenForm(f => f && ({ ...f, ov: { ...(f.ov || { versao_id: versaoSel, posto_id: m.id }), ...patch,
            limpos: [...new Set([...(f.ov?.limpos || []), ...limpar])].filter(x => !(x in patch) || patch[x] == null) } as PostoVersao }))
        }
        // "voltar a herdar" de um par (ano+mês): se o mestre tem valor, LIMPAR é
        // uma decisão (ficar); se não tem, é só apagar o que o cenário pôs.
        const herda = (campos: CampoCenario[]) => {
          const mestreTem = campos.some(c => m[c] != null)
          set(Object.fromEntries(campos.map(c => [c, null])), mestreTem ? campos : [])
        }
        const lbl = (c: string) => decidido(c)
          ? { color: 'var(--violet)', fontWeight: 700 }
          : { color: 'var(--muted)', fontStyle: 'italic' as const }
        const parMes = (campoMes: CampoCenario, campoAno: CampoCenario, titulo: string) => (
          <div><span style={{ ...S.flbl, ...lbl(campoAno) }}>{titulo}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select style={{ ...S.finp, width: 92 }} value={efet[campoMes] ?? ''}
                onChange={e => set({ [campoMes]: e.target.value ? parseInt(e.target.value, 10) : null,
                                     [campoAno]: e.target.value ? (efet[campoAno] ?? anoCalc) : null })}>
                <option value="">—</option>
                {MESES_NUM.map((x, i) => <option key={i} value={i + 1}>{x}</option>)}
              </select>
              <input style={{ ...S.finp, width: 70 }} placeholder="ano" value={efet[campoAno] ?? ''}
                onChange={e => set({ [campoAno]: e.target.value ? parseInt(e.target.value, 10) : null })} />
              {decidido(campoAno) || decidido(campoMes)
                ? <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar do cadastro" onClick={() => herda([campoAno, campoMes])}><Undo2 size={14} /></button>
                : null}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>cadastro: {m[campoMes] ? `${MESES[m[campoMes] - 1]}/${m[campoAno] ?? '?'}` : '—'}</div>
          </div>
        )
        const alt = camposAlterados(m, cenForm.ov)
        return (
          <div style={S.overlay} onClick={() => setCenForm(null)}>
            <div style={S.modal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{m.nome || 'Vaga'} <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{m.codigo}</span></div>
                  <div style={{ fontSize: 12.5, color: 'var(--violet)', marginTop: 3 }}>
                    Decisões do cenário <b>{versoes.find((v: any) => v.id === versaoSel)?.codigo || '—'}</b> · {alt.length ? `${alt.length} campo(s) decidido(s)` : 'herda tudo do cadastro'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>O cadastro não muda. Em itálico, o que é herdado; em violeta, o que este cenário decide.</div>
                </div>
                <button onClick={() => setCenForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
                <div><span style={{ ...S.flbl, ...lbl('salario_base') }}>Salário base</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={{ ...S.finp, flex: 1 }} defaultValue={inp2(efet.salario_base)} key={`s${ov.salario_base}`}
                      onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== efet.salario_base) set({ salario_base: x }) }} />
                    {decidido('salario_base') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['salario_base'])}><Undo2 size={14} /></button>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>cadastro: {money(Number(m.salario_base) || 0)}</div>
                </div>
                <div><span style={{ ...S.flbl, ...lbl('fte') }}>FTE</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={{ ...S.finp, flex: 1 }} defaultValue={inpNum(efet.fte ?? 1)} key={`f${ov.fte}`}
                      onBlur={e => { const x = parseNum(e.target.value); if (!isNaN(x) && x !== efet.fte) set({ fte: x }) }} />
                    {decidido('fte') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['fte'])}><Undo2 size={14} /></button>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>cadastro: {m.fte ?? 1}</div>
                </div>
                {/* Promoção: cargo + salário na mesma decisão. A referência do
                    cargo é SUGERIDA, nunca aplicada — preencher calado decidiria
                    pelo gerente, e o salário de referência é piso de faixa, não
                    a proposta dele. */}
                <div><span style={{ ...S.flbl, ...lbl('cargo_id' as CampoCenario) }}>Cargo (promoção)</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, flex: 1 }} value={efet.cargo_id ?? ''}
                      onChange={e => set({ cargo_id: e.target.value || null })}>
                      <option value="">—</option>
                      {opcoesCargo(efet.cargo_id).map((c: any) => <option key={c.id} value={c.id}>{c.nome}{c.sub_cod ? ` · ${c.sub_cod}` : ''}{c.ativo === false ? ' (inativo)' : ''}</option>)}
                    </select>
                    {decidido('cargo_id') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['cargo_id' as CampoCenario])}><Undo2 size={14} /></button>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>
                    cadastro: {cargos.find((c: any) => c.id === m.cargo_id)?.nome || '—'}
                    {(() => {
                      const ref = cargos.find((c: any) => c.id === efet.cargo_id)?.salario_ref
                      if (!decidido('cargo_id') || !ref || Number(ref) === Number(efet.salario_base)) return null
                      return (
                        <> · referência do cargo <b>{money(Number(ref))}</b>{' '}
                          <button onClick={() => set({ salario_base: Number(ref) })}
                            title="Usar o salário de referência do cargo novo. Você pode digitar outro valor."
                            style={{ background: 'none', border: 'none', color: 'var(--violet)', cursor: 'pointer', padding: 0, fontSize: 10.5 }}>
                            usar
                          </button>
                        </>
                      )
                    })()}
                  </div>
                </div>
                {parMes('ini_mes', 'ini_ano', 'Entrada (adiar/antecipar)')}
                {parMes('fim_mes', 'fim_ano', 'Saída (demissão simulada)')}
                {parMes('afast_ini_mes', 'afast_ini_ano', 'Afastado desde')}
                {parMes('afast_fim_mes', 'afast_fim_ano', 'Retorno previsto')}
                <div><span style={{ ...S.flbl, ...lbl('reajuste_mes') }}>Reajuste — a partir de</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, flex: 1 }} value={efet.reajuste_mes ?? ''}
                      onChange={e => set({ reajuste_mes: e.target.value ? parseInt(e.target.value, 10) : null })}>
                      <option value="">sem reajuste</option>
                      {MESES_NUM.map((x, i) => <option key={i} value={i + 1}>{x}</option>)}
                    </select>
                    {decidido('reajuste_mes') && <button style={{ ...S.del, padding: '0 6px' }} title="Voltar a herdar" onClick={() => herda(['reajuste_mes', 'reajuste_pct', 'reajuste_valor'])}><Undo2 size={14} /></button>}
                  </div>
                </div>
                <div><span style={{ ...S.flbl, ...lbl('reajuste_pct') }}>Reajuste %</span>
                  <input style={S.finp} defaultValue={efet.reajuste_pct ?? ''} key={`r${ov.reajuste_pct}`} placeholder="ex.: 8"
                    onBlur={e => set({ reajuste_pct: e.target.value ? parseNum(e.target.value) : null })} />
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: decidido('ativo') ? 'var(--violet)' : 'var(--text)' }}>
                  <input type="checkbox" checked={efet.ativo === false}
                    onChange={e => set({ ativo: e.target.checked ? false : null })} />
                  <b>Cortar neste cenário</b> <span style={{ color: 'var(--muted)' }}>(sai do quadro só aqui; o cadastro continua ativo)</span>
                </label>
              </div>
              <div style={{ marginTop: 12 }}>
                <span style={S.flbl}>Por quê <span style={{ color: 'var(--muted)' }}>(vai junto quando você apresentar o cenário)</span></span>
                <input style={{ ...S.finp, width: '100%' }} defaultValue={ov.nota || ''} placeholder="ex.: corte estrutural 2027 · contratação adiada p/ jul"
                  onBlur={e => set({ nota: e.target.value.trim() || null })} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <button style={S.btn} disabled={!alt.length}
                  onClick={() => { limparCenario(m.id); setCenForm(null) }}>
                  <Undo2 size={14} /> Voltar a herdar tudo
                </button>
                <button style={S.btnP} onClick={() => setCenForm(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}

      {form && (
        <div style={S.overlay} onClick={() => setForm(null)}>
          <div style={{ ...S.modal, width: 'min(580px, 96vw)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{form.id ? `Editar posto ${form.codigo}` : 'Novo posto / vaga'}</div>
              <button onClick={() => setForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
              <div style={{ gridColumn: '1 / -1' }}><span style={S.flbl}>Ocupante <span style={{ color: 'var(--muted)' }}>(vazio = vaga planejada)</span></span>
                <input style={S.finp} value={form.nome} placeholder="Nome do funcionário; deixe vazio p/ vaga" onChange={e => setForm((f: any) => ({ ...f, nome: e.target.value }))} /></div>
              <div><span style={S.flbl}>Empresa *</span><select style={S.finp} value={form.empresa_id} onChange={e => setForm((f: any) => ({ ...f, empresa_id: e.target.value, filial_id: '', codigo: f.codigoAuto ? '' : f.codigo }))}><option value="">—</option>{acesso.filterEditPessoas('empresa', empresas).map((e: any) => <option key={e.id} value={e.id}>{e.codigo} · {e.descricao}</option>)}</select></div>
              <div><span style={S.flbl}>Filial *</span><select style={S.finp} value={form.filial_id} onChange={e => setForm((f: any) => ({ ...f, filial_id: e.target.value, codigo: f.codigoAuto ? gerarCodigoPosto(e.target.value, f.matricula) : f.codigo }))}><option value="">—</option>{filiais.filter((f: any) => !form.empresa_id || f.empresa_id === form.empresa_id).map((f: any) => <option key={f.id} value={f.id}>{f.codigo}{f.descricao ? ' · ' + f.descricao : ''}</option>)}</select></div>
              <div><span style={S.flbl}>Centro de custo</span><select style={S.finp} value={form.cc_id} onChange={e => setForm((f: any) => ({ ...f, cc_id: e.target.value }))}><option value="">—</option>{ccs.map((c: any) => <option key={c.id} value={c.id}>{c.codigo} · {c.descricao}</option>)}</select></div>
              <div><span style={S.flbl}>Matrícula</span><input style={S.finp} value={form.matricula} onChange={e => setForm((f: any) => ({ ...f, matricula: e.target.value, codigo: f.codigoAuto ? gerarCodigoPosto(f.filial_id, e.target.value) : f.codigo }))} /></div>
              <div><span style={S.flbl}>Código * <span style={{ color: 'var(--muted)' }}>{form.codigoAuto ? '(automático)' : '(manual)'}</span></span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...S.finp, flex: 1, ...(form.codigoAuto ? { background: 'var(--bg-soft)', color: 'var(--text-mid)' } : {}) }} value={form.codigo} readOnly={form.codigoAuto}
                    placeholder={form.codigoAuto ? (form.filial_id ? '' : 'escolha a filial') : ''} onChange={e => setForm((f: any) => ({ ...f, codigo: e.target.value }))} />
                  {form.codigoAuto
                    ? <button type="button" title="Editar código manualmente" style={{ padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setForm((f: any) => ({ ...f, codigoAuto: false }))}><Pencil size={14} /></button>
                    : <button type="button" title="Voltar ao código automático" style={{ padding: '0 10px', fontSize: 11, fontWeight: 600, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer' }} onClick={() => setForm((f: any) => ({ ...f, codigoAuto: true, codigo: gerarCodigoPosto(f.filial_id, f.matricula) }))}>auto</button>}
                </div></div>
              <div><span style={S.flbl}>Cargo</span><select style={S.finp} value={form.cargo_id} onChange={e => setForm((f: any) => ({ ...f, cargo_id: e.target.value }))}><option value="">—</option>{opcoesCargo(form.cargo_id).map((c: any) => <option key={c.id} value={c.id}>{c.nome}{c.sub_cod ? ` · ${c.sub_cod}` : ''}{c.ativo === false ? ' (inativo)' : ''}</option>)}</select></div>
              <div><span style={S.flbl}>Regime</span><select style={S.finp} value={form.regime} onChange={e => setForm((f: any) => ({ ...f, regime: e.target.value }))}><option value="">—</option>{REGIMES.map(r => <option key={r} value={r}>{REGIMES_LABEL[r] || r}</option>)}</select></div>
              {/* ⚠ FICA NO GRID PRINCIPAL. Na primeira tentativa este campo caiu
                  dentro do bloco de rescisão, que só é desenhado quando o posto
                  TEM vigência fim — então para o caso que ele existe para
                  resolver (marcar como demitido quem o ERP mandou ativo) ele
                  simplesmente não aparecia. Situação é atributo de todo posto. */}
              <div><span style={S.flbl}>Situação <span style={{ color: 'var(--muted)' }}>(vem do ERP)</span></span>
                <select style={S.finp} value={form.sit_folha}
                  onChange={e => setForm((f: any) => ({ ...f, sit_folha: e.target.value }))}>
                  <option value="">Trabalhando</option>
                  <option value="F">Férias</option>
                  <option value="A">Afastado</option>
                  <option value="D">Demitido</option>
                </select>
                {/* A importação do RH regrava a coluna. Dizer isso aqui é a
                    diferença entre um conserto e um trabalho que evapora sem
                    aviso — a lição do salário editado no cadastro. */}
                {form.sit_folha !== ((postos.find((x: any) => x.id === form.id) as any)?.sit_folha || '') && (
                  <div style={{ fontSize: 10.5, color: 'var(--orange)', marginTop: 3, lineHeight: 1.45 }}>
                    Correção manual: a próxima importação do RH <b>sobrescreve</b>. O conserto
                    definitivo é no ERP.
                  </div>
                )}
                {(form.sit_folha === 'A' || form.sit_folha === 'F') && !form.afast_ini_ano && (
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>
                    Muda só a etiqueta — o <b>custo</b> do afastamento vem de "Afastado desde".
                  </div>
                )}
              </div>
              <div><span style={S.flbl}>Sindicato <span style={{ color: 'var(--muted)' }}>(vazio = pela empresa)</span></span><select style={S.finp} value={form.sindicato_id} onChange={e => setForm((f: any) => ({ ...f, sindicato_id: e.target.value }))}><option value="">— automático —</option>{sindicatos.map((s: any) => <option key={s.id} value={s.id}>{s.codigo}</option>)}</select></div>
              {/* Saiu da grade (nov/2026): é exceção rara — a decisão normal é
                  por FUNÇÃO, em Apontamento → Funções — e ocupava uma coluna
                  inteira com um traço em quase toda linha. */}
              {flags.usa_apontamento && (
                <div><span style={S.flbl}>Recebe por hora <span style={{ color: 'var(--muted)' }}>(vazio = segue a função)</span></span>
                  <select style={S.finp} value={form.recebe_hora}
                    onChange={e => setForm((f: any) => ({ ...f, recebe_hora: e.target.value }))}>
                    <option value="">— segue a função —</option>
                    <option value="sim">recebe por hora</option>
                    <option value="nao">só aponta</option>
                  </select>
                </div>
              )}
              <div><span style={S.flbl}>Salário base</span><input style={S.finp} value={form.salario_base} placeholder="0,00" onChange={e => setForm((f: any) => ({ ...f, salario_base: e.target.value }))} /></div>
              <div><span style={S.flbl}>FTE</span><input style={S.finp} value={form.fte} placeholder="1" onChange={e => setForm((f: any) => ({ ...f, fte: e.target.value }))} /></div>
              <div><span style={S.flbl}>Vigência início</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.finp, flex: 1 }} value={form.ini_mes} onChange={e => setForm((f: any) => ({ ...f, ini_mes: e.target.value }))}><option value="">mês</option>{MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
                  <input style={{ ...S.finp, width: 76 }} value={form.ini_ano} placeholder="ano" onChange={e => setForm((f: any) => ({ ...f, ini_ano: e.target.value }))} />
                </div>
              </div>
              <div><span style={S.flbl}>Vigência fim <span style={{ color: 'var(--muted)' }}>(vazio = dez)</span></span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.finp, flex: 1 }} value={form.fim_mes} onChange={e => setForm((f: any) => ({ ...f, fim_mes: e.target.value }))}><option value="">mês</option>{MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
                  <input style={{ ...S.finp, width: 76 }} value={form.fim_ano} placeholder="ano" onChange={e => setForm((f: any) => ({ ...f, fim_ano: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Saída (v3_118). A DATA é a vigência fim, logo acima — aqui fica só o
                que a rescisão precisa e não dava para derivar: a admissão (aviso
                prévio progressivo + saldo do FGTS) e a prévia do que isso custa.
                Prestador/pró-labore não aparecem: o filtro por regime das verbas
                já os deixa de fora, e contrato que acaba não gera rescisão. */}
            {form.fim_ano && Number(form.fim_ano) === anoCalc && (() => {
              const regCLT = (form.regime || '').includes('CLT')
              const prev = regCLT ? calcularPosto({
                salario_base: parseNum(form.salario_base) || 0, fte: parseNum(form.fte) || 1,
                regime: form.regime || null, pais: empPais.get(form.empresa_id) ?? null,
                ini_ano: form.ini_ano ? parseInt(form.ini_ano, 10) : null, ini_mes: form.ini_mes ? parseInt(form.ini_mes, 10) : null,
                fim_ano: parseInt(form.fim_ano, 10), fim_mes: form.fim_mes ? parseInt(form.fim_mes, 10) : 12,
                admissao: (form.admissao || '').trim() || null,
                reajuste_mes: form.reajuste_mes ? parseInt(form.reajuste_mes, 10) : null,
                reajuste_pct: form.reajuste_pct ? parseNum(form.reajuste_pct) : null,
                reajuste_valor: form.reajuste_valor ? parseNum(form.reajuste_valor) : null,
              }, verbas, {
                dissidioPct: form.sindicato_id ? (dissidio[form.sindicato_id] || 0) : 0,
                mesBase: form.sindicato_id ? (sindMesBase[form.sindicato_id] || 1) : 1,
                ano: anoCalc, valoresFixos: form.id ? (postoVerbas[form.id] || {}) : {},
              }) : null
              const sal = parseNum(form.salario_base) || 0
              // Rescisão zerada tem DUAS causas e elas pedem conserto diferente:
              // não existir verba no catálogo, ou existir e o filtro de
              // país/regime do motor tirá-la do posto. Dizer só "sem verbas"
              // manda procurar no lugar errado.
              const ehResc = (t: string) => t === 'RESC_AVISO' || t === 'RESC_PROP' || t === 'RESC_SALDO_FGTS'
              const noCat = verbas.filter(v => ehResc(v.tipo_calculo))
              const aplicaveis = verbasDoRegime(verbas, form.regime || null, empPais.get(form.empresa_id) ?? null).filter(v => ehResc(v.tipo_calculo))
              return (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <span style={{ ...S.flbl, display: 'block', marginBottom: 6 }}>
                    Saída em {MESES_NUM[(form.fim_mes ? Number(form.fim_mes) : 12) - 1]}/{form.fim_ano} <span style={{ color: 'var(--muted)' }}>(a data é a vigência fim, acima)</span>
                  </span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div><span style={S.flbl}>Admissão <span style={{ color: 'var(--muted)' }}>(tempo de casa)</span></span>
                      <input type="date" style={{ ...S.finp, width: 150 }} value={form.admissao}
                        onChange={e => setForm((f: any) => ({ ...f, admissao: e.target.value }))} />
                    </div>
                    {prev && <div style={{ fontSize: 12.5, paddingBottom: 6 }}>
                      <div style={{ color: 'var(--red)', fontWeight: 600 }}>Rescisão estimada: R$ {money(prev.rescisaoAno)}{sal ? ` (${(prev.rescisaoAno / sal).toFixed(1)} salários)` : ''}</div>
                      <div style={{ color: aplicaveis.length ? 'var(--muted)' : 'var(--orange)' }}>
                        {prev.linhas.filter(l => l.categoria === 'Rescisão').map(l => `${l.verba.codigo} ${money(l.valorAno)}`).join(' · ')
                          || (!noCat.length
                            ? 'Nenhuma verba de rescisão no catálogo — rode a migration v3_118.'
                            : !aplicaveis.length
                              ? `As ${noCat.length} verbas de rescisão existem (${noCat.map(v => v.codigo).join(', ')}) mas NÃO se aplicam a este posto. O motor filtra por país e regime: confira o país da empresa contra o país da verba, e o regime "${form.regime || '—'}" contra o regime da verba, em Postos → Regras.`
                              : 'As verbas se aplicam mas deram zero — confira os parâmetros em Postos → Regras.')}
                      </div>
                    </div>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    {regCLT
                      ? <>Sem a admissão o aviso prévio vai a 30 dias e a multa do FGTS a zero — o motor cai na vigência de início. A multa é <b>estimada</b> por salário × tempo de casa; o saldo real está no extrato do FGTS. Os fatores ficam em <b>Postos → Regras</b> (<code>RESC_*</code>).</>
                      : <>Regime <b>{form.regime || '—'}</b>: contrato que termina, sem rescisão. Só <code>BR-CLT</code> tem as verbas <code>RESC_*</code>.</>}
                  </div>
                </div>
              )
            })()}

            {/* Reajuste individual (v3_116): promoção/mérito com data. Sem isto,
                planejar um aumento em março obrigava a escolher entre errar o ano
                todo (salário novo desde janeiro) ou o resto dele (velho até
                dezembro). Compõe com o dissídio do sindicato. */}
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ ...S.flbl, display: 'block', marginBottom: 6 }}>
                Reajuste individual <span style={{ color: 'var(--muted)' }}>(promoção/mérito — soma ao dissídio do sindicato)</span>
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><span style={S.flbl}>A partir de</span>
                  <select style={{ ...S.finp, width: 128 }} value={form.reajuste_mes}
                    onChange={e => setForm((f: any) => ({ ...f, reajuste_mes: e.target.value }))}>
                    <option value="">sem reajuste</option>
                    {MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div><span style={S.flbl}>%</span>
                  <input style={{ ...S.finp, width: 90 }} value={form.reajuste_pct} placeholder="ex.: 8"
                    disabled={!form.reajuste_mes || !!form.reajuste_valor}
                    onChange={e => setForm((f: any) => ({ ...f, reajuste_pct: e.target.value }))} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>ou</span>
                <div><span style={S.flbl}>Salário novo</span>
                  <input style={{ ...S.finp, width: 120 }} value={form.reajuste_valor} placeholder="ex.: 17600"
                    disabled={!form.reajuste_mes || !!form.reajuste_pct}
                    onChange={e => setForm((f: any) => ({ ...f, reajuste_valor: e.target.value }))} />
                </div>
                {form.reajuste_mes && (form.reajuste_pct || form.reajuste_valor) && (
                  <span style={{ fontSize: 11.5, color: 'var(--green)', paddingBottom: 8 }}>
                    {MESES_NUM[Number(form.reajuste_mes) - 1]}–dez: {form.reajuste_valor
                      ? `R$ ${parseNum(form.reajuste_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                      : `R$ ${(parseNum(form.salario_base) * (1 + parseNum(form.reajuste_pct) / 100)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                Vale só para o salário — encargos e provisões acompanham por serem % sobre ele; benefício de valor fixo (VR, plano) não muda.
              </div>
            </div>

            {/* Afastamento (v3_117). Escopo: quem JÁ está afastado e segue no ano
                orçado. Do 16º dia o salário é do INSS, então a empresa não paga
                salário nem nada que incida sobre ele — o motor zera a base
                nesses meses. Só sobram os benefícios marcados como devidos no
                afastamento (Postos → Regras). Absenteísmo esperado é premissa
                percentual, não cadastro por pessoa, e não entra aqui. */}
            <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ ...S.flbl, display: 'block', marginBottom: 6 }}>
                Afastamento <span style={{ color: 'var(--muted)' }}>(INSS, licença — a empresa não paga o salário nesses meses)</span>
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div><span style={S.flbl}>Afastado desde</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, width: 100 }} value={form.afast_ini_mes}
                      onChange={e => setForm((f: any) => ({ ...f, afast_ini_mes: e.target.value, afast_ini_ano: f.afast_ini_ano || (e.target.value ? String(anoCalc) : '') }))}>
                      <option value="">não afastado</option>
                      {MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                    <input style={{ ...S.finp, width: 76 }} value={form.afast_ini_ano} placeholder="ano"
                      onChange={e => setForm((f: any) => ({ ...f, afast_ini_ano: e.target.value }))} />
                  </div>
                </div>
                <div><span style={S.flbl}>Retorno previsto <span style={{ color: 'var(--muted)' }}>(vazio = sem previsão)</span></span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select style={{ ...S.finp, width: 100 }} value={form.afast_fim_mes} disabled={!form.afast_ini_mes}
                      onChange={e => setForm((f: any) => ({ ...f, afast_fim_mes: e.target.value, afast_fim_ano: f.afast_fim_ano || (e.target.value ? String(anoCalc) : '') }))}>
                      <option value="">—</option>
                      {MESES_NUM.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                    <input style={{ ...S.finp, width: 76 }} value={form.afast_fim_ano} placeholder="ano" disabled={!form.afast_ini_mes}
                      onChange={e => setForm((f: any) => ({ ...f, afast_fim_ano: e.target.value }))} />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}><span style={S.flbl}>Motivo</span>
                  <input style={{ ...S.finp, width: '100%' }} value={form.afast_motivo} disabled={!form.afast_ini_mes}
                    placeholder="ex.: auxílio-doença desde 08/2026, sem alta prevista"
                    onChange={e => setForm((f: any) => ({ ...f, afast_motivo: e.target.value }))} />
                </div>
              </div>
              {form.afast_ini_mes && form.afast_ini_ano && (() => {
                const ia = parseInt(form.afast_ini_ano, 10), im = parseInt(form.afast_ini_mes, 10)
                const fa2 = form.afast_fim_ano ? parseInt(form.afast_fim_ano, 10) : null
                const fm = form.afast_fim_mes ? parseInt(form.afast_fim_mes, 10) : null
                const ini = ia > anoCalc ? 13 : (ia === anoCalc ? im : 1)
                const fim = fa2 == null ? 12 : (fa2 < anoCalc ? 0 : (fa2 === anoCalc ? (fm || 12) : 12))
                const n = Math.max(0, Math.min(12, fim) - Math.max(1, ini) + 1)
                return <div style={{ fontSize: 11.5, color: n ? 'var(--violet)' : 'var(--muted)', marginTop: 6 }}>
                  {n === 0
                    ? `O afastamento não alcança ${anoCalc} — o orçamento deste ano sai cheio.`
                    : `Em ${anoCalc}: ${MESES_NUM[Math.max(1, ini) - 1]}–${MESES_NUM[Math.min(12, fim) - 1]} (${n} ${n > 1 ? 'meses' : 'mês'}) sem salário, INSS, FGTS e provisões.`}
                </div>
              })()}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                Quais benefícios continuam devidos (plano de saúde sim, vale-transporte não) é regra da verba — marca-se em <b>Postos → Regras</b>.
              </div>
            </div>

            {/* Rateio: códigos anexados ao posto, em cascata (ordem). Origem = empresa/CC deste posto. */}
            <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>Rateio <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(distribui o custo deste posto; aplicado na ordem)</span></span>
                <button style={{ ...S.btn, padding: '5px 9px', fontSize: 12 }} onClick={() => setForm((f: any) => ({ ...f, rateios: [...(f.rateios || []), { regra_id: '', ordem: (f.rateios?.length || 0) + 1 }] }))}><Plus size={13} /> Código</button>
              </div>
              {(!form.rateios || !form.rateios.length) && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sem rateio — 100% na empresa/CC do posto.</div>}
              {(form.rateios || []).map((r: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <select style={{ ...S.finp, flex: 1 }} value={r.regra_id} onChange={e => setForm((f: any) => ({ ...f, rateios: f.rateios.map((x: any, j: number) => j === i ? { ...x, regra_id: e.target.value } : x) }))}>
                    <option value="">— código —</option>
                    {rateioCods.map((c: any) => <option key={c.id} value={c.id}>{c.nome} ({c.dimensao === 'CC' ? 'CC' : 'Empresa'})</option>)}
                  </select>
                  <input style={{ ...S.finp, width: 64 }} title="Ordem da cascata" value={r.ordem} onChange={e => setForm((f: any) => ({ ...f, rateios: f.rateios.map((x: any, j: number) => j === i ? { ...x, ordem: parseInt(e.target.value, 10) || 1 } : x) }))} />
                  <button style={S.del} onClick={() => setForm((f: any) => ({ ...f, rateios: f.rateios.filter((_: any, j: number) => j !== i) }))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button style={S.btn} onClick={() => setForm(null)}>Cancelar</button>
              <button style={S.btnPri2} onClick={salvarPosto}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      {rateModal && (
        <RateioModal posto={rateModal} totMes={custoMesP(rateModal)} totAno={custoAnoP(rateModal)}
          anexos={postoRateios[rateModal.id] || []} rateioCods={rateioCods} destByRegra={destByRegra}
          empById={empById} ccById={ccById} onClose={() => setRateModal(null)} />
      )}
    </div>
  )
}
