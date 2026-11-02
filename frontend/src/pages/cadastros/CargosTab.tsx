import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { slugCargo } from '../../lib/slugCargo'
import { ArvoreEditavel, type No } from '../../lib/ArvoreEditavel'
import { Plus, Users } from 'lucide-react'

// ============================================================
// Cargos — árvore de carreira. A mecânica de arrastar, soltar, renomear e
// recusar ciclo vive em `lib/ArvoreEditavel`; aqui fica só o que é de cargo.
//
// O NÍVEL é separado da profundidade de propósito: um "Analista III" de TI e um
// do Comercial são o mesmo nível em ramos diferentes, e é o nível — não a
// profundidade — que depois torna a hierarquia de pessoas conferível.
//
// `origem` separa o que a FOLHA manda (dado de entrada, em reestruturação) do
// PLANO de cargos (decisão). Arrastar um da folha para dentro de um do plano é,
// ao mesmo tempo, o de-para — por isso as duas seções são UMA árvore só: em
// duas instâncias o arrasto morreria na fronteira.
// ============================================================

type Cargo = { id: string; codigo: string | null; nome: string; pai_id: string | null; nivel: number | null; ativo: boolean | null; origem: string | null }
type CargoX = Cargo & { usos: number; usosArvore: number }
type CargoNo = No<CargoX>

const S: Record<string, CSSProperties> = {
  bar:   { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 14px' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  dica:  { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px' },
  niv:   { width: 54, fontSize: 12, textAlign: 'center', background: 'var(--bg-soft)', color: 'var(--text-mid)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 4px' },
  uso:   { fontSize: 11.5, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 3 },
  tag:   { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--orange)', background: 'rgba(251,146,60,0.14)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 5, padding: '1px 5px', flexShrink: 0 },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
}

export function CargosTab() {
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [usos, setUsos] = useState<Record<string, number>>({})
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    const [cd, pd] = await Promise.all([
      pageAll(() => supabase.from('cargo').select('id,codigo,nome,pai_id,nivel,ativo,origem').order('nome')),
      pageAll(() => supabase.from('posto_v').select('cargo_id')),
    ])
    setCargos(cd as Cargo[])
    const u: Record<string, number> = {}
    for (const p of pd as any[]) if (p.cargo_id) u[p.cargo_id] = (u[p.cargo_id] || 0) + 1
    setUsos(u); setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  // Uso próprio e uso da subárvore. O segundo mostra o peso do ramo enquanto se
  // organiza — é o que diz se vale a pena mexer naquele galho.
  const itens = useMemo<CargoX[]>(() => {
    const filhos: Record<string, string[]> = {}
    for (const c of cargos) if (c.pai_id) (filhos[c.pai_id] ||= []).push(c.id)
    const memo: Record<string, number> = {}
    const vistos = new Set<string>()
    const soma = (id: string): number => {
      if (memo[id] != null) return memo[id]
      if (vistos.has(id)) return 0        // guarda contra ciclo herdado
      vistos.add(id)
      return (memo[id] = (usos[id] || 0) + (filhos[id] || []).reduce((s, f) => s + soma(f), 0))
    }
    return cargos.map(c => ({ ...c, usos: usos[c.id] || 0, usosArvore: soma(c.id) }))
  }, [cargos, usos])

  // Confere o retorno: UPDATE barrado por RLS não dá erro, filtra as linhas,
  // afeta zero e volta sucesso. Sem isto a tela mentiria.
  const gravar = async (q: any, oque: string): Promise<boolean> => {
    setErro('')
    const { data, error } = await q.select('id')
    if (error) { setErro(error.message); return false }
    if (!data?.length) { setErro(`Não foi possível ${oque} — a gravação foi recusada pelas suas permissões.`); return false }
    await carregar(); return true
  }

  const criar = async (pai_id: string | null) => {
    const nome = window.prompt(pai_id ? `Novo cargo abaixo de "${cargos.find(c => c.id === pai_id)?.nome}":` : 'Novo cargo (na raiz):')
    if (!nome?.trim()) return
    const nm = nome.trim().toUpperCase()
    // Mesma regra de código da importação; o sufixo só entra se já existir —
    // nomes que diferem só em acento geram o mesmo código.
    const usados = new Set(cargos.map(c => (c.codigo || '').toUpperCase()))
    let cod = slugCargo(nm)
    for (let i = 2; usados.has(cod); i++) cod = `${slugCargo(nm).slice(0, 25)}_${i}`
    const ok = await gravar(supabase.from('cargo').insert({ tenant_id: TENANT_ID, codigo: cod, nome: nm, pai_id, ativo: true, origem: 'PLANO' }), 'criar o cargo')
    if (ok && pai_id) setAbertos(s => new Set(s).add(pai_id))
  }

  const nPlano = cargos.filter(c => c.origem !== 'ERP').length
  const nErp = cargos.filter(c => c.origem === 'ERP').length
  const semNivel = cargos.filter(c => c.origem !== 'ERP' && c.nivel == null).length

  return (
    <div>
      <p style={S.dica}>
        <b style={{ color: 'var(--text)' }}>Arraste um cargo para dentro de outro</b> para definir a carreira.
        O número é o <b>nível</b> — senioridade comparável entre ramos, e é ele que depois permite
        conferir a hierarquia de pessoas, não a profundidade da árvore. O contador mostra quantos
        postos usam o cargo (e, após a barra, com os de baixo).
      </p>

      {erro && <div style={S.aviso}>{erro}</div>}

      <div style={S.bar}>
        <button style={S.btn} onClick={() => criar(null)}><Plus size={14} /> Novo cargo na raiz</button>
        <button style={S.btn} onClick={() => setAbertos(new Set(cargos.map(c => c.id)))}>Expandir tudo</button>
        <button style={S.btn} onClick={() => setAbertos(new Set())}>Recolher</button>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {nPlano} no plano{semNivel > 0 && ` (${semNivel} sem nível)`} · {nErp} da folha
        </span>
      </div>

      {loading ? <div style={S.dica}>Carregando…</div> : (
        <ArvoreEditavel<CargoX>
          itens={itens} abertos={abertos} setAbertos={setAbertos} onErro={setErro}
          raizRotulo="Solte aqui para tirar de qualquer pai (voltar à raiz)"
          ordenar={(a, b) => (a.nivel ?? 99) - (b.nivel ?? 99) || a.nome.localeCompare(b.nome)}
          onMover={async (id, pai) => {
            const ok = await gravar(supabase.from('cargo').update({ pai_id: pai }).eq('id', id), 'mover o cargo')
            if (ok && pai) setAbertos(s => new Set(s).add(pai))
          }}
          onRenomear={(id, nome) => { gravar(supabase.from('cargo').update({ nome }).eq('id', id), 'renomear') }}
          onCriar={criar}
          podeApagar={(n: CargoNo) => n.usos > 0 ? `${n.usos} posto(s) usam este cargo` : null}
          onApagar={(n: CargoNo) => {
            if (!window.confirm(`Apagar "${n.nome}"?${n.filhos.length ? `\n\nOs ${n.filhos.length} cargo(s) abaixo sobem para a raiz — não são apagados.` : ''}`)) return
            gravar(supabase.from('cargo').delete().eq('id', n.id), 'apagar')
          }}
          prefixo={(n: CargoNo) => n.origem === 'ERP'
            ? <span style={S.tag} title="Veio da folha. Pendurado num cargo do plano, isto também é o de-para.">folha</span>
            : null}
          colunas={(n: CargoNo, temFilhos) => <>
            <input style={S.niv} type="number" min={1} max={99} defaultValue={n.nivel ?? ''} placeholder="nível"
                   title="Senioridade comparável entre ramos — um Analista III de TI e um do Comercial têm o mesmo nível."
                   onBlur={e => {
                     const v = e.target.value.trim() === '' ? null : Number(e.target.value)
                     if (v !== n.nivel) gravar(supabase.from('cargo').update({ nivel: v }).eq('id', n.id), 'gravar o nível')
                   }} />
            <span style={S.uso} title={temFilhos ? `${n.usos} neste cargo · ${n.usosArvore} com os de baixo` : `${n.usos} posto(s) neste cargo`}>
              <Users size={12} />{n.usos}{temFilhos && n.usosArvore !== n.usos && <span style={{ opacity: 0.6 }}>/{n.usosArvore}</span>}
            </span>
          </>}
          secoes={[
            { chave: 'plano', titulo: 'Estrutura · plano de cargos', filtro: n => n.origem !== 'ERP',
              vazio: <>Ainda não há cargo do plano. Comece pelo topo — <b style={{ color: 'var(--text)' }}>Novo cargo na raiz</b> — e vá descendo. Os cargos da folha ficam na lista abaixo até serem pendurados aqui.</> },
            { chave: 'erp', filtro: n => n.origem === 'ERP',
              titulo: <>Vindos da folha · ainda não classificados
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)', fontSize: 11.5 }}>
                  arraste para dentro de um cargo do plano; isso também é o de-para
                </span></> },
          ]}
        />
      )}
    </div>
  )
}
