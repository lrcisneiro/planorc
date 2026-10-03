// Encurtar nome de pessoa para caber em grade e em histórico contábil.
//
// Regra (Ricardo, 01/out/2026): o PRIMEIRO nome e o SOBRENOME ficam por
// extenso; os do meio viram inicial. "Aldo Ianelo Guerra" → "Aldo I. Guerra".
// A versão anterior abreviava o primeiro nome ("A. Guerra"), o que apagava
// justamente como a pessoa é chamada.
//
// Com `max`, encolhe por etapas, sacrificando sempre o que identifica menos:
// iniciais do meio → sobrenome → primeiro nome. Nunca estoura o limite, porque
// num arquivo posicional um caractere a mais desloca todos os campos seguintes.

// não viram inicial: sumir com elas lê melhor do que "Joao D. Silva"
const PREP = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'])
// pertencem ao sobrenome: separá-los deixaria "H. Jr", que não identifica ninguém
const SUFX = new Set(['JR', 'JUNIOR', 'NETO', 'FILHO', 'SOBRINHO', 'II', 'III', 'IV'])

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

export function nomeCurto(nome: string, max = Infinity): string {
  const bruto = (nome || '').trim()
  if (!bruto) return ''
  const ps = bruto.split(/\s+/).filter(w => w && !PREP.has(semAcento(w).toUpperCase()))
  if (!ps.length) return ''
  if (ps.length === 1) return tc(ps[0]).slice(0, max)

  let fim = ps.length - 1
  if (SUFX.has(semAcento(ps[fim]).toUpperCase()) && fim > 1) fim--

  const primeiro = tc(ps[0])
  const sobren = ps.slice(fim).map(tc).join(' ')
  const meios = ps.slice(1, fim).map(w => w[0].toUpperCase() + '.')

  for (const t of [
    [primeiro, ...meios, sobren].join(' '),
    `${primeiro} ${sobren}`,
    `${primeiro} ${sobren[0].toUpperCase()}.`,
    primeiro,
  ]) if (t.length <= max) return t
  return primeiro.slice(0, max)
}
