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
import { useUserAccess } from '../../hooks/useUserAccess'
import { totaisRelatorio } from '../../lib/relatorioTotais'
import { COLS_LINHA, emArvore, fatorExibicao, linhasConciliaveis, type LinhaRel } from '../../lib/refRelatorio'
import {
  ExportarButton, FiltrosButton, SalvarCardButton, useCardPreset,
  effectiveCcFilter, escopoFiltro, type CC,
} from './DashFiltros'
import { ChevronLeft, AlertTriangle, Info } from 'lucide-react'

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const fmt = (n: number, casas = 0) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—')

type Modo = 'ORC' | 'REAL'
type Proj = 'OFF' | 'ORCADO' | 'MEDIA3' | 'ULTIMO'

/** uma seção escolhe as próprias linhas e o próprio limiar */
type SecCfg = { sel: string[]; pct: number; minPctTotal: number; resultado?: string }
const SEC_PADRAO: SecCfg = { sel: [], pct: 10, minPctTotal: 0.5 }

// Uma PONTE exige componentes que NÃO SE SOBREPÕEM: ela decompõe a variação de
// UMA linha de resultado. Numa DRE, "nível 1" traz subtotais e componentes
// misturados, e somá-los conta a mesma receita várias vezes.
//
// Quais são os componentes de uma linha? A ESTRUTURA DO RELATÓRIO já responde,
// e é nela que a resposta tem de ficar — não numa lista de nomes no código.
// Nome chumbado ("margem", "ebitda") funciona numa DRE e quebra na seguinte, e
// o produto atende segmentos diferentes.
//
//   · FORMULA       → as linhas que a `expressao` referencia. Uma linha de
//                     fórmula declara os próprios termos: `=[REC] - [CUSTO]`
//                     diz, sem ambiguidade, de que ela é feita.
//   · SOMAR_FILHOS  → as filhas diretas. É a definição do tipo.
//   · demais        → não há como derivar; a pessoa escolhe.
function componentesDe(l: LinhaRel | undefined, linhas: LinhaRel[]): string[] {
  if (!l) return []
  if (l.tipo_linha === 'FORMULA' && l.expressao) {
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
  const [relId, setRelId] = useState('')
  const [linhas, setLinhas] = useState<LinhaRel[]>([])
  const [vBase, setVBase] = useState('')
  const [modo, setModo] = useState<Modo>('ORC')
  const [vComp, setVComp] = useState('')
  const [mesIni, setMesIni] = useState(1)
  const [mesFim, setMesFim] = useState(12)
  const [proj, setProj] = useState<Proj>('ORCADO')
  const [fechadoAte, setFechadoAte] = useState(0)   // último mês FECHADO do realizado comparado

  // ── filtros de dimensão
  const [empresaSel, setEmpresaSel] = useState<string[]>([])
  const [filialSel, setFilialSel] = useState<string[]>([])
  const [ccSel, setCcSel] = useState<string[]>([])
  const [areaSel, setAreaSel] = useState<string[]>([])
  const [divisaoSel, setDivisaoSel] = useState<string[]>([])
  const [buSel, setBuSel] = useState<string[]>([])

  // ── seções
  const [secPonte, setSecPonte] = useState<SecCfg>(SEC_PADRAO)
  const [secVar, setSecVar] = useState<SecCfg>(SEC_PADRAO)
  const [secAcur, setSecAcur] = useState<SecCfg>(SEC_PADRAO)

  const [dados, setDados] = useState<null | {
    base: Record<string, number>; comp: Record<string, number>
    orcAnt: Record<string, number>; realAnt: Record<string, number>
    mensalBase: Record<string, number[]>
  }>(null)
  const [carregando, setCarregando] = useState(false)
  const { nome: cardNome } = useCardPreset('/dashboards/orcamento', (f: any) => {
    if (!f) return
    f.relId && setRelId(f.relId); f.vBase && setVBase(f.vBase); f.vComp && setVComp(f.vComp)
    f.modo && setModo(f.modo); f.proj && setProj(f.proj)
    if (f.mesIni) setMesIni(f.mesIni); if (f.mesFim) setMesFim(f.mesFim)
    if (f.fechadoAte != null) setFechadoAte(f.fechadoAte)
    f.empresaSel && setEmpresaSel(f.empresaSel); f.filialSel && setFilialSel(f.filialSel)
    f.ccSel && setCcSel(f.ccSel); f.areaSel && setAreaSel(f.areaSel)
    f.divisaoSel && setDivisaoSel(f.divisaoSel); f.buSel && setBuSel(f.buSel)
    // Com seleção de linha e limiar POR SEÇÃO, o preset guarda a configuração
    // inteira da análise — "Revisão do orçamento 2027" reabre tudo como estava.
    f.secPonte && setSecPonte(f.secPonte); f.secVar && setSecVar(f.secVar); f.secAcur && setSecAcur(f.secAcur)
  })
  const [erro, setErro] = useState<string | null>(null)

  // ── catálogos (pequenos: dispensam pageAll)
  useEffect(() => {
    supabase.from('relatorio').select('id,nome').order('nome').then(r => setRelatorios(r.data || []))
    supabase.from('versao_orcamento').select('id,codigo,ano').order('ano', { ascending: false }).order('codigo')
      .then(r => { const v = r.data || []; setVersoes(v); if (v[0]) { setVBase(v[0].id); setVComp(v[1]?.id ?? v[0].id) } })
    supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => { setEmpresas(r.data || []); setEmpresaSel((r.data || []).map((e: any) => e.id)) })
    supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo').then(r => setFiliais(r.data || []))
    supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').order('codigo')
      .then(r => setCcs((r.data || []) as CC[]))
  }, [])

  // ── linhas do relatório
  useEffect(() => {
    if (!relId) { setLinhas([]); return }
    supabase.from('relatorio_linha').select(COLS_LINHA + ',nivel').eq('relatorio_id', relId).order('ordem')
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
        setSecPonte({ ...SEC_PADRAO, resultado: res?.id, sel: componentesDe(res, ls) })
        setSecVar(s => ({ ...s, sel: ids })); setSecAcur(s => ({ ...s, sel: ids }))
      })
  }, [relId])

  const versao = (id: string) => versoes.find(v => v.id === id)
  const anoBase = versao(vBase)?.ano
  const anoComp = versao(vComp)?.ano

  // ── último mês FECHADO do realizado do ano comparado.
  // Detectado como SUGESTÃO: o mês corrente aparece parcial no razão, e tomá-lo
  // por fechado contamina duas vezes — entra menor e ainda puxa a média que
  // projeta o resto do ano. Por isso é editável.
  useEffect(() => {
    if (!anoComp) return
    supabase.from('fat_realizado').select('mes').eq('ano', anoComp).order('mes', { ascending: false }).limit(1)
      .then(r => setFechadoAte((r.data?.[0] as any)?.mes ?? 0))
  }, [anoComp])

  const meses = useMemo(() => Array.from({ length: Math.max(0, mesFim - mesIni + 1) }, (_, i) => mesIni + i), [mesIni, mesFim])
  const mesesReal = useMemo(() => meses.filter(m => m <= fechadoAte), [meses, fechadoAte])
  const mesesProj = useMemo(() => meses.filter(m => m > fechadoAte), [meses, fechadoAte])

  const filialFilter = useMemo(() => escopoFiltro(filialSel.length ? filialSel : null, filiais, 'filial', acesso.canSee), [filialSel, filiais, acesso])
  const ccFilter = useMemo(() => escopoFiltro(effectiveCcFilter(ccs, ccSel, areaSel, divisaoSel, buSel), ccs, 'centro_custo', acesso.canSee), [ccs, ccSel, areaSel, divisaoSel, buSel, acesso])
  const empFiltradas = useMemo(() => empresaSel.filter(id => acesso.canSee('empresa', id)), [empresaSel, acesso])

  // ⚠ Os dois lados compartilham a versão da projeção: os meses projetados
  // ficam idênticos POR CONSTRUÇÃO e a variação neles é zero de mentira.
  const projContamina = modo === 'REAL' && proj === 'ORCADO' && vBase === vComp && mesesProj.length > 0

  const todasSel = useMemo(
    () => Array.from(new Set([...secPonte.sel, ...secVar.sel, ...secAcur.sel])),
    [secPonte.sel, secVar.sel, secAcur.sel])

  const carregar = async () => {
    if (!relId || !vBase || !vComp || !linhas.length || !empFiltradas.length || !todasSel.length) { setDados(null); return }
    setCarregando(true); setErro(null)
    try {
      const base = { linhas, ccs, empresas: empFiltradas, filialFilter, ccFilter, ccPermitidos: null as string[] | null }
      const chamar = (cen: string, anos: number[], ms: number[]) =>
        ms.length ? totaisRelatorio({ ...base, cen, anos, meses: ms }) : Promise.resolve({} as Record<string, number>)

      // ── o lado BASE: sempre o orçado da versão escolhida
      const pBase = chamar(vBase, [anoBase!], meses)

      // ── o lado COMPARADO
      let pComp: Promise<Record<string, number>>
      let pProj: Promise<Record<string, number>> = Promise.resolve({})
      let fatorProj = 1
      if (modo === 'ORC') {
        pComp = chamar(vComp, [anoComp!], meses)
      } else {
        pComp = chamar('REALIZADO', [anoComp!], mesesReal)
        if (proj !== 'OFF' && mesesProj.length) {
          if (proj === 'ORCADO') {
            // a estimativa da própria empresa para aqueles meses
            pProj = chamar(vComp, [anoComp!], mesesProj)
          } else if (proj === 'MEDIA3') {
            const ult3 = [fechadoAte - 2, fechadoAte - 1, fechadoAte].filter(m => m >= 1)
            pProj = chamar('REALIZADO', [anoComp!], ult3)
            fatorProj = ult3.length ? mesesProj.length / ult3.length : 0
          } else {
            pProj = chamar('REALIZADO', [anoComp!], [fechadoAte].filter(m => m >= 1))
            fatorProj = mesesProj.length
          }
        }
      }

      // ── acurácia: orçado × realizado DO ANO COMPARADO, sempre
      const pOrcAnt = chamar(vComp, [anoComp!], meses)
      const pRealAnt = chamar('REALIZADO', [anoComp!], mesesReal.length ? mesesReal : meses)

      // ── mensal da base: alimenta o detector de "12 meses idênticos"
      const pMensal = Promise.all(meses.map(m => chamar(vBase, [anoBase!], [m])))

      const [b, c, pr, oa, ra, mens] = await Promise.all([pBase, pComp, pProj, pOrcAnt, pRealAnt, pMensal])

      const comp: Record<string, number> = { ...c }
      for (const k in pr) comp[k] = (comp[k] || 0) + pr[k] * fatorProj

      const mensalBase: Record<string, number[]> = {}
      mens.forEach((mm, i) => { for (const k in mm) (mensalBase[k] = mensalBase[k] || Array(meses.length).fill(0))[i] = mm[k] })

      setDados({ base: b, comp, orcAnt: oa, realAnt: ra, mensalBase })
    } catch (e: any) {
      setErro(e?.message ?? String(e)); setDados(null)
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() /* eslint-disable-next-line */ }, [relId, vBase, vComp, modo, mesIni, mesFim, proj, fechadoAte, todasSel.join(','), empFiltradas.join(','), filialSel.join(','), ccSel.join(','), areaSel.join(','), divisaoSel.join(','), buSel.join(','), linhas.length])

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
          <SalvarCardButton base="/dashboards/orcamento" cor="#5f3dc4"
            getFiltros={() => ({ relId, vBase, modo, vComp, mesIni, mesFim, proj, fechadoAte, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, secPonte, secVar, secAcur })} />
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

        {modo === 'REAL' && (
          <>
            <div><div style={S.lbl}>Fechado até</div>
              <select style={S.sel} value={fechadoAte} onChange={e => setFechadoAte(Number(e.target.value))}>
                <option value={0}>— nenhum —</option>
                {MES.map((m, i) => <option key={i} value={i + 1}>{m}/{String(anoComp ?? '').slice(-2)}</option>)}
              </select></div>
            <div><div style={S.lbl}>Meses seguintes</div>
              <select style={S.sel} value={proj} onChange={e => setProj(e.target.value as Proj)}>
                <option value="OFF">não projetar (ficam vazios)</option>
                <option value="ORCADO">projetar pelo orçado do ano</option>
                <option value="MEDIA3">projetar pela média dos 3 últimos</option>
                <option value="ULTIMO">projetar repetindo o último mês</option>
              </select></div>
          </>
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
      {modo === 'REAL' && proj === 'OFF' && mesesProj.length > 0 && (
        <Aviso tom="info">
          O realizado de {anoComp} vai até <strong>{MES[fechadoAte - 1] ?? '—'}</strong>.
          Os meses {MES[mesesProj[0] - 1]}–{MES[mesesProj[mesesProj.length - 1] - 1]} entram como <strong>zero</strong> do
          lado comparado — o crescimento aparece inflado.
        </Aviso>
      )}
      {modo === 'REAL' && proj !== 'OFF' && mesesProj.length > 0 && (
        <Aviso tom="info">
          {mesesProj.length} mês(es) <strong>projetado(s)</strong> do lado comparado
          ({proj === 'ORCADO' ? 'pelo orçado do ano' : proj === 'MEDIA3' ? 'pela média dos 3 últimos fechados' : 'repetindo o último mês'}).
          Projeção não é fato — confira antes de decidir com ela.
        </Aviso>
      )}
      {erro && <Aviso tom="alerta">{erro}</Aviso>}

      {!relId ? (
        <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48 }}>
          Escolha um <strong>relatório</strong> para começar.
        </div>
      ) : carregando ? (
        <div style={{ ...S.sec, textAlign: 'center', color: 'var(--muted)', padding: 48 }}>Calculando…</div>
      ) : !dados ? null : (
        <>
          <Ponte S={S} cfg={secPonte} setCfg={setSecPonte} linhas={linhas} nome={nome}
            base={dados.base} comp={dados.comp} rotuloBase={versao(vBase)?.codigo ?? ''} rotuloComp={rotuloComp} />

          <Variacao S={S} cfg={secVar} setCfg={setSecVar} linhas={linhas} nome={nome}
            base={dados.base} comp={dados.comp} val={val} rotuloBase={versao(vBase)?.codigo ?? ''} rotuloComp={rotuloComp} />

          <Acuracia S={S} cfg={secAcur} setCfg={setSecAcur} linhas={linhas} nome={nome}
            orc={dados.orcAnt} real={dados.realAnt} val={val} ano={anoComp} />

          <Alertas S={S} linhas={linhas} nome={nome} sel={secVar.sel}
            base={dados.base} comp={dados.comp} mensal={dados.mensalBase} val={val} nMeses={meses.length} />
        </>
      )}
    </div>
  )
}

// ============================================================
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
function Variacao({ S, cfg, setCfg, linhas, nome, base, comp, val, rotuloBase, rotuloComp }: any) {
  const total = cfg.sel.reduce((s: number, id: string) => s + Math.abs(val(base, id)), 0)
  const minAbs = total * (cfg.minPctTotal / 100)
  const todas = cfg.sel.map((id: string) => {
    const b = val(base, id), c = val(comp, id)
    return { id, nome: nome(id), b, c, d: b - c, pct: c !== 0 ? ((b - c) / Math.abs(c)) * 100 : (b !== 0 ? Infinity : 0) }
  })
  const marca = (x: any) => Math.abs(x.d) >= minAbs && (Math.abs(x.pct) >= cfg.pct || !Number.isFinite(x.pct))
  const destaque = todas.filter(marca).sort((a: any, b: any) => Math.abs(b.d) - Math.abs(a.d))
  const resto = todas.filter((x: any) => !marca(x))
  const somaResto = resto.reduce((s: number, x: any) => s + x.d, 0)

  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>O que mudou</div>
          <div style={S.secD}>
            Ordenado por <strong>impacto</strong>, não por tamanho. Marcado o que passa de {cfg.pct}% <em>e</em> de {cfg.minPctTotal}% do total ({fmt(minAbs)}).
          </div></div>
        <SelLinhas cfg={cfg} setCfg={setCfg} linhas={linhas} limiar />
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...S.th, textAlign: 'left' }}>linha</th>
          <th style={S.th}>{rotuloComp}</th><th style={S.th}>{rotuloBase}</th>
          <th style={S.th}>variação</th><th style={S.th}>%</th>
        </tr></thead>
        <tbody>
          {destaque.map((x: any) => (
            <tr key={x.id}>
              <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>{x.nome}</td>
              <td style={S.td}>{fmt(x.c)}</td><td style={S.td}>{fmt(x.b)}</td>
              <td style={{ ...S.td, color: x.d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{x.d >= 0 ? '+' : ''}{fmt(x.d)}</td>
              <td style={{ ...S.td, color: 'var(--muted)' }}>{Number.isFinite(x.pct) ? fmtPct(x.pct) : 'novo'}</td>
            </tr>
          ))}
          {resto.length > 0 && (
            <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--muted)', fontStyle: 'italic' }}>
              demais {resto.length} linha(s), abaixo do limiar</td>
              <td style={S.td} /><td style={S.td} />
              <td style={{ ...S.td, color: 'var(--muted)' }}>{somaResto >= 0 ? '+' : ''}{fmt(somaResto)}</td><td style={S.td} /></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── 3 · ACURÁCIA DO ORÇAMENTO ANTERIOR ──────────────────────
// Não serve para julgar o passado: serve para CALIBRAR A CONFIANÇA no futuro.
// Linha que errou 12% e vem com número redondo e confiante merece pergunta.
function Acuracia({ S, cfg, setCfg, linhas, nome, orc, real, val, ano }: any) {
  const itens = cfg.sel.map((id: string) => {
    const o = val(orc, id), r = val(real, id)
    return { id, nome: nome(id), o, r, erro: r - o, pct: o !== 0 ? ((r - o) / Math.abs(o)) * 100 : (r !== 0 ? Infinity : 0) }
  }).filter((x: any) => x.o !== 0 || x.r !== 0)
    .sort((a: any, b: any) => Math.abs(b.erro) - Math.abs(a.erro))

  return (
    <div style={S.sec}>
      <div style={S.secH}>
        <div><div style={S.secT}>Acurácia do orçamento de {ano ?? '—'}</div>
          <div style={S.secD}>
            Orçado × realizado do ano comparado. Não é para julgar o passado — é para saber
            <strong> em quem acreditar</strong> no orçamento novo.
          </div></div>
        <SelLinhas cfg={cfg} setCfg={setCfg} linhas={linhas} />
      </div>
      {!itens.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sem dados no ano comparado.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...S.th, textAlign: 'left' }}>linha</th>
            <th style={S.th}>orçado</th><th style={S.th}>realizado</th><th style={S.th}>erro</th><th style={S.th}>%</th>
            <th style={{ ...S.th, textAlign: 'left' }}>leitura</th>
          </tr></thead>
          <tbody>
            {itens.map((x: any) => {
              const a = Math.abs(x.pct)
              const leitura = !Number.isFinite(x.pct) ? 'não estava orçado'
                : a < 5 ? 'acertou' : a < 15 ? (x.erro > 0 ? 'passou do orçado' : 'ficou abaixo') : '⚠ errou muito'
              return (
                <tr key={x.id}>
                  <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>{x.nome}</td>
                  <td style={S.td}>{fmt(x.o)}</td><td style={S.td}>{fmt(x.r)}</td>
                  <td style={{ ...S.td, color: a >= 15 ? 'var(--orange)' : 'var(--text-mid)' }}>{x.erro >= 0 ? '+' : ''}{fmt(x.erro)}</td>
                  <td style={{ ...S.td, color: 'var(--muted)' }}>{Number.isFinite(x.pct) ? fmtPct(x.pct) : '—'}</td>
                  <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontSize: 12, color: a >= 15 ? 'var(--orange)' : 'var(--muted)' }}>{leitura}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
