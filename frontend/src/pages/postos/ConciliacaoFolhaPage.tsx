import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { PostosPills, passoLabel } from './PostosPills'
import { useUserAccess } from '../../hooks/useUserAccess'
import { FiltrosButton, effectiveCcFilter, escopoFiltro, useMoedaView, MoedaSelect } from '../dashboard/DashFiltros'
import { ConciliacaoFolha } from './ConciliacaoFolha'
import { ConciliacaoContabil } from './ConciliacaoContabil'
import { usePostoCtx } from '../../lib/postoCtx'
import { useLocalPref } from '../../lib/uiPrefs'
import { pageAll } from '../../lib/pageAll'
import { refDoRelatorio, contasDosMasters, mastersDaSelecao, linhasConciliaveis, COLS_LINHA } from '../../lib/refRelatorio'
import type { LinhaRel, RefRelatorio } from '../../lib/refRelatorio'
import type { ConcilParams } from './ConciliacaoFolha'
import type { ContabilParams } from './ConciliacaoContabil'

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

// Duas perguntas diferentes sobre a mesma folha, no mesmo lugar:
//   orcado   — o que planejamos × o que a folha pagou (por posto)
//   contabil — o que a contabilidade lançou × o que a folha pagou (por funcionário)
// A segunda é a que destrava a área: ela orça na conta contábil e recebe o
// realizado agregado, sem conseguir ver quem compõe o número.
type Aba = 'orcado' | 'contabil'

const tab = (a: boolean): CSSProperties => ({ padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: a ? 'default' : 'pointer', borderRadius: 8, border: '1px solid ' + (a ? 'var(--violet)' : 'var(--border)'), background: a ? 'rgba(139,92,246,0.16)' : 'var(--panel)', color: a ? 'var(--violet)' : 'var(--text-mid)' })

// Seletor de linhas: só as que têm master na subárvore — linha de fórmula tem
// total, mas não tem folha a conciliar contra.
function LinhasPicker({ linhas, sel, setSel }: { linhas: LinhaRel[]; sel: string[]; setSel: (f: (p: string[]) => string[]) => void }) {
  const [aberto, setAberto] = useState(false)
  const nivel = useMemo(() => {
    const byId: Record<string, LinhaRel> = {}; linhas.forEach(l => { byId[l.id] = l })
    const prof = (l: LinhaRel): number => { let n = 0, p = l.pai_id; while (p && byId[p] && n < 12) { n++; p = byId[p].pai_id } return n }
    return Object.fromEntries(linhas.map(l => [l.id, prof(l)]))
  }, [linhas])
  const marca = (id: string) => setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  return (
    <div style={{ position: 'relative' }}>
      <button style={{ ...S.sel, cursor: 'pointer', minWidth: 170, textAlign: 'left', color: sel.length ? 'var(--violet)' : 'var(--text-mid)', fontWeight: sel.length ? 600 : 400 }}
        onClick={() => setAberto(v => !v)} disabled={!linhas.length}>
        {sel.length ? `${sel.length} linha(s)` : 'todas as contas'} ▾
      </button>
      {aberto && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setAberto(false)} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 61, width: 340, maxHeight: 360, overflow: 'auto',
            background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: '0 14px 40px rgba(0,0,0,0.35)', padding: 6 }}>
            <div style={{ display: 'flex', gap: 6, padding: '4px 6px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
              <button style={{ ...S.sel, padding: '3px 8px', fontSize: 11.5, cursor: 'pointer' }} onClick={() => setSel(() => [])}>Limpar</button>
              <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>sem escolha = todas as contas</span>
            </div>
            {linhas.map(l => (
              <label key={l.id} style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '4px 6px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}>
                <input type="checkbox" checked={sel.includes(l.id)} onChange={() => marca(l.id)} />
                <span style={{ paddingLeft: (nivel[l.id] || 0) * 12, color: sel.includes(l.id) ? 'var(--text)' : 'var(--text-mid)' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: 11 }}>{l.codigo}</span> {l.descricao}
                </span>
              </label>
            ))}
            {!linhas.length && <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>Nenhuma linha com conta amarrada neste relatório.</div>}
          </div>
        </>
      )}
    </div>
  )
}

export default function ConciliacaoFolhaPage() {
  const acesso = useUserAccess()
  const [abaSel, setAbaSel] = useLocalPref<Aba>('planorc_concil_aba', 'orcado')
  const { moedas, slot: moedaSlot, setSlot: setMoedaSlot } = useMoedaView()
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
  // ── relatório + linhas: o recorte e a referência das DUAS abas ──
  // Lembrados entre sessões: quem confere volta sempre às mesmas linhas.
  const [rels, setRels] = useState<any[]>([])
  const [relSel, setRelSel] = useLocalPref('planorc_concil_rel', '')
  const [linhasRel, setLinhasRel] = useState<LinhaRel[]>([])
  const [linhasSel, setLinhasSel] = useLocalPref<string[]>('planorc_concil_linhas', [])
  const [contas, setContas] = useState<{ contaIds: string[]; contaToItem: Record<string, string> } | null>(null)
  const [ref, setRef] = useState<RefRelatorio | null>(null)

  useEffect(() => {
    supabase.from('relatorio').select('id,codigo,nome').order('codigo').then(r => {
      const l = r.data || []; setRels(l)
      setRelSel(prev => l.some((x: any) => x.id === prev) ? prev : (l[0]?.id || ''))
    })
  }, []) // eslint-disable-line

  // trocou de relatório: recarrega as linhas e descarta seleção que não existe mais
  useEffect(() => {
    if (!relSel) { setLinhasRel([]); return }
    supabase.from('relatorio_linha').select(COLS_LINHA).eq('relatorio_id', relSel)
      .order('ordem', { nullsFirst: false }).then(r => {
        const l = (r.data || []) as any as LinhaRel[]
        setLinhasRel(l)
        const ids = new Set(l.map(x => x.id))
        setLinhasSel(prev => prev.filter(x => ids.has(x)))
      })
  }, [relSel]) // eslint-disable-line

  const sel = useMemo(() => mastersDaSelecao(linhasRel, linhasSel), [linhasRel, linhasSel])
  const ofertadas = useMemo(() => linhasConciliaveis(linhasRel), [linhasRel])

  // as contas das linhas escolhidas recortam o universo das duas abas
  useEffect(() => {
    let vivo = true
    if (!sel.masters.length) { setContas(null); return }
    contasDosMasters(sel.masters).then(r => { if (vivo) setContas(r) })
    return () => { vivo = false }
  }, [JSON.stringify(sel.masters)]) // eslint-disable-line

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

  // ── a referência: orçado e realizado da linha, pela função do relatório ──
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!compSel || !linhasSel.length || !linhasRel.length || !empresas.length || acesso.loading) { setRef(null); return }
      const [a, m] = compSel.split('-').map(Number)
      const empEsc = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
      const r = await refDoRelatorio({
        relatorioNome: rels.find((x: any) => x.id === relSel)?.nome || '',
        linhas: linhasRel, sel: linhasSel, ccs: ccs as any,
        versaoId: versaoSel, empresas: empEsc ?? empresas.map((x: any) => x.id),
        anos: [a], meses: [m],
        filialFilter: escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee),
        ccFilter: escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee),
        ccPermitidos: acesso.filterList('centro_custo', ccs as any).map((x: any) => x.id),
        slot: moedaSlot,
      }).catch(() => null)
      if (vivo) setRef(r)
    })()
    return () => { vivo = false }
  }, [relSel, JSON.stringify(linhasSel), linhasRel, compSel, versaoSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, empresas, filiais, ccs, acesso.loading, moedaSlot]) // eslint-disable-line

  const params = useMemo<ConcilParams | null>(() => {
    if (!versaoSel || !compSel) return null
    const [a, m] = compSel.split('-').map(Number)
    // escopo do usuário como PISO: cruza a seleção com o que o usuário pode VER (canSee).
    // Seleção vazia → cai no escopo permitido (não em "tudo"). Admin → null (sem filtro).
    const empEsc = escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee)
    const filialFilter = escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee)
    const ccFilter = escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee)
    return {
      titulo: linhasSel.length ? `${linhasSel.length} linha(s) do relatório` : 'Todas as contas',
      versaoId: versaoSel, versaoLabel: versoes.find(v => v.id === versaoSel)?.codigo || '',
      meses: [{ ano: a, mes: m }],
      masterIds: sel.masters.length ? sel.masters : null,
      contaIds: contas?.contaIds.length ? contas.contaIds : null,
      contaToItem: contas?.contaToItem,
      empresaSel: empEsc ?? [], filialFilter, ccFilter, slot: moedaSlot, ref,
    }
  }, [versaoSel, compSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, filiais, empresas, ccs, versoes, acesso.loading, moedaSlot, JSON.stringify(sel.masters), contas, ref, linhasSel.length]) // eslint-disable-line

  // a aba contábil não depende de versão: compara dois realizados, não o orçado
  const paramsContabil = useMemo<ContabilParams | null>(() => {
    if (!compSel) return null
    const [a, m] = compSel.split('-').map(Number)
    return {
      ano: a, mes: m, versaoId: versaoSel, relatorioId: relSel, ref,
      empresaSel: escopoFiltro(empresaSel.length ? empresaSel : null, empresas, 'empresa', acesso.canSee) ?? [],
      filialFilter: escopoFiltro((filialSel.length > 0 && filialSel.length < filiais.length) ? filialSel : null, filiais, 'filial', acesso.canSee),
      ccFilter: escopoFiltro(effectiveCcFilter(ccs as any, ccSel, areaSel, divisaoSel, buSel), ccs as any, 'centro_custo', acesso.canSee),
    }
  }, [compSel, versaoSel, empresaSel, filialSel, ccSel, areaSel, divisaoSel, buSel, filiais, empresas, ccs, acesso.loading, relSel, ref]) // eslint-disable-line

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Conciliação de folha</h1>
          <p style={S.sub}>{abaSel === 'orcado'
            ? <>Orçado (postos aplicados) × Realizado (folha) por posto, na versão e competência escolhidas. Escolha as <b>linhas do relatório</b> para recortar o universo e ganhar a coluna de referência com o número da própria DRE; sem escolha, compara todas as contas.</>
            : <>Realizado contábil (razão) × Realizado da folha, separado por <b>modelo de contratação</b> — é ele que decide por onde o dinheiro chega à contabilidade. O <b>CLT</b> a folha contabiliza, e o razão vem consolidado: compara por conta → verba. O <b>terceiro</b> chega por nota fiscal, que tem dono: compara por pessoa, mesmo quando a nota cai numa conta diferente da que a folha aponta.</>}</p>
        </div>
        <PostosPills />
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 0' }}>
        <button style={tab(abaSel === 'orcado')} onClick={() => setAbaSel('orcado')}>Orçado × Folha</button>
        <button style={tab(abaSel === 'contabil')} onClick={() => setAbaSel('contabil')}>Contábil × Folha</button>
      </div>

      <div style={S.bar}>
        {abaSel === 'orcado' && <div style={S.fld}><span style={S.lbl}>Versão (orçado)</span>
          <select style={S.sel} value={versaoSel} onChange={e => setVersaoSel(e.target.value)}>
            {!versoes.length && <option value="">—</option>}
            {versoes.map((v: any) => <option key={v.id} value={v.id}>{v.codigo}</option>)}
          </select>
        </div>}
        <div style={S.fld}><span style={S.lbl}>Competência (realizado)</span>
          <select style={S.sel} value={compSel} onChange={e => setCompSel(e.target.value)}>
            {!comps.length && <option value="">—</option>}
            {comps.map(c => { const [a, m] = c.split('-'); return <option key={c} value={c}>{MESES[+m - 1]}/{a}</option> })}
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Relatório</span>
          <select style={S.sel} value={relSel} onChange={e => setRelSel(e.target.value)}
            title="De qual relatório vêm as linhas de referência. A conciliação passa a comparar com os números dele.">
            {!rels.length && <option value="">—</option>}
            {rels.map((r: any) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Linhas do relatório</span>
          <LinhasPicker linhas={ofertadas} sel={linhasSel} setSel={setLinhasSel} />
        </div>
        <div style={S.fld}><span style={S.lbl}>Filtros</span>
          <FiltrosButton empresas={acesso.filterList('empresa', empresas)} filiais={acesso.filterList('filial', filiais)} ccs={acesso.filterList('centro_custo', ccs as any) as any}
            empresaSel={empresaSel} setEmpresaSel={setEmpresaSel} filialSel={filialSel} setFilialSel={setFilialSel} ccSel={ccSel} setCcSel={setCcSel}
            areaSel={areaSel} setAreaSel={setAreaSel} divisaoSel={divisaoSel} setDivisaoSel={setDivisaoSel} buSel={buSel} setBuSel={setBuSel} />
        </div>
        {abaSel === 'orcado' && moedas.length > 1 && <div style={S.fld}><span style={S.lbl}>Moeda</span>
          <MoedaSelect moedas={moedas} slot={moedaSlot} setSlot={setMoedaSlot} /></div>}
      </div>

      {!comps.length ? <div style={S.empty}>Nenhuma folha importada ainda. Vá em <b>{passoLabel('/postos/folha')}</b> e importe o realizado antes de conciliar.</div>
        : abaSel === 'contabil'
          ? (paramsContabil ? <ConciliacaoContabil params={paramsContabil} podeConfigurar={acesso.isAdmin} /> : <div style={S.empty}>Selecione a competência.</div>)
          : params ? <ConciliacaoFolha params={params} />
          : <div style={S.empty}>Selecione a versão e a competência.</div>}
    </div>
  )
}
