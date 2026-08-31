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

async function paraPng(el: HTMLElement): Promise<{ dataUrl: string; w: number; h: number }> {
  const { toPng } = await import(/* @vite-ignore */ CDN_IMG)
  const restaurar: Restaurar[] = [esconderBarras(el), expandirRolagens(el)]
  let dataUrl: string
  try {
    // mede DEPOIS de esconder/expandir: a largura real pode ter crescido
    void el.offsetHeight
    const largura = Math.max(el.scrollWidth, el.offsetWidth)
    const altura = Math.max(el.scrollHeight, el.offsetHeight)
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
  return { dataUrl, w: img.naturalWidth, h: img.naturalHeight }
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
  const [{ dataUrl, w, h }, mod] = await Promise.all([paraPng(el), import(/* @vite-ignore */ CDN_PDF)])
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
  const paginas = Math.max(1, Math.ceil(alturaTotalMm / areaH - 0.001))
  const fatiaPx = Math.ceil(h / paginas)

  if (paginas === 1) {
    cabecalho(1, 1)
    pdf.addImage(dataUrl, 'PNG', M, topo, areaW, alturaTotalMm, undefined, 'FAST')
  } else {
    const img = await carregar(dataUrl)
    const cv = document.createElement('canvas')
    const ctx = cv.getContext('2d')!
    for (let p = 0; p < paginas; p++) {
      const y = p * fatiaPx
      const altPx = Math.min(fatiaPx, h - y)
      cv.width = w; cv.height = altPx
      ctx.fillStyle = cssVar('--bg', '#ffffff')
      ctx.fillRect(0, 0, w, altPx)
      ctx.drawImage(img, 0, y, w, altPx, 0, 0, w, altPx)
      if (p > 0) pdf.addPage()
      cabecalho(p + 1, paginas)
      pdf.addImage(cv.toDataURL('image/png'), 'PNG', M, topo, areaW, altPx * mmPorPx, undefined, 'FAST')
    }
  }
  pdf.save(`${opts.nome}.pdf`)
}
