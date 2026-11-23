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
export type ColMem = { rot: string; val: Record<string, number> }

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

const fmtL = (l: LinhaMem | undefined, v: number | undefined) =>
  v === undefined || !isFinite(v) ? '—'
    : formatValor(v, l?.formato || 'NUMERO', l?.casas_decimais ?? (l?.formato === 'PERCENTUAL' ? 1 : 0))

// ── a expressão escrita, com nomes ou com valores no lugar das referências ──
function Expr({ l, linhas, col }: { l: LinhaMem; linhas: LinhaMem[]; col?: ColMem }) {
  if (l.tipo_linha === 'SOMAR_FILHOS') {
    const f = componentesMem(l, linhas)
    if (!f.length) return <em style={{ color: 'var(--muted)' }}>soma das filhas (nenhuma ativa)</em>
    return <>{f.map((c, i) => (
      <span key={c.id}>{i > 0 ? ' + ' : ''}
        <span style={{ color: col ? 'var(--text)' : 'var(--violet)' }}>{col ? fmtL(c, col.val[c.id]) : c.descricao}</span>
      </span>
    ))}</>
  }
  if (!l.expressao) return <em style={{ color: 'var(--muted)' }}>vem do lançamento (não se decompõe)</em>
  return <>{tokensDe(l.expressao).map((t, i) => {
    if (t.t === 'txt') return <span key={i}>{t.v}</span>
    const x = linhas.find(z => z.codigo === t.v)
    const txt = col ? fmtL(x, x ? col.val[x.id] : undefined) : (x?.descricao || t.v)
    return <span key={i} style={{ color: col ? 'var(--text)' : 'var(--violet)' }}>{txt}</span>
  })}</>
}

// ── uma linha da árvore, expansível enquanto houver do que descer ──
function No({ l, linhas, cols, prof, caminho }: {
  l: LinhaMem; linhas: LinhaMem[]; cols: ColMem[]; prof: number; caminho: string[]
}) {
  const [aberto, setAberto] = useState(false)
  const filhos = componentesMem(l, linhas)
  // ⚠ CICLO: `=[A]` em A travaria o render. O caminho já percorrido é a guarda —
  // o motor tem a dele (`disabled`), mas aqui a recursão é de TELA.
  const podeAbrir = filhos.length > 0 && !caminho.includes(l.id) && prof < 6
  return (
    <>
      <tr style={{ borderTop: '1px solid var(--line)' }}>
        <td style={{ padding: '6px 8px 6px 0' }}>
          <span style={{ paddingLeft: prof * 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {podeAbrir ? (
              <button onClick={() => setAberto(a => !a)}
                title={aberto ? 'recolher' : 'abrir a memória desta linha'}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--violet)', fontSize: 11, width: 14, padding: 0 }}>
                {aberto ? '▾' : '▸'}
              </button>
            ) : <span style={{ width: 14, display: 'inline-block' }} />}
            <span style={{ color: prof ? 'var(--muted)' : 'var(--text)' }}>{l.descricao}</span>
            {l.desativada && <span style={{ fontSize: 10.5, color: 'var(--orange)' }}>desativada</span>}
          </span>
        </td>
        {cols.map(c => (
          <td key={c.rot} style={{ padding: '6px 0 6px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fmtL(l, c.val[l.id])}
          </td>
        ))}
      </tr>
      {aberto && (
        <>
          <tr>
            <td colSpan={1 + cols.length} style={{ padding: `0 0 6px ${prof * 16 + 20}px`, fontSize: 11.5, color: 'var(--muted)' }}>
              = <Expr l={l} linhas={linhas} />
            </td>
          </tr>
          {filhos.map(f => <No key={f.id} l={f} linhas={linhas} cols={cols} prof={prof + 1} caminho={[...caminho, l.id]} />)}
        </>
      )}
    </>
  )
}

export function MemoriaModal({ id, linhas, cols, onClose, nota }: {
  id: string; linhas: LinhaMem[]; cols: ColMem[]; onClose: () => void; nota?: string
}) {
  const l = linhas.find(z => z.id === id)
  if (!l) return null
  const filhos = componentesMem(l, linhas)
  return (
    <ModalPanel titulo={`Memória de cálculo · ${l.descricao}`} onClose={onClose} width="min(820px, calc(100vw - 40px))">
      {nota && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{nota}</div>}

      {!filhos.length ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Esta linha vem direto do lançamento{l.linha_orc_id ? '' : ' e não tem conta amarrada'} — não há fórmula a abrir.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>A fórmula</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 14, wordBreak: 'break-word' }}>
            = <Expr l={l} linhas={linhas} />
          </div>

          {/* ⚠ UMA SUBSTITUIÇÃO POR COLUNA. É a memória propriamente dita: a
              mesma expressão com os números no lugar dos nomes, e o resultado
              embaixo — dá para conferir a conta à mão, que é o pedido. */}
          {cols.map(c => (
            <div key={c.rot} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>{c.rot}</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>
                = <Expr l={l} linhas={linhas} col={c} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                = {fmtL(l, c.val[l.id])}
              </div>
            </div>
          ))}

          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, margin: '16px 0 2px' }}>Os termos</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
            ▸ abre a memória do próprio termo, quando ele também se decompõe.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  <th style={{ textAlign: 'left', padding: '0 8px 6px 0', fontWeight: 600 }}>Linha</th>
                  {cols.map(c => <th key={c.rot} style={{ textAlign: 'right', padding: '0 0 6px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{c.rot}</th>)}
                </tr>
              </thead>
              <tbody>
                {filhos.map(f => <No key={f.id} l={f} linhas={linhas} cols={cols} prof={0} caminho={[l.id]} />)}
                <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                  <td style={{ padding: '8px 8px 0 20px' }}>{l.descricao}</td>
                  {cols.map(c => (
                    <td key={c.rot} style={{ padding: '8px 0 0 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmtL(l, c.val[l.id])}
                    </td>
                  ))}
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
          </div>
        </>
      )}
    </ModalPanel>
  )
}
