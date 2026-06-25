// ============================================================
// Tokens de tema v2 — apontam para CSS variables (ver index.css).
// Trocar tema em runtime:  document.documentElement.dataset.theme = 'light'
// Uso:  import { T } from '../../lib/theme';  style={{ color: T.text }}
// ============================================================
export const T = {
  // superfícies
  bg:      'var(--bg)',
  bgSoft:  'var(--bg-soft)',
  panel:   'var(--panel)',
  panel2:  'var(--panel-2)',
  border:  'var(--border)',
  borderS: 'var(--border-strong)',
  // texto
  text:    'var(--text)',
  textMid: 'var(--text-mid)',
  muted:   'var(--muted)',
  faint:   'var(--faint)',
  // acentos semânticos
  violet:  'var(--violet)',
  violetD: 'var(--violet-d)',
  blue:    'var(--blue)',
  green:   'var(--green)',
  red:     'var(--red)',
  orange:  'var(--orange)',
  cyan:    'var(--cyan)',
} as const

export type Theme = typeof T

// Helper opcional para alternar tema (use quando criar o interruptor de UI)
export function setTheme(mode: 'dark' | 'light') {
  if (mode === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
}
