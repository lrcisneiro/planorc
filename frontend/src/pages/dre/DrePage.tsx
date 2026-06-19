import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'
import { ChevronRight, ChevronDown, TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const fmt = (v: number) =>
  v === 0 ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtPct = (v: number) => {
  if (!isFinite(v)) return '—'
  const s = v.toFixed(1) + '%'
  return v > 0 ? '+' + s : s
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Item {
  id: string
  codigo: string
  descricao: string
  nivel: number
  pai_id: string | null
  aceita_lancamento: boolean
  natureza: string
  n1_codigo: string
}

interface Empresa { id: string; codigo: string; descricao: string }

type ValMap = Record<string, Record<number, number>> // item_id → mes → valor

// ─── Estilos ──────────────────────────────────────────────────────────────────

const S = {
  page:    { padding: 24, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f8f9fa' } as React.CSSProperties,
  header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 } as React.CSSProperties,
  title:   { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as React.CSSProperties,
  sub:     { fontSize: 13, color: '#868e96', margin: '4px 0 0' } as React.CSSProperties,
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const } as React.CSSProperties,
  select:  { padding: '6px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, color: '#343a40', background: 'white' } as React.CSSProperties,
  card:    { background: 'white', borderRadius: 12, border: '1px solid #e9ecef', marginBottom: 16, overflow: 'hidden' } as React.CSSProperties,
  cardHdr: { padding: '12px 16px', borderBottom: '1px solid #f1f3f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
  cardTtl: { fontSize: 14, fontWeight: 600, color: '#343a40', margin: 0 } as React.CSSProperties,
  wrap:    { overflowX: 'auto' as const },
  table:   { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12, minWidth: 900 } as React.CSSProperties,
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, orc, real }: { label: string; orc: number; real: number }) {
  const delta = orc !== 0 ? ((real - orc) / Math.abs(orc)) * 100 : 0
  const Icon = delta > 0.5 ? TrendingUp : delta < -0.5 ? TrendingDown : Minus
  const cor = delta > 0.5 ? '#2f9e44' : delta < -0.5 ? '#e03131' : '#868e96'

  return (
    <div style={{
      background: 'white', borderRadius: 12, border: '1px solid #e9ecef',
      padding: '16px 20px', flex: 1, minWidth: 180,
    }}>
      <p style={{ fontSize: 11, color: '#868e96', margin: '0 0 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#212529', margin: '0 0 4px' }}>
        {real === 0 && orc === 0 ? '—' : fmt(real)}
      </p>
      <p style={{ fontSize: 11, color: '#868e96', margin: '0 0 6px' }}>Orç: {fmt(orc)}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: cor, fontSize: 12, fontWeight: 600 }}>
        <Icon size={13} />
        <span>{fmtPct(delta)} vs orçado</span>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DrePage() {
  const [itens,     setItens]     = useState<Item[]>([])
  const [empresas,  setEmpresas]  = useState<Empresa[]>([])
  const [orcado,    setOrcado]    = useState<ValMap>({})
  const [realizado, setRealizado] = useState<ValMap>({})
  const [empresaId, setEmpresaId] = useState<string>('')
  const [ano,       setAno]       = useState(2026)
  const [expandidos,setExpandidos]= useState<Set<string>>(new Set())
  const [chartN1,   setChartN1]   = useState<string>('')   // id do N1 selecionado no gráfico
  const [loading,   setLoading]   = useState(true)
  const [erro,      setErro]      = useState<string | null>(null)

  // ── Carga inicial: empresas + plano ──────────────────────────────────────
  useEffect(() => {
    async function init() {
      const [{ data: emp, error: e1 }, { data: plan, error: e2 }] = await Promise.all([
        supabase.from('empresa').select('id, codigo, descricao').order('codigo'),
        supabase.from('plano_orcamentario')
          .select('id, codigo, descricao, nivel, pai_id, aceita_lancamento, natureza, n1_codigo')
          .order('codigo'),
      ])
      if (e1 || e2) { setErro((e1 || e2)!.message); setLoading(false); return }
      setEmpresas(emp || [])
      setItens(plan || [])
      if (emp && emp.length > 0) setEmpresaId(emp[0].id)
      const n1ids = new Set((plan || []).filter(x => x.nivel === 1).map(x => x.id))
      setExpandidos(n1ids)
      if (plan && plan.length > 0) {
        const primeiro = plan.find(x => x.nivel === 1)
        if (primeiro) setChartN1(primeiro.id)
      }
    }
    init()
  }, [])

  // ── Carga de lançamentos quando empresa/ano mudam ────────────────────────
  useEffect(() => {
    if (!empresaId) return
    async function carregarLancamentos() {
      setLoading(true)
      const { data, error } = await supabase
        .from('fat_lancamento')
        .select('item_orc_id, mes, valor, tipo_lancamento')
        .eq('empresa_id', empresaId)
        .eq('ano', ano)

      if (error) { setErro(error.message); setLoading(false); return }

      const orc: ValMap = {}
      const real: ValMap = {}
      for (const l of data || []) {
        const mapa = l.tipo_lancamento === 'ORCADO' ? orc : real
        if (!mapa[l.item_orc_id]) mapa[l.item_orc_id] = {}
        mapa[l.item_orc_id][l.mes] = (mapa[l.item_orc_id][l.mes] || 0) + l.valor
      }
      setOrcado(orc)
      setRealizado(real)
      setLoading(false)
    }
    carregarLancamentos()
  }, [empresaId, ano])

  // ── Helpers de agregação ─────────────────────────────────────────────────
  const somaItem = (mapa: ValMap, id: string, mes?: number): number => {
    const direto = mes ? (mapa[id]?.[mes] || 0) : MESES.reduce((s,_,i) => s + (mapa[id]?.[i+1] || 0), 0)
    const filhos = itens.filter(x => x.pai_id === id)
    return direto + filhos.reduce((s, f) => s + somaItem(mapa, f.id, mes), 0)
  }

  // ── Dados do gráfico ─────────────────────────────────────────────────────
  const dadosGrafico = useMemo(() => {
    if (!chartN1) return []
    return MESES.map((mes, i) => ({
      mes,
      Orçado:    Math.round(somaItem(orcado,    chartN1, i+1) / 1000),
      Realizado: Math.round(somaItem(realizado, chartN1, i+1) / 1000),
    }))
  }, [chartN1, orcado, realizado, itens]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPIs (N1 totalizados) ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    return itens.filter(x => x.nivel === 1).map(n1 => ({
      id: n1.id,
      label: n1.descricao,
      orc:  somaItem(orcado,    n1.id),
      real: somaItem(realizado, n1.id),
    }))
  }, [itens, orcado, realizado]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle expand ────────────────────────────────────────────────────────
  const toggle = (id: string) => setExpandidos(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  // ── Renderização das linhas da tabela ────────────────────────────────────
  const renderLinhas = () => {
    const linhas: React.ReactNode[] = []

    const renderItem = (item: Item, profundidade: number, visivel: boolean) => {
      if (!visivel) return

      const filhos = itens.filter(x => x.pai_id === item.id)
      const temFilhos = filhos.length > 0
      const expandido = expandidos.has(item.id)

      const orc  = MESES.map((_,i) => somaItem(orcado,    item.id, i+1))
      const real = MESES.map((_,i) => somaItem(realizado, item.id, i+1))
      const totalOrc  = orc.reduce((a,b) => a+b, 0)
      const totalReal = real.reduce((a,b) => a+b, 0)

      const isN1 = item.nivel === 1
      const isN2 = item.nivel === 2

      const bgRow = isN1 ? '#1e2d5a' : isN2 ? '#f1f3f5' : 'white'
      const corTxt= isN1 ? 'white'   : '#212529'
      const peso  = isN1 ? 600 : isN2 ? 600 : 400

      linhas.push(
        <tr key={item.id} style={{ background: bgRow, borderBottom: '1px solid #e9ecef' }}>
          {/* Coluna descrição */}
          <td style={{
            padding: '7px 12px', whiteSpace: 'nowrap', color: corTxt, fontWeight: peso,
            position: 'sticky', left: 0, background: bgRow, zIndex: 1,
            borderRight: '2px solid #dee2e6',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: profundidade * 16 }}>
              {temFilhos ? (
                <span onClick={() => toggle(item.id)} style={{ cursor: 'pointer', opacity: 0.7, display: 'flex' }}>
                  {expandido ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              ) : <span style={{ width: 13 }} />}
              <span style={{ fontSize: isN1 ? 13 : isN2 ? 12 : 11 }}>
                {isN1 || isN2 ? item.descricao : item.descricao}
              </span>
            </div>
          </td>

          {/* Colunas por mês: Orç | Real | Δ% */}
          {MESES.map((_, i) => {
            const o = orc[i], r = real[i]
            const delta = o !== 0 ? ((r - o) / Math.abs(o)) * 100 : null
            const corDelta = delta === null ? '#868e96'
              : delta < -5 ? '#e03131'
              : delta >  5 ? '#2f9e44'
              : '#868e96'
            return (
              <td key={i} colSpan={1} style={{
                padding: '7px 6px', textAlign: 'right', fontSize: 11,
                color: corTxt, borderRight: '1px solid #e9ecef',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end', minWidth: 80 }}>
                  <span style={{ opacity: 0.75, fontSize: 10 }}>{fmt(o)}</span>
                  <span style={{ fontWeight: 500 }}>{fmt(r)}</span>
                  <span style={{ fontSize: 10, color: isN1 ? '#a5b4fc' : corDelta }}>
                    {delta === null ? '—' : fmtPct(delta)}
                  </span>
                </div>
              </td>
            )
          })}

          {/* Total */}
          <td style={{
            padding: '7px 10px', textAlign: 'right', fontWeight: 600,
            color: corTxt, background: isN1 ? '#152247' : '#f8f9fa',
            borderLeft: '2px solid #dee2e6', minWidth: 90,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
              <span style={{ opacity: 0.7, fontSize: 10, fontWeight: 400 }}>{fmt(totalOrc)}</span>
              <span>{fmt(totalReal)}</span>
              <span style={{
                fontSize: 10, fontWeight: 400,
                color: isN1 ? '#a5b4fc'
                  : totalOrc !== 0 ? (((totalReal-totalOrc)/Math.abs(totalOrc)*100) < -5 ? '#e03131' : '#2f9e44')
                  : '#868e96'
              }}>
                {totalOrc !== 0 ? fmtPct(((totalReal-totalOrc)/Math.abs(totalOrc))*100) : '—'}
              </span>
            </div>
          </td>
        </tr>
      )

      if (temFilhos && expandido) {
        filhos.forEach(f => renderItem(f, profundidade + 1, true))
      }
    }

    itens.filter(x => x.nivel === 1).forEach(n1 => renderItem(n1, 0, true))
    return linhas
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (erro) return (
    <div style={S.page}>
      <div style={{ background: '#fff5f5', border: '1px solid #ffc9c9', borderRadius: 8, padding: 16, color: '#c92a2a' }}>
        <strong>Erro:</strong> {erro}
      </div>
    </div>
  )

  const n1Options = itens.filter(x => x.nivel === 1)

  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>DRE — Orçado × Realizado</h1>
          <p style={S.sub}>Comparativo mensal por item do plano orçamentário</p>
        </div>
        <div style={S.toolbar}>
          <select
            style={S.select}
            value={empresaId}
            onChange={e => setEmpresaId(e.target.value)}
          >
            {empresas.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.codigo} — {emp.descricao}</option>
            ))}
          </select>
          <select
            style={S.select}
            value={ano}
            onChange={e => setAno(Number(e.target.value))}
          >
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#868e96' }}>Carregando...</div>
      )}

      {!loading && (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {kpis.map(k => <KpiCard key={k.id} label={k.label} orc={k.orc} real={k.real} />)}
          </div>

          {/* Gráfico */}
          <div style={S.card}>
            <div style={S.cardHdr}>
              <p style={S.cardTtl}>Evolução Mensal — Orçado × Realizado</p>
              <select
                style={{ ...S.select, fontSize: 12 }}
                value={chartN1}
                onChange={e => setChartN1(e.target.value)}
              >
                {n1Options.map(n => <option key={n.id} value={n.id}>{n.descricao}</option>)}
              </select>
            </div>
            <div style={{ padding: '16px 8px 8px' }}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dadosGrafico} barCategoryGap="30%" barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f5" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#868e96' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#868e96' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `${v}k` : String(v)}
                    width={48}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v.toLocaleString('pt-BR')}k`, '']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e9ecef' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Orçado"    fill="#a5b4fc" radius={[4,4,0,0]} />
                  <Bar dataKey="Realizado" fill="#3b5bdb" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <p style={{ fontSize: 10, color: '#adb5bd', textAlign: 'center', margin: '4px 0 0' }}>
                Valores em milhares (R$ k)
              </p>
            </div>
          </div>

          {/* Tabela DRE */}
          <div style={S.card}>
            <div style={S.cardHdr}>
              <p style={S.cardTtl}>DRE Detalhada</p>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#868e96' }}>
                <span>Linha superior: Orçado</span>
                <span style={{ fontWeight: 600, color: '#343a40' }}>Linha do meio: Realizado</span>
                <span>Linha inferior: Δ%</span>
              </div>
            </div>
            <div style={S.wrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={{
                      textAlign: 'left', padding: '8px 12px', background: '#1e2d5a',
                      color: 'white', fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap',
                      position: 'sticky', left: 0, zIndex: 2, borderRight: '2px solid #dee2e6',
                      minWidth: 260,
                    }}>
                      Item Orçamentário
                    </th>
                    {MESES.map(m => (
                      <th key={m} style={{
                        textAlign: 'center', padding: '8px 6px', background: '#1e2d5a',
                        color: '#a5b4fc', fontWeight: 500, fontSize: 11, minWidth: 88,
                        borderRight: '1px solid #2a3f7a',
                      }}>
                        {m}
                      </th>
                    ))}
                    <th style={{
                      textAlign: 'center', padding: '8px 10px', background: '#152247',
                      color: '#c7d2fe', fontWeight: 600, fontSize: 11, minWidth: 90,
                      borderLeft: '2px solid #dee2e6',
                    }}>
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {renderLinhas()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
