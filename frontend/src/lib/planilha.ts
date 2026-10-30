// Baixar uma tabela como .xlsx.
//
// Estava duplicado em RelatorioEditorPage e CadastrosPage; o dashboard de
// orçamento seria a terceira cópia. Promovido a compartilhado.
//
// O XLSX vem de um <script> no index.html (sheetjs por CDN), não de npm — por
// isso o `declare const`, como nas outras duas cópias. Se o CDN falhar, cai
// para CSV em vez de quebrar: exportar é melhor que não exportar.
declare const XLSX: any

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
