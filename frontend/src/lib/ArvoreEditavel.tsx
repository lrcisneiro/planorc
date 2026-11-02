import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2, CornerDownLeft } from 'lucide-react'

// ============================================================
// Editor de árvore por arrastar e soltar — compartilhado.
//
// Nasceu na aba Cargos e foi extraído quando a segunda árvore apareceu (áreas
// funcionais). A terceira já está no horizonte: a hierarquia de PESSOAS, quando
// `posto.gestor_posto_id` existir. Três cópias do mesmo arrastar-soltar
// divergiriam no primeiro ajuste — e divergência em comportamento de arrastar é
// do tipo que ninguém nota até alguém reclamar que "numa tela funciona".
//
// O que ele sabe: montar a árvore a partir de `pai_id`, abrir e fechar,
// arrastar para reparentar, soltar na raiz, renomear no lugar, e **recusar o
// movimento que criaria ciclo** (pintando o alvo de vermelho ANTES de soltar).
// O que ele não sabe: o que é um cargo ou uma área. Isso vem por `colunas`,
// `prefixo` e pelos callbacks.
//
// ⚠ SEÇÕES vivem aqui dentro, e não como duas instâncias, porque em Cargos se
// arrasta **de uma seção para outra** (da folha para o plano). Duas instâncias
// teriam dois estados de arrasto e o gesto morreria na fronteira.
// ============================================================

export type ItemArvore = { id: string; codigo?: string | null; nome: string; pai_id: string | null }
export type No<T> = T & { filhos: No<T>[] }

export type Secao<T> = { chave: string; titulo?: ReactNode; filtro: (no: No<T>) => boolean; vazio?: ReactNode }

const S: Record<string, CSSProperties> = {
  linha: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, border: '1px solid transparent' },
  nome:  { fontSize: 13.5, color: 'var(--text)', fontWeight: 600, background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '2px 6px', minWidth: 160, flex: 1 },
  cod:   { fontSize: 11, color: 'var(--violet)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 64 },
  ico:   { cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 },
  raiz:  { border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 },
  secT:  { fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '22px 0 8px', display: 'flex', alignItems: 'center', gap: 8 },
  vazio: { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 },
}

export function ArvoreEditavel<T extends ItemArvore>({
  itens, abertos, setAbertos, onMover, onRenomear, onCriar, onApagar,
  podeApagar, ordenar, colunas, prefixo, secoes, raizRotulo, onErro,
}: {
  itens: T[]
  abertos: Set<string>
  setAbertos: (f: (s: Set<string>) => Set<string>) => void
  onMover: (filhoId: string, novoPaiId: string | null) => void
  onRenomear: (id: string, nome: string) => void
  onCriar?: (pai_id: string | null) => void
  onApagar?: (no: No<T>) => void
  /** Quando devolve string, a lixeira fica apagada e o texto vira o título. */
  podeApagar?: (no: No<T>) => string | null
  ordenar?: (a: No<T>, b: No<T>) => number
  /** Células à direita do nome (nível, contadores, o que a tela quiser). */
  colunas?: (no: No<T>, temFilhos: boolean) => ReactNode
  /** Entre o código e o nome (etiquetas de origem, por exemplo). */
  prefixo?: (no: No<T>) => ReactNode
  secoes?: Secao<T>[]
  raizRotulo?: string
  onErro?: (msg: string) => void
}) {
  const [arrasto, setArrasto] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)

  const { raizes, byId } = useMemo(() => {
    const byId: Record<string, No<T>> = {}
    for (const c of itens) byId[c.id] = { ...c, filhos: [] }
    const raizes: No<T>[] = []
    for (const c of itens) {
      const pai = c.pai_id && byId[c.pai_id] ? byId[c.pai_id] : null
      if (pai) pai.filhos.push(byId[c.id]); else raizes.push(byId[c.id])
    }
    // Guarda contra ciclo herdado: sem `vistos`, um laço trava a tela.
    const vistos = new Set<string>()
    const ord = (n: No<T>) => {
      if (vistos.has(n.id)) return
      vistos.add(n.id)
      if (ordenar) n.filhos.sort(ordenar)
      n.filhos.forEach(ord)
    }
    raizes.forEach(ord)
    if (ordenar) raizes.sort(ordenar)
    return { raizes, byId }
  }, [itens, ordenar])

  // Quem está abaixo de `id`. Soltar dentro da própria subárvore é o que cria
  // o laço, então é isto que o drop consulta antes de aceitar.
  const descendentes = (id: string): Set<string> => {
    const out = new Set<string>()
    const vai = (n: No<T>) => { for (const f of n.filhos) { out.add(f.id); vai(f) } }
    if (byId[id]) vai(byId[id])
    return out
  }

  const soltar = (destino: string | null) => {
    const filho = arrasto
    setArrasto(null); setSobre(null)
    if (!filho || filho === destino) return
    if (destino && descendentes(filho).has(destino)) {
      onErro?.(`"${byId[destino].nome}" está abaixo de "${byId[filho].nome}" — mover criaria um ciclo. Tire o destino de dentro da origem primeiro.`)
      return
    }
    onMover(filho, destino)
  }

  const Linha = ({ n, nivel }: { n: No<T>; nivel: number }) => {
    const temFilhos = n.filhos.length > 0
    const aberto = abertos.has(n.id)
    const alvo = sobre === n.id && arrasto && arrasto !== n.id
    const proibido = !!(alvo && descendentes(arrasto!).has(n.id))
    const impedimento = podeApagar?.(n) ?? null
    return (
      <>
        <div draggable
          onDragStart={e => { setArrasto(n.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setArrasto(null); setSobre(null) }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (sobre !== n.id) setSobre(n.id) }}
          onDragLeave={() => { if (sobre === n.id) setSobre(null) }}
          onDrop={e => { e.preventDefault(); soltar(n.id) }}
          style={{ ...S.linha, marginLeft: nivel * 22,
                   borderColor: alvo ? (proibido ? 'var(--red)' : 'var(--violet)') : 'transparent',
                   background: alvo ? (proibido ? 'rgba(239,68,68,0.10)' : 'rgba(139,92,246,0.12)') : (arrasto === n.id ? 'var(--bg-soft)' : 'transparent'),
                   opacity: arrasto === n.id ? 0.5 : 1 }}>
          <GripVertical size={14} style={{ color: 'var(--border-strong)', cursor: 'grab', flexShrink: 0 }} />
          {temFilhos
            ? <span style={S.ico} onClick={() => setAbertos(s => { const x = new Set(s); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x })}>
                {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            : <span style={{ width: 14, flexShrink: 0 }} />}
          <span style={S.cod}>{n.codigo || '—'}</span>
          {prefixo?.(n)}
          <input style={S.nome} defaultValue={n.nome}
                 onFocus={e => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.background = 'var(--bg-soft)' }}
                 onBlur={e => {
                   e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'
                   const v = e.target.value.trim(); if (v && v !== n.nome) onRenomear(n.id, v)
                 }} />
          {colunas?.(n, temFilhos)}
          {onCriar && <Plus size={14} style={S.ico} onClick={() => onCriar(n.id)} />}
          {n.pai_id && (
            <span title="Voltar à raiz" style={S.ico} onClick={() => onMover(n.id, null)}><CornerDownLeft size={14} /></span>
          )}
          {onApagar && (
            <span title={impedimento || 'Excluir'} onClick={() => !impedimento && onApagar(n)}
                  style={{ ...S.ico, display: 'inline-flex', opacity: impedimento ? 0.25 : 1,
                           cursor: impedimento ? 'not-allowed' : 'pointer' }}><Trash2 size={14} /></span>
          )}
        </div>
        {temFilhos && aberto && n.filhos.map(f => <Linha key={f.id} n={f} nivel={nivel + 1} />)}
      </>
    )
  }

  const blocos: Secao<T>[] = secoes?.length ? secoes : [{ chave: '_', filtro: () => true }]
  const usados = new Set<string>()

  return (
    <>
      {raizRotulo && (
        <div style={{ ...S.raiz, borderColor: sobre === '__raiz' ? 'var(--violet)' : 'var(--border-strong)',
                      background: sobre === '__raiz' ? 'rgba(139,92,246,0.10)' : 'transparent' }}
             onDragOver={e => { e.preventDefault(); setSobre('__raiz') }}
             onDragLeave={() => setSobre(s => s === '__raiz' ? null : s)}
             onDrop={e => { e.preventDefault(); soltar(null) }}>
          {raizRotulo}
        </div>
      )}
      {blocos.map(b => {
        // Cada raiz entra na PRIMEIRA seção que a aceita — assim as seções
        // particionam, e nenhum nó aparece duas vezes por engano.
        const meus = raizes.filter(r => !usados.has(r.id) && b.filtro(r))
        meus.forEach(r => usados.add(r.id))
        if (!meus.length && !b.vazio) return null
        return (
          <div key={b.chave}>
            {b.titulo && <div style={S.secT}>{b.titulo}</div>}
            {meus.length ? meus.map(r => <Linha key={r.id} n={r} nivel={0} />)
                         : <div style={S.vazio}>{b.vazio}</div>}
          </div>
        )
      })}
    </>
  )
}
