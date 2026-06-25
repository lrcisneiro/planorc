// ============================================================
// DRE Orçado × Realizado — visão v2 (tema dark)
// Read-only. Reusa o motor de cálculo de produção (lib/engine):
//   computeCenario + computeTotais → mesmos números do RelatorioEditorPage.
// Dados reais via RPCs relatorio_orcado_agg / relatorio_realizado_agg.
// ============================================================
import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { computeCenario, computeTotais, formatValor } from '../../lib/engine'
import type { LinhaCalc, RawValues, Periodo, Formato } from '../../lib/engine'

type Relatorio = { id: string; codigo: string; nome: string }
type Empresa   = { id: string; codigo: string; descricao: string }
type Versao    = { id: string; codigo: string }
type Linha = LinhaCalc & {
  descricao: string
  natureza: string | null
  nivel: number
  ordem: number | null
  formato: Formato
  casas_decimais: number
  linha_orc_id: string | null
  visivel_relatorio: boolean
}

const C = {
  bg: '#0a0a0f', panel: '#14141d', panel2: '#181823',
  border: 'rgba(255,255,255,0.07)', borderS: 'rgba(255,255,255,0.12)',
  text: '#e8e8f0', mid: '#b4b4c4', muted: '#74748a', faint: '#4a4a5a',
  violet: '#8b5cf6', green: '#34d399', red: '#f87171', orange: '#fbbf24', blue: '#3b82f6',
}

const NOW = new Date()

function favClass(nat: string | null, orc: number, real: number): 'fav' | 'unfav' | 'flat' {
  const d = real - orc
  if (Math.abs(d) < Math.max(Math.abs(orc) * 0.002, 0.005)) return 'flat'
  if (nat === 'RECEITA') return d > 0 ? 'fav' : 'unfav'
  if (nat === 'DESPESA') return d < 0 ? 'fav' : 'unfav'
  return d >= 0 ? 'fav' : 'unfav'
}
const favColor = (f: string) => (f === 'fav' ? C.green : f === 'unfav' ? C.red : C.muted)

export default function DrePage() {
  const [relatorios, setRelatorios] = useState<Relatorio[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])

  const [relatorioId, setRelatorioId] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [versaoId, setVersaoId] = useState('')
  const [ano, setAno] = useState(NOW.getFullYear())
  const [mesFim, setMesFim] = useState(NOW.getMonth() + 1)

  const [linhas, setLinhas] = useState<Linha[]>([])
  const [totOrc, setTotOrc] = useState<Record<string, number>>({})
  const [totReal, setTotReal] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const periodos: Periodo[] = useMemo(
    () => Array.from({ length: Math.max(1, mesFim) }, (_, i) => ({ ano, mes: i + 1 })),
    [ano, mesFim],
  )

  // ── cadastros (uma vez)
  useEffect(() => {
    (async () => {
      const [r, e, v] = await Promise.all([
        supabase.from('relatorio').select('id,codigo,nome').order('codigo'),
        supabase.from('empresa').select('id,codigo,descricao').order('codigo'),
        supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
      ])
      const rs = (r.data as Relatorio[]) || []; setRelatorios(rs); if (rs[0]) setRelatorioId(rs[0].id)
      const es = (e.data as Empresa[]) || []; setEmpresas(es); if (es[0]) setEmpresaId(es[0].id)
      const vs = (v.data as Versao[]) || []; setVersoes(vs); if (vs[0]) setVersaoId(vs[0].id)
    })()
  }, [])

  // ── linhas do relatório selecionado
  useEffect(() => {
    if (!relatorioId) { setLinhas([]); return }
    (async () => {
      const { data } = await supabase
        .from('relatorio_linha')
        .select('id,pai_id,codigo,descricao,ordem,nivel,tipo_linha,expressao,natureza,formato,casas_decimais,linha_orc_id,nao_soma,desativada,visivel_relatorio')
        .eq('relatorio_id', relatorioId)
        .order('ordem', { nullsFirst: false })
      setLinhas((data as Linha[]) || [])
    })()
  }, [relatorioId])

  // ── valores: RPCs + engine
  const loadValores = useCallback(async () => {
    if (!linhas.length || !empresaId || !versaoId) { setTotOrc({}); setTotReal({}); return }
    setLoading(true); setErro(null)
    try {
      const masterIds = linhas.map(l => l.linha_orc_id).filter(Boolean) as string[]
      const rlOfOrc: Record<string, string> = {}
      for (const l of linhas) if (l.linha_orc_id && !l.nao_soma) rlOfOrc[l.linha_orc_id] = l.id
      const meses = periodos.map(p => p.mes)

      const [orcRes, realRes] = await Promise.all([
        supabase.rpc('relatorio_orcado_agg', {
          p_versao: versaoId, p_empresas: [empresaId], p_anos: [ano],
          p_meses: meses, p_linhas: masterIds, p_filiais: null, p_ccs: null,
        }),
        supabase.rpc('relatorio_realizado_agg', {
          p_empresas: [empresaId], p_anos: [ano],
          p_meses: meses, p_linhas: masterIds, p_filiais: null, p_ccs: null,
        }),
      ])
      if (orcRes.error) throw new Error(orcRes.error.message)
      if (realRes.error) throw new Error(realRes.error.message)

      const rawOrc: RawValues = {}
      for (const r of (orcRes.data as any[]) || []) {
        const rl = rlOfOrc[r.linha_id]; if (!rl) continue
        ;(rawOrc[rl] ||= {})[`${r.ano}-${r.mes}`] =
          (Number(r.n) === 1 && r.expr) ? { expressao: r.expr } : { valor: Number(r.valor) || 0 }
      }
      const rawReal: RawValues = {}
      for (const r of (realRes.data as any[]) || []) {
        const rl = rlOfOrc[r.linha_id]; if (!rl) continue
        ;(rawReal[rl] ||= {})[`${r.ano}-${r.mes}`] = { valor: Number(r.valor) || 0 }
      }

      const lc: LinhaCalc[] = linhas.map(l => ({
        id: l.id, pai_id: l.pai_id, codigo: l.codigo,
        tipo_linha: l.tipo_linha, expressao: l.expressao,
        desativada: l.desativada, nao_soma: l.nao_soma,
      }))
      setTotOrc(computeTotais(lc, computeCenario(lc, rawOrc, periodos), periodos))
      setTotReal(computeTotais(lc, computeCenario(lc, rawReal, periodos), periodos))
    } catch (e: any) {
      setErro(e?.message ?? String(e)); setTotOrc({}); setTotReal({})
    } finally {
      setLoading(false)
    }
  }, [linhas, empresaId, versaoId, ano, periodos])

  useEffect(() => { loadValores() }, [loadValores])

  const sel: React.CSSProperties = {
    background: C.panel, border: `1px solid ${C.borderS}`, borderRadius: 10,
    padding: '7px 11px', fontSize: 13, color: C.text, outline: 'none',
  }
  const th: React.CSSProperties = {
    position: 'sticky', top: 0, background: '#11111a', color: C.muted, fontSize: 11,
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px',
    padding: '11px 14px', textAlign: 'right', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif',
      fontFeatureSettings: '"tnum" 1' }}>
      <style>{`
        .drev2-row:hover td { background: rgba(255,255,255,0.03) !important; }
        .drev2 select option { background:#14141d; color:#e8e8f0; }
      `}</style>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 24px',
        borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 800, letterSpacing: 3, color: C.mid, fontSize: 14 }}>PLANORC</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>DRE Gerencial · Orçado × Realizado</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px',
          borderRadius: 999, background: 'rgba(139,92,246,0.18)', color: '#cbb8ff' }}>v2 · dados reais</span>
      </div>

      {/* filtros */}
      <div className="drev2" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
        padding: '12px 24px', borderBottom: `1px solid ${C.border}`,
        background: 'linear-gradient(90deg,rgba(139,92,246,0.08),transparent 55%)' }}>
        <select style={sel} value={relatorioId} onChange={e => setRelatorioId(e.target.value)}>
          {relatorios.map(r => <option key={r.id} value={r.id}>{r.codigo} · {r.nome}</option>)}
        </select>
        <select style={sel} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
          {empresas.map(em => <option key={em.id} value={em.id}>{em.codigo} · {em.descricao}</option>)}
        </select>
        <select style={sel} value={versaoId} onChange={e => setVersaoId(e.target.value)}>
          {versoes.map(v => <option key={v.id} value={v.id}>{v.codigo}</option>)}
        </select>
        <input style={{ ...sel, width: 90 }} type="number" value={ano}
          onChange={e => setAno(Number(e.target.value) || ano)} />
        <label style={{ fontSize: 12, color: C.muted }}>até mês</label>
        <select style={sel} value={mesFim} onChange={e => setMesFim(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
            <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>
          {loading ? 'carregando…' : `${linhas.length} linhas`}
        </span>
      </div>

      {erro && <div style={{ margin: 16, padding: 12, borderRadius: 10,
        background: 'rgba(248,113,113,0.1)', border: `1px solid ${C.red}`, color: C.red, fontSize: 13 }}>
        Erro ao carregar: {erro}</div>}

      {/* tabela */}
      <div style={{ margin: '16px 24px 60px', border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', minWidth: 300 }}>Item · DRE</th>
              <th style={th}>Orçado</th>
              <th style={th}>Realizado</th>
              <th style={th}>Δ</th>
              <th style={th}>Δ %</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              if (l.tipo_linha === 'ESPACO') return <tr key={l.id}><td colSpan={5} style={{ height: 10 }} /></tr>
              if (l.visivel_relatorio === false) return null
              const o = totOrc[l.id] ?? 0
              const r = totReal[l.id] ?? 0
              const d = r - o
              const isPct = l.formato === 'PERCENTUAL'
              const f = favClass(l.natureza, o, r)
              const col = favColor(f)
              const isAgg = l.tipo_linha === 'SOMAR_FILHOS'
              const isCalc = l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR'
              const indent = 12 + (Math.max(1, l.nivel) - 1) * 18
              const deltaPct = isPct ? d : (o !== 0 ? (d / Math.abs(o)) * 100 : 0)
              return (
                <tr key={l.id} className="drev2-row">
                  <td style={{
                    padding: `9px 14px 9px ${indent}px`, fontSize: 13, whiteSpace: 'nowrap',
                    borderBottom: `1px solid rgba(255,255,255,0.04)`,
                    fontWeight: isAgg ? 750 : isCalc ? 600 : 500,
                    color: isAgg ? C.text : isCalc ? '#cbb8ff' : C.mid,
                    background: isAgg ? 'rgba(139,92,246,0.06)' : 'transparent',
                  }}>
                    <span style={{ color: C.faint, fontSize: 10, marginRight: 8 }}>{l.codigo}</span>
                    {l.descricao}
                  </td>
                  <td style={cellNum(C.mid, isAgg)}>{formatValor(o, l.formato, l.casas_decimais)}</td>
                  <td style={cellNum(C.text, isAgg)}>{formatValor(r, l.formato, l.casas_decimais)}</td>
                  <td style={cellNum(col, isAgg)}>{(d >= 0 ? '+' : '−') + formatValor(Math.abs(d), l.formato, l.casas_decimais)}</td>
                  <td style={cellNum(col, isAgg)}>
                    {f === 'flat' ? '—' :
                      (f === 'fav' ? '▲ ' : '▼ ') + Math.abs(deltaPct).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + (isPct ? ' pp' : '%')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function cellNum(color: string, bold: boolean): React.CSSProperties {
  return {
    padding: '9px 14px', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums', color, fontWeight: bold ? 700 : 500,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  }
}
