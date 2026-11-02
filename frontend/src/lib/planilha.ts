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
