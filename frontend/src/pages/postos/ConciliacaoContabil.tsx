import { useEffect, useMemo, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { AlertCircle, ChevronDown, ChevronRight, Check, MessageSquare } from 'lucide-react'

// Conciliação CONTÁBIL × FOLHA (camada 2). Responde, em três níveis:
//   1. a conta bate?  — razão separado em "veio da folha" × "outras origens"
//   2. qual verba explica? — dentro da parcela da folha, verba a verba
//   3. quem? — a folha aberta por funcionário; é a resposta que a área quer
// O resíduo (outras origens) nunca terá funcionário: é fatura paga direto,
// ajuste de competência, NF de PJ. Esse pede justificativa escrita.
// A classificação vem do banco (v3_080): lançamento do razão cujo histórico
// começa com um código de verba da competência veio da folha.

export type ContabilParams = {
  ano: number; mes: number
  empresaSel: string[]; filialFilter: string[] | null; ccFilter: string[] | null
}
type Row = { conta_id: string; conta_cod: string; conta_desc: string; verba_cod: string | null; verba_desc: string | null; origem: 'FOLHA' | 'OUTRAS'; razao: number; folha: number }
type Nota = { id: string; conta_id: string; verba_cod: string | null; motivo: string }
type Pessoa = { matricula: string; nome: string; valor: number }
type Lanc = { data: string | null; documento: string | null; historico: string | null; lote: string | null; cc_cod: string | null; valor: number }

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const chave = (contaId: string, verba: string | null) => `${contaId}|${verba || ''}`

const S: Record<string, CSSProperties> = {
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '0 0 16px' },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiS:  { fontSize: 11, color: 'var(--faint)' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  gh:    { padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  dh:    { textAlign: 'left', padding: '4px 8px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  dt:    { padding: '3px 8px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 16px' },
  empty: { padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
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

export function ConciliacaoContabil({ params: p, podeConfigurar }: { params: ContabilParams; podeConfigurar: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [notas, setNotas] = useState<Record<string, Nota>>({})
  const [tol, setTol] = useState(1)
  const [tolTxt, setTolTxt] = useState('1,00')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [drill, setDrill] = useState<Record<string, Pessoa[] | Lanc[]>>({})
  const [editNota, setEditNota] = useState<string | null>(null)
  const [txtNota, setTxtNota] = useState('')

  const escopo = useMemo(() => ({
    p_ano: p.ano, p_mes: p.mes,
    p_empresas: p.empresaSel.length ? p.empresaSel : null,
    p_filiais: p.filialFilter, p_ccs: p.ccFilter,
  }), [p.ano, p.mes, p.empresaSel, p.filialFilter, p.ccFilter])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setLoading(true); setErro(null); setAberto(new Set()); setDrill({})
      const [r, n, t] = await Promise.all([
        supabase.rpc('conciliacao_folha_contabil', escopo),
        supabase.from('conciliacao_folha_nota').select('id,conta_id,verba_cod,motivo').eq('ano', p.ano).eq('mes', p.mes),
        supabase.from('tenant').select('conciliacao_tolerancia').eq('id', TENANT_ID).maybeSingle(),
      ])
      if (!vivo) return
      if (r.error) { setErro(r.error.message); setRows([]); setLoading(false); return }
      setRows((r.data || []) as Row[])
      const map: Record<string, Nota> = {}
      ;((n.data || []) as Nota[]).forEach(x => { map[chave(x.conta_id, x.verba_cod)] = x })
      setNotas(map)
      const v = Number(t.data?.conciliacao_tolerancia ?? 1)
      setTol(v); setTolTxt(money(v))
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [escopo]) // eslint-disable-line

  // agrupa por conta: as verbas (parcela da folha) e a linha única de resíduo
  const contas = useMemo(() => {
    const m = new Map<string, { id: string; cod: string; desc: string; verbas: Row[]; outras: number }>()
    for (const r of rows) {
      const g = m.get(r.conta_id) || { id: r.conta_id, cod: r.conta_cod, desc: r.conta_desc, verbas: [], outras: 0 }
      if (r.origem === 'OUTRAS') g.outras += Number(r.razao) || 0
      else g.verbas.push({ ...r, razao: Number(r.razao) || 0, folha: Number(r.folha) || 0 })
      m.set(r.conta_id, g)
    }
    return [...m.values()].map(g => {
      const razao = g.verbas.reduce((s, v) => s + v.razao, 0)
      const folha = g.verbas.reduce((s, v) => s + v.folha, 0)
      const foraTol = g.verbas.filter(v => Math.abs(v.razao - v.folha) > tol)
      return { ...g, razao, folha, dif: razao - folha, foraTol }
    }).sort((a, b) => a.cod.localeCompare(b.cod))
  }, [rows, tol])

  const tot = useMemo(() => contas.reduce((s, c) => ({
    razao: s.razao + c.razao, folha: s.folha + c.folha, outras: s.outras + c.outras,
    pend: s.pend + c.foraTol.length + (Math.abs(c.outras) > tol && !notas[chave(c.id, null)] ? 1 : 0),
  }), { razao: 0, folha: 0, outras: 0, pend: 0 }), [contas, tol, notas])

  const salvarTolerancia = async () => {
    const v = Number(tolTxt.replace(/\./g, '').replace(',', '.'))
    if (!isFinite(v) || v < 0) { setTolTxt(money(tol)); return }
    const { error } = await supabase.from('tenant').update({ conciliacao_tolerancia: v }).eq('id', TENANT_ID)
    if (error) { setErro(error.message); return }
    setTol(v); setTolTxt(money(v))
  }

  const toggle = async (k: string, carregar: () => Promise<Pessoa[] | Lanc[]>) => {
    setAberto(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
    if (!drill[k]) { const d = await carregar(); setDrill(prev => ({ ...prev, [k]: d })) }
  }
  // nível 3: a folha por funcionário — o razão não tem matrícula, e não precisa:
  // se a verba fecha no nível 2, esta lista É a composição do número contábil.
  const pessoasDaVerba = async (contaId: string, verba: string): Promise<Pessoa[]> => {
    const linhas = await pageAll(() => {
      let q = supabase.from('fat_folha').select('matricula,nome,valor')
        .eq('tipo', 'REALIZADO').eq('ano', p.ano).eq('mes', p.mes).eq('conta_id', contaId).eq('verba_cod', verba)
      if (p.empresaSel.length) q = q.in('empresa_id', p.empresaSel)
      if (p.filialFilter) q = q.in('filial_id', p.filialFilter)
      if (p.ccFilter) q = q.in('cc_id', p.ccFilter)
      return q
    })
    const m = new Map<string, Pessoa>()
    ;(linhas as any[]).forEach(l => {
      const k = l.matricula || l.nome || '?'
      const g = m.get(k) || { matricula: l.matricula || '', nome: l.nome || '', valor: 0 }
      g.valor += Number(l.valor) || 0; m.set(k, g)
    })
    return [...m.values()].sort((a, b) => b.valor - a.valor)
  }
  const lancamentosOutras = async (contaId: string): Promise<Lanc[]> => {
    const { data, error } = await supabase.rpc('conciliacao_folha_outras', { ...escopo, p_conta: contaId })
    if (error) { setErro(error.message); return [] }
    return (data || []) as Lanc[]
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
  if (!contas.length) return <div style={S.empty}>Nenhuma folha com conta contábil resolvida nesta competência e escopo.</div>

  return (
    <div>
      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Razão · origem folha</div><div style={S.kpiV}>{money(tot.razao)}</div><div style={S.kpiS}>o que a contabilização da folha lançou</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Folha analítica</div><div style={S.kpiV}>{money(tot.folha)}</div><div style={S.kpiS}>o mesmo dinheiro, por funcionário</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Diferença</div><div style={{ ...S.kpiV, color: Math.abs(tot.razao - tot.folha) > tol ? 'var(--orange)' : 'var(--green)' }}>{money(tot.razao - tot.folha)}</div><div style={S.kpiS}>tolerância R$ {money(tol)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Outras origens</div><div style={{ ...S.kpiV, color: 'var(--blue)' }}>{money(tot.outras)}</div><div style={S.kpiS}>{tot.pend ? `${tot.pend} ponto(s) a explicar` : 'tudo justificado'}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', margin: '0 0 12px' }}>
        <div style={S.fld}><span style={S.lbl}>Tolerância (R$)</span>
          <input style={{ ...S.inp, width: 110, textAlign: 'right' }} value={tolTxt} disabled={!podeConfigurar}
            title={podeConfigurar ? 'Vale para todos — é política de controladoria, não preferência de tela.' : 'Só administrador altera: a tolerância vale para todos os usuários.'}
            onChange={e => setTolTxt(e.target.value)} onBlur={salvarTolerancia}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>
          Abaixo disso a verba conta como conciliada — rateio e arredondamento não são divergência.
        </span>
      </div>

      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Conta / verba</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Razão (folha)</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Diferença</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Outras origens</th>
            <th style={S.th}>Status</th>
          </tr></thead>
          <tbody>
            {contas.map(c => {
              const kc = `c:${c.id}`; const abertoC = aberto.has(kc)
              const temResiduo = Math.abs(c.outras) > tol
              const st = c.foraTol.length ? DIF : temResiduo ? RES : OK
              const stTxt = c.foraTol.length ? `${c.foraTol.length} verba(s)` : temResiduo ? 'só resíduo' : 'conciliada'
              return (
                <Fragment key={c.id}>
                  <tr onClick={() => setAberto(prev => { const n = new Set(prev); n.has(kc) ? n.delete(kc) : n.add(kc); return n })}>
                    <td style={S.gh}>{abertoC ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <span style={S.mono}>{c.cod}</span> {c.desc}</td>
                    <td style={{ ...S.gh, textAlign: 'right' }}>{money(c.razao)}</td>
                    <td style={{ ...S.gh, textAlign: 'right' }}>{money(c.folha)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', color: Math.abs(c.dif) > tol ? 'var(--orange)' : 'var(--muted)' }}>{money(c.dif)}</td>
                    <td style={{ ...S.gh, textAlign: 'right', color: temResiduo ? 'var(--blue)' : 'var(--muted)' }}>{c.outras ? money(c.outras) : '—'}</td>
                    <td style={S.gh}><span style={st}>● {stTxt}</span></td>
                  </tr>

                  {abertoC && c.verbas.sort((a, b) => b.folha - a.folha).map(v => {
                    const dif = v.razao - v.folha; const fora = Math.abs(dif) > tol
                    const kv = `v:${c.id}:${v.verba_cod}`
                    return (
                      <Fragment key={kv}>
                        <tr>
                          <td style={{ ...S.td, paddingLeft: 30, cursor: v.verba_cod ? 'pointer' : 'default' }}
                            onClick={() => v.verba_cod && toggle(kv, () => pessoasDaVerba(c.id, v.verba_cod!))}>
                            {v.verba_cod ? (aberto.has(kv) ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}{' '}
                            <span style={S.mono}>{v.verba_cod || '—'}</span> {v.verba_desc || ''}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{money(v.razao)}</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{money(v.folha)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: fora ? 'var(--orange)' : 'var(--muted)' }}>{money(dif)}</td>
                          <td style={S.td}></td>
                          <td style={S.td}>{fora ? <span style={DIF}>● fora</span> : <Check size={13} style={{ color: 'var(--green)' }} />}</td>
                        </tr>
                        {aberto.has(kv) && (
                          <tr><td colSpan={6} style={{ padding: '4px 12px 10px 44px', background: 'var(--bg-soft)' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead><tr><th style={S.dh}>Matrícula</th><th style={S.dh}>Nome</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                              <tbody>
                                {((drill[kv] as Pessoa[]) || []).map((x, i) => (
                                  <tr key={i}><td style={{ ...S.dt, ...S.mono }}>{x.matricula}</td><td style={S.dt}>{x.nome}</td><td style={{ ...S.dt, textAlign: 'right' }}>{money(x.valor)}</td></tr>
                                ))}
                                {!((drill[kv] as Pessoa[]) || []).length && <tr><td colSpan={3} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                              </tbody>
                            </table>
                          </td></tr>
                        )}
                        {fora && <tr><td colSpan={6} style={{ background: 'var(--bg-soft)' }}><BlocoNota contaId={c.id} verba={v.verba_cod} valorRef={dif} /></td></tr>}
                      </Fragment>
                    )
                  })}

                  {abertoC && !!c.outras && (
                    <Fragment>
                      <tr>
                        <td style={{ ...S.td, paddingLeft: 30, cursor: 'pointer', color: 'var(--blue)' }}
                          onClick={() => toggle(`o:${c.id}`, () => lancamentosOutras(c.id))}>
                          {aberto.has(`o:${c.id}`) ? <ChevronDown size={12} /> : <ChevronRight size={12} />} outras origens — não veio da folha
                        </td>
                        <td style={S.td}></td><td style={S.td}></td><td style={S.td}></td>
                        <td style={{ ...S.td, textAlign: 'right', color: 'var(--blue)' }}>{money(c.outras)}</td>
                        <td style={S.td}>{notas[chave(c.id, null)] ? <Check size={13} style={{ color: 'var(--green)' }} /> : <span style={RES}>● explicar</span>}</td>
                      </tr>
                      {aberto.has(`o:${c.id}`) && (
                        <tr><td colSpan={6} style={{ padding: '4px 12px 10px 44px', background: 'var(--bg-soft)' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead><tr><th style={S.dh}>Data</th><th style={S.dh}>Documento</th><th style={S.dh}>Histórico</th><th style={S.dh}>Lote</th><th style={S.dh}>CC</th><th style={{ ...S.dh, textAlign: 'right' }}>Valor</th></tr></thead>
                            <tbody>
                              {((drill[`o:${c.id}`] as Lanc[]) || []).map((x, i) => (
                                <tr key={i}>
                                  <td style={S.dt}>{x.data || ''}</td><td style={{ ...S.dt, ...S.mono }}>{x.documento || ''}</td>
                                  <td style={S.dt}>{x.historico || ''}</td><td style={{ ...S.dt, ...S.mono }}>{x.lote || ''}</td>
                                  <td style={{ ...S.dt, ...S.mono }}>{x.cc_cod || ''}</td>
                                  <td style={{ ...S.dt, textAlign: 'right' }}>{money(Number(x.valor) || 0)}</td>
                                </tr>
                              ))}
                              {!((drill[`o:${c.id}`] as Lanc[]) || []).length && <tr><td colSpan={6} style={{ ...S.dt, color: 'var(--muted)' }}>carregando…</td></tr>}
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                      <tr><td colSpan={6} style={{ background: 'var(--bg-soft)' }}><BlocoNota contaId={c.id} verba={null} valorRef={c.outras} /></td></tr>
                    </Fragment>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
