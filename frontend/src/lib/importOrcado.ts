import { supabase, TENANT_ID } from './supabase'

// Importação de orçado Baseline (planilha larga, detalhada por empresa/filial/CC/dims).
// Extraído do editor de relatório para ser reusado na grade de Orçar. A lógica é a mesma:
// lê Empresa/Filial/ItemOrcamento/CentroDeCusto/Histórico + colunas de mês (datas) e grava em
// fat_orcado. A trava de permissão (escopo ORÇAR) é injetada via `canWrite` — chamadores sem
// escopo restrito passam o default (tudo liberado) e o comportamento fica idêntico ao relatório.

declare const XLSX: any

export const MESES_DATE = (ano: number) => Array.from({ length: 12 }, (_, i) => new Date(ano, i, 1))

// Gera e baixa a planilha modelo do Baseline.
export function modeloBaseline(ano: number) {
  const header = ['Empresa', 'Filial', 'ItemOrcamento', 'Centro De Custo', 'Area', 'Divisão', 'BU', 'Histórico', ...MESES_DATE(ano)]
  const ex = ['01', '2001', '22004', '111', '3-CSC', '0', '0', 'Baseline Despesas', ...Array(12).fill(1000)]
  const ws = XLSX.utils.aoa_to_sheet([header, ex])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, `modelo_orcado_baseline_${ano}.xlsx`)
}

function readWorkbook(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => { try { resolve(XLSX.read(e.target?.result, { type: 'binary', cellDates: true })) } catch (err) { reject(err) } }
    reader.readAsBinaryString(file)
  })
}
// Busca TODAS as linhas paginando (PostgREST limita ~1000 por request).
async function fetchAllRows(build: () => any): Promise<any[]> {
  const out: any[] = []
  const size = 1000
  let from = 0
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error) throw new Error(error.message || JSON.stringify(error))
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < size) break
    from += size
  }
  return out
}

export type ImportModo = 'full' | 'add'
export type ImportBaselineResult = {
  ok: boolean
  message: string
  imported: number
  skipped: number   // linhas sem empresa/item cadastrado
  blocked: number   // linhas válidas mas fora do escopo ORÇAR do usuário
}

// canWrite: true se o usuário pode orçar essa combinação (empresa/filial/CC). Default = tudo liberado.
type CanWrite = (empresaId: string, filialId: string | null, ccId: string | null) => boolean

export async function importBaseline(opts: {
  file: File
  modo: ImportModo
  versaoId: string
  canWrite?: CanWrite
}): Promise<ImportBaselineResult> {
  const { file, modo, versaoId } = opts
  const canWrite: CanWrite = opts.canWrite || (() => true)
  const fail = (message: string): ImportBaselineResult => ({ ok: false, message, imported: 0, skipped: 0, blocked: 0 })

  const wb = await readWorkbook(file)
  let aoa: any[] | null = null
  for (const n of wb.SheetNames) {
    const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }) as any[]
    if (a[0] && a[0].some((h: any) => typeof h === 'string' && h.toLowerCase().replace(/\s/g, '').includes('itemorcamento'))) { aoa = a; break }
  }
  if (!aoa) return fail('Não encontrei aba com a coluna "ItemOrcamento".')
  const header = aoa[0]
  const norm = (h: any) => typeof h === 'string' ? h.toLowerCase().replace(/\s/g, '') : ''
  const find = (...names: string[]) => header.findIndex((h: any) => names.includes(norm(h)))
  const iEmp = find('empresa'), iFil = find('filial'), iItem = find('itemorcamento'), iCC = find('centrodecusto')
  const iHist = find('histórico', 'historico')
  const months: { idx: number; ano: number; mes: number }[] = []
  header.forEach((h: any, idx: number) => { if (h instanceof Date) months.push({ idx, ano: h.getFullYear(), mes: h.getMonth() + 1 }) })
  if (iEmp < 0 || iItem < 0 || !months.length) return fail('Colunas obrigatórias não encontradas (Empresa, ItemOrcamento e colunas de mês).')

  // ItemOrcamento resolve para a LINHA MESTRE (fat_orcado.linha_id é mestre)
  const [{ data: emps }, { data: fils }, { data: ccs }, lns] = await Promise.all([
    supabase.from('empresa').select('id,codigo'),
    supabase.from('filial').select('id,codigo'),
    supabase.from('centro_custo').select('id,codigo'),
    fetchAllRows(() => supabase.from('conta_orcamentaria').select('id,codigo')),
  ])
  const empMap: any = {}; emps?.forEach((e: any) => { empMap[String(e.codigo)] = e.id })
  const filMap: any = {}; fils?.forEach((f: any) => { filMap[String(f.codigo)] = f.id })
  const ccMap: any = {}; ccs?.forEach((c: any) => { ccMap[String(c.codigo)] = c.id })
  const lnMap: any = {}; lns?.forEach((l: any) => { lnMap[String(l.codigo)] = l.id })

  // Agrega por chave única (soma duplicatas que colapsam na mesma combinação)
  const agg = new Map<string, any>()
  const empSet = new Set<string>()
  const missEmp = new Set<string>(); const missItem = new Set<string>()
  let skip = 0; let blocked = 0
  const dimsKeyOf = (d: any) => JSON.stringify(Object.keys(d).sort().reduce((o: any, k) => { o[k] = d[k]; return o }, {}))
  // forward-fill: células mescladas/repetidas vazias herdam a linha anterior
  const dimIdxs = [iEmp, iFil, iItem, iCC, iHist].filter(i => i >= 0)
  const carry: Record<number, any> = {}
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r]; if (!row || !row.length) continue
    for (const ix of dimIdxs) {
      if (row[ix] !== '' && row[ix] != null) carry[ix] = row[ix]
      else row[ix] = carry[ix] ?? ''
    }
    const empCod = String(row[iEmp] ?? '').trim(); const itemCod = String(row[iItem] ?? '').trim()
    if (!empCod && !itemCod) continue
    const empresa_id = empMap[empCod]; const linha_id = lnMap[itemCod]
    if (!empresa_id || !linha_id) { skip++; if (empCod && !empresa_id) missEmp.add(empCod); if (itemCod && !linha_id) missItem.add(itemCod); continue }
    const filial_id = iFil >= 0 ? (filMap[String(row[iFil] ?? '').trim()] || null) : null
    const ccCodRaw = iCC >= 0 ? String(row[iCC] ?? '').trim() : ''
    const cc_id = ccCodRaw ? (ccMap[ccCodRaw] || null) : null
    // trava por permissão (escopo ORÇAR): descarta o que o usuário não pode orçar
    if (!canWrite(empresa_id, filial_id, cc_id)) { blocked++; continue }
    const dims: any = {}
    if (ccCodRaw && !cc_id) dims.cc_orig = ccCodRaw   // CC não cadastrado → guarda o código p/ re-vincular depois
    if (iHist >= 0 && row[iHist] !== '' && row[iHist] != null) dims.historico = String(row[iHist]).trim()
    const dk = dimsKeyOf(dims)
    empSet.add(empresa_id)
    for (const m of months) {
      const v = row[m.idx]
      const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
      if (!num) continue
      const key = `${linha_id}|${empresa_id}|${filial_id || ''}|${cc_id || ''}|${m.ano}|${m.mes}|${dk}`
      const cur = agg.get(key)
      if (cur) cur.valor += num
      else agg.set(key, { tenant_id: TENANT_ID, versao_id: versaoId, linha_id, empresa_id, filial_id, cc_id, ano: m.ano, mes: m.mes, valor: num, expressao: null, origem: 'MANUAL', dims })
    }
  }
  const records = Array.from(agg.values())
  const detalhe = () => {
    let m = ''
    if (missEmp.size) m += `\n• Empresas não cadastradas (${missEmp.size}): ${[...missEmp].slice(0, 20).join(', ')}${missEmp.size > 20 ? '…' : ''}`
    if (missItem.size) m += `\n• Itens/linhas não encontrados (${missItem.size}): ${[...missItem].slice(0, 20).join(', ')}${missItem.size > 20 ? '…' : ''}`
    if (blocked) m += `\n• ${blocked} linha(s) ignorada(s) por estarem fora do seu escopo de orçar.`
    return m
  }
  if (!records.length) return { ok: false, message: `Nenhum lançamento válido. ${skip} linhas ignoradas.` + detalhe(), imported: 0, skipped: skip, blocked }
  const totalVal = records.reduce((s, r) => s + (Number(r.valor) || 0), 0)
  const fmtTotal = totalVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (modo === 'full') {
    // Full load: apaga o orçado manual da versão p/ as empresas do arquivo — mas só o que o
    // usuário PODE orçar (busca as chaves atuais e filtra por canWrite antes de deletar).
    const ex = await fetchAllRows(() => supabase.from('fat_orcado')
      .select('id,empresa_id,filial_id,cc_id')
      .eq('versao_id', versaoId).eq('origem', 'MANUAL').in('empresa_id', Array.from(empSet)))
    const delIds = (ex || []).filter((r: any) => canWrite(r.empresa_id, r.filial_id, r.cc_id)).map((r: any) => r.id)
    for (let i = 0; i < delIds.length; i += 500) {
      const { error } = await supabase.from('fat_orcado').delete().in('id', delIds.slice(i, i + 500)); if (error) throw error
    }
    for (let i = 0; i < records.length; i += 500) {
      const { error } = await supabase.from('fat_orcado').insert(records.slice(i, i + 500)); if (error) throw error
    }
    return { ok: true, imported: records.length, skipped: skip, blocked,
      message: `Full load: ${records.length} lançamentos importados (total ${fmtTotal}) em ${empSet.size} empresa(s).` + (skip || blocked ? detalhe() : '') }
  }
  // Adicionar: soma aos existentes (busca chaves atuais e acumula)
  const ex = await fetchAllRows(() => supabase.from('fat_orcado')
    .select('id,linha_id,empresa_id,filial_id,cc_id,ano,mes,valor,dims')
    .eq('versao_id', versaoId).eq('origem', 'MANUAL').in('empresa_id', Array.from(empSet)))
  const exMap: Record<string, { id: string; valor: number }> = {}
  ;(ex || []).forEach((r: any) => {
    const k = `${r.linha_id}|${r.empresa_id}|${r.filial_id || ''}|${r.cc_id || ''}|${r.ano}|${r.mes}|${dimsKeyOf(r.dims || {})}`
    exMap[k] = { id: r.id, valor: Number(r.valor) || 0 }
  })
  const toInsert: any[] = []; const toUpdate: { id: string; valor: number }[] = []
  for (const [key, rec] of agg.entries()) {
    const hit = exMap[key]
    if (hit) toUpdate.push({ id: hit.id, valor: hit.valor + rec.valor })
    else toInsert.push(rec)
  }
  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase.from('fat_orcado').insert(toInsert.slice(i, i + 500)); if (error) throw error
  }
  for (const u of toUpdate) { const { error } = await supabase.from('fat_orcado').update({ valor: u.valor }).eq('id', u.id); if (error) throw error }
  return { ok: true, imported: toInsert.length + toUpdate.length, skipped: skip, blocked,
    message: `Adicionado: ${toInsert.length} novos, ${toUpdate.length} somados (total do arquivo ${fmtTotal}).` + (skip || blocked ? detalhe() : '') }
}
