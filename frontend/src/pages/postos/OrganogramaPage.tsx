import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { PostosPills } from './PostosPills'
import { useUserAccess } from '../../hooks/useUserAccess'
import { pageAll } from '../../lib/pageAll'
import { ChevronDown, ChevronRight, Users, X, Maximize2, Minimize2 } from 'lucide-react'

// ============================================================
// Organograma do quadro — leitura.
//
// ⚠ NÃO é um organograma de PESSOAS: `posto` não tem gestor/superior, e `cargo`
// não tem nível, então "quem reporta a quem" não existe no dado nem dá para
// inferir (um "ANAL. NEGOCIO III" sob um "SOCIO ADMINISTRADOR" seria chute).
// O que existe é a estrutura por onde o quadro se distribui — e aí a árvore de
// centro de custo é real: 79 de 84 CCs têm pai, três níveis.
//
// Por isso a FONTE da hierarquia é um seletor, não uma constante: hoje a árvore
// de CC (a íntegra), com Área/Divisão/BU como agrupamentos alternativos (estão
// em `centro_custo`, mas preenchidos só em parte — o seletor mostra quanto).
// Quando `posto.gestor_posto_id` existir, entra como mais uma opção e esta tela
// não precisa ser reescrita: vira problema de cadastro, não de código.
//
// Dimensionado por HEADCOUNT de propósito. Por custo seria mais útil num
// orçamento, mas custo depende de `posto.salario` (v3_142) e a tela ficaria com
// caixas de área zero para quem foi negado — um gráfico que mente por omissão.
// Pessoas todo mundo pode contar.
// ============================================================

type Posto = {
  id: string; codigo: string; nome: string | null; matricula: string | null
  cargo_id: string | null; cc_id: string | null; empresa_id: string; filial_id: string | null
  fte: number | null; ativo: boolean | null; regime: string | null
}
type CC = {
  id: string; codigo: string; descricao: string | null; pai_id: string | null
  area_nome: string | null; divisao_nome: string | null; bu_nome: string | null
}
type No = {
  key: string; codigo: string; nome: string
  pessoas: number; postos: number; fte: number     // próprios
  tPessoas: number; tPostos: number; tFte: number  // com descendentes
  filhos: No[]; ccIds: string[]; nivel: number
}

const FONTES = [
  { k: 'cc',      label: 'Árvore de centro de custo' },
  { k: 'area',    label: 'Área' },
  { k: 'divisao', label: 'Divisão' },
  { k: 'bu',      label: 'Unidade de negócio' },
] as const
type Fonte = typeof FONTES[number]['k']

const SEM = '— sem classificação —'
const nf = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 820, lineHeight: 1.5 },
  bar:   { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '20px 0 16px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 26, fontWeight: 700, color: 'var(--text)', marginTop: 4, fontVariantNumeric: 'tabular-nums' },
  kpiH:  { fontSize: 11.5, color: 'var(--muted)', marginTop: 2 },
  wrap:  { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' },
  canvas:{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, overflowX: 'auto' },
  side:  { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, position: 'sticky', top: 12 },
  sideT: { fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pess:  { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 },
  vazio: { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 },
}

// Caixa de um nó: código, nome, e a barra que dá a leitura visual do tamanho.
function Caixa({ n, max, aberto, temFilhos, onToggle, onSel, sel }: {
  n: No; max: number; aberto: boolean; temFilhos: boolean
  onToggle: () => void; onSel: () => void; sel: boolean
}) {
  const pct = max > 0 ? Math.max(2, Math.round((n.tPessoas / max) * 100)) : 0
  return (
    <div onClick={onSel}
      style={{ minWidth: 248, maxWidth: 248, background: sel ? 'rgba(139,92,246,0.14)' : 'var(--bg-soft)',
               border: '1px solid ' + (sel ? 'var(--violet)' : 'var(--border-strong)'), borderRadius: 10,
               padding: '9px 11px', cursor: 'pointer', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {temFilhos
          ? <span onClick={e => { e.stopPropagation(); onToggle() }}
                  style={{ display: 'flex', color: 'var(--muted)' }} title={aberto ? 'Recolher' : 'Expandir'}>
              {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          : <span style={{ width: 14 }} />}
        <span style={{ fontSize: 11, color: 'var(--violet)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n.codigo}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, overflow: 'hidden',
                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.nome}>{n.nome}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '7px 0 5px', paddingLeft: 20 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{n.tPessoas}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          pessoa{n.tPessoas === 1 ? '' : 's'} · {nf(n.tFte)} FTE
          {temFilhos && n.pessoas > 0 && <> · <b style={{ color: 'var(--text-mid)' }}>{n.pessoas}</b> aqui</>}
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: 'var(--border)', marginLeft: 20, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: 'var(--violet)', borderRadius: 99 }} />
      </div>
    </div>
  )
}

// Árvore da esquerda para a direita: com 16 irmãos por pai, empilhar na vertical
// é o que cabe na tela — de cima para baixo viraria rolagem horizontal infinita.
function Ramo({ n, max, abertos, toggle, sel, setSel }: {
  n: No; max: number; abertos: Set<string>; toggle: (k: string) => void
  sel: string | null; setSel: (k: string) => void
}) {
  const temFilhos = n.filhos.length > 0
  const aberto = abertos.has(n.key)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Caixa n={n} max={max} aberto={aberto} temFilhos={temFilhos}
               onToggle={() => toggle(n.key)} onSel={() => setSel(n.key)} sel={sel === n.key} />
        {temFilhos && aberto && <div style={{ width: 18, height: 1, background: 'var(--border-strong)' }} />}
      </div>
      {temFilhos && aberto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '1px solid var(--border-strong)', paddingLeft: 18 }}>
          {n.filhos.map(f => (
            <Ramo key={f.key} n={f} max={max} abertos={abertos} toggle={toggle} sel={sel} setSel={setSel} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function OrganogramaPage() {
  const acesso = useUserAccess()
  const [postos, setPostos] = useState<Posto[]>([])
  const [ccs, setCcs] = useState<CC[]>([])
  const [cargos, setCargos] = useState<Record<string, string>>({})
  const [empresas, setEmpresas] = useState<{ id: string; codigo: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [fonte, setFonte] = useState<Fonte>('cc')
  const [empresaId, setEmpresaId] = useState('')
  const [comDemitidos, setComDemitidos] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    if (acesso.loading) return
    ;(async () => {
      const [pd, cd, gd, ed] = await Promise.all([
        pageAll(() => supabase.from('posto_v').select('id,codigo,nome,matricula,cargo_id,cc_id,empresa_id,filial_id,fte,ativo,regime')),
        pageAll(() => supabase.from('centro_custo').select('id,codigo,descricao,pai_id,area_nome,divisao_nome,bu_nome').eq('ativo', true).order('codigo')),
        pageAll(() => supabase.from('cargo').select('id,nome')),
        supabase.from('empresa').select('id,codigo').order('codigo').then(r => r.data || []),
      ])
      setPostos(pd as Posto[]); setCcs(cd as CC[])
      setCargos(Object.fromEntries((gd as any[]).map(c => [c.id, c.nome])))
      setEmpresas(ed as any[]); setLoading(false)
    })()
  }, [acesso.loading])

  const filtrados = useMemo(
    () => postos.filter(p => (comDemitidos || p.ativo !== false) && (!empresaId || p.empresa_id === empresaId)),
    [postos, empresaId, comDemitidos])

  // Headcount = matrículas distintas; posto sem matrícula é vaga e conta sozinho.
  // Mesma definição da grade, para os dois números nunca discordarem.
  const chave = (p: Posto) => (p.matricula || '').trim() || `__posto_${p.id}`

  const { raizes, max, total } = useMemo(() => {
    const porCc: Record<string, Posto[]> = {}
    for (const p of filtrados) (porCc[p.cc_id || '__sem'] ||= []).push(p)

    const conta = (ps: Posto[]) => ({
      pessoas: new Set(ps.map(chave)).size,
      postos: ps.length,
      fte: ps.reduce((s, p) => s + (Number(p.fte) || 0), 0),
    })

    let raizes: No[] = []

    if (fonte === 'cc') {
      // Árvore de verdade. Um nó por CC; os totais sobem pelos descendentes.
      const nos: Record<string, No> = {}
      for (const c of ccs) {
        const own = conta(porCc[c.id] || [])
        nos[c.id] = { key: c.id, codigo: c.codigo, nome: c.descricao || '', ...own,
                      tPessoas: 0, tPostos: 0, tFte: 0, filhos: [], ccIds: [c.id], nivel: 0 }
      }
      for (const c of ccs) {
        const pai = c.pai_id && nos[c.pai_id] ? nos[c.pai_id] : null
        if (pai) pai.filhos.push(nos[c.id]); else raizes.push(nos[c.id])
      }
      // Soma de baixo para cima. Recursivo: a árvore tem 3 níveis, não há risco
      // de estourar pilha — e um ciclo em pai_id travaria aqui, então guarda.
      const vistos = new Set<string>()
      const subir = (n: No): void => {
        if (vistos.has(n.key)) return
        vistos.add(n.key)
        let tp = n.pessoas, tq = n.postos, tf = n.fte
        const ids = [...n.ccIds]
        for (const f of n.filhos) { subir(f); tq += f.tPostos; tf += f.tFte; ids.push(...f.ccIds) }
        // pessoas não somam direto: a mesma matrícula pode aparecer em dois CCs
        const ps = ids.flatMap(id => porCc[id] || [])
        tp = new Set(ps.map(chave)).size
        n.tPessoas = tp; n.tPostos = tq; n.tFte = tf; n.ccIds = ids
      }
      raizes.forEach(subir)
      raizes.sort((a, b) => b.tPessoas - a.tPessoas)
      raizes.forEach(function ord(n: No) { n.filhos.sort((a, b) => b.tPessoas - a.tPessoas); n.filhos.forEach(ord) })
    } else {
      // Agrupamento plano em dois níveis: grupo → CC. O campo vem de
      // centro_custo e pode estar vazio — o balde "sem classificação" é
      // explícito, porque esconder o que não foi classificado é o jeito de o
      // total não fechar e ninguém notar.
      const campo = fonte === 'area' ? 'area_nome' : fonte === 'divisao' ? 'divisao_nome' : 'bu_nome'
      const grupos: Record<string, No> = {}
      for (const c of ccs) {
        const ps = porCc[c.id] || []
        if (!ps.length) continue
        const g = ((c as any)[campo] as string | null)?.trim() || SEM
        const no = (grupos[g] ||= { key: 'g:' + g, codigo: '', nome: g, pessoas: 0, postos: 0, fte: 0,
                                    tPessoas: 0, tPostos: 0, tFte: 0, filhos: [], ccIds: [], nivel: 0 })
        no.filhos.push({ key: c.id, codigo: c.codigo, nome: c.descricao || '', ...conta(ps),
                         tPessoas: conta(ps).pessoas, tPostos: ps.length, tFte: conta(ps).fte,
                         filhos: [], ccIds: [c.id], nivel: 1 })
        no.ccIds.push(c.id)
      }
      raizes = Object.values(grupos)
      for (const g of raizes) {
        const ps = g.ccIds.flatMap(id => porCc[id] || [])
        const t = conta(ps)
        g.tPessoas = t.pessoas; g.tPostos = t.postos; g.tFte = t.fte
        g.filhos.sort((a, b) => b.tPessoas - a.tPessoas)
      }
      raizes.sort((a, b) => b.tPessoas - a.tPessoas)
    }

    // Postos sem CC entram como nó próprio: no orçamento eles existem, e um
    // organograma que os omite mostra um quadro menor que o real.
    const semCc = porCc['__sem'] || []
    if (semCc.length) {
      const t = conta(semCc)
      raizes.push({ key: '__sem', codigo: '—', nome: 'Sem centro de custo', ...t,
                    tPessoas: t.pessoas, tPostos: t.postos, tFte: t.fte, filhos: [], ccIds: ['__sem'], nivel: 0 })
    }

    const max = Math.max(1, ...raizes.map(r => r.tPessoas))
    const total = {
      pessoas: new Set(filtrados.map(chave)).size,
      postos: filtrados.length,
      fte: filtrados.reduce((s, p) => s + (Number(p.fte) || 0), 0),
      nos: raizes.length,
    }
    return { raizes, max, total }
  }, [filtrados, ccs, fonte])

  // Começa com o primeiro nível aberto: a tela abre mostrando a estrutura, não
  // uma lista de caixas fechadas que a pessoa tem de descobrir que clica.
  useEffect(() => { setAbertos(new Set(raizes.map(r => r.key))) }, [fonte, empresaId])

  const todos = useMemo(() => {
    const out: No[] = []
    const vai = (n: No) => { out.push(n); n.filhos.forEach(vai) }
    raizes.forEach(vai)
    return out
  }, [raizes])

  const noSel = sel ? todos.find(n => n.key === sel) : null
  const pessoasSel = useMemo(() => {
    if (!noSel) return []
    const ids = new Set(noSel.ccIds)
    return filtrados
      .filter(p => ids.has(p.cc_id || '__sem'))
      .sort((a, b) => (a.nome || a.codigo).localeCompare(b.nome || b.codigo))
  }, [noSel, filtrados])

  const preench = useMemo(() => {
    const c = (f: keyof CC) => ccs.filter(x => (x[f] as string | null)?.trim()).length
    return { area: c('area_nome'), divisao: c('divisao_nome'), bu: c('bu_nome'), tot: ccs.length }
  }, [ccs])

  return (
    <div style={S.page}>
      <div>
        <h1 style={S.title}>Organograma do quadro</h1>
        <p style={S.sub}>
          Como o quadro se distribui pela estrutura, dimensionado por <b>pessoas</b>. Clique numa caixa
          para ver quem está nela. <span style={{ color: 'var(--text-mid)' }}>Não é hierarquia de chefia</span> —
          o posto ainda não guarda gestor, então a estrutura aqui é a de centro de custo.
        </p>
      </div>
      <PostosPills />

      <div style={S.bar}>
        <div style={S.fld}>
          <span style={S.lbl}>Hierarquia</span>
          <select style={S.sel} value={fonte} onChange={e => { setFonte(e.target.value as Fonte); setSel(null) }}>
            {FONTES.map(f => {
              const n = f.k === 'cc' ? 0 : preench[f.k as 'area' | 'divisao' | 'bu']
              return <option key={f.k} value={f.k}>
                {f.label}{f.k !== 'cc' ? ` (${n} de ${preench.tot} CCs)` : ''}
              </option>
            })}
          </select>
        </div>
        <div style={S.fld}>
          <span style={S.lbl}>Empresa</span>
          <select style={S.sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
            <option value="">Todas</option>
            {acesso.filterList('empresa', empresas).map(e => <option key={e.id} value={e.id}>{e.codigo}</option>)}
          </select>
        </div>
        <button style={S.btn} onClick={() => setAbertos(new Set(todos.map(n => n.key)))}><Maximize2 size={14} /> Expandir tudo</button>
        <button style={S.btn} onClick={() => setAbertos(new Set())}><Minimize2 size={14} /> Recolher</button>
        <button style={{ ...S.btn, ...(comDemitidos ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : {}) }}
                onClick={() => setComDemitidos(v => !v)}
                title="Postos inativos (demitidos) ficam fora por padrão, como na grade.">
          <Users size={14} /> {comDemitidos ? 'Com demitidos' : 'Só ativos'}
        </button>
      </div>

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Pessoas</div><div style={S.kpiV}>{total.pessoas}</div>
          <div style={S.kpiH}>matrículas distintas</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Postos</div><div style={S.kpiV}>{total.postos}</div>
          <div style={S.kpiH}>{total.postos - total.pessoas} a mais que pessoas</div></div>
        <div style={S.kpi}><div style={S.kpiL}>FTE</div><div style={S.kpiV}>{nf(total.fte)}</div>
          <div style={S.kpiH}>inclui ½ períodos</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Nós no 1º nível</div><div style={S.kpiV}>{total.nos}</div>
          <div style={S.kpiH}>{FONTES.find(f => f.k === fonte)?.label}</div></div>
      </div>

      {loading ? <div style={S.vazio}>Carregando…</div> : (
        <div style={S.wrap}>
          <div style={S.canvas}>
            {raizes.length === 0
              ? <div style={S.vazio}>Nenhum posto no escopo atual.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 'min-content' }}>
                  {raizes.map(r => (
                    <Ramo key={r.key} n={r} max={max} abertos={abertos}
                          toggle={k => setAbertos(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })}
                          sel={sel} setSel={setSel} />
                  ))}
                </div>}
          </div>

          <div style={S.side}>
            {!noSel ? (
              <div style={S.vazio}>
                <b style={{ color: 'var(--text)' }}>Clique numa caixa</b> para ver quem está nela —
                nome, cargo e FTE, já somando os CCs abaixo dela.
              </div>
            ) : (
              <>
                <div style={S.sideT}>
                  <span>{noSel.codigo && <span style={{ color: 'var(--violet)' }}>{noSel.codigo} · </span>}{noSel.nome}</span>
                  <X size={15} style={{ cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }} onClick={() => setSel(null)} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '3px 0 10px' }}>
                  {noSel.tPessoas} pessoa{noSel.tPessoas === 1 ? '' : 's'} · {noSel.tPostos} posto(s) · {nf(noSel.tFte)} FTE
                  {noSel.filhos.length > 0 && <> · {noSel.filhos.length} abaixo</>}
                </div>
                <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                  {pessoasSel.map(p => (
                    <div key={p.id} style={S.pess}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ color: 'var(--text)', fontWeight: 600, display: 'block', overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.nome || <i style={{ color: 'var(--muted)', fontWeight: 400 }}>vaga planejada</i>}
                        </span>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                          {cargos[p.cargo_id || ''] || '—'}{p.regime ? ' · ' + p.regime.replace('BR-', '') : ''}
                        </span>
                      </span>
                      <span style={{ color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{nf(Number(p.fte) || 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
