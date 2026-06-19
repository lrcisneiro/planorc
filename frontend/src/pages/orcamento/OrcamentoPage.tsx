import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const fmt = (v: number) =>
  v === 0 ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const S = {
  page: { padding: 24, fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 } as React.CSSProperties,
  title: { fontSize: 22, fontWeight: 600, color: '#212529', margin: 0 } as React.CSSProperties,
  subtitle: { fontSize: 13, color: '#868e96', margin: '4px 0 0' } as React.CSSProperties,
  toolbar: { display: 'flex', gap: 8, alignItems: 'center' } as React.CSSProperties,
  select: { padding: '6px 10px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: 13, color: '#343a40', background: 'white' } as React.CSSProperties,
  wrap: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13, minWidth: 1100 },
  thFix: { textAlign: 'left' as const, padding: '8px 12px', background: '#1e2d5a', color: 'white', fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0 },
  thMes: { textAlign: 'right' as const, padding: '8px 8px', background: '#1e2d5a', color: '#a5b4fc', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' as const, minWidth: 70 },
  thTotal: { textAlign: 'right' as const, padding: '8px 10px', background: '#152247', color: '#c7d2fe', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' as const },
}

type Item = { id: string; codigo: string; descricao: string; nivel: number; pai_id: string | null; aceita_lancamento: boolean }
type Valores = Record<string, Record<number, number>> // item_id → mes → valor

export default function OrcamentoPage() {
  const [itens, setItens] = useState<Item[]>([])
  const [valores, setValores] = useState<Valores>({})
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [editando, setEditando] = useState<{ id: string; mes: number } | null>(null)
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [ano] = useState(2026)
  const [versaoId, setVersaoId] = useState<string | null>(null)
  const [empresaId, setEmpresaId] = useState<string | null>(null)

  useEffect(() => {
    async function carregar() {
      const [{ data: iData }, { data: lData }, { data: versao }, { data: empresa }] = await Promise.all([
        supabase.from('plano_orcamentario').select('id, codigo, descricao, nivel, pai_id, aceita_lancamento').order('codigo'),
        supabase.from('fat_lancamento').select('item_orc_id, mes, valor').eq('ano', ano).eq('tipo_lancamento', 'ORCADO'),
        supabase.from('versao_orcamento').select('id').eq('codigo', 'BASELINE_2026').single(),
        supabase.from('empresa').select('id').eq('codigo', '01').single(),
      ])

      setItens(iData || [])
      setVersaoId(versao?.id || null)
      setEmpresaId(empresa?.id || null)

      const mapa: Valores = {}
      for (const l of lData || []) {
        if (!mapa[l.item_orc_id]) mapa[l.item_orc_id] = {}
        mapa[l.item_orc_id][l.mes] = (mapa[l.item_orc_id][l.mes] || 0) + l.valor
      }
      setValores(mapa)

      const n1ids = new Set((iData || []).filter(x => x.nivel === 1).map(x => x.id))
      setExpandidos(n1ids)
      setLoading(false)
    }
    carregar()
  }, [ano])

  const toggle = (id: string) => {
    setExpandidos(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  // Calcula total consolidado de um item incluindo filhos
  const totalItem = (id: string, mes?: number): number => {
    const direto = mes
      ? (valores[id]?.[mes] || 0)
      : MESES.reduce((s, _, i) => s + (valores[id]?.[i + 1] || 0), 0)

    const filhos = itens.filter(x => x.pai_id === id)
    const deFilhos = filhos.reduce((s, f) => s + totalItem(f.id, mes), 0)
    return direto + deFilhos
  }

  const iniciarEdicao = (id: string, mes: number) => {
    setEditando({ id, mes })
    setInputVal(String(valores[id]?.[mes] || ''))
  }

  const salvarEdicao = async () => {
    if (!editando || !versaoId || !empresaId) return
    const { id, mes } = editando
    const novoValor = parseFloat(inputVal.replace(',', '.')) || 0
    setSalvando(true)
    setErroSalvar(null)

    const { error } = await supabase.from('fat_lancamento').upsert({
      versao_id: versaoId,
      item_orc_id: id,
      empresa_id: empresaId,
      ano,
      mes,
      valor: novoValor,
      tipo_lancamento: 'ORCADO',
      dim_values: {},
    }, { onConflict: 'versao_id,item_orc_id,empresa_id,ano,mes,tipo_lancamento' })

    if (error) {
      setErroSalvar(error.message)
    } else {
      setValores(prev => ({
        ...prev,
        [id]: { ...(prev[id] || {}), [mes]: novoValor }
      }))
    }
    setEditando(null)
    setSalvando(false)
  }

  const n1 = itens.filter(x => x.nivel === 1)
  const n2por = (pai: string) => itens.filter(x => x.nivel === 2 && x.pai_id === pai)
  const n3por = (pai: string) => itens.filter(x => x.nivel === 3 && x.pai_id === pai)

  const rowN1 = (item: Item) => (
    <tr key={item.id} style={{ background: '#1e2d5a', cursor: 'pointer' }} onClick={() => toggle(item.id)}>
      <td style={{ padding: '8px 12px', color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {expandidos.has(item.id) ? '▾' : '▸'} {item.codigo} — {item.descricao}
      </td>
      {MESES.map((_, i) => (
        <td key={i} style={{ textAlign: 'right', padding: '8px 8px', color: '#a5b4fc', fontWeight: 600, fontFamily: 'monospace' }}>
          {fmt(totalItem(item.id, i + 1))}
        </td>
      ))}
      <td style={{ textAlign: 'right', padding: '8px 10px', color: 'white', fontWeight: 700, fontFamily: 'monospace', background: '#152247' }}>
        {fmt(totalItem(item.id))}
      </td>
    </tr>
  )

  const rowN2 = (item: Item) => (
    <tr key={item.id} style={{ background: '#f0f2ff', cursor: 'pointer' }} onClick={() => toggle(item.id)}>
      <td style={{ padding: '7px 12px 7px 28px', color: '#3b5bdb', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {expandidos.has(item.id) ? '▾' : '▸'} {item.codigo} — {item.descricao}
      </td>
      {MESES.map((_, i) => (
        <td key={i} style={{ textAlign: 'right', padding: '7px 8px', color: '#3b5bdb', fontFamily: 'monospace', fontWeight: 600 }}>
          {fmt(totalItem(item.id, i + 1))}
        </td>
      ))}
      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#3b5bdb', fontWeight: 700, fontFamily: 'monospace', background: '#e0e7ff' }}>
        {fmt(totalItem(item.id))}
      </td>
    </tr>
  )

  const rowN3 = (item: Item) => (
    <tr key={item.id} style={{ borderBottom: '1px solid #f1f3f5' }}
      onDoubleClick={() => {}}>
      <td style={{ padding: '6px 12px 6px 44px', color: '#495057', whiteSpace: 'nowrap', fontSize: 12 }}>
        {item.codigo} — {item.descricao}
      </td>
      {MESES.map((_, i) => {
        const mes = i + 1
        const isEdit = editando?.id === item.id && editando?.mes === mes
        const val = valores[item.id]?.[mes] || 0
        return (
          <td key={i} style={{ textAlign: 'right', padding: '4px 4px' }}>
            {isEdit ? (
              <input
                autoFocus
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onBlur={salvarEdicao}
                onKeyDown={e => { if (e.key === 'Enter') salvarEdicao(); if (e.key === 'Escape') setEditando(null) }}
                style={{
                  width: 70, textAlign: 'right', padding: '2px 4px',
                  border: '2px solid #3b5bdb', borderRadius: 4,
                  fontFamily: 'monospace', fontSize: 12
                }}
              />
            ) : (
              <span
                onClick={() => iniciarEdicao(item.id, mes)}
                style={{
                  display: 'block', textAlign: 'right', padding: '2px 6px',
                  fontFamily: 'monospace', color: val ? '#212529' : '#dee2e6',
                  cursor: 'pointer', borderRadius: 4,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#e7f5ff')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {fmt(val)}
              </span>
            )}
          </td>
        )
      })}
      <td style={{ textAlign: 'right', padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600, color: '#495057', background: '#f8f9fa' }}>
        {fmt(totalItem(item.id))}
      </td>
    </tr>
  )

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Editor de Orçamento</h1>
          <p style={S.subtitle}>Baseline {ano} · Clique em um valor para editar · Enter para salvar</p>
        </div>
        <div style={S.toolbar}>
          {salvando && <span style={{ fontSize: 12, color: '#3b5bdb' }}>Salvando...</span>}
          {erroSalvar && <span style={{ fontSize: 12, color: '#c92a2a' }}>Erro: {erroSalvar}</span>}
          <select style={S.select}><option>Baseline 2026</option></select>
          <select style={S.select}><option>Todas as empresas</option></select>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#aaa' }}>Carregando plano orçamentário...</p>
      ) : (
        <div style={S.wrap}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.thFix, minWidth: 280 }}>Item Orçamentário</th>
                {MESES.map(m => <th key={m} style={S.thMes}>{m}</th>)}
                <th style={S.thTotal}>Total</th>
              </tr>
            </thead>
            <tbody>
              {n1.map(item1 => (<>
                {rowN1(item1)}
                {expandidos.has(item1.id) && n2por(item1.id).map(item2 => (<>
                  {rowN2(item2)}
                  {expandidos.has(item2.id) && n3por(item2.id).map(item3 => rowN3(item3))}
                </>))}
              </>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
