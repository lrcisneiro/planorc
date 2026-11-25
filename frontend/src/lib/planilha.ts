// Baixar uma tabela como .xlsx.
//
// Estava duplicado em RelatorioEditorPage e CadastrosPage; o dashboard de
// orçamento seria a terceira cópia. Promovido a compartilhado.
//
// O XLSX vem de um <script> no index.html (sheetjs por CDN), não de npm — por
// isso o `declare const`, como nas outras duas cópias. Se o CDN falhar, cai
// para CSV em vez de quebrar: exportar é melhor que não exportar.
declare const XLSX: any

/** Lê a 1ª aba de um .xlsx/.csv como objetos, com os cabeçalhos como vieram.
 *  Contraparte de `downloadSheet` — ler e escrever planilha moram juntos.
 *  Diferente da exportação, aqui NÃO há plano B: sem o XLSX do CDN não dá para
 *  interpretar o arquivo, e fingir que deu seria pior. */
export function lerPlanilha(file: File): Promise<Record<string, any>[]> {
  return new Promise((res, rej) => {
    if (typeof XLSX === 'undefined') return rej(new Error('Leitor de planilha não carregou (CDN bloqueado). Recarregue a página.'))
    const r = new FileReader()
    r.onerror = () => rej(new Error('Não foi possível ler o arquivo.'))
    r.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' })
        res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }))
      } catch (err: any) { rej(new Error('Arquivo ilegível: ' + (err?.message || err))) }
    }
    r.readAsBinaryString(file)
  })
}

/** Uma aba de um arquivo com mais de uma. */
export type AbaPlanilha = {
  nome: string
  aoa: any[][]
  cols?: number[]                                                  // larguras, por coluna
  fmts?: Record<string, string>                                    // "linha,coluna" → formato numérico
  merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[]
}

/** Workbook com N abas, larguras, merges e FORMATO NUMÉRICO por célula.
 *
 *  ⚠⚠ O FORMATO VAI NA CÉLULA, O VALOR VAI CRU. Exportar "537.493" como texto
 *  produz um arquivo que não soma — e export de relatório existe justamente
 *  para alguém somar. Com `z`, o Excel mostra igual à tela e calcula.
 *
 *  ⚠ Mora aqui, com o `downloadSheet` e o `lerPlanilha`: ler e escrever
 *  planilha moram juntos. A segunda tela que exporta não pode reimplementar
 *  merge, largura e formato — seriam dois arquivos com aparências diferentes
 *  saindo do mesmo produto.
 *
 *  ⚠⚠ NÃO HÁ CONGELAR PAINEL: medido, o SheetJS 0.20.3 da edição comunitária
 *  não escreve `<pane>` em nenhuma das três formas documentadas de `!views` —
 *  o XML sai `<sheetView workbookViewId="0"/>`. `!cols` e `!merges` funcionam.
 */
export function downloadWorkbook(filename: string, abas: AbaPlanilha[]) {
  if (typeof XLSX === 'undefined') { baixarCsv(filename.replace(/\.xlsx$/i, '.csv'), abas[0]?.aoa || []); return }
  const wb = XLSX.utils.book_new()
  for (const a of abas) {
    const ws = XLSX.utils.aoa_to_sheet(a.aoa)
    for (const k in (a.fmts || {})) {
      const [r, c] = k.split(',').map(Number)
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = a.fmts![k]
    }
    if (a.cols?.length) ws['!cols'] = a.cols.map(w => ({ wch: w }))
    if (a.merges?.length) ws['!merges'] = a.merges
    // ⚠ 31 caracteres é o limite do Excel para nome de aba, e os caracteres
    // `:\/?*[]` são proibidos — um nome inválido faz o arquivo abrir com erro
    // de reparo, não com mensagem clara.
    XLSX.utils.book_append_sheet(wb, ws, a.nome.replace(/[:\\/?*[\]]/g, '-').slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

export function downloadSheet(filename: string, aoa: any[][], aba = 'Dados') {
  if (typeof XLSX === 'undefined') { baixarCsv(filename.replace(/\.xlsx$/i, '.csv'), aoa); return }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, aba)
  XLSX.writeFile(wb, filename)
}

function baixarCsv(filename: string, aoa: any[][]) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // ponto-e-vírgula e BOM: é o que o Excel em pt-BR abre sem perguntar nada
  const csv = '﻿' + aoa.map(l => l.map(esc).join(';')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = filename; a.click(); URL.revokeObjectURL(a.href)
}
