// ============================================================
// Engine de cálculo compartilhado (Relatório e Formulário)
// - Fórmula de LINHA (linha.expressao) e de CÉLULA (raw.expressao)
// - Funções PT (ANTERIOR, MEDIANA, ARREDONDAR.*, SE, ...)
// - Períodos como lista ordenada (suporta multi-ano)
// ============================================================
import { evaluate } from 'mathjs'

export type TipoLinha = 'SOMAR_FILHOS' | 'ANALITICA' | 'FORMULA' | 'INDICADOR' | 'ESPACO'
export type Formato   = 'NUMERO' | 'PERCENTUAL' | 'MOEDA'

export type LinhaCalc = {
  id: string
  pai_id: string | null
  codigo: string
  tipo_linha: TipoLinha
  expressao: string | null
  desativada?: boolean   // exibe valor (tachado) mas não entra em somas/refs
  nao_soma?: boolean     // calcula e é referenciável, mas fica FORA do SOMAR_FILHOS (linha de apoio/indicador)
}

export type Periodo = { ano: number; mes: number }
export const pkey = (p: Periodo) => `${p.ano}-${p.mes}`

// raw[linhaId][periodKey] = { valor?, expressao? }
export type CellRaw    = { valor?: number | null; expressao?: string | null }
export type RawValues  = Record<string, Record<string, CellRaw>>
export type Computed   = Record<string, Record<string, number>>

// ── Mapeia funções PT (com pontos) → nomes válidos do mathjs ──
function normalizeFns(s: string): string {
  return s
    .replace(/ARREDONDAR\s*\.\s*PARA\s*\.\s*BAIXO/gi, 'floor')
    .replace(/ARREDONDAR\s*\.\s*PARA\s*\.\s*CIMA/gi, 'ceil')
    .replace(/ARREDONDAR/gi, 'round')
    .replace(/MEDIANA/gi, 'median')
    .replace(/\bMEDIA\b/gi, 'mean')
    .replace(/\bSOMA\b/gi, 'sum')
    .replace(/\bMINIMO\b/gi, 'min')
    .replace(/\bMAXIMO\b/gi, 'max')
}

// Converte o padrão brasileiro p/ o do mathjs:
//   vírgula = decimal (1,05 → 1.05) · ponto-e-vírgula = separador de args (; → ,)
function brToMath(s: string): string {
  return s.replace(/,/g, '.').replace(/;/g, ',')
}

// Funções customizadas disponíveis no escopo do mathjs
const SCOPE = {
  SE: (cond: any, a: any, b: any) => (cond ? a : b),
  CONCATENAR: (...args: any[]) => args.map(String).join(''),
}

// Avalia a expressão (de linha ou célula) num período.
function evalExpr(
  expr: string | null,
  lineId: string,
  idx: number,
  periodos: Periodo[],
  result: Computed,
  cur: Record<string, number>,
  codeToId: Record<string, string>,
  disabled: Set<string>,
): number {
  if (!expr) return 0
  let s = expr.trim().replace(/^=/, '').trim()
  if (!s) return 0
  const prevKey = (n: number) => (idx - n >= 0 ? pkey(periodos[idx - n]) : null)
  const off = (c: string) => disabled.has(codeToId[c])   // referência a linha desativada → 0
  try {
    // ANTERIOR([cod], N)  (aceita , ou ; como separador)
    s = s.replace(/ANTERIOR\s*\(\s*\[([^\]]+)\]\s*[,;]\s*(\d+)\s*\)/gi, (_m, c, n) => {
      if (off(c)) return '0'; const k = prevKey(Number(n)); return String((k && result[codeToId[c]]?.[k]) ?? 0)
    })
    // ANTERIOR([cod])
    s = s.replace(/ANTERIOR\s*\(\s*\[([^\]]+)\]\s*\)/gi, (_m, c) => {
      if (off(c)) return '0'; const k = prevKey(1); return String((k && result[codeToId[c]]?.[k]) ?? 0)
    })
    // ANTERIOR()  → mês anterior desta linha
    s = s.replace(/ANTERIOR\s*\(\s*\)/gi, () => {
      const k = prevKey(1); return String((k && result[lineId]?.[k]) ?? 0)
    })
    // [cod] → valor no período atual
    s = s.replace(/\[([^\]]+)\]/g, (_m, c) => String(off(c) ? 0 : (cur[codeToId[c]] ?? 0)))
    s = brToMath(normalizeFns(s))
    const v = evaluate(s, SCOPE as any)
    return typeof v === 'number' && isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

// Calcula valores de todas as linhas para a lista de períodos (ordenada).
export function computeCenario(linhas: LinhaCalc[], raw: RawValues, periodos: Periodo[]): Computed {
  const codeToId: Record<string, string> = {}
  linhas.forEach(l => { codeToId[l.codigo] = l.id })
  const disabled = new Set(linhas.filter(l => l.desativada).map(l => l.id))
  const childrenOf: Record<string, LinhaCalc[]> = {}
  linhas.forEach(l => { const p = l.pai_id ?? '__root'; (childrenOf[p] ||= []).push(l) })

  const result: Computed = {}
  linhas.forEach(l => { result[l.id] = {} })

  for (let idx = 0; idx < periodos.length; idx++) {
    const key = pkey(periodos[idx])
    const cur: Record<string, number> = {}
    const passes = linhas.length + 2
    for (let p = 0; p < passes; p++) {
      for (const l of linhas) {
        let v = 0
        if (l.tipo_linha === 'ESPACO') v = 0
        else if (l.tipo_linha === 'SOMAR_FILHOS') {
          v = (childrenOf[l.id] || [])
            .filter(c => c.tipo_linha !== 'INDICADOR' && c.tipo_linha !== 'ESPACO' && !disabled.has(c.id) && !c.nao_soma)
            .reduce((s, c) => s + (cur[c.id] ?? 0), 0)
        } else if (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') {
          v = evalExpr(l.expressao, l.id, idx, periodos, result, cur, codeToId, disabled)
        } else { // ANALITICA
          const cell = raw[l.id]?.[key]
          v = cell?.expressao
            ? evalExpr(cell.expressao, l.id, idx, periodos, result, cur, codeToId, disabled)
            : (cell?.valor ?? 0)
        }
        cur[l.id] = v
      }
    }
    for (const l of linhas) result[l.id][key] = cur[l.id]
  }
  return result
}

// Total da linha sobre o conjunto de períodos (respeitando o tipo).
export function computeTotais(linhas: LinhaCalc[], computed: Computed, periodos: Periodo[]): Record<string, number> {
  const codeToId: Record<string, string> = {}
  linhas.forEach(l => { codeToId[l.codigo] = l.id })
  const disabled = new Set(linhas.filter(l => l.desativada).map(l => l.id))
  const childrenOf: Record<string, LinhaCalc[]> = {}
  linhas.forEach(l => { const p = l.pai_id ?? '__root'; (childrenOf[p] ||= []).push(l) })

  const totals: Record<string, number> = {}
  const passes = linhas.length + 2
  for (let p = 0; p < passes; p++) {
    for (const l of linhas) {
      let v = 0
      if (l.tipo_linha === 'ESPACO') v = 0
      else if (l.tipo_linha === 'SOMAR_FILHOS') {
        v = (childrenOf[l.id] || [])
          .filter(c => c.tipo_linha !== 'INDICADOR' && c.tipo_linha !== 'ESPACO' && !disabled.has(c.id))
          .reduce((s, c) => s + (totals[c.id] ?? 0), 0)
      } else if (l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') {
        // avalia sobre os totais (sem dimensão temporal: ANTERIOR → 0)
        let s = (l.expressao || '').trim().replace(/^=/, '').trim()
        if (s) {
          try {
            s = s.replace(/ANTERIOR\s*\([^)]*\)/gi, '0')
            s = s.replace(/\[([^\]]+)\]/g, (_m, c) => String(disabled.has(codeToId[c]) ? 0 : (totals[codeToId[c]] ?? 0)))
            s = brToMath(normalizeFns(s))
            const r = evaluate(s, SCOPE as any)
            v = typeof r === 'number' && isFinite(r) ? r : 0
          } catch { v = 0 }
        }
      } else { // ANALITICA: soma dos períodos
        v = periodos.reduce((acc, per) => acc + (computed[l.id]?.[pkey(per)] ?? 0), 0)
      }
      totals[l.id] = v
    }
  }
  return totals
}

// Acumulado (YTD) de uma linha até um período, dentro do mesmo ano.
export function acmAte(computed: Computed, linhaId: string, ate: Periodo): number {
  const row = computed[linhaId] || {}
  let s = 0
  for (let m = 1; m <= ate.mes; m++) s += row[`${ate.ano}-${m}`] ?? 0
  return s
}

// ── Formatação ──
export function formatValor(v: number, formato: Formato = 'NUMERO', casas = 0): string {
  if (!isFinite(v)) return ''
  if (formato === 'PERCENTUAL') {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%'
  }
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export function parseNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
}

// Gera os 12 meses de um ano como lista de períodos.
export function mesesDoAno(ano: number): Periodo[] {
  return Array.from({ length: 12 }, (_, i) => ({ ano, mes: i + 1 }))
}
