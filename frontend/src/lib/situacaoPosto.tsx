import type { CSSProperties } from 'react'

// ============================================================
// Situação do posto — regra e seletor, compartilhados.
//
// FONTE quando há, dedução quando não há. A folha define isso bem
// (`RA_SITFOLH`, uma letra: D demitido, A afastado, F férias, vazio
// trabalhando), a *Relação de Funcionários* traz a coluna e a importação
// carimba em `posto.sit_folha` (v3_152). A reserva é a janela
// `afast_ini`/`afast_fim` do posto, com referência no mês corrente —
// afastamento é estado com data, não atributo.
//
// ⚠ Férias NÃO é dedutível de nada. Antes de `sit_folha` existir, as 14 pessoas
// em férias contavam como ativas e não havia como saber.
//
// ⚠⚠ **NÃO usar este filtro em tela organizada por COMPETÊNCIA** — Folha
// realizada, Apontamento, Conciliação. `sit_folha` é um retrato do momento da
// importação, sobrescrito na carga seguinte; usá-lo lá esconderia linhas de
// março com a situação de outubro, e quem foi demitido em outubro trabalhou e
// foi pago em março. O número mudaria sem dizer por quê. Para servir ali, a
// situação teria de ser histórica, por competência — outro desenho.
// Vale para "como está o quadro HOJE": Postos, Memória de cálculo, Organograma.
// ============================================================

export type Situacao = 'ativo' | 'afastado' | 'ferias' | 'demitido'

export const SITUACOES: { k: Situacao; rot: string; cor: string; rgb: string }[] = [
  { k: 'ativo',    rot: 'Ativos',    cor: 'var(--green)',  rgb: '34,197,94' },
  { k: 'afastado', rot: 'Afastados', cor: 'var(--orange)', rgb: '251,146,60' },
  { k: 'ferias',   rot: 'Férias',    cor: 'var(--blue)',   rgb: '59,130,246' },
  { k: 'demitido', rot: 'Demitidos', cor: 'var(--red)',    rgb: '239,68,68' },
]

export const corSit = (s: Situacao): CSSProperties => {
  const c = SITUACOES.find(x => x.k === s)!
  return { color: c.cor, borderColor: `rgba(${c.rgb},0.4)`, background: `rgba(${c.rgb},0.12)` }
}

export const tagSit: CSSProperties = {
  fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
  border: '1px solid', borderRadius: 5, padding: '1px 5px',
}

export type PostoSit = {
  ativo?: boolean | null; sit_folha?: string | null
  afast_ini_ano?: number | null; afast_ini_mes?: number | null
  afast_fim_ano?: number | null; afast_fim_mes?: number | null
}

export function situacaoPosto(p: PostoSit): Situacao {
  const f = (p.sit_folha || '').toUpperCase()
  if (f === 'D') return 'demitido'
  if (f === 'A') return 'afastado'
  if (f === 'F') return 'ferias'
  if (p.ativo === false) return 'demitido'
  if (p.afast_ini_ano) {
    const d = new Date()
    const ref = d.getFullYear() * 100 + (d.getMonth() + 1)
    const ini = p.afast_ini_ano * 100 + (p.afast_ini_mes || 1)
    const fim = p.afast_fim_ano ? p.afast_fim_ano * 100 + (p.afast_fim_mes || 12) : Infinity
    if (ref >= ini && ref <= fim) return 'afastado'
  }
  return 'ativo'
}

/** Seletor multi-estado. `universo` serve só para a contagem de cada botão —
 *  ver quantos existem antes de marcar evita marcar à toa. */
export function SeletorSituacao({ sel, setSel, universo, compacto }: {
  sel: Situacao[]; setSel: (f: (v: Situacao[]) => Situacao[]) => void
  universo?: PostoSit[]; compacto?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 2, border: '1px solid var(--border-strong)', borderRadius: 8, overflow: 'hidden' }}>
      {SITUACOES.map(({ k, rot, cor }) => {
        const on = sel.includes(k)
        const n = universo?.filter(p => situacaoPosto(p) === k).length
        return (
          <button key={k} title={n != null ? `${n} posto(s)` : undefined}
            onClick={() => setSel(v => v.includes(k) ? v.filter(x => x !== k) : [...v, k])}
            style={{ display: 'flex', alignItems: 'center', gap: 5,
                     padding: compacto ? '6px 8px' : '7px 10px', fontSize: compacto ? 12 : 12.5,
                     border: 'none', cursor: 'pointer', fontWeight: 600,
                     background: on ? 'rgba(139,92,246,0.16)' : 'transparent',
                     color: on ? 'var(--violet)' : 'var(--muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: on ? cor : 'var(--border-strong)' }} />
            {rot}{n != null && <span style={{ opacity: 0.6, fontWeight: 400 }}>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
