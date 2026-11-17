import { useEffect, useMemo, useState } from 'react'
import { X, Split, AlertTriangle } from 'lucide-react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { useUserAccess } from '../../hooks/useUserAccess'
import { cascataRateio } from '../../lib/rateioFolha'

// ============================================================
// RATEAR uma combinação do drill pelos CÓDIGOS DE RATEIO cadastrados.
//
// O valor sai de UMA combinação (empresa · filial · CC) e se espalha pelos
// destinos do código, mês a mês. É o gesto que antes se fazia digitando a mão
// em N combinações — com a conta de porcentagem feita por fora.
//
// ⚠ REAPROVEITA `cascataRateio` (lib/rateioFolha.ts), a mesma do posto. Um
// código de CC troca o centro de custo e mantém a empresa; um de EMPRESA faz o
// contrário — por isso "a combinação de ambos" é um de cada, em cascata
// (CC primeiro, depois EMPRESA, como em `posto_rateio.ordem`). Reimplementar a
// cascata aqui faria o mesmo cadastro produzir dois resultados diferentes.
//
// ⚠⚠ A FILIAL NÃO ACOMPANHA O RATEIO — fica a da origem, mesmo quando a
// empresa muda. É o precedente do Aplicar do posto, e lá está medido: anular a
// filial deixou 8.064 células (R$ 8,4 mi) invisíveis para quem tem escopo de
// filial, porque a policy de leitura exige `filial_id IS NOT NULL`. A empresa
// de destino é recorte gerencial; quem contabilizou continua sendo a filial de
// origem.
// ============================================================

type Comb = { empresa_id: string; filial_id: string | null; cc_id: string | null }
type Props = {
  origem: Comb
  meses: Record<number, number>        // valor CRU do banco, por mês (1..12)
  linhaId: string; versaoId: string; ano: number
  fator: number
  empresas: any[]; filiais: any[]; ccs: any[]
  filialIds: string[] | null; ccIds: string[] | null
  onFechar: (mudou: boolean) => void
}

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = (v: number) => Math.round(v * 100) / 100
const chave = (c: Comb) => `${c.empresa_id}|${c.filial_id || ''}|${c.cc_id || ''}`

/** Distribui um valor por frações preservando o TOTAL ao centavo.
 *  ⚠ Arredondar cada parcela e somar NÃO fecha: 100,00 em três partes dá
 *  33,33×3 = 99,99. O resíduo vai para a MAIOR fração — maior parcela absorve
 *  o centavo com o menor erro relativo, e é determinístico (nada de sobra
 *  caindo num destino diferente a cada execução). */
function distribuir(total: number, pcts: number[]): number[] {
  const parts = pcts.map(p => r2(total * p))
  const resto = r2(total - r2(parts.reduce((a, b) => a + b, 0)))
  if (resto) {
    let i = 0
    for (let j = 1; j < pcts.length; j++) if (pcts[j] > pcts[i]) i = j
    parts[i] = r2(parts[i] + resto)
  }
  return parts
}

export default function RatearModal({ origem, meses, linhaId, versaoId, ano, fator,
                                      empresas, filiais, ccs, filialIds, ccIds, onFechar }: Props) {
  const acesso = useUserAccess()
  const mostrar = (v: number) => money(v * fator)
  const [cods, setCods] = useState<any[]>([])
  const [dest, setDest] = useState<Record<string, any[]>>({})
  const [codCc, setCodCc] = useState('')
  const [codEmp, setCodEmp] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aplicando, setAplicando] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const [r, d] = await Promise.all([
          supabase.from('rateio_regra').select('id,nome,dimensao').order('nome'),
          pageAll(() => supabase.from('rateio_destino').select('id,regra_id,empresa_id,cc_id,pct')),
        ])
        if (r.error) throw new Error(r.error.message)
        setCods(r.data || [])
        const by: Record<string, any[]> = {}
        for (const x of d as any[]) (by[x.regra_id] ||= []).push(x)
        setDest(by)
      } catch (e: any) { setErro(e?.message || String(e)) }
      finally { setCarregando(false) }
    })()
  }, [])

  const empNome = (id: string | null) => {
    const e = id ? empresas.find(x => x.id === id) : null
    return e ? `${e.codigo}${e.descricao ? ` · ${e.descricao}` : ''}` : (id ? 'empresa fora do seu acesso' : '—')
  }
  const ccNome = (id: string | null) => {
    const c = id ? ccs.find(x => x.id === id) : null
    return c ? `${c.codigo} · ${c.descricao || ''}` : (id ? 'CC fora do seu acesso' : '— sem CC —')
  }
  const filNome = origem.filial_id
    ? (filiais.find(f => f.id === origem.filial_id)?.codigo || '?') : 'sem filial'

  const porCc = cods.filter(c => c.dimensao === 'CC')
  const porEmp = cods.filter(c => c.dimensao === 'EMPRESA')

  // A ordem da cascata é a mesma do posto: CC primeiro, EMPRESA depois.
  const anexos = useMemo(() => [
    ...(codCc ? [{ regra_id: codCc, ordem: 1 }] : []),
    ...(codEmp ? [{ regra_id: codEmp, ordem: 2 }] : []),
  ], [codCc, codEmp])

  const { cells } = useMemo(
    () => cascataRateio({ empresa_id: origem.empresa_id, cc_id: origem.cc_id || null },
                        anexos, cods as any, dest as any),
    [anexos, cods, dest, origem])

  const totalOrigem = Object.values(meses).reduce((a, b) => a + b, 0)
  const somaPct = cells.reduce((s, c) => s + c.pct, 0)
  const pctOk = Math.abs(somaPct - 1) < 0.0001

  // Destinos finais no grão do fato: a filial é SEMPRE a da origem (ver topo).
  const destinos: { comb: Comb; pct: number }[] = cells.map(c => ({
    comb: { empresa_id: c.empresa_id!, filial_id: origem.filial_id, cc_id: c.cc_id || null },
    pct: c.pct,
  }))

  // ⚠ Três avisos, e nenhum é decorativo — cada um já foi um defeito no produto.
  const semAcesso = destinos.filter(d =>
    !acesso.canEdit('empresa', d.comb.empresa_id)
    || (d.comb.cc_id ? !acesso.canEdit('centro_custo', d.comb.cc_id) : false))
  const semCc = destinos.filter(d => !d.comb.cc_id)
  const foraDoFiltro = destinos.filter(d =>
    (ccIds && (!d.comb.cc_id || !ccIds.includes(d.comb.cc_id)))
    || (filialIds && (!d.comb.filial_id || !filialIds.includes(d.comb.filial_id))))

  const aplicar = async () => {
    if (!anexos.length || !pctOk || semAcesso.length) return
    setErro(''); setAplicando(true)
    try {
      const kOrigem = chave(origem)
      // Valor rateado por destino × mês.
      const alvo: Record<string, Record<number, number>> = {}
      for (const m of Object.keys(meses).map(Number)) {
        const v = meses[m]; if (!v) continue
        const partes = distribuir(v, destinos.map(d => d.pct))
        destinos.forEach((d, i) => {
          if (!partes[i]) return
          ;(alvo[chave(d.comb)] ||= {})[m] = r2((alvo[chave(d.comb)]?.[m] || 0) + partes[i])
        })
      }

      // ⚠ O QUE JÁ EXISTE NO DESTINO TEM DE SER LIDO DO BANCO, não da tela: com
      // filtro ativo o drill nem carregou as combinações de destino, e inserir
      // por cima de uma célula existente viola a chave única — o erro apareceria
      // no clique, depois de metade do rateio já ter sido gravada.
      // ⚠ A ORIGEM ENTRA NA CONSULTA mesmo não sendo destino. Rateando só por
      // EMPRESA para fora, a empresa de origem some da lista de destinos — e
      // sem ela aqui as linhas de origem não seriam lidas, logo não seriam
      // apagadas: o valor ficaria nos dois lugares, dobrando a linha.
      const empIds = [...new Set([origem.empresa_id, ...destinos.map(d => d.comb.empresa_id)])]
      const atuais = await pageAll(() => supabase.from('fat_orcado')
        .select('id,empresa_id,filial_id,cc_id,mes,valor,origem,dims')
        .eq('versao_id', versaoId).eq('ano', ano).eq('linha_id', linhaId)
        .in('empresa_id', empIds))
      const existente: Record<string, Record<number, { id: string; valor: number }>> = {}
      for (const r of atuais as any[]) {
        if (r.origem !== 'MANUAL') continue
        if (r.dims && Object.keys(r.dims).length) continue
        const k = chave({ empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: r.cc_id })
        if (k === kOrigem) continue      // a origem está sendo consumida
        ;(existente[k] ||= {})[r.mes] = { id: r.id, valor: Number(r.valor) || 0 }
      }

      // ⚠ ORDEM: destinos PRIMEIRO, origem por último. Falhando no meio, o valor
      // aparece duas vezes (total dobra, salta aos olhos, conserta-se) em vez de
      // sumir calado — que é o modo de falha caro. Operação não é atômica.
      const novas: any[] = []
      for (const k of Object.keys(alvo)) {
        if (k === kOrigem) continue
        const d = destinos.find(x => chave(x.comb) === k)!
        for (const m of Object.keys(alvo[k]).map(Number)) {
          const add = alvo[k][m]
          const ex = existente[k]?.[m]
          if (ex) {
            const { data, error } = await supabase.from('fat_orcado')
              .update({ valor: r2(ex.valor + add), expressao: null, origem: 'MANUAL' })
              .eq('id', ex.id).select('id')
            if (error) throw new Error(error.message)
            if (!data?.length) throw new Error('Destino fora do seu escopo de edição — rateio interrompido.')
          } else {
            novas.push({ tenant_id: TENANT_ID, versao_id: versaoId, linha_id: linhaId,
                         empresa_id: d.comb.empresa_id, filial_id: d.comb.filial_id, cc_id: d.comb.cc_id,
                         ano, mes: m, valor: add, expressao: null, origem: 'MANUAL', dims: {} })
          }
        }
      }
      for (let i = 0; i < novas.length; i += 200) {
        const { data, error } = await supabase.from('fat_orcado').insert(novas.slice(i, i + 200)).select('id')
        if (error) throw new Error(error.message)
        if ((data?.length || 0) !== novas.slice(i, i + 200).length)
          throw new Error('Nem todas as células de destino foram gravadas — confira antes de repetir.')
      }

      // A origem: vira a própria cota se for um dos destinos; some se não for.
      const ids = (atuais as any[]).filter(r =>
        chave({ empresa_id: r.empresa_id, filial_id: r.filial_id, cc_id: r.cc_id }) === kOrigem
        && r.origem === 'MANUAL' && (!r.dims || !Object.keys(r.dims).length)).map(r => r.id)
      const cota = alvo[kOrigem]
      if (cota) {
        for (const r of (atuais as any[])) {
          if (!ids.includes(r.id)) continue
          const v = cota[r.mes]
          if (v) await supabase.from('fat_orcado').update({ valor: v }).eq('id', r.id)
          else await supabase.from('fat_orcado').delete().eq('id', r.id)
        }
      } else if (ids.length) {
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await supabase.from('fat_orcado').delete().in('id', ids.slice(i, i + 200)).select('id')
          if (error) throw new Error(error.message)
        }
      }
      onFechar(true)
    } catch (e: any) { setErro(e?.message || String(e)); setAplicando(false) }
  }

  const sel: React.CSSProperties = { width: '100%', padding: '7px 9px', fontSize: 12.5, background: 'var(--bg)',
    color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 7 }
  const aviso = (cor: string) => ({ fontSize: 12, color: 'var(--text-mid)', background: `rgba(${cor},0.10)`,
    border: `1px solid rgba(${cor},0.35)`, borderRadius: 8, padding: '9px 11px', marginTop: 10, lineHeight: 1.6 })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 70, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: 18 }}
         onClick={() => onFechar(false)}>
      <div onClick={e => e.stopPropagation()}
           style={{ width: 'min(780px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                    background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '15px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Split size={15} style={{ color: 'var(--violet)' }} /> Ratear esta combinação
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              Origem <b>{empNome(origem.empresa_id)}</b> · {filNome} · {ccNome(origem.cc_id)}
              {' '}— total do ano <b style={{ color: 'var(--text)' }}>{mostrar(totalOrigem)}</b>
            </div>
          </div>
          <button onClick={() => onFechar(false)} style={{ background: 'none', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--muted)' }}><X size={13} /></button>
        </div>

        <div style={{ overflow: 'auto', padding: '14px 20px 18px' }}>
          {erro && <div style={{ fontSize: 12.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>{erro}</div>}
          {carregando ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Carregando os códigos…</div> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  Por centro de custo
                  <select value={codCc} onChange={e => setCodCc(e.target.value)} style={{ ...sel, marginTop: 4 }}>
                    <option value="">— não ratear por CC —</option>
                    {porCc.map(c => <option key={c.id} value={c.id}>{c.nome} ({(dest[c.id] || []).length})</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  Por empresa
                  <select value={codEmp} onChange={e => setCodEmp(e.target.value)} style={{ ...sel, marginTop: 4 }}>
                    <option value="">— não ratear por empresa —</option>
                    {porEmp.map(c => <option key={c.id} value={c.id}>{c.nome} ({(dest[c.id] || []).length})</option>)}
                  </select>
                </label>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 7, lineHeight: 1.6 }}>
                Um código de <b>CC</b> troca o centro de custo e mantém a empresa; um de <b>empresa</b> faz o
                contrário. Escolhendo os dois, o segundo se aplica sobre o resultado do primeiro — a mesma
                cascata do rateio de posto. A <b>filial continua a da origem</b>: ela é contábil e não acompanha
                o rateio.
              </div>

              {anexos.length > 0 && (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 14 }}>
                    <thead><tr>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>Destino</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>%</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>Ano</th>
                    </tr></thead>
                    <tbody>
                      {destinos.map((d, i) => {
                        const fora = semAcesso.includes(d)
                        return (
                          <tr key={i}>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--panel-2)', color: fora ? 'var(--red)' : 'var(--text)' }}>
                              {empNome(d.comb.empresa_id)} · {filNome} · {ccNome(d.comb.cc_id)}
                            </td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--panel-2)', textAlign: 'right', color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums' }}>{(d.pct * 100).toFixed(2)}</td>
                            <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--panel-2)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{mostrar(r2(totalOrigem * d.pct))}</td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--text)' }}>Total</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: pctOk ? 'var(--text)' : 'var(--red)' }}>{(somaPct * 100).toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{mostrar(totalOrigem)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {!pctOk && <div style={aviso('248,113,113')}>
                    <b>Os destinos não somam 100%.</b> O cadastro do código está incompleto — rateá-lo aqui
                    mudaria o total da linha. Ajuste em <b>Postos → Rateio</b>.
                  </div>}
                  {semAcesso.length > 0 && <div style={aviso('248,113,113')}>
                    <b>{semAcesso.length} destino(s) fora do seu escopo de edição</b> (em vermelho). O banco
                    recusaria a gravação no meio do rateio, então ela nem começa.
                  </div>}
                  {semCc.length > 0 && <div style={aviso('251,146,60')}>
                    <AlertTriangle size={12} style={{ verticalAlign: -1 }} />{' '}
                    <b>{semCc.length} destino(s) sem centro de custo.</b> O valor vira lançamento
                    <b> consolidado</b>, que soma junto com o detalhado por CC e é a origem do grão misto.
                    Só é o certo se esta linha não é orçada por CC.
                  </div>}
                  {foraDoFiltro.length > 0 && <div style={aviso('139,92,246')}>
                    <b>{foraDoFiltro.length} destino(s) estão fora do filtro da tela.</b> O valor vai para lá
                    de verdade, mas <b>some desta tabela</b> ao recarregar — e o total da linha cai sem que
                    nada tenha se perdido.
                  </div>}

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button onClick={aplicar} disabled={aplicando || !pctOk || !!semAcesso.length || !totalOrigem}
                      style={{ padding: '8px 14px', fontSize: 12.5, borderRadius: 7, border: 'none', cursor: 'pointer',
                               background: 'var(--violet)', color: '#fff',
                               opacity: aplicando || !pctOk || semAcesso.length || !totalOrigem ? 0.55 : 1 }}>
                      {aplicando ? 'Rateando…' : `Ratear em ${destinos.length} destino(s)`}
                    </button>
                    <button onClick={() => onFechar(false)} disabled={aplicando}
                      style={{ padding: '8px 14px', fontSize: 12.5, borderRadius: 7, cursor: 'pointer',
                               background: 'none', color: 'var(--text-mid)', border: '1px solid var(--border-strong)' }}>
                      Cancelar
                    </button>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
                    Os 12 meses são rateados <b>um a um</b>, e o centavo que sobra do arredondamento vai para a
                    maior cota — o total do ano não muda. Destino que já tenha valor manual <b>recebe a soma</b>,
                    não é substituído. A combinação de origem some (ou fica só com a cota dela, se for um dos
                    destinos). <b>Não há desfazer.</b>
                  </p>
                </>
              )}
            </>
          )}
          {!carregando && !anexos.length && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14 }}>
              Escolha ao menos um código para ver os destinos. Os códigos são os mesmos de
              <b> Postos → Rateio</b> — cadastre lá, use aqui.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
