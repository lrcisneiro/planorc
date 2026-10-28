// Carga do formulário a partir de uma tabela larga (12 meses em colunas).
// Ref.: docs/DESIGN_receitas.md — o estudo do baseline devolve CSV neste formato
// e a calibragem é iterativa, então isto roda muitas vezes, não uma.
//
// Formato esperado (separador `;` ou `,`, decimal com vírgula ou ponto):
//   empresa;filial;cc;linha;jan;fev;…;dez
//
// Por que LARGO e não longo: 60 escopos × 8 drivers × 12 meses são 5.760 linhas
// no formato longo. Em colunas são 480 — emitíveis por um modelo e conferíveis
// no Excel.

export type LinhaCsv = {
  empresa: string; filial: string; cc: string; linha: string
  valores: (number | null)[]        // 12 posições, null = célula vazia
}
export type ParseResult = {
  linhas: LinhaCsv[]
  escopos: number
  erros: string[]                   // problemas de FORMA (não de cadastro)
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// "3908,71" e "3.908,71" → vírgula é decimal; "3908.71" → ponto é decimal
// quando não há vírgula. Mesma regra do resto do projeto.
export const parseNumBr = (s: string): number | null => {
  const r = (s || '').trim()
  if (!r) return null
  const v = r.includes(',') ? parseFloat(r.replace(/\./g, '').replace(',', '.')) : parseFloat(r)
  return isFinite(v) ? v : null
}

// Detecta o separador pela linha de cabeçalho: vence quem aparece mais. Com
// decimal em vírgula, um CSV separado por vírgula seria ambíguo — mas o
// cabeçalho não tem números, então ali a contagem é confiável.
const separador = (hdr: string) => (hdr.match(/;/g)?.length || 0) >= (hdr.match(/,/g)?.length || 0) ? ';' : ','

const campos = (l: string, sep: string): string[] => {
  const out: string[] = []; let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === sep) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}

export function parseFormularioCsv(texto: string): ParseResult {
  const erros: string[] = []
  const linhasTxt = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length)
  if (!linhasTxt.length) return { linhas: [], escopos: 0, erros: ['Arquivo vazio.'] }

  const sep = separador(linhasTxt[0])
  const hdr = campos(linhasTxt[0], sep).map(h => h.trim().toLowerCase())
  const idx = (n: string) => hdr.indexOf(n)
  const iEmp = idx('empresa'), iFil = idx('filial'), iCc = idx('cc'), iLin = idx('linha')
  if (iEmp < 0 || iFil < 0 || iCc < 0 || iLin < 0) {
    return { linhas: [], escopos: 0, erros: [`Cabeçalho precisa de empresa, filial, cc e linha. Veio: ${hdr.join(', ')}`] }
  }
  const iMes = MESES.map(m => idx(m))
  const faltam = MESES.filter((_, k) => iMes[k] < 0)
  if (faltam.length) erros.push(`Faltam colunas de mês: ${faltam.join(', ')} — esses meses ficarão vazios.`)

  const linhas: LinhaCsv[] = []
  const escopos = new Set<string>()
  const vistos = new Set<string>()
  for (let n = 1; n < linhasTxt.length; n++) {
    const f = campos(linhasTxt[n], sep)
    const g = (i: number) => (f[i] ?? '').trim()
    const empresa = g(iEmp), filial = g(iFil), cc = g(iCc), linha = g(iLin).toUpperCase()
    if (!empresa && !filial && !cc && !linha) continue
    if (!empresa || !linha) { erros.push(`Linha ${n + 1}: empresa ou código de linha em branco — ignorada.`); continue }
    // Duplicada silenciosa é o pior caso: a segunda sobrescreveria a primeira
    // e o total mudaria sem nada na tela acusar.
    const chave = `${empresa}|${filial}|${cc}|${linha}`
    if (vistos.has(chave)) { erros.push(`Linha ${n + 1}: ${chave} repetida — fica a ÚLTIMA.`) }
    vistos.add(chave)
    escopos.add(`${empresa}|${filial}|${cc}`)
    linhas.push({ empresa, filial, cc, linha, valores: iMes.map(i => i < 0 ? null : parseNumBr(g(i))) })
  }
  return { linhas, escopos: escopos.size, erros }
}
