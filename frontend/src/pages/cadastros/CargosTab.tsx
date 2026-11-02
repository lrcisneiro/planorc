import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2, CornerDownLeft, Users } from 'lucide-react'

// ============================================================
// Cargos — árvore de carreira, arrastando e soltando.
//
// Até aqui `cargo` não tinha tela: nascia do import do RH (upsert por código) e
// era lido em dropdown. Esta é a primeira, e por isso ela também renomeia, cria
// e apaga — não só reorganiza.
//
// Duas coisas que a árvore responde e a lista não: onde cada cargo está na
// carreira, e qual o NÍVEL dele. O nível é separado da profundidade de
// propósito — um "Analista III" de TI e um do Comercial são o mesmo nível em
// ramos diferentes, e é o nível, não a profundidade, que depois torna a
// hierarquia de pessoas conferível.
//
// ⚠ Ciclo é o defeito grave: arrastar o pai para baixo do próprio filho faz a
// árvore virar laço e a tela recursar até travar. Aqui a prevenção é no drop
// (`descendentes()`), e a v3_144 põe a mesma trava no banco por gatilho —
// porque a API é outro caminho e a tela não guarda a porta dos fundos.
//
// Apagar só é oferecido para cargo SEM posto: a contagem de uso fica visível na
// linha, então ninguém precisa descobrir pela mensagem de erro.
// ============================================================

type Cargo = { id: string; codigo: string | null; nome: string; pai_id: string | null; nivel: number | null; ativo: boolean | null }
type No = Cargo & { filhos: No[]; usos: number; usosArvore: number }

const S: Record<string, CSSProperties> = {
  bar:   { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 14px' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  dica:  { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px' },
  raiz:  { border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 },
  linha: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, border: '1px solid transparent' },
  nome:  { fontSize: 13.5, color: 'var(--text)', fontWeight: 600, background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '2px 6px', minWidth: 160, flex: 1 },
  cod:   { fontSize: 11, color: 'var(--violet)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 64 },
  niv:   { width: 54, fontSize: 12, textAlign: 'center', background: 'var(--bg-soft)', color: 'var(--text-mid)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 4px' },
  uso:   { fontSize: 11.5, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 3 },
  ico:   { cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
}

export function CargosTab() {
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [usos, setUsos] = useState<Record<string, number>>({})
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [arrasto, setArrasto] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    const [cd, pd] = await Promise.all([
      pageAll(() => supabase.from('cargo').select('id,codigo,nome,pai_id,nivel,ativo').order('nome')),
      pageAll(() => supabase.from('posto_v').select('cargo_id')),
    ])
    setCargos(cd as Cargo[])
    const u: Record<string, number> = {}
    for (const p of pd as any[]) if (p.cargo_id) u[p.cargo_id] = (u[p.cargo_id] || 0) + 1
    setUsos(u); setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  const { raizes, byId } = useMemo(() => {
    const byId: Record<string, No> = {}
    for (const c of cargos) byId[c.id] = { ...c, filhos: [], usos: usos[c.id] || 0, usosArvore: 0 }
    const raizes: No[] = []
    for (const c of cargos) {
      const pai = c.pai_id && byId[c.pai_id] ? byId[c.pai_id] : null
      if (pai) pai.filhos.push(byId[c.id]); else raizes.push(byId[c.id])
    }
    const vistos = new Set<string>()
    const somar = (n: No): number => {
      if (vistos.has(n.id)) return 0       // guarda: ciclo vindo de antes do gatilho
      vistos.add(n.id)
      n.usosArvore = n.usos + n.filhos.reduce((s, f) => s + somar(f), 0)
      n.filhos.sort((a, b) => (a.nivel ?? 99) - (b.nivel ?? 99) || a.nome.localeCompare(b.nome))
      return n.usosArvore
    }
    raizes.forEach(somar)
    raizes.sort((a, b) => (a.nivel ?? 99) - (b.nivel ?? 99) || a.nome.localeCompare(b.nome))
    return { raizes, byId }
  }, [cargos, usos])

  // Quem está abaixo de `id`: soltar dentro da própria subárvore é o que cria
  // o laço, então é isto que o drop consulta antes de aceitar.
  const descendentes = (id: string): Set<string> => {
    const out = new Set<string>()
    const vai = (n: No) => { for (const f of n.filhos) { out.add(f.id); vai(f) } }
    if (byId[id]) vai(byId[id])
    return out
  }

  const mover = async (filhoId: string, novoPaiId: string | null) => {
    setErro('')
    if (filhoId === novoPaiId) return
    if (novoPaiId && descendentes(filhoId).has(novoPaiId)) {
      setErro(`"${byId[novoPaiId].nome}" está abaixo de "${byId[filhoId].nome}" — mover criaria um ciclo. Tire o destino de dentro da origem primeiro.`)
      return
    }
    const { error } = await supabase.from('cargo').update({ pai_id: novoPaiId }).eq('id', filhoId).select('id')
    if (error) { setErro(error.message); return }
    if (novoPaiId) setAbertos(s => new Set(s).add(novoPaiId))
    carregar()
  }

  const salvar = async (id: string, patch: Partial<Cargo>) => {
    setErro('')
    const { data, error } = await supabase.from('cargo').update(patch).eq('id', id).select('id')
    if (error) { setErro(error.message); return }
    if (!data?.length) { setErro('A gravação foi recusada — você não tem permissão para editar cargos.'); return }
    carregar()
  }

  const criar = async (pai_id: string | null) => {
    setErro('')
    const nome = window.prompt(pai_id ? `Novo cargo abaixo de "${byId[pai_id].nome}":` : 'Novo cargo (na raiz):')
    if (!nome?.trim()) return
    // `tenant_id` explícito: `cargo` não tem o gatilho de auto-tenant que outras
    // tabelas têm, e a política de INSERT exige `tenant_id = current_tenant_id()`.
    // Sem ele o erro é "new row violates row-level security policy", que soa
    // como falta de permissão quando na verdade é campo faltando.
    const { error } = await supabase.from('cargo')
      .insert({ tenant_id: TENANT_ID, nome: nome.trim().toUpperCase(), pai_id, ativo: true })
    if (error) { setErro(error.message); return }
    if (pai_id) setAbertos(s => new Set(s).add(pai_id))
    carregar()
  }

  const apagar = async (n: No) => {
    if (n.usos > 0) return
    if (!window.confirm(`Apagar "${n.nome}"?${n.filhos.length ? `\n\nOs ${n.filhos.length} cargo(s) abaixo sobem para a raiz — não são apagados.` : ''}`)) return
    const { error } = await supabase.from('cargo').delete().eq('id', n.id)
    if (error) { setErro(error.message); return }
    carregar()
  }

  const Linha = ({ n, nivel }: { n: No; nivel: number }) => {
    const temFilhos = n.filhos.length > 0
    const aberto = abertos.has(n.id)
    const alvo = sobre === n.id && arrasto && arrasto !== n.id
    const proibido = !!(alvo && descendentes(arrasto!).has(n.id))
    return (
      <>
        <div draggable
          onDragStart={e => { setArrasto(n.id); e.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setArrasto(null); setSobre(null) }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (sobre !== n.id) setSobre(n.id) }}
          onDragLeave={() => { if (sobre === n.id) setSobre(null) }}
          onDrop={e => { e.preventDefault(); if (arrasto) mover(arrasto, n.id); setArrasto(null); setSobre(null) }}
          style={{ ...S.linha, marginLeft: nivel * 22,
                   borderColor: alvo ? (proibido ? 'var(--red)' : 'var(--violet)') : 'transparent',
                   background: alvo ? (proibido ? 'rgba(239,68,68,0.10)' : 'rgba(139,92,246,0.12)') : (arrasto === n.id ? 'var(--bg-soft)' : 'transparent'),
                   opacity: arrasto === n.id ? 0.5 : 1 }}>
          <GripVertical size={14} style={{ color: 'var(--border-strong)', cursor: 'grab', flexShrink: 0 }} />
          {temFilhos
            ? <span onClick={() => setAbertos(s => { const x = new Set(s); x.has(n.id) ? x.delete(n.id) : x.add(n.id); return x })} style={S.ico}>
                {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            : <span style={{ width: 14, flexShrink: 0 }} />}
          <span style={S.cod}>{n.codigo || '—'}</span>
          <input style={S.nome} defaultValue={n.nome}
                 onFocus={e => { e.target.style.borderColor = 'var(--border-strong)'; e.target.style.background = 'var(--bg-soft)' }}
                 onBlur={e => {
                   e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'
                   const v = e.target.value.trim(); if (v && v !== n.nome) salvar(n.id, { nome: v })
                 }} />
          <input style={S.niv} type="number" min={1} max={99} defaultValue={n.nivel ?? ''} placeholder="nível"
                 title="Senioridade comparável entre ramos — um Analista III de TI e um do Comercial têm o mesmo nível."
                 onBlur={e => {
                   const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                   if (v !== n.nivel) salvar(n.id, { nivel: v })
                 }} />
          <span style={S.uso} title={temFilhos ? `${n.usos} neste cargo · ${n.usosArvore} com os de baixo` : `${n.usos} posto(s) neste cargo`}>
            <Users size={12} />{n.usos}{temFilhos && n.usosArvore !== n.usos && <span style={{ opacity: 0.6 }}>/{n.usosArvore}</span>}
          </span>
          <Plus size={14} style={S.ico} onClick={() => criar(n.id)} />
          {n.pai_id && <CornerDownLeft size={14} style={S.ico} onClick={() => mover(n.id, null)} />}
          <Trash2 size={14} onClick={() => apagar(n)}
                  style={{ ...S.ico, opacity: n.usos > 0 ? 0.25 : 1, cursor: n.usos > 0 ? 'not-allowed' : 'pointer' }} />
        </div>
        {temFilhos && aberto && n.filhos.map(f => <Linha key={f.id} n={f} nivel={nivel + 1} />)}
      </>
    )
  }

  const semNivel = cargos.filter(c => c.nivel == null).length

  return (
    <div>
      <p style={S.dica}>
        <b style={{ color: 'var(--text)' }}>Arraste um cargo para dentro de outro</b> para definir a carreira.
        A seta <CornerDownLeft size={12} style={{ verticalAlign: -1 }} /> devolve à raiz; o número é o <b>nível</b>,
        que é a senioridade comparável entre ramos — e é ele que depois permite conferir a hierarquia de pessoas,
        não a profundidade da árvore. O contador mostra quantos postos usam o cargo (e, entre barras, com os de baixo).
      </p>

      {erro && <div style={S.aviso}>{erro}</div>}

      <div style={S.bar}>
        <button style={S.btn} onClick={() => criar(null)}><Plus size={14} /> Novo cargo na raiz</button>
        <button style={S.btn} onClick={() => setAbertos(new Set(cargos.map(c => c.id)))}>Expandir tudo</button>
        <button style={S.btn} onClick={() => setAbertos(new Set())}>Recolher</button>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {cargos.length} cargo(s){semNivel > 0 && ` · ${semNivel} sem nível`}
        </span>
      </div>

      {/* Soltar aqui tira o cargo de qualquer pai. Sem esta área, um cargo que
          foi para o lugar errado só sairia pela seta, que é menos descoberto. */}
      <div style={{ ...S.raiz, borderColor: sobre === '__raiz' ? 'var(--violet)' : 'var(--border-strong)',
                    background: sobre === '__raiz' ? 'rgba(139,92,246,0.10)' : 'transparent' }}
           onDragOver={e => { e.preventDefault(); setSobre('__raiz') }}
           onDragLeave={() => setSobre(s => s === '__raiz' ? null : s)}
           onDrop={e => { e.preventDefault(); if (arrasto) mover(arrasto, null); setArrasto(null); setSobre(null) }}>
        Solte aqui para tirar de qualquer pai (voltar à raiz)
      </div>

      {loading ? <div style={S.dica}>Carregando…</div>
        : raizes.length === 0 ? <div style={S.dica}>Nenhum cargo cadastrado. Eles costumam nascer da importação de postos do RH.</div>
        : raizes.map(r => <Linha key={r.id} n={r} nivel={0} />)}
    </div>
  )
}
