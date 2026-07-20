import { useEffect, useMemo, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { calcularPosto } from '../../lib/motorFolha'
import type { VerbaRegra, ResultadoPosto } from '../../lib/motorFolha'
import { ChevronDown, ChevronRight, Printer, Split } from 'lucide-react'
import { RateioModal } from './RateioModal'

// Memória de cálculo (P1, pill 3) — read-only. Cascata por posto + totais por conta de destino.
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const milAno = (v: number) => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${money(v)}`
const catCor: Record<string, string> = { 'Salário': 'var(--green)', Encargos: 'var(--orange)', 'Provisões': 'var(--blue)', 'Benefícios': 'var(--violet)' }

type Posto = {
  id: string; codigo: string; nome: string | null; regime: string | null; salario_base: number; fte: number; ativo?: boolean
  ini_ano: number | null; ini_mes: number | null; fim_ano: number | null; fim_mes: number | null
  empresa_id: string; filial_id: string | null; cc_id: string | null; sindicato_id: string | null
  cargo?: { nome: string } | null; empresa?: { codigo: string } | null; filial?: { codigo: string } | null
  centro_custo?: { codigo: string; descricao: string } | null
}

const pill = (a: boolean, off?: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: off ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : off ? 'var(--border-strong)' : 'var(--text-mid)', opacity: off ? 0.7 : 1 })

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  top:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' },
  bar:   { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '20px 0 16px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiH:  { fontSize: 11.5, color: 'var(--muted)' },
  grid2: { display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) 2fr', gap: 16, alignItems: 'start' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  cardT: { padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap' },
  gh:    { padding: '7px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)' },
  sub2:  { padding: '4px 12px 4px 34px', fontSize: 12, color: 'var(--muted)' },
  empty: { padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
}

export default function PostosMemoriaPage() {
  const acesso = useUserAccess()
  const [postos, setPostos] = useState<Posto[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [contas, setContas] = useState<any[]>([])
  const [versoes, setVersoes] = useState<any[]>([])
  const [versaoSel, setVersaoSel] = useState('')
  const [verbas, setVerbas] = useState<VerbaRegra[]>([])
  const [sindMesBase, setSindMesBase] = useState<Record<string, number>>({})
  const [dissidio, setDissidio] = useState<Record<string, number>>({})
  const [postoVerbas, setPostoVerbas] = useState<Record<string, Record<string, number>>>({})
  const [empresaSel, setEmpresaSel] = useState<string[]>([])
  const [filialSel, setFilialSel] = useState<string[]>([])
  const [ccSel, setCcSel] = useState<string[]>([])
  const [areaSel, setAreaSel] = useState<string[]>([])
  const [divisaoSel, setDivisaoSel] = useState<string[]>([])
  const [buSel, setBuSel] = useState<string[]>([])
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [rateioCods, setRateioCods] = useState<any[]>([])                          // {id,nome,dimensao}
  const [destByRegra, setDestByRegra] = useState<Record<string, any[]>>({})        // regra_id → [{empresa_id,cc_id,pct}]
  const [postoRateios, setPostoRateios] = useState<Record<string, { regra_id: string; ordem: number }[]>>({})
  const [rateModal, setRateModal] = useState<Posto | null>(null)

  useEffect(() => {
    (async () => {
      const [e, f, c, ct, vs, vb, si] = await Promise.all([
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
        supabase.from('conta_orcamentaria').select('id,codigo,descricao'),
        supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
        supabase.from('verba_folha').select('id,codigo,descricao,tipo_calculo,parametro,verba_ref,conta_destino_id,incide_encargos,regime,ordem,categoria').eq('ativo', true).order('ordem', { nullsFirst: false }),
        supabase.from('sindicato').select('id,mes_database'),
      ])
      setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || []); setContas(ct.data || [])
      setVersoes(vs.data || []); setVerbas((vb.data || []) as VerbaRegra[])
      setSindMesBase(Object.fromEntries((si.data || []).map((s: any) => [s.id, s.mes_database || 1])))
      if (vs.data?.length) setVersaoSel(prev => prev || vs.data[0].id)
      const { data: pd } = await supabase.from('posto').select('*, cargo(nome), empresa(codigo), filial(codigo), centro_custo(codigo,descricao)').order('codigo')
      setPostos((pd || []) as Posto[])
      const { data: pv } = await supabase.from('posto_verba').select('posto_id,verba_id,valor').eq('ativo', true)
      const m: Record<string, Record<string, number>> = {}
      for (const r of pv || []) (m[r.posto_id] ||= {})[r.verba_id] = Number(r.valor) || 0
      setPostoVerbas(m)
      // rateio: códigos, destinos e anexos por posto
      const [rr, rd, pr] = await Promise.all([
        supabase.from('rateio_regra').select('id,nome,dimensao').eq('ativo', true),
        supabase.from('rateio_destino').select('regra_id,empresa_id,cc_id,pct'),
        supabase.from('posto_rateio').select('posto_id,regra_id,ordem'),
      ])
      setRateioCods(rr.data || [])
      const dbr: Record<string, any[]> = {}
      for (const d of rd.data || []) (dbr[d.regra_id] ||= []).push({ empresa_id: d.empresa_id, cc_id: d.cc_id, pct: Number(d.pct) || 0 })
      setDestByRegra(dbr)
      const rm: Record<string, { regra_id: string; ordem: number }[]> = {}
      for (const r of pr.data || []) (rm[r.posto_id] ||= []).push({ regra_id: r.regra_id, ordem: Number(r.ordem) || 1 })
      for (const k in rm) rm[k].sort((a, b) => a.ordem - b.ordem)
      setPostoRateios(rm)
    })()
  }, [])
  useEffect(() => {
    if (!versaoSel) { setDissidio({}); return }
    supabase.from('premissa_dissidio').select('sindicato_id,pct').eq('versao_id', versaoSel)
      .then(r => setDissidio(Object.fromEntries((r.data || []).map((x: any) => [x.sindicato_id, Number(x.pct) || 0]))))
  }, [versaoSel])

  const anoCalc = useMemo(() => { const m = (versoes.find(v => v.id === versaoSel)?.codigo || '').match(/(20\d{2})/); return m ? parseInt(m[1], 10) : new Date().getFullYear() }, [versoes, versaoSel])
  const custos = useMemo(() => {
    const map = new Map<string, ResultadoPosto>()
    if (!verbas.length) return map
    for (const p of postos) map.set(p.id, calcularPosto(p as any, verbas, {
      dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
      mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
      ano: anoCalc, valoresFixos: postoVerbas[p.id] || {},
    }))
    return map
  }, [postos, verbas, dissidio, sindMesBase, anoCalc, postoVerbas])

  const filtrados = useMemo(() => {
    const empF = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const filF = escopoFiltro((filialSel.length && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee)
    const ccF = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    const sEmp = empF ? new Set(empF) : null, sFil = filF ? new Set(filF) : null, sCc = ccF ? new Set(ccF) : null
    return postos.filter(p => p.ativo !== false && (!sEmp || sEmp.has(p.empresa_id)) && (!sFil || (p.filial_id != null && sFil.has(p.filial_id))) && (!sCc || (p.cc_id != null && sCc.has(p.cc_id))))
  }, [postos, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, empresas, filiais, ccs, acesso.loading]) // eslint-disable-line

  // agregados do escopo
  const agg = useMemo(() => {
    const cat = { 'Salário': 0, Encargos: 0, 'Provisões': 0, 'Benefícios': 0 } as Record<string, number>
    const porConta: Record<string, number> = {}
    let ano = 0
    for (const p of filtrados) {
      const r = custos.get(p.id); if (!r) continue
      ano += r.totalAno
      for (const k in r.porCategoria) cat[k] += (r.porCategoria as any)[k]
      for (const cid in r.porConta) porConta[cid] = (porConta[cid] || 0) + r.porConta[cid]
    }
    const contaById = new Map(contas.map((c: any) => [c.id, c]))
    const linhasConta = Object.entries(porConta).map(([cid, v]) => ({ conta: contaById.get(cid), valor: v }))
      .sort((a, b) => b.valor - a.valor)
    return { head: filtrados.length, ano, cat, linhasConta }
  }, [filtrados, custos, contas])
  const compTot = agg.cat['Salário'] + agg.cat.Encargos + agg.cat['Provisões'] + agg.cat['Benefícios']
  const pct = (v: number) => compTot ? Math.round(v / compTot * 100) : 0

  const empById = useMemo(() => new Map(empresas.map((e: any) => [e.id, e])), [empresas])
  const ccById = useMemo(() => new Map(ccs.map((c: any) => [c.id, c])), [ccs])

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Memória de cálculo</h1>
          <p style={S.sub}>Custo da folha orçada por posto — cascata verba-a-verba e totais por conta de destino (prévia do que o Aplicar leva ao orçado).</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link to="/postos" style={pill(false)}>1 · Postos</Link>
          <Link to="/postos/regras" style={pill(false)}>2 · Estrutura</Link>
          <span style={pill(true)}>3 · Memória de cálculo</span>
          <Link to="/postos/rateio" style={pill(false)}>4 · Rateio</Link>
        </div>
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Versão</span>
          <select style={S.sel} value={versaoSel} onChange={e => setVersaoSel(e.target.value)}>
            {!versoes.length && <option value="">—</option>}
            {versoes.map((v: any) => <option key={v.id} value={v.id}>{v.codigo}</option>)}
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Filtros</span>
          <FiltrosButton empresas={acesso.filterList('empresa', empresas)} filiais={acesso.filterList('filial', filiais)} ccs={acesso.filterList('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        </div>
        <div style={{ flex: 1 }} />
        <button style={S.btn} onClick={() => window.print()}><Printer size={14} /> Imprimir</button>
      </div>

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Headcount</div><div style={S.kpiV}>{agg.head}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Custo anual (c/ encargos)</div><div style={S.kpiV}>{milAno(agg.ano)}</div><div style={S.kpiH}>{verbas.length ? `salários ${pct(agg.cat['Salário'])}% · encargos ${pct(agg.cat.Encargos + agg.cat['Provisões'])}% · benef ${pct(agg.cat['Benefícios'])}%` : 'sem verbas cadastradas'}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Salários + encargos</div><div style={S.kpiV}>{milAno(agg.cat['Salário'] + agg.cat.Encargos + agg.cat['Provisões'])}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Benefícios</div><div style={S.kpiV}>{milAno(agg.cat['Benefícios'])}</div></div>
      </div>

      <div style={S.grid2}>
        <div style={S.card}>
          <div style={S.cardT}>Totais por conta de destino</div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Conta</th><th style={{ ...S.th, textAlign: 'right' }}>Custo/ano</th></tr></thead>
            <tbody>
              {agg.linhasConta.map((l, i) => (
                <tr key={i}>
                  <td style={S.td}><span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{l.conta?.codigo || '—'}</span> {l.conta?.descricao || 'Sem conta destino'}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{money(l.valor)}</td>
                </tr>
              ))}
              {!agg.linhasConta.length && <tr><td colSpan={2} style={S.empty}>Sem custo no escopo.</td></tr>}
              {agg.linhasConta.length > 0 && <tr><td style={{ ...S.td, fontWeight: 700 }}>Total</td><td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{money(agg.ano)}</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={S.card}>
          <div style={S.cardT}>Memória por posto <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— clique para abrir a cascata</span></div>
          <div style={{ maxHeight: 620, overflow: 'auto' }}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Posto</th><th style={S.th}>Ocupante</th><th style={S.th}>Cargo</th><th style={{ ...S.th, textAlign: 'right' }}>Custo/mês</th><th style={{ ...S.th, textAlign: 'right' }}>Custo/ano</th></tr></thead>
              <tbody>
                {filtrados.map(p => {
                  const r = custos.get(p.id); const open = aberto.has(p.id)
                  return (
                    <Fragment key={p.id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })}>
                        <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--muted)' }}>{open ? <ChevronDown size={12} style={{ verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ verticalAlign: -2 }} />} {p.codigo}</td>
                        <td style={S.td}>{p.nome || 'Vaga'}
                          {(postoRateios[p.id]?.length || 0) > 0 && <button title="Ver rateio deste posto" onClick={ev => { ev.stopPropagation(); setRateModal(p) }}
                            style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 10.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer', color: 'var(--violet)', border: '1px solid var(--violet)55', background: 'rgba(139,92,246,0.14)' }}>
                            <Split size={11} /> {postoRateios[p.id].length}</button>}</td>
                        <td style={S.td}>{p.cargo?.nome || '—'}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{money(r?.totalMes || 0)}</td>
                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{money(r?.totalAno || 0)}</td>
                      </tr>
                      {open && r && r.linhas.map(l => (
                        <tr key={p.id + l.verba.id}>
                          <td style={S.sub2} colSpan={2}><span style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{l.verba.codigo}</span> {l.verba.descricao}</td>
                          <td style={{ ...S.td, color: catCor[l.categoria] || 'var(--muted)', fontSize: 11.5 }}>{l.categoria}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{money(l.valorMes)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{money(l.valorAno)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
                {!filtrados.length && <tr><td colSpan={5} style={S.empty}>Nenhum posto no escopo.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {rateModal && (() => { const r = custos.get(rateModal.id); return (
        <RateioModal posto={rateModal} totMes={r?.totalMes || 0} totAno={r?.totalAno || 0}
          anexos={postoRateios[rateModal.id] || []} rateioCods={rateioCods} destByRegra={destByRegra}
          empById={empById} ccById={ccById} onClose={() => setRateModal(null)} />
      ) })()}
    </div>
  )
}
