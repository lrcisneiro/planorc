import { useEffect, useMemo, useState, Fragment } from 'react'
import { X, Plus, Trash2, ChevronsRight, Lock } from 'lucide-react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { useUserAccess } from '../../hooks/useUserAccess'
import { useCapacidades } from '../../hooks/useCapacidades'

// ============================================================
// O drill da tela por linha: UMA linha orçamentária aberta em todas as
// combinações empresa · filial · centro de custo, com os 12 meses.
//
// É aqui que se edita — e só aqui. O consolidado da tela de trás é leitura,
// porque `fat_orcado` só existe no grão da combinação (ver o comentário em
// OrcarLinhaPage).
//
// ⚠ Escrever confere o retorno. UPDATE barrado por RLS **não dá erro**: filtra
// as linhas, afeta zero e volta sucesso. Sem `.select('id')` a célula pareceria
// salva e sumiria no refresh — foi o que já aconteceu na grade.
//
// ⚠ O escopo de ORÇAR é cruzado aqui também. A RLS barra no banco, mas uma
// célula que aceita digitação e depois recusa é pior que uma célula travada:
// a pessoa perde o trabalho sem entender.
// ============================================================

type Props = { linha: any; versao: any; ano: number; empresas: any[]; onFechar: (mudou: boolean) => void }
type Lanc = { id: string; valor: number; origem: string; dims: any }
type Cel = { total: number; itens: Lanc[] }

type Comb = { empresa_id: string; filial_id: string | null; cc_id: string | null }

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const parseNum = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'))
const chave = (c: Comb) => `${c.empresa_id}|${c.filial_id || ''}|${c.cc_id || ''}`

export default function DrillCombinacoes({ linha, versao, ano, empresas, onFechar }: Props) {
  const acesso = useUserAccess()
  const cap = useCapacidades()
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  // ⚠ A célula tem N LANÇAMENTOS, não um. Em Salários há um por PESSOA por
  // mês — 13.140 células de posto em 2027. Antes guardávamos só o último lido,
  // então o drill mostrava o valor de uma pessoa como se fosse o da célula e
  // discordava do total da linha acima. Agora soma, e guarda os itens para
  // saber se dá para editar.
  const [cel, setCel] = useState<Record<string, Record<number, Cel>>>({})
  // Qual célula está com a composição aberta — uma de cada vez.
  const [comp, setComp] = useState<{ k: string; mes: number } | null>(null)
  const [combs, setCombs] = useState<Comb[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [mudou, setMudou] = useState(false)
  // Célula em foco. Precisa ser estado (e não só o DOM) porque o botão de
  // replicar some junto com o foco: ele é renderizado SÓ na célula ativa.
  const [foco, setFoco] = useState<{ k: string; mes: number; txt: string } | null>(null)

  const master = linha.linha_orc_id as string
  const bloqueada = !!versao.bloqueada
  const podeOrcar = cap.can('orcar') && acesso.podeEscrever && !bloqueada

  const carregar = async () => {
    setCarregando(true); setErro('')
    try {
      const [fl, cc, rows] = await Promise.all([
        supabase.from('filial').select('id,codigo,descricao,empresa_id').order('codigo'),
        supabase.from('centro_custo').select('id,codigo,descricao').eq('ativo', true).order('codigo'),
        pageAll(() => supabase.from('fat_orcado')
          .select('id,empresa_id,filial_id,cc_id,mes,valor,origem,dims')
          .eq('versao_id', versao.id).eq('ano', ano).eq('linha_id', master)
          .in('empresa_id', empresas.map(e => e.id))),
      ])
      setFiliais(fl.data || []); setCcs(cc.data || [])
      const c: Record<string, Record<number, Cel>> = {}
      const vistos = new Map<string, Comb>()
      for (const r of rows as any[]) {
        const comb: Comb = { empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: r.cc_id }
        const k = chave(comb); vistos.set(k, comb)
        const cl = ((c[k] ||= {})[r.mes] ||= { total: 0, itens: [] })
        cl.itens.push({ id: r.id, valor: Number(r.valor) || 0, origem: r.origem, dims: r.dims })
        cl.total += Number(r.valor) || 0
      }
      setCel(c); setCombs([...vistos.values()])
    } catch (e: any) { setErro(e?.message || String(e)) }
    finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [linha.id, versao.id, ano]) // eslint-disable-line

  const empCod = useMemo(() => Object.fromEntries(empresas.map(e => [e.id, e.codigo])), [empresas])
  const filCod = useMemo(() => Object.fromEntries(filiais.map(f => [f.id, f.codigo])), [filiais])
  const ccCod = useMemo(() => Object.fromEntries(ccs.map(c => [c.id, `${c.codigo} · ${c.descricao || ''}`])), [ccs])

  const podeCelula = (c: Comb) =>
    podeOrcar && acesso.canEdit('empresa', c.empresa_id)
    && (c.filial_id ? acesso.canEdit('filial', c.filial_id) : true)
    && (c.cc_id ? acesso.canEdit('centro_custo', c.cc_id) : true)

  const gravar = async (c: Comb, mes: number, texto: string) => {
    const k = chave(c)
    const cl = cel[k]?.[mes]
    if (!editavelCel(cl)) { setErro('Esta célula vem do motor (posto/formulário) — altere na origem.'); return }
    const atual = cl?.itens[0]
    const n = texto.trim() === '' ? null : parseNum(texto)
    if (n !== null && isNaN(n)) return
    if ((atual?.valor ?? null) === n) return
    setErro('')
    try {
      if (n === null) {
        if (!atual) return
        const { data, error } = await supabase.from('fat_orcado').delete().eq('id', atual.id).select('id')
        if (error) throw new Error(error.message)
        if (!data?.length) throw new Error('Nada foi apagado — fora do seu escopo de edição.')
      } else if (atual) {
        const { data, error } = await supabase.from('fat_orcado')
          .update({ valor: n, expressao: null, origem: 'MANUAL' }).eq('id', atual.id).select('id')
        if (error) throw new Error(error.message)
        if (!data?.length) throw new Error('Nada foi gravado — fora do seu escopo de edição.')
      } else {
        const { data, error } = await supabase.from('fat_orcado').insert({
          tenant_id: TENANT_ID, versao_id: versao.id, linha_id: master, empresa_id: c.empresa_id,
          filial_id: c.filial_id, cc_id: c.cc_id, ano, mes, valor: n, expressao: null,
          origem: 'MANUAL', dims: {},
        }).select('id')
        if (error) throw new Error(error.message)
        if (!data?.length) throw new Error('Nada foi gravado — fora do seu escopo de edição.')
      }
      setMudou(true)
      await carregar()
    } catch (e: any) { setErro(e?.message || String(e)) }
  }


  /** Rótulo legível de um lançamento, a partir do que a origem carimbou em `dims`. */
  const rotulo = (l: Lanc) => {
    const d = l.dims || {}
    if (d.nome) return `${d.nome}${d.posto ? ` · ${d.posto}` : ''}`   // posto
    if (d.historico) return String(d.historico)                        // formulário
    return l.origem === 'MANUAL' ? 'Ajuste manual' : l.origem
  }

  /** Grava UM lançamento. `alvo` nulo = criar o ajuste manual desta célula.
   *  ⚠ O ajuste nasce com `dims` VAZIO de propósito: é o que o distingue dos
   *  lançamentos do motor na chave única, então ele CONVIVE com eles em vez de
   *  colidir — e o Aplicar da origem continua apagando só o que é dela. */
  const gravarLanc = async (c: Comb, mes: number, alvo: Lanc | null, texto: string) => {
    if (alvo && alvo.origem !== 'MANUAL') { setErro('Lançamento do motor — altere na origem.'); return }
    const n = texto.trim() === '' ? null : parseNum(texto)
    if (n !== null && isNaN(n)) return
    if ((alvo?.valor ?? null) === n) return
    setErro('')
    try {
      if (n === null) {
        if (!alvo) return
        const { data, error } = await supabase.from('fat_orcado').delete().eq('id', alvo.id).select('id')
        if (error) throw new Error(error.message)
        if (!data?.length) throw new Error('Nada foi apagado — fora do seu escopo de edição.')
      } else if (alvo) {
        const { data, error } = await supabase.from('fat_orcado')
          .update({ valor: n, expressao: null, origem: 'MANUAL' }).eq('id', alvo.id).select('id')
        if (error) throw new Error(error.message)
        if (!data?.length) throw new Error('Nada foi gravado — fora do seu escopo de edição.')
      } else {
        const { data, error } = await supabase.from('fat_orcado').insert({
          tenant_id: TENANT_ID, versao_id: versao.id, linha_id: master, empresa_id: c.empresa_id,
          filial_id: c.filial_id, cc_id: c.cc_id, ano, mes, valor: n, expressao: null,
          origem: 'MANUAL', dims: {},
        }).select('id')
        if (error) throw new Error(error.message)
        if (!data?.length) throw new Error('Nada foi gravado — fora do seu escopo de edição.')
      }
      setMudou(true)
      await carregar()
    } catch (e: any) { setErro(e?.message || String(e)) }
  }

  /** O ajuste manual de uma célula: o lançamento MANUAL sem dims. */
  const ajusteDe = (cl?: Cel) => (cl?.itens || []).find(i => i.origem === 'MANUAL'
    && (!i.dims || Object.keys(i.dims).length === 0)) || null

  // Preencher à direita: repete o valor da célula ativa até dezembro, como o
  // →| da grade. É o gesto mais comum do orçamento — valor que se repete o ano
  // todo — e sem ele são onze digitações iguais.
  // ⚠ Uma gravação por mês e UM recarregar no fim: recarregar a cada mês faria
  // onze idas ao banco e a tabela piscando onze vezes.
  const replicar = async (c: Comb, desde: number, texto: string) => {
    const n = texto.trim() === '' ? null : parseNum(texto)
    if (n !== null && isNaN(n)) return
    const k = chave(c)
    setErro('')
    try {
      for (let m = desde; m <= 12; m++) {
        const cl = cel[k]?.[m]
        if (!editavelCel(cl)) continue   // replicar pula o que é gerado
        const atual = cl?.itens[0]
        if ((atual?.valor ?? null) === n) continue
        if (n === null) {
          if (atual) {
            const { error } = await supabase.from('fat_orcado').delete().eq('id', atual.id).select('id')
            if (error) throw new Error(error.message)
          }
        } else if (atual) {
          const { error } = await supabase.from('fat_orcado')
            .update({ valor: n, expressao: null, origem: 'MANUAL' }).eq('id', atual.id).select('id')
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase.from('fat_orcado').insert({
            tenant_id: TENANT_ID, versao_id: versao.id, linha_id: master, empresa_id: c.empresa_id,
            filial_id: c.filial_id, cc_id: c.cc_id, ano, mes: m, valor: n, expressao: null,
            origem: 'MANUAL', dims: {},
          }).select('id')
          if (error) throw new Error(error.message)
        }
      }
      setMudou(true); setFoco(null)
      await carregar()
    } catch (e: any) { setErro(e?.message || String(e)) }
  }

  const novaComb = () => {
    const emp = empresas[0]
    if (!emp) return
    const c: Comb = { empresa_id: emp.id, filial_id: null, cc_id: null }
    if (combs.some(x => chave(x) === chave(c))) { setErro('Essa combinação já está na lista.'); return }
    setCombs(v => [...v, c])
  }

  const trocar = (i: number, patch: Partial<Comb>) =>
    setCombs(v => v.map((c, j) => j === i ? { ...c, ...patch } : c))

  const totalMes = (m: number) => combs.reduce((s, c) => s + (cel[chave(c)]?.[m]?.total || 0), 0)
  const totalAno = combs.reduce((s, c) => s + Object.values(cel[chave(c)] || {}).reduce((a, x) => a + x.total, 0), 0)

  // ⚠ SÓ EDITA CÉLULA PURAMENTE MANUAL. Com valor de posto ou formulário
  // dentro, digitar aqui converte aquele lançamento para MANUAL **mantendo o
  // dims** — e aí o próximo Aplicar não o apaga (já não é da origem dele) e
  // insere outro com a mesma chave única: o Aplicar passa a FALHAR. Com mais
  // de um lançamento, editar mexeria num deles e o total diria outra coisa.
  // O caminho de mudar valor gerado é a origem (cenário de postos, formulário).
  const editavelCel = (cl?: Cel) =>
    !cl || (cl.itens.length <= 1 && (cl.itens[0]?.origem ?? 'MANUAL') === 'MANUAL')
  const origensDe = (cl?: Cel) => [...new Set((cl?.itens || []).map(i => i.origem))].join(' · ')
  const temConsolidado = combs.some(c => !c.cc_id)
  const temDetalhe = combs.some(c => !!c.cc_id)

  const inp: React.CSSProperties = { width: 86, padding: '3px 6px', fontSize: 12.5, textAlign: 'right',
    background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 5 }
  const th: React.CSSProperties = { padding: '7px 8px', fontSize: 11, color: 'var(--muted)', fontWeight: 600,
    textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--panel-2)', textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
         onClick={() => onFechar(mudou)}>
      <div onClick={e => e.stopPropagation()}
           style={{ width: 'min(1300px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
                    background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{linha.descricao}</h2>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              {versao.codigo} · {ano} · {combs.length} combinação(ões) · total {money(totalAno)}
              {bloqueada && <b style={{ color: 'var(--orange)' }}> · versão bloqueada, só leitura</b>}
            </div>
          </div>
          <button onClick={() => onFechar(mudou)} style={{ background: 'none', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: 'var(--muted)' }}><X size={14} /></button>
        </div>

        <div style={{ overflow: 'auto', padding: '14px 20px 20px' }}>
          {erro && <div style={{ fontSize: 12.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>{erro}</div>}

          {temConsolidado && temDetalhe && (
            <div style={{ fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)',
                          border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, lineHeight: 1.6 }}>
              <b>Grão misto nesta linha.</b> Há valor lançado <b>sem centro de custo</b> e também
              detalhado por CC — os dois somam no total. Quase sempre um deles é resíduo de uma
              digitação anterior: apague o que sobra zerando as células.
            </div>
          )}

          {carregando ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Carregando…</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left', minWidth: 250 }}>Empresa · Filial · Centro de custo</th>
                {MES.map(m => <th key={m} style={th}>{m}</th>)}
                <th style={{ ...th, color: 'var(--text)' }}>Ano</th>
                <th style={th} />
              </tr></thead>
              <tbody>
                {combs.map((c, i) => {
                  const k = chave(c); const linhaCel = cel[k] || {}
                  const tot = Object.values(linhaCel).reduce((s, x) => s + x.total, 0)
                  const pode = podeCelula(c)
                  const nova = !Object.keys(linhaCel).length
                  return (
                    <Fragment key={k + i}>
                    <tr>
                      <td style={{ ...td, textAlign: 'left' }}>
                        {nova ? (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <select value={c.empresa_id} onChange={e => trocar(i, { empresa_id: e.target.value, filial_id: null })}
                              style={{ ...inp, width: 'auto', textAlign: 'left' }}>
                              {empresas.map(e => <option key={e.id} value={e.id}>{e.codigo}</option>)}
                            </select>
                            <select value={c.filial_id || ''} onChange={e => trocar(i, { filial_id: e.target.value || null })}
                              style={{ ...inp, width: 'auto', textAlign: 'left' }}>
                              <option value="">— sem filial —</option>
                              {filiais.filter(f => f.empresa_id === c.empresa_id).map(f => <option key={f.id} value={f.id}>{f.codigo}</option>)}
                            </select>
                            <select value={c.cc_id || ''} onChange={e => trocar(i, { cc_id: e.target.value || null })}
                              style={{ ...inp, width: 'auto', textAlign: 'left' }}>
                              <option value="">— sem centro de custo —</option>
                              {acesso.filterEdit('centro_custo', ccs as any).map((x: any) => <option key={x.id} value={x.id}>{x.codigo} · {x.descricao}</option>)}
                            </select>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text)' }}>
                            <b style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{empCod[c.empresa_id] || '?'}</b>
                            {' · '}{c.filial_id ? filCod[c.filial_id] : <i style={{ color: 'var(--muted)' }}>sem filial</i>}
                            {' · '}{c.cc_id ? ccCod[c.cc_id] : <i style={{ color: 'var(--orange)' }}>sem CC (consolidado)</i>}
                          </span>
                        )}
                      </td>
                      {Array.from({ length: 12 }, (_, j) => j + 1).map(m => {
                        const v = linhaCel[m]
                        const editavel = editavelCel(v)
                        return (
                          <td key={m} style={td}>
                            {/* Célula com valor gerado ou com vários lançamentos: mostra o
                                TOTAL e não aceita digitação — ver `editavelCel`. */}
                            {pode && !editavel
                              ? <button onClick={() => setComp(x => x && x.k === k && x.mes === m ? null : { k, mes: m })}
                                  title={`${v!.itens.length} lançamento(s) · ${origensDe(v)}. Clique para ver a composição e ajustar.`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end',
                                           width: '100%', background: 'none', border: 'none', font: 'inherit', padding: 0,
                                           cursor: 'pointer', color: comp && comp.k === k && comp.mes === m ? 'var(--violet)' : 'var(--text-mid)' }}>
                                  {money(v!.total)}
                                  <Lock size={10} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                                </button>
                              : pode
                              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                  <input style={inp}
                                    defaultValue={v ? money(v.total) : ''} key={`${k}-${m}-${v?.total ?? ''}`}
                                    onFocus={e => setFoco({ k, mes: m, txt: e.target.value })}
                                    onChange={e => setFoco({ k, mes: m, txt: e.target.value })}
                                    onBlur={e => { gravar(c, m, e.target.value); setFoco(f => (f && f.k === k && f.mes === m) ? null : f) }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault(); replicar(c, m, (e.target as HTMLInputElement).value)
                                      } else if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                    }} />
                                  {/* onMouseDown, não onClick: o clique só chega DEPOIS do blur,
                                      e o blur já teria tirado o botão da tela. */}
                                  {foco?.k === k && foco.mes === m && m < 12 && (
                                    <button onMouseDown={e => { e.preventDefault(); replicar(c, m, foco.txt) }}
                                      title={`Repetir este valor de ${MES[m - 1]} até dezembro (Ctrl+Enter)`}
                                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                               color: 'var(--violet)', display: 'inline-flex' }}>
                                      <ChevronsRight size={14} />
                                    </button>
                                  )}
                                </span>
                              : <span style={{ color: v ? 'var(--text-mid)' : 'var(--faint)' }}>{v ? money(v.total) : '—'}</span>}
                          </td>
                        )
                      })}
                      <td style={{ ...td, fontWeight: 700, color: tot ? 'var(--text)' : 'var(--faint)' }}>{tot ? money(tot) : '—'}</td>
                      <td style={td}>
                        {nova && <button onClick={() => setCombs(v => v.filter((_, j) => j !== i))}
                          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                    {comp && comp.k === k && (() => {
                      const cl = linhaCel[comp.mes]; if (!cl) return null
                      const aj = ajusteDe(cl)
                      const gerados = cl.itens.filter(i => i !== aj)
                      return (
                        <tr key={k + '-comp'}>
                          <td colSpan={14} style={{ ...td, textAlign: 'left', background: 'var(--bg)',
                                                    borderBottom: '2px solid var(--border-strong)' }}>
                            {/* ⚠ A linha ocupa as 14 colunas da tabela, mas o conteúdo não
                                deve: com `flex:1` no nome, o valor ia parar no fim da tela,
                                longe de quem ele descreve. Largura fixa aproxima os dois. */}
                            <div style={{ maxWidth: 620 }}>
                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
                              Composição de <b style={{ color: 'var(--text)' }}>{MES[comp.mes - 1]}</b> — {gerados.length} lançamento(s).
                              {' '}O que vem do motor não se edita aqui; some um <b>ajuste</b> abaixo se precisar corrigir.
                            </div>
                            <div style={{ display: 'grid', gap: 3, maxHeight: 220, overflow: 'auto' }}>
                              {gerados.map(l => (
                                <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
                                  <span style={{ width: 92, color: 'var(--muted)', fontSize: 10.5 }}>{l.origem}</span>
                                  <span style={{ flex: 1, color: 'var(--text-mid)', overflow: 'hidden',
                                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotulo(l)}</span>
                                  {/* MANUAL continua editável aqui: o cadeado da célula é por
                                      ela ter VÁRIOS lançamentos, não por este ser do motor.
                                      Travar o que a pessoa mesma digitou seria tirar acesso
                                      a um dado que é dela. */}
                                  {l.origem === 'MANUAL' && pode
                                    ? <input style={{ ...inp, width: 110 }} defaultValue={money(l.valor)}
                                        key={`it-${l.id}-${l.valor}`}
                                        onBlur={e => gravarLanc(c, comp.mes, l, e.target.value)} />
                                    : <span style={{ width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                                     color: 'var(--text)' }}>{money(l.valor)}</span>}
                                </div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8,
                                          borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12 }}>
                              <span style={{ width: 92, color: 'var(--violet)', fontSize: 10.5, fontWeight: 700 }}>AJUSTE</span>
                              <span style={{ flex: 1, color: 'var(--muted)' }}>
                                soma ao que o motor calculou — o Aplicar da origem não o apaga
                              </span>
                              <input style={{ ...inp, width: 110 }} defaultValue={aj ? money(aj.valor) : ''}
                                key={`aj-${k}-${comp.mes}-${aj?.valor ?? ''}`} disabled={!pode}
                                placeholder="0,00"
                                onBlur={e => gravarLanc(c, comp.mes, aj, e.target.value)} />
                              <span style={{ width: 110, textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
                                = {money(cl.total)}
                              </span>
                            </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })()}
                    </Fragment>
                  )
                })}
                <tr>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>Total</td>
                  {Array.from({ length: 12 }, (_, j) => j + 1).map(m => (
                    <td key={m} style={{ ...td, fontWeight: 700, color: totalMes(m) ? 'var(--text)' : 'var(--faint)' }}>
                      {totalMes(m) ? money(totalMes(m)) : '—'}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700 }}>{money(totalAno)}</td>
                  <td style={td} />
                </tr>
              </tbody>
            </table>
          )}

          {podeOrcar && (
            <button onClick={novaComb}
              style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                       fontSize: 12.5, background: 'var(--panel)', color: 'var(--text-mid)',
                       border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' }}>
              <Plus size={13} /> Nova combinação
            </button>
          )}

          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.65 }}>
            O valor mora aqui, no grão <b>empresa · filial · centro de custo</b> — por isso o total da
            tela de trás é só leitura. Célula vazia não existe no banco; zerar <b>apaga</b> a linha.
            {' '}Valor vindo de <b>formulário</b> ou <b>posto</b> fica mais claro e, se editado aqui,
            passa a ser manual — e a próxima aplicação daquela origem pode sobrescrever.
            {' '}Com a célula em foco, <b>Ctrl+Enter</b> (ou o <b>»</b>) repete o valor até dezembro.
          </p>
        </div>
      </div>
    </div>
  )
}
