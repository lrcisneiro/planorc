// ============================================================
// Memória de cálculo de uma linha — a composição de UM número.
//
// ⚠⚠ NÃO É A PONTE, E A DIFERENÇA É A PERGUNTA. A ponte decompõe a VARIAÇÃO
// entre dois números ("por que saiu de 3,9 mi e chegou em 4,3 mi"); a memória
// decompõe o NÚMERO ("de que 4,3 mi é feito"). Quem quer conferir uma fórmula
// quer a segunda, e a primeira sempre exige um comparativo que pode nem existir.
//
// ⚠ As colunas vêm prontas da página (`cols`), já no escopo certo: linha com
// `filtro_escopo` precisa da ÁRVORE do escopo dela, senão os termos são de
// outro universo — é o mesmo cuidado da ponte, e a mesma fonte.
//
// ⚠⚠ SINAL ECONÔMICO CRU, como na ponte, e pela mesma razão: `fatorExibicao`
// mostra despesa positiva, e com ele `Receitas − Viagens` deixaria de fechar.
// Aqui a conta tem de bater LITERALMENTE, porque é isso que se foi conferir.
//
// ⚠ A substituição por valores é feita sobre os MESMOS tokens que mostram os
// nomes: uma só travessia da expressão, então as duas linhas não podem divergir.
// ============================================================
import { useState } from 'react'
import { formatValor } from './engine'
import { ModalPanel } from '../pages/dashboard/DashFiltros'

export type LinhaMem = {
  id: string; pai_id: string | null; codigo: string; descricao: string
  tipo_linha: any; expressao: string | null; desativada?: boolean
  nao_soma?: boolean; formato?: any; casas_decimais?: number; linha_orc_id?: string | null
}
// `cen` é opaco para este componente: ele só o devolve ao chamador no razão,
// que é quem sabe o que é um cenário nesta tela.
export type ColMem = { rot: string; val: Record<string, number>; cen?: string }

type Tok = { t: 'txt' | 'ref'; v: string }

/** Parte a expressão em texto × referências `[codigo]`, preservando a ordem.
 *  ⚠ Uma travessia só: nomes e valores saem destes mesmos tokens. */
export function tokensDe(expr: string): Tok[] {
  const out: Tok[] = []
  let buf = ''
  const s = expr.replace(/^=/, '')
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') {
      const fim = s.indexOf(']', i)
      if (fim < 0) { buf += s[i]; continue }
      if (buf) { out.push({ t: 'txt', v: buf }); buf = '' }
      out.push({ t: 'ref', v: s.slice(i + 1, fim) })
      i = fim
    } else buf += s[i]
  }
  if (buf) out.push({ t: 'txt', v: buf })
  return out
}

/** Os componentes de uma linha, pela MESMA regra do motor (`lib/engine.ts`).
 *  ⚠ Repetir o filtro do `SOMAR_FILHOS` aqui é deliberado e tem de andar com
 *  ele: memória que inclui linha que a soma ignora não é memória, é outra conta. */
export function componentesMem(l: LinhaMem | undefined, linhas: LinhaMem[]): LinhaMem[] {
  if (!l) return []
  if (l.tipo_linha === 'SOMAR_FILHOS') {
    return linhas.filter(c => c.pai_id === l.id && c.tipo_linha !== 'INDICADOR'
                           && c.tipo_linha !== 'ESPACO' && !c.desativada && !c.nao_soma)
  }
  if (!l.expressao) return []
  const codes = tokensDe(l.expressao).filter(t => t.t === 'ref').map(t => t.v)
  const vistos = new Set<string>()
  const out: LinhaMem[] = []
  for (const c of codes) {
    if (vistos.has(c)) continue
    vistos.add(c)
    const x = linhas.find(z => z.codigo === c)
    if (x) out.push(x)
  }
  return out
}

// ⚠ `v === 0` é true para **−0**, e é assim que o zero negativo morre aqui:
// `0 × -1` dá −0 e o pt-BR escreve "-0", que numa memória de cálculo parece
// defeito. Mesma armadilha já registrada no total do rateio.
const fmtL = (l: LinhaMem | undefined, v: number | undefined) =>
  v === undefined || !isFinite(v) ? '—'
    : formatValor(v === 0 ? 0 : v, l?.formato || 'NUMERO', l?.casas_decimais ?? (l?.formato === 'PERCENTUAL' ? 1 : 0))

/** O mesmo número, mas dentro da EXPRESSÃO.
 *  ⚠⚠ NEGATIVO VAI ENTRE PARÊNTESES, senão a substituição produz `+-379.650`
 *  e `--42.813` — sequências que ninguém lê como conta e que fazem a memória
 *  parecer quebrada justamente onde ela devia ser conferível. */
const fmtSub = (l: LinhaMem | undefined, v: number | undefined) => {
  if (v === undefined || !isFinite(v)) return '—'
  const s = fmtL(l, v)
  return v < 0 ? `(${s})` : s
}

// ── a expressão escrita, com nomes ou com valores no lugar das referências ──
function Expr({ l, linhas, col, ocultos }: { l: LinhaMem; linhas: LinhaMem[]; col?: ColMem; ocultos?: Set<string> }) {
  if (l.tipo_linha === 'SOMAR_FILHOS') {
    // ⚠ A expressão do subtotal é SINTETIZADA aqui (a linha não tem `expressao`),
    // então dá para omitir as filhas sem lançamento — `+ 0 + 0 + 0 + 0 + 0 + 0`
    // é ruído que empurra os números que importam para fora da vista.
    // ⚠⚠ Na FÓRMULA isso não vale: ali a expressão é TEXTO do cadastro e
    // apagar um termo dela seria mostrar uma fórmula que não é a da linha.
    const f = componentesMem(l, linhas).filter(c => !ocultos?.has(c.id))
    if (!f.length) return <em style={{ color: 'var(--muted)' }}>soma das filhas (nenhuma ativa)</em>
    return <>{f.map((c, i) => (
      <span key={c.id}>{i > 0 ? ' + ' : ''}
        <span style={{ color: col ? 'var(--text)' : 'var(--violet)' }}>{col ? fmtSub(c, col.val[c.id]) : c.descricao}</span>
      </span>
    ))}</>
  }
  if (!l.expressao) return <em style={{ color: 'var(--muted)' }}>vem do lançamento (não se decompõe)</em>
  return <>{tokensDe(l.expressao).map((t, i) => {
    if (t.t === 'txt') return <span key={i}>{t.v}</span>
    const x = linhas.find(z => z.codigo === t.v)
    const txt = col ? fmtSub(x, x ? col.val[x.id] : undefined) : (x?.descricao || t.v)
    return <span key={i} style={{ color: col ? 'var(--text)' : 'var(--violet)' }}>{txt}</span>
  })}</>
}

// ── uma linha de termo: NAVEGA para a memória dele, não expande inline ──
// ⚠⚠ EXPANDIR NÃO ERA ENTRAR. A primeira versão abria o termo ali mesmo, e
// mostrava só a fórmula dele COM NOMES — sem os valores substituídos nem o
// resultado, que é justamente o que faz a memória ser conferível. Quem
// procurou "a memória da fórmula de dentro" não a achou, porque ela não
// existia: existia um esboço dela. Aninhar o tratamento completo em vários
// níveis é ilegível; **navegar** entrega a peça inteira em cada nível.
function Termo({ l, linhas, col, onEntrar, onRazao }: {
  l: LinhaMem; linhas: LinhaMem[]; col: ColMem; onEntrar: (id: string) => void; onRazao?: () => void
}) {
  const desce = componentesMem(l, linhas).length > 0
  return (
    <tr style={{ borderTop: '1px solid var(--line)' }}>
      <td style={{ padding: '7px 8px 7px 0' }}>
        {/* ⚠ Termo que não se decompõe NÃO é clicável — oferecer e então
            recusar é o erro que esta base já evitou no `↳` da ponte. A ausência
            do botão já diz que a estrutura acaba ali e o número vem do fato. */}
        {desce ? (
          <button onClick={() => onEntrar(l.id)} title={`Abrir a memória de ${l.descricao}`}
            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--violet)',
                     font: 'inherit', textAlign: 'left', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
            {l.descricao} <span style={{ fontSize: 11 }}>↳</span>
          </button>
        ) : <span style={{ color: 'var(--text-mid)' }}>{l.descricao}</span>}
        {l.desativada && <span style={{ fontSize: 10.5, color: 'var(--orange)', marginLeft: 6 }}>desativada</span>}
      </td>
      {/* ⚠⚠ O RAZÃO FECHA A DESCIDA, e só na FOLHA: ali a estrutura acabou e
          o que há embaixo são os lançamentos. Nos níveis de cima o gesto é
          `↳`, descer — oferecer os dois na mesma linha faria a pessoa escolher
          entre duas coisas que ela ainda não sabe distinguir.
          ⚠ Mesma gramática da ponte: nome = descer, valor = razão. */}
      <td style={{ padding: '7px 0 7px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {!desce && onRazao ? (
          <button onClick={onRazao} title={`Abrir o razão de ${l.descricao}`}
            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
                     font: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
            {fmtL(l, col.val[l.id])}
          </button>
        ) : fmtL(l, col.val[l.id])}
      </td>
    </tr>
  )
}

export function MemoriaModal({ id, linhas, cols, onClose, nota, onRazao }: {
  id: string; linhas: LinhaMem[]; cols: ColMem[]; onClose: () => void; nota?: string
  onRazao?: (lineId: string, col: ColMem) => void
}) {
  // ⚠ A trilha vive AQUI: o modal não é desmontado por recarga nenhuma (os
  // valores já vieram prontos), então o estado local é seguro — ao contrário
  // da ponte, cuja trilha teve de subir para a página.
  // ⚠⚠ UMA COLUNA DE CADA VEZ. Orçado e realizado lado a lado viram duas
  // substituições longas na mesma tela, e a leitura é sequencial — "confiro
  // esta conta" —, não comparativa: comparar é o que a PONTE faz. Com as duas,
  // a pessoa perde a linha que estava seguindo no meio da expressão.
  const [ci, setCi] = useState(0)
  const [pilha, setPilha] = useState<string[]>([id])
  const atual = pilha[pilha.length - 1]
  const l = linhas.find(z => z.id === atual)
  const raiz = linhas.find(z => z.id === id)
  if (!l) return null
  const col = cols[Math.min(ci, cols.length - 1)] || { rot: '—', val: {} }
  const todos = componentesMem(l, linhas)
  // ⚠⚠ ZERO EM **TODAS** AS COLUNAS — some só a linha que não tem nada em
  // lugar nenhum. Decisão do Ricardo depois de ver as duas: esconder pela
  // coluna selecionada tirava da vista linha que **tem realizado e não tem
  // orçado**, e é justamente essa que interessa — o zero ali é informação
  // ("não foi orçado"), e a pílula é o que mostra o outro lado.
  // ⚠ Some quem não tem nem num nem noutro: aí o zero não informa nada,
  // é linha de estrutura que nunca recebeu lançamento.
  const ocultos = new Set(todos.filter(c => cols.every(x => !(x.val[c.id] || 0))).map(c => c.id))
  const filhos = todos.filter(c => !ocultos.has(c.id))
  return (
    <ModalPanel titulo={`Memória de cálculo · ${l.descricao}`} onClose={onClose} semAplicar
                width="min(820px, calc(100vw - 40px))">
      {/* ⚠ A trilha é o único caminho de volta, então ela mostra o percurso
          INTEIRO e cada degrau é clicável: com 3 ou 4 níveis, um "voltar" só
          obriga a refazer a descida para trocar de ramo. */}
      {pilha.length > 1 && (
        <div style={{ fontSize: 12, marginBottom: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          {pilha.map((pid, i) => {
            const nm = linhas.find(z => z.id === pid)?.descricao ?? '—'
            const ultimo = i === pilha.length - 1
            return (
              <span key={pid + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: 'var(--faint)' }}>›</span>}
                {ultimo ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{nm}</span> : (
                  <button onClick={() => setPilha(pilha.slice(0, i + 1))}
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'var(--violet)', font: 'inherit' }}>{nm}</button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {/* ⚠ Some sozinho com uma coluna só: pílula de uma opção é enfeite
          ocupando a linha mais visível — mesma regra do `PillsDim`. */}
      {cols.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {cols.map((c, i) => (
            <button key={c.rot + i} onClick={() => setCi(i)}
              style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                       border: `1px solid ${i === ci ? 'var(--violet)' : 'var(--border)'}`,
                       background: i === ci ? 'rgba(139,92,246,0.16)' : 'var(--panel)',
                       color: i === ci ? 'var(--violet)' : 'var(--text-mid)' }}>{c.rot}</button>
          ))}
        </div>
      )}
      {nota && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{nota}</div>}

      {!filhos.length ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Esta linha vem direto do lançamento — não há fórmula a abrir.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>A fórmula</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 14, wordBreak: 'break-word' }}>
            = <Expr l={l} linhas={linhas} ocultos={ocultos} />
          </div>

          {/* ⚠ UMA SUBSTITUIÇÃO POR COLUNA. É a memória propriamente dita: a
              mesma expressão com os números no lugar dos nomes, e o resultado
              embaixo — dá para conferir a conta à mão, que é o pedido. E ela
              se repete em CADA nível da navegação, que é o que faltava. */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{col.rot}</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>
              = <Expr l={l} linhas={linhas} col={col} ocultos={ocultos} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              = {fmtL(l, col.val[l.id])}
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '16px 0 2px' }}>Os termos</div>
          {/* ⚠ O corte é DITO. Lista que encolhe calada faz quem confere
              procurar a linha que sumiu — e aqui ela some por ser zero, não
              por erro. Mesma regra do teto de contas em Cadastros. */}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            ↳ entra na memória do próprio termo, quando ele também se decompõe.
            {onRazao && ' Clique no valor de uma folha para abrir o razão.'}
            {ocultos.size > 0 && <> · <strong>{ocultos.size}</strong> linha(s) sem lançamento em
              coluna nenhuma ocultada(s); o <strong>0</strong> que fica significa que aquela linha
              tem valor na outra coluna.</>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  <th style={{ textAlign: 'left', padding: '0 8px 6px 0', fontWeight: 600 }}>Linha</th>
                  <th style={{ textAlign: 'right', padding: '0 0 6px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{col.rot}</th>
                </tr>
              </thead>
              <tbody>
                {filhos.map((f, i) => <Termo key={f.id + i} l={f} linhas={linhas} col={col}
                  onEntrar={(fid: string) => setPilha([...pilha, fid])}
                  onRazao={onRazao ? () => onRazao(f.id, col) : undefined} />)}
                <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                  <td style={{ padding: '8px 8px 0 0' }}>{l.descricao}</td>
                  <td style={{ padding: '8px 0 0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {fmtL(l, col.val[l.id])}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ⚠ Esta frase é o que impede a conferência de parecer errada: aqui
              a despesa vai NEGATIVA (sinal econômico cru), e no resto da tela
              ela aparece positiva. Sem dizer, quem confere acha defeito. */}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12, lineHeight: 1.6 }}>
            ⚠ Os valores saem do motor com o <strong>sinal econômico cru</strong> — despesa é negativa —,
            que é o sinal com que a fórmula realmente é avaliada. No resto da tela a despesa aparece positiva.
            <br />Os nomes em roxo são <strong>linhas do relatório</strong>, não contas orçamentárias.
            {raiz && raiz.id !== l.id && <> A composição segue no recorte de <strong>{raiz.descricao}</strong>.</>}
          </div>
        </>
      )}
    </ModalPanel>
  )
}
