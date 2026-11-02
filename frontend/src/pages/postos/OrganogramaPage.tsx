import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { PostosPills } from './PostosPills'
import { useUserAccess } from '../../hooks/useUserAccess'
import { pageAll } from '../../lib/pageAll'
import { ChevronDown, ChevronRight, Users, X, Maximize2, Minimize2, Pencil } from 'lucide-react'

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
  fte: number | null; ativo: boolean | null; regime: string | null; area_func_id: string | null
}
type CC = {
  id: string; codigo: string; descricao: string | null; pai_id: string | null
  area_nome: string | null; divisao_nome: string | null; bu_nome: string | null
}
type Area = { id: string; codigo: string; nome: string; pai_id: string | null }
type No = {
  key: string; codigo: string; nome: string
  pessoas: number; postos: number; fte: number     // próprios
  tPessoas: number; tPostos: number; tFte: number  // com descendentes
  filhos: No[]; ccIds: string[]; nivel: number
}

const FONTES = [
  { k: 'areaf',   label: 'Área funcional (organograma)' },
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
  dica:  { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
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

// Facilitador de atribuição. O gesto que resolve a maioria é FILTRAR POR CC e
// atribuir o lote inteiro: a maior parte dos CCs corresponde a uma área só.
// Sobra o CC 111 "Administrativo Geral", que abriga Financeiro, Contabilidade,
// Facilities e Jurídico juntos — esses vão um a um, pelo seletor da linha.
function Atribuir({ postos, ccs, areas, caminho, cargos, onFim }: {
  postos: Posto[]; ccs: CC[]; areas: Area[]; caminho: Record<string, string>
  cargos: Record<string, string>; onFim: () => void
}) {
  const [ccFiltro, setCcFiltro] = useState('')
  const [soSem, setSoSem] = useState(true)
  const [lote, setLote] = useState('')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)

  const ccNome = Object.fromEntries(ccs.map(c => [c.id, `${c.codigo} · ${c.descricao || ''}`]))
  const opcoes = [...areas].sort((a, b) => caminho[a.id].localeCompare(caminho[b.id]))

  const lista = useMemo(() => postos.filter(p =>
    (!ccFiltro || (p.cc_id || '__sem') === ccFiltro) &&
    (!soSem || !p.area_func_id) &&
    (!busca.trim() || `${p.nome || ''} ${p.codigo} ${p.matricula || ''}`.toLowerCase().includes(busca.trim().toLowerCase()))
  ), [postos, ccFiltro, soSem, busca])

  // Grava e CONFERE o retorno: update barrado por RLS não dá erro — filtra as
  // linhas, afeta zero e volta sucesso. Sem esta conferência a tela mentiria.
  const gravar = async (ids: string[], areaId: string | null) => {
    if (!ids.length) return
    setErro(''); setGravando(true)
    const { data, error } = await supabase.from('posto').update({ area_func_id: areaId }).in('id', ids).select('id')
    setGravando(false)
    if (error) { setErro(error.message); return }
    if (!data || data.length < ids.length) {
      setErro(`Gravou ${data?.length ?? 0} de ${ids.length}. As demais estão fora do seu escopo de edição.`)
    }
    onFim()
  }

  const semArea = postos.filter(p => !p.area_func_id).length
  return (
    <div>
      <div style={{ ...S.kpi, marginBottom: 14 }}>
        <div style={S.kpiL}>Progresso</div>
        <div style={{ ...S.kpiV, fontSize: 20 }}>{postos.length - semArea} de {postos.length}</div>
        <div style={S.kpiH}>postos com área funcional · faltam {semArea}</div>
      </div>

      {erro && <div style={S.aviso}>{erro}</div>}

      <div style={S.bar}>
        <div style={S.fld}>
          <span style={S.lbl}>Centro de custo</span>
          <select style={{ ...S.sel, maxWidth: 300 }} value={ccFiltro} onChange={e => setCcFiltro(e.target.value)}>
            <option value="">Todos</option>
            <option value="__sem">— sem centro de custo —</option>
            {ccs.filter(c => postos.some(p => p.cc_id === c.id)).map(c =>
              <option key={c.id} value={c.id}>{ccNome[c.id]} ({postos.filter(p => p.cc_id === c.id).length})</option>)}
          </select>
        </div>
        <div style={S.fld}>
          <span style={S.lbl}>Buscar</span>
          <input style={{ ...S.sel, minWidth: 180 }} placeholder="nome, matrícula…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <button style={{ ...S.btn, ...(soSem ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : {}) }}
                onClick={() => setSoSem(v => !v)}>{soSem ? 'Só sem área' : 'Todos'}</button>
      </div>

      <div style={{ ...S.bar, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', margin: '0 0 14px' }}>
        <div style={S.fld}>
          <span style={S.lbl}>Atribuir em lote</span>
          <select style={{ ...S.sel, minWidth: 340 }} value={lote} onChange={e => setLote(e.target.value)}>
            <option value="">escolha a área…</option>
            {opcoes.map(a => <option key={a.id} value={a.id}>{caminho[a.id]}</option>)}
          </select>
        </div>
        <button style={{ ...S.btn, borderColor: 'var(--violet)', color: 'var(--violet)',
                         opacity: lote && lista.length && !gravando ? 1 : 0.4,
                         cursor: lote && lista.length && !gravando ? 'pointer' : 'not-allowed' }}
                disabled={!lote || !lista.length || gravando}
                onClick={() => {
                  if (!window.confirm(`Atribuir "${caminho[lote]}" a ${lista.length} posto(s) filtrado(s)?`)) return
                  gravar(lista.map(p => p.id), lote)
                }}>
          {gravando ? 'Gravando…' : `Aplicar aos ${lista.length} filtrados`}
        </button>
      </div>

      <div style={{ ...S.canvas, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>
            {['Posto', 'Ocupante', 'Cargo', 'Centro de custo', 'Área funcional'].map(h =>
              <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10.5, color: 'var(--muted)',
                                   textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {lista.slice(0, 400).map(p => (
              <tr key={p.id}>
                <td style={{ padding: '5px 8px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{p.codigo}</td>
                <td style={{ padding: '5px 8px', color: 'var(--text)' }}>{p.nome || <i style={{ color: 'var(--muted)' }}>vaga</i>}</td>
                <td style={{ padding: '5px 8px', color: 'var(--text-mid)' }}>{cargos[p.cargo_id || ''] || '—'}</td>
                <td style={{ padding: '5px 8px', color: 'var(--text-mid)' }}>{ccNome[p.cc_id || ''] || '—'}</td>
                <td style={{ padding: '5px 8px' }}>
                  <select style={{ ...S.sel, padding: '4px 6px', fontSize: 12, minWidth: 260 }}
                          value={p.area_func_id || ''} onChange={e => gravar([p.id], e.target.value || null)}>
                    <option value="">—</option>
                    {opcoes.map(a => <option key={a.id} value={a.id}>{caminho[a.id]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length > 400 && <div style={{ ...S.dica, marginTop: 10 }}>Mostrando 400 de {lista.length} — filtre por centro de custo para ver o resto.</div>}
        {lista.length === 0 && <div style={S.vazio}>Nada no filtro atual.{soSem && ' Todos os postos deste recorte já têm área.'}</div>}
      </div>
    </div>
  )
}

export default function OrganogramaPage() {
  const acesso = useUserAccess()
  const [postos, setPostos] = useState<Posto[]>([])
  const [ccs, setCcs] = useState<CC[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [cargos, setCargos] = useState<Record<string, string>>({})
  const [empresas, setEmpresas] = useState<{ id: string; codigo: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [fonte, setFonte] = useState<Fonte>('areaf')
  const [empresaId, setEmpresaId] = useState('')
  const [comDemitidos, setComDemitidos] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [modo, setModo] = useState<'ver' | 'atribuir'>('ver')
  const [erro, setErro] = useState('')

  // try/finally não é zelo: sem ele, UMA consulta que falha deixa `loading` em
  // true para sempre e a tela fica "Carregando…" com tudo zerado — que é o
  // sintoma mais caro de depurar, porque não diz nada. Aconteceu de verdade
  // quando `posto_v` ainda não tinha `area_func_id` (v3_147).
  const carregar = async () => {
    try {
    const [pd, cd, gd, ed, ad] = await Promise.all([
      pageAll(() => supabase.from('posto_v').select('id,codigo,nome,matricula,cargo_id,cc_id,empresa_id,filial_id,fte,ativo,regime,area_func_id')),
      pageAll(() => supabase.from('centro_custo').select('id,codigo,descricao,pai_id,area_nome,divisao_nome,bu_nome').eq('ativo', true).order('codigo')),
      pageAll(() => supabase.from('cargo').select('id,nome')),
      supabase.from('empresa').select('id,codigo').order('codigo').then(r => r.data || []),
      pageAll(() => supabase.from('area_funcional').select('id,codigo,nome,pai_id').eq('ativo', true).order('codigo')),
    ])
    setPostos(pd as Posto[]); setCcs(cd as CC[])
    setCargos(Object.fromEntries((gd as any[]).map(c => [c.id, c.nome])))
    setEmpresas(ed as any[]); setAreas(ad as Area[])
    setErro('')
    } catch (e: any) {
      setErro(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (!acesso.loading) carregar() }, [acesso.loading])

  const filtrados = useMemo(
    () => postos.filter(p => (comDemitidos || p.ativo !== false) && (!empresaId || p.empresa_id === empresaId)),
    [postos, empresaId, comDemitidos])

  // Headcount = matrículas distintas; posto sem matrícula é vaga e conta sozinho.
  // Mesma definição da grade, para os dois números nunca discordarem.
  const chave = (p: Posto) => (p.matricula || '').trim() || `__posto_${p.id}`

  // Por qual coluna o nó agrupa. Vive aqui, e não dentro do useMemo, porque o
  // painel lateral precisa da MESMA resposta — ele testava `cc_id` fixo, e na
  // visão funcional nenhum posto casava: a lista vinha vazia sem dizer por quê.
  const campoFonte: 'cc_id' | 'area_func_id' = fonte === 'areaf' ? 'area_func_id' : 'cc_id'

  const { raizes, max, total } = useMemo(() => {
    // Agrupa pela dimensão da fonte. `__sem` junta quem não tem nada ali.
    const porItem: Record<string, Posto[]> = {}
    for (const p of filtrados) (porItem[(p as any)[campoFonte] || '__sem'] ||= []).push(p)

    const conta = (ps: Posto[]) => ({
      pessoas: new Set(ps.map(chave)).size,
      postos: ps.length,
      fte: ps.reduce((s, p) => s + (Number(p.fte) || 0), 0),
    })

    // Montador genérico de árvore. Serve CC e área funcional hoje, e serve
    // gestor quando a coluna existir — era para isto que a fonte é um seletor.
    const montar = (itens: { id: string; codigo: string; nome: string; pai_id: string | null }[]): No[] => {
      const nos: Record<string, No> = {}
      for (const c of itens) {
        const own = conta(porItem[c.id] || [])
        nos[c.id] = { key: c.id, codigo: c.codigo, nome: c.nome, ...own,
                      tPessoas: 0, tPostos: 0, tFte: 0, filhos: [], ccIds: [c.id], nivel: 0 }
      }
      const raiz: No[] = []
      for (const c of itens) {
        const pai = c.pai_id && nos[c.pai_id] ? nos[c.pai_id] : null
        if (pai) pai.filhos.push(nos[c.id]); else raiz.push(nos[c.id])
      }
      // Soma de baixo para cima. `vistos` é guarda contra ciclo herdado de
      // antes dos gatilhos — sem ela, um laço trava a tela.
      const vistos = new Set<string>()
      const subir = (n: No): void => {
        if (vistos.has(n.key)) return
        vistos.add(n.key)
        let tq = n.postos, tf = n.fte
        const ids = [...n.ccIds]
        for (const f of n.filhos) { subir(f); tq += f.tPostos; tf += f.tFte; ids.push(...f.ccIds) }
        // pessoas NÃO somam: a mesma matrícula pode ocupar dois postos em nós
        // diferentes, e somar contaria a pessoa duas vezes.
        n.tPessoas = new Set(ids.flatMap(id => porItem[id] || []).map(chave)).size
        n.tPostos = tq; n.tFte = tf; n.ccIds = ids
      }
      raiz.forEach(subir)
      const ord = (n: No) => { n.filhos.sort((a, b) => b.tPessoas - a.tPessoas); n.filhos.forEach(ord) }
      raiz.sort((a, b) => b.tPessoas - a.tPessoas); raiz.forEach(ord)
      return raiz
    }

    let raizes: No[] = []

    if (fonte === 'cc') {
      raizes = montar(ccs.map(c => ({ id: c.id, codigo: c.codigo, nome: c.descricao || '', pai_id: c.pai_id })))
    } else if (fonte === 'areaf') {
      raizes = montar(areas.map(a => ({ id: a.id, codigo: a.codigo, nome: a.nome, pai_id: a.pai_id })))
    } else {
      // Agrupamento plano em dois níveis: grupo → CC. O campo vem de
      // centro_custo e pode estar vazio — o balde "sem classificação" é
      // explícito, porque esconder o que não foi classificado é o jeito de o
      // total não fechar e ninguém notar.
      const col = fonte === 'area' ? 'area_nome' : fonte === 'divisao' ? 'divisao_nome' : 'bu_nome'
      const grupos: Record<string, No> = {}
      for (const c of ccs) {
        const ps = porItem[c.id] || []
        if (!ps.length) continue
        const g = ((c as any)[col] as string | null)?.trim() || SEM
        const no = (grupos[g] ||= { key: 'g:' + g, codigo: '', nome: g, pessoas: 0, postos: 0, fte: 0,
                                    tPessoas: 0, tPostos: 0, tFte: 0, filhos: [], ccIds: [], nivel: 0 })
        const t = conta(ps)
        no.filhos.push({ key: c.id, codigo: c.codigo, nome: c.descricao || '', ...t,
                         tPessoas: t.pessoas, tPostos: t.postos, tFte: t.fte,
                         filhos: [], ccIds: [c.id], nivel: 1 })
        no.ccIds.push(c.id)
      }
      raizes = Object.values(grupos)
      for (const g of raizes) {
        const t = conta(g.ccIds.flatMap(id => porItem[id] || []))
        g.tPessoas = t.pessoas; g.tPostos = t.postos; g.tFte = t.fte
        g.filhos.sort((a, b) => b.tPessoas - a.tPessoas)
      }
      raizes.sort((a, b) => b.tPessoas - a.tPessoas)
    }

    // Quem não tem a dimensão entra como nó próprio: no orçamento essas pessoas
    // existem, e um organograma que as omite mostra um quadro menor que o real.
    const sem = porItem['__sem'] || []
    if (sem.length) {
      const t = conta(sem)
      raizes = [...raizes, { key: '__sem', codigo: '—',
                             nome: fonte === 'areaf' ? 'Sem área funcional' : 'Sem centro de custo', ...t,
                             tPessoas: t.pessoas, tPostos: t.postos, tFte: t.fte,
                             filhos: [], ccIds: ['__sem'], nivel: 0 }]
    }

    const max = Math.max(1, ...raizes.map(r => r.tPessoas))
    const total = {
      pessoas: new Set(filtrados.map(chave)).size,
      postos: filtrados.length,
      fte: filtrados.reduce((s, p) => s + (Number(p.fte) || 0), 0),
      nos: raizes.length,
    }
    return { raizes, max, total }
  }, [filtrados, ccs, areas, fonte, campoFonte])

  // Começa com o primeiro nível aberto: a tela abre mostrando a estrutura, não
  // uma lista de caixas fechadas que a pessoa tem de descobrir que clica.
  useEffect(() => { setAbertos(new Set(raizes.map(r => r.key))) }, [fonte, empresaId])

  const todos = useMemo(() => {
    const out: No[] = []
    const vai = (n: No) => { out.push(n); n.filhos.forEach(vai) }
    raizes.forEach(vai)
    return out
  }, [raizes])

  // Caminho completo: duas áreas se chamam DESENVOLVIMENTO e duas PROSPECÇÃO,
  // então o nome sozinho não identifica — quem atribui precisa ver o ramo.
  const areaCaminho = useMemo(() => {
    const by = Object.fromEntries(areas.map(a => [a.id, a]))
    const nome = (id: string): string => {
      const parts: string[] = []
      let cur: Area | undefined = by[id]
      let guarda = 0
      while (cur && guarda++ < 20) { parts.unshift(cur.nome); cur = cur.pai_id ? by[cur.pai_id] : undefined }
      return parts.join(' › ')
    }
    return Object.fromEntries(areas.map(a => [a.id, nome(a.id)]))
  }, [areas])

  // Rótulo curto do nó de cada pessoa. Clicar numa diretoria traz a subárvore
  // inteira — 43 nomes sem dizer de onde não ajudam ninguém.
  const rotuloNo = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of areas) m[a.id] = `${a.codigo} · ${a.nome}`
    for (const c of ccs) m[c.id] = `${c.codigo} · ${c.descricao || ''}`
    return m
  }, [areas, ccs])

  const noSel = sel ? todos.find(n => n.key === sel) : null
  const pessoasSel = useMemo(() => {
    if (!noSel) return []
    const ids = new Set(noSel.ccIds)
    return filtrados
      .filter(p => ids.has((p as any)[campoFonte] || '__sem'))
      .sort((a, b) => (a.nome || a.codigo).localeCompare(b.nome || b.codigo))
  }, [noSel, filtrados, campoFonte])

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
              const flat = f.k === 'area' || f.k === 'divisao' || f.k === 'bu'
              return <option key={f.k} value={f.k}>
                {f.label}{flat ? ` (${preench[f.k]} de ${preench.tot} CCs)` : ''}
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
        <button style={{ ...S.btn, marginLeft: 'auto', ...(modo === 'atribuir' ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : {}) }}
                onClick={() => setModo(m => m === 'ver' ? 'atribuir' : 'ver')}
                title="Dizer em que área funcional cada posto está. O caminho rápido é filtrar por centro de custo e atribuir o lote.">
          <Pencil size={14} /> {modo === 'atribuir' ? 'Voltar ao organograma' : 'Atribuir área'}
        </button>
        <button style={{ ...S.btn, ...(comDemitidos ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : {}) }}
                onClick={() => setComDemitidos(v => !v)}
                title="Postos inativos (demitidos) ficam fora por padrão, como na grade.">
          <Users size={14} /> {comDemitidos ? 'Com demitidos' : 'Só ativos'}
        </button>
      </div>

      {erro && <div style={S.aviso}>Não foi possível carregar: {erro}</div>}

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

      {loading ? <div style={S.vazio}>Carregando…</div> : modo === 'atribuir' ? (
        <Atribuir postos={filtrados} ccs={ccs} areas={areas} caminho={areaCaminho}
                  cargos={cargos} onFim={carregar} />
      ) : (
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
                        <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cargos[p.cargo_id || ''] || '—'}{p.regime ? ' · ' + p.regime.replace('BR-', '') : ''}
                        </span>
                        {noSel.filhos.length > 0 && (
                          <span style={{ color: 'var(--violet)', fontSize: 10.5, display: 'block', overflow: 'hidden',
                                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rotuloNo[(p as any)[campoFonte] || ''] || '—'}
                          </span>
                        )}
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
