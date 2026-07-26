// Pagina todos os registros de uma query PostgREST. O Supabase/PostgREST devolve
// no MÁXIMO 1000 linhas por chamada — sem paginar, listagens grandes (folha,
// postos, plano de contas) cortam dados silenciosamente. Uso:
//   const rows = await pageAll(() => supabase.from('x').select('...').eq(...))
// O makeQuery é chamado a cada página (o .range() é aplicado por cima).
export async function pageAll<T = any>(makeQuery: () => any): Promise<T[]> {
  const out: T[] = []; let from = 0; const size = 1000
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + size - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < size) break
    from += size
  }
  return out
}
