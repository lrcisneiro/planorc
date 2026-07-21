import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { useCapacidades } from '../../hooks/useCapacidades'
import { Plus, Trash2, AlertCircle, Save, X } from 'lucide-react'

// Rateio (P1 step 4) — CÓDIGOS de rateio reutilizáveis: cada código redistribui
// UMA dimensão (CC ou EMPRESA) em destinos (% soma 100). A ORIGEM é o próprio
// posto (empresa/CC do posto) — não se cadastra aqui. O código é anexado ao
// posto na grade (posto_rateio), em cascata (ordem). A aplicação real no
// fat_orcado é o motor de rateio no Aplicar (step 5).

const num = (s: any) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return isNaN(n) ? 0 : n }
const fmtPct = (n: number) => n.toFixed(2).replace('.', ',')   // 20 → "20,00" · 33.33 → "33,33"

const pill = (a: boolean, off?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: off ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : off ? 'var(--border-strong)' : 'var(--text-mid)', opacity: off ? 0.7 : 1 })

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
  grid:  { display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 1.6fr', gap: 16, alignItems: 'start' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  cardT: { padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  regra: (a: boolean): CSSProperties => ({ padding: '10px 14px', borderBottom: '1px solid var(--panel-2)', cursor: 'pointer', background: a ? 'rgba(139,92,246,0.10)' : 'transparent' }),
  tag:   (cor: string): CSSProperties => ({ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 6, color: cor, border: `1px solid ${cor}55`, background: `${cor}18` }),
  finp:  { padding: '6px 9px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' },
  flbl:  { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 },
  th:    { textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)' },
  td:    { padding: '5px 10px', borderBottom: '1px solid var(--panel-2)' },
  del:   { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--border-strong)', padding: 3 },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 14px' },
  empty: { padding: '34px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
}

type Regra = { id: string; nome: string; dimensao: string | null; ativo: boolean }
type Dest = { id?: string; empresa_id?: string | null; cc_id?: string | null; pct: string }

export default function PostosRateioPage() {
  const cap = useCapacidades()
  const editavel = cap.can('orcar')
  const [empresas, setEmpresas] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [regras, setRegras] = useState<Regra[]>([])
  const [selId, setSelId] = useState<string>('')
  const [form, setForm] = useState<Regra | null>(null)
  const [destinos, setDestinos] = useState<Dest[]>([])
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const [e, c] = await Promise.all([
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
      ])
      setEmpresas(e.data || []); setCcs(c.data || [])
    })()
  }, [])
  const loadRegras = async () => {
    const { data } = await supabase.from('rateio_regra').select('id,nome,dimensao,ativo').order('nome')
    setRegras((data || []) as Regra[])
  }
  useEffect(() => { loadRegras() }, [])
  useEffect(() => {
    if (!selId || selId === 'new') { setDestinos([]); return }
    supabase.from('rateio_destino').select('id,empresa_id,cc_id,pct').eq('regra_id', selId)
      .then(r => setDestinos((r.data || []).map((d: any) => ({ ...d, pct: fmtPct(Number(d.pct) || 0) }))))
  }, [selId])

  const novaRegra = () => { setSelId('new'); setForm({ id: '', nome: '', dimensao: 'EMPRESA', ativo: true }); setDestinos([]) }
  const abrir = (r: Regra) => { setSelId(r.id); setForm({ ...r }) }

  const salvarRegra = async () => {
    if (!form) return
    if (!form.nome.trim()) { setErro('Dê um nome ao código de rateio.'); return }
    if (!form.dimensao) { setErro('Selecione a dimensão do rateio.'); return }
    setErro(null)
    const payload = { tenant_id: TENANT_ID, nome: form.nome.trim(), dimensao: form.dimensao, ativo: form.ativo }
    if (selId === 'new') {
      const { data, error } = await supabase.from('rateio_regra').insert(payload).select('id').single()
      if (error) { setErro(error.message); return }
      await loadRegras(); if (data) { setSelId(data.id); setForm({ ...form, id: data.id }) }
    } else {
      const { error } = await supabase.from('rateio_regra').update(payload).eq('id', selId)
      if (error) { setErro(error.message); return }
      loadRegras()
    }
  }
  const excluirRegra = async (id: string) => {
    if (!confirm('Excluir este código de rateio (e seus destinos)?')) return
    const { error } = await supabase.from('rateio_regra').delete().eq('id', id)
    if (error) { setErro(error.message); return }
    if (selId === id) { setSelId(''); setForm(null) }
    loadRegras()
  }
  const salvarDestinos = async () => {
    if (selId === 'new' || !form) { setErro('Salve o código antes dos destinos.'); return }
    const dim = form.dimensao
    const rows = destinos.filter(d => (dim === 'EMPRESA' ? d.empresa_id : d.cc_id) && num(d.pct))
      .map(d => ({ regra_id: selId, empresa_id: dim === 'EMPRESA' ? d.empresa_id : null, cc_id: dim === 'CC' ? d.cc_id : null, pct: num(d.pct) }))
    setErro(null)
    await supabase.from('rateio_destino').delete().eq('regra_id', selId)
    if (rows.length) { const { error } = await supabase.from('rateio_destino').insert(rows); if (error) { setErro(error.message); return } }
    supabase.from('rateio_destino').select('id,empresa_id,cc_id,pct').eq('regra_id', selId).then(r => setDestinos((r.data || []).map((d: any) => ({ ...d, pct: Number(d.pct) || 0 }))))
  }

  const somaPct = destinos.reduce((s, d) => s + num(d.pct), 0)
  const dim = form?.dimensao || 'EMPRESA'

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Rateio</h1>
          <p style={S.sub}>Códigos de rateio reutilizáveis: cada código redistribui uma dimensão (CC ou empresa) em destinos (% = 100). A origem é o próprio posto — os códigos são anexados aos postos na grade, em cascata.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link to="/postos" style={pill(false)}>1 · Postos</Link>
          <Link to="/postos/regras" style={pill(false)}>2 · Estrutura</Link>
          <Link to="/postos/memoria" style={pill(false)}>3 · Memória</Link>
          <span style={pill(true)}>4 · Rateio</span>
          <Link to="/postos/folha" style={pill(false)}>5 · Folha</Link>
        </div>
      </div>

      <div style={S.bar}>
        <div style={{ flex: 1 }} />
        {editavel && <button style={S.btnPri} onClick={novaRegra}><Plus size={14} /> Novo código</button>}
      </div>

      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}

      <div style={S.grid}>
        {/* Master: lista de códigos */}
        <div style={S.card}>
          <div style={S.cardT}>Códigos de rateio <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{regras.length}</span></div>
          {regras.map(r => (
            <div key={r.id} style={S.regra(selId === r.id)} onClick={() => abrir(r)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={S.tag(r.dimensao === 'CC' ? 'var(--blue)' : 'var(--violet)')}>→ {r.dimensao === 'CC' ? 'CCs' : 'Empresas'}</span>
                {!r.ativo && <span style={{ fontSize: 10, color: 'var(--red)' }}>inativo</span>}
                {editavel && <span style={{ marginLeft: 'auto' }}><button style={S.del} title="Excluir" onClick={e => { e.stopPropagation(); excluirRegra(r.id) }}><Trash2 size={14} /></button></span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 3, fontWeight: 600 }}>{r.nome || '(sem nome)'}</div>
            </div>
          ))}
          {!regras.length && <div style={S.empty}>Nenhum código ainda. Clique em "Novo código".</div>}
        </div>

        {/* Detail: código + destinos */}
        <div style={S.card}>
          {!form ? <div style={S.empty}>Selecione ou crie um código de rateio.</div> : (
            <>
              <div style={S.cardT}>{selId === 'new' ? 'Novo código' : 'Editar código'}
                <button style={S.del} onClick={() => { setForm(null); setSelId('') }}><X size={16} /></button>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px' }}>
                  <div style={{ gridColumn: '1 / -1' }}><span style={S.flbl}>Nome do código</span>
                    <input style={S.finp} value={form.nome} onChange={e => setForm(f => f && ({ ...f, nome: e.target.value }))} disabled={!editavel} placeholder="ex.: CSC RH → empresas" /></div>
                  <div><span style={S.flbl}>Distribui por (dimensão)</span>
                    <select style={S.finp} value={form.dimensao || ''} onChange={e => setForm(f => f && ({ ...f, dimensao: e.target.value }))} disabled={!editavel}>
                      <option value="EMPRESA">Empresa</option><option value="CC">Centro de custo</option>
                    </select>
                  </div>
                </div>
                {editavel && <div style={{ marginTop: 12 }}><button style={S.btnPri} onClick={salvarRegra}><Save size={14} /> Salvar código</button></div>}

                {/* Destinos */}
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Destinos ({dim === 'CC' ? 'centros de custo' : 'empresas'})</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: Math.round(somaPct) === 100 ? 'var(--green)' : 'var(--orange)' }}>Σ {somaPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</div>
                </div>
                {selId === 'new' ? <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Salve o código para adicionar os destinos.</div> : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                      <thead><tr><th style={S.th}>{dim === 'CC' ? 'Centro de custo' : 'Empresa'}</th><th style={{ ...S.th, width: 90, textAlign: 'right' }}>%</th><th style={{ ...S.th, width: 30 }} /></tr></thead>
                      <tbody>
                        {destinos.map((d, i) => (
                          <tr key={i}>
                            <td style={S.td}>
                              <select style={S.finp} value={(dim === 'CC' ? d.cc_id : d.empresa_id) || ''} disabled={!editavel}
                                onChange={e => setDestinos(ds => ds.map((x, j) => j === i ? { ...x, [dim === 'CC' ? 'cc_id' : 'empresa_id']: e.target.value } : x))}>
                                <option value="">—</option>
                                {(dim === 'CC' ? ccs : empresas).map((o: any) => <option key={o.id} value={o.id}>{o.codigo} · {o.descricao}</option>)}
                              </select>
                            </td>
                            <td style={{ ...S.td, textAlign: 'right' }}><input style={{ ...S.finp, width: 80, textAlign: 'right' }} value={d.pct} disabled={!editavel} inputMode="decimal" placeholder="0,00"
                              onChange={e => setDestinos(ds => ds.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))}
                              onBlur={e => { const t = e.target.value.trim(); setDestinos(ds => ds.map((x, j) => j === i ? { ...x, pct: t ? fmtPct(num(t)) : '' } : x)) }} /></td>
                            <td style={S.td}>{editavel && <button style={S.del} onClick={() => setDestinos(ds => ds.filter((_, j) => j !== i))}><Trash2 size={13} /></button>}</td>
                          </tr>
                        ))}
                        {!destinos.length && <tr><td colSpan={3} style={{ ...S.td, color: 'var(--muted)', fontSize: 12 }}>Sem destinos.</td></tr>}
                      </tbody>
                    </table>
                    {editavel && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button style={S.btn} onClick={() => setDestinos(ds => [...ds, { pct: '' }])}><Plus size={13} /> Destino</button>
                      <button style={S.btnPri} onClick={salvarDestinos}><Save size={14} /> Salvar destinos</button>
                    </div>}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
