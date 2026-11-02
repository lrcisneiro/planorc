import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { ArvoreEditavel, type No } from '../../lib/ArvoreEditavel'
import { Plus, Users } from 'lucide-react'

// ============================================================
// Áreas funcionais — o organograma da empresa, agora editável.
//
// As 37 áreas entraram por migration (v3_146) e durante um tempo só por SQL se
// mexia nelas: eu fiz o motor e a atribuição, e esqueci a manutenção. Esta aba
// fecha isso, sobre o MESMO editor de árvore dos cargos.
//
// ⚠ Isto NÃO é centro de custo nem cargo — são três eixos distintos:
//   centro_custo  = onde o dinheiro cai (Base × Novos × produto)
//   cargo         = o que a pessoa é (carreira)
//   area_funcional= onde a pessoa trabalha (este)
// O contador mostra quantos POSTOS estão na área, já somando as de baixo; é o
// que diz se uma área existe de fato ou só no desenho.
//
// Código livre, no padrão do CC (1 / 11 / 111): quem desenha a estrutura é
// quem numera. Não derivo do pai porque a numeração é decisão de quem a lê.
// ============================================================

type Area = { id: string; codigo: string; nome: string; pai_id: string | null; ativo: boolean }
type AreaX = Area & { usos: number; usosArvore: number }
type AreaNo = No<AreaX>

const S: Record<string, CSSProperties> = {
  bar:   { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 14px' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  dica:  { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px' },
  cod:   { width: 64, fontSize: 12, textAlign: 'center', background: 'var(--bg-soft)', color: 'var(--text-mid)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 4px' },
  uso:   { fontSize: 11.5, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 3 },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
}

export function AreasFuncionaisTab() {
  const [areas, setAreas] = useState<Area[]>([])
  const [usos, setUsos] = useState<Record<string, number>>({})
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    const [ad, pd] = await Promise.all([
      pageAll(() => supabase.from('area_funcional').select('id,codigo,nome,pai_id,ativo').order('codigo')),
      pageAll(() => supabase.from('posto_v').select('area_func_id').not('area_func_id', 'is', null)),
    ])
    setAreas(ad as Area[])
    const u: Record<string, number> = {}
    for (const p of pd as any[]) u[p.area_func_id] = (u[p.area_func_id] || 0) + 1
    setUsos(u); setLoading(false)
    if (!abertos.size) setAbertos(new Set((ad as Area[]).filter(a => !a.pai_id).map(a => a.id)))
  }
  useEffect(() => { carregar() }, [])

  const itens = useMemo<AreaX[]>(() => {
    const filhos: Record<string, string[]> = {}
    for (const a of areas) if (a.pai_id) (filhos[a.pai_id] ||= []).push(a.id)
    const memo: Record<string, number> = {}
    const vistos = new Set<string>()
    const soma = (id: string): number => {
      if (memo[id] != null) return memo[id]
      if (vistos.has(id)) return 0
      vistos.add(id)
      return (memo[id] = (usos[id] || 0) + (filhos[id] || []).reduce((s, f) => s + soma(f), 0))
    }
    return areas.map(a => ({ ...a, usos: usos[a.id] || 0, usosArvore: soma(a.id) }))
  }, [areas, usos])

  const gravar = async (q: any, oque: string): Promise<boolean> => {
    setErro('')
    const { data, error } = await q.select('id')
    if (error) { setErro(error.message); return false }
    if (!data?.length) { setErro(`Não foi possível ${oque} — a gravação foi recusada (área funcional é cadastro de administrador).`); return false }
    await carregar(); return true
  }

  const criar = async (pai_id: string | null) => {
    const pai = areas.find(a => a.id === pai_id)
    const nome = window.prompt(pai ? `Nova área abaixo de "${pai.nome}":` : 'Nova área (na raiz):')
    if (!nome?.trim()) return
    // Sugere o próximo código do ramo; quem desenha decide, então é editável.
    const irmaos = areas.filter(a => a.pai_id === (pai_id || null))
    const base = pai ? pai.codigo : ''
    const sugestao = `${base}${irmaos.length + 1}`
    const codigo = window.prompt('Código da área:', sugestao)
    if (!codigo?.trim()) return
    if (areas.some(a => a.codigo === codigo.trim())) { setErro(`Já existe área com o código ${codigo.trim()}.`); return }
    const ok = await gravar(supabase.from('area_funcional')
      .insert({ tenant_id: TENANT_ID, codigo: codigo.trim(), nome: nome.trim().toUpperCase(), pai_id, ativo: true }), 'criar a área')
    if (ok && pai_id) setAbertos(s => new Set(s).add(pai_id))
  }

  const semGente = areas.length - Object.keys(usos).length

  return (
    <div>
      <p style={S.dica}>
        O <b style={{ color: 'var(--text)' }}>organograma funcional</b> — onde a pessoa trabalha.
        Não confundir com centro de custo (onde o dinheiro cai) nem com cargo (o que a pessoa é).
        Arraste para reorganizar; o contador mostra quantos postos estão na área, somando as de baixo.
        Quem põe posto em área é a tela <b>Posto de trabalho → Organograma → Atribuir área</b>.
      </p>

      {erro && <div style={S.aviso}>{erro}</div>}

      <div style={S.bar}>
        <button style={S.btn} onClick={() => criar(null)}><Plus size={14} /> Nova área na raiz</button>
        <button style={S.btn} onClick={() => setAbertos(new Set(areas.map(a => a.id)))}>Expandir tudo</button>
        <button style={S.btn} onClick={() => setAbertos(new Set())}>Recolher</button>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {areas.length} área(s){semGente > 0 && ` · ${semGente} sem ninguém`}
        </span>
      </div>

      {loading ? <div style={S.dica}>Carregando…</div> : (
        <ArvoreEditavel<AreaX>
          itens={itens} abertos={abertos} setAbertos={setAbertos} onErro={setErro}
          raizRotulo="Solte aqui para tirar de qualquer pai (voltar à raiz)"
          ordenar={(a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })}
          onMover={async (id, pai) => {
            const ok = await gravar(supabase.from('area_funcional').update({ pai_id: pai }).eq('id', id), 'mover a área')
            if (ok && pai) setAbertos(s => new Set(s).add(pai))
          }}
          onRenomear={(id, nome) => { gravar(supabase.from('area_funcional').update({ nome }).eq('id', id), 'renomear') }}
          onCriar={criar}
          podeApagar={(n: AreaNo) => n.usosArvore > 0 ? `${n.usosArvore} posto(s) nesta área ou abaixo dela` : null}
          onApagar={(n: AreaNo) => {
            if (!window.confirm(`Apagar "${n.nome}"?${n.filhos.length ? `\n\nAs ${n.filhos.length} área(s) abaixo sobem para a raiz — não são apagadas.` : ''}`)) return
            gravar(supabase.from('area_funcional').delete().eq('id', n.id), 'apagar')
          }}
          colunas={(n: AreaNo, temFilhos) => (
            <span style={S.uso} title={temFilhos ? `${n.usos} nesta área · ${n.usosArvore} com as de baixo` : `${n.usos} posto(s)`}>
              <Users size={12} />{n.usos}{temFilhos && n.usosArvore !== n.usos && <span style={{ opacity: 0.6 }}>/{n.usosArvore}</span>}
            </span>
          )}
        />
      )}
    </div>
  )
}
