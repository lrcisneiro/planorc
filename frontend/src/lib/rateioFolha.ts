// Cascata de rateio: aplica os códigos anexados ao posto sobre a origem
// (empresa/CC do posto) → células finais (fração do total). Usado pela memória
// (RateioModal) e pelo Aplicar no orçado. Uma célula = destino (empresa×CC) com
// a fração acumulada da cascata; sem códigos = 1 célula na própria origem (100%).

export type RateioCell = { empresa_id: string | null; cc_id: string | null; pct: number }
export type RateioDest = { empresa_id?: string | null; cc_id?: string | null; pct: number }
export type RateioCod = { id: string; nome?: string; dimensao: string }
export type Anexo = { regra_id: string; ordem: number }

export type CascataStep = { cod: RateioCod; ordem: number; dests: RateioDest[] }

export function cascataRateio(
  origem: { empresa_id: string | null; cc_id: string | null },
  anexos: Anexo[],
  rateioCods: RateioCod[],
  destByRegra: Record<string, RateioDest[]>,
): { steps: CascataStep[]; cells: RateioCell[] } {
  const steps: CascataStep[] = [...anexos]
    .sort((a, b) => a.ordem - b.ordem)
    .map(a => ({ cod: rateioCods.find(c => c.id === a.regra_id)!, ordem: a.ordem, dests: destByRegra[a.regra_id] || [] }))
    .filter(s => s.cod)

  let cells: RateioCell[] = [{ empresa_id: origem.empresa_id, cc_id: origem.cc_id || null, pct: 1 }]
  for (const s of steps) {
    if (!s.dests.length) continue
    const dim = s.cod.dimensao
    const next: RateioCell[] = []
    for (const c of cells) for (const d of s.dests) next.push({
      empresa_id: dim === 'EMPRESA' ? (d.empresa_id ?? null) : c.empresa_id,
      cc_id: dim === 'CC' ? (d.cc_id ?? null) : c.cc_id,
      pct: c.pct * ((Number(d.pct) || 0) / 100),
    })
    cells = next
  }

  // consolida células iguais (mesma empresa+cc)
  const map = new Map<string, RateioCell>()
  for (const c of cells) { const k = `${c.empresa_id}|${c.cc_id}`; const e = map.get(k); if (e) e.pct += c.pct; else map.set(k, { ...c }) }
  return { steps, cells: [...map.values()].sort((a, b) => b.pct - a.pct) }
}
