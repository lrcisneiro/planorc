// ============================================================
// Os dois RANKINGS da análise: "O que mudou" (por linha) e "Quem causou a
// variação" (por empresa · área · divisão · BU · CC).
//
// Saíram de `OrcamentoDashPage` em 23/nov para o acompanhamento montá-los
// também — a mesma viagem que a Ponte fez um dia antes, e pela mesma razão:
// eles já recebiam `origem`/`destino` e não sabiam qual lado era o orçado.
//
// ⚠ `S` é prop OPCIONAL, com `S_PONTE` de fallback: componente preso ao objeto
// de estilo de UMA tela não é montável em outra.
// ⚠ O CORTE EM NÍVEL (`useCorte`) é compartilhado pelos dois de propósito —
// ranking de itens que se contêm é dupla contagem por construção, e duas
// cópias da regra deixariam um dos dois contando duas vezes na primeira
// alteração.
// ============================================================
import { useEffect, useMemo, useState, Fragment } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { downloadSheet } from './planilha'
import { grupoDominado } from './discricao'
import { type LinhaRel } from './refRelatorio'
import { computeTotais, pkey, type Computed, type LinhaCalc, type Periodo } from './engine'
import { type CC } from '../pages/dashboard/DashFiltros'
import { Grupo, profDe, ABAS, NATS, NIVEIS, S_PONTE } from './Ponte'

const fmt = (n: number, casas = 0) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—')

export type SecCfg = { sel: string[]; pct: number; minPctTotal: number; resultado?: string }
/** dimValor → master → { b: analisado, c: comparado } */
export type LadoPorMaster = Record<string, Record<string, { b: number; c: number }>>
export type DimBruto = { emp: LadoPorMaster; cc: LadoPorMaster }
export const SEC_PADRAO: SecCfg = { sel: [], pct: 10, minPctTotal: 0.5 }

/** Coluna da `Tabela` — veio junto com ela: tipo que só a Tabela usa não
 *  pertence à página. */
export type Col = {
  key: string; label: string; num?: boolean
  render?: (r: any) => any
  bruto?: (r: any) => any
}


export function Tabela({ S, cols, rows, arquivo, rodape, maxH = 430 }: {
  S: any; cols: Col[]; rows: any[]; arquivo: string; rodape?: any; maxH?: number
}) {
  const [ord, setOrd] = useState<{ k: string; dir: 1 | -1 } | null>(null)
  const bruto = (c: Col, r: any) => (c.bruto ? c.bruto(r) : r[c.key])
  const linhas = useMemo(() => {
    if (!ord) return rows
    const c = cols.find(x => x.key === ord.k)
    if (!c) return rows
    return [...rows].sort((a, b) => {
      const va = bruto(c, a), vb = bruto(c, b)
      if (c.num) return ((Number(va) || 0) - (Number(vb) || 0)) * ord.dir
      return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR') * ord.dir
    })
  }, [rows, ord, cols])

  const exportar = () => downloadSheet(`${arquivo}.xlsx`,
    [cols.map(c => c.label), ...linhas.map(r => cols.map(c => bruto(c, r)))])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }} data-noexport>
        <button onClick={exportar} title="Baixar esta tabela como planilha"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: 11.5, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text-mid)', cursor: 'pointer' }}>
          <Download size={12} /> planilha
        </button>
      </div>
      <div style={{ maxHeight: maxH, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {cols.map(c => {
                const ativo = ord?.k === c.key
                return (
                  <th key={c.key} onClick={() => setOrd(o => o?.k === c.key ? (o.dir === -1 ? { k: c.key, dir: 1 } : null) : { k: c.key, dir: -1 })}
                    title="Clique para ordenar"
                    style={{ ...S.th, textAlign: c.num ? 'right' : 'left', cursor: 'pointer', userSelect: 'none',
                             position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1,
                             color: ativo ? 'var(--violet)' : undefined }}>
                    {c.label}
                    {ativo && (ord!.dir === -1 ? <ChevronDown size={11} style={{ verticalAlign: -1 }} /> : <ChevronUp size={11} style={{ verticalAlign: -1 }} />)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((r, i) => (
              <tr key={r.id ?? i} style={r._fraco ? { opacity: .62 } : undefined}>
                {cols.map(c => (
                  <td key={c.key} style={{ ...S.td, textAlign: c.num ? 'right' : 'left', fontFamily: c.num ? 'monospace' : 'inherit' }}>
                    {c.render ? c.render(r) : bruto(c, r)}
                  </td>
                ))}
              </tr>
            ))}
            {rodape}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Um CORTE da árvore que é uma PARTIÇÃO: nada se repete, nada se perde.
 *
 *  ⚠⚠ É o que torna um ranking somável. "O que mudou" misturava níveis, então
 *  `Despesas` e `Despesas com Pessoal` apareciam na mesma lista e o leitor
 *  somava o mesmo dinheiro duas vezes sem perceber. Numa PONTE o problema é
 *  o mesmo e o resíduo denuncia; num RANKING não há resíduo que denuncie.
 *
 *  O corte no nível N são as linhas de profundidade N **mais as folhas acima
 *  dele** — sem as folhas, dinheiro de um ramo curto sumiria da lista.
 *  `'folhas'` é o grão de lançamento, qualquer que seja a profundidade.
 *
 *  ⚠ A profundidade sai do `pai_id`, nunca da coluna `nivel`: ela é **1 em
 *  todas as 170 linhas** desta DRE — não é mantida.
 */
/** Grupo de botões segmentado — UM componente para os dois cartões.
 *  ⚠ Existe para a ponte e o "O que mudou" não divergirem visualmente na
 *  primeira alteração. O que difere entre eles é o SIGNIFICADO do nível
 *  (cumulativo × partição), e isso se explica no texto de cada cartão, não
 *  na aparência do botão. */

// ⚠⚠ O CORTE É COMPARTILHADO por *O que mudou* e *Acurácia*, e não por economia
// de linhas: os dois são RANKINGS, e ranking de itens que se contêm é dupla
// contagem por construção (`Despesas` junto com `Despesas com Pessoal`). A
// regra que evita isso é uma partição em nível — se cada cartão tivesse a sua
// cópia, a primeira alteração deixaria um dos dois contando duas vezes, em
// silêncio. A *ponte* fica fora: lá o nível é cumulativo e o resíduo denuncia.
export function useCorte(linhas: LinhaRel[], aba: string, nivel: number | 'folhas', nat: string) {
  // Natureza EFETIVA: a própria, ou herdada do pai — a mesma regra de
  // `fatorExibicao`. `NEUTRO` não interrompe a herança; ausência de natureza
  // em toda a cadeia é que faz a linha ser neutra de verdade.
  const natEf = useMemo(() => {
    const byId: Record<string, LinhaRel> = Object.fromEntries(linhas.map(l => [l.id, l]))
    const f = (id: string | null): string | null => {
      if (!id) return null
      const l = byId[id]; if (!l) return null
      return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : f(l.pai_id)
    }
    return f
  }, [linhas])

  const ehInd = useMemo(() => {
    const t: Record<string, string> = Object.fromEntries(linhas.map(l => [l.id, l.tipo_linha || '']))
    return (id: string) => t[id] === 'INDICADOR'
  }, [linhas])

  // ⚠ Indicador NÃO entra no corte de nível: os 23 desta DRE são todos nível 1,
  // então o botão não os afeta — e ali o recorte é a própria aba.
  const conjunto = useMemo(() => aba === 'INDIC'
    ? linhas.filter(l => l.tipo_linha === 'INDICADOR' && !l.desativada).map(l => l.id)
    : particaoNivel(linhas, nivel)
        .filter(id => !ehInd(id))
        // ⚠ Só recorta quando se PEDE. "Todas" inclui as neutras — e elas não
        // são sobra: no nível 1 são `Impostos s/ faturamento`, `Resultado
        // Financeiro`, `Impostos sobre o Resultado`, `Receita Liquida`.
        // Dinheiro de verdade que uma pílula de dois estados esconderia.
        .filter(id => nat === 'TODAS' || natEf(id) === nat),
    [linhas, aba, nivel, nat, natEf, ehInd])

  // Quantas ficam de fora pelo recorte de natureza — para a tela dizer, em vez
  // de a lista simplesmente encolher.
  const foraPorNat = useMemo(() => {
    if (aba === 'INDIC' || nat === 'TODAS') return 0
    return particaoNivel(linhas, nivel).filter(id => !ehInd(id) && natEf(id) !== nat).length
  }, [linhas, aba, nivel, nat, natEf, ehInd])

  return { conjunto, foraPorNat }
}

/** A barra de seletores dos dois rankings. Uma só, para não divergirem. */
export function BarraCorte({ S, aba, setAba, nivel, setNivel, nat, setNat, cfg, setCfg, n }: any) {
  const inp = { width: 46, padding: '3px 5px', fontSize: 11.5, background: 'var(--bg)',
                color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6 }
  return (
    <div style={S.secBarra} data-noexport>
      <Grupo opcoes={ABAS} valor={aba} onPick={setAba} />
      {/* ⚠ Nível e natureza só na aba Linhas: os 23 indicadores são todos nível
          1 (o botão não mudaria nada) e 20 deles são neutros ("Receita" daria
          lista vazia). Controle morto ensina que a tela às vezes não responde. */}
      {aba === 'LINHA' && <Grupo rotulo="nível" valor={nivel} onPick={setNivel} opcoes={NIVEIS} />}
      {aba === 'LINHA' && <Grupo opcoes={NATS} valor={nat} onPick={setNat} />}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
        ≥<input type="number" step="1" min={0} value={cfg.pct}
          onChange={e => setCfg({ ...cfg, pct: Number(e.target.value) })} style={inp} />%
        e ≥<input type="number" step="0.1" min={0} value={cfg.minPctTotal}
          onChange={e => setCfg({ ...cfg, minPctTotal: Number(e.target.value) })} style={inp} />% do total
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{n} linha(s)</span>
    </div>
  )
}

/** Mantém `cfg.sel` igual ao conjunto calculado. `cfg` fora das dependências:
 *  ele muda a cada `setCfg` e o efeito voltaria a disparar — laço. */
export function useSincronizaSel(cfg: SecCfg, setCfg: (c: SecCfg) => void, conjunto: string[]) {
  useEffect(() => {
    if ([...cfg.sel].sort().join(',') !== [...conjunto].sort().join(',')) setCfg({ ...cfg, sel: conjunto })
  }, [conjunto]) // eslint-disable-line
}

export function particaoNivel(linhas: LinhaRel[], nivel: number | 'folhas'): string[] {
  const temFilha = new Set(linhas.map(l => l.pai_id).filter(Boolean) as string[])
  const prof = profDe(linhas)
  return linhas
    .filter(l => !l.desativada)
    .filter(l => nivel === 'folhas' ? !temFilha.has(l.id)
                                    : prof(l) === nivel || (prof(l) < nivel && !temFilha.has(l.id)))
    .map(l => l.id)
}


// ── 1b · QUEM CAUSOU A VARIAÇÃO ─────────────────────────────
// A PONTE VISTA PELO OUTRO EIXO. A ponte decompõe o Δ por LINHA; este quadro
// decompõe **o mesmo Δ** por empresa, área, divisão, BU ou centro de custo.
// Mesma linha de resultado, mesmo total — dois cortes do mesmo número.
//
// POR QUE EXISTE: hoje responder "qual área estourou?" é marcar a área no
// filtro, ler, desmarcar, marcar a próxima. Cinco gestos por área e nenhuma
// comparação lado a lado — quem desiste no meio fica com metade da resposta.
//
// ⚠⚠ O MOTOR RODA POR DIMENSÃO, não se soma o agregado. A linha de resultado
// costuma ser FÓRMULA ou subtotal; somar `orcado` das folhas daria um número
// que não existe na DRE. Mesma razão e mesma mecânica do gráfico por empresa.
const DIMS_QUEM = [
  ['emp', 'Empresa'], ['area', 'Área'], ['divisao', 'Divisão'], ['bu', 'BU'], ['cc', 'Centro de custo'],
] as const
export type DimQuem = typeof DIMS_QUEM[number][0]
const MAX_QUEM = 12

export function QuemCausou({ S: Sx, linhas, nome, bruto, empresas, ccs, resId, componentes, invertido,
                      rotOrigem, rotDestino, dTotal, dim, setDim, ano, restritos }: any) {
  const S = Sx || S_PONTE
  const [aberta, setAberta] = useState<string | null>(null)
  // Três cliques: desc → asc → volta ao impacto (o default). Sem o terceiro
  // estado não há como desfazer a ordenação sem recarregar a tela.
  const [ordQ, setOrdQ] = useState<{ k: string; dir: 1 | -1 } | null>(null)
  const thOrd = (k: string, label: string, esq = false) => {
    const ativo = ordQ?.k === k
    return (
      <th onClick={() => setOrdQ(o => o?.k === k ? (o.dir === -1 ? { k, dir: 1 } : null) : { k, dir: -1 })}
        title="Clique para ordenar — o terceiro clique volta à ordem por impacto"
        style={{ ...S.th, textAlign: esq ? 'left' : 'right', cursor: 'pointer', userSelect: 'none',
                 color: ativo ? 'var(--violet)' : undefined }}>
        {label}
        {ativo && (ordQ!.dir === -1 ? <ChevronDown size={11} style={{ verticalAlign: -1 }} /> : <ChevronUp size={11} style={{ verticalAlign: -1 }} />)}
      </th>
    )
  }

  // Agrupa o bruto (empresa_id / cc_id) na dimensão pedida. Empresa e CC são
  // chaves diretas; área, divisão e BU são ATRIBUTOS do CC — é por isso que os
  // três saem da mesma leitura e trocar entre eles não custa consulta.
  const grupos = useMemo(() => {
    const out: Record<string, Record<string, { b: number; c: number }>> = {}
    const ocultos: string[] = []
    let ocultosCc = 0
    const junta = (k: string, m: Record<string, { b: number; c: number }>) => {
      const alvo = (out[k] = out[k] || {})
      for (const master in m) {
        const cel = (alvo[master] = alvo[master] || { b: 0, c: 0 })
        cel.b += m[master].b; cel.c += m[master].c
      }
    }
    if (dim === 'emp') {
      const nomeEmp: Record<string, string> = {}
      ;(empresas as any[]).forEach(e => { nomeEmp[e.id] = `${e.codigo} · ${e.descricao}` })
      // ⚠ Empresa não é recortável por CC restrito: o restrito é um atributo do
      // CC e a leitura por empresa não o carrega. Fica declarado — por empresa
      // o grão não é o que se quer esconder.
      for (const id in bruto.emp) junta(nomeEmp[id] || '(empresa desconhecida)', bruto.emp[id])
    } else {
      const ccById: Record<string, CC> = Object.fromEntries((ccs as CC[]).map(c => [c.id, c]))
      // ⚠ "(sem …)" NÃO É DESCARTE. São as células de grão consolidado — cc
      // nulo —, e omiti-las faria a soma das áreas não bater com o total: o
      // quadro encolheria sem dizer por quê, que é a pior forma de errar.
      const rot = (ccId: string) => {
        const c = ccId === '__sem' ? null : ccById[ccId]
        if (!c) return '(sem centro de custo)'
        if (dim === 'cc') return `${c.codigo} · ${c.descricao}`
        const n = dim === 'area' ? c.area_nome : dim === 'divisao' ? c.divisao_nome : c.bu_nome
        return n || `(sem ${dim === 'area' ? 'área' : dim === 'divisao' ? 'divisão' : 'BU'})`
      }
      // ⚠⚠ MODO DISCRETO. No grão de CC o restrito cai direto em "Outros".
      // Nas dimensões agregadas (área/divisão/BU) vale a REGRA DE DOMINÂNCIA
      // (ver `discricao.ts`): o grupo é mascarado quando os restritos
      // respondem por 80%+ do valor dele. Exigir 100% deixou a área 4
      // "Diretoria" à vista por causa de R$ 66.955 num CC legado.
      const r: Set<string> = restritos || new Set()
      const peso: Record<string, Record<string, number>> = {}   // label → ccId → |valor|
      for (const id in bruto.cc) {
        // No grão de CC o restrito nem entra: não há grupo a mascarar, há
        // linha a não desenhar.
        if (dim === 'cc' && r.has(id)) { ocultosCc++; continue }
        const lbl = rot(id)
        junta(lbl, bruto.cc[id])
        if (r.size) {
          let p = 0
          for (const m in bruto.cc[id]) p += Math.abs(bruto.cc[id][m].b) + Math.abs(bruto.cc[id][m].c)
          ;(peso[lbl] = peso[lbl] || {})[id] = (peso[lbl][id] || 0) + p
        }
      }
      // ⚠⚠ O GRUPO MASCARADO SOME — não vira um balde "Outros". Com um grupo
      // só mascarado, o balde **É** o valor restrito: escondê-lo numa linha
      // chamada "Outros" é publicá-lo com outro nome. (Decisão do Ricardo,
      // 24/nov, vendo a tela.)
      if (r.size && dim !== 'cc') {
        for (const lbl in peso) {
          if (!grupoDominado(peso[lbl], r)) continue
          delete out[lbl]; ocultos.push(lbl)
        }
      }
    }
    return { out, ocultos: ocultos.length + ocultosCc }
  }, [bruto, dim, empresas, ccs, restritos])

  // Roda o motor dentro de cada grupo e devolve o total da linha de resultado
  // e o de cada componente — os mesmos componentes da ponte, para o detalhe de
  // uma área ser literalmente "a ponte daquela área".
  const linhasQ = useMemo(() => {
    if (!resId) return []
    const rlOf: Record<string, string> = {}
    linhas.forEach((l: LinhaRel) => { if (l.linha_orc_id && !l.nao_soma) rlOf[l.linha_orc_id] = l.id })
    const calc: LinhaCalc[] = linhas.map((l: LinhaRel) => ({ id: l.id, pai_id: l.pai_id, codigo: l.codigo, tipo_linha: l.tipo_linha, expressao: l.expressao, desativada: l.desativada, nao_soma: l.nao_soma }))
    const PER: Periodo = { ano: ano || 1, mes: 1 }; const K = pkey(PER)
    const totaisDe = (lado: 'b' | 'c', m: Record<string, { b: number; c: number }>) => {
      const computed: Computed = {}; calc.forEach(l => { computed[l.id] = {} })
      for (const master in m) { const rl = rlOf[master]; if (rl) computed[rl][K] = m[master][lado] }
      return computeTotais(calc, computed, [PER])
    }
    return Object.entries(grupos.out).map(([k, m]) => {
      const tb = totaisDe('b', m), tc = totaisDe('c', m)
      // `invertido` = o cabeçalho pediu analisado → comparado. Origem e destino
      // só existem como leitura; o dado continua sendo "analisado" e "comparado".
      const o = (id: string) => (invertido ? tb[id] : tc[id]) || 0
      const d = (id: string) => (invertido ? tc[id] : tb[id]) || 0
      return {
        k, origem: o(resId), destino: d(resId), delta: d(resId) - o(resId),
        partes: (componentes as string[]).filter(id => id !== resId)
          .map(id => ({ id, nome: nome(id), delta: d(id) - o(id) }))
          .filter(x => Math.abs(x.delta) > 0.005)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      }
    }).filter(x => Math.abs(x.delta) > 0.005 || Math.abs(x.origem) > 0.005)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }, [grupos, linhas, resId, componentes, invertido, nome, ano])

  // ⚠⚠ ASSIMETRIA DE ATRIBUIÇÃO — medida, não suposta. Na DRE Gerencial de
  // 2026: **100% do orçado tem centro de custo e só 82% do realizado tem**
  // (18,2%, R$ 22 mi de 120,6 mi, são lançamentos do razão sem CC). Sem avisar,
  // a leitura por área sai assim: TODA área parece ter economizado, e o grupo
  // "(sem centro de custo)" aparece com orçado zero e um realizado enorme —
  // cada número está certo e a conclusão é falsa.
  // ⚠ Não é chute nem constante: sai do próprio bruto, em magnitude, então
  // acompanha o relatório, o período e o filtro de quem está olhando. Por
  // empresa não existe (empresa é NOT NULL nos dois fatos: 0 nulos medidos).
  const atribuicao = useMemo(() => {
    if (dim === 'emp') return null
    let bT = 0, cT = 0, bS = 0, cS = 0
    for (const id in bruto.cc) {
      const sem = id === '__sem' || !(ccs as CC[]).some(c => c.id === id)
      for (const master in bruto.cc[id]) {
        const { b, c } = bruto.cc[id][master]
        bT += Math.abs(b); cT += Math.abs(c)
        if (sem) { bS += Math.abs(b); cS += Math.abs(c) }
      }
    }
    if (!bT || !cT) return null
    const pb = (bS / bT) * 100, pc = (cS / cT) * 100
    // Dois pontos percentuais de diferença já bastam: abaixo disso o efeito
    // some no arredondamento das próprias linhas.
    return Math.abs(pb - pc) >= 2 ? { pb, pc } : null
  }, [bruto, dim, ccs])

  const somaDim = linhasQ.reduce((s: number, x: any) => s + x.delta, 0)
  // ⚠⚠ O RESÍDUO É A MESMA HONESTIDADE DA PONTE. A soma das dimensões pode não
  // fechar com o Δ do cabeçalho por três causas conhecidas: linha com
  // `filtro_escopo` próprio (o agregado por dimensão não o aplica), projeção
  // ligada (o quadro lê só o período real) e recorte de empresa entre as duas
  // RPCs. Mostrar sem o resíduo seria afirmar que tudo foi atribuído.
  // ⚠⚠ REMOVER O GRUPO NÃO BASTA: o resíduo o MOSTRARIA DE VOLTA. "não
  // atribuído a nenhum grupo" é `dTotal − soma dos grupos`, e com o grupo
  // oculto fora da soma o Δ dele reapareceria ali com outro nome. Por isso,
  // quando há oculto, o total exibido passa a ser o **dos grupos listados** e
  // o quadro diz isso — um total que não é o Δ da ponte, declarado, é melhor
  // que um resíduo que entrega o número.
  const temOculto = (grupos.ocultos || 0) > 0
  const totalExib = temOculto ? somaDim : (dTotal || 0)
  const naoAtrib = totalExib - somaDim
  const temResid = !temOculto && Math.abs(naoAtrib) > Math.max(1, Math.abs(dTotal || 0) * 0.005)
  // ⚠⚠ A SELEÇÃO DOS 12 CONTINUA POR IMPACTO; a ordenação só reordena ESSES.
  // Ordenar antes de cortar mudaria o significado de "outros": por nome, os 12
  // primeiros seriam os alfabéticos e "outros" viraria uma sobra arbitrária —
  // o quadro passaria a esconder as áreas que mais mexeram no resultado
  // justamente quando se ordena por outra coluna.
  const top = linhasQ.slice(0, MAX_QUEM)
  const resto = linhasQ.slice(MAX_QUEM)
  const mostra = useMemo(() => {
    if (!ordQ) return top
    const val = (x: any) => ordQ.k === 'k' ? x.k
      : ordQ.k === 'origem' ? x.origem : ordQ.k === 'destino' ? x.destino : x.delta
    return [...top].sort((a, b) => {
      const va = val(a), vb = val(b)
      return typeof va === 'string'
        ? String(va).localeCompare(String(vb), 'pt-BR') * ordQ.dir
        : ((Number(va) || 0) - (Number(vb) || 0)) * ordQ.dir
    })
  }, [top, ordQ])
  const somaResto = resto.reduce((s: number, x: any) => s + x.delta, 0)

  return (
    <div style={S.sec}>
      <div>
        <div><div style={S.secT}>Quem causou a variação</div>
          <div style={S.secD}>
            O <strong>mesmo Δ da ponte</strong>, decomposto pelo outro eixo: em vez de por linha,
            por empresa ou área. A linha de resultado é a que está selecionada na ponte — descer
            lá move este quadro junto. Clique numa linha para ver <em>o que</em> mudou ali.
            {' '}⚠ <strong>(sem centro de custo)</strong> reúne o que não tem onde cair; entra na
            lista para a soma fechar, em vez de encolher o quadro em silêncio.
          </div></div>
        <div style={S.secBarra} data-noexport>
          <Grupo opcoes={DIMS_QUEM} valor={dim} onPick={setDim} />
          <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {linhasQ.length} {dim === 'emp' ? 'empresa(s)' : dim === 'cc' ? 'centro(s)' : 'grupo(s)'}
            {/* ⚠ O corte é DITO, e sem o valor: quantos ficaram de fora, nunca
                quanto somam. Quadro que encolhe calado faz quem confere
                procurar o grupo que sumiu. */}
            {temOculto && <span style={{ color: 'var(--violet)', marginLeft: 6 }}
              title="Modo discreto: grupos dominados por centro de custo restrito não são listados, e o total acima é o dos grupos listados.">
              · {grupos.ocultos} não detalhado(s)</span>}
          </span>
        </div>
      </div>
      {atribuicao && (
        <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 10, lineHeight: 1.6 }}>
          ⚠⚠ <strong>Os dois lados não estão igualmente atribuídos.</strong>{' '}
          <b>{rotOrigem}</b> tem {(invertido ? atribuicao.pb : atribuicao.pc).toFixed(1)}% do valor
          sem centro de custo e <b>{rotDestino}</b> tem
          {' '}{(invertido ? atribuicao.pc : atribuicao.pb).toFixed(1)}%. O lado menos atribuído
          chega às áreas <strong>menor do que é</strong> — e o excedente aparece inteiro em
          <em> (sem centro de custo)</em>. Com isso, quase toda área tende a parecer que
          economizou. Compare as áreas <strong>entre si</strong>, não contra o orçado delas,
          enquanto a amarração de centro de custo do realizado não fechar.
          {' '}Para localizar a origem, troque para <strong>Empresa</strong>: ali os dois lados
          estão sempre atribuídos, e o buraco costuma estar concentrado numa delas.
        </div>
      )}
      {!resId ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Escolha a linha de resultado na ponte.</div>
       : !linhasQ.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sem movimento nesta dimensão.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {thOrd('k', String(DIMS_QUEM.find(d => d[0] === dim)?.[1] ?? ''), true)}
            {thOrd('origem', String(rotOrigem))}
            {thOrd('destino', String(rotDestino))}
            {thOrd('delta', 'efeito no resultado')}
            {/* ⚠ "% do Δ" não ordena por si: é o `delta` dividido por uma
                constante, então ordenar por ela dá exatamente a mesma ordem.
                Coluna clicável que repete outra ensina que o clique não faz
                nada. */}
            <th style={S.th}>% do Δ</th>
          </tr></thead>
          <tbody>
            {mostra.map((x: any) => (
              <Fragment key={x.k}>
                <tr onClick={() => setAberta(aberta === x.k ? null : x.k)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit' }}>
                    <span data-noexport style={{ color: 'var(--violet)', marginRight: 6 }}>{aberta === x.k ? '▾' : '▸'}</span>
                    {x.k}
                  </td>
                  <td style={S.td}>{fmt(x.origem)}</td>
                  <td style={S.td}>{fmt(x.destino)}</td>
                  <td style={{ ...S.td, color: x.delta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {x.delta >= 0 ? '+' : ''}{fmt(x.delta)}
                  </td>
                  <td style={{ ...S.td, color: 'var(--muted)' }}>
                    {dTotal ? `${Math.round((x.delta / dTotal) * 100)}%` : '—'}
                  </td>
                </tr>
                {aberta === x.k && (
                  x.partes.length ? x.partes.map((p: any) => (
                    <tr key={p.id}>
                      <td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', paddingLeft: 30, color: 'var(--muted)', fontSize: 12 }}>{p.nome}</td>
                      <td style={S.td} /><td style={S.td} />
                      <td style={{ ...S.td, fontSize: 12, color: p.delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {p.delta >= 0 ? '+' : ''}{fmt(p.delta)}
                      </td>
                      <td style={S.td} />
                    </tr>
                  )) : (
                    <tr><td colSpan={5} style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', paddingLeft: 30, color: 'var(--muted)', fontSize: 12 }}>
                      Sem componentes com variação aqui.</td></tr>
                  )
                )}
              </Fragment>
            ))}
            {resto.length > 0 && (
              <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--muted)', fontStyle: 'italic' }}>
                outros {resto.length}</td>
                <td style={S.td} /><td style={S.td} />
                <td style={{ ...S.td, color: 'var(--muted)' }}>{somaResto >= 0 ? '+' : ''}{fmt(somaResto)}</td>
                <td style={S.td} /></tr>
            )}
            {temResid && (
              <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--orange)' }}
                    title="Linha com filtro de escopo próprio, projeção ligada ou recorte de empresa — o agregado por dimensão não os reproduz.">
                não atribuído a nenhum grupo</td>
                <td style={S.td} /><td style={S.td} />
                <td style={{ ...S.td, color: 'var(--orange)' }}>{naoAtrib >= 0 ? '+' : ''}{fmt(naoAtrib)}</td>
                <td style={S.td} /></tr>
            )}
            <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>
              {temOculto ? `total dos grupos listados — ${nome(resId)}` : `total — ${nome(resId)}`}</td>
              <td style={S.td} /><td style={S.td} />
              <td style={{ ...S.td, fontWeight: 700 }}>{totalExib >= 0 ? '+' : ''}{fmt(totalExib)}</td>
              <td style={S.td} /></tr>
          </tbody>
        </table>
      )}
    </div>
  )
}


// ── 2 · VARIAÇÃO POR LINHA ──────────────────────────────────
// Limiar DUPLO: percentual E valor mínimo, juntos. 40% numa conta de R$ 800 é
// ruído; 3% na folha é a maior conversa do orçamento. Só o percentual enche a
// tela de bobagem; só o absoluto esconde a conta pequena que dobrou.
// ⚠ Mesma assinatura da Ponte: `origem`/`destino`, e quem decide é a página.
// O sentido vale para os DOIS — lá como narrativa, aqui como coluna e sinal.
export function Variacao({ S: Sx, cfg, setCfg, linhas, nome, origem, destino, val, fac, rotOrigem, rotDestino,
                    aba, setAba, nivel, setNivel, nat, setNat }: any) {
  const S = Sx || S_PONTE
  // ⚠⚠ O CONJUNTO VEM DO CORTE, não de escolha manual. Era a seleção livre que
  // deixava marcar `Despesas` junto com `Despesas com Pessoal` e produzir a
  // duplicata — num ranking, seleção à mão reintroduz exatamente o defeito.
  // `cfg.sel` continua sendo o armazenamento porque é ele que vai para o
  // preset do cartão; só deixou de ser digitado.
  const { conjunto, foraPorNat } = useCorte(linhas, aba, nivel, nat)
  useSincronizaSel(cfg, setCfg, conjunto)

  // O limiar foca a atenção; esconder o resto para sempre tira a conferência.
  const [todas, setTodas] = useState(false)
  // ⚠ O denominador do limiar é o DESTINO — o retrato final. No modo
  // Orçado × Orçado ele é o analisado, que é exatamente o que já era, então
  // trocar o sentido não remexe nos limiares de quem compara orçamentos.
  const total = cfg.sel.reduce((s: number, id: string) => s + Math.abs(val(destino, id)), 0)
  const minAbs = total * (cfg.minPctTotal / 100)
  // `b` = destino, `c` = origem: os nomes curtos ficaram, a semântica é a do
  // sentido escolhido no cabeçalho.
  const linhasCruas = cfg.sel.map((id: string) => {
    const b = val(destino, id), c = val(origem, id)
    return { id, nome: nome(id), b, c, d: b - c, pct: c !== 0 ? ((b - c) / Math.abs(c)) * 100 : (b !== 0 ? Infinity : 0) }
  })
  // ⚠ ZERO NOS DOIS PERÍODOS não é "variação pequena", é AUSÊNCIA de conteúdo:
  // a linha existe na estrutura e não foi orçada em nenhum dos lados. Com o
  // limiar em 0 — que é como se vê tudo — elas enchiam a lista e empurravam o
  // que importa para baixo. Sai sem perda: não há informação em 0 → 0.
  // ⚠ Epsilon e não `=== 0`: resíduo de arredondamento em fórmula não deve
  // ressuscitar uma linha vazia.
  const vazia = (x: any) => Math.abs(x.b) < 0.005 && Math.abs(x.c) < 0.005
  const nVazias = linhasCruas.filter(vazia).length
  const linhasTodas = linhasCruas.filter((x: any) => !vazia(x))
  // ⚠ A cor diz BOM ou RUIM, não positivo ou negativo. Numa despesa, cair é
  // bom: Custo Pessoas −9,8 mi pintado de vermelho lê ao contrário do que
  // aconteceu.
  //
  // `fac` serve aqui como SEMÂNTICA, não como sinal: fator −1 significa que a
  // linha é de natureza DESPESA (própria ou herdada do pai), ou seja, é custo.
  // E em custo o que é bom é ENCOLHER.
  //
  // Encolher é comparação de MAGNITUDE, de propósito. A primeira versão desta
  // regra olhava a direção do Δ, o que embute a suposição de que despesa está
  // guardada com valor negativo — e tem linha que não está: os INDICADOR de
  // Custo Pessoas e Folha montam o valor pela EXPRESSÃO, que devolve custo
  // positivo. Com a direção do Δ, a mesma linha dava vermelho nas DUAS
  // naturezas possíveis, porque regra e exibição concordavam entre si e
  // discordavam do dado. Magnitude não pergunta como o número foi guardado.
  //
  // As outras linhas — receita, e as neutras como EBITDA ou Resultado
  // Financeiro — não têm essa ambiguidade: valem mais quando sobem, e
  // `Resultado Financeiro` indo de −727 mil para −643 mil sobe de verdade.
  //
  // Limite conhecido: despesa que ATRAVESSA o zero no período (virar
  // recuperação) não é lida bem por magnitude. É patológico num custo e
  // preferível à suposição que já falhou.
  const ehCusto = (x: any) => fac?.(x.id) === -1
  const bom = (x: any) => (ehCusto(x) ? Math.abs(x.b) < Math.abs(x.c) : x.b > x.c)
  const marca = (x: any) => Math.abs(x.d) >= minAbs && (Math.abs(x.pct) >= cfg.pct || !Number.isFinite(x.pct))
  // ⚠⚠ INDICADOR ORDENA POR %, não por valor. Eles misturam unidades — `% EBITDA`
  // varia em pontos percentuais, `Custo Pessoas` em reais, `Receita por FTE` em
  // R$/FTE. Ordenar por variação absoluta compara grandezas diferentes e põe
  // sempre os de reais no topo, como se fossem os que mais mudaram.
  const ordem = aba === 'INDIC'
    ? (a: any, b: any) => (Number.isFinite(b.pct) ? Math.abs(b.pct) : Infinity) - (Number.isFinite(a.pct) ? Math.abs(a.pct) : Infinity)
    : (a: any, b: any) => Math.abs(b.d) - Math.abs(a.d)
  const destaque = linhasTodas.filter(marca).sort(ordem)
  const resto = linhasTodas.filter((x: any) => !marca(x))
  const somaResto = resto.reduce((s: number, x: any) => s + x.d, 0)
  const todas0 = linhasTodas.length

  return (
    <div style={S.sec}>
      <div>
        <div><div style={S.secT}>O que mudou</div>
          <div style={S.secD}>
            Ordenado por <strong>impacto</strong>, não por tamanho. Marcado o que passa de {cfg.pct}% <em>e</em> de {cfg.minPctTotal}% do total ({fmt(minAbs)}).
            {' '}<span style={{ color: 'var(--green)' }}>Verde</span> é melhora e <span style={{ color: 'var(--red)' }}>vermelho</span> é piora — numa despesa, cair é melhorar.
            {' '}⚠ Aqui o nível é um <strong>corte</strong>: <em>2</em> traz só o nível 2 e as folhas acima,
            nunca o nível 1 junto. É o que impede a lista de contar o mesmo dinheiro duas vezes —
            na <em>ponte</em> o mesmo botão é cumulativo.
            {' '}A variação é <strong>{rotDestino} − {rotOrigem}</strong>, no sentido escolhido no cabeçalho.
            {nVazias > 0 && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}· {nVazias} linha(s) zerada(s) nos dois períodos ficam de fora.
              </span>
            )}
            {foraPorNat > 0 && (
              <><br /><span style={{ color: 'var(--orange)' }}>
                {foraPorNat} linha(s) fora deste recorte de natureza — entre elas as <b>neutras</b>
                {' '}(impostos, resultado financeiro), que não são receita nem despesa na estrutura.
                {' '}Use <b>Todas</b> para vê-las.
              </span></>
            )}
            {resto.length > 0 && (
              <span data-noexport style={{ marginLeft: 8, color: 'var(--violet)', cursor: 'pointer' }} onClick={() => setTodas(v => !v)}>
                {todas ? `ver só as ${destaque.length} acima do limiar` : `mostrar todas as ${todas0} linhas`}
              </span>
            )}
          </div></div>
        <BarraCorte S={S} aba={aba} setAba={setAba} nivel={nivel} setNivel={setNivel}
          nat={nat} setNat={setNat} cfg={cfg} setCfg={setCfg} n={conjunto.length} />
      </div>
      <Tabela S={S} arquivo={`variacao-${rotDestino}`}
        rows={(todas ? [...destaque, ...resto.map((r: any) => ({ ...r, _fraco: true }))] : destaque)}
        cols={[
          { key: 'nome', label: 'linha' },
          { key: 'c', label: String(rotOrigem), num: true, render: (r: any) => fmt(r.c) },
          { key: 'b', label: String(rotDestino), num: true, render: (r: any) => fmt(r.b) },
          { key: 'd', label: 'variação', num: true,
            render: (r: any) => (
              <span style={{ color: r.d === 0 ? 'var(--muted)' : bom(r) ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}
                    title={r.d === 0 ? 'sem variação'
                      : `${bom(r) ? 'Melhora' : 'Piora'} o resultado · ${ehCusto(r) ? 'linha de despesa: vale pelo tamanho do custo, não pelo sinal' : 'vale mais quando sobe'}`}>
                {r.d >= 0 ? '+' : ''}{fmt(r.d)}
              </span>
            ) },
          { key: 'pct', label: '%', num: true, bruto: (r: any) => (Number.isFinite(r.pct) ? r.pct : null),
            render: (r: any) => <span style={{ color: 'var(--muted)' }}>{Number.isFinite(r.pct) ? fmtPct(r.pct) : 'novo'}</span> },
        ]}
        rodape={resto.length > 0 && !todas ? (
          <tr onClick={() => setTodas(true)} style={{ cursor: 'pointer' }} data-noexport>
            <td style={{ ...S.td, textAlign: 'left', color: 'var(--violet)', fontStyle: 'italic' }}>
              demais {resto.length} linha(s), abaixo do limiar — <strong>mostrar</strong></td>
            <td style={S.td} /><td style={S.td} />
            <td style={{ ...S.td, textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{somaResto >= 0 ? '+' : ''}{fmt(somaResto)}</td>
            <td style={S.td} />
          </tr>
        ) : null} />
    </div>
  )
}

