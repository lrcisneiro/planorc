import { useEffect, useMemo, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useLocalPref } from '../../lib/uiPrefs'
import { ConciliacaoQuadro } from './ConciliacaoQuadro'
import { AlertCircle, ChevronDown, ChevronRight, Check, MessageSquare } from 'lucide-react'

// Conciliação CONTÁBIL × FOLHA (camada 2), organizada por MODELO DE CONTRATAÇÃO
// (v3_085) — porque é o modelo que decide por onde o dinheiro da pessoa chega à
// contabilidade, e portanto como ela concilia:
//
//   CLT        a folha contabiliza, e o razão vem consolidado por conta × verba.
//              Compara conta → verba; abaixo disso é composição da folha, não
//              comparação: o razão do CLT não tem nome nem matrícula.
//   TERCEIROS  a folha calcula, vira pedido de compra e chega como nota fiscal.
//              Nota tem dono, então compara POR PESSOA → conta → lançamento.
//
// A nota não respeita a fronteira da conta: a folha aponta uma, o pedido de
// compra usa a do fornecedor. Por isso o terceiro não é agrupado por conta —
// senão a mesma pessoa aparece dos dois lados de uma fronteira artificial e
// nenhum lado fecha.

export type ContabilParams = {
  ano: number; mes: number; versaoId: string
  empresaSel: string[]; filialFilter: string[] | null; ccFilter: string[] | null
}
type CLT = {
  linha_id: string | null; linha_cod: string | null; linha_desc: string | null; linha_ordem: number | null
  conta_id: string; conta_cod: string; conta_desc: string; plano_cod: string | null
  verba_cod: string; verba_desc: string | null; razao: number; folha: number
}
type Patrim = { conta_cod: string; conta_desc: string; natureza: string; razao: number; folha: number }
type ItemRazao = { linha_id: string; razao_item: number }
type ItemFora = { conta_cod: string; conta_desc: string; motivo: string; lancamentos: number; valor: number }
type PessoaFolha = { filial_id: string; filial_cod: string | null; empresa_cod: string | null; matricula: string; nome: string; valor: number }
type Terc = {
  status: 'CASADO' | 'SEM_NF' | 'SEM_FOLHA' | 'AMBIGUO' | 'SEM_DEPARA'
  via: 'DEPARA' | 'NOME' | null
  filial_id: string | null; matricula: string | null; nome: string | null
  fornecedor_cod: string | null; nome_fantasia: string | null; cc_cod: string | null
  lancamentos: number; razao: number; folha: number
}
type Pessoa = { matricula: string; nome: string; cc_cod: string | null; valor: number }
type Outro = { conta_id: string; lancamentos: number; valor: number }
type OutroLanc = { data: string | null; documento: string | null; historico: string | null; lote: string | null; cc_cod: string | null; valor: number }
type Lado = { lado: string; conta_cod: string; conta_desc: string; ref: string | null; cc_cod: string | null; data: string | null; documento: string | null; historico: string | null; valor: number }
type SemDono = { conta_id: string; conta_cod: string; conta_desc: string; data: string | null; documento: string | null; historico: string | null; lote: string | null; cc_cod: string | null; valor: number }
type Nota = { id: string; conta_id: string; verba_cod: string | null; motivo: string }

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const chave = (contaId: string, verba: string | null) => `${contaId}|${verba || ''}`

const S: Record<string, CSSProperties> = {
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '0 0 16px' },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiS:  { fontSize: 11, color: 'var(--faint)' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 },
  head:  { display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' },
  h2:    { fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 },
  hsub:  { fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 200 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  gh:    { padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  dh:    { textAlign: 'left', padding: '4px 8px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  dt:    { padding: '3px 8px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 16px' },
  empty: { padding: '30px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  inp:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  mono:  { fontFamily: 'monospace', color: 'var(--muted)' },
  nota:  { display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px 10px 30px', fontSize: 12.5 },
}
const chip = (cor: string, fundo: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, color: cor, background: fundo, whiteSpace: 'nowrap' })
const OK = chip('var(--green)', 'rgba(52,211,153,0.14)')
const DIF = chip('var(--orange)', 'rgba(251,146,60,0.14)')
const RES = chip('var(--blue)', 'rgba(59,130,246,0.14)')

const ST: Record<Terc['status'], { txt: string; est: CSSProperties; ajuda: string }> = {
  SEM_NF:     { txt: 'sem nota',    est: DIF, ajuda: 'a folha calculou e nenhuma nota chegou no mês' },
  SEM_FOLHA:  { txt: 'sem folha',   est: DIF, ajuda: 'a nota tem dono, mas o dono não tem folha de terceiro neste mês' },
  AMBIGUO:    { txt: 'ambíguo',     est: DIF, ajuda: 'o histórico casou com mais de um fornecedor' },
  SEM_DEPARA: { txt: 'sem dono',    est: RES, ajuda: 'não veio da folha e não casou com pessoa: lançamento direto na contabilidade, prestador que é empresa, ou nota faltando amarração' },
  CASADO:     { txt: 'conciliado',  est: OK,  ajuda: 'a nota tem dono e o dono tem folha — compare os dois valores' },
}
const ORDEM: Terc['status'][] = ['SEM_NF', 'SEM_FOLHA', 'AMBIGUO', 'CASADO', 'SEM_DEPARA']

export function ConciliacaoContabil({ params: p, podeConfigurar }: { params: ContabilParams; podeConfigurar: boolean }) {
  const [clt, setClt] = useState<CLT[]>([])
  const [outros, setOutros] = useState<Record<string, Outro>>({})
  const [patrim, setPatrim] = useState<Patrim[]>([])
  const [itemRz, setItemRz] = useState<Record<string, ItemRazao>>({})
  // amarração manual: o gestor diz de quem é o texto órfão, e isso vira uma
  // linha de de-para com origem MANUAL — que a reimportação não apaga
  const [amarrando, setAmarrando] = useState<string | null>(null)
  const [pessoasFolha, setPessoasFolha] = useState<PessoaFolha[]>([])
  const [buscaP, setBuscaP] = useState('')
  const [salvandoAm, setSalvandoAm] = useState(false)
  const [terc, setTerc] = useState<Terc[]>([])
  const [rels, setRels] = useState<any[]>([])
  const [relSel, setRelSel] = useLocalPref('planorc_concil_relatorio', '')
  const [notas, setNotas] = useState<Record<string, Nota>>({})
  const [tol, setTol] = useState(1)
  const [tolTxt, setTolTxt] = useState('1,00')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [drill, setDrill] = useState<Record<string, any[]>>({})
  const [editNota, setEditNota] = useState<string | null>(null)
  const [txtNota, setTxtNota] = useState('')

  const escopo = useMemo(() => ({
    p_ano: p.ano, p_mes: p.mes,
    p_empresas: p.empresaSel.length ? p.empresaSel : null,
    p_filiais: p.filialFilter, p_ccs: p.ccFilter,
  }), [p.ano, p.mes, p.empresaSel, p.filialFilter, p.ccFilter])

  // o relatório serve só para saber quais contas são irmãs no lado da nota
  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('codigo').then(r => {
      const l = r.data || []; setRels(l)
      setRelSel(prev => l.some((x: any) => x.id === prev) ? prev : (l[0]?.id || ''))
    })
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!relSel) return
    let vivo = true
    ;(async () => {
      setLoading(true); setErro(null); setAviso(null); setAberto(new Set()); setDrill({})
      const [c, o, t, pt, ir, n, tt] = await Promise.all([
        supabase.rpc('conciliacao_clt', { ...escopo, p_relatorio_id: relSel }),
        supabase.rpc('conciliacao_clt_outros', escopo),
        supabase.rpc('conciliacao_terceiros', { ...escopo, p_relatorio_id: relSel }),
        supabase.rpc('conciliacao_patrimoniais', escopo),
        supabase.rpc('conciliacao_item_razao', { ...escopo, p_relatorio_id: relSel }),
        supabase.from('conciliacao_folha_nota').select('id,conta_id,verba_cod,motivo').eq('ano', p.ano).eq('mes', p.mes),
        supabase.from('tenant').select('conciliacao_tolerancia').eq('id', TENANT_ID).maybeSingle(),
      ])
      if (!vivo) return
      if (c.error || t.error) { setErro((c.error || t.error)!.message); setClt([]); setTerc([]); setLoading(false); return }
      setClt(((c.data || []) as CLT[]).map(x => ({ ...x, razao: Number(x.razao) || 0, folha: Number(x.folha) || 0 })))
      const om: Record<string, Outro> = {}
      ;((o.data || []) as Outro[]).forEach(x => { om[x.conta_id] = { ...x, valor: Number(x.valor) || 0 } })
      setOutros(om)
      setPatrim(((pt.data || []) as Patrim[]).map(x => ({ ...x, razao: Number(x.razao) || 0, folha: Number(x.folha) || 0 })))
      const im: Record<string, ItemRazao> = {}
      ;((ir.data || []) as ItemRazao[]).forEach(x => { im[x.linha_id] = { ...x, razao_item: Number(x.razao_item) || 0 } })
      setItemRz(im)
      setTerc(((t.data || []) as Terc[]).map(x => ({ ...x, razao: Number(x.razao) || 0, folha: Number(x.folha) || 0 })))
      const map: Record<string, Nota> = {}
      ;((n.data || []) as Nota[]).forEach(x => { map[chave(x.conta_id, x.verba_cod)] = x })
      setNotas(map)
      const v = Number(tt.data?.conciliacao_tolerancia ?? 1)
      setTol(v); setTolTxt(money(v))
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [escopo, relSel]) // eslint-disable-line

  // uma conta amarrada em duas linhas do mesmo relatório apareceria duas vezes no
  // universo do terceiro. Avisar é melhor do que somar errado em silêncio.
  useEffect(() => {
    if (!relSel) return
    supabase.from('conta_linha').select('conta_id,relatorio_linha!inner(relatorio_id)')
      .eq('relatorio_linha.relatorio_id', relSel)
      .then(r => {
        const n = new Map<string, number>()
        ;(r.data || []).forEach((x: any) => n.set(x.conta_id, (n.get(x.conta_id) || 0) + 1))
        const dup = [...n.values()].filter(q => q > 1).length
        if (dup) setAviso(`${dup} conta(s) estão amarradas em mais de uma linha deste relatório. Confira a amarração: isso alarga o universo do terceiro.`)
      })
  }, [relSel])

  const contasClt = useMemo(() => {
    const m = new Map<string, { id: string; cod: string; desc: string; plano: string; verbas: CLT[] }>()
    for (const r of clt) {
      const g = m.get(r.conta_id) || { id: r.conta_id, cod: r.conta_cod, desc: r.conta_desc, plano: r.plano_cod || '', verbas: [] }
      g.verbas.push(r); m.set(r.conta_id, g)
    }
    return [...m.values()].map(g => {
      const razao = g.verbas.reduce((s, v) => s + v.razao, 0)
      const folha = g.verbas.reduce((s, v) => s + v.folha, 0)
      const o = outros[g.id]
      return { ...g, razao, folha, dif: razao - folha, outros: o?.valor || 0, outrosN: o?.lancamentos || 0,
               fora: g.verbas.filter(v => Math.abs(v.razao - v.folha) > tol) }
    }).sort((a, b) => a.cod.localeCompare(b.cod))
  }, [clt, tol, outros])

  // o item orçamentário: a linha do relatório em que a conta está amarrada.
  // Conta de resultado sem amarração cai num grupo próprio em vez de sumir —
  // é falha de cadastro, e falha de cadastro tem de doer à vista.
  const itens = useMemo(() => {
    const m = new Map<string, { id: string; cod: string; desc: string; ordem: number; contas: typeof contasClt }>()
    for (const c of contasClt) {
      const r = clt.find(x => x.conta_id === c.id)
      const id = r?.linha_id || '__sem__'
      const g = m.get(id) || {
        id, cod: r?.linha_cod || '', desc: r?.linha_desc || 'Sem item orçamentário',
        ordem: r?.linha_ordem ?? 99999, contas: [] as typeof contasClt,
      }
      g.contas.push(c); m.set(id, g)
    }
    return [...m.values()].map(g => ({
      ...g,
      razao: g.contas.reduce((s, c) => s + c.razao, 0),
      folha: g.contas.reduce((s, c) => s + c.folha, 0),
      outros: g.contas.reduce((s, c) => s + c.outros, 0),
      fora: g.contas.reduce((s, c) => s + c.fora.length, 0),
    })).sort((a, b) => a.ordem - b.ordem || a.cod.localeCompare(b.cod))
  }, [contasClt, clt])

  const totPat = useMemo(() => patrim.reduce((s, p) => ({ razao: s.razao + p.razao, folha: s.folha + p.folha }), { razao: 0, folha: 0 }), [patrim])

  const repetidas = useMemo(() => {
    const n = new Map<string, number>()
    contasClt.forEach(c => n.set(c.cod, (n.get(c.cod) || 0) + 1))
    return new Set([...n.entries()].filter(([, q]) => q > 1).map(([k]) => k))
  }, [contasClt])

  const pessoas = useMemo(() => terc.filter(t => t.status !== 'SEM_DEPARA' && t.status !== 'AMBIGUO')
    .sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status) || Math.abs(b.razao - b.folha) - Math.abs(a.razao - a.folha)), [terc])
  const semDono = useMemo(() => terc.filter(t => t.status === 'SEM_DEPARA' || t.status === 'AMBIGUO'), [terc])

  const totC = useMemo(() => contasClt.reduce((s, c) => ({ razao: s.razao + c.razao, folha: s.folha + c.folha, outros: s.outros + c.outros }), { razao: 0, folha: 0, outros: 0 }), [contasClt])
  const totT = useMemo(() => pessoas.reduce((s, t) => ({ razao: s.razao + t.razao, folha: s.folha + t.folha }), { razao: 0, folha: 0 }), [pessoas])
  const totSemDono = useMemo(() => semDono.reduce((s, t) => s + t.razao, 0), [semDono])

  const abrirAmarrar = async (texto: string) => {
    setAmarrando(texto); setBuscaP('')
    if (!pessoasFolha.length) {
      const { data } = await supabase.rpc('conciliacao_pessoas_folha', escopo)
      setPessoasFolha((data || []) as PessoaFolha[])
    }
  }
  const amarrar = async (texto: string, pe: PessoaFolha) => {
    setSalvandoAm(true)
    // A chave única é (tenant, empresa, filial, matrícula, fornecedor, loja) e
    // precisa ser de colunas planas por causa do upsert do import. Para a mesma
    // pessoa poder ter DOIS apelidos — acontece: o prestador fatura por mais de
    // um nome — o par fornecedor/loja recebe um marcador derivado do texto.
    // 'MANUAL' também deixa a procedência óbvia na tela de Fornecedores.
    const slug = Array.from(texto.toUpperCase()).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
      .toString(36).toUpperCase().slice(0, 6)
    const { error } = await supabase.from('posto_fornecedor').insert({
      tenant_id: TENANT_ID, origem: 'MANUAL',
      empresa_cod: pe.empresa_cod || '', filial_cod: pe.filial_cod || '',
      matricula_folha: pe.matricula, nome_sra: pe.nome,
      apelido: texto, fornecedor_cod: 'MANUAL', fornecedor_loja: slug,
    })
    setSalvandoAm(false)
    if (error) {
      setErro(error.code === '23505'
        ? `"${texto}" já está amarrado a esta pessoa.`
        : 'Ao amarrar: ' + error.message)
      return
    }
    setAmarrando(null)
    // recarrega para a linha sair do resíduo e aparecer conciliada
    const t = await supabase.rpc('conciliacao_terceiros', { ...escopo, p_relatorio_id: relSel })
    if (!t.error) setTerc(((t.data || []) as Terc[]).map(x => ({ ...x, razao: Number(x.razao) || 0, folha: Number(x.folha) || 0 })))
  }

  const salvarTolerancia = async () => {
    const v = Number(tolTxt.replace(/\./g, '').replace(',', '.'))
    if (!isFinite(v) || v < 0) { setTolTxt(money(tol)); return }
    const { error } = await supabase.from('tenant').update({ conciliacao_tolerancia: v }).eq('id', TENANT_ID)
    if (error) { setErro(error.message); return }
    setTol(v); setTolTxt(money(v))
  }

  const toggle = async (k: string, carregar: () => Promise<any[]>) => {
    setAberto(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
    if (!drill[k]) { const d = await carregar(); setDrill(prev => ({ ...prev, [k]: d })) }
  }
  const rpc = async (fn: string, args: any) => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) { setErro(error.message); return [] }
    return (data || []) as any[]
  }

  const salvarNota = async (contaId: string, verba: string | null, valorRef: number) => {
    const k = chave(contaId, verba); const atual = notas[k]; const motivo = txtNota.trim()
    if (!motivo) { setEditNota(null); return }
    // índice único é por expressão (coalesce(verba_cod,'')) — upsert do PostgREST
    // não alcança isso, então é update quando já existe e insert quando não.
    const r = atual
      ? await supabase.from('conciliacao_folha_nota').update({ motivo, valor_ref: valorRef }).eq('id', atual.id).select('id,conta_id,verba_cod,motivo').maybeSingle()
      : await supabase.from('conciliacao_folha_nota').insert({ tenant_id: TENANT_ID, ano: p.ano, mes: p.mes, conta_id: contaId, verba_cod: verba, motivo, valor_ref: valorRef }).select('id,conta_id,verba_cod,motivo').maybeSingle()
    if (r.error) { setErro(r.error.message); return }
    if (r.data) setNotas(prev => ({ ...prev, [k]: r.data as Nota }))
    setEditNota(null); setTxtNota('')
  }

  const BlocoNota = ({ contaId, verba, valorRef }: { contaId: string; verba: string | null; valorRef: number }) => {
    const k = chave(contaId, verba); const n = notas[k]
    if (editNota === k) return (
      <div style={S.nota}>
        <input autoFocus style={{ ...S.inp, flex: 1 }} value={txtNota} placeholder="Por que esta diferença existe?"
          onChange={e => setTxtNota(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') salvarNota(contaId, verba, valorRef); if (e.key === 'Escape') setEditNota(null) }} />
        <button onClick={() => salvarNota(contaId, verba, valorRef)} style={{ ...S.inp, cursor: 'pointer', color: 'var(--violet)', fontWeight: 600 }}>Salvar</button>
      </div>
    )
    return (
      <div style={S.nota}>
        <MessageSquare size={13} style={{ color: n ? 'var(--green)' : 'var(--border-strong)', flexShrink: 0 }} />
        <span onClick={() => { setEditNota(k); setTxtNota(n?.motivo || '') }}
          style={{ cursor: 'pointer', color: n ? 'var(--text-mid)' : 'var(--muted)', fontStyle: n ? 'normal' : 'italic' }}>
          {n ? n.motivo : 'sem justificativa — clique para escrever'}
        </span>
      </div>
    )
  }

  if (loading) return <div style={S.empty}>Carregando conciliação…</div>
  if (erro) return <div style={S.erro}><AlertCircle size={16} /> {erro}</div>

  const difC = totC.razao - totC.folha, difT = totT.razao - totT.folha

  return (
    <div>
      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>CLT · diferença</div><div style={{ ...S.kpiV, color: Math.abs(difC) > tol ? 'var(--orange)' : 'var(--green)' }}>{money(difC)}</div><div style={S.kpiS}>razão {money(totC.razao)} · folha {money(totC.folha)}{totC.outros ? ` · outros ${money(totC.outros)}` : ''}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Terceiros · diferença</div><div style={{ ...S.kpiV, color: Math.abs(difT) > tol ? 'var(--orange)' : 'var(--green)' }}>{money(difT)}</div><div style={S.kpiS}>razão {money(totT.razao)} · folha {money(totT.folha)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Outros lançamentos</div><div style={{ ...S.kpiV, color: 'var(--blue)' }}>{money(totSemDono)}</div><div style={S.kpiS}>{semDono.length} histórico(s) sem folha e sem pessoa</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Conciliados</div><div style={S.kpiV}>{pessoas.filter(t => t.status === 'CASADO').length}</div><div style={S.kpiS}>de {pessoas.length} pessoas no terceiro</div></div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', margin: '0 0 12px', flexWrap: 'wrap' }}>
        <div style={S.fld}><span style={S.lbl}>Tolerância (R$)</span>
          <input style={{ ...S.inp, width: 110, textAlign: 'right' }} value={tolTxt} disabled={!podeConfigurar}
            title={podeConfigurar ? 'Vale para todos — é política de controladoria, não preferência de tela.' : 'Só administrador altera: a tolerância vale para todos os usuários.'}
            onChange={e => setTolTxt(e.target.value)} onBlur={salvarTolerancia}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        </div>
        {rels.length > 1 && (
          <div style={S.fld}><span style={S.lbl}>Relatório (contas irmãs)</span>
            <select style={S.inp} value={relSel} onChange={e => setRelSel(e.target.value)}
              title="A nota fiscal costuma cair em conta diferente da que a folha aponta. A amarração conta→linha deste relatório diz quais contas são a mesma coisa.">
              {rels.map((r: any) => <option key={r.id} value={r.id}>{r.codigo} — {r.nome}</option>)}
            </select>
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>
          Abaixo da tolerância a linha conta como conciliada — rateio e arredondamento não são divergência.
        </span>
      </div>
      {aviso && <div style={{ ...S.erro, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', borderColor: 'rgba(251,146,60,0.35)' }}><AlertCircle size={16} /> {aviso}</div>}

      {/* ─────────── CLT ─────────── */}
      <div style={S.card}>
        <div style={S.head}>
          <h2 style={S.h2}>CLT</h2>
          <span style={S.hsub}>Aberto por <b>item orçamentário</b> — a linha do relatório em que cada conta está amarrada. A folha contabiliza e o razão
            vem consolidado por conta × verba (não tem matrícula), então a comparação para na verba. A coluna <b>outros</b> é o que entrou na conta
            sem vir da folha (fatura do convênio, encargo à mão): não é divergência dela, e fica fora da diferença.</span>
        </div>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Item · conta · verba</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Razão</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Diferença</th>
            <th style={{ ...S.th, textAlign: 'right' }} title="Razão que entrou nesta conta sem vir da contabilização da folha: fatura do convênio, encargo lançado à mão, ajuste. Não é divergência da folha — por isso fica fora da diferença.">Outros</th>
            <th style={{ ...S.th, textAlign: 'right' }} title="Razão + Outros: tudo o que a conferência enxerga nesta linha. É o número a comparar com o item da DRE ao lado.">Total</th>
            <th style={{ ...S.th, textAlign: 'right' }} title="O razão de TODAS as contas amarradas ao item, com o sinal da amarração — o mesmo número que a DRE mostra na linha. A conferência cobre só o que a folha toca; a diferença é conta do item sem folha nenhuma.">Item na DRE</th>
            <th style={S.th}>Status</th>
          </tr></thead>
          <tbody>
            {itens.map(it => {
              const ki = `i:${it.id}`; const abI = aberto.has(ki)
              const difI = it.razao - it.folha
              const rzItem = itemRz[it.id]
              // o que a DRE tem no item e a conferência não cobre: conta do item
              // em que a folha não lança nada
              const foraItem = rzItem ? rzItem.razao_item - (it.razao + it.outros) : 0
              return (
                <Fragment key={it.id}>
                  <tr onClick={() => setAberto(prev => { const n = new Set(prev); n.has(ki) ? n.delete(ki) : n.add(ki); return n })}>
                    <td style={{ ...S.gh, fontWeight: 700, background: 'var(--panel-2)' }}>
                      {abI ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {it.desc}
                      <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 8, fontSize: 11.5 }}>
                        {it.contas.length} conta{it.contas.length > 1 ? 's' : ''}
                      </span>
                    </td>
                    <td style={{ ...S.gh, textAlign: 'right', fontWeight: 700, background: 'var(--panel-2)' }}>{money(it.razao)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontWeight: 700, background: 'var(--panel-2)' }}>{money(it.folha)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontWeight: 700, background: 'var(--panel-2)', color: Math.abs(difI) > tol ? 'var(--orange)' : 'var(--muted)' }}>{money(difI)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontWeight: 700, background: 'var(--panel-2)', color: it.outros ? 'var(--blue)' : 'var(--muted)' }}>{it.outros ? money(it.outros) : '—'}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontWeight: 700, background: 'var(--panel-2)' }}>{money(it.razao + it.outros)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', fontWeight: 700, background: 'var(--panel-2)',
                                 color: rzItem && Math.abs(foraItem) > tol ? 'var(--blue)' : undefined }}
                      title={rzItem ? `a DRE conta ${money(foraItem)} a mais neste item — abra a linha para ver o quê` : undefined}>
                      {rzItem ? money(rzItem.razao_item) : '—'}
                    </td>
                    <td style={{ ...S.gh, background: 'var(--panel-2)' }}>{it.fora ? <span style={DIF}>● {it.fora} verba(s)</span> : <span style={OK}>● conciliado</span>}</td>
                  </tr>
                  {abI && rzItem && Math.abs(foraItem) > tol && (
                    <Fragment>
                      <tr>
                        <td style={{ ...S.td, paddingLeft: 30, cursor: 'pointer', color: 'var(--blue)' }}
                          onClick={() => toggle(`if:${it.id}`, () => rpc('conciliacao_item_fora', { ...escopo, p_relatorio_id: relSel, p_linha_id: it.id }))}>
                          {aberto.has(`if:${it.id}`) ? <ChevronDown size={12} /> : <ChevronRight size={12} />} o que a DRE conta neste item e a conferência não
                        </td>
                        {/* razão · folha · diferença · outros ficam vazios: esta
                            linha não é conciliação, é o que a DRE conta a mais */}
                        <td style={S.td}></td><td style={S.td}></td><td style={S.td}></td><td style={S.td}></td>
                        <td style={S.td}></td>
                        <td style={{ ...S.td, textAlign: 'right', color: 'var(--blue)' }}>{money(foraItem)}</td>
                        <td style={S.td}></td>
                      </tr>
                      {aberto.has(`if:${it.id}`) && (
                        <tr><td colSpan={8} style={{ padding: '4px 12px 10px 44px', background: 'var(--bg-soft)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                            Nenhum destes é divergência — são parcelas do item que a conferência não tem o que conciliar.
                            Somados ao razão e aos outros, dão o total da DRE.
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead><tr><th style={S.dh}>Conta</th><th style={S.dh}>Por quê</th><th style={{ ...S.dh, textAlign: 'right' }}>Lanç.</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                            <tbody>
                              {((drill[`if:${it.id}`] as ItemFora[]) || []).map((x, i2) => (
                                <tr key={i2}>
                                  <td style={S.dt}><span style={S.mono}>{x.conta_cod}</span> {x.conta_desc}</td>
                                  <td style={{ ...S.dt, color: 'var(--muted)' }}>{x.motivo}</td>
                                  <td style={{ ...S.dt, textAlign: 'right', color: 'var(--muted)' }}>{x.lancamentos}</td>
                                  <td style={{ ...S.dt, textAlign: 'right' }}>{money(Number(x.valor) || 0)}</td>
                                </tr>
                              ))}
                              {!drill[`if:${it.id}`] && <tr><td colSpan={4} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                    </Fragment>
                  )}
                  {abI && it.contas.map(c => {
              const kc = `c:${c.id}`; const ab = aberto.has(kc)
              return (
                <Fragment key={c.id}>
                  <tr onClick={() => setAberto(prev => { const n = new Set(prev); n.has(kc) ? n.delete(kc) : n.add(kc); return n })}>
                    <td style={{ ...S.gh, paddingLeft: 30 }}>{ab ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <span style={S.mono}>{c.cod}</span> {c.desc}{repetidas.has(c.cod) && c.plano ? <span style={{ ...S.mono, fontSize: 11, marginLeft: 6 }}>· plano {c.plano}</span> : null}</td>
                    <td style={{ ...S.gh, textAlign: 'right' }}>{money(c.razao)}</td>
                    <td style={{ ...S.gh, textAlign: 'right' }}>{money(c.folha)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', color: Math.abs(c.dif) > tol ? 'var(--orange)' : 'var(--muted)' }}>{money(c.dif)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', color: c.outros ? 'var(--blue)' : 'var(--muted)' }}>{c.outros ? money(c.outros) : '—'}</td>
                    <td style={{ ...S.gh, textAlign: 'right' }}>{money(c.razao + c.outros)}</td>
                    <td style={S.gh}></td>
                    <td style={S.gh}>{c.fora.length ? <span style={DIF}>● {c.fora.length} verba(s)</span> : c.outros ? <span style={RES}>● só outros</span> : <span style={OK}>● conciliada</span>}</td>
                  </tr>
                  {ab && c.verbas.sort((a, b) => Math.abs(b.razao - b.folha) - Math.abs(a.razao - a.folha)).map(v => {
                    const dif = v.razao - v.folha; const fora = Math.abs(dif) > tol
                    const kv = `v:${c.id}:${v.verba_cod}`
                    return (
                      <Fragment key={kv}>
                        <tr>
                          <td style={{ ...S.td, paddingLeft: 30, cursor: 'pointer' }}
                            onClick={() => toggle(kv, () => rpc('conciliacao_clt_pessoas', { ...escopo, p_conta: c.id, p_verba: v.verba_cod }))}>
                            {aberto.has(kv) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{' '}
                            <span style={S.mono}>{v.verba_cod}</span> {v.verba_desc || ''}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{money(v.razao)}</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{money(v.folha)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: fora ? 'var(--orange)' : 'var(--muted)' }}>{money(dif)}</td>
                          <td style={S.td}></td><td style={S.td}></td><td style={S.td}></td>
                          <td style={S.td}>{fora ? <span style={DIF}>● fora</span> : <Check size={13} style={{ color: 'var(--green)' }} />}</td>
                        </tr>
                        {aberto.has(kv) && (
                          <tr><td colSpan={8} style={{ padding: '4px 12px 10px 44px', background: 'var(--bg-soft)' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                              Composição da folha — o razão do CLT é consolidado e não tem pessoa, então aqui não há o que comparar.
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead><tr><th style={S.dh}>Matrícula</th><th style={S.dh}>Nome</th><th style={S.dh}>CC</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                              <tbody>
                                {((drill[kv] as Pessoa[]) || []).map((x, i) => (
                                  <tr key={i}><td style={{ ...S.dt, ...S.mono }}>{x.matricula}</td><td style={S.dt}>{x.nome}</td>
                                    <td style={{ ...S.dt, ...S.mono }}>{x.cc_cod || ''}</td>
                                    <td style={{ ...S.dt, textAlign: 'right' }}>{money(Number(x.valor) || 0)}</td></tr>
                                ))}
                                {!drill[kv] && <tr><td colSpan={4} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                              </tbody>
                            </table>
                          </td></tr>
                        )}
                        {fora && <tr><td colSpan={8} style={{ background: 'var(--bg-soft)' }}><BlocoNota contaId={c.id} verba={v.verba_cod} valorRef={dif} /></td></tr>}
                      </Fragment>
                    )
                  })}
                  {ab && !!c.outros && (
                    <Fragment>
                      <tr>
                        <td style={{ ...S.td, paddingLeft: 30, cursor: 'pointer', color: 'var(--blue)' }}
                          onClick={() => toggle(`o:${c.id}`, () => rpc('conciliacao_clt_outros_lanc', { ...escopo, p_conta: c.id }))}>
                          {aberto.has(`o:${c.id}`) ? <ChevronDown size={12} /> : <ChevronRight size={12} />} outros — não veio da contabilização da folha
                        </td>
                        <td style={S.td}></td><td style={S.td}></td><td style={S.td}></td>
                        <td style={{ ...S.td, textAlign: 'right', color: 'var(--blue)' }}>{money(c.outros)}</td>
                        <td style={S.td}></td><td style={S.td}></td>
                        <td style={S.td}>{notas[chave(c.id, null)] ? <Check size={13} style={{ color: 'var(--green)' }} /> : <span style={RES}>● explicar</span>}</td>
                      </tr>
                      {aberto.has(`o:${c.id}`) && (
                        <tr><td colSpan={8} style={{ padding: '4px 12px 10px 44px', background: 'var(--bg-soft)' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead><tr><th style={S.dh}>Data</th><th style={S.dh}>Documento</th><th style={S.dh}>Histórico</th><th style={S.dh}>Lote</th><th style={S.dh}>CC</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                            <tbody>
                              {((drill[`o:${c.id}`] as OutroLanc[]) || []).map((x, i) => (
                                <tr key={i}>
                                  <td style={S.dt}>{x.data || ''}</td><td style={{ ...S.dt, ...S.mono }}>{x.documento || ''}</td>
                                  <td style={S.dt}>{x.historico || ''}</td><td style={{ ...S.dt, ...S.mono }}>{x.lote || ''}</td>
                                  <td style={{ ...S.dt, ...S.mono }}>{x.cc_cod || ''}</td>
                                  <td style={{ ...S.dt, textAlign: 'right' }}>{money(Number(x.valor) || 0)}</td>
                                </tr>
                              ))}
                              {!drill[`o:${c.id}`] && <tr><td colSpan={6} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                      <tr><td colSpan={8} style={{ background: 'var(--bg-soft)' }}><BlocoNota contaId={c.id} verba={null} valorRef={c.outros} /></td></tr>
                    </Fragment>
                  )}
                </Fragment>
              )
            })}
                </Fragment>
              )
            })}
            {!contasClt.length && <tr><td colSpan={8} style={S.empty}>Nenhum lançamento de contabilização da folha nesta competência e escopo.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ─────────── TERCEIROS ─────────── */}
      <div style={S.card}>
        <div style={S.head}>
          <h2 style={S.h2}>Terceiros</h2>
          <span style={S.hsub}>A folha calcula e a nota fiscal paga. Nota tem dono, então compara por pessoa — a conta de cada lado costuma ser diferente, e aparece no detalhe.</span>
        </div>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Pessoa</th>
            <th style={S.th}>Fornecedor</th>
            <th style={S.th}>CC</th>
            <th style={{ ...S.th, textAlign: 'right' }}>NF</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Razão</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Diferença</th>
            <th style={S.th}>Status</th>
          </tr></thead>
          <tbody>
            {pessoas.map((t, i) => {
              const dif = t.razao - t.folha; const fora = Math.abs(dif) > tol
              const kp = `p:${t.filial_id}:${t.matricula}:${i}`
              const st = ST[t.status]
              return (
                <Fragment key={kp}>
                  <tr>
                    <td style={{ ...S.td, cursor: t.matricula ? 'pointer' : 'default' }}
                      onClick={() => t.matricula && toggle(kp, () => rpc('conciliacao_terceiros_pessoa', { ...escopo, p_relatorio_id: relSel, p_filial_id: t.filial_id, p_matricula: t.matricula }))}>
                      {t.matricula ? (aberto.has(kp) ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}{' '}
                      <span style={S.mono}>{t.matricula || ''}</span> {t.nome || t.nome_fantasia || ''}
                    </td>
                    {/* "via NOME" = casou pelo nome do participante no histórico, sem
                        passar pelo de-para. É o caso da cooperativa. */}
                    <td style={{ ...S.td, color: 'var(--muted)' }}>
                      {t.fornecedor_cod ? `${t.fornecedor_cod} · ${t.nome_fantasia || ''}` : (t.via === 'NOME' ? 'pelo nome no histórico' : '')}
                    </td>
                    <td style={{ ...S.td, ...S.mono }}>{t.cc_cod || ''}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{t.lancamentos || ''}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{money(t.razao)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{money(t.folha)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: fora ? 'var(--orange)' : 'var(--muted)' }}>{money(dif)}</td>
                    <td style={S.td} title={st?.ajuda}><span style={st?.est || RES}>● {st?.txt || t.status}</span></td>
                  </tr>
                  {aberto.has(kp) && (
                    <tr><td colSpan={8} style={{ padding: '4px 12px 10px 30px', background: 'var(--bg-soft)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead><tr><th style={S.dh}>Lado</th><th style={S.dh}>Conta</th><th style={S.dh}>Verba / fornecedor</th><th style={S.dh}>CC</th><th style={S.dh}>Documento</th><th style={S.dh}>Histórico</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                        <tbody>
                          {((drill[kp] as Lado[]) || []).map((x, j) => (
                            <tr key={j}>
                              <td style={S.dt}><span style={x.lado === 'FOLHA' ? RES : OK}>{x.lado}</span></td>
                              <td style={{ ...S.dt, ...S.mono }}>{x.conta_cod}</td>
                              <td style={S.dt}>{x.ref || ''}</td>
                              <td style={{ ...S.dt, ...S.mono }}>{x.cc_cod || ''}</td>
                              <td style={{ ...S.dt, ...S.mono }}>{x.documento || ''}</td>
                              <td style={S.dt}>{x.historico || ''}</td>
                              <td style={{ ...S.dt, textAlign: 'right' }}>{money(Number(x.valor) || 0)}</td>
                            </tr>
                          ))}
                          {!drill[kp] && <tr><td colSpan={8} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {!pessoas.length && <tr><td colSpan={8} style={S.empty}>Nenhum terceiro nesta competência e escopo.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ─────────── SEM DONO ─────────── */}
      {!!semDono.length && (
        <div style={S.card}>
          <div style={S.head}>
            <h2 style={S.h2}>Outros lançamentos</h2>
            <span style={S.hsub}>Nota fiscal que entrou numa conta de terceiro e não casou com ninguém. Ou o prestador é empresa e nunca terá pessoa,
              ou falta amarração em <b>Estrutura → Fornecedores (PJ)</b>. O que é de conta de CLT não vem para cá — fica na coluna <b>outros</b> da própria conta.</span>
          </div>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Texto do histórico</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Lançamentos</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Valor</th>
              <th style={S.th}>Status</th>
              <th style={S.th} />
            </tr></thead>
            <tbody>
              {semDono.sort((a, b) => b.razao - a.razao).map((t, i) => {
                const txt = t.nome_fantasia || ''
                const q = buscaP.trim().toLowerCase()
                const cand = q ? pessoasFolha.filter(pe => (pe.nome || '').toLowerCase().includes(q) || pe.matricula.includes(q)).slice(0, 8) : []
                return (
                  <Fragment key={i}>
                    <tr>
                      <td style={S.td}><span style={{ fontStyle: 'italic', color: 'var(--text-mid)' }}>{txt || '—'}</span></td>
                      <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{t.lancamentos}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{money(t.razao)}</td>
                      <td style={S.td} title={ST[t.status]?.ajuda}><span style={ST[t.status]?.est || RES}>● {ST[t.status]?.txt}</span></td>
                      <td style={S.td}>
                        {txt && (amarrando === txt
                          ? <button style={{ ...S.inp, padding: '3px 8px', fontSize: 11.5, cursor: 'pointer' }} onClick={() => setAmarrando(null)}>cancelar</button>
                          : <button style={{ ...S.inp, padding: '3px 8px', fontSize: 11.5, cursor: 'pointer', color: 'var(--violet)', fontWeight: 600 }}
                              onClick={() => abrirAmarrar(txt)}>amarrar a uma pessoa</button>)}
                      </td>
                    </tr>
                    {amarrando === txt && (
                      <tr><td colSpan={5} style={{ padding: '8px 12px 12px 30px', background: 'var(--bg-soft)' }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                          De quem é <b style={{ color: 'var(--text)' }}>{txt}</b>? A amarração fica gravada como manual — a próxima
                          importação do de-para não a apaga, e o mesmo texto casa sozinho nos meses seguintes.
                        </div>
                        <input autoFocus style={{ ...S.inp, width: 320 }} value={buscaP} placeholder="nome ou matrícula da pessoa na folha…"
                          onChange={e => setBuscaP(e.target.value)} />
                        <div style={{ marginTop: 6 }}>
                          {cand.map(pe => (
                            <div key={pe.filial_id + pe.matricula} onClick={() => !salvandoAm && amarrar(txt, pe)}
                              style={{ padding: '4px 8px', fontSize: 12.5, cursor: 'pointer', borderRadius: 6, display: 'flex', gap: 10 }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-2)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <span style={S.mono}>{pe.filial_cod || '??'}-{pe.matricula}</span>
                              <span style={{ flex: 1 }}>{pe.nome}</span>
                              <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>folha {money(Number(pe.valor) || 0)}</span>
                            </div>
                          ))}
                          {!!q && !cand.length && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 8px' }}>Ninguém com esse nome na folha desta competência.</div>}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
              <tr>
                <td style={{ ...S.td, cursor: 'pointer', color: 'var(--blue)' }}
                  onClick={() => toggle('sd', () => rpc('conciliacao_terceiros_outras', { ...escopo, p_relatorio_id: relSel }))}>
                  {aberto.has('sd') ? <ChevronDown size={12} /> : <ChevronRight size={12} />} ver os lançamentos, com a conta de cada um
                </td>
                <td style={S.td}></td><td style={S.td}></td>
                <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{money(totSemDono)}</td>
                <td style={S.td}></td>
              </tr>
              {aberto.has('sd') && (
                <tr><td colSpan={5} style={{ padding: '4px 12px 10px 30px', background: 'var(--bg-soft)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr><th style={S.dh}>Conta</th><th style={S.dh}>Data</th><th style={S.dh}>Documento</th><th style={S.dh}>Histórico</th><th style={S.dh}>Lote</th><th style={S.dh}>CC</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                    <tbody>
                      {((drill['sd'] as SemDono[]) || []).map((x, i) => (
                        <tr key={i}>
                          <td style={{ ...S.dt, ...S.mono }}>{x.conta_cod}</td>
                          <td style={S.dt}>{x.data || ''}</td>
                          <td style={{ ...S.dt, ...S.mono }}>{x.documento || ''}</td>
                          <td style={S.dt}>{x.historico || ''}</td>
                          <td style={{ ...S.dt, ...S.mono }}>{x.lote || ''}</td>
                          <td style={{ ...S.dt, ...S.mono }}>{x.cc_cod || ''}</td>
                          <td style={{ ...S.dt, textAlign: 'right' }}>{money(Number(x.valor) || 0)}</td>
                        </tr>
                      ))}
                      {!drill['sd'] && <tr><td colSpan={8} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                    </tbody>
                  </table>
                  {/* a justificativa é por conta: o resíduo é o único bloco que ainda pede uma */}
                  {[...new Map(((drill['sd'] as SemDono[]) || []).map(x => [x.conta_id, x])).values()].map(x => (
                    <div key={x.conta_id}>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, marginLeft: 30 }}>
                        <span style={S.mono}>{x.conta_cod}</span> {x.conta_desc}
                      </div>
                      <BlocoNota contaId={x.conta_id} verba={null} valorRef={0} />
                    </div>
                  ))}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── o que saiu da conferência, para não sumir ─── */}
      {!!patrim.length && (
        <div style={S.card}>
          <div style={{ ...S.head, cursor: 'pointer', borderBottom: aberto.has('pat') ? '1px solid var(--border)' : 'none' }}
            onClick={() => setAberto(prev => { const n = new Set(prev); n.has('pat') ? n.delete('pat') : n.add('pat'); return n })}>
            {aberto.has('pat') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <h2 style={{ ...S.h2, fontWeight: 600, color: 'var(--text-mid)' }}>Contas patrimoniais · fora da conferência</h2>
            <span style={S.hsub}>
              Provisão de férias, salários a pagar, adiantamento. É folha de verdade, mas não é resultado —
              a conferência valida resultado. Fica aqui para não sumir da vista.
            </span>
            <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>
              {patrim.length} contas · folha {money(totPat.folha)}
            </span>
          </div>
          {aberto.has('pat') && (
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Conta</th><th style={S.th}>Natureza</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Razão</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Diferença</th>
              </tr></thead>
              <tbody>
                {patrim.map((x, i) => (
                  <tr key={i}>
                    <td style={S.td}><span style={S.mono}>{x.conta_cod}</span> {x.conta_desc}</td>
                    <td style={{ ...S.td, color: 'var(--muted)' }}>{x.natureza}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{money(x.razao)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{money(x.folha)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{money(x.razao - x.folha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ConciliacaoQuadro params={p} />
    </div>
  )
}
