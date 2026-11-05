// Pagina todos os registros de uma query PostgREST. O Supabase/PostgREST devolve
// no MÁXIMO 1000 linhas por chamada — sem paginar, listagens grandes (folha,
// postos, plano de contas) cortam dados silenciosamente. Uso:
//   const rows = await pageAll(() => supabase.from('x').select('...').eq(...))
//
// ⚠⚠ PAGINAR SEM `ORDER BY` DEVOLVE LINHAS REPETIDAS E PERDE OUTRAS.
// `range(0,999)` e `range(1000,1999)` são DUAS consultas independentes, e sem
// ordenação o Postgres não promete a mesma sequência entre elas — basta um
// plano paralelo ou outra execução. O resultado não é erro: é um conjunto
// *quase* certo, que some e duplica em proporção ao tamanho da tabela.
//
// Como apareceu: um cenário de orçamento recém-copiado da baseline — dado
// idêntico, provado no banco (24.454 = 24.454, soma igual, zero linhas
// divergentes) — mostrou 74 linhas com diferença na tela, algumas com 30% a
// mais. As linhas de poucas células vinham iguais; as de milhares, não. Era a
// assinatura: duas paginações concorrentes de 25 páginas cada, sem ordem.
//
// Por isso a ordem agora é **imposta aqui**, e não deixada ao chamador: eram
// 60 chamadas e a maioria não ordenava. Fosse convenção, voltaria a faltar na
// próxima — e falha calada é a pior de descobrir.
export async function pageAll<T = any>(
  makeQuery: () => any,
  opts: { orderBy?: string } = {},
): Promise<T[]> {
  const col = opts.orderBy ?? 'id'
  const size = 1000

  const rodar = async (ordenar: boolean): Promise<T[]> => {
    const out: T[] = []
    let from = 0
    for (;;) {
      let q = makeQuery()
      // Muitos chamadores devolvem o MESMO builder a cada página (o helper
      // sempre permitiu). Então só acrescenta a ordem se ela ainda não está
      // lá, senão a segunda página mandaria `order` duplicado.
      if (ordenar && !temOrdem(q)) q = q.order(col)
      const alvo = nomeDaFonte(q)

      // ⚠ LEITURA TAMBÉM CAI DE REDE. "TypeError: Failed to fetch" não tem
      // `code` — não é recusa do servidor, é a requisição que não voltou — e
      // uma carga grande faz dezenas delas. A gravação já tratava isso (o
      // laço de insert em FolhaRealizadaPage tem o mesmo retry, com o mesmo
      // comentário); a leitura não, então a importação inteira morria numa
      // página que teria funcionado na segunda tentativa.
      let data: any = null, error: any = null
      for (let tent = 1; tent <= 3; tent++) {
        const r = await q.range(from, from + size - 1)
        data = r.data; error = r.error
        if (!error) break
        if (error.code || tent === 3) break    // com `code` é dado/permissão: repetir não adianta
        await new Promise(res => setTimeout(res, 400 * tent))
      }
      if (error) {
        // Sem o nome da fonte, "Failed to fetch" não diz em qual das dez
        // consultas da tela parou — e era exatamente o que faltava saber.
        error.message = `${error.message} (ao ler ${alvo})`
        throw error
      }
      out.push(...(data || []))
      if (!data || data.length < size) break
      from += size
    }
    return out
  }

  try {
    return await rodar(true)
  } catch (e: any) {
    // 42703 = coluna inexistente: a fonte não tem `id` (view, agregado). Aí
    // segue sem ordenar, mas RECLAMANDO — acima de 1000 linhas o resultado
    // volta a ser aproximado, e quem lê o console sabe qual consulta corrigir
    // passando `orderBy`.
    // 42501 entra junto porque `posto`/`funcionario` têm GRANT por COLUNA
    // (v3_143/150): ordenar por uma coluna que o papel não pode ler é negado.
    // Se o impedimento for da consulta inteira, a segunda tentativa falha
    // igual e o erro sobe — nada é mascarado.
    if (e?.code === '42703' || e?.code === '42501'
        || /column .* does not exist/i.test(e?.message || '')) {
      console.error(
        `[pageAll] não consegui ordenar por "${col}" — paginação sem ordem pode repetir ` +
        `e perder linhas acima de 1000. Passe { orderBy: '<coluna única>' }.`, e?.message)
      return await rodar(false)
    }
    throw e
  }
}

// Nome legível da tabela/view, para a mensagem de erro.
function nomeDaFonte(q: any): string {
  try { return decodeURIComponent(String(q?.url?.pathname || '')).split('/').pop() || 'a consulta' }
  catch { return 'a consulta' }
}

// O builder do supabase-js guarda os parâmetros em `url.searchParams`; `order`
// só está lá se alguém chamou `.order()`. É API interna, por isso protegida:
// se mudar, o pior caso é ordenar de novo por cima, não quebrar.
function temOrdem(q: any): boolean {
  try { return !!q?.url?.searchParams?.has?.('order') } catch { return false }
}
