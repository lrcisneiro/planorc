import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { ArrowLeftRight, UserMinus, UserPlus } from 'lucide-react'

// Movimentação de quadro do mês — o que explica admissão, demissão e troca.
//
// Nenhuma das três situações se identifica olhando UMA lista. Elas aparecem no
// cruzamento de duas:
//   posto sem realizado  +  pessoa sem posto (mesma filial/CC, valor parecido) → SUBSTITUIÇÃO
//   posto sem realizado  sozinho                                               → REDUÇÃO de quadro
//   pessoa sem posto     sozinha                                               → AUMENTO (revisão orçamentária)
// A tela não decide qual é — sugere o par e deixa o gestor concluir. O ajuste é
// manual por enquanto, de propósito: mexer em posto é ato de orçamento.

export type QuadroParams = {
  ano: number; mes: number; versaoId: string
  empresaSel: string[]; filialFilter: string[] | null; ccFilter: string[] | null
}
type SemPosto = { chave: string; matricula: string; nome: string; postoCod: string; motivo: string; filial_id: string | null; cc_id: string | null; valor: number }
type SemReal  = { id: string; codigo: string; nome: string; filial_id: string | null; cc_id: string | null; orcado: number; semSalario: boolean }

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MOTIVO: Record<string, string> = { nao_existe: 'posto não existe', fora_vigencia: 'fora de vigência', filial_diverge: 'filial diverge' }

const S: Record<string, CSSProperties> = {
  wrap:  { margin: '18px 0 0' },
  head:  { display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 10px', flexWrap: 'wrap' },
  h:     { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  sub:   { fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 },
  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' },
  cardT: { padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th:    { textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 500, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '5px 10px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  mono:  { fontFamily: 'monospace', color: 'var(--muted)' },
  empty: { padding: '18px 14px', color: 'var(--muted)', fontSize: 12.5 },
}
const tag = (cor: string, fundo: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700, color: cor, background: fundo, whiteSpace: 'nowrap' })

export function ConciliacaoQuadro({ params: p }: { params: QuadroParams }) {
  const [semPosto, setSemPosto] = useState<SemPosto[]>([])
  const [semReal, setSemReal] = useState<SemReal[]>([])
  const [ccCod, setCcCod] = useState<Record<string, string>>({})
  const [filCod, setFilCod] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setLoading(true); setErro(null)
      try {
      const per = p.ano * 12 + p.mes
      // O escopo de CC pode ter centenas de ids; como .in() vai na QUERY STRING,
      // a URL estoura e o GET falha. Empresa e filial são catálogos pequenos e
      // continuam no servidor; o CC é filtrado aqui, depois de ler.
      const ccSet = p.ccFilter ? new Set(p.ccFilter) : null
      const [folhaRaw, postos, ccs, fils, orcRaw] = await Promise.all([
        pageAll(() => {
          let q = supabase.from('fat_folha').select('posto_id,matricula,nome,valor,dims,filial_id,cc_id')
            .eq('tipo', 'REALIZADO').eq('ano', p.ano).eq('mes', p.mes)
          if (p.empresaSel.length) q = q.in('empresa_id', p.empresaSel)
          if (p.filialFilter) q = q.in('filial_id', p.filialFilter)
          return q
        }),
        pageAll(() => supabase.from('posto').select('id,codigo,nome,empresa_id,filial_id,cc_id,salario_base,ini_ano,ini_mes,fim_ano,fim_mes')),
        pageAll(() => supabase.from('centro_custo').select('id,codigo')),
        pageAll(() => supabase.from('filial').select('id,codigo')),
        // quanto o posto CUSTAVA no orçado do mês — encargos e benefícios inclusos.
        // O salário do cadastro sozinho subestima e não é o que deixou de ser gasto.
        p.versaoId ? pageAll(() => supabase.from('fat_folha').select('posto_id,valor')
          .eq('tipo', 'ORCADO').eq('versao_id', p.versaoId).eq('ano', p.ano).eq('mes', p.mes)) : Promise.resolve([]),
      ])
      if (!vivo) return
      const folha = ccSet ? (folhaRaw as any[]).filter(l => l.cc_id && ccSet.has(l.cc_id)) : folhaRaw
      setCcCod(Object.fromEntries((ccs as any[]).map(c => [c.id, c.codigo])))
      setFilCod(Object.fromEntries((fils as any[]).map(f => [f.id, f.codigo])))

      // A) pessoas com realizado e sem posto amarrado
      const m = new Map<string, SemPosto>()
      const comPosto = new Set<string>()
      for (const l of folha as any[]) {
        if (l.posto_id) { comPosto.add(l.posto_id); continue }
        const d = l.dims || {}
        const k = `${d.posto_cod || ''}|${l.matricula || l.nome || '?'}`
        const g = m.get(k) || { chave: k, matricula: l.matricula || '', nome: l.nome || '', postoCod: d.posto_cod || '', motivo: d.posto_erro || 'sem posto', filial_id: l.filial_id, cc_id: l.cc_id, valor: 0 }
        g.valor += Number(l.valor) || 0
        m.set(k, g)
      }
      setSemPosto([...m.values()].sort((a, b) => b.valor - a.valor))

      // B) postos vigentes no mês que não tiveram realizado
      // Vigência do cadastro, não fat_folha ORCADO: assim a lista existe mesmo que
      // o Aplicar ainda não tenha rodado na versão.
      const escopoOk = (x: any) =>
        (!p.empresaSel.length || p.empresaSel.includes(x.empresa_id)) &&
        (!p.filialFilter || (x.filial_id && p.filialFilter.includes(x.filial_id))) &&
        (!p.ccFilter || (x.cc_id && p.ccFilter.includes(x.cc_id)))
      const vig = (x: any) => {
        const ini = x.ini_ano ? x.ini_ano * 12 + (x.ini_mes || 1) : null
        const fim = x.fim_ano ? x.fim_ano * 12 + (x.fim_mes || 12) : null
        return (!ini || per >= ini) && (!fim || per <= fim)
      }
      const orcPorPosto = new Map<string, number>()
      for (const o of orcRaw as any[]) { if (o.posto_id) orcPorPosto.set(o.posto_id, (orcPorPosto.get(o.posto_id) || 0) + (Number(o.valor) || 0)) }
      setSemReal((postos as any[]).filter(x => vig(x) && escopoOk(x) && !comPosto.has(x.id))
        .map(x => ({ id: x.id, codigo: x.codigo, nome: x.nome || '', filial_id: x.filial_id, cc_id: x.cc_id,
                     orcado: orcPorPosto.get(x.id) || 0, semSalario: !(Number(x.salario_base) > 0) }))
        .sort((a, b) => b.orcado - a.orcado))
      } catch (e: any) {
        // sem isto o bloco ficava em "Carregando…" para sempre, sem dizer o motivo
        if (vivo) setErro(e?.message || String(e))
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => { vivo = false }
  }, [p.ano, p.mes, p.versaoId, p.empresaSel, p.filialFilter, p.ccFilter])

  // Pareamento sugerido: mesma filial + mesmo CC. Só sugestão — nomes e valores
  // divergem legitimamente numa troca (salário diferente, mês parcial).
  const paresPorPessoa = useMemo(() => {
    const idx = new Map<string, SemReal[]>()
    for (const s of semReal) { const k = `${s.filial_id || ''}|${s.cc_id || ''}`; idx.set(k, [...(idx.get(k) || []), s]) }
    const out: Record<string, SemReal[]> = {}
    for (const x of semPosto) {
      const c = idx.get(`${x.filial_id || ''}|${x.cc_id || ''}`) || []
      if (c.length) out[x.chave] = c.slice(0, 3)
    }
    return out
  }, [semPosto, semReal])
  const postosPareados = useMemo(() => new Set(Object.values(paresPorPessoa).flat().map(s => s.id)), [paresPorPessoa])

  const totA = semPosto.reduce((s, x) => s + x.valor, 0)
  // "orçado sem realizado" tem de ter orçado: posto vigente com custo zero não
  // pertence a esta lista — não há dinheiro planejado que tenha deixado de sair.
  // Ele continua sendo um achado (cadastro sem salário), mas em nota separada.
  const comOrc = useMemo(() => semReal.filter(x => x.orcado > 0), [semReal])
  const semOrc = useMemo(() => semReal.filter(x => !(x.orcado > 0)), [semReal])
  // versão sem Aplicar zera tudo; aí a lista por vigência ainda informa, desde que diga o motivo
  const semAplicar = semReal.length > 0 && comOrc.length === 0
  const listaB = semAplicar ? semReal : comOrc
  const totB = listaB.reduce((s, x) => s + x.orcado, 0)

  if (loading) return <div style={S.empty}>Carregando movimentação de quadro…</div>
  if (erro) return <div style={{ ...S.wrap, ...S.empty, color: 'var(--red)' }}>Movimentação de quadro não carregou: {erro}</div>
  if (!semPosto.length && !semReal.length) return null

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.h}>Quadro — o que mudou no mês</span>
        <span style={S.sub}>
          Posto sem realizado <b>e</b> pessoa sem posto na mesma filial/CC = provável <b>substituição</b>.
          Sozinhos: só posto = <b>redução</b>; só pessoa = <b>aumento de quadro</b> (revisão orçamentária).
        </span>
      </div>

      <div style={S.grid}>
        <div style={S.card}>
          <div style={S.cardT}><UserPlus size={14} style={{ color: 'var(--orange)' }} /> Pessoa com custo e sem posto orçado
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontWeight: 400 }}>{semPosto.length} · R$ {money(totA)}</span></div>
          {!semPosto.length ? <div style={S.empty}>Ninguém — todo custo da folha caiu em posto orçado.</div> : (
            <table style={S.table}>
              <thead><tr><th style={S.th}>Pessoa</th><th style={S.th}>Filial/CC</th><th style={S.th}>Motivo</th><th style={{ ...S.th, textAlign: 'right' }}>Custo</th></tr></thead>
              <tbody>
                {semPosto.map(x => {
                  const par = paresPorPessoa[x.chave]
                  return (
                    <tr key={x.chave}>
                      <td style={S.td}><span style={S.mono}>{x.matricula}</span> {x.nome}
                        {par && <div style={{ fontSize: 11, color: 'var(--violet)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <ArrowLeftRight size={11} /> talvez substitua {par.map(s => s.codigo).join(', ')}
                        </div>}
                      </td>
                      <td style={{ ...S.td, ...S.mono }}>{filCod[x.filial_id || ''] || '—'}/{ccCod[x.cc_id || ''] || '—'}</td>
                      <td style={S.td}><span style={tag('var(--orange)', 'rgba(251,146,60,0.14)')}>{MOTIVO[x.motivo] || x.motivo}</span></td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{money(x.valor)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={S.card}>
          <div style={S.cardT}><UserMinus size={14} style={{ color: 'var(--blue)' }} /> Posto orçado sem realizado no mês
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontWeight: 400 }}>{listaB.length} · R$ {money(totB)} orçados no mês</span></div>
          {semAplicar && <div style={{ ...S.empty, color: 'var(--orange)' }}>Nenhum destes tem orçado na versão escolhida — provavelmente o <b>Aplicar no orçado</b> não rodou nela. A lista abaixo vem da vigência do cadastro.</div>}
          {!listaB.length ? <div style={S.empty}>Nenhum — todo posto com orçado no mês teve custo na folha.</div> : (
            <table style={S.table}>
              <thead><tr><th style={S.th}>Posto</th><th style={S.th}>Filial/CC</th><th style={S.th}>Leitura</th><th style={{ ...S.th, textAlign: 'right' }}>Orçado no mês</th></tr></thead>
              <tbody>
                {listaB.map(x => (
                  <tr key={x.id}>
                    <td style={S.td}><span style={S.mono}>{x.codigo}</span> {x.nome}</td>
                    <td style={{ ...S.td, ...S.mono }}>{filCod[x.filial_id || ''] || '—'}/{ccCod[x.cc_id || ''] || '—'}</td>
                    <td style={S.td}>{x.semSalario
                      ? <span title="posto cadastrado com salario_base = 0: o motor calcula custo zero, então ele não entra no orçado" style={tag('var(--orange)', 'rgba(251,146,60,0.14)')}>sem salário no cadastro</span>
                      : postosPareados.has(x.id)
                        ? <span style={tag('var(--violet)', 'rgba(139,92,246,0.16)')}>possível troca</span>
                        : <span style={tag('var(--blue)', 'rgba(59,130,246,0.14)')}>{x.orcado ? 'orçado, não pago' : 'sem custo dos dois lados'}</span>}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{money(x.orcado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!semAplicar && !!semOrc.length && (
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              <b style={{ color: 'var(--orange)' }}>{semOrc.length} posto(s) vigentes sem orçado nem realizado</b> — cadastro com
              salário zero, então o motor calcula custo zero e eles não entram no orçamento. Não movem número nenhum;
              o conserto é preencher o salário ou encerrar a vigência de quem já saiu.
              <div style={{ marginTop: 4, ...S.mono }}>{semOrc.map(x => x.codigo).join(' · ')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
