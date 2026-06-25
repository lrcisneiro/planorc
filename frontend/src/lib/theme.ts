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

// ===== Persistência da preferência de tema (localStorage) =====
const THEME_KEY = 'planorc-theme'

export function getTheme(): 'dark' | 'light' {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}

export function setTheme(mode: 'dark' | 'light') {
  if (mode === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  try { localStorage.setItem(THEME_KEY, mode) } catch { /* ignora */ }
}

// Aplica o tema salvo no carregamento (chamar cedo, antes de renderizar).
export function initTheme() {
  const mode = getTheme()
  if (mode === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
}
