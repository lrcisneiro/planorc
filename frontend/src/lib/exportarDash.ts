// ============================================================
// Exportar dashboard como imagem (PNG) ou PDF.
//
// Captura o próprio DOM da tela (WYSIWYG: sai no tema em que você está vendo),
// pulando o que estiver marcado com `data-noexport` — a barra de filtros, por
// exemplo, não precisa aparecer na imagem; o contexto dos filtros vai no
// cabeçalho do PDF via `legenda`.
//
// As libs vêm do CDN em import dinâmico (mesmo padrão do SheetJS no app):
// só baixa quando alguém clica em exportar, e não entra no bundle.
// ============================================================
const CDN_IMG = 'https://esm.sh/html-to-image@1.11.13'
const CDN_PDF = 'https://esm.sh/jspdf@2.5.2'

export type ExportarOpts = {
  nome: string        // nome do arquivo, sem extensão
  titulo?: string     // cabeçalho do PDF
  legenda?: string    // 2ª linha do cabeçalho (resumo dos filtros/período)
}

const cssVar = (nome: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || fallback

/** Não exporta nós marcados com data-noexport (nem seus filhos). */
const semNoExport = (n: any) => !(n instanceof HTMLElement) || !n.hasAttribute('data-noexport')

type Restaurar = () => void

/**
 * Esconde de verdade os `data-noexport` (e não só no clone): a imagem é medida
 * pelo elemento real, então filtrar só no clone deixaria uma faixa vazia do
 * tamanho da barra no rodapé do PNG.
 */
function esconderBarras(el: HTMLElement): Restaurar {
  const antes: { e: HTMLElement; display: string }[] = []
  el.querySelectorAll<HTMLElement>('[data-noexport]').forEach(e => {
    antes.push({ e, display: e.style.display })
    e.style.display = 'none'
  })
  return () => antes.forEach(({ e, display }) => { e.style.display = display })
}

/**
 * Abre o que rola por dentro (tabelão em card com `overflow:auto`, por ex.).
 * Sem isso a captura sai cortada no limite visível — e corta MAIS quando o menu
 * lateral está aberto, porque sobra menos largura para o conteúdo.
 */
function expandirRolagens(el: HTMLElement): Restaurar {
  const antes: { e: HTMLElement; overflow: string; width: string; height: string; maxHeight: string }[] = []
  // 1) só leitura (medir tudo antes de escrever evita um reflow por elemento)
  const alvos: { e: HTMLElement; w: number | null; h: number | null }[] = []
  for (const e of [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))]) {
    if (e !== el && e.offsetParent === null) continue          // já escondido (data-noexport, modal fechado)
    const cs = getComputedStyle(e)
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
    const rolaX = e.scrollWidth > e.clientWidth + 1
    const rolaY = e.scrollHeight > e.clientHeight + 1
    if (!rolaX && !rolaY) continue
    alvos.push({ e, w: rolaX ? e.scrollWidth : null, h: rolaY ? e.scrollHeight : null })
  }
  // 2) só escrita
  for (const { e, w, h } of alvos) {
    antes.push({ e, overflow: e.style.overflow, width: e.style.width, height: e.style.height, maxHeight: e.style.maxHeight })
    if (w != null) e.style.width = `${w}px`
    if (h != null) { e.style.height = `${h}px`; e.style.maxHeight = 'none' }
    e.style.overflow = 'visible'
  }
  return () => antes.forEach(({ e, overflow, width, height, maxHeight }) => {
    e.style.overflow = overflow; e.style.width = width; e.style.height = height; e.style.maxHeight = maxHeight
  })
}

async function paraPng(el: HTMLElement): Promise<{ dataUrl: string; w: number; h: number; blocos: Bloco[] }> {
  const { toPng } = await import(/* @vite-ignore */ CDN_IMG)
  const restaurar: Restaurar[] = [esconderBarras(el), expandirRolagens(el)]
  let dataUrl: string
  let blocos: Bloco[] = []
  try {
    // mede DEPOIS de esconder/expandir: a largura real pode ter crescido
    void el.offsetHeight
    const largura = Math.max(el.scrollWidth, el.offsetWidth)
    const altura = Math.max(el.scrollHeight, el.offsetHeight)
    // ⚠ MEDIR AQUI, não antes nem depois: as barras `data-noexport` já estão
    // escondidas e as rolagens expandidas, então as posições são as MESMAS que
    // a imagem vai ter. Medido fora deste bloco, cada card estaria deslocado
    // pela altura da barra de filtros — e o corte cairia no lugar errado com
    // ar de acerto.
    blocos = medirBlocos(el, largura, altura)
    dataUrl = await toPng(el, {
      pixelRatio: 2,
      backgroundColor: cssVar('--bg', '#ffffff'),
      filter: semNoExport,
      width: largura,
      height: altura,
      style: { margin: '0', width: `${largura}px`, height: `${altura}px` },
    })
  } finally {
    restaurar.reverse().forEach(f => f())
  }
  const img = await carregar(dataUrl)
  // A escala sai da própria imagem (pixelRatio 2, mas não se supõe): os blocos
  // foram medidos em px de CSS e o corte acontece em px da imagem.
  const escala = img.naturalWidth / Math.max(1, el.scrollWidth, el.offsetWidth)
  return {
    dataUrl, w: img.naturalWidth, h: img.naturalHeight,
    blocos: blocos.map(b => ({ y0: b.y0 * escala, y1: b.y1 * escala })),
  }
}

/** Um retângulo que não deve ser partido entre páginas. */
type Bloco = { y0: number; y1: number }

/**
 * Os cards da tela, em px de CSS relativos ao topo do `el`.
 *
 * ⚠⚠ POR HEURÍSTICA, e declarada: o que define "card" neste app é ter canto
 * arredondado (`S.card`, `S.sec` e `S.panel` usam 10 a 14px). Um atributo
 * explícito em toda tela seria mais exato e teria o defeito conhecido do
 * projeto — o motor pronto e a marcação esquecida na tela nova, que então
 * volta a cortar no meio sem ninguém entender por quê. `data-bloco` existe
 * como escape para quem quiser ser explícito.
 *
 * ⚠ Botão também tem canto arredondado: por isso o piso de altura.
 */
function medirBlocos(el: HTMLElement, largura: number, altura: number): Bloco[] {
  const base = el.getBoundingClientRect()
  const explicitos = el.querySelectorAll<HTMLElement>('[data-bloco]')
  const alvos = explicitos.length ? Array.from(explicitos)
    : Array.from(el.querySelectorAll<HTMLElement>('*')).filter(e => {
        if (e.offsetParent === null) return false
        const r = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0
        return r >= 8
      })
  const out: Bloco[] = []
  for (const e of alvos) {
    const r = e.getBoundingClientRect()
    const y0 = r.top - base.top, y1 = r.bottom - base.top
    // ⚠ Quem descarta o bloco ALTO DEMAIS é `cortesDePagina`, que conhece a
    // altura da página — aqui só se sabe a do documento. A primeira versão
    // filtrava por `altura` e o filtro nunca filtrava nada.
    if (r.height < 36) continue
    if (y1 <= 0 || y0 >= altura) continue
    out.push({ y0, y1 })
  }
  void largura
  return out.sort((a, b) => a.y0 - b.y0)
}

/**
 * Onde cortar, em px da imagem. Devolve os limites [0, …, h].
 *
 * ⚠ O corte RECUA para o topo do card atravessado — nunca avança. Avançar
 * deixaria a página anterior maior que o papel, e o excedente sumiria.
 * ⚠ Recuo com piso: sem ele, uma sequência de cards altos geraria páginas com
 * dois dedos de conteúdo. Abaixo do piso vale o corte cego, que é o
 * comportamento antigo — pior que cortar entre cards, melhor que desperdiçar
 * meia dúzia de páginas.
 */
export function cortesDePagina(h: number, maxFatia: number, blocos: Bloco[]): number[] {
  const PISO = maxFatia * 0.25
  // ⚠⚠ BLOCO MAIOR QUE A PÁGINA SAI DA CONTA. Recuar por ele é o pior dos
  // mundos — medido no teste: um card de 600px com página de 300 fazia a
  // página anterior terminar em 100px e o card era partido do mesmo jeito,
  // 300px adiante. Não cabendo, o corte cego é a resposta certa.
  const uteis = blocos.filter(b => b.y1 - b.y0 <= maxFatia)
  const cortes = [0]
  let y = 0
  let guarda = 0
  while (y < h - 1 && guarda++ < 500) {
    let fim = Math.min(h, y + maxFatia)
    if (fim < h) {
      // O bloco que o corte atravessa — com folga de 1px para não tratar
      // encostar na borda como atravessar.
      const corta = uteis.find(b => b.y0 < fim - 1 && b.y1 > fim + 1)
      if (corta && corta.y0 > y + PISO) fim = Math.floor(corta.y0)
    }
    cortes.push(fim)
    y = fim
  }
  if (cortes[cortes.length - 1] < h) cortes.push(h)
  return cortes
}

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, erro) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => erro(new Error('falha ao ler a imagem gerada'))
    i.src = src
  })
}

function baixar(dataUrl: string, arquivo: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = arquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const carimbo = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export async function exportarPng(el: HTMLElement, opts: ExportarOpts) {
  const { dataUrl } = await paraPng(el)
  baixar(dataUrl, `${opts.nome}.png`)
}

export async function exportarPdf(el: HTMLElement, opts: ExportarOpts) {
  const [{ dataUrl, w, h, blocos }, mod] = await Promise.all([paraPng(el), import(/* @vite-ignore */ CDN_PDF)])
  const jsPDF = (mod as any).jsPDF || (mod as any).default
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const PW = 297, PH = 210, M = 10
  const topo = opts.titulo ? 22 : M          // altura do cabeçalho
  const areaW = PW - M * 2
  const areaH = PH - topo - M

  const cabecalho = (pag: number, total: number) => {
    if (opts.titulo) {
      pdf.setFontSize(14); pdf.setTextColor(30)
      pdf.text(opts.titulo, M, 13)
      pdf.setFontSize(9); pdf.setTextColor(120)
      if (opts.legenda) pdf.text(opts.legenda, M, 18)
      const dir = `Planorc · ${carimbo()}${total > 1 ? ` · ${pag}/${total}` : ''}`
      pdf.text(dir, PW - M, 13, { align: 'right' })
    }
  }

  // Escala para caber na LARGURA; se ficar mais alto que a página, fatia em várias.
  const mmPorPx = areaW / w
  const alturaTotalMm = h * mmPorPx
  const maxFatiaPx = areaH / mmPorPx

  // ⚠⚠ AS FATIAS NÃO SÃO MAIS IGUAIS. Antes a altura era `h / páginas` e o
  // corte caía onde calhasse — no meio de um card, que é o que se vê no PDF.
  // Agora cada corte recua para o topo do card que ele atravessaria, então as
  // páginas têm alturas diferentes e o total só se sabe DEPOIS de calcular.
  const cortes = alturaTotalMm <= areaH + 0.001 ? [0, h] : cortesDePagina(h, maxFatiaPx, blocos)
  const paginas = cortes.length - 1

  if (paginas === 1) {
    cabecalho(1, 1)
    pdf.addImage(dataUrl, 'PNG', M, topo, areaW, alturaTotalMm, undefined, 'FAST')
  } else {
    const img = await carregar(dataUrl)
    const cv = document.createElement('canvas')
    const ctx = cv.getContext('2d')!
    for (let p = 0; p < paginas; p++) {
      const y = cortes[p]
      const altPx = cortes[p + 1] - y
      if (altPx <= 0) continue
      cv.width = w; cv.height = altPx
      ctx.fillStyle = cssVar('--bg', '#ffffff')
      ctx.fillRect(0, 0, w, altPx)
      ctx.drawImage(img, 0, y, w, altPx, 0, 0, w, altPx)
      if (p > 0) pdf.addPage()
      cabecalho(p + 1, paginas)
      // ⚠ A imagem entra com a ALTURA DELA, não esticada para a página: uma
      // fatia curta tem de sair curta, senão o conteúdo estica e as páginas
      // ficam em escalas diferentes.
      pdf.addImage(cv.toDataURL('image/png'), 'PNG', M, topo, areaW, altPx * mmPorPx, undefined, 'FAST')
    }
  }
  pdf.save(`${opts.nome}.pdf`)
}
