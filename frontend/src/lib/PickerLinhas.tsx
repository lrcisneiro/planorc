import { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

/**
 * Escolhe E ORDENA quais linhas do relatório viram cartão no painel.
 *
 * ⚠⚠ UMA LISTA SÓ, indicador e linha de relatório JUNTOS (26/nov, pedido do
 * Ricardo: *"queria colocar Receita ao lado do EBITDA, mas como estão em
 * quadros diferentes não consigo arrastar"*). Eram duas seções com duas
 * seleções e dois escopos de arrasto — e a fronteira entre elas não
 * significava nada para quem monta um painel. **No banco os dois são a mesma
 * coisa**: linhas de `relatorio_linha`, distintas só pelo `tipo_linha`. Por
 * isso a fusão não precisou de campo novo nem de migration — um array de
 * `relatorio_linha.id` já descreve as duas.
 *
 * ⚠ A etiqueta por linha é o que a fronteira tinha de útil: numa lista única,
 * sem ela não se distingue *% EBITDA* (pontos percentuais) de *Marketing*
 * (reais). Separar em quadros para dizer isso era caro demais pelo que
 * informava.
 *
 * O componente vive aqui, e não na página, porque atravessa os dois
 * dashboards — copiar seria o jeito de eles divergirem na primeira alteração
 * (a lição do `fmtEixo` e do modo discreto).
 */
export type LinhaPick = {
  id: string
  descricao?: string | null
  tipo_linha?: string | null
  formato?: string | null
}

const etiqueta = (l: LinhaPick): { txt: string; cor: string } | null => {
  if (l.formato === 'PERCENTUAL') return { txt: '%', cor: 'var(--cyan)' }
  if (l.tipo_linha === 'INDICADOR') return { txt: 'indicador', cor: 'var(--violet)' }
  if (l.tipo_linha === 'FORMULA') return { txt: 'fórmula', cor: 'var(--violet)' }
  return null
}

export function PickerLinhas({ titulo, nota, candidatos, sel, setSel, fechar }: {
  titulo: string; nota?: string; candidatos: LinhaPick[]
  sel: string[]; setSel: (v: string[]) => void; fechar: () => void
}) {
  const noPainel = sel.map(id => candidatos.find(l => l.id === id)).filter(Boolean) as LinhaPick[]
  const fora = candidatos.filter(l => !sel.includes(l.id))
  const [busca, setBusca] = useState('')
  const foraVis = busca.trim()
    ? fora.filter(l => (l.descricao || '').toLowerCase().includes(busca.trim().toLowerCase()))
    : fora
  const mover = (i: number, d: number) => {
    const n = [...sel]; const j = i + d
    if (j < 0 || j >= n.length) return
    ;[n[i], n[j]] = [n[j], n[i]]; setSel(n)
  }
  const lin: any = { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', fontSize: 13, borderBottom: '1px solid var(--border)' }
  const mini: any = { background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 2, display: 'inline-flex' }
  const bt: any = { padding: '6px 12px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--panel)', color: 'var(--text-mid)', cursor: 'pointer' }
  const Tag = ({ l }: { l: LinhaPick }) => {
    const e = etiqueta(l)
    return e ? <span style={{ fontSize: 10, color: e.cor, border: `1px solid ${e.cor}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>{e.txt}</span> : null
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }} onClick={fechar}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 460, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e: any) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{titulo}</div>
        {nota && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{nota}</div>}

        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--faint)', fontWeight: 600, margin: '0 0 6px' }}>No painel ({noPainel.length}) — esta é a ordem</div>
        {!noPainel.length ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '6px 0 10px' }}>Nenhuma escolhida ainda.</div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
            {noPainel.map((l, i) => (
              <div key={l.id} style={{ ...lin, borderBottom: i === noPainel.length - 1 ? 'none' : lin.borderBottom }}>
                <span style={{ width: 20, color: 'var(--faint)', fontSize: 11, textAlign: 'right' }}>{i + 1}</span>
                <span style={{ flex: 1, color: 'var(--text)' }}>{l.descricao}</span>
                <Tag l={l} />
                <button style={{ ...mini, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0} title="Subir" onClick={() => mover(i, -1)}><ChevronUp size={14} /></button>
                <button style={{ ...mini, opacity: i === noPainel.length - 1 ? 0.3 : 1 }} disabled={i === noPainel.length - 1} title="Descer" onClick={() => mover(i, 1)}><ChevronDown size={14} /></button>
                <button style={{ ...mini, color: 'var(--red)' }} title="Tirar do painel" onClick={() => setSel(sel.filter(x => x !== l.id))}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--faint)', fontWeight: 600 }}>Disponíveis ({foraVis.length})</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="buscar…"
            style={{ marginLeft: 'auto', padding: '4px 9px', fontSize: 12.5, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 150 }} />
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
          {!foraVis.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '8px 10px' }}>{busca ? 'Nada com esse texto.' : 'Todas já estão no painel.'}</div> : foraVis.map((l, i) => (
            <div key={l.id} style={{ ...lin, cursor: 'pointer', borderBottom: i === foraVis.length - 1 ? 'none' : lin.borderBottom }}
              onClick={() => setSel([...sel, l.id])}>
              <span style={{ flex: 1, color: 'var(--muted)' }}>{l.descricao}</span>
              <Tag l={l} />
              <span style={{ color: 'var(--violet)', fontSize: 12, fontWeight: 600 }}>+ adicionar</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={bt} onClick={() => setSel([])}>Limpar</button>
          <button style={{ ...bt, borderColor: 'var(--violet)', color: 'var(--violet)' }} onClick={fechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
