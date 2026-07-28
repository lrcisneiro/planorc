import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { PostosPills, passoLabel } from './PostosPills'
import { useUserAccess } from '../../hooks/useUserAccess'
import { FiltrosButton, effectiveCcFilter, escopoFiltro } from '../dashboard/DashFiltros'
import { ConciliacaoFolha } from './ConciliacaoFolha'
import { usePostoCtx } from '../../lib/postoCtx'
import { pageAll } from '../../lib/pageAll'
import type { ConcilParams } from './ConciliacaoFolha'

// Página AVULSA de conciliação de folha (a partir dos Postos): escolhe versão +
// competência + escopo e compara TODAS as contas (Orçado motor × Realizado folha)
// por posto. O drill contextual (uma linha da DRE) usa o modal, não esta página.

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

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
  const [versaoSel, setVersaoSel] = usePostoCtx('versaoId', '')
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [comps, setComps] = useState<string[]>([])
  const [compSel, setCompSel] = usePostoCtx('compSel', '')
  const [empresaSel, setEmpresaSel] = usePostoCtx('empresaSel', [])
  const [filialSel, setFilialSel] = usePostoCtx('filialSel', [])
  const [ccSel, setCcSel] = usePostoCtx('ccSel', [])
  const [areaSel, setAreaSel] = usePostoCtx('areaSel', [])
  const [divisaoSel, setDivisaoSel] = usePostoCtx('divisaoSel', [])
  const [buSel, setBuSel] = usePostoCtx('buSel', [])

  useEffect(() => {
    (async () => {
      const [v, e, f, c, ff] = await Promise.all([
        supabase.from('versao_orcamento').select('id,codigo').order('codigo'),
        supabase.from('empresa').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao,area_cod,area_nome,divisao_cod,divisao_nome,bu_cod,bu_nome').eq('ativo', true).order('codigo'),
        pageAll(() => supabase.from('fat_folha').select('ano,mes').eq('tipo', 'REALIZADO').order('ano', { ascending: false }).order('mes', { ascending: false })),
      ])
      setVersoes(v.data || []); if (v.data?.length) setVersaoSel(prev => v.data.some((x: any) => x.id === prev) ? prev : v.data[0].id)
      setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || [])
      const uniq = [...new Set((ff as any[]).map((r: any) => `${r.ano}-${String(r.mes).padStart(2, '0')}`))]
      setComps(uniq); setCompSel(prev => uniq.includes(prev) ? prev : (uniq[0] || ''))
    })()
  }, [])

  const params = useMemo<ConcilParams | null>(() => {
    if (!versaoSel || !compSel) return null
    const [a, m] = compSel.split('-').map(Number)
    // escopo do usuário como PISO: cruza a seleção com o que o usuário pode VER (canSee).
    // Seleção vazia → cai no escopo permitido (não em "tudo"). Admin → null (sem filtro).
    const empEsc = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const filialFilter = escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee)
    const ccFilter = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    return {
      titulo: 'Todas as contas', versaoId: versaoSel, versaoLabel: versoes.find(v => v.id === versaoSel)?.codigo || '',
      meses: [{ ano: a, mes: m }], masterIds: null, contaIds: null,
      empresaSel: empEsc ?? [], filialFilter, ccFilter,
    }
  }, [versaoSel, compSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, filiais, empresas, ccs, versoes, acesso.loading]) // eslint-disable-line

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Conciliação de folha</h1>
          <p style={S.sub}>Orçado (postos aplicados) × Realizado (folha) por posto, na versão e competência escolhidas — todas as contas. Para conciliar uma linha específica, use o botão <b>Conciliação Folha</b> no razão da DRE.</p>
        </div>
        <PostosPills />
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

      {!comps.length ? <div style={S.empty}>Nenhuma folha importada ainda. Vá em <b>{passoLabel('/postos/folha')}</b> e importe o realizado antes de conciliar.</div>
        : params ? <ConciliacaoFolha params={params} />
        : <div style={S.empty}>Selecione a versão e a competência.</div>}
    </div>
  )
}
