// Rótulo de EIXO de gráfico — não é rótulo de tabela.
//
// ⚠ Com o número cheio ("5.000.000"), as marcas do eixo X encostam umas nas
// outras e viram borrão: o eixo deixa de informar escala, que é a única função
// dele ali. O valor exato continua na ponta da barra, no rótulo do item e na
// tabela — o eixo só precisa dizer a ordem de grandeza.
//
// Uma casa decimal no milhão porque "1 mi" e "1,4 mi" são escalas diferentes;
// nenhuma no milhar, onde a diferença não muda a leitura.
//
// ⚠ Mora em `lib/` de propósito: já existiam `fmtK` (DashboardPage, divide por
// MIL — 13,7 milhões viram "13770k") e `fmtC` (ComparativoAnual). Três eixos
// com três convenções fazem os dashboards parecerem de produtos diferentes.
// Ao mexer em eixo de gráfico, usar este.
export const fmtEixo = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (a >= 1e3) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
