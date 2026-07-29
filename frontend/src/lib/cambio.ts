// Conversão multimoeda — modelo MATERIALIZADO por slots (ver docs/ESTUDO_multimoeda.md).
// Slot 1 = moeda-base/reporting (BRL); taxa(1) = 1. Slots ≥ 2 têm cotação vs a base.
// `taxa(slot)` = quantas unidades da BASE por 1 unidade da moeda do slot (ex.: 5,20 BRL/USD).
// Convenção de colunas: slot 1 → `valor` (val_m1), slot 2 → val_m2, slot 3 → val_m3.

export type CambioRow = { moeda_slot: number; data: string; taxa: number }
export type VersaoTaxaRow = { moeda_slot: number; ano: number | null; mes: number | null; taxa: number }

// último dia do mês em ISO (YYYY-MM-DD) — taxa representativa de um fato mensal
export function fimDoMes(ano: number, mes: number): string {
  const d = new Date(ano, mes, 0)   // dia 0 do mês seguinte = último dia de `mes`
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// taxa REAL na data, com carry-forward (última cotação com data ≤ alvo). slot 1 = 1.
export function taxaRealizada(slot: number, dataISO: string, cambio: CambioRow[]): number | null {
  if (slot === 1) return 1
  let best: CambioRow | null = null
  for (const c of cambio) if (c.moeda_slot === slot && c.data <= dataISO && (!best || c.data > best.data)) best = c
  return best ? Number(best.taxa) : null
}

// taxa ORÇADA da versão (mês-específica tem precedência sobre a constante). slot 1 = 1.
export function taxaOrcada(slot: number, ano: number, mes: number, taxas: VersaoTaxaRow[]): number | null {
  if (slot === 1) return 1
  let esp: VersaoTaxaRow | null = null, cte: VersaoTaxaRow | null = null
  for (const t of taxas) {
    if (t.moeda_slot !== slot) continue
    if (t.ano === ano && t.mes === mes) esp = t
    else if (t.ano == null && t.mes == null) cte = t
  }
  const t = esp || cte
  return t ? Number(t.taxa) : null
}

// Materializa um valor (na moeda de origem) nos slots ativos, triangulando pela base.
// Retorna { vals: {slot→valor|null}, semTaxa: slots sem cotação }. Se a taxa da ORIGEM
// falta, só o próprio slot é preenchido (a base fica null → o chamador decide pular).
export function materializa(valor: number, slotOrigem: number, slotsAtivos: number[], taxa: (slot: number) => number | null): { vals: Record<number, number | null>; semTaxa: number[] } {
  const vals: Record<number, number | null> = {}
  const semTaxa: number[] = []
  vals[slotOrigem] = valor
  const tOrig = taxa(slotOrigem)
  if (tOrig == null) { for (const s of slotsAtivos) if (s !== slotOrigem) { vals[s] = null; semTaxa.push(s) }; return { vals, semTaxa } }
  const vBase = valor * tOrig   // em BRL (slot 1)
  for (const s of slotsAtivos) {
    if (s === slotOrigem) continue
    const tS = taxa(s)
    if (tS == null || tS === 0) { vals[s] = null; semTaxa.push(s); continue }
    vals[s] = vBase / tS
  }
  return { vals, semTaxa }
}
