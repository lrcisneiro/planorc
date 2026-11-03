import { useEffect, useMemo, useState, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { slugCargo } from '../../lib/slugCargo'
import { Plus, Trash2, Users, Search, Layers } from 'lucide-react'

// ============================================================
// Cargos — lista única do catálogo.
//
// ⚠ ERA UMA ÁRVORE, e deixou de ser. A hierarquia nasceu quando não existia
// estrutura funcional: amarrar cargo a cargo era o único jeito de dar contexto.
// Depois veio `area_funcional` (v3_146), que responde "onde a pessoa trabalha"
// muito melhor — e a árvore de cargos virou um segundo lugar para dizer a
// mesma coisa. O que sobra de carreira é `nivel`, que é comparável entre ramos
// e não depende de ninguém montar árvore.
// `cargo.pai_id` continua no banco, vestigial, e ninguém novo deve escrevê-la.
//
// ⚠ Era TAMBÉM a segunda tela sobre `cargo`: havia uma lista em Postos >
// Estrutura, com código e salário de referência. Eu criei esta sem procurar a
// outra. Ficou esta, que é cadastro de organização; a de Estrutura é sobre
// folha (verbas, sindicato, dissídio) e perdeu a aba.
//
// ⚠ `cargo.codigo` NÃO é o elo com o ERP — eu escrevi isso aqui e estava
// errado. Ele é um slug que a v3_156 derivou do NOME, porque a planilha do RH
// não traz código de cargo: traz código por STEP (957 para 190 cargos). O
// identificador que o ERP usa vive em `cargo_step` (v3_158) e é por isso que a
// coluna "Códigos ERP" mostra os códigos, não quantos são — um contador não se
// concilia com nada. `cargo.codigo` fica editável, mas como chave interna.
//
// ⚠ O catálogo é por (SUBÁREA, nome), não por nome (v3_161). `AUXILIAR
// ADMINISTRATIVO` são SEIS cargos — um em cada subárea — porque o código do
// ERP lê-se A·S·NNN e já carrega esse eixo. Misturar áreas num cargo só era
// não-conforme. Por isso a lista agrupa por subárea e NÃO por ordem de nome:
// dois cargos de mesmo nome lado a lado, sem o cabeçalho, pareceriam duplicata.
//
// ⚠ Campo editável precisa PARECER editável. A primeira versão desta tela usou
// borda transparente até o foco: as células ficaram indistinguíveis de texto e
// a tela passou por somente-leitura para quem a abriu.
// ============================================================

type Cargo = {
  id: string; codigo: string | null; nome: string; nivel: number | null
  salario_ref: number | null; ativo: boolean | null; origem: string | null
  area_cod: string | null; sub_cod: string | null
}
type Familia = { id: string; codigo: string; nome: string }
type Step = { id: string; cargo_id: string; step: number; codigo: string }

// "37005, 37006, 37007, 37008" não cabe e não informa mais que "37005–37008".
// Só encurta quando a sequência é mesmo contígua — senão esconderia um buraco,
// que é exatamente o que se quer enxergar numa chave de integração.
function faixa(cs: string[]): string {
  if (!cs.length) return ''
  const o = [...cs].sort()
  if (o.length === 1) return o[0]
  const n = o.map(Number)
  const contiguo = n.every((v, i) => !Number.isNaN(v) && (i === 0 || v === n[i - 1] + 1))
  return contiguo ? `${o[0]}–${o[o.length - 1]}` : o.join(', ')
}

const S: Record<string, CSSProperties> = {
  bar:   { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 14px' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  dica:  { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px' },
  busca: { padding: '7px 10px 7px 30px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', minWidth: 220 },
  tab:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '7px 8px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '4px 8px', borderBottom: '1px solid var(--border)' },
  // Borda sempre visível: foi a falta dela que fez a tela parecer só-leitura.
  inp:   { width: '100%', fontSize: 13, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px' },
  pil:   { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-mid)', background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' },
  sec:   { fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '18px 8px 6px' },
  tag:   { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--orange)', background: 'rgba(251,146,60,0.14)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 5, padding: '1px 5px' },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px' },
}

export function CargosTab() {
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [usos, setUsos] = useState<Record<string, number>>({})
  const [steps, setSteps] = useState<Step[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const [familias, setFamilias] = useState<Familia[]>([])
  const [subSel, setSubSel] = useState('')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    const [cd, pd, sd, fd] = await Promise.all([
      pageAll(() => supabase.from('cargo').select('id,codigo,nome,nivel,salario_ref,ativo,origem,area_cod,sub_cod').order('nome')),
      pageAll(() => supabase.from('posto_v').select('cargo_id')),
      pageAll(() => supabase.from('cargo_step').select('id,cargo_id,step,codigo')).catch(() => []),
      pageAll(() => supabase.from('cargo_familia').select('id,codigo,nome').order('codigo')).catch(() => []),
    ])
    setFamilias((fd as Familia[]) || [])
    setCargos(cd as Cargo[])
    const u: Record<string, number> = {}
    for (const p of pd as any[]) if (p.cargo_id) u[p.cargo_id] = (u[p.cargo_id] || 0) + 1
    setUsos(u); setSteps((sd as Step[]) || []); setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  // Confere o retorno: UPDATE barrado por RLS não dá erro — afeta zero linhas
  // e volta sucesso. Sem isto a tela mentiria.
  const gravar = async (q: any, oque: string) => {
    setErro('')
    const { data, error } = await q.select('id')
    if (error) { setErro(error.message); return }
    if (!data?.length) { setErro(`Não foi possível ${oque} — gravação recusada pelas suas permissões.`); return }
    carregar()
  }

  const porCargo = useMemo(() => {
    const m: Record<string, Step[]> = {}
    for (const s of steps) (m[s.cargo_id] ||= []).push(s)
    for (const k in m) m[k].sort((a, b) => a.step - b.step)
    return m
  }, [steps])

  const novoStep = (c: Cargo) => {
    const atuais = porCargo[c.id] || []
    const prox = atuais.reduce((m, s) => Math.max(m, s.step), 0) + 1
    const cod = window.prompt(`Código do ERP para "${c.nome}" (step ${prox}):`)?.trim()
    if (!cod) return
    gravar(supabase.from('cargo_step').insert({
      tenant_id: TENANT_ID, cargo_id: c.id, step: prox, codigo: cod,
    }), 'incluir o código')
  }

  const criar = async () => {
    const nome = window.prompt('Novo cargo:')?.trim()
    if (!nome) return
    const nm = nome.toUpperCase()
    const usados = new Set(cargos.map(c => (c.codigo || '').toUpperCase()))
    let cod = slugCargo(nm)
    for (let i = 2; usados.has(cod); i++) cod = `${slugCargo(nm).slice(0, 25)}_${i}`
    gravar(supabase.from('cargo').insert({ tenant_id: TENANT_ID, codigo: cod, nome: nm, ativo: true, origem: 'PLANO' }), 'criar o cargo')
  }

  const apagar = (c: Cargo) => {
    if ((usos[c.id] || 0) > 0) return
    const n = (porCargo[c.id] || []).length
    if (!window.confirm(`Apagar "${c.nome}"?${n ? `\n\nOs ${n} códigos do ERP dele vão junto.` : ''}`)) return
    gravar(supabase.from('cargo').delete().eq('id', c.id), 'apagar')
  }

  const famNome = useMemo(() => Object.fromEntries(familias.map(f => [f.codigo, f.nome])), [familias])
  const subs = useMemo(() => familias.filter(f => f.codigo.length === 2)
    .filter(f => cargos.some(c => c.sub_cod === f.codigo)), [familias, cargos])
  // Rótulo completo: "1 · COMERCIAL › 32 · SOLUÇÕES DE NEGÓCIOS". A área sozinha
  // não localiza e a subárea sozinha não diz de quem é.
  const rotuloSub = (sub: string) =>
    `${sub[0]} · ${famNome[sub[0]] || '—'}  ›  ${sub} · ${famNome[sub] || '—'}`

  const vis = useMemo(() => {
    const b = busca.trim().toUpperCase()
    const f = cargos
      .filter(c => !b || `${c.codigo || ''} ${c.nome}`.toUpperCase().includes(b))
      .filter(c => !subSel || c.sub_cod === subSel)
    const plano = f.filter(c => c.origem !== 'ERP')
    // Agrupa por subárea, na ordem do código; sem subárea vai para o fim —
    // é a fila de quem ainda não tem código do ERP, e tem de ficar à vista.
    const grupos: { sub: string; itens: Cargo[] }[] = []
    for (const c of [...plano].sort((a, b2) =>
      (a.sub_cod || 'zz').localeCompare(b2.sub_cod || 'zz') || a.nome.localeCompare(b2.nome))) {
      const k = c.sub_cod || ''
      if (!grupos.length || grupos[grupos.length - 1].sub !== k) grupos.push({ sub: k, itens: [] })
      grupos[grupos.length - 1].itens.push(c)
    }
    return { plano, grupos, erp: f.filter(c => c.origem === 'ERP') }
  }, [cargos, busca, subSel])

  const campo = (c: Cargo, k: keyof Cargo, tipo: 'text' | 'num' = 'text', w?: number) => (
    <input style={{ ...S.inp, ...(w ? { width: w } : {}), textAlign: tipo === 'num' ? 'right' : 'left' }}
           type={tipo === 'num' ? 'number' : 'text'} defaultValue={(c[k] as any) ?? ''}
           onFocus={e => { e.target.style.borderColor = 'var(--violet)' }}
           onBlur={e => {
             e.target.style.borderColor = 'var(--border)'
             const bruto = e.target.value.trim()
             const v = tipo === 'num' ? (bruto === '' ? null : Number(bruto)) : (k === 'codigo' || k === 'nome' ? bruto.toUpperCase() : bruto)
             if (v === (c[k] ?? (tipo === 'num' ? null : ''))) return
             if ((k === 'codigo' || k === 'nome') && !v) { e.target.value = String(c[k] ?? ''); return }
             gravar(supabase.from('cargo').update({ [k]: v }).eq('id', c.id), `gravar ${String(k)}`)
           }} />
  )

  const painel = (c: Cargo) => {
    const ss = porCargo[c.id] || []
    return (
      <tr key={c.id + '_s'}>
        <td colSpan={9} style={{ padding: '10px 14px 14px 30px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            Códigos do ERP de <b style={{ color: 'var(--text)' }}>{c.nome}</b> — um por step.
            É por eles que a amarração com o ERP se faz; o código do cargo ao lado é chave interna.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {ss.map(s => (
              <span key={s.id} style={{ ...S.pil, cursor: 'default', gap: 7 }}>
                <b style={{ color: 'var(--muted)', fontWeight: 600 }}>step {s.step}</b>
                <input defaultValue={s.codigo} style={{ ...S.inp, width: 78, padding: '2px 5px', fontSize: 12 }}
                       onFocus={e => { e.target.style.borderColor = 'var(--violet)' }}
                       onBlur={e => {
                         e.target.style.borderColor = 'var(--border)'
                         const v = e.target.value.trim()
                         if (!v) { e.target.value = s.codigo; return }
                         if (v !== s.codigo) gravar(supabase.from('cargo_step').update({ codigo: v }).eq('id', s.id), 'gravar o código')
                       }} />
                <span onClick={() => { if (window.confirm(`Apagar o código ${s.codigo}?`)) gravar(supabase.from('cargo_step').delete().eq('id', s.id), 'apagar o código') }}
                      style={{ display: 'inline-flex', color: 'var(--muted)', cursor: 'pointer' }} title="Apagar este código"><Trash2 size={12} /></span>
              </span>
            ))}
            <button style={{ ...S.btn, padding: '4px 10px', fontSize: 12 }} onClick={() => novoStep(c)}>
              <Plus size={12} /> Incluir código
            </button>
          </div>
        </td>
      </tr>
    )
  }

  const linhas = (lista: Cargo[]) => lista.flatMap(c => [(
    <tr key={c.id}>
      <td style={{ ...S.td, width: 170 }}>{campo(c, 'codigo')}</td>
      <td style={S.td}>{campo(c, 'nome')}
        {c.origem === 'ERP' && <span style={{ ...S.tag, marginLeft: 6 }} title="Veio da folha; o plano novo não o substituiu.">folha</span>}</td>
      <td style={{ ...S.td, width: 150, fontSize: 12, color: 'var(--muted)' }}
          title={c.sub_cod ? rotuloSub(c.sub_cod) : 'Sem subárea — o cargo não tem código do ERP'}>
        {c.sub_cod ? `${c.sub_cod} · ${famNome[c.sub_cod] || '—'}` : '—'}
      </td>
      <td style={{ ...S.td, width: 70 }}>{campo(c, 'nivel', 'num', 54)}</td>
      <td style={{ ...S.td, width: 120 }}>{campo(c, 'salario_ref', 'num')}</td>
      <td style={{ ...S.td, width: 70, textAlign: 'center' }}>
        <input type="checkbox" checked={c.ativo !== false}
               onChange={e => gravar(supabase.from('cargo').update({ ativo: e.target.checked }).eq('id', c.id), 'mudar o status')} />
      </td>
      <td style={{ ...S.td, width: 190 }}>
        <span style={S.pil} onClick={() => setAberto(a => a === c.id ? null : c.id)}
              title={(porCargo[c.id] || []).length
                ? `${(porCargo[c.id] || []).length} código(s) do ERP — clique para ver e editar`
                : 'Sem código do ERP — clique para incluir'}>
          <Layers size={11} />
          {faixa((porCargo[c.id] || []).map(s => s.codigo)) ||
            <i style={{ color: 'var(--orange)', fontStyle: 'normal' }}>sem código</i>}
        </span>
      </td>
      <td style={{ ...S.td, width: 70, textAlign: 'right', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
        <Users size={11} style={{ verticalAlign: -1 }} /> {usos[c.id] || 0}
      </td>
      <td style={{ ...S.td, width: 40, textAlign: 'center' }}>
        <span title={(usos[c.id] || 0) > 0 ? `${usos[c.id]} posto(s) usam este cargo` : 'Excluir'}
              onClick={() => apagar(c)}
              style={{ display: 'inline-flex', color: 'var(--muted)', opacity: (usos[c.id] || 0) > 0 ? 0.25 : 1,
                       cursor: (usos[c.id] || 0) > 0 ? 'not-allowed' : 'pointer' }}><Trash2 size={14} /></span>
      </td>
    </tr>
  ), ...(aberto === c.id ? [painel(c)] : [])])

  const semNivel = cargos.filter(c => c.origem !== 'ERP' && c.nivel == null).length

  return (
    <div>
      <p style={S.dica}>
        Tudo em caixa branca é editável — gravado ao sair do campo.
        O código do ERP lê-se <b style={{ color: 'var(--text)' }}>área · subárea · sequencial</b>
        — <i>12073</i> é área 1, subárea 2. Por isso o catálogo é por subárea: <i>AUXILIAR
        ADMINISTRATIVO</i> da Contabilidade é outro cargo que o do Financeiro. Os
        <b> Códigos ERP</b> são um por step (<i>DIRETOR FINANCEIRO</i> = 11001…11004) — clique na
        faixa para ver, editar e incluir. O <b>nível</b> é a senioridade comparável entre ramos
        (1 = aprendiz … 11 = diretor executivo); carreira se ordena por ele, não por hierarquia de
        cargo, que a <b>área funcional</b> já responde melhor.
      </p>

      {erro && <div style={S.aviso}>{erro}</div>}

      <div style={S.bar}>
        <button style={S.btn} onClick={criar}><Plus size={14} /> Novo cargo</button>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
          <input style={S.busca} placeholder="código ou nome…" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <select style={{ ...S.busca, padding: '7px 10px', minWidth: 230 }}
                value={subSel} onChange={e => setSubSel(e.target.value)}>
          <option value="">Todas as subáreas</option>
          {subs.map(f => <option key={f.codigo} value={f.codigo}>{f.codigo} · {f.nome}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          {vis.plano.length} no plano{semNivel > 0 && ` (${semNivel} sem nível)`} · {vis.erp.length} da folha
        </span>
      </div>

      {loading ? <div style={S.dica}>Carregando…</div> : (
        <table style={S.tab}>
          <thead><tr>
            {['Código', 'Nome', 'Subárea', 'Nível', 'Salário ref.', 'Ativo', 'Códigos ERP', 'Postos', ''].map((h, i) =>
              <th key={i} style={{ ...S.th, textAlign: i === 7 ? 'right' : 'left' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {vis.grupos.map(g => (
              <Fragment key={g.sub || '_sem'}>
                <tr><td colSpan={9} style={S.sec}>
                  {g.sub ? rotuloSub(g.sub) : 'Sem subárea · ainda sem código do ERP'}
                  <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', color: 'var(--muted)' }}>
                    {g.itens.length} cargo{g.itens.length > 1 ? 's' : ''}</span>
                </td></tr>
                {linhas(g.itens)}
              </Fragment>
            ))}
            {vis.erp.length > 0 && <>
              <tr><td colSpan={9} style={S.sec}>Vindos da folha · ainda sem par no plano</td></tr>
              {linhas(vis.erp)}
            </>}
          </tbody>
        </table>
      )}
    </div>
  )
}
