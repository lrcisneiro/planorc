import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useUserAccess } from '../../hooks/useUserAccess'
import { FiltrosButton, effectiveCcFilter } from '../dashboard/DashFiltros'
import { ConciliacaoFolha } from './ConciliacaoFolha'
import type { ConcilParams } from './ConciliacaoFolha'

// Página AVULSA de conciliação de folha (a partir dos Postos): escolhe versão +
// competência + escopo e compara TODAS as contas (Orçado motor × Realizado folha)
// por posto. O drill contextual (uma linha da DRE) usa o modal, não esta página.

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const pill = (a: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5, borderRadius: 99, textDecoration: 'none', cursor: a ? 'default' : 'pointer', fontWeight: 600, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : 'var(--text-mid)' })
const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  top:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 720, lineHeight: 1.5 },
  bar:   { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '20px 0 16px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  empty: { padding: '30px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 },
}

export default function ConciliacaoFolhaPage() {
  const acesso = useUserAccess()
  const [versoes, setVersoes] = useState<any[]>([])
  const [versaoSel, setVersaoSel] = useState('')
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [comps, setComps] = useState<string[]>([])
  const [compSel, setCompSel] = useState('')
  const [empresaSel, setEmpresaSel] = useState<string[]>([])
  const [filialSel, setFilialSel] = useState<string[]>([])
  const [ccSel, setCcSel] = useState<string[]>([])
  const [areaSel, setAreaSel] = useState<string[]>([])
  const [divisaoSel, setDivisaoSel] = useState<string[]>([])
  const [buSel, setBuSel] = useState<string[]>([])

  useEffect(() => {
    (async () => {
      const [v, e, f, c, ff] = await Promise.all([
        supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
        supabase.from('fat_folha').select('ano,mes').order('ano', { ascending: false }).order('mes', { ascending: false }),
      ])
      setVersoes(v.data || []); if (v.data?.length) setVersaoSel(prev => prev || v.data[0].id)
      setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || [])
      const uniq = [...new Set((ff.data || []).map((r: any) => `${r.ano}-${String(r.mes).padStart(2, '0')}`))]
      setComps(uniq); setCompSel(prev => prev || uniq[0] || '')
    })()
  }, [])

  const params = useMemo<ConcilParams | null>(() => {
    if (!versaoSel || !compSel) return null
    const [a, m] = compSel.split('-').map(Number)
    const filialFilter = (filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null
    const ccFilter = effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel)
    return {
      titulo: 'Todas as contas', versaoId: versaoSel, versaoLabel: versoes.find(v => v.id === versaoSel)?.codigo || '',
      meses: [{ ano: a, mes: m }], masterIds: null, contaIds: null,
      empresaSel, filialFilter, ccFilter,
    }
  }, [versaoSel, compSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, filiais.length, ccs, versoes]) // eslint-disable-line

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Conciliação de folha</h1>
          <p style={S.sub}>Orçado (postos aplicados) × Realizado (folha) por posto, na versão e competência escolhidas — todas as contas. Para conciliar uma linha específica, use o botão <b>Conciliação Folha</b> no razão da DRE.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link to="/postos" style={pill(false)}>1 · Postos</Link>
          <Link to="/postos/regras" style={pill(false)}>2 · Estrutura</Link>
          <Link to="/postos/memoria" style={pill(false)}>3 · Memória</Link>
          <Link to="/postos/rateio" style={pill(false)}>4 · Rateio</Link>
          <Link to="/postos/folha" style={pill(false)}>5 · Folha</Link>
          <span style={pill(true)}>6 · Conciliação</span>
        </div>
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Versão (orçado)</span>
          <select style={S.sel} value={versaoSel} onChange={e => setVersaoSel(e.target.value)}>
            {!versoes.length && <option value="">—</option>}
            {versoes.map((v: any) => <option key={v.id} value={v.id}>{v.codigo}</option>)}
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Competência (realizado)</span>
          <select style={S.sel} value={compSel} onChange={e => setCompSel(e.target.value)}>
            {!comps.length && <option value="">—</option>}
            {comps.map(c => { const [a, m] = c.split('-'); return <option key={c} value={c}>{MESES[+m - 1]}/{a}</option> })}
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Filtros</span>
          <FiltrosButton empresas={acesso.filterList('empresa', empresas)} filiais={acesso.filterList('filial', filiais)} ccs={acesso.filterList('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        </div>
      </div>

      {!comps.length ? <div style={S.empty}>Nenhuma folha importada ainda. Vá em <b>5 · Folha</b> e importe o realizado antes de conciliar.</div>
        : params ? <ConciliacaoFolha params={params} />
        : <div style={S.empty}>Selecione a versão e a competência.</div>}
    </div>
  )
}
