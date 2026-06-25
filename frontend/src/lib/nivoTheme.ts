// ============================================================
// Tema do nivo (gráficos) — lê as CSS variables do tema atual.
// O nivo aplica cor como atributo/estilo SVG e NÃO resolve var(),
// então aqui resolvemos os valores em runtime (getComputedStyle).
// Chamar como prop:  <ResponsiveBar theme={nivoTheme()} ... />
// ============================================================
export function nivoTheme(): any {
  const cs = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const g = (name: string, fb: string) => (cs?.getPropertyValue(name).trim() || fb)
  const text  = g('--text', '#e8e8f0')
  const mid   = g('--text-mid', '#b4b4c4')
  const grid  = g('--border-strong', 'rgba(255,255,255,0.12)')
  const panel = g('--panel', '#14141d')
  return {
    text: { fill: text, fontSize: 11, fontFamily: 'inherit' },
    axis: {
      domain: { line: { stroke: grid, strokeWidth: 1 } },
      ticks:  { line: { stroke: grid, strokeWidth: 1 }, text: { fill: mid, fontSize: 11 } },
      legend: { text: { fill: text, fontSize: 12 } },
    },
    grid:    { line: { stroke: grid, strokeWidth: 0.5 } },
    legends: { text: { fill: text, fontSize: 11 } },
    labels:  { text: { fill: text, fontSize: 11 } },
    tooltip: { container: { background: panel, color: text, fontSize: 12, borderRadius: 8, border: `1px solid ${grid}` } },
  }
}
