import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronLeft, AlertTriangle, Layers, ListFilter, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { carregarVersoes } from '../../lib/escopoDados'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useLocalPref } from '../../lib/uiPrefs'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { useCapacidades } from '../../hooks/useCapacidades'
import DrillCombinacoes from './DrillCombinacoes'
import NovoCenario from './NovoCenario'

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
    if (selecionar) setVersaoId(selecionar)
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
  const total = useMemo(() => {
    const out: Record<string, Record<number, number>> = {}
    const filhos: Record<string, Linha[]> = {}
    linhas.forEach(l => { const k = l.pai_id || '__root'; (filhos[k] = filhos[k] || []).push(l) })
    const calc = (l: Linha): Record<number, number> => {
      if (out[l.id]) return out[l.id]
      const r: Record<number, number> = {}
      const fs = filhos[l.id] || []
      if (fs.length) { for (const f of fs) { const v = calc(f); for (let m = 1; m <= 12; m++) r[m] = (r[m] || 0) + (v[m] || 0) } }
      else { const c = (l.linha_orc_id && !l.nao_soma ? cels[l.linha_orc_id] : null) || {}; for (let m = 1; m <= 12; m++) r[m] = c[m]?.v || 0 }
      out[l.id] = r; return r
    }
    linhas.forEach(calc)
    return out
  }, [linhas, cels])

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

  // Carrega o consolidado. Lê fat_orcado direto (e não a RPC de agregação)
  // porque além do total precisamos saber se há GRÃO MISTO — e isso só se vê
  // olhando se existem linhas com cc nulo e não nulo na mesma célula.
  useEffect(() => {
    if (!versaoId || !empresasEscopo.length) { setCels({}); setMisto(new Set()); return }
    let vivo = true
    ;(async () => {
      setCarregandoCels(true); setErro('')
      try {
        const alvo = filtro.emp ?? empresasEscopo.map(e => e.id)
        let q = supabase.from('fat_orcado')
          .select('linha_id,mes,valor,cc_id').eq('versao_id', versaoId).eq('ano', ano).in('empresa_id', alvo)
        if (filtro.fil) q = q.in('filial_id', filtro.fil)
        if (filtro.cc) q = q.in('cc_id', filtro.cc)
        const rows = await pageAll(() => q)
        if (!vivo) return
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
        setCels(c); setMisto(mix)
      } catch (e: any) { if (vivo) setErro(e?.message || String(e)) }
      finally { if (vivo) setCarregandoCels(false) }
    })()
    return () => { vivo = false }
  }, [versaoId, ano, empresasEscopo.length, recarga, JSON.stringify(filtro)]) // eslint-disable-line


  const anos = useMemo(() => [...new Set(versoes.map(v => v.ano).filter(Boolean))].sort((a, b) => b - a), [versoes])

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
            {/* Cenário aparece recuado e marcado: a baseline e a proposta
                estão no mesmo combo, e confundi-las é digitar no orçamento
                oficial pensando estar propondo. */}
            <select style={S.sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
              <option value="">— selecione —</option>
              {versoes.map(v => <option key={v.id} value={v.id}>
                {v.origem_versao_id ? '↳ ' : ''}{v.codigo}{v.origem_versao_id ? ' · cenário' : ''}{v.bloqueada ? ' 🔒' : ''}
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
      </div>

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
              {MES.map(m => <th key={m} style={S.th}>{m}</th>)}
              <th style={{ ...S.th, color: 'var(--text)' }}>Ano</th>
            </tr></thead>
            <tbody>
              {vis.map(l => {
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
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <td key={m} style={{ ...S.td, color: (t[m] || 0) === 0 ? 'var(--faint)' : sint ? 'var(--text)' : 'var(--text-mid)', fontWeight: sint ? 600 : 400 }}>
                        {(t[m] || 0) === 0 ? '—' : money((t[m] || 0) * f)}
                      </td>
                    ))}
                    <td style={{ ...S.td, fontWeight: 700, color: anoT === 0 ? 'var(--faint)' : 'var(--text)' }}>
                      {anoT === 0 ? '—' : money(anoT * f)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {carregandoCels && <div style={{ padding: 10, fontSize: 12, color: 'var(--muted)' }}>Somando…</div>}
          {/* Quem confere total precisa saber que há linha fora da vista, senão
              procura defeito no número. */}
          {ordered.length > vis.length && (
            <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
              {ordered.length - vis.length} linha(s) ocultas pelos filtros de exibição — os totais acima continuam somando tudo.
            </div>
          )}
        </div>
      )}

      {drill && versao && (
        <DrillCombinacoes
          linha={drill} versao={versao} ano={ano}
          empresas={filtro.emp ? empresasEscopo.filter(e => filtro.emp!.includes(e.id)) : empresasEscopo}
          onFechar={(mudou: boolean) => { setDrill(null); if (mudou) setRecarga(n => n + 1) }}
        />
      )}
    </div>
  )
}
