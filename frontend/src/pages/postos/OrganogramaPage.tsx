import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { PostosPills } from './PostosPills'
import { useUserAccess } from '../../hooks/useUserAccess'
import { pageAll } from '../../lib/pageAll'
import { pessoaChave } from '../../lib/pessoaChave'
import { useLocalPref } from '../../lib/uiPrefs'
import { FiltrosButton, effectiveCcFilter, escopoFiltro, ModalPanel, Checklist } from '../dashboard/DashFiltros'
import { ChevronDown, ChevronRight, Users, X, Maximize2, Minimize2, Pencil, Briefcase } from 'lucide-react'

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
  funcionario_id: string | null
}
type CC = {
  id: string; codigo: string; descricao: string | null; pai_id: string | null
  area_nome: string | null; divisao_nome: string | null; bu_nome: string | null
  area_cod: string | null; divisao_cod: string | null; bu_cod: string | null
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
          pessoa{n.tPessoas === 1 ? '' : 's'} · {n.tPostos} posto{n.tPostos === 1 ? '' : 's'}
          {/* FTE só quando diz algo: nesta base todo posto vale 1, então FTE é
              idêntico a postos — e "43 pessoas · 53 FTE" parecia defeito quando
              era só gente com dois postos. */}
          {Math.abs(n.tFte - n.tPostos) > 0.01 && <> · {nf(n.tFte)} FTE</>}
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
  // Rascunho: o lote PREENCHE, não grava. Antes "Aplicar aos N" escrevia no
  // banco na hora, e quem errasse o filtro descobria depois — numa tela cujo
  // propósito é classificar 324 postos, a chance de errar o recorte é alta e o
  // desfazer não existia. Agora o lote é uma sugestão em massa, a linha é a
  // correção fina, e gravar é um ato separado.
  const [rascunho, setRascunho] = useState<Record<string, string | null>>({})
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

  // Grava as pendências agrupadas por área: uma chamada por área, não uma por
  // posto. E CONFERE o retorno, porque update barrado por RLS não dá erro —
  // filtra as linhas, afeta zero e volta sucesso.
  const aplicar = async () => {
    if (!pendentes.length) return
    setErro(''); setGravando(true)
    const porArea: Record<string, string[]> = {}
    for (const [id, v] of pendentes) (porArea[v || '__nulo'] ||= []).push(id)
    let gravou = 0
    for (const [area, ids] of Object.entries(porArea)) {
      const { data, error } = await supabase.from('posto')
        .update({ area_func_id: area === '__nulo' ? null : area }).in('id', ids).select('id')
      if (error) { setErro(error.message); setGravando(false); return }
      gravou += data?.length ?? 0
    }
    setGravando(false)
    if (gravou < pendentes.length) {
      setErro(`Gravou ${gravou} de ${pendentes.length}. As demais estão fora do seu escopo de edição.`)
    }
    setRascunho({})
    onFim()
  }

  const alterada = (p: Posto) => p.id in rascunho && (rascunho[p.id] || null) !== (p.area_func_id || null)
  const valorDe = (p: Posto) => (p.id in rascunho ? rascunho[p.id] : p.area_func_id) || ''
  const pendentes = useMemo(
    () => Object.entries(rascunho).filter(([id, v]) =>
      (v || null) !== (postos.find(p => p.id === id)?.area_func_id || null)),
    [rascunho, postos])

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
          <span style={S.lbl}>Preencher em lote</span>
          <select style={{ ...S.sel, minWidth: 340 }} value={lote} onChange={e => setLote(e.target.value)}>
            <option value="">escolha a área…</option>
            {opcoes.map(a => <option key={a.id} value={a.id}>{caminho[a.id]}</option>)}
          </select>
        </div>
        <button style={{ ...S.btn, opacity: lote && lista.length ? 1 : 0.4,
                         cursor: lote && lista.length ? 'pointer' : 'not-allowed' }}
                disabled={!lote || !lista.length}
                title="Preenche a coluna dos filtrados. Nada é gravado ainda — confira, ajuste o que precisar, e grave no fim."
                onClick={() => setRascunho(r => {
                  const n = { ...r }
                  for (const p of lista) n[p.id] = lote
                  return n
                })}>
          Preencher os {lista.length} filtrados
        </button>
      </div>

      {pendentes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 14px',
                      padding: '11px 14px', borderRadius: 10,
                      background: 'rgba(139,92,246,0.10)', border: '1px solid var(--violet)' }}>
          <b style={{ fontSize: 13, color: 'var(--text)' }}>
            {pendentes.length} alteração{pendentes.length > 1 ? 'ões' : ''} pendente{pendentes.length > 1 ? 's' : ''}
          </b>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>nada foi gravado ainda</span>
          <div style={{ flex: 1 }} />
          <button style={S.btn} onClick={() => setRascunho({})} disabled={gravando}>Descartar</button>
          <button style={{ ...S.btn, borderColor: 'var(--violet)', color: 'var(--violet)', fontWeight: 600 }}
                  onClick={aplicar} disabled={gravando}>
            {gravando ? 'Gravando…' : `Gravar ${pendentes.length}`}
          </button>
        </div>
      )}

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
                  <select style={{ ...S.sel, padding: '4px 6px', fontSize: 12, minWidth: 260,
                                   borderColor: alterada(p) ? 'var(--violet)' : 'var(--border-strong)',
                                   background: alterada(p) ? 'rgba(139,92,246,0.10)' : 'var(--panel)' }}
                          value={valorDe(p)}
                          onChange={e => setRascunho(r => ({ ...r, [p.id]: e.target.value || null }))}>
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
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fonte, setFonte] = useLocalPref<Fonte>('planorc_organograma_fonte', 'areaf')
  const [empresaSel, setEmpresaSel] = useLocalPref<string[]>('planorc_organograma_empresa', [])
  const [filialSel, setFilialSel] = useLocalPref<string[]>('planorc_organograma_filial', [])
  const [ccSel, setCcSel] = useLocalPref<string[]>('planorc_organograma_cc', [])
  const [areaSel, setAreaSel] = useLocalPref<string[]>('planorc_organograma_area', [])
  const [divisaoSel, setDivisaoSel] = useLocalPref<string[]>('planorc_organograma_divisao', [])
  const [buSel, setBuSel] = useLocalPref<string[]>('planorc_organograma_bu', [])
  // Cargo tem DOIS modos porque as duas perguntas são legítimas e a segunda é a
  // frequente: "só este cargo" e "o quadro sem estes". Com 106 cargos, forçar a
  // segunda pela primeira significaria marcar 104 caixas.
  const [cargoSel, setCargoSel] = useLocalPref<string[]>('planorc_organograma_cargos', [])
  const [cargoModo, setCargoModo] = useLocalPref<'incluir' | 'ocultar'>('planorc_organograma_cargomodo', 'ocultar')
  const [cargoAberto, setCargoAberto] = useState(false)
  const [comDemitidos, setComDemitidos] = useLocalPref('planorc_organograma_demitidos', false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [modo, setModo] = useState<'ver' | 'atribuir'>('ver')
  // Tudo que é filtro vai em `useLocalPref`: quem monta um recorte e sai da
  // tela espera achá-lo de volta. Antes era `useState` puro, então voltar
  // zerava — e remontar filtro a cada visita é o tipo de atrito que faz a
  // pessoa parar de usar o filtro.
  // Listar por pessoa ou por posto. Sem isto o painel dizia "6 pessoas" e
  // mostrava 11 linhas com nomes repetidos — o cabeçalho contava gente e a
  // lista contava vínculo, e quem lê conclui que um dos dois está errado.
  const [listar, setListar] = useLocalPref<'pessoas' | 'postos'>('planorc_organograma_listar', 'pessoas')
  const [erro, setErro] = useState('')

  // try/finally não é zelo: sem ele, UMA consulta que falha deixa `loading` em
  // true para sempre e a tela fica "Carregando…" com tudo zerado — que é o
  // sintoma mais caro de depurar, porque não diz nada. Aconteceu de verdade
  // quando `posto_v` ainda não tinha `area_func_id` (v3_147).
  const carregar = async () => {
    try {
    const [pd, cd, gd, ed, fd, ad] = await Promise.all([
      pageAll(() => supabase.from('posto_v').select('id,codigo,nome,matricula,cargo_id,cc_id,empresa_id,filial_id,fte,ativo,regime,area_func_id,funcionario_id')),
      pageAll(() => supabase.from('centro_custo').select('id,codigo,descricao,pai_id,area_nome,divisao_nome,bu_nome,area_cod,divisao_cod,bu_cod').eq('ativo', true).order('codigo')),
      pageAll(() => supabase.from('cargo').select('id,nome')),
      supabase.from('empresa').select('id,codigo,descricao').order('codigo').then(r => r.data || []),
      supabase.from('filial').select('id,codigo,descricao').order('codigo').then(r => r.data || []),
      pageAll(() => supabase.from('area_funcional').select('id,codigo,nome,pai_id').eq('ativo', true).order('codigo')),
    ])
    setPostos(pd as Posto[]); setCcs(cd as CC[])
    setCargos(Object.fromEntries((gd as any[]).map(c => [c.id, c.nome])))
    setEmpresas(ed as any[]); setFiliais(fd as any[]); setAreas(ad as Area[])
    setErro('')
    } catch (e: any) {
      setErro(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (!acesso.loading) carregar() }, [acesso.loading])

  // Filtro genérico (mesmo componente dos dashboards e da Memória) cruzado com
  // o escopo do usuário, mais um corte por cargo. `escopoFiltro` faz a
  // interseção: filtro de tela ∩ o que a pessoa pode ver.
  const filtrados = useMemo(() => {
    const empF = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const filF = escopoFiltro((filialSel.length && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee)
    const ccF  = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    return postos.filter(p =>
      (comDemitidos || p.ativo !== false) &&
      (!empF || (p.empresa_id && empF.includes(p.empresa_id))) &&
      (!filF || (p.filial_id && filF.includes(p.filial_id))) &&
      (!ccF  || (p.cc_id && ccF.includes(p.cc_id))) &&
      (!cargoSel.length || (cargoModo === 'incluir'
        ? cargoSel.includes(p.cargo_id || '')
        : !cargoSel.includes(p.cargo_id || ''))))
  }, [postos, comDemitidos, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, cargoSel, cargoModo,
      empresas, filiais, ccs, acesso])

  // Headcount: a regra de "quem é uma pessoa" mora em `pessoaChave` — a mesma
  // que a grade usa, senão os dois números discordam. Não é matrícula: ela é
  // por empresa, e quem tem pró-labore em várias virava várias pessoas.
  const chave = pessoaChave

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
      multi: (() => {
        const c: Record<string, number> = {}
        for (const p of filtrados) c[chave(p)] = (c[chave(p)] || 0) + 1
        return Object.values(c).filter(v => v > 1).length
      })(),
      nos: raizes.length,
    }
    return { raizes, max, total }
  }, [filtrados, ccs, areas, fonte, campoFonte])

  // Começa com o primeiro nível aberto: a tela abre mostrando a estrutura, não
  // uma lista de caixas fechadas que a pessoa tem de descobrir que clica.
  useEffect(() => { setAbertos(new Set(raizes.map(r => r.key))) }, [fonte])

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

  // Uma linha por pessoa, com os postos dela somados. O cargo e o regime vêm
  // dos vínculos — quem tem pró-labore em quatro empresas tem quatro, e o
  // interessante é ver isso junto, não espalhado em quatro linhas iguais.
  const agrupado = useMemo(() => {
    const g: Record<string, { chave: string; nome: string; postos: Posto[]; fte: number }> = {}
    for (const p of pessoasSel) {
      const k = pessoaChave(p)
      const e = (g[k] ||= { chave: k, nome: p.nome || 'vaga planejada', postos: [], fte: 0 })
      e.postos.push(p); e.fte += Number(p.fte) || 0
    }
    return Object.values(g).map(e => {
      const cargos_ = [...new Set(e.postos.map(x => cargos[x.cargo_id || ''] || '—'))]
      const regimes = [...new Set(e.postos.map(x => (x.regime || '').replace('BR-', '')).filter(Boolean))]
      const areas_ = noSel && noSel.filhos.length > 0
        ? [...new Set(e.postos.map(x => rotuloNo[(x as any)[campoFonte] || ''] || '').filter(Boolean))]
        : []
      return { ...e, detalhe: [cargos_.join(' · '), regimes.join('/'), areas_.join(' · ')].filter(Boolean).join(' · ') }
    }).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [pessoasSel, cargos, noSel, rotuloNo, campoFonte])

  const cargosOrdenados = useMemo(() => {
    const n: Record<string, number> = {}
    for (const p of postos) if (comDemitidos || p.ativo !== false) n[p.cargo_id || ''] = (n[p.cargo_id || ''] || 0) + 1
    return Object.entries(cargos).map(([id, nome]) => ({ id, nome, n: n[id] || 0 }))
      .filter(c => c.n > 0).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome))
  }, [postos, cargos, comDemitidos])

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
          <span style={S.lbl}>Filtros</span>
          <FiltrosButton empresas={acesso.filterList('empresa', empresas)} filiais={acesso.filterList('filial', filiais)}
                         ccs={acesso.filterList('centro_custo', ccs as any) as any}
                         empresaSel={empresaSel} setEmpresaSel={setEmpresaSel}
                         filialSel={filialSel} setFilialSel={setFilialSel}
                         ccSel={ccSel} setCcSel={setCcSel}
                         areaSel={areaSel} setAreaSel={setAreaSel}
                         divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel}
                         buSel={buSel} setBuSel={setBuSel} />
        </div>
        <div style={S.fld}>
          <span style={S.lbl}>Cargos</span>
          <button style={S.btn} onClick={() => setCargoAberto(true)}>
            <Briefcase size={14} /> {!cargoSel.length ? 'Todos'
              : cargoModo === 'ocultar' ? `${cargoSel.length} oculto${cargoSel.length > 1 ? 's' : ''}`
              : `só ${cargoSel.length}`}
          </button>
        </div>
        <button style={S.btn} onClick={() => setAbertos(new Set(todos.map(n => n.key)))}><Maximize2 size={14} /> Expandir tudo</button>
        <button style={S.btn} onClick={() => setAbertos(new Set())}><Minimize2 size={14} /> Recolher</button>
        <div style={{ ...S.fld, marginLeft: 'auto' }}>
          <span style={S.lbl}>Listar</span>
          <div style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 8, overflow: 'hidden' }}>
            {(['pessoas', 'postos'] as const).map(k => (
              <button key={k} onClick={() => setListar(k)}
                style={{ padding: '7px 12px', fontSize: 12.5, border: 'none', cursor: 'pointer', fontWeight: 600,
                         background: listar === k ? 'rgba(139,92,246,0.18)' : 'transparent',
                         color: listar === k ? 'var(--violet)' : 'var(--text-mid)' }}>
                {k === 'pessoas' ? 'Pessoas' : 'Postos'}
              </button>
            ))}
          </div>
        </div>
        <button style={{ ...S.btn, ...(modo === 'atribuir' ? { borderColor: 'var(--violet)', color: 'var(--violet)' } : {}) }}
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

      {cargoAberto && (
        <ModalPanel titulo="Cargos" onClose={() => setCargoAberto(false)} width="min(560px, calc(100vw - 40px))">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {([['ocultar', 'Tirar do quadro'], ['incluir', 'Mostrar só']] as const).map(([k, rot]) => (
              <button key={k} onClick={() => setCargoModo(k)}
                style={{ padding: '6px 11px', fontSize: 12.5, borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                         border: '1px solid ' + (cargoModo === k ? 'var(--violet)' : 'var(--border-strong)'),
                         background: cargoModo === k ? 'rgba(139,92,246,0.16)' : 'var(--panel)',
                         color: cargoModo === k ? 'var(--violet)' : 'var(--text-mid)' }}>{rot}</button>
            ))}
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {cargoModo === 'ocultar' ? 'marque os cargos que devem SAIR' : 'marque os únicos que devem aparecer'}
            </span>
          </div>
          {/* O número à esquerda é quanta gente tem o cargo. Ordenado por ele, e
              não alfabeticamente: com 82% do quadro num cargo só, a ordem
              alfabética esconde justamente os que se quer tirar. */}
          <Checklist titulo="" items={cargosOrdenados.map(c => ({ id: c.id, codigo: String(c.n), descricao: c.nome }))}
                     sel={cargoSel} setSel={setCargoSel} />
        </ModalPanel>
      )}

      {erro && <div style={S.aviso}>Não foi possível carregar: {erro}</div>}

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Pessoas</div><div style={S.kpiV}>{total.pessoas}</div>
          <div style={S.kpiH}>por CPF quando há; senão, nome</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Postos</div><div style={S.kpiV}>{total.postos}</div>
          <div style={S.kpiH}>{total.postos - total.pessoas} a mais que pessoas</div></div>
        {/* Mostra FTE onde ele informa (algum posto com ½ período) e, onde não,
            responde a pergunta que o número de postos levanta: por que há mais
            posto que gente. */}
        {Math.abs(total.fte - total.postos) > 0.01
          ? <div style={S.kpi}><div style={S.kpiL}>FTE</div><div style={S.kpiV}>{nf(total.fte)}</div>
              <div style={S.kpiH}>inclui ½ períodos</div></div>
          : <div style={S.kpi}><div style={S.kpiL}>Em 2+ postos</div><div style={S.kpiV}>{total.multi}</div>
              <div style={S.kpiH}>pessoas com mais de um posto</div></div>}
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
                  <b style={{ color: 'var(--text-mid)' }}>{listar === 'pessoas' ? noSel.tPessoas : noSel.tPostos}</b>
                  {' '}{listar === 'pessoas' ? `pessoa${noSel.tPessoas === 1 ? '' : 's'} listada${noSel.tPessoas === 1 ? '' : 's'}` : `posto${noSel.tPostos === 1 ? '' : 's'} listado${noSel.tPostos === 1 ? '' : 's'}`}
                  {' · '}{listar === 'pessoas' ? `${noSel.tPostos} posto(s)` : `${noSel.tPessoas} pessoa(s)`}
                  {Math.abs(noSel.tFte - noSel.tPostos) > 0.01 && <> · {nf(noSel.tFte)} FTE</>}
                  {noSel.filhos.length > 0 && <> · {noSel.filhos.length} abaixo</>}
                </div>
                <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                  {listar === 'pessoas' ? agrupado.map(g => (
                    <div key={g.chave} style={S.pess}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ color: 'var(--text)', fontWeight: 600, display: 'block', overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.nome}
                          {g.postos.length > 1 && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--violet)',
                                background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.35)',
                                borderRadius: 5, padding: '0 4px' }}
                                title={g.postos.map(x => x.codigo).join(' · ')}>{g.postos.length} postos</span>}
                        </span>
                        <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.detalhe}</span>
                      </span>
                      <span style={{ color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{nf(g.fte)}</span>
                    </div>
                  )) : pessoasSel.map(p => (
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
